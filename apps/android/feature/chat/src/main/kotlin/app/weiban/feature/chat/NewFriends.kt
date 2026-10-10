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
import app.weiban.contracts.*
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
@Composable internal fun rememberNewFriends(
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

    fun nameOf(id: String?): String = id?.let { key -> state.contacts.find { it.characterId == key }?.remark ?: profiles[key]?.name }.orEmpty()
    val now = Instant.now()
    val recent =
        visible.filter { item ->
            runCatching { ChronoUnit.HOURS.between(Instant.parse(item.createdAt), now) < 72 }.getOrDefault(true)
        }
    val older = visible - recent.toSet()
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        TextButton(onClick = onBack) { Text("‹ 返回") }
        Text("新的朋友", style = MaterialTheme.typography.titleMedium)
    }
    OutlinedButton(onClick = onSearch, modifier = Modifier.fillMaxWidth().padding(horizontal = WbSpace.S5)) { Text("搜索角色") }
    error?.let { Text(it, Modifier.padding(horizontal = WbSpace.S5), color = MaterialTheme.colorScheme.error) }
    when {
        list == null -> LinearProgressIndicator(Modifier.fillMaxWidth().padding(WbSpace.S5))
        visible.isEmpty() -> Text("还没有新朋友 · TA 的朋友们会通过名片介绍给你", Modifier.padding(WbSpace.S5), color = colors.textSecondary)
        else ->
            LazyColumn {
                listOf("近三天" to recent, "更早" to older).forEach { (heading, rows) ->
                    if (rows.isNotEmpty()) {
                        item(key = heading) { Text(heading, Modifier.padding(WbSpace.S3), color = colors.textSecondary) }
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
    ListItem(
        headlineContent = { Text(name) },
        supportingContent = { Text(source, color = colors.textSecondary) },
        leadingContent = {
            RoleAvatar(
                repository,
                owner,
                RoleAvatarIdentity(item.characterId, name, profiles[item.characterId]?.avatar, contact?.customAvatarMediaId),
                WbSize.AvatarLg,
            )
        },
        trailingContent = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                when (status) {
                    "added" -> Text("已添加", color = colors.textTertiary)
                    "pending" -> Text("等待中", color = colors.textTertiary)
                    "dismissed" -> Text("已忽略", color = colors.textTertiary)
                    else -> Button(onClick = { onProfile(target) }) { Text("添加") }
                }
                TextButton(onClick = { removing = true }) { Text("删除", color = colors.textTertiary) }
            }
        },
        modifier = Modifier.clickable { onProfile(target) },
    )
    if (removing) {
        AlertDialog(
            onDismissRequest = { removing = false },
            title = { Text("删除这条记录？") },
            text = { Text("只删除这条记录，不影响通讯录") },
            confirmButton = {
                TextButton(onClick = {
                    removing = false
                    onRemove()
                }) { Text("删除", color = colors.textDanger) }
            },
            dismissButton = { TextButton(onClick = { removing = false }) { Text("取消") } },
        )
    }
    HorizontalDivider(color = colors.borderHairline)
}

/** 通讯录顶部「新的朋友」「群聊」两行（CHR-05）；红点数 = 服务器 unseenCount。 */
@Composable internal fun ContactsEntries(
    repository: SessionRepository,
    owner: OwnerRecord,
    onNewFriends: () -> Unit,
    onGroups: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    val unseen = rememberNewFriends(repository, owner)?.unseenCount ?: 0
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onNewFriends).padding(WbSpace.S5),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("新的朋友", Modifier.weight(1f))
        if (unseen > 0) Badge(containerColor = LocalWeibanModeColors.current.badgeUnread) { Text(unseen.toString()) }
        Text(" ›", color = colors.textSecondary)
    }
    HorizontalDivider(color = colors.borderHairline)
    Row(Modifier.fillMaxWidth().clickable(onClick = onGroups).padding(WbSpace.S5), verticalAlignment = Alignment.CenterVertically) {
        Text("群聊", Modifier.weight(1f))
        Text("›", color = colors.textSecondary)
    }
    HorizontalDivider(color = colors.borderHairline)
}
