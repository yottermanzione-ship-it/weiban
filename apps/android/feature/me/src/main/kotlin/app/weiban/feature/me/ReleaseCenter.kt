package app.weiban.feature.me

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import app.weiban.contracts.*
import app.weiban.data.OwnerRecord
import app.weiban.data.SessionCallOptions
import app.weiban.data.SessionRepository
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.MenuGroup
import app.weiban.designsystem.MenuRow
import app.weiban.designsystem.tokens.WbSpace
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import java.io.IOException

/**
 * 公告 / 本版新功能 / 强制更新（后端交接 2026-10-13，契约 3.2；网页 features/release.tsx 为参照）。
 * 打开应用、回到前台时拉取；弹窗顺序：必须更新（不可关闭）→ 本版新功能 → 未读弹窗公告（从旧到新）。
 */
object ReleaseCenter {
    const val PLATFORM = "android"

    /** 宿主在启动时写入 BuildConfig.VERSION_CODE / VERSION_NAME。 */
    var versionCode: Long = 0
    var versionName: String = ""

    val announcements = MutableStateFlow<AnnouncementEndpointsListAnnouncementsResponse?>(null)
    val notes = MutableStateFlow<ReleaseEndpointsListReleaseNotesResponse?>(null)
    val version = MutableStateFlow<ReleaseEndpointsCheckVersionResponse?>(null)

    /** 本次运行里已经关掉的「本版新功能」（防止 seen 回执失败时反复弹）。 */
    internal var whatsNewDismissed = false

    private fun versionQuery() = mapOf("platform" to PLATFORM, "versionCode" to versionCode.toString())

    internal suspend fun checkVersion(repository: SessionRepository): ReleaseEndpointsCheckVersionResponse =
        repository
            .call(
                Endpoints.releaseEndpointsCheckVersion,
                query = versionQuery(),
                options = SessionCallOptions(networkOnly = true),
            ).also { version.value = it }

    @Suppress("TooGenericExceptionCaught") // Each part is best-effort; one failure must not hide the others.
    suspend fun refresh(
        repository: SessionRepository,
        owner: OwnerRecord,
    ) {
        val options = SessionCallOptions(owner = owner, networkOnly = true)
        quietly { checkVersion(repository) }
        quietly {
            announcements.value =
                repository.call(Endpoints.announcementEndpointsListAnnouncements, query = mapOf("platform" to PLATFORM), options = options)
        }
        quietly { notes.value = repository.call(Endpoints.releaseEndpointsListReleaseNotes, query = versionQuery(), options = options) }
    }

    internal suspend fun markRead(
        repository: SessionRepository,
        owner: OwnerRecord,
        ids: List<String>,
    ) {
        if (ids.isEmpty()) return
        val current = announcements.value
        if (current != null) {
            val now =
                java.time.Instant
                    .now()
                    .toString()
            val items = current.items.map { if (it.announcementId in ids && it.readAt == null) it.copy(readAt = now) else it }
            announcements.value = current.copy(items = items, unreadCount = items.count { it.readAt == null }.toLong())
        }
        quietly {
            repository.call(
                Endpoints.announcementEndpointsMarkAnnouncementsRead,
                body = buildJsonObject { put("announcementIds", JsonArray(ids.map(::JsonPrimitive))) },
                options = SessionCallOptions(owner = owner, networkOnly = true),
            )
        }
    }

    internal suspend fun markWhatsNewSeen(
        repository: SessionRepository,
        owner: OwnerRecord,
    ) {
        whatsNewDismissed = true
        notes.value = notes.value?.copy(whatsNew = emptyList())
        quietly {
            repository.call(
                Endpoints.releaseEndpointsMarkReleaseNotesSeen,
                body =
                    buildJsonObject {
                        put("platform", PLATFORM)
                        put("versionCode", versionCode)
                    },
                options = SessionCallOptions(owner = owner, networkOnly = true),
            )
        }
    }

