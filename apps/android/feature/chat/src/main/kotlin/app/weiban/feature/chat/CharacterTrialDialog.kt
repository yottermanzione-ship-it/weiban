package app.weiban.feature.chat

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import app.weiban.contracts.*
import app.weiban.data.*
import app.weiban.designsystem.tokens.WbSpace
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import java.util.UUID

@Composable internal fun CharacterTrialDialog(
    repository: SessionRepository,
    owner: OwnerRecord,
    conversationId: String,
    name: String,
    onClose: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var messages by remember(conversationId) { mutableStateOf<List<Message>>(emptyList()) }
    var text by remember(conversationId) { mutableStateOf("") }
    var pending by remember { mutableStateOf(false) }
    var closing by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var retry by remember { mutableStateOf<Pair<String, String>?>(null) }
    val options = SessionCallOptions(owner = owner, networkOnly = true)
    DisposableEffect(owner, conversationId) {
        onDispose {
            val cleanup = CoroutineScope(SupervisorJob() + Dispatchers.IO)
            cleanup.launch {
                try {
                    repository.call(
                        Endpoints.userCustomEndpointsEndTrial,
                        params = mapOf("conversationId" to conversationId),
                        options = options,
                    )
                } catch (_: Exception) {
                    // The bounded server expiry also clears trials when the app cannot reach it.
                } finally {
                    cleanup.cancel()
                }
            }
        }
    }
    LaunchedEffect(owner, conversationId) {
        while (isActive) {
            userAction({ error = it }) {
                messages =
                    repository
                        .call(
                            Endpoints.chatEndpointsListMessages,
                            params = mapOf("conversationId" to conversationId),
                            query =
                                mapOf("limit" to "200"),
                            options = options,
                        ).items
            }
            delay(1000)
        }
    }

    fun close() {
        if (closing) return
        closing = true
        error = null
        scope.launch {
            try {
                userAction({ error = it }) {
                    repository.call(
                        Endpoints.userCustomEndpointsEndTrial,
                        params = mapOf("conversationId" to conversationId),
                        options = options,
                    )
                    onClose()
                }
            } finally {
                closing = false
            }
        }
    }
    Dialog(onDismissRequest = ::close, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize()) {
            Column(
                Modifier
                    .fillMaxSize()
                    .statusBarsPadding()
                    .navigationBarsPadding()
                    .imePadding()
                    .padding(WbSpace.S5),
                verticalArrangement = Arrangement.spacedBy(WbSpace.S3),
            ) {
                Text("和$name 试聊", style = MaterialTheme.typography.headlineSmall)
                Text("关闭后不保留这次试聊；返回编辑器可继续修改或保存角色。")
                LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
                    items(messages, key = { it.messageId }) { message ->
                        Text(
                            "${if (message.senderKind == "user") "我" else name}：${if (message.status == "recalled") {
                                "这条消息已撤回"
                            } else {
                                (message.content as? ReceivedMessageContentText)
                                    ?.text
                                    .orEmpty()
                            }}",
                        )
                    }
                }
                OutlinedTextField(text, { text = it.take(4000) }, Modifier.fillMaxWidth(), label = { Text("试聊消息") }, enabled = !closing)
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                Button(enabled = !pending && !closing && text.isNotBlank(), onClick = {
                    val request = retry?.takeIf { it.first == text } ?: (text to UUID.randomUUID().toString())
                    retry = request
                    pending = true
                    error = null
                    scope.launch {
                        try {
                            userAction({ error = it }) {
                                repository.call(
                                    Endpoints.chatEndpointsSendMessage,
                                    params = mapOf("conversationId" to conversationId),
                                    body =
                                        buildJsonObject {
                                            put("clientMsgId", request.second)
                                            put(
                                                "content",
                                                buildJsonObject {
                                                    put("type", "text")
                                                    put("text", request.first)
                                                },
                                            )
                                        },
                                    options = options,
                                )
                                text = ""
                                retry = null
                            }
                        } finally {
                            pending = false
                        }
                    }
                }) { Text(if (pending) "发送中…" else "发送") }
                TextButton(enabled = !closing, onClick = ::close) { Text(if (closing) "正在结束…" else "结束试聊，返回编辑") }
            }
        }
    }
}
