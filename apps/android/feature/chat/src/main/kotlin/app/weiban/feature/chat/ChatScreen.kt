package app.weiban.feature.chat

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.unit.dp
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
    openConversationId: String? = null,
    onModelsRequested: () -> Unit = {},
    onConversationChanged: (String?) -> Unit = {},
) {
    val snapshot by runtime.snapshot.collectAsState()
    val state = if (snapshot.owner == owner) snapshot.state else SyncEngine.freshState()
    val online by runtime.online.collectAsState()
    val error by runtime.error.collectAsState()
    var conversationId by rememberSaveable(owner.sessionId) { mutableStateOf<String?>(null) }
    LaunchedEffect(openConversationId) {
        if (openConversationId != null) {
            conversationId = openConversationId
        }
    }
    var information by rememberSaveable(conversationId) { mutableStateOf(false) }
    var timelineRequest by rememberSaveable(conversationId) { mutableStateOf(false) }
    val composerDraft = rememberSaveable(owner.sessionId, conversationId) { mutableStateOf("") }
    // "": 从会话列表发起；characterId：从私聊聊天信息页发起（原角色锁定）。
    var creating by rememberSaveable(owner.sessionId) { mutableStateOf<String?>(null) }
    var profile by remember(owner.sessionId) { mutableStateOf<ProfileTarget?>(null) }
    val changed by rememberUpdatedState(onConversationChanged)
    val select: (String?) -> Unit = { id ->
        conversationId = id
        changed(id)
    }
    var searching by rememberSaveable(owner.sessionId) { mutableStateOf(false) }
    // 会话列表上的二级页：plaza（⊕ › 添加角色）/ coming:<key>（暂未开放）。
    var listPage by rememberSaveable(owner.sessionId) { mutableStateOf<String?>(null) }
    var newRole by remember { mutableStateOf(false) }
    BackHandler(conversationId != null) { if (information) information = false else select(null) }
    // 搜索结果 / 收藏定位：打开对应会话，聊天页里再滚到那条消息（CHAT-12）。
    val locate by MessageLocator.target.collectAsState()
    LaunchedEffect(locate?.nonce) {
        val target = locate ?: return@LaunchedEffect
        if (state.conversations.none { it.conversationId == target.conversationId } && state.initialized) {
            MessageLocator.consume(target)
            return@LaunchedEffect
        }
        searching = false
        profile = null
        creating = null
        information = false
        select(target.conversationId)
    }
    val activeConversationId = conversationId
    val selected = state.conversations.find { it.conversationId == activeConversationId }
    LaunchedEffect(state.initialized, activeConversationId, selected?.conversationId) {
        if (state.initialized && activeConversationId != null && selected == null) select(null)
    }
    if (newRole) NewRoleSheet(owner) { newRole = false }
    Column(Modifier.fillMaxSize()) {
        if (!online) Text(error ?: "正在连接…", Modifier.padding(WbSpace.S5), style = MaterialTheme.typography.bodySmall)
        val target = profile
        val creatingFrom = creating
        when {
            target != null -> {
                BackHandler { profile = null }
                TextButton(onClick = { profile = null }) { Text("‹ 返回") }
                CharacterScreen(
                    repository,
                    runtime,
                    owner,
                    state,
                    target.characterId,
                    {
                        profile = null
                        information = false
                        select(it)
                    },
                    referral = target,
                    onTimelineAsk = { cid, text ->
                        profile = null
                        composerDraft.value = text
                        select(cid)
                    },
                    onOpenCharacter = { id -> profile = ProfileTarget(id) },
                )
            }
            creatingFrom != null ->
                GroupCreate(repository, runtime, owner, state, creatingFrom.ifEmpty { null }, { creating = null }) { id ->
                    creating = null
                    information = false
                    select(id)
                }
            selected == null && searching ->
                GlobalSearchScreen(repository, owner, state, { searching = false }) { id ->
                    searching = false
                    select(id)
                }
            selected == null && listPage == "plaza" ->
                RolePlazaPage(repository, runtime, owner, { listPage = null }) { id ->
                    listPage = null
                    select(id)
                }
            selected == null && listPage != null ->
                app.weiban.designsystem.ComingSoonPage(listPage.orEmpty().removePrefix("coming:")) { listPage = null }
            selected == null ->
                ConversationList(
                    repository,
                    owner,
                    state,
                    select,
                    ListActions(
                        search = { searching = true },
                        createGroup = { creating = "" },
                        addRole = { listPage = "plaza" },
                        newRole = { newRole = true },
                        importRole = { MiniAppNavigation.open(MiniApp.Import.id) },
                        comingSoon = { listPage = "coming:$it" },
                    ),
                )
            information && selected.isGroup() ->
                GroupInformation(
                    repository,
                    runtime,
                    owner,
                    state,
                    selected,
                    { information = false },
                    { profile = ProfileTarget(it, groupGreeting(state, selected)) },
                ) { select(null) }
            information ->
                ChatInformation(
                    repository,
                    runtime,
                    owner,
                    state,
                    selected,
                    InformationNavigation(
                        {
                            information = false
                            timelineRequest = false
                        },
                        onModelsRequested,
                        createGroup = {
                            creating =
                                selected
                                    .characterMembers()
                                    .firstOrNull()
                                    ?.refId
                                    .orEmpty()
                        },
                    ),
                    { select(null) },
                    onAsk = { text ->
                        information = false
                        timelineRequest = false
                        composerDraft.value = text
                    },
                    onOpenProfile = { id ->
                        information = false
                        timelineRequest = false
                        profile = ProfileTarget(id)
                    },
                    startOnTimeline = timelineRequest,
                    onTimelineOpened = { timelineRequest = false },
                )
            else ->
                ConversationView(
                    repository,
                    runtime,
                    owner,
                    state,
                    selected,
                    composerDraft,
                    { information = true },
                    { profile = it },
                    { select(null) },
                    onOpenTimeline = {
                        timelineRequest = true
                        information = true
                    },
                )
        }
    }
}

