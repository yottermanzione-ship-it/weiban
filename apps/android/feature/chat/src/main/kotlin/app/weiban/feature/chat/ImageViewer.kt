package app.weiban.feature.chat

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import app.weiban.contracts.*
import app.weiban.data.SessionCallOptions
import app.weiban.designsystem.tokens.WbSpace
import kotlinx.coroutines.launch

private const val VIEWER_DECODE_EDGE = 2_048

/** 一张可在查看器里翻看的图（图片消息或表情）。 */
internal data class ViewerItem(
    val message: Message,
    val mediaId: String,
)

internal fun viewerItems(messages: List<Message>): List<ViewerItem> =
    messages.filter { it.status == "normal" }.mapNotNull { message ->
        when (val content = message.content) {
            is ReceivedMessageContentImage -> ViewerItem(message, content.mediaId)
            else -> null
        }
    }

/**
 * 全屏图片查看（C 15.2、media-l5.md 2.2）：会话里的图片左右滑动切换；
 * 「…」菜单：保存图片、收藏、添加到表情（别人的图）、删除。
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable internal fun ImageViewer(
    ui: ConversationUi,
    items: List<ViewerItem>,
    startMessageId: String,
    onDismiss: () -> Unit,
) {
    if (items.isEmpty()) {
        LaunchedEffect(Unit) { onDismiss() }
        return
    }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val start = items.indexOfFirst { it.message.messageId == startMessageId }.coerceAtLeast(0)
    val pager = rememberPagerState(initialPage = start) { items.size }
    var menu by remember { mutableStateOf(false) }
    var pendingSave by remember { mutableStateOf<String?>(null) }
    val storage =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            val mediaId = pendingSave
            pendingSave = null
            if (granted && mediaId != null) ui.media.save(context, mediaId) else if (!granted) ui.media.toast("需要存储权限才能保存图片")
        }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            HorizontalPager(pager, Modifier.fillMaxSize()) { page ->
                val item = items[page]
                val state = rememberMediaBitmap(ui.repository, ui.owner, item.mediaId, false, VIEWER_DECODE_EDGE)
                Box(Modifier.fillMaxSize().clickable(onClick = onDismiss), contentAlignment = Alignment.Center) {
                    val bitmap = state.bitmap
                    when {
                        bitmap != null -> Image(bitmap.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
                        state.failed -> Text("图片损坏，点击重试", Modifier.clickable(onClick = state::retry), color = Color.White)
                        else -> CircularProgressIndicator()
                    }
                }
            }
            Row(Modifier.fillMaxWidth().padding(WbSpace.S5), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onDismiss) { Text("关闭", color = Color.White) }
                Spacer(Modifier.weight(1f))
                Text("${pager.currentPage + 1} / ${items.size}", color = Color.White)
                Spacer(Modifier.weight(1f))
                Box {
                    TextButton(onClick = { menu = true }) { Text("•••", color = Color.White) }
                    val current = items.getOrNull(pager.currentPage)
                    DropdownMenu(menu && current != null, { menu = false }) {
                        if (current == null) return@DropdownMenu
                        DropdownMenuItem(text = { Text("保存图片") }, onClick = {
                            menu = false
                            val legacy = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                            val granted =
                                context.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
                            if (legacy && !granted) {
                                pendingSave = current.mediaId
                                storage.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                            } else {
                                ui.media.save(context, current.mediaId)
                            }
                        })
                        DropdownMenuItem(text = { Text("收藏") }, onClick = {
                            menu = false
                            ui.media.favorite(current.message)
                        })
                        if (current.message.senderKind != "user") {
                            DropdownMenuItem(text = { Text("添加到表情") }, onClick = {
                                menu = false
                                ui.media.addToStickers(current.message)
                            })
                        }
                        DropdownMenuItem(text = { Text("删除") }, onClick = {
                            menu = false
                            scope.launch {
                                userAction({ ui.media.toast(it) }) {
                                    ui.repository.call(
                                        Endpoints.chatEndpointsHideMessage,
                                        params = mapOf("conversationId" to current.message.conversationId, "messageId" to current.message.messageId),
                                        options = SessionCallOptions(owner = ui.owner),
                                    )
                                }
                            }
                            if (items.size <= 1) onDismiss()
                        })
                    }
                }
            }
        }
    }
}