    val unreadAnnouncements: Long get() = announcements.value?.unreadCount ?: 0

    @Suppress("TooGenericExceptionCaught")
    private suspend fun quietly(work: suspend () -> Unit) {
        try {
            work()
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            // 公告与版本检查都是尽力而为，失败时下次回到前台再拉。
        }
    }
}

internal fun openDownload(
    context: Context,
    url: String?,
) {
    val address = url?.takeIf { it.startsWith("https://") || it.startsWith("http://") }
    if (address == null) {
        Toast.makeText(context, "暂时没有下载地址，请联系管理员", Toast.LENGTH_SHORT).show()
        return
    }
    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(address)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        .onFailure { Toast.makeText(context, "没有可以打开下载地址的应用", Toast.LENGTH_SHORT).show() }
}

/** 弹窗中心：宿主放在所有页面之上；启动与每次回到前台时拉取。 */
@Composable fun ReleasePopups(
    repository: SessionRepository,
    owner: OwnerRecord,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val lifecycle by LocalLifecycleOwner.current.lifecycle.currentStateFlow
        .collectAsState()
    val resumed = lifecycle.isAtLeast(Lifecycle.State.RESUMED)
    LaunchedEffect(owner, resumed) { if (resumed) ReleaseCenter.refresh(repository, owner) }
    val version by ReleaseCenter.version.collectAsState()
    val notes by ReleaseCenter.notes.collectAsState()
    val announcements by ReleaseCenter.announcements.collectAsState()
    val required = version?.takeIf { it.updateRequired }
    if (required != null) {
        AlertDialog(
            onDismissRequest = {},
            properties = DialogProperties(dismissOnBackPress = false, dismissOnClickOutside = false),
            title = { Text("需要更新到新版本") },
            text = {
                Text(
                    required.forceUpdateMessage?.ifBlank { null }
                        ?: "当前版本已停止服务，请更新到 ${required.latestVersion ?: "最新版本"} 后继续使用。",
                )
            },
            confirmButton = { Button(onClick = { openDownload(context, required.downloadUrl) }) { Text("去下载") } },
        )
        return
    }
    val whatsNew = notes?.whatsNew.orEmpty()
    if (whatsNew.isNotEmpty() && !ReleaseCenter.whatsNewDismissed) {
        val close: () -> Unit = { scope.launch { ReleaseCenter.markWhatsNewSeen(repository, owner) } }
        AlertDialog(
            onDismissRequest = close,
            title = { Text("本版新功能") },
            text = { NoteList(whatsNew.sortedByDescending { it.versionCode }) },
            confirmButton = { Button(onClick = close) { Text("知道了") } },
        )
        return
    }
    val popup =
        announcements
            ?.items
            .orEmpty()
            .filter { it.popup && it.readAt == null }
            .minByOrNull { it.publishedAt } ?: return
    val close: () -> Unit = { scope.launch { ReleaseCenter.markRead(repository, owner, listOf(popup.announcementId)) } }
    AlertDialog(
        onDismissRequest = close,
        title = { Text(popup.title) },
        text = { Text(popup.body, Modifier.heightIn(max = 360.dp).verticalScroll(rememberScrollState())) },
        confirmButton = { Button(onClick = close) { Text("知道了") } },
    )
}

