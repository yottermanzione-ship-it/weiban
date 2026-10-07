package app.weiban.feature.chat

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import app.weiban.contracts.*
import app.weiban.data.*
import app.weiban.designsystem.tokens.WbSpace
import kotlinx.coroutines.*
import kotlinx.serialization.json.*

@Composable fun ChatScreen(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    onQueued: () -> Unit,
) {
    val snapshot by runtime.snapshot.collectAsState()
    val state = if (snapshot.owner == owner) snapshot.state else SyncEngine.freshState()
    val online by runtime.online.collectAsState()
    val error by runtime.error.collectAsState()
    var conversationId by rememberSaveable(owner.sessionId) { mutableStateOf<String?>(null) }
    val selected = state.conversations.find { it.conversationId == conversationId }
    Column(Modifier.fillMaxSize()) {
        if (!online) Text(error ?: "正在连接…", Modifier.padding(WbSpace.S5), style = MaterialTheme.typography.bodySmall)
        if (selected == null) {
            ConversationList(state) { conversationId = it }
        } else {
            ConversationView(repository, runtime, owner, state, selected, onQueued) { conversationId = null }
        }
    }
}

@Composable private fun ConversationList(
    state: ClientSyncState,
    onSelect: (String) -> Unit,
) {
    var search by rememberSaveable { mutableStateOf("") }
    Text("微伴", Modifier.padding(WbSpace.S5), style = MaterialTheme.typography.headlineSmall)
    OutlinedTextField(
        search,
        { search = it },
        Modifier.fillMaxWidth().padding(horizontal = WbSpace.S5),
        label = { Text("搜索会话与消息") },
    )
    val conversations =
        state.conversations
            .filter { !it.state.hidden }
            .sortedWith(
                compareByDescending<Conversation> { it.state.pinned }.thenByDescending { it.lastMessage?.createdAt ?: it.updatedAt },
            ).filter {
                search.isBlank() || title(state, it).contains(search, true) ||
                    it.lastMessage
                        ?.text
                        .orEmpty()
                        .contains(search, true)
            }
    if (conversations.isEmpty()) {
        val emptyText = if (state.initialized) "添加喜欢的角色后，聊天会出现在这里" else "正在同步聊天…"
        Text(emptyText, Modifier.padding(WbSpace.S5))
    }
    LazyColumn {
        items(conversations, key = { it.conversationId }) { conversation ->
            ListItem(
                headlineContent = { Text(title(state, conversation)) },
                supportingContent = { Text(conversation.lastMessage?.text ?: "开始聊天", maxLines = 1) },
                trailingContent = {
                    Text(
                        if (conversation.unreadCount >
                            0
                        ) {
                            conversation.unreadCount.toString()
                        } else if (conversation.state.muted) {
                            "免打扰"
                        } else {
                            ""
                        },
                    )
                },
                modifier = Modifier.clickable { onSelect(conversation.conversationId) },
            )
            HorizontalDivider()
        }
    }
}

internal fun title(
    state: ClientSyncState,
    conversation: Conversation,
): String {
    val characterId = conversation.participants.find { it.kind == "character" }?.refId
    return conversation.title ?: state.contacts.find { it.characterId == characterId }?.remark ?: "角色"
}

internal fun messageText(message: Message): String =
    if (message.status == "recalled") {
        "这条消息已撤回"
    } else {
        when (val content = message.content) {
            is ReceivedMessageContentText -> content.text
            is ReceivedMessageContentNudge -> "拍了拍"
            is ReceivedMessageContentSystem ->
                if (content.code == "contact_accepted") "已通过好友申请，现在可以开始聊天了" else "会话提示"
            else -> "当前版本不支持此消息"
        }
    }

@Suppress("TooGenericExceptionCaught") // UI operation boundary reports failures and preserves cancellation.
internal suspend fun userAction(onError: (String) -> Unit, action: suspend () -> Unit) {
    try {
        action()
    } catch (error: CancellationException) {
        throw error
    } catch (_: Exception) {
        onError("操作暂未完成，请稍后再试")
    }
}

private class ConversationUi(
    val repository: SessionRepository,
    val runtime: ChatRuntime,
    val owner: OwnerRecord,
    var conversation: Conversation,
    private val scope: CoroutineScope,
    private val onQueued: () -> Unit,
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
                    onQueued()
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
                userAction({ error = it }) { runtime.older(owner, conversation.conversationId, beforeSeq) }
            } finally {
                loadingHistory = false
            }
        }
    }

    fun retry(clientMsgId: String) {
        scope.launch {
            userAction({ error = it }) {
                runtime.retry(owner, conversation.conversationId, clientMsgId)
                onQueued()
            }
        }
    }
}

