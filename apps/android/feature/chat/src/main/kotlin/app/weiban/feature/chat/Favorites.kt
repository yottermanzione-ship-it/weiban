package app.weiban.feature.chat

import android.widget.Toast
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
import androidx.compose.ui.platform.LocalContext
import app.weiban.contracts.*
import app.weiban.data.*
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.tokens.WbSize
import app.weiban.designsystem.tokens.WbSpace
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

private const val SEARCH_DEBOUNCE_MS = 300L

/** 收藏来源里的消息定位信息（FavoriteSource 是 JSON 联合类型）。 */
@Suppress("ReturnCount") // 首次本机构建（2026-10-11）：保留既有逻辑，复杂度待重构
private fun favoriteMessage(favorite: Favorite): Pair<String, String>? {
    val source = favorite.source as? JsonObject ?: return null
    if (source["kind"]?.jsonPrimitive?.contentOrNull != "message") return null
    val conversationId = source["conversationId"]?.jsonPrimitive?.contentOrNull ?: return null
    val messageId = source["messageId"]?.jsonPrimitive?.contentOrNull ?: return null
    return conversationId to messageId
}

private fun favoriteIsMine(favorite: Favorite): Boolean =
    (favorite.source as? JsonObject)?.get("senderKind")?.jsonPrimitive?.contentOrNull == "user"

private class FavoritesPager(
    val repository: SessionRepository,
    val owner: OwnerRecord,
) {
    val items = mutableStateListOf<Favorite>()
    var cursor by mutableStateOf<String?>(null)
    var loading by mutableStateOf(false)
    var initialized by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)

    suspend fun load(
        characterId: String?,
        query: String,
        more: Boolean,
    ) {
        if (loading) return
        loading = true
        error = null
        try {
            userAction({ error = it }) {
                val page =
                    repository.call(
                        Endpoints.libraryEndpointsListFavorites,
                        query =
                            buildMap {
                                put("limit", "20")
                                characterId?.let { put("characterId", it) }
                                query.trim().takeIf { it.isNotEmpty() }?.let { put("q", it.take(50)) }
                                if (more) cursor?.let { put("cursor", it) }
                            },
                        options = SessionCallOptions(owner = owner, networkOnly = true),
                    )
                if (!more) items.clear()
                items.addAll(page.items.filter { item -> items.none { it.favoriteId == item.favoriteId } })
                cursor = page.nextCursor
                initialized = true
            }
        } finally {
            loading = false
        }
    }
}

/**
 * 我的收藏（CHAT-11；design pages/favorites.md）：按角色筛选、搜索、加载更多、多选生成分享图 / 取消收藏。
 * 点开时原消息在本机就跳回聊天定位，否则显示详情。
 */
