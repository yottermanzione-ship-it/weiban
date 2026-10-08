package app.weiban

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import app.weiban.data.DeviceNotificationControls
import app.weiban.data.OwnerRecord
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

private class NotificationControlState(
    private val runtime: WeibanApplication,
    private val owner: OwnerRecord,
    private val scope: CoroutineScope,
) {
    var enabled by mutableStateOf(false)
    var busy by mutableStateOf(false)
    var status by mutableStateOf("正在读取通知状态")
    val available get() = runtime.push.available

    fun owned(): Boolean {
        val auth = runtime.repository.auth.value
        return auth?.user?.userId == owner.userId && auth.session.sessionId == owner.sessionId
    }

    private suspend fun refresh() {
        if (!owned()) return
        enabled = runtime.repository.notifications.enabled(owner)
        status =
            when {
                !available -> "此设备暂不支持消息通知"
                !runtime.push.permitted() -> "系统通知未开启"
                !enabled -> "未开启"
                runtime.repository.notifications.deviceId(owner) == null -> "正在连接通知通道"
                else -> "已开启"
            }
    }

    @Suppress("TooGenericExceptionCaught") // Show transport errors only for the captured session.
    fun perform(work: suspend () -> Unit = {}) {
        if (!owned() || busy) return
        busy = true
        scope.launch {
            try {
                work()
                refresh()
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                if (owned()) status = "暂时无法完成，请重试"
            } finally {
                if (owned()) busy = false
            }
        }
    }

    fun enable(requestPermission: () -> Unit) {
        if (!available || !owned() || busy) return
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(runtime, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermission()
        } else {
            allowed()
        }
    }

    fun allowed() = perform { runtime.push.enable(owner) }

    fun disable() = perform { runtime.push.disable(owner) }
}

@Composable internal fun notificationControls(
    runtime: WeibanApplication,
    owner: OwnerRecord,
): DeviceNotificationControls {
    val scope = rememberCoroutineScope()
    val actions = remember(runtime, owner) { NotificationControlState(runtime, owner, scope) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var requested by remember(owner) { mutableStateOf<OwnerRecord?>(null) }
    val permission =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed ->
            val captured = requested
            requested = null
            if (captured == owner && actions.owned()) {
                if (allowed) actions.allowed() else actions.status = "系统通知未开启"
            }
        }
    LaunchedEffect(actions) { actions.perform() }
    DisposableEffect(lifecycle, actions) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) actions.perform() }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    return DeviceNotificationControls(
        actions.status,
        actions.available,
        actions.enabled,
        actions.busy,
        enable = {
            actions.enable {
                requested = owner
                permission.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        },
        disable = actions::disable,
        systemSettings = {
            runtime.startActivity(
                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, runtime.packageName)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        },
    )
}
