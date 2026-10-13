package app.weiban.feature.chat

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.background
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.weiban.contracts.*
import app.weiban.core.designsystem.R as DsR
import app.weiban.designsystem.pressMenu
import app.weiban.designsystem.pressable
import app.weiban.designsystem.wbText
import app.weiban.data.*
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.LocalWeibanModeColors
import app.weiban.designsystem.tokens.WbSize
import app.weiban.designsystem.tokens.WbSpace
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.temporal.ChronoUnit

/**
 * 「新的朋友」（CHR-05）：3.0.1 起来自服务器 `GET /contacts/new-friends`（多设备同步「不感兴趣」「删除」「已看过」）。
 * 收到 `data.changed(new_friends)` 时重新拉取。
 */
@Suppress("TooGenericExceptionCaught") // Badge failures keep the previous value; cancellation stops the old owner.
@Composable
internal fun rememberNewFriends(
    repository: SessionRepository,
    owner: OwnerRecord,
): NewFriendsEndpointsListResponse? {
    var data by remember(owner) { mutableStateOf<NewFriendsEndpointsListResponse?>(null) }
    var revision by remember(owner) { mutableIntStateOf(0) }
    LaunchedEffect(owner, revision) {
        try {
            data = repository.call(Endpoints.newFriendsEndpointsList, options = SessionCallOptions(owner = owner, networkOnly = true))
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            Unit
        }
    }
    LaunchedEffect(owner) {
        AppUpdates.updates.collect { update ->
            if (update is UserUpdateDataChanged && update.data.section == "new_friends") revision++
        }
    }
    return data
}