/** 会话列表的入口动作（⊕ 菜单、搜索）。 */
internal class ListActions(
    val search: () -> Unit,
    val createGroup: () -> Unit,
    val addRole: () -> Unit,
    val newRole: () -> Unit,
    val importRole: () -> Unit,
    val comingSoon: (String) -> Unit,
)

/** 会话列表（02a 第 1 节）：标题「微伴（未读）」+ 右上 ⊕ 菜单；搜索；长按会话 → 置顶 / 标为未读 / 消息免打扰 / 不显示该聊天。 */
@Composable private fun ConversationList(
    repository: SessionRepository,
    owner: OwnerRecord,
    state: ClientSyncState,
    onSelect: (String) -> Unit,
    actions: ListActions,
) {
    val colors = app.weiban.designsystem.LocalWeibanColors.current
    val profiles =
        characterProfiles(
            repository,
            state.contacts.map { it.characterId } + state.conversations.flatMap { c -> c.characterMembers().map { it.refId } },
        )
    val names = profiles.mapValues { it.value.name }
    val conversations =
        state.conversations
            .filter { !it.state.hidden }
            .sortedWith(
                compareByDescending<Conversation> { it.state.pinned }.thenByDescending { it.lastMessage?.createdAt ?: it.updatedAt },
            )
    val unread = conversations.filter { !it.state.muted }.sumOf { it.unreadCount }
    var menu by remember { mutableStateOf(false) }
    var pressed by remember { mutableStateOf<Conversation?>(null) }
    val scope = rememberCoroutineScope()
    var error by remember { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxSize().background(colors.bgPage)) {
        app.weiban.designsystem.WbNavBar(if (unread > 0) "微伴（$unread）" else "微伴") {
            Box {
                app.weiban.designsystem.NavAction("⊕") { menu = true }
                app.weiban.designsystem.PopMenu(
                    menu,
                    { menu = false },
                    listOf(
                        "发起群聊" to actions.createGroup,
                        "添加角色" to actions.addRole,
                        "新建角色" to actions.newRole,
                        "导入角色" to actions.importRole,
                        "扫一扫" to { actions.comingSoon("scan") },
                        "收付款" to { actions.comingSoon("pay") },
                    ),
                )
            }
        }
        // 全局搜索入口（CHAT-12）：角色、群聊、聊天记录。
        Text(
            "⌕ 搜索",
            Modifier
                .fillMaxWidth()
                .padding(horizontal = WbSpace.S3, vertical = WbSpace.S2)
                .background(
                    colors.bgSurface,
                    androidx.compose.foundation.shape
                        .RoundedCornerShape(app.weiban.designsystem.tokens.WbRadius.Sm),
                ).clickable(onClick = actions.search)
                .padding(WbSpace.S3),
            color = colors.textPlaceholder,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
        error?.let { Text(it, Modifier.padding(horizontal = WbSpace.S5), color = MaterialTheme.colorScheme.error) }
        if (conversations.isEmpty()) {
            val emptyText = if (state.initialized) "添加喜欢的角色后，聊天会出现在这里" else "正在同步聊天…"
            Text(emptyText, Modifier.padding(WbSpace.S5), color = colors.textSecondary)
        }
        PullToMiniApps(repository, owner) {
            ConversationRows(repository, owner, state, conversations, profiles, names, onSelect) { pressed = it }
        }
    }
    pressed?.let { conversation ->
        val change: (suspend () -> Unit) -> Unit = { work ->
            pressed = null
            error = null
            scope.launch { userAction({ error = it }) { work() } }
        }
        val update: (String, Boolean) -> Unit = { field, value ->
            change {
                repository.call(
                    Endpoints.chatEndpointsUpdateState,
                    params = mapOf("conversationId" to conversation.conversationId),
                    body = buildJsonObject { put(field, value) },
                    options = SessionCallOptions(owner = owner),
                )
            }
        }
        AlertDialog(
            onDismissRequest = { pressed = null },
            title = { Text(title(state, conversation, names)) },
            text = {
                Column {
                    TextButton(onClick = { update("pinned", !conversation.state.pinned) }) {
                        Text(if (conversation.state.pinned) "取消置顶" else "置顶该聊天")
                    }
                    TextButton(onClick = {
                        change {
                            repository.call(
                                Endpoints.chatEndpointsMarkUnread,
                                params = mapOf("conversationId" to conversation.conversationId),
                                options = SessionCallOptions(owner = owner),
                            )
                        }
                    }) { Text("标为未读") }
                    TextButton(onClick = { update("muted", !conversation.state.muted) }) {
                        Text(if (conversation.state.muted) "开启新消息提醒" else "消息免打扰")
                    }
                    TextButton(onClick = { update("hidden", true) }) { Text("不显示该聊天") }
                }
            },
            confirmButton = { TextButton(onClick = { pressed = null }) { Text("取消") } },
        )
    }
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun ConversationRows(
    repository: SessionRepository,
    owner: OwnerRecord,
    state: ClientSyncState,
    conversations: List<Conversation>,
    profiles: Map<String, CharacterProfile>,
    names: Map<String, String>,
    onSelect: (String) -> Unit,
    onLongPress: (Conversation) -> Unit,
) {
    val colors = app.weiban.designsystem.LocalWeibanColors.current
    val mode = app.weiban.designsystem.LocalWeibanModeColors.current
    LazyColumn {
        items(conversations, key = { it.conversationId }) { conversation ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(if (conversation.state.pinned) colors.bgSurfacePinned else colors.bgSurface)
                    .combinedClickable(
                        onClick = { onSelect(conversation.conversationId) },
                        onLongClick = { onLongPress(conversation) },
                    ).padding(horizontal = WbSpace.S5, vertical = WbSpace.S4),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(WbSpace.S4),
            ) {
                BadgedBox(badge = {
                    when {
                        conversation.unreadCount > 0 && conversation.state.muted -> Badge(containerColor = mode.badgeUnread)
                        conversation.unreadCount > 0 ->
                            Badge(containerColor = mode.badgeUnread) { Text(conversation.unreadCount.coerceAtMost(99).toString()) }
                        conversation.state.markedUnread -> Badge(containerColor = mode.badgeUnread)
                    }
                }) {
                    ConversationAvatar(repository, owner, state, conversation, profiles)
                }
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            title(state, conversation, names),
                            Modifier.weight(1f),
                            maxLines = 1,
                            style = MaterialTheme.typography.bodyLarge,
                        )
                        Text(
                            conversation.lastMessage
                                ?.createdAt
                                ?.let(::listTime)
                                .orEmpty(),
                            color = colors.textTertiary,
                            style = MaterialTheme.typography.labelSmall,
                        )
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            conversation.lastMessage?.text ?: "开始聊天",
                            Modifier.weight(1f),
                            maxLines = 1,
                            color = colors.textSecondary,
                            style = MaterialTheme.typography.bodySmall,
                        )
                        if (conversation.state.muted) Text("🔕", style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
            HorizontalDivider(Modifier.padding(start = 72.dp), color = colors.borderHairline)
        }
    }
}

/** 会话列表时间：今天显示时分，其余显示月/日。 */
private fun listTime(timestamp: String): String {
    val instant = runCatching { java.time.Instant.parse(timestamp) }.getOrNull() ?: return ""
    val zone = java.time.ZoneId.systemDefault()
    val date = instant.atZone(zone)
    return if (date.toLocalDate() == java.time.LocalDate.now(zone)) {
        "%02d:%02d".format(java.util.Locale.ROOT, date.hour, date.minute)
    } else {
        "${date.monthValue}/${date.dayOfMonth}"
    }
}

@Composable private fun ConversationAvatar(
    repository: SessionRepository,
    owner: OwnerRecord,
    state: ClientSyncState,
    conversation: Conversation,
    profiles: Map<String, CharacterProfile>,
) {
    if (conversation.isGroup()) {
        GroupAvatar(repository, owner, state, conversation, profiles)
        return
    }
    val id = conversation.participants.find { it.kind == "character" }?.refId
    val profile = profiles[id]
    RoleAvatar(
        repository,
        owner,
        RoleAvatarIdentity(
            id ?: conversation.conversationId,
            profile?.name.orEmpty(),
            profile?.avatar,
            state.contacts.find { it.characterId == id }?.customAvatarMediaId,
        ),
    )
}

internal fun title(
    state: ClientSyncState,
    conversation: Conversation,
    names: Map<String, String> = emptyMap(),
): String {
    if (conversation.isGroup()) return conversation.title ?: defaultGroupTitle(state, conversation, names)
    val characterId = conversation.participants.find { it.kind == "character" }?.refId
    return conversation.title ?: state.contacts.find { it.characterId == characterId }?.remark ?: names[characterId] ?: "角色"
}

internal fun messageText(message: Message): String =
    if (message.status == "recalled") {
        "这条消息已撤回"
    } else {
        when (val content = message.content) {
            is ReceivedMessageContentText -> content.text
            is ReceivedMessageContentNudge -> "拍了拍"
            is ReceivedMessageContentSystem -> systemMessage(content)
            is ReceivedMessageContentContactCard -> "[名片] ${content.name}"
            is ReceivedMessageContentActionCard -> content.text
            is ReceivedMessageContentImage -> "[图片]"
            is ReceivedMessageContentSticker -> "[表情]"
            is ReceivedMessageContentVoice -> "[语音] ${((content.durationMs + 500) / 1000).coerceIn(1, 60)}″"
            is ReceivedMessageContentLink -> "[链接] ${content.title}"
            is ReceivedMessageContentCallRecord -> "[语音通话] ${callRecordText(content)}"
            else -> "当前版本不支持此消息"
        }
    }

@Suppress("CyclomaticComplexMethod") // 首次本机构建（2026-10-11）：保留既有逻辑，复杂度待重构
private fun systemMessage(content: ReceivedMessageContentSystem): String {
    fun p(key: String) = (content.params[key] as? JsonPrimitive)?.contentOrNull.orEmpty()
    val by = p("byName")
    return when (content.code) {
        "contact_accepted" -> "已通过好友申请，现在可以开始聊天了"
        "scenario_mode_changed" -> scenarioModeMessage(content)
        "scenario_mode_switched" ->
            if (p("reason") == "member_not_eligible") "有新成员加入，群聊已回到日常聊天" else scenarioModeMessage(content)
        "group_created" -> "你邀请 ${p("names")} 加入了群聊"
        "group_invited_by_character" -> "${p("name")} 邀请你和 ${p("names")} 加入了群聊"
        "member_joined" -> if (by.isNotEmpty()) "$by 邀请 ${p("names")} 加入了群聊" else "你邀请 ${p("names")} 加入了群聊"
        "member_removed" -> "你将 ${p("name")} 移出了群聊"
        "member_left" -> "${p("name")} 退出了群聊"
        "group_renamed" ->
            if (p("reset") == "true") {
                (if (by.isNotEmpty()) "$by " else "你") + "恢复了默认群名"
            } else {
                (if (by.isNotEmpty()) "$by " else "你") + "修改群名为「${p("title")}」"
            }
        "group_dissolved" -> "群聊已解散"
        "focus_started" -> "你和 ${p("characterName").ifEmpty { "TA" }} 开始了 ${p("minutes")} 分钟专注"
        "letter_sent" -> "你给 ${p("characterName").ifEmpty { "TA" }} 寄出了一封信"
        "wishlist_item_completed" -> "心愿「${p("title")}」已完成" + if (p("cardIssued") == "true") " · 获得心愿卡" else ""
        "card_obtained" -> cardObtainedMessage(::p)
        "pet_adopted" -> "你和 ${p("characterName").ifEmpty { "TA" }} 一起领养了 ${p("petName")} · 去看看 ›"
        "pet_renamed" -> "${p("from")} 改名为 ${p("to")}"
        "familiarity_level_up" -> "你和 ${p("characterName").ifEmpty { "TA" }} 的熟悉度升到了 L${p("level")} ${p("levelName")}"
        else -> "会话提示"
    }
}

/** 获得卡片的系统提示（GRW-05；cards-familiarity.md 第 2、4 节）。 */
private fun cardObtainedMessage(p: (String) -> String): String {
    val serial = p("serialNo").toLongOrNull()?.let { " " + serialText(it) } ?: ""
    return when (p("kind")) {
        "anniversary" ->
            p("daysKnown").takeIf { it.isNotEmpty() }?.let { "今天是你们认识的第 $it 天 · 获得纪念卡$serial ›" } ?: "获得纪念卡$serial ›"
        "familiarity" -> "获得熟悉度卡$serial ›"
        "holiday" -> (p("holidayName").takeIf { it.isNotEmpty() }?.let { "${it}快乐 · " } ?: "") + "获得节日卡$serial ›"
        else -> "获得瞬间卡「${p("title")}」 ›"
    }
}

private fun scenarioModeMessage(content: ReceivedMessageContentSystem): String {
    if ((content.params["reason"] as? JsonPrimitive)?.contentOrNull == "adult_mode_unavailable") {
        return "私密预设已不可用，已回到日常聊天"
    }
    val mode = (content.params["mode"] as? JsonPrimitive)?.contentOrNull
    return "已切换到 " + (presetNames[mode] ?: "日常聊天")
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

@Composable private fun ColumnScope.ConversationView(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    state: ClientSyncState,
    conversation: Conversation,
    composerDraft: MutableState<String>,
    onInformation: () -> Unit,
    onProfile: (ProfileTarget) -> Unit,
    onBack: () -> Unit,
    onOpenTimeline: () -> Unit = {},
) {
    val scope = rememberCoroutineScope()
    val context = androidx.compose.ui.platform.LocalContext.current
    val ui =
        remember(conversation.conversationId, owner) {
            ConversationUi(repository, runtime, owner, conversation, scope, composerDraft).also { it.media = ChatMediaUi(context, it) }
        }
    val group = conversation.isGroup()
    SideEffect {
        ui.conversation = conversation
        ui.openProfile = onProfile
        ui.groupGreeting = if (group) groupGreeting(state, conversation) else null
    }
    val lifecycle by LocalLifecycleOwner.current.lifecycle.currentStateFlow
        .collectAsState()
    val visible = lifecycle.isAtLeast(Lifecycle.State.RESUMED)
    val list = rememberLazyListState()
    val messages = state.messages.filter { it.conversationId == conversation.conversationId }.sortedBy { it.seq }
    val avatars = messageAvatars(repository, owner, state, conversation)
    val names = conversation.participants.associate { it.refId to avatars.roles[it.participantId]?.name.orEmpty() }
    val pending = state.outbox.filter { it.conversationId == conversation.conversationId }
    val typing by runtime.typing.collectAsState()
    val typingIds =
        typing
            .filter { (key, expiry) -> key.startsWith("${conversation.conversationId}:") && expiry > System.currentTimeMillis() }
            .keys
            .map { it.substringAfter(":") }
    val typingActive = typingIds.isNotEmpty()
    val typingText =
        if (group) {
            typingIds.mapNotNull { avatars.roles[it]?.name?.takeIf(String::isNotBlank) }.joinToString("、").ifEmpty { "有人" } + " 正在输入…"
        } else {
            "对方正在输入…"
        }
    DisposableEffect(conversation.conversationId) {
        runtime.focus(conversation.conversationId)
        onDispose { runtime.focus(null) }
    }
    ChatMediaEffects(ui, messages, visible)
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
                    options = SessionCallOptions(owner = owner),
                )
            }
        }
    }
    val presetTarget =
        remember(conversation.conversationId) {
            val characterId = conversation.participants.find { it.kind == "character" }?.refId
            if (group || characterId == null) ScenarioTarget.Group(conversation.conversationId) else ScenarioTarget.Character(characterId)
        }
    val preset = rememberCurrentPreset(repository, owner, presetTarget)
    val refreshPreset by rememberUpdatedState(preset.refresh)
    SideEffect { ui.presetMode = preset.mode }
    LaunchedEffect(presetTarget) {
        AppUpdates.updates.collect { if (it is UserUpdateDataChanged && it.data.section == "companion") refreshPreset() }
    }
    if (ui.scenarioOpen) {
        ScenarioSheet(repository, owner, presetTarget, preset.mode, { ui.scenarioOpen = false }) { refreshPreset() }
    }
    val heading = title(state, conversation, names) + if (group) "（${conversation.characterMembers().size + 1}）" else ""
    val subtitle =
        when {
            group -> null
            visible && typingActive -> typingText
            else -> presetSubtitle(preset.mode)
        }
    ChatHeader(heading, subtitle, onBack, onInformation) { ui.scenarioOpen = true }
    val whileAway =
        rememberWhileAway(
            repository,
            owner,
            conversation.conversationId,
            conversation.participants
                .find { it.kind == "character" }
                ?.refId
                .takeIf { !group },
            messages.lastOrNull()?.messageId,
        )
    WhileAwayCard(whileAway, onOpenTimeline = onOpenTimeline) { ui.text = it }
    ui.error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = WbSpace.S5)) }
    if (group && visible && typingActive) Text(typingText, Modifier.padding(horizontal = WbSpace.S5))
    MessageTimeline(ui, messages, pending, list, Modifier.weight(1f), avatars)
    LocateEffects(ui, messages, list)
    if (ui.selecting) {
        SelectionBar(ui, messages)
    } else {
        Composer(ui, messages.find { it.messageId == ui.quoteId && it.status == "normal" }, avatars)
    }
}