@Composable private fun ColumnScope.ConversationView(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    state: ClientSyncState,
    conversation: Conversation,
    onQueued: () -> Unit,
    onBack: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val ui = remember(conversation.conversationId, owner) { ConversationUi(repository, runtime, owner, conversation, scope, onQueued) }
    SideEffect { ui.conversation = conversation }
    val lifecycle by LocalLifecycleOwner.current.lifecycle.currentStateFlow
        .collectAsState()
    val visible = lifecycle.isAtLeast(Lifecycle.State.RESUMED)
    val list = rememberLazyListState()
    val messages = state.messages.filter { it.conversationId == conversation.conversationId }.sortedBy { it.seq }
    val pending = state.outbox.filter { it.conversationId == conversation.conversationId }
    LaunchedEffect(conversation.conversationId) { runtime.inspect(owner, conversation.conversationId) }
    val atBottom = !list.canScrollForward
    LaunchedEffect(messages.lastOrNull()?.messageId, pending.size) {
        if (atBottom && messages.size + pending.size > 0) list.scrollToItem(messages.size + pending.size)
    }
    LaunchedEffect(atBottom, messages.lastOrNull()?.seq, visible) {
        val seq = messages.lastOrNull()?.seq?.takeIf { it > conversation.state.readSeq }
        if (visible && atBottom && seq != null) {
            userAction({ ui.error = it }) {
                repository.call(
                    Endpoints.chatEndpointsMarkRead,
                    params = mapOf("conversationId" to conversation.conversationId),
                    body = buildJsonObject { put("readSeq", seq) },
                )
            }
        }
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        TextButton(onBack) { Text("返回") }
        Text(title(state, conversation), Modifier.padding(WbSpace.S5), style = MaterialTheme.typography.titleMedium)
    }
    ui.error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = WbSpace.S5)) }
    MessageTimeline(ui, messages, pending, list, Modifier.weight(1f))
    Composer(ui, messages.find { it.messageId == ui.quoteId && it.status == "normal" })
}

@Composable private fun MessageTimeline(
    ui: ConversationUi,
    messages: List<Message>,
    pending: List<ClientPendingSend>,
    list: androidx.compose.foundation.lazy.LazyListState,
    modifier: Modifier,
) {
    LazyColumn(state = list, modifier = modifier.fillMaxWidth(), contentPadding = PaddingValues(WbSpace.S5)) {
        item(key = "older") {
            TextButton(
                enabled = !ui.loadingHistory && messages.firstOrNull()?.seq?.let { it > 1 } == true,
                onClick = { ui.older(messages.first().seq) },
            ) { Text(if (ui.loadingHistory) "正在加载…" else "更早的消息") }
        }
        items(messages, key = { it.messageId }) { message ->
            MessageRow(ui.repository, ui.conversation, message, { ui.quoteId = message.messageId }, { ui.error = it })
        }
        items(pending, key = { it.body.clientMsgId }) { item ->
            Column(Modifier.fillMaxWidth().padding(vertical = WbSpace.S3)) {
                Text((item.body.content as? UserSendableContentText)?.text ?: "拍了拍")
                Text(if (item.state == "failed") "发送失败" else "待发送", style = MaterialTheme.typography.bodySmall)
                if (item.state == "failed") TextButton(onClick = { ui.retry(item.body.clientMsgId) }) { Text("重试") }
            }
        }
    }
}

@Composable private fun Composer(
    ui: ConversationUi,
    quote: Message?,
) {
    quote?.let { quoted ->
        Row {
            Text("引用：${messageText(quoted).take(60)}", Modifier.weight(1f).padding(WbSpace.S5))
            TextButton({ ui.quoteId = null }) { Text("取消") }
        }
    }
    Row(Modifier.imePadding().padding(WbSpace.S5)) {
        OutlinedTextField(ui.text, { if (it.length <= 4_000) ui.text = it }, Modifier.weight(1f), label = { Text("消息") }, maxLines = 5)
        TextButton(enabled = ui.text.isNotBlank() && !ui.sending, onClick = ui::send) { Text("发送") }
    }
}

@Composable private fun MessageRow(
    repository: SessionRepository,
    conversation: Conversation,
    message: Message,
    onQuote: () -> Unit,
    onError: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var menu by remember { mutableStateOf(false) }
    val mine = message.senderKind == "user"
    Column(Modifier.fillMaxWidth().padding(vertical = WbSpace.S3)) {
        Surface(
            color = if (mine) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainer,
            modifier =
                Modifier.clickable {
                    menu =
                        true
                },
        ) {
            Column(Modifier.padding(WbSpace.S5)) {
                message.quote?.let { Text(it.preview ?: "引用的消息已不可见", style = MaterialTheme.typography.bodySmall) }
                Text(messageText(message))
            }
        }
        if (mine && conversation.peerReadSeq?.let { it >= message.seq } == true) Text("已读", style = MaterialTheme.typography.bodySmall)
        DropdownMenu(menu, { menu = false }) {
            if (message.status != "recalled") {
                DropdownMenuItem(text = { Text("引用") }, onClick = {
                    menu = false
                    onQuote()
                })
            }
            if (mine && message.status != "recalled") {
                DropdownMenuItem(text = { Text("撤回") }, onClick = {
                    menu = false
                    scope.launch {
                        userAction(onError) {
                            repository.call(
                                Endpoints.chatEndpointsRecallMessage,
                                params = mapOf("conversationId" to conversation.conversationId, "messageId" to message.messageId),
                            )
                        }
                    }
                })
            }
            DropdownMenuItem(text = { Text("从我的界面删除") }, onClick = {
                menu = false
                scope.launch {
                    userAction(onError) {
                        repository.call(
                            Endpoints.chatEndpointsHideMessage,
                            params = mapOf("conversationId" to conversation.conversationId, "messageId" to message.messageId),
                        )
                    }
                }
            })
        }
    }
}
