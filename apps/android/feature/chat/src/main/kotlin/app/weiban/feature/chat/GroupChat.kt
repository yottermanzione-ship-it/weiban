package app.weiban.feature.chat

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.weiban.contracts.*
import app.weiban.data.*
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.tokens.WbSize
import app.weiban.designsystem.tokens.WbSpace
import app.weiban.network.ApiFailure
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.*
import java.util.UUID

/** P-21：9 个角色 + 用户。 */
internal const val GROUP_LIMIT = 9
private const val GROUP_TITLE_LIMIT = 16
private const val WAIT_FOR_SYNC_MS = 5_000L

internal fun Conversation.isGroup(): Boolean = type == "group"

internal fun Conversation.characterMembers(): List<Participant> = participants.filter { it.kind == "character" }

internal fun groupError(error: ApiFailure): String =
    when (error.code) {
        "limit_reached" -> "群里最多 $GROUP_LIMIT 个角色"
        "adult_mode_not_eligible", "romance_not_allowed" -> "群里有成员不能使用这个模式"
        "not_conversation_member" -> "你已不在该群聊中"
        else -> "操作暂未完成，请稍后再试"
    }

/** Runs a group operation with the shared error mapping. */
internal suspend fun groupAction(
    onError: (String) -> Unit,
    action: suspend () -> Unit,
) {
    userAction(onError) {
        try {
            action()
        } catch (error: ApiFailure) {
            onError(groupError(error))
        }
    }
}

/** Waits until the sync engine has stored a newly created conversation, so opening it does not bounce back to the list. */
internal suspend fun awaitConversation(
    runtime: ChatRuntime,
    owner: OwnerRecord,
    conversationId: String,
) {
    runtime.refresh(owner)
    withTimeoutOrNull(WAIT_FOR_SYNC_MS) {
        runtime.snapshot.first { snapshot -> snapshot.state.conversations.any { it.conversationId == conversationId } }
    }
}

/**
 * 选择角色页（group-chat.md 第 3 节）：locked 为已在群里 / 必须包含的角色（实心灰勾、不可取消）。
 * 已选总数（含 locked）不超过 [GROUP_LIMIT]。
 */
@Composable internal fun CharacterPicker(
    repository: SessionRepository,
    owner: OwnerRecord,
    state: ClientSyncState,
    title: String,
    locked: Set<String>,
    minimumTotal: Int,
    pending: Boolean,
    onBack: () -> Unit,
    onDone: (List<String>) -> Unit,
) {
    BackHandler(onBack = onBack)
    val contacts = state.contacts.filter { it.status == "active" }
    val profiles = characterProfiles(repository, contacts.map { it.characterId })
    var chosen by remember { mutableStateOf<List<String>>(emptyList()) }
    val total = locked.size + chosen.size
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        TextButton(onClick = onBack, enabled = !pending) { Text("取消") }
        Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
        Button(enabled = !pending && chosen.isNotEmpty() && total >= minimumTotal, onClick = { onDone(chosen) }) {
            Text(if (chosen.isEmpty()) "完成" else "完成(${chosen.size})")
        }
    }
    if (total >= GROUP_LIMIT) Text("群里最多 $GROUP_LIMIT 个角色", Modifier.padding(horizontal = WbSpace.S5))
    LazyColumn {
        items(contacts, key = { it.characterId }) { contact ->
            val id = contact.characterId
            val isLocked = id in locked
            val checked = isLocked || id in chosen
            val enabled = !pending && !isLocked && (checked || total < GROUP_LIMIT)
            ListItem(
                headlineContent = { Text(contact.remark ?: profiles[id]?.name ?: "角色") },
                leadingContent = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = checked, enabled = enabled, onCheckedChange = {
                            chosen = if (id in chosen) chosen - id else chosen + id
                        })
                        RoleAvatar(
                            repository,
                            owner,
                            RoleAvatarIdentity(id, profiles[id]?.name.orEmpty(), profiles[id]?.avatar, contact.customAvatarMediaId),
                            WbSize.AvatarMd,
                        )
                    }
                },
                modifier =
                    Modifier.clickable(enabled = enabled) {
                        chosen = if (id in chosen) chosen - id else chosen + id
                    },
            )
        }
    }
}