/** 定位到搜索 / 收藏指向的消息：先把附近的消息加载到本地，再滚到距顶部约 1/3 处并闪一下（CHAT-12）。 */
@Composable private fun LocateEffects(
    ui: ConversationUi,
    messages: List<Message>,
    list: androidx.compose.foundation.lazy.LazyListState,
) {
    val target by MessageLocator.target.collectAsState()
    val latest by rememberUpdatedState(messages)
    LaunchedEffect(target?.nonce) {
        val locate = target?.takeIf { it.conversationId == ui.conversation.conversationId } ?: return@LaunchedEffect
        MessageLocator.consume(locate)
        ui.endSelection()
        userAction({ ui.error = it }) {
            ui.runtime.history.reveal(ui.owner, locate.conversationId, locate.seq, latest.firstOrNull()?.seq)
        }
        ui.highlightSeq = locate.seq
    }
    val highlight = ui.highlightSeq
    LaunchedEffect(highlight, messages.size) {
        val seq = highlight ?: return@LaunchedEffect
        // 等进入页面时「滚到底部」先完成，再滚到目标。
        delay(LOCATE_SETTLE_MS)
        val index = latest.indexOfFirst { it.seq >= seq }
        if (index >= 0) list.scrollToItem(index + 1, -list.layoutInfo.viewportSize.height / 3)
        delay(LOCATE_FLASH_MS)
        if (ui.highlightSeq == seq) ui.highlightSeq = null
    }
}

