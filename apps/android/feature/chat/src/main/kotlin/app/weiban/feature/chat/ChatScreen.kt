package app.weiban.feature.chat

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.weiban.core.designsystem.R as DsR
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
        if (!online) {
            Text(
                error ?: "正在连接…",
                Modifier
                    .fillMaxWidth()
                    .background(app.weiban.designsystem.LocalWeibanModeColors.current.statusWarningSoft)
                    .padding(horizontal = 14.dp, vertical = 6.dp),
                style = app.weiban.designsystem.wbText(13.sp, color = app.weiban.designsystem.LocalWeibanModeColors.current.statusWarningText),
            )
        }
        val target = profile
        val creatingFrom = creating
        when {
            target != null -> {
                BackHandler { profile = null }
                app.weiban.designsystem.WbNavBar("详细资料", { profile = null })
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
                    runtime,
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
                        { information = false },
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
                ) { select(null) }
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
                ) { select(null) }
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
    val baseTitle = title(state, conversation, names) + if (group) "(${conversation.characterMembers().size + 1})" else ""
    // 对方输入时私聊标题直接换成「对方正在输入...」（规格 4.4.1）；群聊放在副标题。
    val heading = if (!group && visible && typingActive) "对方正在输入..." else baseTitle
    val subtitle =
        when {
            group && visible && typingActive -> typingText
            group -> null
            else -> presetSubtitle(preset.mode)
        }
    val otherUnread =
        state.conversations
            .filter { it.conversationId != conversation.conversationId && !it.state.hidden && !it.state.muted }
            .sumOf { it.unreadCount }
            .toInt()
    ChatHeader(ui, heading, subtitle, otherUnread, onBack, onInformation, messages)
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
    WhileAwayCard(whileAway) { ui.text = it }
    ui.error?.let { NoticeStrip(it) { ui.error = null } }
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

/** 多选底栏（规格 4.4.7）：底 bg.bar，高 56，「收藏 / 分享图 / 删除」均分，图标 24 + 字 12。 */
@Composable private fun SelectionBar(
    ui: ConversationUi,
    messages: List<Message>,
) {
    BackHandler(onBack = ui::endSelection)
    val colors = app.weiban.designsystem.LocalWeibanColors.current
    val chosen = messages.filter { it.messageId in ui.selected }
    val reason = shareBlockReason(chosen)
    var confirmDelete by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().background(colors.bgTabBar)) {
        Box(Modifier.fillMaxWidth().height(app.weiban.designsystem.hairline).background(colors.borderHairline))
        if (chosen.isNotEmpty() && reason != null) {
            Text(
                reason,
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
                style = app.weiban.designsystem.wbText(12.sp, color = colors.textSecondary),
            )
        }
        Row(Modifier.fillMaxWidth().height(56.dp)) {
            SelectionAction("收藏", DsR.drawable.wb_star, chosen.size in 1..SHARE_MAX_ITEMS) { ui.favoriteSelected(messages) }
            SelectionAction("分享图", DsR.drawable.wb_share, chosen.isNotEmpty() && reason == null) {
                L6Overlays.shareMessages(ui.conversation.conversationId, chosen.sortedBy { it.seq }.map { it.messageId })
                ui.endSelection()
            }
            SelectionAction("删除", DsR.drawable.wb_delete, chosen.isNotEmpty()) { confirmDelete = true }
        }
    }
    if (confirmDelete) {
        app.weiban.designsystem.ActionSheet(
            listOf(
                app.weiban.designsystem.SheetAction("删除", danger = true) {
                    val ids = chosen.map { it.messageId }
                    ui.endSelection()
                    ui.scope.launch {
                        userAction({ ui.error = it }) {
                            ids.forEach { id ->
                                ui.repository.call(
                                    Endpoints.chatEndpointsHideMessage,
                                    params = mapOf("conversationId" to ui.conversation.conversationId, "messageId" to id),
                                    options = SessionCallOptions(owner = ui.owner),
                                )
                            }
                        }
                    }
                },
            ),
            "删除选中的 ${chosen.size} 条消息？只从你的聊天里删除",
        ) { confirmDelete = false }
    }
}

