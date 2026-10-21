package app.weiban.feature.me

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import app.weiban.contracts.*
import app.weiban.data.OwnerRecord
import app.weiban.data.SessionRepository
import app.weiban.designsystem.ComingSoonPage
import app.weiban.designsystem.ComingSoonRow
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.MenuGroup
import app.weiban.designsystem.MenuRow
import app.weiban.designsystem.Tint
import app.weiban.designsystem.WbNavBar
import app.weiban.designsystem.tokens.WbRadius
import app.weiban.designsystem.tokens.WbSpace
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
    with(state) {
        BackHandler(page != "me" && !firstProfile) { back() }
        val current = page
        if (current.startsWith("coming:")) {
            ComingSoonPage(current.removePrefix("coming:"), ::back)
            return@with
        }
        Column(Modifier.fillMaxSize().background(LocalWeibanColors.current.bgPage)) {
            if (!firstProfile && current != "me") WbNavBar(pageTitle(current, false), ::back)
            Column(Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState())) {
                if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                message?.let { Text(it, Modifier.padding(horizontal = WbSpace.S5), color = MaterialTheme.colorScheme.error) }
                if (current in menuPages && !firstProfile) {
                    MenuPageBody(state, entry, onLogout)
                } else {
                    Column(Modifier.fillMaxWidth().padding(WbSpace.S5), verticalArrangement = Arrangement.spacedBy(WbSpace.S5)) {
                        if (firstProfile) {
                            TextButton(onClick = onLogout) { Text("‹ 返回登录") }
                            Text(pageTitle(current, true), style = MaterialTheme.typography.headlineSmall)
                        }
                        MePageBody(state, entry, onLogout)
                    }
                }
                Spacer(Modifier.height(WbSpace.S8))
            }
        }
    }
}

/** 菜单式页面（整宽菜单行，不加内边距）。 */
private val menuPages = setOf("me", "services", "settings", "account", "general", "about", "announcements", "release-notes")

@Composable private fun MenuPageBody(
    state: MeState,
    entry: MeEntry,
    onLogout: () -> Unit,
) {
    when (state.page) {
        "settings" -> MeSettings(state, onLogout)
        "services" -> MeServices(state, entry)
        "account" -> AccountPage(state)
        "general" -> GeneralPage(state)
        "about" -> AboutPage(state)
        "announcements" -> AnnouncementsPage(state)
        "release-notes" -> ReleaseNotesPage(state)
        else -> HomePage(state, entry)
    }
}

@Composable private fun MePageBody(
    state: MeState,
    entry: MeEntry,
    onLogout: () -> Unit,
) {
    with(state) {
        when (page) {
            "profile" -> ProfilePage(state)
            "wallet" -> {
                BudgetPage(state)
                LedgerPage(state)
            }
            "models" -> {
                ModelChoices(state, "chat", "聊天模型")
                ModelChoices(state, "background", "后台任务模型")
                ModelChoices(state, "adult", "成人模式模型")
                Text("成人模式模型未设置时不能开启成人模式；具体对话仍受角色与账号规则约束。")
            }
            "theme" -> ThemePage(state)
            "notifications" -> NotificationSettingsPage(state, entry.notifications)
            "period" -> PeriodDiaryPage(repository, owner)
            "proactive" -> ProactiveDefaultsPage(state)
            "privacy" -> PrivacyPage(state)
            "support" -> SupportPage(state)
            "support-new" -> SupportCreatePage(state)
            "delete-account" -> AccountDeletionPage(state, onLogout)
            else -> if (page.startsWith("support-ticket:")) SupportTicketPage(state, page.removePrefix("support-ticket:"))
        }
    }
}

