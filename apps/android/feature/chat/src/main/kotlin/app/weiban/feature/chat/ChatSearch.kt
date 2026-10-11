package app.weiban.feature.chat

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import app.weiban.contracts.*
import app.weiban.data.*
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.tokens.WbSize
import app.weiban.designsystem.tokens.WbSpace
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val DEBOUNCE_MS = 300L

private fun hitTime(createdAt: String): String = createdAt.take(16).replace('T', ' ')

/**
 * 全局搜索（CHAT-12；design pages/search.md）：角色、群聊、聊天记录。300 毫秒防抖，关键词高亮。
 * 单条命中直接定位；多条命中进入该会话的命中列表。
 */
@Suppress("LongMethod", "CyclomaticComplexMethod") // One results page with three sections.
@Composable
internal fun GlobalSearchScreen(
    repository: SessionRepository,
    owner: OwnerRecord,
    state: ClientSyncState,
    onBack: () -> Unit,
    onOpenConversation: (String) -> Unit,
) {
    BackHandler(onBack = onBack)
    val colors = LocalWeibanColors.current
    var query by remember { mutableStateOf("") }
    var result by remember { mutableStateOf<GlobalSearchResult?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }
    var drill by remember { mutableStateOf<String?>(null) }
    drill?.let { conversationId ->
        ConversationSearchScreen(repository, owner, state, conversationId, query) { drill = null }
        return
    }
    LaunchedEffect(query) {
        val keyword = query.trim()
        if (keyword.isEmpty()) {
            result = null
            return@LaunchedEffect
        }
        delay(DEBOUNCE_MS)
        loading = true
        error = null
        userAction({ error = it }) {
            result =
                repository.call(
                    Endpoints.chatSearchEndpointsSearchAll,
                    query = mapOf("q" to keyword.take(50)),
                    options = SessionCallOptions(owner = owner, networkOnly = true),
                )
        }
        loading = false
    }
    val data = result
    val characterIds = data?.characterIds.orEmpty()
    val conversationIds = data?.messages?.map { it.conversationId }.orEmpty() + data?.groupConversationIds.orEmpty()
    val members = state.conversations.filter { it.conversationId in conversationIds }.flatMap { c -> c.characterMembers().map { it.refId } }
    val profiles = characterProfiles(repository, characterIds + members)
    val names = profiles.mapValues { it.value.name }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("‹") }
            OutlinedTextField(query, { query = it.take(50) }, Modifier.weight(1f), singleLine = true, label = { Text("搜索") })
            Spacer(Modifier.width(WbSpace.S3))
        }
        if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        error?.let { Text(it, Modifier.padding(WbSpace.S5), color = MaterialTheme.colorScheme.error) }
        if (data != null && characterIds.isEmpty() && data.groupConversationIds.isEmpty() && data.messages.isEmpty()) {
            Text("没有找到「${query.trim()}」相关结果", Modifier.padding(WbSpace.S5), color = colors.textSecondary)
        }
        LazyColumn(Modifier.weight(1f)) {
            if (characterIds.isNotEmpty()) item(key = "roles") { SectionTitle("角色") }
            items(characterIds, key = { "role:$it" }) { id ->
                val contact = state.contacts.find { it.characterId == id }
                val profile = profiles[id]
                val label = contact?.remark ?: profile?.name ?: "角色"
                ListItem(
                    leadingContent = {
                        RoleAvatar(
                            repository,
                            owner,
                            RoleAvatarIdentity(id, profile?.name.orEmpty(), profile?.avatar, contact?.customAvatarMediaId),
                            WbSize.AvatarMd,
                        )
                    },
                    headlineContent = { Text(highlighted(label, query)) },
                    modifier =
                        Modifier.clickable {
                            contact?.conversationId?.let(onOpenConversation)
                        },
                )
            }
            val groups = data?.groupConversationIds.orEmpty()
            if (groups.isNotEmpty()) item(key = "groups") { SectionTitle("群聊") }
            items(groups, key = { "group:$it" }) { id ->
                val conversation = state.conversations.find { it.conversationId == id }
                ListItem(
                    headlineContent = { Text(highlighted(conversation?.let { title(state, it, names) } ?: "群聊", query)) },
                    modifier = Modifier.clickable { onOpenConversation(id) },
                )
            }
            val messages = data?.messages.orEmpty()
            if (messages.isNotEmpty()) item(key = "messages") { SectionTitle("聊天记录") }
            items(messages, key = { "messages:${it.conversationId}" }) { group ->
                val conversation = state.conversations.find { it.conversationId == group.conversationId }
                ListItem(
                    headlineContent = { Text(conversation?.let { title(state, it, names) } ?: "会话") },
                    supportingContent = {
                        if (group.matchCount == 1L) {
                            Text(highlighted(group.latestHit.snippet, query), maxLines = 2)
                        } else {
                            Text("${group.matchCount} 条相关聊天记录", color = colors.textSecondary)
                        }
                    },
                    modifier =
                        Modifier.clickable {
                            if (group.matchCount == 1L) {
                                MessageLocator.request(group.conversationId, group.latestHit.seq)
                            } else {
                                drill = group.conversationId
                            }
                        },
                )
            }
        }
    }
}

