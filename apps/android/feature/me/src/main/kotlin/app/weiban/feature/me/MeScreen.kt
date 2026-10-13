package app.weiban.feature.me

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.weiban.contracts.*
import app.weiban.core.designsystem.R as DsR
import app.weiban.data.OwnerRecord
import app.weiban.data.SessionRepository
import app.weiban.designsystem.ActionSheet
import app.weiban.designsystem.ComingSoon
import app.weiban.designsystem.ComingSoonPage
import app.weiban.designsystem.ComingSoonRow
import app.weiban.designsystem.DisplayPrefs
import app.weiban.designsystem.GroupHeader
import app.weiban.designsystem.ImmersiveStatusBar
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.LocalWeibanModeColors
import app.weiban.designsystem.MenuGroup
import app.weiban.designsystem.MenuRow
import app.weiban.designsystem.NavAction
import app.weiban.designsystem.PrimaryButton
import app.weiban.designsystem.SheetAction
import app.weiban.designsystem.ToastKind
import app.weiban.designsystem.WbConfirm
import app.weiban.designsystem.WbIcon
import app.weiban.designsystem.WbNavBar
import app.weiban.designsystem.WbPoints
import app.weiban.designsystem.WbToast
import app.weiban.designsystem.pressable
import app.weiban.designsystem.wbText
import kotlinx.serialization.json.*

@Composable fun MeScreen(
    repository: SessionRepository,
    firstProfile: Boolean = false,
    onTheme: (String) -> Unit,
    onLogout: () -> Unit,
    entry: MeEntry = MeEntry(),
) {
    val auth by repository.auth.collectAsState()
    val owner = auth?.let { OwnerRecord(userId = it.user.userId, sessionId = it.session.sessionId) } ?: return
    key(owner) { MeContent(repository, owner, firstProfile, onTheme, onLogout, entry) }
}

@Composable private fun MeContent(
    repository: SessionRepository,
    owner: OwnerRecord,
    firstProfile: Boolean,
    onTheme: (String) -> Unit,
    onLogout: () -> Unit,
    entry: MeEntry,
) {
    val scope = rememberCoroutineScope()
    val themeCallback = rememberUpdatedState(onTheme)
    val state = remember(repository, owner) { MeState(repository, owner, firstProfile, { themeCallback.value(it) }, scope) }
    LaunchedEffect(state) { state.perform { state.load() } }
    LaunchedEffect(state, entry.page) { if (!firstProfile) entry.page?.let(state::openPage) }
    LaunchedEffect(state.message) { state.message?.let { WbToast.show(it, if (it.startsWith("已")) ToastKind.Success else ToastKind.Warning) } }
    with(state) {
        BackHandler(page != "me" && !firstProfile) { back() }
        val current = page
        if (current.startsWith("coming:")) {
            ComingSoonPage(current.removePrefix("coming:"), ::back)
            return@with
        }
        if (current == "me" && !firstProfile) {
            HomePage(state, entry)
            return@with
        }
        val colors = LocalWeibanColors.current
        Column(Modifier.fillMaxSize().background(colors.bgPage)) {
            if (firstProfile) {
                WbNavBar(pageTitle(current, true), onLogout)
            } else if (current == "profile") {
                WbNavBar(pageTitle(current, false), ::back) { NavAction("保存") { saveProfile(state) } }
            } else {
                WbNavBar(pageTitle(current, false), ::back)
            }
            Box(Modifier.fillMaxWidth().height(2.dp)) {
                if (busy) LinearProgressIndicator(Modifier.fillMaxWidth(), color = colors.brandPrimary)
            }
            Column(Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState())) {
                when {
                    current == "profile" -> ProfilePage(state)
                    current in menuPages && !firstProfile -> MenuPageBody(state, entry, onLogout)
                    current in fullPages -> FullPageBody(state)
                    else ->
                        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                            MePageBody(state, onLogout)
                        }
                }
                Spacer(Modifier.height(32.dp))
            }
        }
    }
}

/** 菜单式页面（整宽菜单行，不加内边距）。 */
private val menuPages = setOf("services", "settings", "account", "general", "about", "announcements", "release-notes", "notifications")

/** 积分等自带旧版布局的整页（第二批）。 */
private val fullPages = setOf("wallet", "recharge", "ledger", "usage", "prices", "models", "leaderboard")