private const val LOCATE_SETTLE_MS = 150L
private const val LOCATE_FLASH_MS = 1_500L

/** 多选底栏（CHAT-11、EXP-01）：收藏、分享图；分享图不可用时写明原因，不静默丢掉。 */
@Composable private fun SelectionBar(
    ui: ConversationUi,
    messages: List<Message>,
) {
    BackHandler(onBack = ui::endSelection)
    val colors = app.weiban.designsystem.LocalWeibanColors.current
    val chosen = messages.filter { it.messageId in ui.selected }
    val reason = shareBlockReason(chosen)
    Column(Modifier.fillMaxWidth().imePadding().padding(WbSpace.S3)) {
        if (chosen.isNotEmpty() && reason != null) {
            Text(reason, color = colors.textSecondary, style = MaterialTheme.typography.bodySmall)
        }
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(WbSpace.S3),
        ) {
            TextButton(onClick = ui::endSelection) { Text("取消") }
            Text("已选 ${chosen.size} 条", Modifier.weight(1f))
            OutlinedButton(enabled = chosen.size in 1..SHARE_MAX_ITEMS, onClick = { ui.favoriteSelected(messages) }) { Text("收藏") }
            Button(enabled = chosen.isNotEmpty() && reason == null, onClick = {
                L6Overlays.shareMessages(ui.conversation.conversationId, chosen.sortedBy { it.seq }.map { it.messageId })
                ui.endSelection()
            }) { Text("分享图") }
        }
    }
}

