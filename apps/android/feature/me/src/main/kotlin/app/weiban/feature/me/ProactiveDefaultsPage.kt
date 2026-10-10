package app.weiban.feature.me

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import app.weiban.contracts.*
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.tokens.WbSpace
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

private val frequencies = listOf("low" to "少", "medium" to "适中", "high" to "多")

/** 服务 › 主动消息与免打扰（ACC-03、SIM-10；设计 me-and-services.md 3.4）：总开关 + 默认频率。 */
@Composable internal fun ProactiveDefaultsPage(state: MeState) {
    val colors = LocalWeibanColors.current
    var defaults by remember { mutableStateOf<CompanionSettings?>(null) }
    LaunchedEffect(state) {
        state.perform {
            state.notificationSettings = state.call(Endpoints.identityEndpointsGetNotificationSettings)
            defaults = state.call(Endpoints.companionEndpointsGetDefaults)
        }
    }
    val settings = state.notificationSettings ?: return
    PeriodSwitchRow("角色主动找我", settings.proactiveMessagesEnabled, !state.busy) { enabled ->
        state.perform {
            state.notificationSettings =
                state.call(
                    Endpoints.identityEndpointsUpdateNotificationSettings,
                    buildJsonObject { put("proactiveMessagesEnabled", enabled) },
                )
        }
    }
    Text("关闭后所有角色都不会主动发消息；你发消息时 TA 照常回复。", color = colors.textSecondary, style = MaterialTheme.typography.bodySmall)
    // 「角色给我打电话」（MED-07 第 1 条、media-l5.md 7.4）：关闭后所有角色都不会来电。
    val context = LocalContext.current
    PeriodSwitchRow("角色给我打电话", settings.proactiveCallsEnabled, !state.busy) { enabled ->
        state.perform {
            state.notificationSettings =
                state.call(Endpoints.identityEndpointsUpdateNotificationSettings, buildJsonObject { put("proactiveCallsEnabled", enabled) })
        }
    }
    if (settings.proactiveCallsEnabled && !fullScreenAllowed(context)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("未允许全屏通知，锁屏时只会收到通知", Modifier.weight(1f), color = colors.textSecondary, style = MaterialTheme.typography.bodySmall)
            TextButton(onClick = { openFullScreenSettings(context) }) { Text("去设置") }
        }
    }
    PeriodSwitchRow("允许角色拉我进群", settings.allowCharacterGroupInvites, !state.busy) { enabled ->
        state.perform {
            state.notificationSettings =
                state.call(
                    Endpoints.identityEndpointsUpdateNotificationSettings,
                    buildJsonObject { put("allowCharacterGroupInvites", enabled) },
                )
        }
    }
    val current = defaults
    if (settings.proactiveMessagesEnabled && current != null) {
        Text("默认主动消息频率", style = MaterialTheme.typography.titleSmall)
        Row(horizontalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
            frequencies.forEach { (id, label) ->
                FilterChip(
                    selected = (current.proactiveFrequency ?: "medium") == id,
                    enabled = !state.busy,
                    onClick = {
                        state.perform {
                            defaults =
                                state.call(Endpoints.companionEndpointsUpdateDefaults, buildJsonObject { put("proactiveFrequency", id) })
                            state.message = "下一次主动消息开始生效"
                        }
                    },
                    label = { Text(label) },
                )
            }
        }
        Text("单个角色可在聊天信息里另外设置。", color = colors.textSecondary, style = MaterialTheme.typography.bodySmall)
    }
}

/** 安卓 14 起全屏通知需要单独授权（来电锁屏弹出用）。 */
private fun fullScreenAllowed(context: Context): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE ||
        context.getSystemService(NotificationManager::class.java).canUseFullScreenIntent()

private fun openFullScreenSettings(context: Context) {
    val action =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT
        } else {
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS
        }
    try {
        context.startActivity(Intent(action, Uri.fromParts("package", context.packageName, null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (_: android.content.ActivityNotFoundException) {
        Unit
    }
}
