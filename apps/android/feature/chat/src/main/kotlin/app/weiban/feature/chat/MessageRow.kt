package app.weiban.feature.chat

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import app.weiban.contracts.Message
import app.weiban.designsystem.tokens.WbSpace

@Composable internal fun MessageRow(
    ui: ConversationUi,
    avatars: MessageAvatars,
    message: Message,
) {
    val repository = ui.repository
    val owner = ui.owner
    val conversation = ui.conversation
    var menu by remember { mutableStateOf(false) }
    val mine = message.senderKind == "user"
    val avatar = avatars.sender(message)
    Column(Modifier.fillMaxWidth().padding(vertical = WbSpace.S3), horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
            verticalAlignment = Alignment.Top,
        ) {
            if (!mine && avatar != null) MessageAvatar(repository, owner, avatar)
            Spacer(Modifier.width(WbSpace.S3))
            Surface(
                color = if (mine) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainer,
                modifier =
                    Modifier.weight(1f, fill = false).clickable {
                        menu =
                            true
                    },
            ) {
                Column(Modifier.padding(WbSpace.S5)) {
                    message.quote?.let { Text(it.preview ?: "引用的消息已不可见", style = MaterialTheme.typography.bodySmall) }
                    Text(messageText(message))
                }
            }
            Spacer(Modifier.width(WbSpace.S3))
            if (mine && avatar != null) MessageAvatar(repository, owner, avatar)
        }
        if (mine && conversation.peerReadSeq?.let { it >= message.seq } == true) Text("已读", style = MaterialTheme.typography.bodySmall)
        MessageActions(ui, message, menu) { menu = false }
    }
}
