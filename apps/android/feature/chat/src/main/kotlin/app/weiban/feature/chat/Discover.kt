package app.weiban.feature.chat

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import app.weiban.data.*
import app.weiban.designsystem.ComingSoonPage
import app.weiban.designsystem.ComingSoonRow
import app.weiban.designsystem.IconTile
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.LocalWeibanModeColors
import app.weiban.designsystem.MenuGroup
import app.weiban.designsystem.MenuRow
import app.weiban.designsystem.Tint
import app.weiban.designsystem.WbNavBar
import app.weiban.designsystem.WbSheet
import app.weiban.designsystem.tokens.WbSize
import app.weiban.designsystem.tokens.WbSpace

/**
 * 发现页（02a 第 3 节，菜单列表）：朋友圈 ｜ 角色广场 · 视频号* · 直播* ｜ 扫一扫* · 听书* ｜ 看一看* · 搜一搜 ｜ 游戏* · 小程序。
 * 带 * 的进统一「暂未开放」页。momentsTarget 由宿主保存（通知可直达朋友圈）。
 */
@Composable fun DiscoverScreen(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    momentsTarget: String?,
    onMomentsTarget: (String?) -> Unit,
    onOpenConversation: (String) -> Unit,
) {
    val snapshot by runtime.snapshot.collectAsState()
    val state = if (snapshot.owner == owner) snapshot.state else SyncEngine.freshState()
    if (momentsTarget != null) {
        Column(Modifier.fillMaxSize()) { MomentsScreen(repository, owner, state, momentsTarget) { onMomentsTarget(null) } }
        return
    }
    // plaza / search / miniapps / coming:<key>
    var page by rememberSaveable(owner.sessionId) { mutableStateOf<String?>(null) }
    val back: () -> Unit = { page = null }
    when (val current = page) {
        "plaza" -> {
            RolePlazaPage(repository, runtime, owner, back, onOpenConversation)
            return
        }
        "search" -> {
            Column(Modifier.fillMaxSize()) { GlobalSearchScreen(repository, owner, state, back, onOpenConversation) }
            return
        }
        "miniapps" -> {
            MiniAppsHome(repository, owner, back)
            return
        }
        null -> Unit
        else -> {
            ComingSoonPage(current.removePrefix("coming:"), back)
            return
        }
    }
    val badge = rememberMomentsBadge(repository, owner)
    val colors = LocalWeibanColors.current
    val coming: (String) -> Unit = { page = "coming:$it" }
    Column(Modifier.fillMaxSize().background(colors.bgPage).verticalScroll(rememberScrollState())) {
        WbNavBar("发现")
        val profiles = characterProfiles(repository, badge?.characterIds.orEmpty())
        MenuGroup {
            MenuRow(
                "朋友圈",
                "◈",
                Tint.Blue,
                trailing = {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(WbSpace.S2)) {
                        badge?.characterIds?.take(1)?.forEach { id ->
                            RoleAvatar(
                                repository,
                                owner,
                                RoleAvatarIdentity(id, profiles[id]?.name.orEmpty(), profiles[id]?.avatar),
                                WbSize.AvatarSm,
                            )
                        }
                        if ((badge?.unseenPostCount ?: 0) > 0 || (badge?.unseenInteractionCount ?: 0) > 0) {
                            Badge(containerColor = LocalWeibanModeColors.current.badgeUnread)
                        }
                        Text("›", color = colors.textTertiary, style = MaterialTheme.typography.titleLarge)
                    }
                },
            ) { onMomentsTarget("feed") }
        }
        MenuGroup {
            MenuRow("角色广场", "☺", Tint.Orange) { page = "plaza" }
            ComingSoonRow("channels", onOpen = coming)
            ComingSoonRow("live", onOpen = coming)
        }
        MenuGroup {
            ComingSoonRow("scan", onOpen = coming)
            ComingSoonRow("listen", onOpen = coming)
        }
        MenuGroup {
            ComingSoonRow("topstories", onOpen = coming)
            MenuRow("搜一搜", "⌕", Tint.Pink) { page = "search" }
        }
        MenuGroup {
            ComingSoonRow("games", onOpen = coming)
            MenuRow("小程序", "◇", Tint.Lilac, dot = rememberAchievementDot(repository, owner)) { page = "miniapps" }
        }
    }
}

/** 卡册 / 成就的新红点挂在「发现 › 小程序」行（成就有新获得、未看过时）。 */
@Composable private fun rememberAchievementDot(
    repository: SessionRepository,
    owner: OwnerRecord,
): Boolean {
    var dot by remember(owner) { mutableStateOf(false) }
    LaunchedEffect(owner) {
        userAction({}) { dot = !repository.flags.get(owner, ACHIEVEMENT_NEW_FLAG).isNullOrBlank() }
    }
    return dot
}

