package app.weiban.feature.chat

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.weiban.contracts.*
import app.weiban.core.designsystem.R as DsR
import app.weiban.data.*
import app.weiban.designsystem.CountBadge
import app.weiban.designsystem.DarkMenu
import app.weiban.designsystem.DotBadge
import app.weiban.designsystem.EmptyState
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.LocalWeibanModeColors
import app.weiban.designsystem.LongPressMenu
import app.weiban.designsystem.MenuItem
import app.weiban.designsystem.NavIcon
import app.weiban.designsystem.WbConfirm
import app.weiban.designsystem.WbIcon
import app.weiban.designsystem.WbNavBar
import app.weiban.designsystem.WbTime
import app.weiban.designsystem.hairline
import app.weiban.designsystem.pressMenu
import app.weiban.designsystem.tokens.WbMotion
import app.weiban.designsystem.wbText
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

private val SWIPE_BUTTON = 68.dp
private const val FLING_VELOCITY = 250f

/**
 * 会话列表（规格 4.2）：顶栏「微伴(N)」+ 搜索 + ⊕ 深色菜单；行高 72、头像 48 圆角 4；
 * 左滑「标为未读 / 不显示 / 删除」，长按浅色菜单；顶端继续下拉打开小程序面板（4.3），不再有下拉刷新。
 */
@Composable internal fun ConversationList(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    state: ClientSyncState,
    onSelect: (String) -> Unit,
    actions: ListActions,
) {
    val colors = LocalWeibanColors.current
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
    val heading = if (unread > 0) "微伴(${if (unread > 99) "99+" else unread})" else "微伴"
    var menu by remember { mutableStateOf(false) }
    var pressed by remember { mutableStateOf<Pair<Offset, Conversation>?>(null) }
    var deleting by remember { mutableStateOf<Conversation?>(null) }
    var swiped by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    // 每分钟刷新一次时间（「刚刚」→「上午7:56」）。
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(MINUTE_MS)
            now = System.currentTimeMillis()
        }
    }
    val change: (suspend () -> Unit) -> Unit = { work ->
        swiped = null
        scope.launch { userAction({ app.weiban.designsystem.WbToast.show(it) }) { work() } }
    }
    val ops = ConversationOps(repository, runtime, owner, change)
    Column(Modifier.fillMaxSize().background(colors.bgPage)) {
        PullToMiniApps(
            repository,
            owner,
            heading,
            header = {
                WbNavBar(heading) {
                    NavIcon(DsR.drawable.wb_search, "搜索", onClick = actions.search)
                    Box {
                        NavIcon(DsR.drawable.wb_add_circle, "更多") { menu = true }
                        DarkMenu(
                            menu,
                            { menu = false },
                            listOf(
                                MenuItem("发起群聊", icon = DsR.drawable.wb_chat, onClick = actions.createGroup),
                                MenuItem("添加角色", icon = DsR.drawable.wb_add_circle, onClick = actions.addRole),
                                MenuItem("新建角色", icon = DsR.drawable.wb_person, onClick = actions.newRole),
                                MenuItem("导入角色", icon = DsR.drawable.wb_note, onClick = actions.importRole),
                            ),
                        )
                    }
                }
            },
        ) {
            LazyColumn(Modifier.fillMaxSize()) {
                if (conversations.isEmpty()) {
                    item(key = "empty") {
                        if (state.initialized) {
                            EmptyState("还没有对话", DsR.drawable.wb_chat, "去添加一位角色，聊起来", "去添加角色", onAction = actions.addRole)
                        } else {
                            Text(
                                "正在同步聊天…",
                                Modifier.fillMaxWidth().padding(32.dp),
                                style = wbText(14.sp, color = colors.textSecondary),
                                textAlign = TextAlign.Center,
                            )
                        }
                    }
                }
                items(conversations, key = { it.conversationId }) { conversation ->
                    SwipeRow(
                        conversation,
                        swiped == conversation.conversationId,
                        { open -> swiped = if (open) conversation.conversationId else null },
                        onToggleRead = { ops.toggleRead(conversation) },
                        onHide = { ops.update(conversation, "hidden", true) },
                        onDelete = { deleting = conversation },
                    ) {
                        ConversationRow(repository, owner, state, conversation, profiles, names, now, {
                            if (swiped != null) swiped = null else onSelect(conversation.conversationId)
                        }) { at -> pressed = at to conversation }
                    }
                }
                item(key = "bottom") { Spacer(Modifier.height(24.dp)) }
            }
        }
    }
    pressed?.let { (at, conversation) ->
        val items =
            buildList {
                add(MenuItem(if (conversation.state.pinned) "取消置顶" else "置顶该聊天") { ops.update(conversation, "pinned", !conversation.state.pinned) })
                if (conversation.unreadCount == 0L && !conversation.state.markedUnread) add(MenuItem("标为未读") { ops.toggleRead(conversation) })
                add(
                    MenuItem(if (conversation.state.muted) "开启新消息提醒" else "消息免打扰") {
                        ops.update(conversation, "muted", !conversation.state.muted)
                    },
                )
                add(MenuItem("不显示该聊天") { ops.update(conversation, "hidden", true) })
                add(MenuItem("删除该聊天", danger = true) { deleting = conversation })
            }
        LongPressMenu(at, items) { pressed = null }
    }
    deleting?.let { conversation ->
        WbConfirm("删除该聊天？TA 的记忆和养成数据会保留", "删除", danger = true, onDismiss = { deleting = null }) {
            deleting = null
            ops.delete(conversation)
        }
    }
}