@Composable private fun SectionTitle(text: String) {
    Text(
        text,
        Modifier.padding(horizontal = WbSpace.S5, vertical = WbSpace.S3),
        color = LocalWeibanColors.current.textSecondary,
        style = MaterialTheme.typography.labelLarge,
    )
}

/**
 * 会话内搜索（聊天信息页「查找聊天记录」）：按关键词翻页；日期定位与「图片 / 链接」按服务器分页查找。
 * 点开结果定位到该消息上下文。
 */
@Suppress("LongMethod") // Search field, three quick filters and one paged list.
@Composable
internal fun ConversationSearchScreen(
    repository: SessionRepository,
    owner: OwnerRecord,
    state: ClientSyncState,
    conversationId: String,
    initialQuery: String = "",
    onBack: () -> Unit,
) {
    BackHandler(onBack = onBack)
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    var query by remember { mutableStateOf(initialQuery) }
    var mode by remember { mutableStateOf("text") }
    var sender by remember { mutableStateOf<String?>(null) }
    var date by remember { mutableStateOf("") }
    val conversation = state.conversations.find { it.conversationId == conversationId }
    val participants = conversation?.participants.orEmpty() + conversation?.group?.formerParticipants.orEmpty()
    val profiles = characterProfiles(repository, participants.filter { it.kind == "character" }.map { it.refId })
    val typed = remember { mutableStateListOf<Message>() }
    var revision by remember { mutableLongStateOf(0L) }
    val hits = remember { mutableStateListOf<MessageSearchHit>() }
    var hasMore by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun load(more: Boolean) {
        val keyword = query.trim()
        val requestedMode = mode
        val requestedSender = sender
        val requestedRevision = revision

        fun current() = requestedRevision == revision && requestedMode == mode && requestedSender == sender && keyword == query.trim()
        if (requestedMode == "text" && keyword.isEmpty()) {
            hits.clear()
            hasMore = false
            loading = false
            return
        }
        loading = true
        error = null
        userAction({ if (current()) error = it }) {
            if (requestedMode != "text") {
                val page =
                    repository.call(
                        Endpoints.chatSearchEndpointsListByType,
                        params = mapOf("conversationId" to conversationId),
                        query =
                            buildMap {
                                put("contentType", requestedMode)
                                put("limit", "20")
                                if (more) typed.lastOrNull()?.let { put("beforeSeq", it.seq.toString()) }
                            },
                        options = SessionCallOptions(owner = owner, networkOnly = true),
                    )
                if (!current()) return@userAction
                if (!more) typed.clear()
                typed.addAll(page.items.filter { message -> typed.none { it.messageId == message.messageId } })
                hasMore = page.hasMore
            } else {
                val page =
                    repository.call(
                        Endpoints.chatSearchEndpointsSearchConversation,
                        params = mapOf("conversationId" to conversationId),
                        query =
                            buildMap {
                                put("q", keyword.take(50))
                                put("limit", "20")
                                requestedSender?.let { put("senderParticipantId", it) }
                                if (more) hits.lastOrNull()?.let { put("beforeSeq", it.seq.toString()) }
                            },
                        options = SessionCallOptions(owner = owner, networkOnly = true),
                    )
                if (!current()) return@userAction
                if (!more) hits.clear()
                hits.addAll(page.items.filter { hit -> hits.none { it.messageId == hit.messageId } })
                hasMore = page.hasMore
            }
        }
        if (current()) loading = false
    }
    LaunchedEffect(query, mode, sender, conversationId) {
        revision++
        hits.clear()
        typed.clear()
        hasMore = false
        error = null
        loading = true
        delay(DEBOUNCE_MS)
        load(more = false)
    }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("‹") }
            OutlinedTextField(query, {
                query = it.take(50)
                mode = "text"
            }, Modifier.weight(1f), singleLine = true, label = { Text("查找聊天记录") })
            Spacer(Modifier.width(WbSpace.S3))
        }
        Row(Modifier.padding(horizontal = WbSpace.S5), horizontalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
            FilterChip(selected = mode == "image", onClick = { mode = if (mode == "image") "text" else "image" }, label = { Text("图片") })
            FilterChip(selected = mode == "link", onClick = { mode = if (mode == "link") "text" else "link" }, label = { Text("链接") })
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = WbSpace.S5)) {
            OutlinedTextField(date, { date = it.take(10) }, Modifier.weight(1f), label = { Text("日期 YYYY-MM-DD") }, singleLine = true)
            TextButton(enabled = !loading && date.length == 10, onClick = {
                scope.launch {
                    loading = true
                    userAction({ error = it }) {
                        val located =
                            repository.call(
                                Endpoints.chatSearchEndpointsLocateByDate,
                                params = mapOf("conversationId" to conversationId),
                                query = mapOf("date" to date),
                                options = SessionCallOptions(owner = owner, networkOnly = true),
                            )
                        val seq = located.seq
                        if (seq == null) error = "该日期及之后没有聊天记录" else MessageLocator.request(conversationId, seq)
                    }
                    loading = false
                }
            }) { Text("定位") }
        }
        if (conversation?.type == "group" && mode == "text") {
            Row(
                Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = WbSpace.S5),
            ) {
                FilterChip(selected = sender == null, onClick = { sender = null }, label = { Text("全部成员") })
                participants.distinctBy { it.participantId }.forEach { member ->
                    FilterChip(
                        selected = sender == member.participantId,
                        onClick = { sender = member.participantId },
                        label = { Text(if (member.kind == "user") "我" else profiles[member.refId]?.name ?: "角色") },
                    )
                }
            }
        }
        if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        error?.let { Text(it, Modifier.padding(WbSpace.S5), color = MaterialTheme.colorScheme.error) }
        if (mode != "text") {
            if (typed.isEmpty() && !loading && error == null) Text("没有找到相关记录", Modifier.padding(WbSpace.S5), color = colors.textSecondary)
            LazyColumn(Modifier.weight(1f)) {
                items(typed, key = { it.messageId }) { message ->
                    ListItem(
                        headlineContent = { Text(contentText(message.content), maxLines = 2) },
                        supportingContent = { Text(hitTime(message.createdAt), color = colors.textTertiary) },
                        modifier = Modifier.clickable { MessageLocator.request(conversationId, message.seq) },
                    )
                }
            }
            if (hasMore) TextButton(enabled = !loading, onClick = { scope.launch { load(more = true) } }) { Text("加载更多") }
            return@Column
        }
        if (query.isNotBlank() && !loading && hits.isEmpty() && error == null) {
            Text("没有找到相关聊天记录", Modifier.padding(WbSpace.S5), color = colors.textSecondary)
        }
        LazyColumn(Modifier.weight(1f)) {
            items(hits, key = { it.messageId }) { hit ->
                ListItem(
                    headlineContent = { Text(highlighted(hit.snippet, query), maxLines = 3) },
                    supportingContent = { Text(hitTime(hit.createdAt), color = colors.textTertiary) },
                    modifier = Modifier.clickable { MessageLocator.request(conversationId, hit.seq) },
                )
            }
            if (hasMore) {
                item(key = "more") {
                    TextButton(enabled = !loading, onClick = { scope.launch { load(more = true) } }, modifier = Modifier.fillMaxWidth()) {
                        Text("加载更多")
                    }
                }
            }
        }
    }
}