@Composable private fun RowScope.SelectionAction(
    label: String,
    icon: Int,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    val colors = app.weiban.designsystem.LocalWeibanColors.current
    val tint = if (enabled) colors.textPrimary else colors.textPlaceholder
    Column(
        Modifier.weight(1f).fillMaxHeight().clickableNoRipple { if (enabled) onClick() },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        app.weiban.designsystem.WbIcon(icon, 24.dp, tint)
        Spacer(Modifier.height(2.dp))
        Text(label, style = app.weiban.designsystem.wbText(12.sp, color = tint))
    }
}

/** 聊天顶部通栏提示（第 5.4 节「余额不足 / 模型不可用横条」样式）：底 #FFF1C7，字 13 #E08A00。 */
@Composable private fun NoticeStrip(
    text: String,
    onClose: () -> Unit,
) {
    val mode = app.weiban.designsystem.LocalWeibanModeColors.current
    Row(
        Modifier.fillMaxWidth().background(mode.statusWarningSoft).clickableNoRipple(onClose).padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, Modifier.weight(1f), style = app.weiban.designsystem.wbText(13.sp, color = mode.statusWarningText))
        app.weiban.designsystem.WbIcon(DsR.drawable.wb_close, 14.dp, mode.statusWarningText)
    }
}

/** 消息区（规格 4.4.2）：底 bg.page，内距 左右 6、上 10、下 8；相邻两条间隔 > 5 分钟才显示时间条。 */
@Composable private fun MessageTimeline(
    ui: ConversationUi,
    messages: List<Message>,
    pending: List<ClientPendingSend>,
    list: androidx.compose.foundation.lazy.LazyListState,
    modifier: Modifier,
    avatars: MessageAvatars,
) {
    val colors = app.weiban.designsystem.LocalWeibanColors.current
    LazyColumn(
        state = list,
        modifier = modifier.fillMaxWidth().background(colors.bgChat),
        contentPadding = PaddingValues(start = 6.dp, top = 10.dp, end = 6.dp, bottom = 8.dp),
    ) {
        item(key = "older") {
            val canLoad = !ui.loadingHistory && messages.firstOrNull()?.seq?.let { it > 1 } == true
            if (ui.loadingHistory || canLoad) {
                Text(
                    if (ui.loadingHistory) "正在加载…" else "查看更早的消息",
                    Modifier.fillMaxWidth().clickableNoRipple { if (canLoad) ui.older(messages.first().seq) }.padding(vertical = 8.dp),
                    style = app.weiban.designsystem.wbText(13.sp, color = colors.textLink),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                )
            }
        }
        itemsIndexed(messages, key = { _, message -> message.messageId }) { index, message ->
            Column {
                if (app.weiban.designsystem.WbTime.needsDivider(messages.getOrNull(index - 1)?.createdAt, message.createdAt)) {
                    TimeDivider(message.createdAt)
                }
                MessageRow(ui, avatars, message)
            }
        }
        items(pending, key = { it.body.clientMsgId }) { item -> PendingRow(ui, avatars, item) }
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
    val colors = app.weiban.designsystem.LocalWeibanColors.current
    val media = ui.media
    val focus = LocalFocusManager.current
    val keyboard = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current
    Column(Modifier.fillMaxWidth().background(colors.bgInputBar).imePadding()) {
        quote?.let { quoted -> QuoteBar(quoted, avatars) { ui.quoteId = null } }
        Box(Modifier.fillMaxWidth().height(0.5.dp).background(colors.borderHairline))
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.Bottom) {
            // 语音 / 键盘切换（4.4.8 ①）。
            ComposerIcon(if (media.voiceMode) DsR.drawable.wb_keyboard else DsR.drawable.wb_chat_voice_mode, if (media.voiceMode) "键盘" else "语音") {
                media.voiceMode = !media.voiceMode
                media.panel = 0
                if (media.voiceMode) focus.clearFocus() else keyboard?.show()
            }
            Spacer(Modifier.width(6.dp))
            Box(Modifier.weight(1f).heightIn(min = 40.dp), contentAlignment = Alignment.Center) {
                if (media.voiceMode) {
                    HoldToTalk(
                        enabled = true,
                        onStart = { media.player.stop() },
                        onVoice = media::sendVoice,
                        onNotice = media::toast,
                    )
                } else {
                    ComposerField(ui, if (members.isEmpty()) "输入消息" else "输入消息，@成员") { next ->
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
                    }
                }
            }
            Spacer(Modifier.width(6.dp))
            ComposerIcon(if (media.panel == 1) DsR.drawable.wb_keyboard else DsR.drawable.wb_smile, "表情") {
                if (media.panel == 1) {
                    media.panel = 0
                    keyboard?.show()
                } else {
                    media.panel = 1
                    media.voiceMode = false
                    focus.clearFocus()
                }
            }
            if (!media.voiceMode && ui.text.isNotBlank()) {
                Box(Modifier.height(40.dp).padding(start = 2.dp), contentAlignment = Alignment.Center) {
                    app.weiban.designsystem.SmallBrandButton("发送", enabled = !ui.sending, onClick = ui::send)
                }
            } else {
                ComposerIcon(if (media.panel == 2) DsR.drawable.wb_keyboard else DsR.drawable.wb_add_circle, "更多功能") {
                    if (media.panel == 2) {
                        media.panel = 0
                        keyboard?.show()
                    } else {
                        media.panel = 2
                        focus.clearFocus()
                    }
                }
            }
        }
        BackHandler(media.panel != 0) { media.panel = 0 }
        when (media.panel) {
            1 -> StickerPanel(ui)
            2 -> PlusPanel(ui)
        }
    }
}

