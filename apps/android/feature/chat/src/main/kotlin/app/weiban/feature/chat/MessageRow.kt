package app.weiban.feature.chat

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import app.weiban.contracts.Message
import app.weiban.contracts.ReceivedMessageContentActionCard
import app.weiban.contracts.ReceivedMessageContentContactCard
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.tokens.WbSpace

@Composable internal fun MessageRow(
    ui: ConversationUi,
    avatars: MessageAvatars,
    message: Message,
) {
    val repository = ui.repository
    val owner = ui.owner
    val conversation = ui.conversation
    val group = conversation.isGroup()
    var menu by remember { mutableStateOf(false) }
    val mine = message.senderKind == "user"
    val avatar = avatars.sender(message)
    val openSender = {
        if (avatar != null && !avatar.user) ui.openProfile(ProfileTarget(avatar.id, ui.groupGreeting))
    }
    Column(Modifier.fillMaxWidth().padding(vertical = WbSpace.S3), horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
            verticalAlignment = Alignment.Top,
        ) {
            if (!mine && avatar != null) Box(Modifier.clickable(onClick = openSender)) { MessageAvatar(repository, owner, avatar) }
            Spacer(Modifier.width(WbSpace.S3))
            Column(Modifier.weight(1f, fill = false)) {
                // 群聊显示发送者名字（SOC-04）；私聊不显示。
                if (group && !mine && avatar != null) {
                    Text(avatar.name, style = MaterialTheme.typography.bodySmall, color = LocalWeibanColors.current.textSecondary)
                }
                Surface(
                    color = if (mine) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainer,
                    modifier = Modifier.clickable { menu = true },
                ) {
                    Column(Modifier.padding(WbSpace.S5)) {
                        message.quote?.let { Text(it.preview ?: "引用的消息已不可见", style = MaterialTheme.typography.bodySmall) }
                        MessageBody(ui, avatars, message)
                    }
                }
            }
            Spacer(Modifier.width(WbSpace.S3))
            if (mine && avatar != null) MessageAvatar(repository, owner, avatar)
        }
        if (mine && conversation.peerReadSeq?.let { it >= message.seq } == true) Text("已读", style = MaterialTheme.typography.bodySmall)
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
            Text(content.text)
            Row(horizontalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
                content.actions.forEach { action ->
                    val enabled = chosen == null && !ui.choosing
                    if (action.style == "primary") {
                        Button(enabled = enabled, onClick = { ui.choose(message, action.actionId) }) {
                            Text(if (chosen == action.actionId) "✓ ${action.label}" else action.label)
                        }
                    } else {
                        OutlinedButton(enabled = enabled, onClick = { ui.choose(message, action.actionId) }) {
                            Text(if (chosen == action.actionId) "✓ ${action.label}" else action.label)
                        }
                    }
                }
            }
        }
        else -> Text(messageText(message))
    }
}
