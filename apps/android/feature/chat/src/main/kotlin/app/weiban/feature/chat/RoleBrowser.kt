package app.weiban.feature.chat

import android.icu.text.AlphabeticIndex
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import app.weiban.contracts.*
import app.weiban.data.*
import app.weiban.designsystem.ComingSoonPage
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.NavAction
import app.weiban.designsystem.WbNavBar
import app.weiban.designsystem.tokens.WbSpace
import kotlinx.coroutines.launch
import java.text.Collator
import java.util.Locale

@Composable fun RoleBrowser(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    startAtPlaza: Boolean,
    onOpenConversation: (String) -> Unit,
    onboarding: Boolean = false,
    // 首次引导的出口（2026-10-12）：结束引导进入主界面；之后仍可从通讯录「添加角色」加 TA。
    onLeaveOnboarding: () -> Unit = {},
    // 从发现 / 会话列表打开的「角色广场」二级页：标题栏返回。
    onPlazaBack: (() -> Unit)? = null,
    // 宿主要求打开角色广场（宠物引导「先去添加一个 TA」）：值变化时切到广场。
    plazaRequest: Long = 0L,
) {
    var plaza by rememberSaveable(owner.sessionId) { mutableStateOf(startAtPlaza) }
    LaunchedEffect(plazaRequest) { if (plazaRequest > 0) plaza = true }
    var ordinarySelection by rememberSaveable(owner.sessionId) { mutableStateOf<String?>(null) }
    var referral by remember(owner.sessionId) { mutableStateOf<ProfileTarget?>(null) }
    // contacts / newFriends / groups / coming:<key>（通讯录内子页）
    var section by rememberSaveable(owner.sessionId) { mutableStateOf("contacts") }
    var ownCustom by rememberSaveable(owner.sessionId) { mutableStateOf(false) }
    var newRole by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val progress = remember(repository, owner) { OnboardingProgress(repository, owner, scope) }
    LaunchedEffect(progress, onboarding) { if (onboarding) progress.load() }
    val selected = if (onboarding) progress.draft?.characterId else ordinarySelection
    val select: (String?) -> Unit = {
        if (it == null) referral = null
        if (onboarding) progress.choose(it) else ordinarySelection = it
    }
    val snapshot by runtime.snapshot.collectAsState()
    val state = if (snapshot.owner == owner) snapshot.state else SyncEngine.freshState()
    val open by rememberUpdatedState(onOpenConversation)
    val conversationId = state.contacts.find { it.characterId == selected }?.conversationId
    LaunchedEffect(onboarding, owner, selected, conversationId) {
        if (onboarding && conversationId != null) open(conversationId)
    }
    BackHandler(selected != null || plaza != startAtPlaza || (plaza && onPlazaBack != null)) {
        when {
            selected != null -> select(null)
            plaza != startAtPlaza -> plaza = startAtPlaza
            else -> onPlazaBack?.invoke()
        }
    }
    if (newRole) NewRoleSheet(owner) { newRole = false }
    val currentSection = section
    if (!plaza && selected == null && currentSection.startsWith("coming:")) {
        ComingSoonPage(currentSection.removePrefix("coming:")) { section = "contacts" }
        return
    }
    Column(Modifier.fillMaxSize().background(LocalWeibanColors.current.bgPage)) {
        if (!OnboardingHeader(onboarding, progress, scope)) return@Column
        if (onboarding && selected == null) {
            OnboardingExits(
                enabled = !progress.saving,
                onCreate = {
                    L6Overlays.customEditor.value = CustomEditorOpen(owner)
                    onLeaveOnboarding()
                },
                onSkip = onLeaveOnboarding,
            )
        }
        if (selected != null) {
            WbNavBar("", { if (!progress.saving) select(null) })
            CharacterScreen(
                repository,
                runtime,
                owner,
                state,
                selected,
                onOpenConversation,
                progress = progress.takeIf { onboarding },
                referral = referral?.takeIf { it.characterId == selected },
            )
        } else if (plaza) {
            if (!onboarding) {
                WbNavBar("角色广场", if (!startAtPlaza) ({ plaza = false }) else onPlazaBack)
                Row(Modifier.fillMaxWidth().padding(horizontal = WbSpace.S5), horizontalArrangement = Arrangement.spacedBy(WbSpace.S2)) {
                    FilterChip(selected = !ownCustom, onClick = { ownCustom = false }, label = { Text("预设角色") })
                    FilterChip(selected = ownCustom, onClick = { ownCustom = true }, label = { Text("我的角色") })
                }
            }
            if (ownCustom && !onboarding) {
                MyCustomCharacters(repository, owner) { select(it) }
            } else {
                CharacterCatalog(repository, owner) { select(it) }
            }
            if (!onboarding) {
                Text(
                    "看看大家创作的角色 ›",
                    Modifier
                        .fillMaxWidth()
                        .clickable { MiniAppNavigation.open(MiniApp.Plaza.id) }
                        .padding(WbSpace.S5),
                    color = LocalWeibanColors.current.textLink,
                    textAlign = TextAlign.Center,
                )
            }
        } else if (currentSection == "newFriends") {
            NewFriendsPage(repository, owner, state, { section = "contacts" }, { plaza = true }) { target ->
                referral = target
                select(target.characterId)
            }
        } else if (currentSection == "groups") {
            GroupList(repository, owner, state, { section = "contacts" }, onOpenConversation)
        } else {
            WbNavBar("通讯录") { NavAction("添加角色") { plaza = true } }
            ContactsList(repository, owner, state, { select(it) }) {
                ContactsEntries(
                    repository,
                    owner,
                    onNewFriends = { section = "newFriends" },
                    onGroups = { section = "groups" },
                    onNewRole = { newRole = true },
                    onPlaza = { plaza = true },
                    onComingSoon = { section = "coming:$it" },
                )
            }
        }
    }
}

