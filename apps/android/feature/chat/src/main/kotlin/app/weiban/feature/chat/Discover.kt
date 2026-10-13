package app.weiban.feature.chat

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.weiban.core.designsystem.R as DsR
import app.weiban.data.*
import app.weiban.designsystem.ComingSoonPage
import app.weiban.designsystem.ComingSoonRow
import app.weiban.designsystem.DotBadge
import app.weiban.designsystem.GroupHeader
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.LocalWeibanModeColors
import app.weiban.designsystem.LongPressMenu
import app.weiban.designsystem.MenuGroup
import app.weiban.designsystem.MenuItem
import app.weiban.designsystem.MenuRow
import app.weiban.designsystem.NavIcon
import app.weiban.designsystem.Tint
import app.weiban.designsystem.WbIcon
import app.weiban.designsystem.WbNavBar
import app.weiban.designsystem.pressable
import app.weiban.designsystem.tintColor
import app.weiban.designsystem.wbText

/**
 * 发现页（规格 4.8）：朋友圈 ｜ 角色广场 · 直播* ｜ 扫一扫* · 摇一摇* ｜ 看一看* · 搜一搜 ｜ 视频号* · 听一听* ｜ 购物* · 游戏* · 小程序。
 * 带 * 的是「暂未开放」（点了弹轻提示）。momentsTarget 由宿主保存（通知可直达朋友圈）。
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
    val mode = LocalWeibanModeColors.current
    Column(Modifier.fillMaxSize().background(colors.bgPage)) {
        WbNavBar("发现") { NavIcon(DsR.drawable.wb_search, "搜索") { page = "search" } }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 20.dp)) {
            val interactions = (badge?.unseenInteractionCount ?: 0L).toInt()
            val latest = badge?.takeIf { it.unseenPostCount > 0 }?.characterIds?.firstOrNull()
            val profiles = characterProfiles(repository, listOfNotNull(latest))
            MenuGroup {
                MenuRow(
                    "朋友圈",
                    icon = DsR.drawable.wb_discover_moments,
                    iconSize = 24.dp,
                    badge = interactions,
                    trailing =
                        latest?.let { id ->
                            {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Box {
                                        RoleAvatar(
                                            repository,
                                            owner,
                                            RoleAvatarIdentity(id, profiles[id]?.name.orEmpty(), profiles[id]?.avatar),
                                            37.dp,
                                            3.dp,
                                        )
                                        DotBadge(8.dp, null, Modifier.align(Alignment.TopEnd).offset(3.dp, (-3).dp))
                                    }
                                    Spacer(Modifier.width(11.dp))
                                    WbIcon(DsR.drawable.wb_chevron_right, 18.dp, mode.uiChevron)
                                }
                            }
                        },
                ) { onMomentsTarget("feed") }
            }
            MenuGroup {
                MenuRow("角色广场", icon = DsR.drawable.wb_drawn_people, iconTint = tintColor(Tint.Orange)) { page = "plaza" }
                ComingSoonRow("live")
            }
            MenuGroup {
                ComingSoonRow("scan")
                ComingSoonRow("shake")
            }
            MenuGroup {
                ComingSoonRow("topstories")
                MenuRow("搜一搜", icon = DsR.drawable.wb_discover_search, iconTint = mode.tintPink) { page = "search" }
            }
            MenuGroup {
                ComingSoonRow("channels")
                ComingSoonRow("listen")
            }
            MenuGroup {
                ComingSoonRow("shop")
                ComingSoonRow("games")
                MenuRow(
                    "小程序",
                    icon = DsR.drawable.wb_discover_mini_program,
                    iconTint = mode.tintLilac,
                    dot = rememberAchievementDot(repository, owner),
                ) { page = "miniapps" }
            }
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

/** 发现 › 小程序主页（规格 5.1）：搜索条、最近使用横排、「我的小程序」白卡宫格。 */
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

