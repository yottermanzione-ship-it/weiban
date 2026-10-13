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
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.weiban.contracts.*
import app.weiban.core.designsystem.R as DsR
import app.weiban.designsystem.pressMenu
import app.weiban.designsystem.pressable
import app.weiban.designsystem.wbText
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
            WbNavBar("详细资料", { if (!progress.saving) select(null) })
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
                app.weiban.designsystem.TextTabs(listOf("预设角色", "我的角色"), if (ownCustom) 1 else 0) { ownCustom = it == 1 }
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
        } else if (currentSection == "search") {
            BackHandler { section = "contacts" }
            GlobalSearchScreen(repository, owner, state, { section = "contacts" }, onOpenConversation)
        } else {
            WbNavBar("通讯录") {
                app.weiban.designsystem.NavIcon(DsR.drawable.wb_search, "搜索") { section = "search" }
                app.weiban.designsystem.NavIcon(DsR.drawable.wb_add_circle, "添加角色") { plaza = true }
            }
            ContactsList(repository, runtime, owner, state, { select(it) }, onOpenConversation) {
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

/**
 * 通讯录列表（规格 4.6）：搜索条就地过滤 + 顶部固定行 + 星标朋友 + 字母分组（标题吸顶）+ 底部「N 个角色」；
 * 右侧字母索引（点按 / 拖动跳转）；长按联系人「发消息 / 设置备注 / 删除」。
 */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun ColumnScope.ContactsList(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    state: ClientSyncState,
    onSelect: (String) -> Unit,
    onOpenConversation: (String) -> Unit,
    header: @Composable () -> Unit,
) {
    val colors = LocalWeibanColors.current
    var query by rememberSaveable { mutableStateOf("") }
    val profiles = characterProfiles(repository, state.contacts.map { it.characterId })
    val names = profiles.mapValues { it.value.name }
    val ordering = remember { Collator.getInstance(Locale.SIMPLIFIED_CHINESE) }
    val letters = remember { LetterIndex() }
    val stars = rememberStars(repository, owner)
    val display: (Contact) -> String = { it.remark ?: names[it.characterId] ?: "角色" }
    val contacts =
        state.contacts
            .filter { query.isBlank() || (it.remark.orEmpty() + names[it.characterId].orEmpty()).contains(query.trim(), true) }
            .sortedWith { a, b -> ordering.compare(display(a), display(b)) }
    val groups = contacts.groupBy { letters.of(display(it)) }.toSortedMap(compareBy { if (it == "#") "~" else it })
    val starred = contacts.filter { it.characterId in stars }
    val list = androidx.compose.foundation.lazy.rememberLazyListState()
    val scope = rememberCoroutineScope()
    var menu by remember { mutableStateOf<Pair<androidx.compose.ui.geometry.Offset, Contact>?>(null) }
    var remarking by remember { mutableStateOf<Contact?>(null) }
    var removing by remember { mutableStateOf<Contact?>(null) }
    ContactSearchBar(query) { query = it.take(50) }
    // 每个分组标题在列表里的位置（右侧索引跳转用）。
    val anchors = mutableMapOf<String, Int>()
    var cursor = if (query.isBlank()) 1 else 0
    if (contacts.isEmpty()) cursor += 1
    if (starred.isNotEmpty() && query.isBlank()) {
        anchors["☆"] = cursor
        cursor += 1 + starred.size
    }
    groups.forEach { (letter, members) ->
        anchors[letter] = cursor
        cursor += 1 + members.size
    }
    Box(Modifier.weight(1f).fillMaxWidth()) {
        LazyColumn(Modifier.fillMaxSize(), state = list) {
            if (query.isBlank()) item(key = "entries") { header() }
            if (contacts.isEmpty()) {
                item(key = "empty") {
                    Text(
                        if (state.initialized) "还没有找到角色" else "正在同步通讯录…",
                        Modifier.fillMaxWidth().padding(32.dp),
                        style = wbText(14.sp, color = colors.textSecondary),
                        textAlign = TextAlign.Center,
                    )
                }
            }
            val row: @Composable (Contact) -> Unit = { contact ->
                ContactRow(repository, owner, contact, profiles, display(contact), { onSelect(contact.characterId) }) { at ->
                    menu = at to contact
                }
            }
            if (starred.isNotEmpty() && query.isBlank()) {
                stickyHeader(key = "letter:☆") { app.weiban.designsystem.GroupHeader("星标朋友") }
                items(starred, key = { "star:" + it.characterId }) { row(it) }
            }
            groups.forEach { (letter, members) ->
                stickyHeader(key = "letter:$letter") { app.weiban.designsystem.GroupHeader(letter) }
                items(members, key = { it.characterId }) { row(it) }
            }
            item(key = "count") {
                Box(Modifier.fillMaxWidth().height(56.dp).background(colors.bgPage), contentAlignment = Alignment.Center) {
                    Text("${state.contacts.size} 个角色", style = wbText(17.sp, color = colors.textSecondary))
                }
            }
        }
        if (anchors.isNotEmpty() && query.isBlank()) {
            LetterRail(anchors.keys.toList(), Modifier.align(Alignment.CenterEnd)) { letter ->
                anchors[letter]?.let { index -> scope.launch { list.scrollToItem(index) } }
            }
        }
    }
    menu?.let { (at, contact) ->
        app.weiban.designsystem.LongPressMenu(
            at,
            listOfNotNull(
                contact.conversationId?.let { id -> app.weiban.designsystem.MenuItem("发消息") { onOpenConversation(id) } },
                app.weiban.designsystem.MenuItem("设置备注") { remarking = contact },
                app.weiban.designsystem.MenuItem("删除", danger = true) { removing = contact },
            ),
        ) { menu = null }
    }
    remarking?.let { contact -> RemarkSheet(repository, runtime, owner, contact) { remarking = null } }
    removing?.let { contact ->
        app.weiban.designsystem.WbConfirm(
            "角色和聊天将从列表移除，30 天内重新添加可恢复",
            "删除",
            title = "删除「${display(contact)}」",
            danger = true,
            onDismiss = { removing = null },
        ) {
            removing = null
            scope.launch {
                userAction({ app.weiban.designsystem.WbToast.show(it) }) {
                    repository.call(
                        Endpoints.contactsEndpointsRemove,
                        params = mapOf("characterId" to contact.characterId),
                        query = mapOf("mode" to "soft"),
                        options = SessionCallOptions(owner = owner),
                    )
                    runtime.refresh(owner)
                }
            }
        }
    }
}

/** 搜索条（3.14）：外框页面灰、内距 12 / 8；条高 38、白底圆角 8；内容居中 search 17 + 「搜索」15。 */
@Composable private fun ContactSearchBar(
    query: String,
    onQuery: (String) -> Unit,
) {
    val colors = LocalWeibanColors.current
    val mode = app.weiban.designsystem.LocalWeibanModeColors.current
    Box(Modifier.fillMaxWidth().background(colors.bgPage).padding(horizontal = 12.dp, vertical = 8.dp)) {
        Row(
            Modifier.fillMaxWidth().height(38.dp).background(colors.bgSurface, RoundedCornerShape(8.dp)).padding(horizontal = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            app.weiban.designsystem.WbIcon(DsR.drawable.wb_search, 17.dp, mode.uiSearchPlaceholder)
            Spacer(Modifier.width(4.dp))
            androidx.compose.foundation.text.BasicTextField(
                query,
                onQuery,
                Modifier.then(if (query.isEmpty()) Modifier.width(60.dp) else Modifier.weight(1f)),
                singleLine = true,
                textStyle = wbText(15.sp, color = colors.textPrimary),
                cursorBrush = androidx.compose.ui.graphics.SolidColor(colors.brandPrimary),
                decorationBox = { inner ->
                    Box {
                        if (query.isEmpty()) Text("搜索", style = wbText(15.sp, color = mode.uiSearchPlaceholder))
                        inner()
                    }
                },
            )
        }
    }
}

/** 联系人行：高 56；头像槽 44 内放头像 40（圆角 4）→ 12 → 名字 17；分割线缩进 72。 */
@Composable private fun ContactRow(
    repository: SessionRepository,
    owner: OwnerRecord,
    contact: Contact,
    profiles: Map<String, CharacterProfile>,
    name: String,
    onClick: () -> Unit,
    onLongPress: (androidx.compose.ui.geometry.Offset) -> Unit,
) {
    val colors = LocalWeibanColors.current
    Column(Modifier.fillMaxWidth().background(colors.bgSurface)) {
        Row(
            Modifier.fillMaxWidth().height(56.dp).pressMenu(onClick, onLongPress).padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(44.dp), contentAlignment = Alignment.Center) {
                RoleAvatar(
                    repository,
                    owner,
                    RoleAvatarIdentity(contact.characterId, profiles[contact.characterId]?.name.orEmpty(), profiles[contact.characterId]?.avatar, contact.customAvatarMediaId),
                    40.dp,
                    4.dp,
                )
            }
            Spacer(Modifier.width(12.dp))
            Text(name, Modifier.weight(1f), style = wbText(17.sp, color = colors.textPrimary), maxLines = 1)
            if (contact.status == "pending") {
                Text("等待通过", style = wbText(13.sp, color = app.weiban.designsystem.LocalWeibanModeColors.current.uiPending))
            }
        }
        Box(Modifier.fillMaxWidth().padding(start = 72.dp).height(app.weiban.designsystem.hairline).background(colors.borderHairline))
    }
}

/** 右侧字母索引（4.6）：宽 24，每个字母高 16，字 10/500 #555；点按 / 拖动跳到对应分组。 */
@Composable private fun LetterRail(
    letters: List<String>,
    modifier: Modifier,
    onJump: (String) -> Unit,
) {
    val itemHeight = with(androidx.compose.ui.platform.LocalDensity.current) { 16.dp.toPx() }
    val jump by rememberUpdatedState(onJump)
    val color = if (app.weiban.designsystem.LocalWbDark.current) LocalWeibanColors.current.textSecondary else androidx.compose.ui.graphics.Color(0xFF555555)
    Column(
        modifier
            .width(24.dp)
            .pointerInput(letters) {
                awaitEachGesture {
                    val down = awaitFirstDown()
                    var index = (down.position.y / itemHeight).toInt()
                    letters.getOrNull(index)?.let(jump)
                    while (true) {
                        val event = awaitPointerEvent()
                        val change = event.changes.firstOrNull() ?: break
                        if (!change.pressed) break
                        val next = (change.position.y / itemHeight).toInt().coerceIn(0, letters.size - 1)
                        if (next != index) {
                            index = next
                            letters.getOrNull(index)?.let(jump)
                        }
                        change.consume()
                    }
                }
            },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        letters.forEach { letter ->
            Box(Modifier.height(16.dp), contentAlignment = Alignment.Center) {
                Text(letter, style = wbText(10.sp, 500, color, 1f))
            }
        }
    }
}

/** 设置备注：底部弹层单行输入，「完成」保存（只有你看得到）。 */
@Composable private fun RemarkSheet(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    contact: Contact,
    onDismiss: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    var value by remember { mutableStateOf(contact.remark.orEmpty()) }
    app.weiban.designsystem.WbSheet("设置备注", onDismiss, action = "完成" to {
        onDismiss()
        scope.launch {
            userAction({ app.weiban.designsystem.WbToast.show(it) }) {
                repository.call(
                    Endpoints.contactsEndpointsUpdate,
                    params = mapOf("characterId" to contact.characterId),
                    body =
                        kotlinx.serialization.json.buildJsonObject {
                            put("remark", value.takeIf { it.isNotBlank() }?.let { kotlinx.serialization.json.JsonPrimitive(it) } ?: kotlinx.serialization.json.JsonNull)
                            put("relationship", kotlinx.serialization.json.JsonPrimitive(contact.relationship ?: "朋友"))
                            put("addressAs", contact.addressAs?.let { kotlinx.serialization.json.JsonPrimitive(it) } ?: kotlinx.serialization.json.JsonNull)
                        },
                    options = SessionCallOptions(owner = owner),
                )
                runtime.history.synchronize(owner)
            }
        }
    }) {
        Column(Modifier.fillMaxWidth().background(colors.bgSurface).padding(16.dp)) {
            androidx.compose.foundation.text.BasicTextField(
                value,
                { if (it.length <= 20) value = it },
                Modifier.fillMaxWidth().background(colors.bgPage, RoundedCornerShape(6.dp)).padding(12.dp),
                singleLine = true,
                textStyle = wbText(17.sp, color = colors.textPrimary),
                cursorBrush = androidx.compose.ui.graphics.SolidColor(colors.brandPrimary),
            )
            Text("备注只有你自己看得到", Modifier.padding(top = 8.dp), style = wbText(13.sp, color = colors.textSecondary))
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
    CatalogSearch(ui)
    CatalogCategories(repository, ui)
    val colors = LocalWeibanColors.current
    page.error?.let { Text(it, Modifier.padding(horizontal = 16.dp, vertical = 8.dp), style = wbText(13.sp, color = colors.textDanger)) }
    Box(Modifier.fillMaxWidth().height(2.dp)) { if (page.loading) LinearProgressIndicator(Modifier.fillMaxWidth(), color = colors.brandPrimary) }
    LazyColumn(Modifier.weight(1f).fillMaxWidth()) {
        items(catalog?.items.orEmpty(), key = { it.characterId }) { role ->
            Column(Modifier.fillMaxWidth().background(colors.bgSurface)) {
                Row(
                    Modifier.fillMaxWidth().height(72.dp).pressable { onSelect(role.characterId) }.padding(horizontal = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RoleAvatar(repository, owner, RoleAvatarIdentity(role.characterId, role.name, role.avatar), 48.dp, 4.dp)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(role.name, style = wbText(17.sp, color = colors.textPrimary), maxLines = 1)
                        Spacer(Modifier.height(4.dp))
                        Text(role.tagline, style = wbText(14.sp, color = colors.textSecondary), maxLines = 1)
                    }
                    if (role.added) Text("已添加", style = wbText(14.sp, color = colors.textPlaceholder))
                }
                Box(Modifier.fillMaxWidth().padding(start = 76.dp).height(app.weiban.designsystem.hairline).background(colors.borderHairline))
            }
        }
        if (!page.loading && catalog?.items?.isEmpty() == true) {
            item { app.weiban.designsystem.EmptyState("没有找到角色", DsR.drawable.wb_search) }
        }
        item {
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
                if (ui.previous.isNotEmpty()) PagerLink("上一页", !page.loading) { ui.back() }
                catalog?.nextCursor?.let { next -> PagerLink("下一页", !page.loading) { ui.next(next) } }
                if (page.error != null) PagerLink("重试", true) { page.refresh() }
            }
        }
    }
}

@Composable private fun CatalogCategories(
    repository: SessionRepository,
    ui: CatalogUi,
) {
    val categories = remote("categories") { repository.call(Endpoints.characterEndpointsListCategories) }
    val items = categories.data?.items.orEmpty()
    Box(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
        app.weiban.designsystem.TextTabs(
            listOf("全部") + items.map { it.name },
            items.indexOfFirst { it.categoryId == ui.category } + 1,
            Modifier.wrapContentWidth(),
        ) { index ->
            ui.category = items.getOrNull(index - 1)?.categoryId
            ui.reset()
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

/** 角色广场搜索条：白底圆角 8、高 38；回车搜索。 */
@Composable private fun CatalogSearch(ui: CatalogUi) {
    val colors = LocalWeibanColors.current
    val mode = app.weiban.designsystem.LocalWeibanModeColors.current
    Box(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)) {
        Row(
            Modifier.fillMaxWidth().height(38.dp).background(colors.bgSurface, RoundedCornerShape(8.dp)).padding(horizontal = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            app.weiban.designsystem.WbIcon(DsR.drawable.wb_search, 17.dp, mode.uiSearchPlaceholder)
            Spacer(Modifier.width(6.dp))
            androidx.compose.foundation.text.BasicTextField(
                ui.query,
                { ui.query = it.take(50) },
                Modifier.weight(1f),
                singleLine = true,
                textStyle = wbText(15.sp, color = colors.textPrimary),
                cursorBrush = androidx.compose.ui.graphics.SolidColor(colors.brandPrimary),
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Search),
                keyboardActions =
                    androidx.compose.foundation.text.KeyboardActions(onSearch = {
                        ui.search = ui.query
                        ui.reset()
                    }),
                decorationBox = { inner ->
                    Box {
                        if (ui.query.isEmpty()) Text("搜索名字、别名、作品", style = wbText(15.sp, color = mode.uiSearchPlaceholder))
                        inner()
                    }
                },
            )
        }
    }
}

@Composable private fun PagerLink(
    label: String,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Text(
        label,
        Modifier.clickableNoRipple { if (enabled) onClick() }.padding(12.dp),
        style = wbText(15.sp, color = if (enabled) LocalWeibanColors.current.textLink else LocalWeibanColors.current.textPlaceholder),
    )
}