/** 名字的拼音首字母分组（系统 ICU 中文索引，不引第三方库）；非字母归入「#」。 */
private class LetterIndex {
    private val index = AlphabeticIndex<String>(Locale.SIMPLIFIED_CHINESE).buildImmutableIndex()

    fun of(name: String): String {
        val label = index.getBucket(index.getBucketIndex(name)).label
        return if (label.length == 1 && label[0] in 'A'..'Z') label else "#"
    }
}

/** 通讯录列表：搜索就地过滤 + 顶部固定行 + 字母分组 + 底部「N 个角色」。 */
@Composable private fun ColumnScope.ContactsList(
    repository: SessionRepository,
    owner: OwnerRecord,
    state: ClientSyncState,
    onSelect: (String) -> Unit,
    header: @Composable () -> Unit,
) {
    val colors = LocalWeibanColors.current
    var query by rememberSaveable { mutableStateOf("") }
    val profiles = characterProfiles(repository, state.contacts.map { it.characterId })
    val names = profiles.mapValues { it.value.name }
    val ordering = remember { Collator.getInstance(Locale.SIMPLIFIED_CHINESE) }
    val letters = remember { LetterIndex() }
    val display: (Contact) -> String = { it.remark ?: names[it.characterId] ?: "角色" }
    val contacts =
        state.contacts
            .filter { query.isBlank() || (it.remark.orEmpty() + names[it.characterId].orEmpty()).contains(query.trim(), true) }
            .sortedWith { a, b -> ordering.compare(display(a), display(b)) }
    val groups = contacts.groupBy { letters.of(display(it)) }.toSortedMap(compareBy { if (it == "#") "~" else it })
    OutlinedTextField(
        query,
        { query = it.take(50) },
        Modifier.fillMaxWidth().padding(horizontal = WbSpace.S5, vertical = WbSpace.S2),
        placeholder = { Text("搜索名字或备注") },
        singleLine = true,
    )
    LazyColumn(Modifier.weight(1f)) {
        if (query.isBlank()) item(key = "entries") { header() }
        if (contacts.isEmpty()) {
            item(key = "empty") {
                Text(if (state.initialized) "还没有找到角色" else "正在同步通讯录…", Modifier.padding(WbSpace.S5), color = colors.textSecondary)
            }
        }
        groups.forEach { (letter, members) ->
            item(key = "letter:$letter") {
                Text(
                    letter,
                    Modifier.fillMaxWidth().padding(horizontal = WbSpace.S5, vertical = WbSpace.S2),
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textSecondary,
                )
            }
            items(members, key = { it.characterId }) { contact ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .background(colors.bgSurface)
                        .clickable { onSelect(contact.characterId) }
                        .padding(horizontal = WbSpace.S5, vertical = WbSpace.S3),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(WbSpace.S4),
                ) {
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
                    Column(Modifier.weight(1f)) {
                        Text(display(contact))
                        if (contact.status == "pending") {
                            Text("等待通过好友申请", style = MaterialTheme.typography.bodySmall, color = colors.textSecondary)
                        }
                    }
                }
                HorizontalDivider(color = colors.borderHairline)
            }
        }
        item(key = "count") {
            Text(
                "${state.contacts.size} 个角色",
                Modifier.fillMaxWidth().padding(WbSpace.S5),
                style = MaterialTheme.typography.bodySmall,
                color = colors.textTertiary,
                textAlign = TextAlign.Center,
            )
        }
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
    // 列表内容与分页按钮使用本次组合读取的同一份响应。
    val catalog = page.data
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
    LazyColumn(Modifier.weight(1f).fillMaxWidth()) {
        items(catalog?.items.orEmpty(), key = { it.characterId }) { role ->
            ListItem(
                headlineContent = { Text(role.name) },
                leadingContent = { RoleAvatar(repository, owner, RoleAvatarIdentity(role.characterId, role.name, role.avatar)) },
                supportingContent = { Text(role.tagline) },
                trailingContent = { if (role.added) Text("已添加") },
                modifier = Modifier.clickable { onSelect(role.characterId) },
            )
            HorizontalDivider()
        }
        if (!page.loading && catalog?.items?.isEmpty() == true) item { Text("没有找到角色", Modifier.padding(WbSpace.S5)) }
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        if (ui.previous.isNotEmpty()) TextButton(onClick = { ui.back() }, enabled = !page.loading) { Text("上一页角色") }
        catalog?.nextCursor?.let { next -> TextButton(onClick = { ui.next(next) }, enabled = !page.loading) { Text("下一页角色") } }
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

@Composable private fun OnboardingExits(
    enabled: Boolean,
    onCreate: () -> Unit,
    onSkip: () -> Unit,
) {
    Row(Modifier.fillMaxWidth().padding(horizontal = WbSpace.S5), horizontalArrangement = Arrangement.spacedBy(WbSpace.S2)) {
        TextButton(onClick = onCreate, enabled = enabled) { Text("自己创建一个角色") }
        TextButton(onClick = onSkip, enabled = enabled) { Text("先随便看看") }
    }
    Text(
        "之后也可以在「通讯录 → 添加角色」里加 TA",
        Modifier.padding(horizontal = WbSpace.S5),
        style = MaterialTheme.typography.bodySmall,
    )
}

@Composable private fun OnboardingHeader(
    onboarding: Boolean,
    progress: OnboardingProgress,
    scope: kotlinx.coroutines.CoroutineScope,
): Boolean {
    if (!onboarding) return true
    Text("先加一个你喜欢的 TA 吧", Modifier.padding(WbSpace.S5))
    progress.error?.let { Text(it, Modifier.padding(WbSpace.S5), color = MaterialTheme.colorScheme.error) }
    if (!progress.loaded) {
        if (progress.error == null) {
            Text("正在恢复引导…")
        } else {
            TextButton(onClick = { scope.launch { progress.load() } }) { Text("重试") }
        }
    }
    return progress.loaded
}