@Composable internal fun NewFriendsPage(
    repository: SessionRepository,
    owner: OwnerRecord,
    state: ClientSyncState,
    onBack: () -> Unit,
    onSearch: () -> Unit,
    onProfile: (ProfileTarget) -> Unit,
) {
    BackHandler(onBack = onBack)
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    val list = rememberNewFriends(repository, owner)
    var removed by remember(owner) { mutableStateOf<Set<String>>(emptySet()) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(owner, list?.unseenCount) {
        if ((list?.unseenCount ?: 0) > 0) {
            userAction({}) {
                repository.call(Endpoints.newFriendsEndpointsMarkSeen, options = SessionCallOptions(owner = owner))
            }
        }
    }
    val visible = list?.items.orEmpty().filter { it.itemId !in removed }
    val profiles = characterProfiles(repository, visible.flatMap { listOfNotNull(it.characterId, it.recommenderCharacterId) })

    fun nameOf(id: String?): String =
        id?.let { key -> state.contacts.find { it.characterId == key }?.remark ?: profiles[key]?.name }.orEmpty()
    val now = Instant.now()
    val recent =
        visible.filter { item ->
            runCatching { ChronoUnit.HOURS.between(Instant.parse(item.createdAt), now) < 72 }.getOrDefault(true)
        }
    val older = visible - recent.toSet()
    app.weiban.designsystem.WbNavBar("新的朋友", onBack) { app.weiban.designsystem.NavAction("添加角色", onSearch) }
    LaunchedEffect(error) { error?.let { app.weiban.designsystem.WbToast.show(it) } }
    when {
        list == null -> LinearProgressIndicator(Modifier.fillMaxWidth(), color = colors.brandPrimary)
        visible.isEmpty() ->
            app.weiban.designsystem.EmptyState(
                "还没有新朋友",
                DsR.drawable.wb_person,
                "TA 的朋友们会通过名片介绍给你",
                "去角色广场看看",
                onAction = onSearch,
            )
        else ->
            LazyColumn {
                listOf("近三天" to recent, "更早" to older).forEach { (heading, rows) ->
                    if (rows.isNotEmpty()) {
                        item(key = heading) { app.weiban.designsystem.GroupHeader(heading) }
                        items(rows, key = { it.itemId }) { item ->
                            NewFriendRow(repository, owner, state, item, profiles, ::nameOf, onProfile) {
                                removed = removed + item.itemId
                                scope.launch {
                                    userAction({
                                        removed = removed - item.itemId
                                        error = it
                                    }) {
                                        repository.call(
                                            Endpoints.newFriendsEndpointsRemove,
                                            params = mapOf("itemId" to item.itemId),
                                            options = SessionCallOptions(owner = owner),
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
    }
}

@Composable private fun NewFriendRow(
    repository: SessionRepository,
    owner: OwnerRecord,
    state: ClientSyncState,
    item: NewFriendItem,
    profiles: Map<String, CharacterProfile>,
    nameOf: (String?) -> String,
    onProfile: (ProfileTarget) -> Unit,
    onRemove: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    val contact = state.contacts.find { it.characterId == item.characterId }
    val name = nameOf(item.characterId).ifBlank { "角色" }
    val source = item.recommenderCharacterId?.let { "${nameOf(it).ifBlank { "朋友" }} 推荐" } ?: "来自 通讯录"
    val greeting = item.recommenderCharacterId?.let { "是 ${nameOf(it)} 推荐我来的" }
    val target = ProfileTarget(item.characterId, greeting, item.recommenderCharacterId)
    var removing by remember { mutableStateOf(false) }
    // 本机通讯录状态比列表更新得快（刚添加 / 刚通过），优先用它。
    val status =
        when (contact?.status) {
            "active" -> "added"
            "pending" -> "pending"
            else -> item.status
        }
    val mode = LocalWeibanModeColors.current
    var menuAt by remember { mutableStateOf<androidx.compose.ui.geometry.Offset?>(null) }
    // 新的朋友（规格 4.7）：行高 72，头像 46 圆角 6 → 12 → 名字 17 + 4 + 状态 13；右侧行内小按钮；长按删除。
    Row(
        Modifier
            .fillMaxWidth()
            .height(72.dp)
            .background(colors.bgSurface)
            .pressMenu({ onProfile(target) }, { menuAt = it })
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RoleAvatar(
            repository,
            owner,
            RoleAvatarIdentity(item.characterId, name, profiles[item.characterId]?.avatar, contact?.customAvatarMediaId),
            46.dp,
            6.dp,
        )
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(name, style = wbText(17.sp, color = colors.textPrimary), maxLines = 1)
            Spacer(Modifier.height(4.dp))
            Text(source, style = wbText(13.sp, color = colors.textSecondary), maxLines = 1)
        }
        when (status) {
            "added" -> Text("已添加", style = wbText(14.sp, color = colors.textSecondary))
            "pending" -> Text("等待通过", style = wbText(14.sp, color = mode.uiPending))
            "dismissed" -> Text("已忽略", style = wbText(14.sp, color = colors.textPlaceholder))
            else -> app.weiban.designsystem.InlineButton("添加") { onProfile(target) }
        }
    }
    Box(Modifier.fillMaxWidth().padding(start = 74.dp).height(app.weiban.designsystem.hairline).background(colors.borderHairline))
    menuAt?.let { at ->
        app.weiban.designsystem.LongPressMenu(at, listOf(app.weiban.designsystem.MenuItem("删除", danger = true) { removing = true })) { menuAt = null }
    }
    if (removing) {
        app.weiban.designsystem.WbConfirm("只删除这条记录，不影响通讯录", "删除", danger = true, onDismiss = { removing = false }) {
            removing = false
            onRemove()
        }
    }
}

/**
 * 通讯录顶部固定行（规格 4.6）：高 56，图标槽 44 内放 40 彩色方块（圆角 4）+ 白图标；文字 17；分割线缩进 72。
 * 新的朋友（数字角标 = 服务器 unseenCount）/ 新建角色 / 群聊 / 角色广场 / 标签* / 公众号*。
 */
@Suppress("UNUSED_PARAMETER") // onComingSoon：旧调用处保留；「暂未开放」改为轻提示。
@Composable
internal fun ContactsEntries(
    repository: SessionRepository,
    owner: OwnerRecord,
    onNewFriends: () -> Unit,
    onGroups: () -> Unit,
    onNewRole: () -> Unit,
    onPlaza: () -> Unit,
    onComingSoon: (String) -> Unit,
) {
    val unseen = (rememberNewFriends(repository, owner)?.unseenCount ?: 0).toInt()
    val colors = LocalWeibanColors.current
    val mode = LocalWeibanModeColors.current
    Column(Modifier.fillMaxWidth().background(colors.bgSurface)) {
        FixedRow("新的朋友", DsR.drawable.wb_person, mode.tintOrange, 24, unseen, onClick = onNewFriends)
        FixedRow("新建角色", DsR.drawable.wb_add, colors.brandPrimary, 22, 0, onClick = onNewRole)
        FixedRow("群聊", DsR.drawable.wb_chat_pair, colors.brandPrimary, 22, 0, onClick = onGroups)
        FixedRow("角色广场", DsR.drawable.wb_drawn_people, mode.tintBlue, 22, 0, onClick = onPlaza)
        FixedRow("标签", DsR.drawable.wb_tag, mode.tintBlue, 22, 0) { app.weiban.designsystem.ComingSoon.notice("tags") }
        FixedRow("公众号", DsR.drawable.wb_contacts_official, mode.tintBlue, 22, 0, last = true) {
            app.weiban.designsystem.ComingSoon.notice("official")
        }
    }
}

@Composable private fun FixedRow(
    label: String,
    icon: Int,
    tint: androidx.compose.ui.graphics.Color,
    iconSize: Int,
    badge: Int,
    last: Boolean = false,
    onClick: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    Row(
        Modifier.fillMaxWidth().height(56.dp).pressable(onClick = onClick).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(44.dp), contentAlignment = Alignment.Center) {
            Box(
                Modifier.size(40.dp).background(tint, androidx.compose.foundation.shape.RoundedCornerShape(4.dp)),
                contentAlignment = Alignment.Center,
            ) {
                app.weiban.designsystem.WbIcon(icon, iconSize.dp, androidx.compose.ui.graphics.Color.White)
            }
        }
        Spacer(Modifier.width(12.dp))
        Text(label, Modifier.weight(1f), style = wbText(17.sp, color = colors.textPrimary))
        if (badge > 0) app.weiban.designsystem.CountBadge(badge, stroke = androidx.compose.ui.graphics.Color.Transparent)
    }
    if (!last) Box(Modifier.fillMaxWidth().padding(start = 72.dp).height(app.weiban.designsystem.hairline).background(colors.borderHairline))
}