@Composable private fun MenuPageBody(
    state: MeState,
    entry: MeEntry,
    onLogout: () -> Unit,
) {
    when (state.page) {
        "settings" -> MeSettings(state, onLogout)
        "services" -> MeServices(state, entry)
        "account" -> AccountPage(state)
        "general" -> GeneralPage()
        "about" -> AboutPage(state)
        "announcements" -> AnnouncementsPage(state)
        "release-notes" -> ReleaseNotesPage(state)
        "notifications" -> NotificationSettingsPage(state, entry.notifications)
    }
}

@Composable private fun MePageBody(
    state: MeState,
    onLogout: () -> Unit,
) {
    with(state) {
        when (page) {
            "period" -> PeriodDiaryPage(repository, owner)
            "proactive" -> ProactiveDefaultsPage(state)
            "privacy" -> PrivacyPage(state)
            "delete-account" -> AccountDeletionPage(state, onLogout)
        }
    }
}

/**
 * 我的资料（规格 4.14 编辑资料）：顶栏右「保存」；头像块白卡圆角 10（头像 64 + 14 + 说明 15）；
 * 字段行：标签宽 72（16）+ 值 16；分割线 0.5。首次填写时底部主按钮「下一步」。
 */
@Composable private fun ProfilePage(state: MeState) =
    with(state) {
        val colors = LocalWeibanColors.current
        var genderSheet by remember { mutableStateOf(false) }
        if (!firstProfile) {
            Column(
                Modifier.padding(12.dp).fillMaxWidth().background(colors.bgSurface, RoundedCornerShape(10.dp)).padding(16.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    SavedAvatar(repository, owner, profile)
                    Spacer(Modifier.width(14.dp))
                    Text("头像会显示在聊天和朋友圈里", style = wbText(15.sp, color = colors.textSecondary))
                }
                Spacer(Modifier.height(8.dp))
                AvatarPicker(repository) { perform { load() } }
            }
        } else {
            Spacer(Modifier.height(8.dp))
        }
        Column(Modifier.fillMaxWidth().background(colors.bgSurface)) {
            FieldRow("昵称", nickname, "TA 会这样称呼你") { nickname = it.take(20) }
            if (!firstProfile) {
                FieldRow("城市", city, "可不填") { city = it.take(20) }
                FieldRow("生日", birthday, "如 2000-01-01，可不填") { birthday = it.take(10) }
                val genderLabel = genders.find { it.first == gender }?.second ?: "不透露"
                Row(
                    Modifier.fillMaxWidth().height(56.dp).pressable { genderSheet = true }.padding(horizontal = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("性别", Modifier.width(72.dp), style = wbText(16.sp, color = colors.textPrimary))
                    Text(genderLabel, Modifier.weight(1f), style = wbText(16.sp, color = colors.textSecondary))
                    WbIcon(DsR.drawable.wb_chevron_right, 18.dp, LocalWeibanModeColors.current.uiChevron)
                }
                Box(Modifier.fillMaxWidth().padding(start = 16.dp).height(0.5.dp).background(colors.borderHairline))
                FieldRow("签名", about, "写一句话介绍自己") { about = it.take(60) }
            }
        }
        if (firstProfile) {
            Spacer(Modifier.height(24.dp))
            PrimaryButton("下一步", Modifier.padding(horizontal = 32.dp).fillMaxWidth(), enabled = !busy && nickname.isNotBlank()) {
                saveProfile(state)
            }
        }
        if (genderSheet) {
            ActionSheet(genders.map { (id, label) -> SheetAction(label) { gender = id } }, "性别") { genderSheet = false }
        }
    }

private val genders = listOf("unspecified" to "不透露", "female" to "女", "male" to "男", "other" to "其他")

@Composable private fun FieldRow(
    label: String,
    value: String,
    placeholder: String,
    onChange: (String) -> Unit,
) {
    val colors = LocalWeibanColors.current
    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.width(72.dp), style = wbText(16.sp, color = colors.textPrimary))
        BasicTextField(
            value,
            onChange,
            Modifier.weight(1f).padding(vertical = 14.dp),
            singleLine = true,
            textStyle = wbText(16.sp, color = colors.textPrimary),
            cursorBrush = SolidColor(colors.brandPrimary),
            decorationBox = { inner ->
                Box {
                    if (value.isEmpty()) Text(placeholder, style = wbText(16.sp, color = colors.textPlaceholder))
                    inner()
                }
            },
        )
    }
    Box(Modifier.fillMaxWidth().padding(start = 16.dp).height(0.5.dp).background(colors.borderHairline))
}