@Composable private fun NoteList(items: List<ReleaseNote>) {
    val colors = LocalWeibanColors.current
    Column(Modifier.heightIn(max = 400.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(WbSpace.S4)) {
        items.forEach { note ->
            Column(verticalArrangement = Arrangement.spacedBy(WbSpace.S2)) {
                Text("${note.version} · ${note.title}", style = MaterialTheme.typography.titleSmall)
                Text(note.body)
                Text(note.publishedAt.take(10), color = colors.textTertiary, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

/** 设置 › 关于微伴：版本、构建号、公告（红点）、更新日志、检查更新。 */
@Composable internal fun AboutPage(state: MeState) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val announcements by ReleaseCenter.announcements.collectAsState()
    var checking by remember { mutableStateOf(false) }
    var available by remember { mutableStateOf<ReleaseEndpointsCheckVersionResponse?>(null) }
    Column(Modifier.fillMaxWidth().padding(WbSpace.S7), horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally) {
        Text("微伴", style = MaterialTheme.typography.headlineMedium)
        Text(
            "版本 ${ReleaseCenter.versionName}（构建号 ${ReleaseCenter.versionCode}）",
            color = LocalWeibanColors.current.textSecondary,
        )
    }
    MenuGroup {
        MenuRow("公告", dot = (announcements?.unreadCount ?: 0) > 0) { state.openPage("announcements") }
        MenuRow("更新日志") { state.openPage("release-notes") }
        MenuRow("检查更新", value = if (checking) "正在检查…" else null, enabled = !checking) {
            checking = true
            scope.launch {
                try {
                    val result = ReleaseCenter.checkVersion(state.repository)
                    if (result.updateAvailable || result.updateRequired) {
                        available = result
                    } else {
                        Toast.makeText(context, "已是最新版本", Toast.LENGTH_SHORT).show()
                    }
                } catch (error: CancellationException) {
                    throw error
                } catch (_: IOException) {
                    Toast.makeText(context, "检查失败，请稍后再试", Toast.LENGTH_SHORT).show()
                } finally {
                    checking = false
                }
            }
        }
    }
    available?.let { result ->
        AlertDialog(
            onDismissRequest = { available = null },
            title = { Text("发现新版本 ${result.latestVersion.orEmpty()}") },
            text = { result.latestNote?.let { NoteList(listOf(it)) } ?: Text("更新后可以用到最新功能。") },
            confirmButton = { Button(onClick = { openDownload(context, result.downloadUrl) }) { Text("去下载") } },
            dismissButton = { TextButton(onClick = { available = null }) { Text("以后再说") } },
        )
    }
}

/** 公告列表：进入即全部已读。 */
@Composable internal fun AnnouncementsPage(state: MeState) {
    val announcements by ReleaseCenter.announcements.collectAsState()
    val colors = LocalWeibanColors.current
    LaunchedEffect(state.owner) {
        ReleaseCenter.refresh(state.repository, state.owner)
        val unread =
            ReleaseCenter.announcements.value
                ?.items
                .orEmpty()
                .filter { it.readAt == null }
                .map { it.announcementId }
        ReleaseCenter.markRead(state.repository, state.owner, unread)
    }
    val items = announcements?.items.orEmpty()
    if (announcements == null) LinearProgressIndicator(Modifier.fillMaxWidth())
    if (announcements != null && items.isEmpty()) Text("暂时没有公告", Modifier.padding(WbSpace.S5), color = colors.textSecondary)
    items.forEach { item ->
        MenuGroup {
            Column(Modifier.fillMaxWidth().padding(WbSpace.S5), verticalArrangement = Arrangement.spacedBy(WbSpace.S2)) {
                Text((if (item.pinned) "置顶 · " else "") + item.title, style = MaterialTheme.typography.titleSmall)
                Text(item.body)
                Text(item.publishedAt.take(10), color = colors.textTertiary, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

/** 更新日志（安卓平台）。 */
@Composable internal fun ReleaseNotesPage(state: MeState) {
    val notes by ReleaseCenter.notes.collectAsState()
    LaunchedEffect(state.owner) { ReleaseCenter.refresh(state.repository, state.owner) }
    val items = notes?.items.orEmpty().sortedByDescending { it.versionCode }
    if (notes == null) LinearProgressIndicator(Modifier.fillMaxWidth())
    if (notes != null && items.isEmpty()) Text("暂时没有更新日志", Modifier.padding(WbSpace.S5), color = LocalWeibanColors.current.textSecondary)
    if (items.isNotEmpty()) {
        MenuGroup { Box(Modifier.padding(WbSpace.S5)) { NoteList(items) } }
    }
}