@Composable private fun ProfilePage(state: MeState) =
    with(state) {
        OutlinedTextField(
            nickname,
            { nickname = it },
            label = { Text("昵称") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        var details by remember { mutableStateOf(!firstProfile) }
        TextButton(onClick = { details = !details }) { Text("补充更多资料（可选）") }
        if (details) ProfileDetails(state)
        ProfileSave(state)
    }

@Composable private fun ProfileDetails(state: MeState) =
    with(state) {
        SavedAvatar(repository, owner, profile)
        AvatarPicker(repository) { perform { load() } }
        OutlinedTextField(city, { city = it }, label = { Text("城市（可不填）") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(birthday, {
            birthday = it
        }, label = { Text("生日（可不填，如 2000-01-01）") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Row(horizontalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
            for ((id, label) in listOf(
                "unspecified" to "不透露",
                "female" to "女",
                "male" to "男",
                "other" to "其他",
            )) {
                FilterChip(selected = gender == id, onClick = { gender = id }, label = { Text(label) })
            }
        }
        OutlinedTextField(about, { about = it }, label = { Text("个性签名") }, modifier = Modifier.fillMaxWidth())
    }

@Composable private fun ProfileSave(state: MeState) =
    with(state) {
        Button(enabled = !busy, onClick = {
            perform {
                require(nickname.isNotBlank())
                if (birthday.isNotBlank())java.time.LocalDate.parse(birthday)
                call(
                    Endpoints.identityEndpointsUpdateProfile,
                    buildJsonObject {
                        put("nickname", nickname)
                        put("city", if (city.isBlank())JsonNull else JsonPrimitive(city))
                        put("birthday", if (birthday.isBlank())JsonNull else JsonPrimitive(birthday))
                        put("about", if (about.isBlank())JsonNull else JsonPrimitive(about))
                        put("gender", gender)
                    },
                )
                val user = call(Endpoints.identityEndpointsMe)
                repository.updateUser(user, owner)
                load()
                page = "me"
            }
        }) { Text(if (firstProfile) "下一步" else "保存") }
    }

@Composable private fun BudgetPage(state: MeState) =
    with(state) {
        wallet?.let {
            Text("¥ ${yuan(it.availableMicros)}", style = MaterialTheme.typography.headlineLarge)
            Text("当前余额 ¥${yuan(it.balanceMicros)} · 处理中 ¥${yuan(it.heldMicros)}")
        }
        OutlinedTextField(
            threshold,
            {
                threshold = it
            },
            label = {
                Text("余额低于多少元时提醒")
            },
            singleLine = true,
            keyboardOptions =
                KeyboardOptions(
                    keyboardType = KeyboardType.Decimal,
                ),
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            daily,
            {
                daily = it
            },
            label = {
                Text("每天后台任务最多花费（元）")
            },
            singleLine = true,
            keyboardOptions =
                KeyboardOptions(
                    keyboardType = KeyboardType.Decimal,
                ),
            modifier = Modifier.fillMaxWidth(),
        )
        Button(enabled = !busy, onClick = {
            perform {
                wallet =
                    call(
                        Endpoints.billingEndpointsUpdateWalletSettings,
                        buildJsonObject {
                            put("lowBalanceThresholdMicros", micros(threshold))
                            put("backgroundDailyLimitMicros", micros(daily))
                        },
                    )
                ;message =
                    "已保存"
            }
        }) { Text("保存提醒与预算") }
    }

@Composable private fun LedgerPage(state: MeState) =
    with(state) {
        HorizontalDivider()
        Text("余额流水", style = MaterialTheme.typography.titleMedium)
        if (ledger.isEmpty())Text("暂无记录")
        for (entry in ledger) {
            ListItem(headlineContent = {
                Text(
                    entry.note ?: when (entry.type) {
                        "credit" -> "余额增加"
                        "refund" -> "退回"
                        else -> "余额变动"
                    },
                )
            }, supportingContent = {
                Text(entry.createdAt.replace('T', ' ').take(16))
            }, trailingContent = { Text("${if (entry.amountMicros > 0) "+" else ""}${yuan(entry.amountMicros)}") })
        }
        if (cursor !=
            null
        ) {
            TextButton(enabled = !busy, onClick = {
                perform {
                    val result =
                        call(
                            Endpoints.billingEndpointsListLedger,
                            query =
                                mapOf("cursor" to cursor!!),
                        )
                    ;ledger = ledger + result.items
                    cursor = result.nextCursor
                }
            }) { Text("加载更多") }
        }
    }

/** 我页（02a 第 4 节）：头部 + 服务 ｜ 收藏 · 朋友圈 · 视频号* · 卡包* · 表情 ｜ 设置。 */
@Composable private fun HomePage(
    state: MeState,
    entry: MeEntry,
) = with(state) {
    val colors = LocalWeibanColors.current
    val unread by ReleaseCenter.announcements.collectAsState()
    Row(
        Modifier
            .fillMaxWidth()
            .background(colors.bgSurface)
            .clickable { openPage("profile") }
            .padding(start = WbSpace.S7, end = WbSpace.S5, top = WbSpace.S9, bottom = WbSpace.S7),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(WbSpace.S5),
    ) {
        SavedAvatar(repository, owner, profile)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(WbSpace.S2)) {
            Text(
                profile?.nickname ?: repository.auth.value
                    ?.user
                    ?.username
                    .orEmpty(),
                style = MaterialTheme.typography.headlineSmall,
            )
            Text("微伴号：${repository.auth.value?.user?.username.orEmpty()}", color = colors.textSecondary)
            Text(
                "+ 状态",
                Modifier
                    .clip(RoundedCornerShape(WbRadius.Full))
                    .border(1.dp, colors.borderHairline, RoundedCornerShape(WbRadius.Full))
                    .clickable { openPage("coming:status") }
                    .padding(horizontal = WbSpace.S3, vertical = WbSpace.S1),
                color = colors.textSecondary,
                style = MaterialTheme.typography.bodySmall,
            )
        }
        Text("▦", Modifier.clickable { openPage("coming:qrcode") }.padding(WbSpace.S3), color = colors.textSecondary)
        Text("›", color = colors.textTertiary, style = MaterialTheme.typography.titleLarge)
    }
    MenuGroup { MenuRow("服务", "✓", Tint.Green) { openPage("services") } }
    MenuGroup {
        entry.onFavorites?.let { MenuRow("收藏", "★", Tint.Orange, onClick = it) }
        entry.onMyMoments?.let { MenuRow("朋友圈", "◈", Tint.Blue, onClick = it) }
        ComingSoonRow("channels") { openPage("coming:$it") }
        ComingSoonRow("cards") { openPage("coming:$it") }
        entry.onMyStickers?.let { MenuRow("表情", "☺", Tint.Gold, onClick = it) }
    }
    MenuGroup { MenuRow("设置", "⚙", Tint.Blue, dot = (unread?.unreadCount ?: 0) > 0) { openPage("settings") } }
}

/** 设置：账号与安全 ｜ 青少年模式* · 关怀模式* ｜ 主动消息与免打扰 · 隐私 · 通用 ｜ 推送 ｜ 关于微伴 · 插件* ｜ 退出登录。 */
@Composable internal fun MeSettings(
    state: MeState,
    onLogout: () -> Unit,
) {
    val unread by ReleaseCenter.announcements.collectAsState()
    val coming: (String) -> Unit = { state.openPage("coming:$it") }
    MenuGroup { MenuRow("账号与安全") { state.openPage("account") } }
    MenuGroup {
        ComingSoonRow("teen", withIcon = false, onOpen = coming)
        ComingSoonRow("care", withIcon = false, onOpen = coming)
    }
    MenuGroup {
        MenuRow("主动消息与免打扰") { state.openPage("proactive") }
        MenuRow("隐私") { state.openPage("privacy") }
        MenuRow("通用") { state.openPage("general") }
    }
    MenuGroup { MenuRow("推送") { state.openPage("notifications") } }
    MenuGroup {
        MenuRow("关于微伴", value = ReleaseCenter.versionName, dot = (unread?.unreadCount ?: 0) > 0) { state.openPage("about") }
        MenuRow("帮助与反馈") { state.openPage("support") }
        ComingSoonRow("plugins", withIcon = false, onOpen = coming)
    }
    MenuGroup { MenuRow("退出登录", danger = true, onClick = onLogout) }
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

@Composable private fun GeneralPage(state: MeState) {
    MenuGroup { MenuRow("主题") { state.openPage("theme") } }
}

@Composable private fun ModelChoices(
    state: MeState,
    kind: String,
    title: String,
) = with(state) {
    Text(title, style = MaterialTheme.typography.titleMedium)
    val candidates = models.filter { kind == "adult" || "adult_content" !in it.capabilities }
    if (candidates.isEmpty()) Text("暂时没有可选模型，请联系管理员")
    val selected =
        when (kind) {
            "chat" -> selection?.chat?.modelKey
            "adult" -> selection?.adult?.modelKey
            else -> selection?.background?.modelKey
        }
    ModelDefault(state, kind, selected)
    for (model in candidates) {
        ListItem(headlineContent = { Text(model.displayName) }, supportingContent = {
            Text(model.vendorName + if (model.available) "" else " · 暂不可用")
        }, trailingContent = {
            RadioButton(selected = selected == model.modelKey, enabled = model.available && !busy, onClick = {
                perform {
                    selection =
                        call(
                            Endpoints.modelAccessEndpointsUpdateSelection,
                            buildJsonObject {
                                put(kind, buildJsonObject { put("modelKey", model.modelKey) })
                            },
                        )
                }
            })
        })
    }
}

@Composable private fun ThemePage(state: MeState) =
    with(state) {
        for ((id, label) in listOf("green" to "默认", "pink" to "微伴粉")) {
            OutlinedButton(enabled = !busy, onClick = {
                perform {
                    val prefs = call(Endpoints.identityEndpointsUpdatePreferences, buildJsonObject { put("theme", id) })
                    onTheme(prefs.theme)
                }
            }) { Text(label) }
        }
    }

private val pageTitles =
    mapOf(
        "profile" to "我的资料",
        "wallet" to "余额与账单",
        "models" to "模型选择",
        "theme" to "主题",
        "settings" to "设置",
        "account" to "账号与安全",
        "general" to "通用",
        "about" to "关于微伴",
        "announcements" to "公告",
        "release-notes" to "更新日志",
        "notifications" to "推送",
        "services" to "服务",
        "period" to "经期日记",
        "proactive" to "主动消息与免打扰",
        "privacy" to "隐私",
        "support" to "帮助与反馈",
        "support-new" to "提交反馈",
        "delete-account" to "注销账号",
    )

private fun pageTitle(
    page: String,
    firstProfile: Boolean,
): String =
    if (firstProfile &&
        page == "profile"
    ) {
        "TA 该怎么称呼你？"
    } else if (page.startsWith("support-ticket:")) {
        "反馈详情"
    } else {
        pageTitles[page] ?: "我"
    }

@Composable private fun ModelDefault(
    state: MeState,
    kind: String,
    selected: String?,
) = with(state) {
    val title =
        when (kind) {
            "chat" -> "平台默认"
            "background" -> "沿用聊天模型"
            else -> "未设置"
        }
    ListItem(headlineContent = { Text(title) }, trailingContent = {
        RadioButton(selected = selected == null, enabled = !busy, onClick = {
            perform {
                selection = call(Endpoints.modelAccessEndpointsUpdateSelection, buildJsonObject { put(kind, JsonNull) })
            }
        })
    })
}
