package app.weiban.feature.chat

import androidx.compose.material3.*
import androidx.compose.runtime.*
import app.weiban.contracts.*
import app.weiban.data.SessionCallOptions
import android.content.ClipData
import android.content.ClipboardManager
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.launch

@Composable internal fun MessageActions(
    ui: ConversationUi,
    message: Message,
    expanded: Boolean,
    onDismiss: () -> Unit,
) {
    val repository = ui.repository
    val owner = ui.owner
    val conversation = ui.conversation
    val onError: (String) -> Unit = { ui.error = it }
    val scope = rememberCoroutineScope()
    val mine = message.senderKind == "user"
    DropdownMenu(expanded, onDismiss) {
        if (message.status != "recalled") {
            DropdownMenuItem(text = { Text("引用") }, onClick = {
                onDismiss()
                ui.quoteId = message.messageId
            })
        }
        if (message.status == "normal") MediaActions(ui, message, onDismiss)
        if (mine && message.status != "recalled") {
            DropdownMenuItem(text = { Text("撤回") }, onClick = {
                onDismiss()
                scope.launch {
                    userAction(onError) {
                        repository.call(
                            Endpoints.chatEndpointsRecallMessage,
                            params = mapOf("conversationId" to conversation.conversationId, "messageId" to message.messageId),
                            options = SessionCallOptions(owner = owner),
                        )
                    }
                }
            })
        }
        DropdownMenuItem(text = { Text("从我的界面删除") }, onClick = {
            onDismiss()
            scope.launch {
                userAction(onError) {
                    repository.call(
                        Endpoints.chatEndpointsHideMessage,
                        params = mapOf("conversationId" to conversation.conversationId, "messageId" to message.messageId),
                        options = SessionCallOptions(owner = owner),
                    )
                }
            }
        })
    }
}

/** L5 长按菜单（media-l5.md）：图片 保存 / 收藏 / 添加到表情；表情 添加到表情；语音 转文字 / 收藏；链接 复制 / 收藏。 */
@Composable private fun MediaActions(
    ui: ConversationUi,
    message: Message,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val mine = message.senderKind == "user"
    fun item(
        label: String,
        action: () -> Unit,
    ): @Composable () -> Unit =
        {
            DropdownMenuItem(text = { Text(label) }, onClick = {
                onDismiss()
                action()
            })
        }
    val entries =
        when (val content = message.content) {
            is ReceivedMessageContentImage ->
                listOfNotNull(
                    item("保存图片") { ui.media.save(context, content.mediaId) },
                    item("收藏") { ui.media.favorite(message) },
                    if (!mine) item("添加到表情") { ui.media.addToStickers(message) } else null,
                )
            is ReceivedMessageContentSticker ->
                listOfNotNull(if (!mine) item("添加到表情") { ui.media.addToStickers(message) } else null)
            is ReceivedMessageContentVoice -> {
                val shown = ui.media.transcripts[message.messageId]?.shown == true
                listOf(
                    item(if (shown) "隐藏文字" else "转文字") { ui.media.toggleTranscript(message) },
                    item("收藏") { ui.media.favorite(message) },
                )
            }
            is ReceivedMessageContentLink ->
                listOf(
                    item("复制链接") {
                        context.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("链接", content.url))
                        ui.media.toast("已复制")
                    },
                    item("收藏") { ui.media.favorite(message) },
                )
            is ReceivedMessageContentText -> listOf(item("收藏") { ui.media.favorite(message) })
            else -> emptyList()
        }
    entries.forEach { it() }
}