/** 发现 › 角色广场 / 通讯录 › 角色广场 / ⊕ › 添加角色：预设角色（二级页）。 */
@Composable internal fun RolePlazaPage(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    onBack: () -> Unit,
    onOpenConversation: (String) -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        RoleBrowser(repository, runtime, owner, true, onOpenConversation, onPlazaBack = onBack)
    }
}

/** 发现 › 小程序主页：搜索、最近使用、我的小程序。 */
@Composable internal fun MiniAppsHome(
    repository: SessionRepository,
    owner: OwnerRecord,
    onBack: () -> Unit,
) {
    BackHandler(onBack = onBack)
    val colors = LocalWeibanColors.current
    var query by rememberSaveable { mutableStateOf("") }
    Column(Modifier.fillMaxSize().background(colors.bgPage)) {
        WbNavBar("小程序", onBack)
        MiniAppBrowser(repository, owner, query, { query = it }) { app -> MiniAppNavigation.open(app.id) }
    }
}

/** 小程序浏览部件（小程序主页、下拉面板共用）：搜索框、最近使用、我的小程序。 */
@Composable internal fun MiniAppBrowser(
    repository: SessionRepository,
    owner: OwnerRecord,
    query: String,
    onQuery: (String) -> Unit,
    onOpen: (MiniApp) -> Unit,
) {
    val colors = LocalWeibanColors.current
    val prefs = rememberMiniAppPrefs(repository, owner)
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
        OutlinedTextField(
            query,
            { onQuery(it.take(20)) },
            Modifier.fillMaxWidth().padding(horizontal = WbSpace.S5, vertical = WbSpace.S3),
            placeholder = { Text("搜索小程序") },
            singleLine = true,
        )
        val open: (MiniApp) -> Unit = onOpen
        if (query.isNotBlank()) {
            val found = MiniApp.entries.filter { it.title.contains(query.trim(), true) || it.desc.contains(query.trim(), true) }
            if (found.isEmpty()) Text("没有找到小程序", Modifier.padding(WbSpace.S5), color = colors.textSecondary)
            MiniAppGrid(found, open)
            return@Column
        }
        val recent = prefs.recent
        if (recent.isNotEmpty()) {
            SectionLabel("最近使用")
            MiniAppGrid(recent.take(MINI_RECENT_MAX), open)
        }
        SectionLabel("我的小程序")
        MiniAppGrid(prefs.mine, open)
        val more = MiniApp.entries.filter { it !in prefs.mine }
        if (more.isNotEmpty()) {
            SectionLabel("更多小程序")
            MiniAppGrid(more, open)
        }
    }
}

@Composable private fun SectionLabel(text: String) {
    Text(
        text,
        Modifier.padding(start = WbSpace.S5, top = WbSpace.S5, bottom = WbSpace.S2),
        style = MaterialTheme.typography.bodySmall,
        color = LocalWeibanColors.current.textSecondary,
    )
}

/** 新建角色的方式（通讯录固定行、⊕ 菜单）：自己写 / 从聊天记录生成 / 去人设广场挑。 */
@Composable internal fun NewRoleSheet(
    owner: OwnerRecord,
    onDismiss: () -> Unit,
) {
    WbSheet("新建角色", onDismiss) {
        val choose: (() -> Unit) -> Unit = { action ->
            onDismiss()
            action()
        }
        NewRoleOption("✎", Tint.Green, "自己写一个 TA", "从名字、性格到说话方式，都由你来定") {
            choose { L6Overlays.customEditor.value = CustomEditorOpen(owner) }
        }
        NewRoleOption("⇩", Tint.Teal, "从聊天记录生成 TA", "上传和 TA 的聊天记录，自动整理出人设") {
            choose { MiniAppNavigation.open(MiniApp.Import.id) }
        }
        NewRoleOption("☷", Tint.Blue, "去人设广场挑一个", "看看大家创作的角色，喜欢就带回家") {
            choose { MiniAppNavigation.open(MiniApp.Plaza.id) }
        }
        TextButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth()) { Text("取消") }
    }
}

@Composable private fun NewRoleOption(
    glyph: String,
    tint: Tint,
    title: String,
    desc: String,
    onClick: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .background(colors.bgSurface)
            .padding(horizontal = WbSpace.S5, vertical = WbSpace.S4),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(WbSpace.S4),
    ) {
        IconTile(glyph, tint, WbSize.AvatarMd)
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall)
            Text(desc, color = colors.textSecondary, style = MaterialTheme.typography.bodySmall)
        }
    }
    HorizontalDivider(color = colors.borderHairline)
}