/** 输入栏图标键 40×40，图标 28 着色 text.primary。 */
@Composable private fun ComposerIcon(
    icon: Int,
    label: String,
    onClick: () -> Unit,
) {
    Box(Modifier.size(40.dp).clickableNoRipple(onClick), contentAlignment = Alignment.Center) {
        app.weiban.designsystem.WbIcon(icon, 28.dp, app.weiban.designsystem.LocalWeibanColors.current.textPrimary, contentDescription = label)
    }
}

/** 输入框（4.4.8 ②）：高 40（多行向上长，最多 4 行），白底圆角 8，内距 12×10；回车 = 发送，发送后不收键盘。 */
@Composable private fun ComposerField(
    ui: ConversationUi,
    placeholder: String,
    onChange: (String) -> Unit,
) {
    val colors = app.weiban.designsystem.LocalWeibanColors.current
    androidx.compose.foundation.text.BasicTextField(
        ui.text,
        onChange,
        Modifier
            .fillMaxWidth()
            .heightIn(min = 40.dp)
            .background(colors.bgInputField, androidx.compose.foundation.shape.RoundedCornerShape(8.dp))
            .padding(horizontal = 12.dp, vertical = 9.dp),
        textStyle = app.weiban.designsystem.wbText(17.sp, 400, colors.textPrimary, 1.3f),
        cursorBrush = androidx.compose.ui.graphics.SolidColor(colors.brandPrimary),
        maxLines = 4,
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Send),
        keyboardActions = androidx.compose.foundation.text.KeyboardActions(onSend = { ui.send() }),
        decorationBox = { inner ->
            Box(contentAlignment = Alignment.CenterStart) {
                if (ui.text.isEmpty()) {
                    Text(placeholder, style = app.weiban.designsystem.wbText(17.sp, 400, colors.textPlaceholder, 1.3f), maxLines = 1)
                }
                inner()
            }
        },
    )
}