private fun saveProfile(state: MeState) =
    with(state) {
        perform {
            require(nickname.isNotBlank())
            if (birthday.isNotBlank()) java.time.LocalDate.parse(birthday)
            call(
                Endpoints.identityEndpointsUpdateProfile,
                buildJsonObject {
                    put("nickname", nickname)
                    put("city", if (city.isBlank()) JsonNull else JsonPrimitive(city))
                    put("birthday", if (birthday.isBlank()) JsonNull else JsonPrimitive(birthday))
                    put("about", if (about.isBlank()) JsonNull else JsonPrimitive(about))
                    put("gender", gender)
                },
            )
            val user = call(Endpoints.identityEndpointsMe)
            repository.updateUser(user, owner)
            load()
            if (!firstProfile) message = "已保存"
            page = "me"
        }
    }

/**
 * 我页（规格 4.9）：没有顶栏，白色头卡从状态栏下方开始（内距 左 20、上 状态栏 + 30、右 16、下 26）；
 * 头像 64 圆角 6 → 16 → 昵称 22/500 + 6 +「微伴号：xxx」14 + 积分胶囊 → 箭头；
 * 下方分组：服务 ｜ 收藏 · 朋友圈 · 视频号* · 卡包* · 表情 ｜ 设置（透明底彩色线图）。
 */
