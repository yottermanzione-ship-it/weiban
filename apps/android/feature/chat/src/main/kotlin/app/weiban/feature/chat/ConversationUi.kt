package app.weiban.feature.chat

import androidx.compose.runtime.*
import app.weiban.contracts.*
import app.weiban.data.*
import kotlinx.coroutines.*

internal class ConversationUi(
    val repository: SessionRepository,
    val runtime: ChatRuntime,
    val owner: OwnerRecord,
    var conversation: Conversation,
    private val scope: CoroutineScope,
) {
    var text by mutableStateOf("")
    var quoteId by mutableStateOf<String?>(null)
    var error by mutableStateOf<String?>(null)
    var sending by mutableStateOf(false)
    var loadingHistory by mutableStateOf(false)

    fun send() {
        if (sending || text.isBlank()) return
        sending = true
        val captured = text
        val quotedId =
            runtime.snapshot.value.state.messages
                .find { it.messageId == quoteId && it.status == "normal" }
                ?.messageId
        scope.launch {
            try {
                userAction({ error = it }) {
                    runtime.send(owner, conversation.conversationId, captured, quotedId)
                    if (text == captured) text = ""
                    quoteId = null
                }
            } finally {
                sending = false
            }
        }
    }

    fun older(beforeSeq: Long) {
        loadingHistory = true
        scope.launch {
            try {
                userAction({ error = it }) { runtime.history.older(owner, conversation.conversationId, beforeSeq) }
            } finally {
                loadingHistory = false
            }
        }
    }

    fun retry(clientMsgId: String) {
        scope.launch {
            userAction({ error = it }) {
                runtime.retry(owner, conversation.conversationId, clientMsgId)
            }
        }
    }
}
