package app.weiban.feature.chat

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import app.weiban.contracts.*
import app.weiban.data.*
import app.weiban.designsystem.tokens.WbSpace
import java.text.Collator
import java.util.Locale

@Composable fun RoleBrowser(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    startAtPlaza: Boolean,
    onOpenConversation: (String) -> Unit,
    onboarding: Boolean = false,
) {
    var plaza by rememberSaveable(owner.sessionId) { mutableStateOf(startAtPlaza) }
    var selected by rememberSaveable(owner.sessionId) { mutableStateOf<String?>(null) }
    val snapshot by runtime.snapshot.collectAsState()
    val state = if (snapshot.owner == owner) snapshot.state else SyncEngine.freshState()
    val open by rememberUpdatedState(onOpenConversation)
    val conversationId = state.contacts.find { it.characterId == selected }?.conversationId
    LaunchedEffect(onboarding, owner, selected, conversationId) {
        if (onboarding && conversationId != null) open(conversationId)
    }
    BackHandler(selected != null || plaza != startAtPlaza) {
        if (selected != null) selected = null else plaza = startAtPlaza
    }
    Column(Modifier.fillMaxSize()) {
        if (onboarding) Text("先加一个你喜欢的 TA 吧", Modifier.padding(WbSpace.S5))
        if (selected != null) {
            TextButton(onClick = { selected = null }) { Text("返回") }
            CharacterScreen(repository, runtime, owner, state, selected!!, onOpenConversation)
        } else if (plaza) {
            if (!startAtPlaza) TextButton(onClick = { plaza = false }) { Text("返回通讯录") }
            CharacterCatalog(repository, owner) { selected = it }
        } else {
            ContactsList(repository, owner, state, { plaza = true }) { selected = it }
        }
    }
}

@Composable private fun ColumnScope.ContactsList(
    repository: SessionRepository,
    owner: OwnerRecord,
    state: ClientSyncState,
    onAdd: () -> Unit,
    onSelect: (String) -> Unit,
) {
    var query by rememberSaveable { mutableStateOf("") }
    val profiles = characterProfiles(repository, state.contacts.map { it.characterId })
    val names = profiles.mapValues { it.value.name }
    val ordering = remember { Collator.getInstance(Locale.SIMPLIFIED_CHINESE) }
    val contacts =
        state.contacts
            .filter {
                query.isBlank() || (it.remark.orEmpty() + names[it.characterId].orEmpty()).contains(query, true)
            }.sortedWith {
                a,
                b,
                ->
                ordering.compare(a.remark ?: names[a.characterId].orEmpty(), b.remark ?: names[b.characterId].orEmpty())
            }
    Row(Modifier.fillMaxWidth().padding(WbSpace.S5), horizontalArrangement = Arrangement.SpaceBetween) {
        Text("通讯录", style = MaterialTheme.typography.headlineSmall)
        TextButton(onClick = onAdd) { Text("添加角色") }
    }
    OutlinedTextField(query, { query = it.take(50) }, Modifier.fillMaxWidth().padding(horizontal = WbSpace.S5), label = { Text("搜索名字或备注") })
    if (contacts.isEmpty()) Text(if (state.initialized) "还没有找到角色" else "正在同步通讯录…", Modifier.padding(WbSpace.S5))
    LazyColumn(Modifier.weight(1f)) {
        items(contacts, key = { it.characterId }) { contact ->
            ListItem(
                headlineContent = { Text(contact.remark ?: names[contact.characterId] ?: "角色") },
                leadingContent = {
                    RoleAvatar(
                        repository,
                        owner,
                        RoleAvatarIdentity(
                            contact.characterId,
                            names[contact.characterId].orEmpty(),
                            profiles[contact.characterId]?.avatar,
                            contact.customAvatarMediaId,
                        ),
                    )
                },
                supportingContent = { Text(if (contact.status == "pending") "等待通过好友申请" else "认识于 ${contact.knownSince}") },
                modifier = Modifier.clickable { onSelect(contact.characterId) },
            )
            HorizontalDivider()
        }
        item { Text("${state.contacts.size} 个角色", Modifier.padding(WbSpace.S5), style = MaterialTheme.typography.bodySmall) }
    }
}