@Composable private fun HomePage(
    state: MeState,
    entry: MeEntry,
) = with(state) {
    ImmersiveStatusBar()
    val colors = LocalWeibanColors.current
    val mode = LocalWeibanModeColors.current
    val unread by ReleaseCenter.announcements.collectAsState()
    Column(Modifier.fillMaxSize().background(colors.bgPage).verticalScroll(rememberScrollState())) {
        Row(
            Modifier
                .fillMaxWidth()
                .background(colors.bgSurface)
                .pressable { openPage("profile") }
                .statusBarsPadding()
                .padding(start = 20.dp, top = 30.dp, end = 16.dp, bottom = 26.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            SavedAvatar(repository, owner, profile)
            Spacer(Modifier.width(16.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    profile?.nickname ?: repository.auth.value
                        ?.user
                        ?.username
                        .orEmpty(),
                    style = wbText(22.sp, 500, colors.textPrimary),
                    maxLines = 1,
                )
                Spacer(Modifier.height(6.dp))
                Text("微伴号：${repository.auth.value?.user?.username.orEmpty()}", style = wbText(14.sp, color = colors.textSecondary), maxLines = 1)
                wallet?.let { w ->
                    Spacer(Modifier.height(8.dp))
                    Row(
                        Modifier
                            .border(1.dp, colors.brandPrimary.copy(alpha = 0.32f), RoundedCornerShape(14.dp))
                            .pressable { openPage("wallet") }
                            .padding(horizontal = 10.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        WbIcon(DsR.drawable.wb_membership, 14.dp, null)
                        Spacer(Modifier.width(4.dp))
                        Text(WbPoints.text(w.availablePoints), style = wbText(13.sp, color = colors.brandPrimary))
                    }
                }
            }
            WbIcon(DsR.drawable.wb_chevron_right, 18.dp, mode.uiChevron)
        }
        MenuGroup { MenuRow("服务", icon = DsR.drawable.wb_profile_service, iconSize = 23.dp) { openPage("services") } }
        MenuGroup {
            entry.onFavorites?.let { MenuRow("收藏", icon = DsR.drawable.wb_color_favorites, iconSize = 23.dp, onClick = it) }
            entry.onMyMoments?.let { MenuRow("朋友圈", icon = DsR.drawable.wb_picture, iconTint = mode.tintBlue, onClick = it) }
            ComingSoonRow("channels")
            ComingSoonRow("cards")
            entry.onMyStickers?.let { MenuRow("表情", icon = DsR.drawable.wb_smile, iconTint = mode.tintGold, onClick = it) }
        }
        MenuGroup {
            MenuRow("设置", icon = DsR.drawable.wb_color_settings, iconSize = 23.dp, dot = (unread?.unreadCount ?: 0) > 0) { openPage("settings") }
        }
        Spacer(Modifier.height(24.dp))
    }
}

/**
 * 设置（规格 4.10）：每组前有分组标题——账号 ｜ 通知 ｜ 隐私 ｜ 通用 ｜ 关于 ｜（无标题）退出登录。
 * 青少年模式 / 关怀模式 / 插件仍是「暂未开放」。
 */
@Composable internal fun MeSettings(
    state: MeState,
    onLogout: () -> Unit,
) {
    val unread by ReleaseCenter.announcements.collectAsState()
    var confirmLogout by remember { mutableStateOf(false) }
    MenuGroup("账号") { MenuRow("账号与安全") { state.openPage("account") } }
    MenuGroup("通知") {
        MenuRow("新消息通知", subtitle = "接收角色回复和好友通过提醒") { state.openPage("notifications") }
        MenuRow("主动消息与免打扰") { state.openPage("proactive") }
    }
    MenuGroup("隐私") { MenuRow("隐私") { state.openPage("privacy") } }
    MenuGroup("通用") {
        MenuRow("深色模式", value = DisplayPrefs.darkLabel()) { state.openPage("general") }
        MenuRow("字体大小", value = DisplayPrefs.fontLabel()) { state.openPage("general") }
        MenuRow("聊天背景", value = "暂未开放") { ComingSoon.notice("background") }
        ComingSoonRow("teen", withIcon = false)
        ComingSoonRow("care", withIcon = false)
        ComingSoonRow("plugins", withIcon = false)
    }
    MenuGroup("关于") {
        MenuRow("关于微伴", value = ReleaseCenter.versionName, dot = (unread?.unreadCount ?: 0) > 0) { state.openPage("about") }
    }
    MenuGroup { MenuRow("退出登录", danger = true) { confirmLogout = true } }
    if (confirmLogout) {
        WbConfirm("退出后不会删除任何数据，下次登录仍可使用本账号", "退出登录", danger = true, onDismiss = { confirmLogout = false }) {
            confirmLogout = false
            onLogout()
        }
    }
}

@Composable private fun AccountPage(state: MeState) {
    MenuGroup {
        MenuRow(
            "微伴号",
            value =
                state.repository.auth.value
                    ?.user
                    ?.username
                    .orEmpty(),
        )
        MenuRow("我的资料") { state.openPage("profile") }
    }
    MenuGroup { MenuRow("注销账号", danger = true) { state.openPage("delete-account") } }
}

/** 通用：深色模式（跟随系统 / 浅色 / 深色）、字体大小，本机设置（规格 4.10，单选列表 + 绿色 ✓）。 */
@Composable private fun GeneralPage() {
    val colors = LocalWeibanColors.current
    MenuGroup("深色模式") {
        DisplayPrefs.darkModes.forEach { (id, label) ->
            MenuRow(
                label,
                trailing = if (DisplayPrefs.darkMode == id) ({ WbIcon(DsR.drawable.wb_check, 22.dp, colors.brandPrimary) }) else null,
            ) { DisplayPrefs.updateDarkMode(id) }
        }
    }
    MenuGroup("字体大小") {
        DisplayPrefs.fontScales.forEach { (scale, label) ->
            MenuRow(
                label,
                trailing = if (DisplayPrefs.fontScale == scale) ({ WbIcon(DsR.drawable.wb_check, 22.dp, colors.brandPrimary) }) else null,
            ) { DisplayPrefs.updateFontScale(scale) }
        }
    }
    GroupHeader("字体大小只影响本机，设置后立即生效")
}

/** 余额 / 模型等整页（第二批：积分）。 */
@Composable private fun FullPageBody(state: MeState) {
    when (state.page) {
        "wallet" -> WalletPage(state)
        "recharge" -> RechargePage(state)
        "ledger" -> PointsLedgerPage(state)
        "usage" -> UsagePage(state)
        "prices" -> PricesPage(state)
        "models" -> ModelsPage(state)
        "leaderboard" -> LeaderboardPage(state)
    }
}

private val pageTitles =
    mapOf(
        "profile" to "我的资料",
        "wallet" to "积分",
        "recharge" to "充值",
        "ledger" to "积分明细",
        "usage" to "用量统计",
        "prices" to "价目表",
        "models" to "模型",
        "leaderboard" to "模型排行榜",
        "settings" to "设置",
        "account" to "账号与安全",
        "general" to "通用",
        "about" to "关于微伴",
        "announcements" to "公告",
        "release-notes" to "更新日志",
        "notifications" to "新消息通知",
        "services" to "服务",
        "period" to "经期日记",
        "proactive" to "主动消息与免打扰",
        "privacy" to "隐私",
        "delete-account" to "注销账号",
    )

private fun pageTitle(
    page: String,
    firstProfile: Boolean,
): String = if (firstProfile && page == "profile") "TA 该怎么称呼你？" else pageTitles[page] ?: "我"