private const val MINUTE_MS = 60_000L

/** 会话行上的操作：置顶 / 免打扰 / 不显示（state 字段）、标为未读 / 已读、删除（清空记录 + 不显示）。 */
private class ConversationOps(
    val repository: SessionRepository,
    val runtime: ChatRuntime,
    val owner: OwnerRecord,
    val launch: (suspend () -> Unit) -> Unit,
) {
    fun update(
        conversation: Conversation,
        field: String,
        value: Boolean,
    ) = launch {
        repository.call(
            Endpoints.chatEndpointsUpdateState,
            params = mapOf("conversationId" to conversation.conversationId),
            body = buildJsonObject { put(field, value) },
            options = SessionCallOptions(owner = owner),
        )
    }

    fun toggleRead(conversation: Conversation) =
        launch {
            if (conversation.unreadCount > 0 || conversation.state.markedUnread) {
                repository.call(
                    Endpoints.chatEndpointsMarkRead,
                    params = mapOf("conversationId" to conversation.conversationId),
                    body = buildJsonObject { put("readSeq", conversation.lastSeq) },
                    options = SessionCallOptions(owner = owner),
                )
            } else {
                repository.call(
                    Endpoints.chatEndpointsMarkUnread,
                    params = mapOf("conversationId" to conversation.conversationId),
                    options = SessionCallOptions(owner = owner),
                )
            }
        }

    fun delete(conversation: Conversation) =
        launch {
            runtime.history.clear(owner, conversation.conversationId)
            repository.call(
                Endpoints.chatEndpointsUpdateState,
                params = mapOf("conversationId" to conversation.conversationId),
                body = buildJsonObject { put("hidden", true) },
                options = SessionCallOptions(owner = owner),
            )
        }
}

/**
 * 左滑露出按钮（规格 4.2）：每个宽 68，文字 13 白；180ms easeOut；甩动 > 250 像素/秒直接展开或收起；
 * 同时只展开一行。
 */