private class CatalogUi {
    var query by mutableStateOf("")
    var search by mutableStateOf("")
    var category by mutableStateOf<String?>(null)
    var cursor by mutableStateOf<String?>(null)
    var previous by mutableStateOf<List<String?>>(emptyList())

    fun reset() {
        cursor = null
        previous = emptyList()
    }

    fun next(value: String) {
        previous = previous + cursor
        cursor = value
    }

    fun back() {
        cursor = previous.lastOrNull()
        previous = previous.dropLast(1)
    }
}

@Composable private fun ColumnScope.CharacterCatalog(
    repository: SessionRepository,
    owner: OwnerRecord,
    onSelect: (String) -> Unit,
) {
    val ui = remember { CatalogUi() }
    val key = "${ui.search}:${ui.category}:${ui.cursor}"
    val page =
        remote(key) {
            repository.call(
                Endpoints.characterEndpointsSearchPlaza,
                query =
                    buildMap {
                        put("limit", "50")
                        if (ui.search.isNotBlank()) put("q", ui.search)
                        ui.category?.let { put("categoryId", it) }
                        ui.cursor?.let { put("cursor", it) }
                    },
            )
        }
    Text("角色广场 · 预设角色", Modifier.padding(WbSpace.S5), style = MaterialTheme.typography.headlineSmall)
    Row(Modifier.fillMaxWidth().padding(horizontal = WbSpace.S5)) {
        OutlinedTextField(ui.query, { ui.query = it.take(50) }, Modifier.weight(1f), label = { Text("搜索名字、别名、作品") })
        TextButton(onClick = {
            ui.search = ui.query
            ui.reset()
        }) { Text("搜索") }
    }
    CatalogCategories(repository, ui)
    if (page.error != null) Text(page.error!!, Modifier.padding(WbSpace.S5))
    if (page.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
    LazyColumn(Modifier.weight(1f)) {
        items(page.data?.items.orEmpty(), key = { it.characterId }) { role ->
            ListItem(
                headlineContent = { Text(role.name) },
                leadingContent = { RoleAvatar(repository, owner, RoleAvatarIdentity(role.characterId, role.name, role.avatar)) },
                supportingContent = { Text(role.tagline) },
                trailingContent = { if (role.added) Text("已添加") },
                modifier = Modifier.clickable { onSelect(role.characterId) },
            )
            HorizontalDivider()
        }
        if (!page.loading && page.data?.items?.isEmpty() == true) item { Text("没有找到角色", Modifier.padding(WbSpace.S5)) }
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        if (ui.previous.isNotEmpty()) TextButton(onClick = { ui.back() }, enabled = !page.loading) { Text("上一页角色") }
        page.data?.nextCursor?.let { next -> TextButton(onClick = { ui.next(next) }, enabled = !page.loading) { Text("下一页角色") } }
        if (page.error != null) TextButton(onClick = { page.refresh() }) { Text("重试") }
    }
}

@Composable private fun CatalogCategories(
    repository: SessionRepository,
    ui: CatalogUi,
) {
    val categories = remote("categories") { repository.call(Endpoints.characterEndpointsListCategories) }
    androidx.compose.foundation.lazy.LazyRow(
        Modifier.fillMaxWidth().padding(horizontal = WbSpace.S5),
        horizontalArrangement = Arrangement.spacedBy(WbSpace.S2),
    ) {
        item {
            FilterChip(selected = ui.category == null, onClick = {
                ui.category = null
                ui.reset()
            }, label = { Text("全部") })
        }
        items(categories.data?.items.orEmpty(), key = { it.categoryId }) { category ->
            FilterChip(selected = ui.category == category.categoryId, onClick = {
                ui.category = category.categoryId
                ui.reset()
            }, label = { Text(category.name) })
        }
    }
}