/** 发起群聊（会话列表 / 私聊聊天信息页「+」）；lockedCharacterId 为私聊里的原角色。 */
@Composable internal fun GroupCreate(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    state: ClientSyncState,
    lockedCharacterId: String?,
    onBack: () -> Unit,
    onCreated: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val requestId = remember { UUID.randomUUID().toString() }
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxSize()) {
        error?.let { Text(it, Modifier.padding(WbSpace.S5), color = MaterialTheme.colorScheme.error) }
        CharacterPicker(
            repository,
            owner,
            state,
            "选择角色",
            setOfNotNull(lockedCharacterId),
            minimumTotal = 2,
            pending = pending,
            onBack = onBack,
        ) { chosen ->
            pending = true
            error = null
            scope.launch {
                groupAction({ error = it }) {
                    val conversation =
                        repository.call(
                            Endpoints.chatGroupEndpointsCreateGroup,
                            body =
                                buildJsonObject {
                                    put("clientRequestId", requestId)
                                    put("characterIds", JsonArray((listOfNotNull(lockedCharacterId) + chosen).map(::JsonPrimitive)))
                                },
                            options = SessionCallOptions(owner = owner),
                        )
                    awaitConversation(runtime, owner, conversation.conversationId)
                    onCreated(conversation.conversationId)
                }
                pending = false
            }
        }
    }
}

/** 群头像：最多 4 个成员头像拼成的宫格（C 2.2）。 */
@Composable internal fun GroupAvatar(
    repository: SessionRepository,
    owner: OwnerRecord,
    state: ClientSyncState,
    conversation: Conversation,
    profiles: Map<String, CharacterProfile>,
    size: androidx.compose.ui.unit.Dp = 48.dp,
) {
    val members = conversation.characterMembers().take(4)
    val cell = size / 2
    Column(Modifier.size(size)) {
        members.chunked(2).forEach { row ->
            Row {
                row.forEach { member ->
                    val profile = profiles[member.refId]
                    RoleAvatar(
                        repository,
                        owner,
                        RoleAvatarIdentity(
                            member.refId,
                            profile?.name.orEmpty(),
                            profile?.avatar,
                            state.contacts.find { it.characterId == member.refId }?.customAvatarMediaId,
                        ),
                        cell,
                    )
                }
            }
        }
    }
}

/** 群名未改时按成员名拼接（SOC-03 第 2 条）。 */
internal fun defaultGroupTitle(
    state: ClientSyncState,
    conversation: Conversation,
    names: Map<String, String>,
): String =
    conversation
        .characterMembers()
        .map { member -> state.contacts.find { it.characterId == member.refId }?.remark ?: names[member.refId] ?: "角色" }
        .joinToString("、")
        .take(40)

/** 通讯录 › 群聊（social-l4.md 2.1）。 */
@Composable internal fun GroupList(
    repository: SessionRepository,
    owner: OwnerRecord,
    state: ClientSyncState,
    onBack: () -> Unit,
    onOpen: (String) -> Unit,
) {
    BackHandler(onBack = onBack)
    val colors = LocalWeibanColors.current
    val groups =
        state.conversations
            .filter { it.isGroup() && !it.state.hidden }
            .sortedByDescending { it.lastMessage?.createdAt ?: it.updatedAt }
    val profiles = characterProfiles(repository, groups.flatMap { group -> group.characterMembers().map { it.refId } })
    val names = profiles.mapValues { it.value.name }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        TextButton(onClick = onBack) { Text("‹ 返回") }
        Text("群聊", style = MaterialTheme.typography.titleMedium)
    }
    if (groups.isEmpty()) {
        Text("还没有群聊 · 在会话列表可以发起群聊", Modifier.padding(WbSpace.S5), color = colors.textSecondary)
        return
    }
    LazyColumn {
        items(groups, key = { it.conversationId }) { group ->
            ListItem(
                headlineContent = { Text("${title(state, group, names)}（${group.characterMembers().size + 1}）") },
                leadingContent = { GroupAvatar(repository, owner, state, group, profiles) },
                modifier = Modifier.clickable { onOpen(group.conversationId) },
            )
            HorizontalDivider(color = colors.borderHairline)
        }
        item {
            Text("${groups.size} 个群聊", Modifier.fillMaxWidth().padding(WbSpace.S5), color = colors.textTertiary)
        }
    }
}