@Suppress("LongMethod", "CyclomaticComplexMethod") // Search, filters, paged list, selection bar and detail dialog.
@Composable
fun FavoritesScreen(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    onBack: () -> Unit,
    onOpenConversation: (String) -> Unit,
) {
    val context = LocalContext.current
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    val pager = remember(owner) { FavoritesPager(repository, owner) }
    var characterId by remember { mutableStateOf<String?>(null) }
    var query by remember { mutableStateOf("") }
    var selecting by remember { mutableStateOf(false) }
    val selected = remember { mutableStateListOf<String>() }
    var detail by remember { mutableStateOf<Favorite?>(null) }
    var revision by remember { mutableIntStateOf(0) }
    BackHandler {
        if (selecting) {
            selecting = false
            selected.clear()
        } else {
            onBack()
        }
    }
    LaunchedEffect(characterId, query, revision) {
        delay(SEARCH_DEBOUNCE_MS)
        pager.load(characterId, query, more = false)
    }
    LaunchedEffect(pager) {
        AppUpdates.updates.collect { if (it is UserUpdateDataChanged && it.data.section == "favorites") revision++ }
    }
    val snapshot by runtime.snapshot.collectAsState()
    val state = if (snapshot.owner == owner) snapshot.state else SyncEngine.freshState()
    val ids = (state.contacts.map { it.characterId } + pager.items.mapNotNull { it.characterId }).distinct()
    val profiles = characterProfiles(repository, ids)

    fun nameOf(id: String?): String = id?.let { state.contacts.find { c -> c.characterId == it }?.remark ?: profiles[it]?.name } ?: "我"
    val remove: (List<String>) -> Unit = { targets ->
        scope.launch {
            userAction({ toast(context, "操作暂未完成，请稍后再试") }) {
                targets.forEach { id ->
                    repository.call(
                        Endpoints.libraryEndpointsRemoveFavorite,
                        params = mapOf("favoriteId" to id),
                        options = SessionCallOptions(owner = owner, networkOnly = true),
                    )
                    pager.items.removeAll { it.favoriteId == id }
                }
                selected.clear()
                selecting = false
                toast(context, "已取消收藏")
            }
        }
    }
    val open: (Favorite) -> Unit = { favorite ->
        val target = favoriteMessage(favorite)
        val seq = (favorite.source as? JsonObject)?.get("seq")?.jsonPrimitive?.longOrNull
        val local = target?.let { (cid, mid) -> state.messages.find { it.conversationId == cid && it.messageId == mid } }
        if (target != null && seq != null && state.conversations.any { it.conversationId == target.first }) {
            MessageLocator.request(target.first, seq)
            onOpenConversation(target.first)
        } else if (local != null && state.conversations.any { it.conversationId == local.conversationId }) {
            MessageLocator.request(local.conversationId, local.seq)
            onOpenConversation(local.conversationId)
        } else {
            detail = favorite
        }
    }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("‹ 返回") }
            Text("收藏", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
            TextButton(onClick = {
                selecting = !selecting
                selected.clear()
            }) { Text(if (selecting) "取消" else "选择") }
        }
        OutlinedTextField(
            query,
            { query = it.take(50) },
            Modifier.fillMaxWidth().padding(horizontal = WbSpace.S5),
            singleLine = true,
            label = { Text("搜索收藏") },
        )
        Row(
            Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = WbSpace.S5),
            horizontalArrangement = Arrangement.spacedBy(WbSpace.S3),
        ) {
            FilterChip(selected = characterId == null, onClick = { characterId = null }, label = { Text("全部") })
            state.contacts.forEach { contact ->
                FilterChip(
                    selected = characterId == contact.characterId,
                    onClick = { characterId = contact.characterId },
                    label = { Text(contact.remark ?: profiles[contact.characterId]?.name ?: "角色") },
                )
            }
        }
        pager.error?.let { Text(it, Modifier.padding(horizontal = WbSpace.S5), color = MaterialTheme.colorScheme.error) }
        when {
            !pager.initialized && pager.loading -> LinearProgressIndicator(Modifier.fillMaxWidth())
            pager.initialized && pager.items.isEmpty() ->
                Text(
                    if (query.isBlank()) "长按消息选择「收藏」，就会出现在这里" else "没有找到相关收藏",
                    Modifier.padding(WbSpace.S5),
                    color = colors.textSecondary,
                )
        }
        LazyColumn(Modifier.weight(1f)) {
            items(pager.items, key = { it.favoriteId }) { favorite ->
                FavoriteRow(
                    repository,
                    owner,
                    favorite,
                    if (favoriteIsMine(favorite)) "我" else nameOf(favorite.characterId),
                    profiles[favorite.characterId],
                    query,
                    selecting,
                    favorite.favoriteId in selected,
                    onToggle = {
                        if (favorite.favoriteId in selected) selected.remove(favorite.favoriteId) else selected.add(favorite.favoriteId)
                    },
                    onOpen = { open(favorite) },
                    onShare = {
                        if (favorite.shareable) {
                            L6Overlays.shareFavorites(listOf(favorite.favoriteId))
                        } else {
                            toast(context, SHARE_REJECT_TEXT)
                        }
                    },
                    onRemove = { remove(listOf(favorite.favoriteId)) },
                )
            }
            item(key = "more") {
                if (pager.cursor != null) {
                    TextButton(
                        enabled = !pager.loading,
                        onClick = { scope.launch { pager.load(characterId, query, more = true) } },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text(if (pager.loading) "正在加载…" else "加载更多") }
                }
            }
        }
        if (selecting) {
            val chosen = pager.items.filter { it.favoriteId in selected }
            val reason =
                when {
                    chosen.isEmpty() -> null
                    chosen.size > SHARE_MAX_ITEMS -> "一张分享图最多 $SHARE_MAX_ITEMS 条"
                    chosen.any { !it.shareable } -> SHARE_REJECT_TEXT
                    else -> null
                }
            reason?.let {
                Text(
                    it,
                    Modifier.padding(horizontal = WbSpace.S5),
                    color = colors.textSecondary,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            Row(Modifier.fillMaxWidth().padding(WbSpace.S3), horizontalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
                Text("已选 ${chosen.size} 条", Modifier.weight(1f).align(Alignment.CenterVertically))
                OutlinedButton(enabled = chosen.isNotEmpty(), onClick = { remove(chosen.map { it.favoriteId }) }) { Text("取消收藏") }
                Button(enabled = chosen.isNotEmpty() && reason == null, onClick = {
                    L6Overlays.shareFavorites(chosen.sortedBy { it.sourceCreatedAt }.map { it.favoriteId })
                    selecting = false
                    selected.clear()
                }) { Text("生成分享图") }
            }
        }
    }
    detail?.let { favorite ->
        AlertDialog(
            onDismissRequest = { detail = null },
            title = { Text(if (favoriteIsMine(favorite)) "我" else nameOf(favorite.characterId)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
                    Text(contentText(favorite.content))
                    if (favorite.extraImages.isNotEmpty()) Text("[${favorite.extraImages.size} 张图片]", color = colors.textSecondary)
                    Text(
                        favorite.sourceCreatedAt.take(16).replace('T', ' '),
                        color = colors.textTertiary,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            },
            confirmButton = { TextButton(onClick = { detail = null }) { Text("关闭") } },
        )
    }
}

@Suppress("LongParameterList", "LongMethod") // One row with its own menu and selection state.
@Composable
private fun FavoriteRow(
    repository: SessionRepository,
    owner: OwnerRecord,
    favorite: Favorite,
    name: String,
    profile: CharacterProfile?,
    query: String,
    selecting: Boolean,
    checked: Boolean,
    onToggle: () -> Unit,
    onOpen: () -> Unit,
    onShare: () -> Unit,
    onRemove: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    var menu by remember { mutableStateOf(false) }
    ListItem(
        leadingContent = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (selecting) Checkbox(checked = checked, onCheckedChange = { onToggle() })
                val id = favorite.characterId
                if (id != null && !favoriteIsMine(favorite)) {
                    RoleAvatar(
                        repository,
                        owner,
                        RoleAvatarIdentity(
                            id,
                            favorite.characterNameSnapshot ?: profile?.name.orEmpty(),
                            profile?.avatar,
                            favorite.characterAvatarSnapshotMediaId,
                        ),
                        WbSize.AvatarMd,
                    )
                } else {
                    RoleAvatar(repository, owner, RoleAvatarIdentity(owner.userId, "我", null, user = true), WbSize.AvatarMd)
                }
            }
        },
        headlineContent = { Text(highlighted(contentText(favorite.content), query), maxLines = 3) },
        supportingContent = {
            val lock = if (favorite.shareable) "" else "  🔒 不能生成分享图"
            val label = if (favoriteIsMine(favorite)) name else favorite.characterNameSnapshot ?: name
            Text("$label · ${favorite.createdAt.take(10)}$lock", color = colors.textTertiary, style = MaterialTheme.typography.bodySmall)
        },
        trailingContent = {
            if (!selecting) {
                Box {
                    TextButton(onClick = { menu = true }) { Text("•••") }
                    DropdownMenu(menu, { menu = false }) {
                        DropdownMenuItem(text = { Text("生成分享图") }, onClick = {
                            menu = false
                            onShare()
                        })
                        DropdownMenuItem(text = { Text("取消收藏") }, onClick = {
                            menu = false
                            onRemove()
                        })
                    }
                }
            }
        },
        modifier = Modifier.clickable { if (selecting) onToggle() else onOpen() },
    )
    HorizontalDivider(color = colors.borderHairline)
}

private fun toast(
    context: android.content.Context,
    text: String,
) {
    Toast.makeText(context, text, Toast.LENGTH_SHORT).show()
}
