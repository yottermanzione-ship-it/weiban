package app.weiban.feature.chat

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import app.weiban.contracts.*
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.tokens.WbSpace

@OptIn(ExperimentalFoundationApi::class)
@Composable internal fun MessageRow(
    ui: ConversationUi,
    avatars: MessageAvatars,
    message: Message,
) {
    val repository = ui.repository
    val owner = ui.owner
    val conversation = ui.conversation
    val group = conversation.isGroup()
    val context = LocalContext.current
    var menu by remember { mutableStateOf(false) }
    val mine = message.senderKind == "user"
    val avatar = avatars.sender(message)
    val openSender = {
        if (avatar != null && !avatar.user) ui.openProfile(ProfileTarget(avatar.id, ui.groupGreeting))
    }
    val content = message.content.takeIf { message.status == "normal" }
    // 点通话记录回拨（design/pages/call.md 第 1 节）。
    val dial = if (content is ReceivedMessageContentCallRecord && !group) rememberDial() else null
    val peer = conversation.participants.find { it.kind == "character" }
    // 点一下的主操作：图片 → 查看器；语音 → 播放；链接 → 唤起 App；其余 → 菜单。长按一律菜单。
    val primary: () -> Unit =
        when (content) {
            is ReceivedMessageContentImage -> { -> ui.media.viewing = message.messageId }
            is ReceivedMessageContentVoice -> { -> ui.media.player.toggle(message) }
            is ReceivedMessageContentLink -> { -> if (!openLink(context, content.url)) ui.media.toast("无法打开这个链接") }
            is ReceivedMessageContentCallRecord -> { ->
                if (dial != null && peer != null) {
                    dial(peer.refId, avatars.roles[peer.participantId]?.name.orEmpty().ifEmpty { "角色" })
                } else {
                    menu = true
                }
                Unit
            }
            else -> { -> menu = true }
        }
    val press = Modifier.combinedClickable(onLongClick = { menu = true }, onClick = primary)
    Column(Modifier.fillMaxWidth().padding(vertical = WbSpace.S3), horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
            verticalAlignment = Alignment.Top,
        ) {
            if (!mine && avatar != null) Box(Modifier.clickable(onClick = openSender)) { MessageAvatar(repository, owner, avatar) }
            Spacer(Modifier.width(WbSpace.S3))
            Column(Modifier.weight(1f, fill = false), horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
                // 群聊显示发送者名字（SOC-04）；私聊不显示。
                if (group && !mine && avatar != null) {
                    Text(avatar.name, style = MaterialTheme.typography.bodySmall, color = LocalWeibanColors.current.textSecondary)
                }
                when (content) {
                    // 图片、表情包无气泡（C 4.2）。
                    is ReceivedMessageContentImage -> ImageMessage(ui, content, press)
                    is ReceivedMessageContentSticker -> StickerMessage(repository, owner, content.mediaId, press)
                    else ->
                        Surface(
                            color = if (mine) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainer,
                            modifier = press,
                        ) {
                            Column(Modifier.padding(WbSpace.S5)) {
                                message.quote?.let { Text(it.preview ?: "引用的消息已不可见", style = MaterialTheme.typography.bodySmall) }
                                MessageBody(ui, avatars, message)
                            }
                        }
                }
            }
            Spacer(Modifier.width(WbSpace.S3))
            if (mine && avatar != null) MessageAvatar(repository, owner, avatar)
        }
        if (mine && !group && conversation.peerReadSeq?.let { it >= message.seq } == true) {
            Text("已读", style = MaterialTheme.typography.bodySmall)
        }
        MessageActions(ui, message, menu) { menu = false }
    }
}

@Composable private fun MessageBody(
    ui: ConversationUi,
    avatars: MessageAvatars,
    message: Message,
) {
    val colors = LocalWeibanColors.current
    val content = message.content
    when {
        message.status == "normal" && content is ReceivedMessageContentContactCard -> {
            // 名片（CHR-04）：点开资料页，添加时带推荐人。
            val recommender = avatars.roles.values.find { it.id == content.recommenderCharacterId }?.name.orEmpty()
            Column(
                Modifier.clickable {
                    ui.openProfile(
                        ProfileTarget(
                            content.characterId,
                            if (recommender.isNotBlank()) "是 $recommender 推荐我来的" else null,
                            content.recommenderCharacterId,
                        ),
                    )
                },
            ) {
                Text(content.name, style = MaterialTheme.typography.titleSmall)
                HorizontalDivider(color = colors.borderHairline)
                Text("个人名片", color = colors.textTertiary, style = MaterialTheme.typography.bodySmall)
            }
        }
        message.status == "normal" && content is ReceivedMessageContentActionCard -> {
            val chosen = message.actionChoice?.actionId
            // 来电询问点「可以」：顺带检查通知与全屏通知权限（media-l5.md 7.4）。
            val permissions = if (content.cardKind == "call_permission") rememberCallPermissionFlow() else null
            val choose: (String) -> Unit = { id ->
                if (id == "allow") permissions?.invoke()
                ui.choose(message, id)
            }
            Text(content.text)
            Row(horizontalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
                content.actions.forEach { action ->
                    val enabled = chosen == null && !ui.choosing
                    if (action.style == "primary") {
                        Button(enabled = enabled, onClick = { choose(action.actionId) }) {
                            Text(if (chosen == action.actionId) "✓ ${action.label}" else action.label)
                        }
                    } else {
                        OutlinedButton(enabled = enabled, onClick = { choose(action.actionId) }) {
                            Text(if (chosen == action.actionId) "✓ ${action.label}" else action.label)
                        }
                    }
                }
            }
        }
        message.status == "normal" && content is ReceivedMessageContentVoice -> VoiceMessage(ui, message, content)
        message.status == "normal" && content is ReceivedMessageContentLink -> LinkCardMessage(ui.repository, ui.owner, content)
        message.status == "normal" && content is ReceivedMessageContentCallRecord -> CallRecordMessage(content)
        message.status == "normal" && content is ReceivedMessageContentText -> LinkifiedText(content.text)
        else -> Text(messageText(message))
    }
}
