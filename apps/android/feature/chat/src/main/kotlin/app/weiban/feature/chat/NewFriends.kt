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
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.temporal.ChronoUnit

/**
 * 「新的朋友」的一条记录。契约没有「新的朋友」列表接口（T-067 交接遗留 1），
 * 与网页相同：用本机已同步的名片消息和通讯录拼出来；「已忽略」「删除记录」「已看过」记在本机（Room 标记）。
 */
internal data class FriendRecord(
    val characterId: String,
    val recommenderCharacterId: String?,
    val cardName: String?,
    val at: String,
)

internal fun friendRecords(state: ClientSyncState): List<FriendRecord> {
    val cards =
        state.messages
            .filter { it.status == "normal" }
            .mapNotNull { message ->
                (message.content as? ReceivedMessageContentContactCard)?.let {
                    FriendRecord(it.characterId, it.recommenderCharacterId, it.name, message.createdAt)
                }
            }.sortedByDescending { it.at }
            .distinctBy { it.characterId }
    val fromContacts =
        state.contacts
            .filter { contact -> cards.none { it.characterId == contact.characterId } }
            .map { FriendRecord(it.characterId, null, null, it.addedAt) }
    return (cards + fromContacts).sortedByDescending { it.at }
}

/** 有新名片推荐时「新的朋友」行亮红点；进入页面后消失。 */
@Composable internal fun rememberNewFriendsDot(
    repository: SessionRepository,
    owner: OwnerRecord,
    state: ClientSyncState,
): Boolean {
    val latest = friendRecords(state).firstOrNull { it.recommenderCharacterId != null }?.at
    var seen by remember(owner) { mutableStateOf<String?>(null) }
    var loaded by remember(owner) { mutableStateOf(false) }
    LaunchedEffect(owner, latest) {
        seen = repository.flags.get(owner, "newFriends:seen")
        loaded = true
    }
    return loaded && latest != null && (seen == null || latest > seen.orEmpty())
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
    val records = friendRecords(state)
    var hidden by remember(owner) { mutableStateOf<Set<String>>(emptySet()) }
    var dismissed by remember(owner) { mutableStateOf<Set<String>>(emptySet()) }
    LaunchedEffect(owner, records.size) {
        records.firstOrNull { it.recommenderCharacterId != null }?.let { repository.flags.set(owner, "newFriends:seen", it.at) }
        hidden = records.filter { repository.flags.get(owner, "newFriends:hidden:${it.characterId}") == "yes" }.map { it.characterId }.toSet()
        dismissed = records.filter { repository.flags.get(owner, "card:dismissed:${it.characterId}") != null }.map { it.characterId }.toSet()
    }
    val visible = records.filter { it.characterId !in hidden }
    val profiles = characterProfiles(repository, visible.flatMap { listOfNotNull(it.characterId, it.recommenderCharacterId) })
    fun nameOf(id: String?): String =
        id?.let { key -> state.contacts.find { it.characterId == key }?.remark ?: profiles[key]?.name }.orEmpty()
    val now = Instant.now()
    val recent =
        visible.filter { record ->
            runCatching { ChronoUnit.HOURS.between(Instant.parse(record.at), now) < 72 }.getOrDefault(true)
        }
    val older = visible - recent.toSet()
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        TextButton(onClick = onBack) { Text("‹ 返回") }
        Text("新的朋友", style = MaterialTheme.typography.titleMedium)
    }
    OutlinedButton(onClick = onSearch, modifier = Modifier.fillMaxWidth().padding(horizontal = WbSpace.S5)) { Text("搜索角色") }
    if (visible.isEmpty()) {
        Text("还没有新朋友 · TA 的朋友们会通过名片介绍给你", Modifier.padding(WbSpace.S5), color = colors.textSecondary)
        return
    }
    LazyColumn {
        listOf("近三天" to recent, "更早" to older).forEach { (heading, rows) ->
            if (rows.isNotEmpty()) {
                item(key = heading) { Text(heading, Modifier.padding(WbSpace.S3), color = colors.textSecondary) }
                items(rows, key = { "$heading:${it.characterId}" }) { record ->
                    val contact = state.contacts.find { it.characterId == record.characterId }
                    val name = nameOf(record.characterId).ifBlank { record.cardName ?: "角色" }
                    val source = record.recommenderCharacterId?.let { "${nameOf(it).ifBlank { "朋友" }} 推荐" } ?: "来自 通讯录"
                    val greeting = record.recommenderCharacterId?.let { "是 ${nameOf(it)} 推荐我来的" }
                    val target = ProfileTarget(record.characterId, greeting, record.recommenderCharacterId)
                    var removing by remember { mutableStateOf(false) }
                    ListItem(
                        headlineContent = { Text(name) },
                        supportingContent = { Text(source, color = colors.textSecondary) },
                        leadingContent = {
                            RoleAvatar(
                                repository,
                                owner,
                                RoleAvatarIdentity(record.characterId, name, profiles[record.characterId]?.avatar, contact?.customAvatarMediaId),
                                WbSize.AvatarLg,
                            )
                        },
                        trailingContent = {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                when {
                                    contact?.status == "active" -> Text("已添加", color = colors.textTertiary)
                                    contact?.status == "pending" -> Text("等待中", color = colors.textTertiary)
                                    record.characterId in dismissed -> Text("已忽略", color = colors.textTertiary)
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
                                    scope.launch {
                                        repository.flags.set(owner, "newFriends:hidden:${record.characterId}", "yes")
                                        hidden = hidden + record.characterId
                                    }
                                }) { Text("删除", color = colors.textDanger) }
                            },
                            dismissButton = { TextButton(onClick = { removing = false }) { Text("取消") } },
                        )
                    }
                    HorizontalDivider(color = colors.borderHairline)
                }
            }
        }
    }
}

/** 通讯录顶部「新的朋友」「群聊」两行（CHR-05）。 */
@Composable internal fun ContactsEntries(
    repository: SessionRepository,
    owner: OwnerRecord,
    state: ClientSyncState,
    onNewFriends: () -> Unit,
    onGroups: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    val dot = rememberNewFriendsDot(repository, owner, state)
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onNewFriends).padding(WbSpace.S5),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("新的朋友", Modifier.weight(1f))
        if (dot) Badge(containerColor = LocalWeibanModeColors.current.badgeUnread)
        Text(" ›", color = colors.textSecondary)
    }
    HorizontalDivider(color = colors.borderHairline)
    Row(Modifier.fillMaxWidth().clickable(onClick = onGroups).padding(WbSpace.S5), verticalAlignment = Alignment.CenterVertically) {
        Text("群聊", Modifier.weight(1f))
        Text("›", color = colors.textSecondary)
    }
    HorizontalDivider(color = colors.borderHairline)
}