/** 群聊信息页（SOC-03 第 3 条；group-chat.md、social-l4.md 2.3～2.6）。 */
@Composable internal fun GroupInformation(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    state: ClientSyncState,
    conversation: Conversation,
    onBack: () -> Unit,
    onProfile: (String) -> Unit,
    onDissolved: () -> Unit,
) {
    var sub by remember(conversation.conversationId) { mutableStateOf("main") }
    val scope = rememberCoroutineScope()
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val act: (suspend () -> Unit) -> Unit = { work ->
        if (!pending) {
            pending = true
            error = null
            scope.launch {
                groupAction({ error = it }) { work() }
                pending = false
            }
        }
    }
    val members = conversation.characterMembers()
    when (sub) {
        "add" -> {
            CharacterPicker(
                repository,
                owner,
                state,
                "添加成员",
                members.map { it.refId }.toSet(),
                minimumTotal = 1,
                pending = pending,
                onBack = { sub = "main" },
            ) { chosen ->
                act {
                    repository.call(
                        Endpoints.chatGroupEndpointsAddMembers,
                        params = mapOf("conversationId" to conversation.conversationId),
                        body = buildJsonObject { put("characterIds", JsonArray(chosen.map(::JsonPrimitive))) },
                        options = SessionCallOptions(owner = owner),
                    )
                    runtime.refresh(owner)
                    sub = "main"
                }
            }
            return
        }
        "rename" -> {
            GroupRename(repository, runtime, owner, state, conversation) { sub = "main" }
            return
        }
        "search" -> {
            GroupSearch(repository, owner, conversation) { sub = "main" }
            return
        }
    }
    BackHandler(onBack = onBack)
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(WbSpace.S5),
        verticalArrangement = Arrangement.spacedBy(WbSpace.S3),
    ) {
        TextButton(onClick = onBack, enabled = !pending) { Text("‹ 返回群聊") }
        Text("聊天信息（${members.size + 1}）", style = MaterialTheme.typography.headlineSmall)
        if (conversation.state.hidden) {
            Text("这个群聊已解散")
            return@Column
        }
        GroupMembers(repository, owner, state, conversation, pending, onProfile, onAdd = { sub = "add" }) { characterId ->
            act {
                repository.call(
                    Endpoints.chatGroupEndpointsRemoveMember,
                    params = mapOf("conversationId" to conversation.conversationId, "characterId" to characterId),
                    options = SessionCallOptions(owner = owner),
                )
                runtime.refresh(owner)
            }
        }
        val names = characterNames(repository, members.map { it.refId })
        GroupRow("群聊名称", title(state, conversation, names)) { sub = "rename" }
        GroupRow("查找聊天记录", "") { sub = "search" }
        GroupToggle("消息免打扰", conversation.state.muted, !pending) { value ->
            act { updateGroupState(repository, owner, conversation.conversationId, buildJsonObject { put("muted", value) }) }
        }
        GroupToggle("置顶聊天", conversation.state.pinned, !pending) { value ->
            act { updateGroupState(repository, owner, conversation.conversationId, buildJsonObject { put("pinned", value) }) }
        }
        GroupCompanion(repository, owner, conversation, pending, act)
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        GroupDanger(runtime, owner, repository, conversation, pending, act, onDissolved)
    }
}