@Composable private fun MessageTimeline(
    ui: ConversationUi,
    messages: List<Message>,
    pending: List<ClientPendingSend>,
    list: androidx.compose.foundation.lazy.LazyListState,
    modifier: Modifier,
    avatars: MessageAvatars,
) {
    LazyColumn(state = list, modifier = modifier.fillMaxWidth(), contentPadding = PaddingValues(WbSpace.S5)) {
        item(key = "older") {
            TextButton(
                enabled = !ui.loadingHistory && messages.firstOrNull()?.seq?.let { it > 1 } == true,
                onClick = { ui.older(messages.first().seq) },
            ) { Text(if (ui.loadingHistory) "正在加载…" else "更早的消息") }
        }
        items(messages, key = { it.messageId }) { message ->
            MessageRow(ui, avatars, message)
        }
        items(pending, key = { it.body.clientMsgId }) { item ->
            Row(
                Modifier.fillMaxWidth().padding(vertical = WbSpace.S3),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.Top,
            ) {
                Column(Modifier.weight(1f, fill = false), horizontalAlignment = Alignment.End) {
                    PendingContent(ui, item.body.content)
                    Text(if (item.state == "failed") "发送失败" else "待发送", style = MaterialTheme.typography.bodySmall)
                    if (item.state == "failed") TextButton(onClick = { ui.retry(item.body.clientMsgId) }) { Text("重试") }
                }
                Spacer(Modifier.width(WbSpace.S3))
                MessageAvatar(ui.repository, ui.owner, avatars.user)
            }
        }
        items(ui.media.sends, key = { "local:" + it.id }) { item -> LocalSendRow(ui, item, avatars) }
    }
    ui.media.viewing?.let { start ->
        ImageViewer(ui, viewerItems(messages), start) { ui.media.viewing = null }
    }
}

