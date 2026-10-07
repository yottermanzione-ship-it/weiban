package app.weiban.feature.chat

import androidx.compose.material3.*
import androidx.compose.runtime.*
import app.weiban.contracts.*
import app.weiban.data.SessionCallOptions
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