private suspend fun updateGroupState(
    repository: SessionRepository,
    owner: OwnerRecord,
    conversationId: String,
    body: JsonObject,
) {
    repository.call(
        Endpoints.chatEndpointsUpdateState,
        params = mapOf("conversationId" to conversationId),
        body = body,
        options = SessionCallOptions(owner = owner),
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun GroupMembers(
    repository: SessionRepository,
    owner: OwnerRecord,
    state: ClientSyncState,
    conversation: Conversation,
    pending: Boolean,
    onProfile: (String) -> Unit,
    onAdd: () -> Unit,
    onRemove: (String) -> Unit,
) {
    val colors = LocalWeibanColors.current
    val members = conversation.characterMembers()
    val profiles = characterProfiles(repository, members.map { it.refId })
    var removing by remember { mutableStateOf(false) }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(WbSpace.S4), verticalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
        members.forEach { member ->
            val profile = profiles[member.refId]
            val contact = state.contacts.find { it.characterId == member.refId }
            Column(
                Modifier.width(WbSize.AvatarXl).clickable(enabled = !pending) {
                    if (removing) onRemove(member.refId) else onProfile(member.refId)
                },
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                RoleAvatar(
                    repository,
                    owner,
                    RoleAvatarIdentity(member.refId, profile?.name.orEmpty(), profile?.avatar, contact?.customAvatarMediaId),
                    WbSize.AvatarLg,
                )
                Text(
                    (if (removing) "移出 " else "") + (contact?.remark ?: profile?.name ?: "角色"),
                    maxLines = 1,
                    style = MaterialTheme.typography.bodySmall,
                    color = if (removing) colors.textDanger else colors.textPrimary,
                )
            }
        }
        OutlinedButton(onClick = onAdd, enabled = !pending && members.size < GROUP_LIMIT) { Text("+") }
        OutlinedButton(onClick = { removing = !removing }, enabled = !pending && (removing || members.size > 1)) {
            Text(if (removing) "完成" else "−")
        }
    }
    if (members.size <= 1) {
        Text(
            "群里至少要有 1 个角色，不想要这个群可以「删除并退出」",
            color = colors.textSecondary,
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

@Composable private fun GroupCompanion(
    repository: SessionRepository,
    owner: OwnerRecord,
    conversation: Conversation,
    pending: Boolean,
    act: (suspend () -> Unit) -> Unit,
) {
    val id = conversation.conversationId
    val settings =
        remote("${owner.sessionId}:group-companion:$id") {
            repository.call(
                Endpoints.groupCompanionEndpointsGetSettings,
                params = mapOf("conversationId" to id),
                options = SessionCallOptions(owner = owner),
            )
        }
    val modes =
        remote("${owner.sessionId}:group-modes:$id:${conversation.characterMembers().size}") {
            repository.call(
                Endpoints.groupCompanionEndpointsListModes,
                params = mapOf("conversationId" to id),
                options = SessionCallOptions(owner = owner),
            )
        }
    val update: (JsonObject) -> Unit = { body ->
        act {
            repository.call(
                Endpoints.groupCompanionEndpointsUpdateSettings,
                params = mapOf("conversationId" to id),
                body = body,
                options = SessionCallOptions(owner = owner),
            )
            settings.refresh()
        }
    }
    val current = settings.data ?: return
    Text("微伴", style = MaterialTheme.typography.titleSmall)
    Text("情景模式")
    Row(horizontalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
        modes.data?.items?.forEach { mode ->
            FilterChip(
                selected = current.scenarioMode == mode.id,
                enabled = !pending,
                onClick = { if (current.scenarioMode != mode.id) update(buildJsonObject { put("scenarioMode", mode.id) }) },
                label = { Text(mode.name) },
            )
        }
    }
    GroupToggle("角色自己聊天", current.selfChatEnabled, !pending) { value -> update(buildJsonObject { put("selfChatEnabled", value) }) }
    GroupToggle("秒回", current.instantReply, !pending) { value -> update(buildJsonObject { put("instantReply", value) }) }
}

@Composable private fun GroupDanger(
    runtime: ChatRuntime,
    owner: OwnerRecord,
    repository: SessionRepository,
    conversation: Conversation,
    pending: Boolean,
    act: (suspend () -> Unit) -> Unit,
    onDissolved: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    var confirm by remember { mutableStateOf<String?>(null) }
    TextButton(onClick = { confirm = "clear" }, enabled = !pending) { Text("清空聊天记录", color = colors.textDanger) }
    TextButton(onClick = { confirm = "dissolve" }, enabled = !pending) { Text("删除并退出", color = colors.textDanger) }
    confirm?.let { mode ->
        AlertDialog(
            onDismissRequest = { if (!pending) confirm = null },
            title = { Text(if (mode == "clear") "清空聊天记录？" else "删除并退出？") },
            text = {
                Text(
                    if (mode == "clear") {
                        "只清空聊天记录显示，角色的记忆会保留"
                    } else {
                        "退出后这个群聊会解散，聊天记录也会删除"
                    },
                )
            },
            confirmButton = {
                TextButton(enabled = !pending, onClick = {
                    act {
                        if (mode == "clear") {
                            runtime.history.clear(owner, conversation.conversationId)
                        } else {
                            repository.call(
                                Endpoints.chatGroupEndpointsDissolveGroup,
                                params = mapOf("conversationId" to conversation.conversationId),
                                options = SessionCallOptions(owner = owner),
                            )
                            runtime.refresh(owner)
                            onDissolved()
                        }
                        confirm = null
                    }
                }) { Text("确认", color = colors.textDanger) }
            },
            dismissButton = { TextButton(enabled = !pending, onClick = { confirm = null }) { Text("取消") } },
        )
    }
}

@Composable private fun GroupRename(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    state: ClientSyncState,
    conversation: Conversation,
    onBack: () -> Unit,
) {
    BackHandler(onBack = onBack)
    val scope = rememberCoroutineScope()
    val names = characterNames(repository, conversation.characterMembers().map { it.refId })
    val original = conversation.title.orEmpty()
    var value by remember { mutableStateOf(if (conversation.group?.titleCustomized == true) original else "") }
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val fallback = defaultGroupTitle(state, conversation, names)
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        TextButton(onClick = onBack, enabled = !pending) { Text("‹") }
        Text("群聊名称", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
        Button(enabled = !pending && value.trim() != original, onClick = {
            pending = true
            scope.launch {
                groupAction({ error = it }) {
                    // 清空 = 恢复成员名拼接（接口要求非空，提交拼接名）。
                    val next = value.trim().ifEmpty { fallback }
                    repository.call(
                        Endpoints.chatGroupEndpointsRenameGroup,
                        params = mapOf("conversationId" to conversation.conversationId),
                        body = buildJsonObject { put("title", next) },
                        options = SessionCallOptions(owner = owner),
                    )
                    runtime.refresh(owner)
                    onBack()
                }
                pending = false
            }
        }) { Text("完成") }
    }
    OutlinedTextField(
        value,
        { value = it.take(GROUP_TITLE_LIMIT) },
        Modifier.fillMaxWidth().padding(WbSpace.S5),
        placeholder = { Text(fallback) },
        singleLine = true,
    )
    error?.let { Text(it, Modifier.padding(horizontal = WbSpace.S5), color = MaterialTheme.colorScheme.error) }
}

@Composable private fun GroupSearch(
    repository: SessionRepository,
    owner: OwnerRecord,
    conversation: Conversation,
    onBack: () -> Unit,
) {
    BackHandler(onBack = onBack)
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    var query by remember { mutableStateOf("") }
    var hits by remember { mutableStateOf<List<MessageSearchHit>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        TextButton(onClick = onBack) { Text("‹") }
        OutlinedTextField(query, { query = it.take(50) }, Modifier.weight(1f), singleLine = true, label = { Text("搜索") })
        TextButton(enabled = query.isNotBlank(), onClick = {
            scope.launch {
                userAction({ error = it }) {
                    hits =
                        repository
                            .call(
                                Endpoints.chatSearchEndpointsSearchConversation,
                                params = mapOf("conversationId" to conversation.conversationId),
                                query = mapOf("q" to query.trim()),
                                options = SessionCallOptions(owner = owner, networkOnly = true),
                            ).items
                }
            }
        }) { Text("搜索") }
    }
    error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    hits?.let { list ->
        if (list.isEmpty()) Text("没有找到相关聊天记录", Modifier.padding(WbSpace.S5), color = colors.textSecondary)
        LazyColumn {
            items(list, key = { it.messageId }) { hit ->
                ListItem(
                    headlineContent = { Text(hit.snippet) },
                    supportingContent = { Text(hit.createdAt.take(16).replace('T', ' '), color = colors.textTertiary) },
                    modifier = Modifier.clickable(onClick = onBack),
                )
            }
        }
    }
}

@Composable internal fun GroupRow(
    label: String,
    value: String,
    onClick: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    Row(
        Modifier.fillMaxWidth().heightIn(min = WbSize.SettingRow).clickable(onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, Modifier.weight(1f))
        Text("$value ›", color = colors.textSecondary, maxLines = 1)
    }
}

@Composable private fun GroupToggle(
    label: String,
    checked: Boolean,
    enabled: Boolean,
    onChange: (Boolean) -> Unit,
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = onChange, enabled = enabled)
    }
}
