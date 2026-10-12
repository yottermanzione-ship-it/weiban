package app.weiban.feature.chat

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import app.weiban.contracts.*
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.tokens.WbSpace

@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun MessageRow(
    ui: ConversationUi,
    avatars: MessageAvatars,
    message: Message,
) {
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
            // 信件卡片 → 读信；每日一问卡片 → 历史里这一题（PLAY-03、PLAY-05）。
            is ReceivedMessageContentLetter -> { -> PlayNav.stack.value = listOf(PlayPage.LetterRead(content.letterId)) }
            is ReceivedMessageContentDailyQuestion -> { -> PlayNav.stack.value = listOf(PlayPage.DailyHistory(content.answerId)) }
            is ReceivedMessageContentCallRecord -> {
                {
                    if (dial != null && peer != null) {
                        dial(
                            peer.refId,
                            avatars.roles[peer.participantId]
                                ?.name
                                .orEmpty()
                                .ifEmpty { "角色" },
                        )
                    } else {
                        menu = true
                    }
                }
            }
            else -> { -> menu = true }
        }
    val selectable = message.status == "normal" && message.senderKind != "system"
    val press =
        if (ui.selecting) {
            Modifier.combinedClickable(onLongClick = {}, onClick = { if (selectable) ui.toggleSelected(message.messageId) })
        } else {
            Modifier.combinedClickable(onLongClick = { menu = true }, onClick = primary)
        }
    val flash = if (ui.highlightSeq == message.seq) Modifier.background(LocalWeibanColors.current.brandSoft) else Modifier
    Row(flash.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        if (ui.selecting) {
            Checkbox(
                checked = message.messageId in ui.selected,
                enabled = selectable,
                onCheckedChange = { ui.toggleSelected(message.messageId) },
            )
        }
        MessageRowContent(ui, avatars, message, mine, group, press, openSender, Modifier.weight(1f))
    }
    MessageActions(ui, message, menu) { menu = false }
}

@Suppress("LongParameterList") // Split from MessageRow so the selection checkbox can sit beside the row.
@Composable
private fun MessageRowContent(
    ui: ConversationUi,
    avatars: MessageAvatars,
    message: Message,
    mine: Boolean,
    group: Boolean,
    press: Modifier,
    openSender: () -> Unit,
    modifier: Modifier,
) {
    val repository = ui.repository
    val owner = ui.owner
    val conversation = ui.conversation
    val avatar = avatars.sender(message)
    val content = message.content.takeIf { message.status == "normal" }
    Column(modifier.fillMaxWidth().padding(vertical = WbSpace.S3), horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
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
            val recommender =
                avatars.roles.values
                    .find { it.id == content.recommenderCharacterId }
                    ?.name
                    .orEmpty()
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
                // 角色提议一起领养：「去看看」进领养流程，角色已预选（T-082、pet.md 第 2 节）。
                if (content.cardKind == "pet_proposal" && id == "go") {
                    val target =
                        content.ref?.id ?: ui.conversation.participants
                            .find { it.kind == "character" }
                            ?.refId
                    L6Overlays.pets.value = PetsOpen(target, adopt = true)
                }
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
        message.status == "normal" && content is ReceivedMessageContentSystem && content.code == "pet_adopted" -> {
            val characterId =
                ui.conversation.participants
                    .find { it.kind == "character" }
                    ?.refId
            Text(
                messageText(message),
                Modifier.clickable { L6Overlays.pets.value = PetsOpen(characterId) },
                color = colors.textLink,
            )
        }
        message.status == "normal" && content is ReceivedMessageContentSystem && content.code == "card_obtained" -> {
            // 「获得 XX 卡 ›」：点开卡片详情（M-13 动画在详情里播放）。
            val cardId = (content.params["cardId"] as? kotlinx.serialization.json.JsonPrimitive)?.content
            val characterId =
                ui.conversation.participants
                    .find { it.kind == "character" }
                    ?.refId
            Text(
                messageText(message),
                Modifier.clickable(enabled = cardId != null && characterId != null) {
                    if (cardId != null && characterId != null) L6Overlays.openCard(characterId, cardId)
                },
                color = colors.textLink,
            )
        }
        message.status == "normal" && content is ReceivedMessageContentLetter -> {
            Column(Modifier.widthIn(max = 260.dp)) {
                Text(if (content.direction == "from_character") "一封来信" else "一封信", style = MaterialTheme.typography.titleSmall)
                HorizontalDivider(color = colors.borderHairline)
                Text(content.body, maxLines = 3, fontFamily = androidx.compose.ui.text.font.FontFamily.Serif)
                Text("[信件] 点开阅读", color = colors.textTertiary, style = MaterialTheme.typography.bodySmall)
            }
        }
        message.status == "normal" && content is ReceivedMessageContentDailyQuestion -> {
            Column(Modifier.widthIn(max = 260.dp)) {
                Text("每日一问", color = colors.textTertiary, style = MaterialTheme.typography.bodySmall)
                Text(content.question, style = MaterialTheme.typography.titleSmall)
                HorizontalDivider(color = colors.borderHairline)
                Text(content.answer)
            }
        }
        else -> Text(messageText(message))
    }
}
