package app.weiban.feature.chat

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
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
    // "": 从会话列表发起；characterId：从私聊聊天信息页发起（原角色锁定）。
    var creating by rememberSaveable(owner.sessionId) { mutableStateOf<String?>(null) }
    var profile by remember(owner.sessionId) { mutableStateOf<ProfileTarget?>(null) }
    val changed by rememberUpdatedState(onConversationChanged)
    val select: (String?) -> Unit = { id ->
        conversationId = id
        changed(id)
    }
    var searching by rememberSaveable(owner.sessionId) { mutableStateOf(false) }
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
            selected == null -> ConversationList(repository, owner, state, select, { searching = true }) { creating = "" }
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
                ConversationView(repository, runtime, owner, state, selected, { information = true }, { profile = it }) { select(null) }
        }
    }
}

@Composable private fun ConversationList(
    repository: SessionRepository,
    owner: OwnerRecord,
    state: ClientSyncState,
    onSelect: (String) -> Unit,
    onSearch: () -> Unit,
    onCreateGroup: () -> Unit,
) {
    val profiles =
        characterProfiles(
            repository,
            state.contacts.map { it.characterId } + state.conversations.flatMap { c -> c.characterMembers().map { it.refId } },
        )
    val names = profiles.mapValues { it.value.name }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Text("微伴", Modifier.padding(WbSpace.S5), style = MaterialTheme.typography.headlineSmall)
        TextButton(onClick = onCreateGroup) { Text("发起群聊") }
    }
    // 全局搜索入口（CHAT-12）：角色、群聊、聊天记录。
    OutlinedButton(onClick = onSearch, modifier = Modifier.fillMaxWidth().padding(horizontal = WbSpace.S5)) { Text("搜索") }
    val conversations =
        state.conversations
            .filter { !it.state.hidden }
            .sortedWith(
                compareByDescending<Conversation> { it.state.pinned }.thenByDescending { it.lastMessage?.createdAt ?: it.updatedAt },
            )
    if (conversations.isEmpty()) {
        val emptyText = if (state.initialized) "添加喜欢的角色后，聊天会出现在这里" else "正在同步聊天…"
        Text(emptyText, Modifier.padding(WbSpace.S5))
    }
    LazyColumn {
        items(conversations, key = { it.conversationId }) { conversation ->
            ListItem(
                headlineContent = { Text(title(state, conversation, names)) },
                leadingContent = { ConversationAvatar(repository, owner, state, conversation, profiles) },
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
            if (p("reason") == "member_not_eligible") "有新成员加入，群聊已回到日常模式" else scenarioModeMessage(content)
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
        return "成人模式已不可用，已回到日常模式"
    }
    val mode =
        when ((content.params["mode"] as? JsonPrimitive)?.contentOrNull) {
            "tsundere" -> "傲娇"
            "romance" -> "恋爱"
            "adult" -> "成人"
            else -> "日常"
        }
    return "已切换到${mode}模式"
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
    onInformation: () -> Unit,
    onProfile: (ProfileTarget) -> Unit,
    onBack: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val context = androidx.compose.ui.platform.LocalContext.current
    val ui =
        remember(conversation.conversationId, owner) {
            ConversationUi(repository, runtime, owner, conversation, scope).also { it.media = ChatMediaUi(context, it) }
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
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        TextButton(onBack) { Text("返回") }
        val heading = title(state, conversation, names) + if (group) "（${conversation.characterMembers().size + 1}）" else ""
        Text(heading, Modifier.padding(WbSpace.S5), style = MaterialTheme.typography.titleMedium)
        TextButton(onInformation) { Text("聊天信息") }
    }
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
    if (group && conversation.state.hidden) {
        Text("这个群聊已解散", Modifier.padding(WbSpace.S5))
    }
    ui.error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = WbSpace.S5)) }
    if (visible && typingActive) Text(typingText, Modifier.padding(horizontal = WbSpace.S5))
    MessageTimeline(ui, messages, pending, list, Modifier.weight(1f), avatars)
    LocateEffects(ui, messages, list)
    if (ui.selecting) {
        SelectionBar(ui, messages)
    } else if (group && conversation.state.hidden) {
        Text("你已不在该群聊中", Modifier.fillMaxWidth().padding(WbSpace.S5), style = MaterialTheme.typography.bodySmall)
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
                    enabled = !ui.conversation.state.hidden,
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