/** 进入 / 离开聊天页：语音连播顺序、已播放红点、转写结果；离开或切到后台停止播放（media-l5.md 3.2）。 */
@Composable private fun ChatMediaEffects(
    ui: ConversationUi,
    messages: List<Message>,
    visible: Boolean,
) {
    val latest by rememberUpdatedState(messages)
    SideEffect {
        ui.media.player.nextOf = { id ->
            val index = latest.indexOfFirst { it.messageId == id }
            if (index >= 0) latest.getOrNull(index + 1) else null
        }
    }
    val voiceIds = messages.filter { it.content is ReceivedMessageContentVoice && it.senderKind != "user" }.map { it.messageId }
    LaunchedEffect(voiceIds) { ui.media.player.loadPlayed(voiceIds) }
    LaunchedEffect(ui) { ui.media.watchTranscripts { latest } }
    LaunchedEffect(ui) {
        // 来电 / 通话开始：停止播放。
        AppUpdates.updates.collect { if (it is UserUpdateCallUpdated) ui.media.player.stop() }
    }
    LaunchedEffect(visible) { if (!visible) ui.media.player.stop() }
    DisposableEffect(ui) { onDispose { ui.media.release() } }
}

@Composable private fun Composer(
    ui: ConversationUi,
    quote: Message?,
    avatars: MessageAvatars,
) {
    val members = if (ui.conversation.isGroup()) ui.conversation.characterMembers() else emptyList()
    var picking by remember { mutableStateOf(false) }
    if (picking) {
        MentionPicker(members, avatars, { picking = false }) { participant, name ->
            ui.mention(name, participant)
            picking = false
        }
    }
    quote?.let { quoted ->
        Row {
            Text("引用：${messageText(quoted).take(60)}", Modifier.weight(1f).padding(WbSpace.S5))
            TextButton({ ui.quoteId = null }) { Text("取消") }
        }
    }
    val media = ui.media
    val focus = LocalFocusManager.current
    Row(Modifier.imePadding().padding(WbSpace.S3), verticalAlignment = Alignment.CenterVertically) {
        // 语音 / 键盘切换（C 5.1）。
        TextButton(onClick = {
            media.voiceMode = !media.voiceMode
            media.panel = 0
            if (media.voiceMode) focus.clearFocus()
        }) { Text(if (media.voiceMode) "键盘" else "语音") }
        Box(Modifier.weight(1f)) {
            if (media.voiceMode) {
                HoldToTalk(
                    enabled = true,
                    onStart = { media.player.stop() },
                    onVoice = media::sendVoice,
                    onNotice = media::toast,
                )
            } else {
                OutlinedTextField(ui.text, { next ->
                    if (next.length <= 4_000) {
                        val typedAt = next.length == ui.text.length + 1 && next.endsWith("@")
                        ui.text = next
                        if (typedAt && members.isNotEmpty()) {
                            if (members.size == 1) {
                                val only = members.first()
                                ui.mention(avatars.roles[only.participantId]?.name?.ifBlank { null } ?: "角色", only.participantId)
                            } else {
                                picking = true
                            }
                        }
                    }
                }, Modifier.fillMaxWidth(), label = { Text("消息") }, maxLines = 5)
            }
        }
        TextButton(onClick = {
            media.panel = if (media.panel == 1) 0 else 1
            media.voiceMode = false
            focus.clearFocus()
        }) { Text("表情") }
        if (!media.voiceMode && ui.text.isNotBlank()) {
            TextButton(enabled = !ui.sending, onClick = ui::send) { Text("发送") }
        } else {
            TextButton(onClick = {
                media.panel = if (media.panel == 2) 0 else 2
                focus.clearFocus()
            }) { Text("＋") }
        }
    }
    BackHandler(media.panel != 0) { media.panel = 0 }
    when (media.panel) {
        1 -> StickerPanel(ui)
        2 -> PlusPanel(ui)
    }
}