/** 引用条（4.4.8）：底 quote.bar.bg，内距 12×6；3×30 竖条 brand → 8 → 引用人 12/600 brand + 内容 13 #555（超 30 字截断）→ 关闭 18。 */
@Composable private fun QuoteBar(
    quoted: Message,
    avatars: MessageAvatars,
    onClose: () -> Unit,
) {
    val colors = app.weiban.designsystem.LocalWeibanColors.current
    val who = if (quoted.senderKind == "user") "我" else avatars.roles[quoted.senderParticipantId]?.name.orEmpty()
    val text = messageText(quoted).let { if (it.length > 30) it.take(30) + "..." else it }
    Row(Modifier.fillMaxWidth().background(colors.brandSoft).padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(3.dp, 30.dp).background(colors.brandPrimary, androidx.compose.foundation.shape.RoundedCornerShape(2.dp)))
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
            if (who.isNotEmpty()) Text(who, style = app.weiban.designsystem.wbText(12.sp, 600, colors.brandPrimary), maxLines = 1)
            Text(
                text,
                style = app.weiban.designsystem.wbText(13.sp, 400, if (app.weiban.designsystem.LocalWbDark.current) colors.textSecondary else Color(0xFF555555)),
                maxLines = 1,
            )
        }
        Box(Modifier.size(32.dp).clickableNoRipple(onClose), contentAlignment = Alignment.Center) {
            app.weiban.designsystem.WbIcon(DsR.drawable.wb_close, 18.dp, colors.textSecondary)
        }
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

/**
 * 聊天顶栏（规格 4.4.1）：左 返回 + 其他会话未读药丸；标题（对方输入时换成「对方正在输入...」）；
 * 副标题 = 当前情景预设（非日常聊天时，点了打开情景预设）；右 more.svg → 聊天信息。多选时左「取消」、标题「已选择 N 条」。
 */
@Composable private fun ChatHeader(
    ui: ConversationUi,
    heading: String,
    subtitle: String?,
    otherUnread: Int,
    onBack: () -> Unit,
    onInformation: () -> Unit,
    messages: List<Message>,
) {
    val colors = app.weiban.designsystem.LocalWeibanColors.current
    if (ui.selecting) {
        val count = messages.count { it.messageId in ui.selected }
        app.weiban.designsystem.WbNavBar("已选择 $count 条", leading = {
            Text(
                "取消",
                Modifier.clickableNoRipple(ui::endSelection).padding(horizontal = 16.dp, vertical = 12.dp),
                style = app.weiban.designsystem.wbText(16.sp, 400, colors.textPrimary),
            )
        })
        return
    }
    app.weiban.designsystem.WbNavBar(
        heading,
        subtitle = subtitle,
        onSubtitle = { ui.scenarioOpen = true },
        leading = { BackWithUnread(otherUnread, onBack) },
    ) {
        app.weiban.designsystem.NavIcon(DsR.drawable.wb_more, "聊天信息", size = 24.dp, onClick = onInformation)
    }
}

/** 返回键 + 未读药丸（3.2）：箭头 → 6 → 药丸（高 20.6、内距 6.9、数字 16）；为 0 时只留箭头。 */
@Composable private fun BackWithUnread(
    count: Int,
    onBack: () -> Unit,
) {
    val colors = app.weiban.designsystem.LocalWeibanColors.current
    val dark = app.weiban.designsystem.LocalWbDark.current
    Row(
        Modifier.fillMaxHeight().widthIn(max = 108.dp).clickableNoRipple(onBack).padding(start = 17.4.dp, end = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        androidx.compose.material3.Icon(
            androidx.compose.ui.res.painterResource(DsR.drawable.wb_back_crop),
            "返回",
            Modifier.size(9.4.dp, 17.7.dp),
            tint = colors.textPrimary,
        )
        if (count > 0) {
            Spacer(Modifier.width(6.dp))
            Box(
                Modifier
                    .height(20.6.dp)
                    .background(if (dark) colors.borderStrong else colors.borderHairline, androidx.compose.foundation.shape.CircleShape)
                    .padding(horizontal = 6.9.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(if (count > 99) "99+" else count.toString(), style = app.weiban.designsystem.wbText(16.sp, 400, colors.textPrimary, 1f))
            }
        }
    }
}