/**
 * 小程序浏览部件。dark = 下拉面板（深灰底 #2C2C2E、白字，规格 4.3）；否则小程序主页（灰底白卡）。
 * 长按图标：最近使用里「移出最近使用 / 添加到我的小程序」；我的小程序里「移到最前 / 移出我的小程序」。
 */
@Composable internal fun MiniAppBrowser(
    repository: SessionRepository,
    owner: OwnerRecord,
    query: String,
    onQuery: (String) -> Unit,
    dark: Boolean = false,
    modifier: Modifier = Modifier,
    onOpen: (MiniApp) -> Unit,
) {
    val colors = LocalWeibanColors.current
    val prefs = rememberMiniAppPrefs(repository, owner)
    var menu by remember { mutableStateOf<Pair<Offset, List<MenuItem>>?>(null) }
    val nameColor = if (dark) Color(0xCCFFFFFF) else colors.textPrimary
    val labelColor = if (dark) Color(0x80FFFFFF) else colors.textSecondary
    Column(modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
        MiniSearchBar(query, onQuery, dark)
        val grid: @Composable (List<MiniApp>, (MiniApp) -> List<MenuItem>) -> Unit = { apps, items ->
            Column(
                Modifier
                    .fillMaxWidth()
                    .then(if (dark) Modifier else Modifier.background(colors.bgSurface))
                    .padding(horizontal = 8.dp, vertical = 4.dp),
            ) {
                apps.chunked(4).forEach { row ->
                    Row(Modifier.fillMaxWidth()) {
                        row.forEach { app ->
                            MiniAppCell(app, Modifier.weight(1f), nameColor, { at -> menu = at to items(app) }) { onOpen(app) }
                        }
                        repeat(4 - row.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
            }
        }
        if (query.isNotBlank()) {
            val found = MiniApp.entries.filter { it.title.contains(query.trim(), true) || it.desc.contains(query.trim(), true) }
            if (found.isEmpty()) {
                Text(
                    "没有找到小程序",
                    Modifier.fillMaxWidth().padding(32.dp),
                    style = wbText(14.sp, color = labelColor),
                    textAlign = TextAlign.Center,
                )
            }
            grid(found) { emptyList() }
            return@Column
        }
        val recent = prefs.recent.take(MINI_RECENT_MAX)
        if (recent.isNotEmpty()) {
            SectionLabel("最近使用", dark, labelColor)
            grid(recent) { app ->
                listOf(
                    MenuItem("移出最近使用") { prefs.toggleRecent(app) },
                    MenuItem(if (app in prefs.mine) "移出我的小程序" else "添加到我的小程序") { prefs.toggleMine(app) },
                )
            }
        }
        SectionLabel("我的小程序", dark, labelColor)
        grid(prefs.mine) { app ->
            listOf(
                MenuItem("移到最前") { prefs.moveToFront(app) },
                MenuItem("移出我的小程序", danger = true) { prefs.toggleMine(app) },
            )
        }
        val more = MiniApp.entries.filter { it !in prefs.mine }
        if (more.isNotEmpty()) {
            SectionLabel("更多小程序", dark, labelColor)
            grid(more) { app -> listOf(MenuItem("添加到我的小程序") { prefs.toggleMine(app) }) }
        }
        Spacer(Modifier.height(24.dp))
    }
    menu?.let { (at, items) -> if (items.isNotEmpty()) LongPressMenu(at, items) { menu = null } else menu = null }
}

/** 搜索条（3.14 / 4.3）：高 38、圆角 8；搜索图标 17 + 「搜索小程序」15。 */
@Composable private fun MiniSearchBar(
    query: String,
    onQuery: (String) -> Unit,
    dark: Boolean,
) {
    val colors = LocalWeibanColors.current
    val mode = LocalWeibanModeColors.current
    val fg = if (dark) Color(0x80FFFFFF) else mode.uiSearchPlaceholder
    Box(Modifier.fillMaxWidth().padding(horizontal = if (dark) 16.dp else 12.dp, vertical = 8.dp)) {
        Row(
            Modifier
                .fillMaxWidth()
                .height(38.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(if (dark) Color(0x1AFFFFFF) else colors.bgSurface)
                .padding(horizontal = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            WbIcon(DsR.drawable.wb_search, 17.dp, fg)
            Spacer(Modifier.width(4.dp))
            Box(Modifier.weight(if (query.isEmpty()) 0.0001f else 1f, fill = query.isNotEmpty())) {
                BasicTextField(
                    query,
                    { onQuery(it.take(20)) },
                    singleLine = true,
                    textStyle = wbText(15.sp, color = if (dark) Color.White else colors.textPrimary),
                    cursorBrush = SolidColor(colors.brandPrimary),
                    decorationBox = { inner ->
                        if (query.isEmpty()) Text("搜索小程序", style = wbText(15.sp, color = fg), maxLines = 1)
                        inner()
                    },
                    modifier = Modifier.widthIn(min = 90.dp),
                )
            }
        }
    }
}

@Composable private fun SectionLabel(
    text: String,
    dark: Boolean,
    color: Color,
) {
    if (dark) {
        Text(text, Modifier.padding(start = 16.dp, top = 24.dp, bottom = 12.dp), style = wbText(14.sp, color = color))
    } else {
        GroupHeader(text)
    }
}

/**
 * 新建角色的方式（通讯录固定行、⊕ 菜单，规格 4.6）：ActionSheet 变体——每项 72 高，左 40 彩色方块 + 标题 17 + 说明 13；
 * 下方 8 空隙 +「取消」。
 */
@Composable internal fun NewRoleSheet(
    owner: OwnerRecord,
    onDismiss: () -> Unit,
) {
    val mode = LocalWeibanModeColors.current
    androidx.compose.ui.window.Dialog(
        onDismissRequest = onDismiss,
        properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Box(
            Modifier
                .fillMaxSize()
                .clickableNoRipple(onDismiss),
        ) {
            Column(Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(10.dp).fillMaxWidth()) {
                val choose: (() -> Unit) -> Unit = { action ->
                    onDismiss()
                    action()
                }
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(mode.uiPopupBg)) {
                    NewRoleOption(DsR.drawable.wb_note, Tint.Green, "自己写一个 TA", "从名字、性格到说话方式，都由你来定") {
                        choose { L6Overlays.customEditor.value = CustomEditorOpen(owner) }
                    }
                    Box(Modifier.fillMaxWidth().height(0.5.dp).background(mode.uiPopupLine))
                    NewRoleOption(DsR.drawable.wb_chat, Tint.Orange, "从聊天记录生成 TA", "上传和 TA 的聊天记录，自动整理出人设") {
                        choose { MiniAppNavigation.open(MiniApp.Import.id) }
                    }
                    Box(Modifier.fillMaxWidth().height(0.5.dp).background(mode.uiPopupLine))
                    NewRoleOption(DsR.drawable.wb_person, Tint.Blue, "去人设广场挑一个", "看看大家创作的角色，喜欢就带回家") {
                        choose { MiniAppNavigation.open(MiniApp.Plaza.id) }
                    }
                }
                Spacer(Modifier.height(8.dp))
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(56.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(mode.uiPopupBg)
                        .clickableNoRipple(onDismiss),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("取消", style = wbText(17.sp, color = mode.uiPopupText))
                }
            }
        }
    }
}

@Composable private fun NewRoleOption(
    icon: Int,
    tint: Tint,
    title: String,
    desc: String,
    onClick: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    Row(
        Modifier
            .fillMaxWidth()
            .height(72.dp)
            .clickableNoRipple(onClick)
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        app.weiban.designsystem.IconTile("", tint, 40.dp, icon)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = wbText(17.sp, color = LocalWeibanModeColors.current.uiPopupText))
            Spacer(Modifier.height(2.dp))
            Text(desc, style = wbText(13.sp, color = colors.textSecondary), maxLines = 1)
        }
    }
}

/** 无水波纹点击（旧版按下态由各部件自己画）。 */
internal fun Modifier.clickableNoRipple(onClick: () -> Unit): Modifier = this.pressable(onClick = onClick)