/** @ 选人弹层（social-l4.md 2.2）：不含用户自己；关闭不插入时「@」保留为普通文字。 */
@Composable private fun MentionPicker(
    members: List<Participant>,
    avatars: MessageAvatars,
    onDismiss: () -> Unit,
    onPick: (String, String) -> Unit,
) {
    var query by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("选择提醒的人") },
        text = {
            Column {
                OutlinedTextField(query, { query = it.take(20) }, singleLine = true, label = { Text("搜索") })
                members
                    .map { it to (avatars.roles[it.participantId]?.name?.ifBlank { null } ?: "角色") }
                    .filter { (_, name) -> query.isBlank() || name.contains(query, true) }
                    .forEach { (member, name) ->
                        TextButton(onClick = { onPick(member.participantId, name) }) { Text(name) }
                    }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

/** 群里点头像打开资料页时，打招呼默认「我们在『群名』群里见过」（SOC-06 第 3 条）。 */
internal fun groupGreeting(
    state: ClientSyncState,
    conversation: Conversation,
): String = "我们在『${title(state, conversation)}』群里见过".take(50)

/** 聊天标题栏（02a 1.1）：‹ 返回 · 标题 + 副标题（正在输入… > 当前情景预设，点副标题打开情景预设）· ··· 聊天信息。 */
@Composable private fun ChatHeader(
    heading: String,
    subtitle: String?,
    onBack: () -> Unit,
    onInformation: () -> Unit,
    onPreset: () -> Unit,
) {
    val colors = app.weiban.designsystem.LocalWeibanColors.current
    Box(Modifier.fillMaxWidth().heightIn(min = 52.dp).background(colors.bgNavBar)) {
        Text(
            "‹",
            Modifier.align(Alignment.CenterStart).clickable(onClick = onBack).padding(horizontal = WbSpace.S5, vertical = WbSpace.S2),
            style = MaterialTheme.typography.headlineMedium,
        )
        Column(Modifier.align(Alignment.Center).padding(horizontal = 72.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(heading, style = MaterialTheme.typography.titleMedium, maxLines = 1)
            subtitle?.let {
                Text(
                    it,
                    Modifier.clickable(onClick = onPreset),
                    color = colors.textSecondary,
                    style = MaterialTheme.typography.labelSmall,
                )
            }
        }
        Text(
            "···",
            Modifier.align(Alignment.CenterEnd).clickable(onClick = onInformation).padding(horizontal = WbSpace.S5, vertical = WbSpace.S3),
            style = MaterialTheme.typography.titleLarge,
        )
    }
}