@Composable private fun SwipeRow(
    conversation: Conversation,
    open: Boolean,
    onOpen: (Boolean) -> Unit,
    onToggleRead: () -> Unit,
    onHide: () -> Unit,
    onDelete: () -> Unit,
    content: @Composable () -> Unit,
) {
    val mode = LocalWeibanModeColors.current
    val colors = LocalWeibanColors.current
    val width = with(LocalDensity.current) { SWIPE_BUTTON.toPx() } * 3
    val offset = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(open) { offset.animateTo(if (open) -width else 0f, tween(WbMotion.SwipeMs, easing = WbMotion.Decelerate)) }
    val unreadNow = conversation.unreadCount > 0 || conversation.state.markedUnread
    Box(Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
        Row(Modifier.align(Alignment.CenterEnd).fillMaxHeight()) {
            SwipeButton(if (unreadNow) "标为已读" else "标为未读", mode.uiSwipeRead, onToggleRead)
            SwipeButton("不显示", mode.uiSwipeHide, onHide)
            SwipeButton("删除", colors.textDanger, onDelete)
        }
        Box(
            Modifier
                .graphicsLayer { translationX = offset.value }
                .draggable(
                    rememberDraggableState { delta -> scope.launch { offset.snapTo((offset.value + delta).coerceIn(-width, 0f)) } },
                    Orientation.Horizontal,
                    onDragStopped = { velocity ->
                        val target =
                            when {
                                velocity < -FLING_VELOCITY -> true
                                velocity > FLING_VELOCITY -> false
                                else -> offset.value < -width / 2
                            }
                        onOpen(target)
                        offset.animateTo(if (target) -width else 0f, tween(WbMotion.SwipeMs, easing = WbMotion.Decelerate))
                    },
                ),
        ) { content() }
    }
}

@Composable private fun SwipeButton(
    label: String,
    color: Color,
    onClick: () -> Unit,
) {
    Box(
        Modifier.width(SWIPE_BUTTON).fillMaxHeight().background(color).clickableNoRipple(onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, style = wbText(13.sp, 400, Color.White, 1.15f), textAlign = TextAlign.Center, maxLines = 2)
    }
}

@Composable private fun ConversationRow(
    repository: SessionRepository,
    owner: OwnerRecord,
    state: ClientSyncState,
    conversation: Conversation,
    profiles: Map<String, CharacterProfile>,
    names: Map<String, String>,
    now: Long,
    onClick: () -> Unit,
    onLongPress: (Offset) -> Unit,
) {
    val colors = LocalWeibanColors.current
    val mode = LocalWeibanModeColors.current
    val background = if (conversation.state.pinned) colors.bgSurfacePinned else colors.bgSurface
    Column(Modifier.fillMaxWidth().background(background)) {
        Row(
            Modifier
                .fillMaxWidth()
                .height(72.dp)
                .pressMenu(onClick, onLongPress)
                .padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box {
                ConversationAvatar(repository, owner, state, conversation, profiles)
                when {
                    conversation.unreadCount > 0 && conversation.state.muted ->
                        DotBadge(10.dp, Color.White, Modifier.align(Alignment.TopEnd).offset(5.dp, (-5).dp))
                    conversation.unreadCount > 0 ->
                        CountBadge(conversation.unreadCount.toInt(), Modifier.align(Alignment.TopEnd).offset(7.dp, (-7).dp))
                    conversation.state.markedUnread ->
                        DotBadge(10.dp, Color.White, Modifier.align(Alignment.TopEnd).offset(5.dp, (-5).dp))
                }
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    title(state, conversation, names),
                    style = wbText(17.sp, 400, colors.textPrimary),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(4.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (conversation.unreadCount > 0 && conversation.state.muted) {
                        Text("[${conversation.unreadCount}条] ", style = wbText(14.sp, color = colors.textPlaceholder), maxLines = 1)
                    }
                    Text(
                        conversation.lastMessage?.text ?: "开始聊天",
                        Modifier.weight(1f),
                        style = wbText(14.sp, color = colors.textPlaceholder),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            Spacer(Modifier.width(8.dp))
            Column(horizontalAlignment = Alignment.End) {
                Text(
                    conversation.lastMessage?.createdAt?.let { WbTime.list(it, now) }.orEmpty(),
                    style = wbText(12.sp, color = colors.textPlaceholder),
                    maxLines = 1,
                )
                Spacer(Modifier.height(6.dp))
                if (conversation.state.muted) {
                    WbIcon(DsR.drawable.wb_bell_mute, 15.dp, mode.uiChevron)
                } else {
                    Spacer(Modifier.height(15.dp))
                }
            }
        }
        Box(Modifier.fillMaxWidth().padding(start = 80.dp).height(hairline).background(colors.borderHairline))
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
        48.dp,
        4.dp,
    )
}
