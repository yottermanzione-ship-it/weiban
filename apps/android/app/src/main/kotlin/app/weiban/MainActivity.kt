package app.weiban

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.lifecycleScope
import app.weiban.contracts.AuthResponse
import app.weiban.core.designsystem.R as DsR
import app.weiban.contracts.Endpoints
import app.weiban.data.OwnerRecord
import app.weiban.designsystem.WeibanTheme
import app.weiban.designsystem.tokens.WbSize
import app.weiban.feature.auth.AuthScreen
import app.weiban.feature.chat.AchievementsScreen
import app.weiban.feature.chat.CallOverlay
import app.weiban.feature.chat.CardAlbumsScreen
import app.weiban.feature.chat.ChatScreen
import app.weiban.feature.chat.DiscoverScreen
import app.weiban.feature.chat.FamiliarityOverviewScreen
import app.weiban.feature.chat.FavoritesScreen
import app.weiban.feature.chat.GrowthNavigation
import app.weiban.feature.chat.GrowthShareOverlay
import app.weiban.feature.chat.LocalCalls
import app.weiban.feature.chat.MyStickersScreen
import app.weiban.feature.chat.PlayNavigation
import app.weiban.feature.chat.RoleBrowser
import app.weiban.feature.chat.rememberMomentsBadge
import app.weiban.feature.me.MeEntry
import app.weiban.feature.me.MeScreen
import app.weiban.feature.me.PeriodMiniApp
import app.weiban.feature.me.ReleaseCenter
import app.weiban.feature.me.ReleasePopups
import app.weiban.network.ApiClient
import app.weiban.platform.CallNotices
import app.weiban.platform.NotificationTarget
import app.weiban.platform.adminNotificationAddress
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onResume() {
        super.onResume()
        (application as WeibanApplication).chat.foreground(true)
        (application as WeibanApplication).calls.foreground(true)
    }

    override fun onPause() {
        (application as WeibanApplication).chat.foreground(false)
        (application as WeibanApplication).calls.foreground(false)
        super.onPause()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        app.weiban.designsystem.DisplayPrefs.init(this)
        ReleaseCenter.versionCode = BuildConfig.VERSION_CODE.toLong()
        ReleaseCenter.versionName = BuildConfig.VERSION_NAME
        val runtime = application as WeibanApplication
        setContent { WeibanRoot(runtime) }
        lifecycleScope.launch {
            // 通话结束后不再显示在锁屏上。
            runtime.calls.state.collect { view -> if (view == null) showOverLockScreen(false) }
        }
        openNotification(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        openNotification(intent)
    }

    private fun openNotification(intent: Intent) {
        val runtime = application as WeibanApplication
        if (intent.action in callActions) {
            openCall(runtime, intent)
            return
        }
        runtime.scope.launch {
            runtime.initialize()
            runtime.push.navigation.open(intent)
        }
    }

    /** 来电全屏通知 / 「接听」/ 通话中通知 / 未接来电：只带 ID，先核对当前账号（T-075）。 */
    private fun openCall(
        runtime: WeibanApplication,
        intent: Intent,
    ) {
        val sessionId = intent.getStringExtra(CallNotices.EXTRA_SESSION) ?: return
        val callId = intent.getStringExtra(CallNotices.EXTRA_CALL)
        val conversationId = intent.getStringExtra(CallNotices.EXTRA_CONVERSATION)
        if (intent.action == CallNotices.ACTION_INCOMING || intent.action == CallNotices.ACTION_ANSWER) showOverLockScreen(true)
        runtime.scope.launch {
            runtime.initialize()
            if (runtime.repository.auth.value
                    ?.session
                    ?.sessionId != sessionId
            ) {
                return@launch
            }
            when (intent.action) {
                CallNotices.ACTION_INCOMING -> callId?.let { runtime.calls.incoming(it) }
                CallNotices.ACTION_ANSWER ->
                    callId?.let {
                        CallNotices.dismissIncoming(runtime, it)
                        runtime.calls.incoming(it, autoAnswer = true)
                    }
                CallNotices.ACTION_OPEN -> runtime.calls.minimize(false)
                CallNotices.ACTION_CHAT -> conversationId?.let { runtime.callRoute.value = "/chat/$it" }
            }
        }
    }

    /** 来电时在锁屏上显示并点亮屏幕；通话结束后恢复（挂断后回到锁屏，media-l5.md 7.2）。 */
    fun showOverLockScreen(show: Boolean) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(show)
            setTurnScreenOn(show)
        } else {
            legacyLockScreen(show)
        }
    }

    @Suppress("DEPRECATION") // Android 8.0 only: window flags predate setShowWhenLocked.
    private fun legacyLockScreen(show: Boolean) {
        val flags = WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        if (show) window.addFlags(flags) else window.clearFlags(flags)
    }

    private companion object {
        val callActions = setOf(CallNotices.ACTION_INCOMING, CallNotices.ACTION_ANSWER, CallNotices.ACTION_OPEN, CallNotices.ACTION_CHAT)
    }
}

@Suppress("TooGenericExceptionCaught") // Restore fails closed or retains the validated offline session.
private suspend fun restoreSession(runtime: WeibanApplication) {
    try {
        runtime.initialize()
        if (runtime.repository.auth.value != null) {
            runtime.repository.updateUser(runtime.repository.call(Endpoints.identityEndpointsMe))
        }
    } catch (error: CancellationException) {
        throw error
    } catch (_: Exception) {
        // The repository handles unauthorized sessions; a transient outage retains the local owner.
    }
}

@Composable private fun WeibanRoot(runtime: WeibanApplication) {
    val auth by runtime.repository.auth.collectAsState()
    var restored by remember { mutableStateOf(false) }
    var theme by rememberSaveable { mutableStateOf("green") }
    val scope = rememberCoroutineScope()
    LaunchedEffect(runtime) {
        restoreSession(runtime)
        restored = true
    }
    WeibanTheme(theme) {
        Surface(Modifier.fillMaxSize(), color = app.weiban.designsystem.LocalWeibanColors.current.bgPage) {
            Box(Modifier.fillMaxSize()) {
            when {
                !restored -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                auth == null -> AuthScreen(runtime.repository)
                else ->
                    key(auth!!.session.sessionId) {
                        val logout: () -> Unit = {
                            val previous = runtime.repository.auth.value
                            scope.launch {
                                runtime.repository.forget()
                                theme = "green"
                            }
                            revokeSession(runtime, previous)
                        }
                        SignedIn(runtime, auth!!, { theme = it }, logout)
                    }
            }
                // 轻提示（规格 3.11）盖在所有页面上。
                app.weiban.designsystem.ToastHost()
            }
        }
    }
}

private fun revokeSession(
    runtime: WeibanApplication,
    previous: AuthResponse?,
) {
    if (previous != null) {
        runtime.scope.launch {
            runCatching {
                ApiClient(BuildConfig.API_BASE_URL).apply { authenticate(previous) }.call(Endpoints.identityEndpointsLogout)
            }
        }
    }
}

private class NavigationUi(
    initialTab: String = "微伴",
    initialConversation: String? = null,
) {
    var tab by mutableStateOf(initialTab)
    var conversationId by mutableStateOf(initialConversation)
    var mePage by mutableStateOf<String?>(null)

    // 通讯录 › 角色广场 的打开请求（宠物引导「先去添加一个 TA」）。
    var plazaRequest by mutableLongStateOf(0L)

    /** 发现页里打开的朋友圈：feed / me / post:<id>；null = 发现首页。 */
    var moments by mutableStateOf<String?>(null)

    fun open(id: String) {
        conversationId = id
        tab = "微伴"
    }

    fun route(value: String) {
        // 玩法页（如慢信推送 /play/letters/{id}）是全局浮层，不切换标签。
        if (value.startsWith("/play/") && PlayNavigation.openRoute(value)) return
        if (value.startsWith("/imports/")) {
            GrowthNavigation.openImport(value.removePrefix("/imports/"))
            return
        }
        conversationId = null
        mePage = null
        moments = null
        if (value.startsWith("/moments/posts/")) {
            tab = "发现"
            moments = "post:" + value.removePrefix("/moments/posts/")
        } else if (value == "/moments") {
            tab = "发现"
            moments = "feed"
        } else if (value.startsWith("/chat/")) {
            open(value.removePrefix("/chat/"))
        } else if (value == "/chat") {
            tab = "微伴"
        } else {
            tab = "我"
            mePage = value.removePrefix("/")
        }
    }

    companion object {
        val saver =
            listSaver<NavigationUi, String>(
                save = { listOf(it.tab, it.conversationId.orEmpty(), it.mePage.orEmpty(), it.moments.orEmpty()) },
                restore = {
                    NavigationUi(it[0], it[1].ifBlank { null }).apply {
                        mePage = it.getOrNull(2)?.ifBlank { null }
                        moments = it.getOrNull(3)?.ifBlank { null }
                    }
                },
            )
    }
}

@Composable private fun SignedIn(
    runtime: WeibanApplication,
    auth: AuthResponse,
    onTheme: (String) -> Unit,
    onLogout: () -> Unit,
) {
    val navigation = rememberSaveable(saver = NavigationUi.saver) { NavigationUi() }
    val onboarding by runtime.repository.onboardingPending.collectAsState()
    val target by runtime.push.navigation.target
        .collectAsState()
    LaunchedEffect(target, auth, onboarding) {
        if (auth.user.profileCompleted && !onboarding) target?.let { applyNotification(runtime, auth, navigation, it) }
    }
    val scope = rememberCoroutineScope()
    if (!auth.user.profileCompleted) {
        Box(Modifier.fillMaxSize().systemBarsPadding()) { MeScreen(runtime.repository, true, onTheme, onLogout) }
    } else if (onboarding) {
        val owner = OwnerRecord(userId = auth.user.userId, sessionId = auth.session.sessionId)
        Box(Modifier.fillMaxSize().systemBarsPadding()) {
            RoleBrowser(runtime.repository, runtime.chat, owner, true, { id ->
                scope.launch { finishOnboarding(runtime, owner, id, navigation::open) }
            }, onboarding = true, onLeaveOnboarding = {
                scope.launch { leaveOnboarding(runtime, owner) }
            })
        }
    } else {
        val owner = OwnerRecord(userId = auth.user.userId, sessionId = auth.session.sessionId)
        // 浮层（导入完成后打开会话等）要求切到某个会话（T-086）。
        val growthConversation by GrowthNavigation.conversation.collectAsState()
        LaunchedEffect(growthConversation) {
            growthConversation?.let {
                navigation.open(it)
                GrowthNavigation.conversation.value = null
            }
        }
        val addRole by GrowthNavigation.addRole.collectAsState()
        LaunchedEffect(addRole) {
            if (addRole > 0) {
                navigation.conversationId = null
                navigation.tab = "通讯录"
                navigation.plazaRequest = addRole
                GrowthNavigation.addRole.value = 0L
            }
        }
        val callRoute by runtime.callRoute.collectAsState()
        LaunchedEffect(callRoute) {
            callRoute?.let {
                navigation.route(it)
                runtime.callRoute.value = null
            }
        }
        CompositionLocalProvider(LocalCalls provides runtime.calls) {
            Box(Modifier.fillMaxSize()) {
                // 不在「微伴」标签时，系统返回先回到「微伴」（规格 4.1）；各页面自己的返回优先。
                BackHandler(navigation.tab != "微伴" && navigation.mePage == null && navigation.moments == null) {
                    navigation.tab = "微伴"
                }
                val immersive by app.weiban.designsystem.LocalImmersive.current
                val hideTabBar by app.weiban.designsystem.LocalHideTabBar.current
                val snapshot by runtime.chat.snapshot.collectAsState()
                val chatUnread =
                    if (snapshot.owner == owner) {
                        snapshot.state.conversations
                            .filter { !it.state.hidden && !it.state.muted }
                            .sumOf { it.unreadCount }
                            .toInt()
                    } else {
                        0
                    }
                Scaffold(
                    containerColor = app.weiban.designsystem.LocalWeibanColors.current.bgNavBar,
                    contentWindowInsets = WindowInsets.navigationBars,
                    bottomBar = {
                        if (navigation.conversationId == null && hideTabBar == 0 && !app.weiban.feature.chat.PullPanelState.open) {
                            val badge = rememberMomentsBadge(runtime.repository, owner)
                            val announcements by ReleaseCenter.announcements.collectAsState()
                            Tabs(
                                navigation.tab,
                                TabBadges(chatUnread, (badge?.unseenInteractionCount ?: 0L).toInt(), (badge?.unseenPostCount ?: 0) > 0),
                                (announcements?.unreadCount ?: 0) > 0,
                            ) {
                                navigation.tab = it
                                navigation.mePage = null
                                navigation.moments = null
                            }
                        }
                    },
                ) { padding ->
                    Box(
                        Modifier
                            .padding(padding)
                            .consumeWindowInsets(padding)
                            .then(if (immersive > 0) Modifier else Modifier.statusBarsPadding()),
                    ) { SignedInPage(runtime, auth, navigation, onTheme, onLogout) }
                }
                // 通话页 / 来电页 / 通话中胶囊盖在所有页面上（design/pages/call.md）。
                CallOverlay(runtime.repository, owner)
                // 分享图编辑页、卡片详情、获得成就轻提示（T-085）。
                GrowthShareOverlay(runtime.repository, runtime.chat, owner) {
                    PeriodMiniApp(runtime.repository, owner) {
                        app.weiban.feature.chat.MiniAppNavigation
                            .close()
                    }
                }
                // 公告 / 本版新功能 / 强制更新弹窗（契约 3.2）。
                ReleasePopups(runtime.repository, owner)
            }
        }
    }
}

@Suppress("TooGenericExceptionCaught") // Storage failure leaves onboarding active and offers a visible retry message.
private suspend fun finishOnboarding(
    runtime: WeibanApplication,
    owner: OwnerRecord,
    conversationId: String,
    onOpen: (String) -> Unit,
) {
    try {
        if (runtime.repository.finishOnboarding(owner)) onOpen(conversationId)
    } catch (error: CancellationException) {
        throw error
    } catch (_: Exception) {
        app.weiban.designsystem.WbToast.show("无法保存引导进度，请重试", app.weiban.designsystem.ToastKind.Warning)
    }
}

/** 首次引导里选「先随便看看」或「自己创建一个角色」：只结束引导，不打开会话。 */
@Suppress("TooGenericExceptionCaught") // Storage failure leaves onboarding active and offers a visible retry message.
private suspend fun leaveOnboarding(
    runtime: WeibanApplication,
    owner: OwnerRecord,
) {
    try {
        runtime.repository.finishOnboarding(owner)
    } catch (error: CancellationException) {
        throw error
    } catch (_: Exception) {
        app.weiban.designsystem.WbToast.show("无法保存引导进度，请重试", app.weiban.designsystem.ToastKind.Warning)
    }
}

@Composable private fun SignedInPage(
    runtime: WeibanApplication,
    auth: AuthResponse,
    navigation: NavigationUi,
    onTheme: (String) -> Unit,
    onLogout: () -> Unit,
) {
    val owner = OwnerRecord(userId = auth.user.userId, sessionId = auth.session.sessionId)
    when (navigation.tab) {
        "我" ->
            when (navigation.mePage) {
                "stickers" -> MyStickersScreen(runtime.repository, owner) { navigation.mePage = null }
                "favorites" ->
                    FavoritesScreen(runtime.repository, runtime.chat, owner, { navigation.mePage = null }, navigation::open)
                "cards" -> CardAlbumsScreen(runtime.repository, runtime.chat, owner) { navigation.mePage = "services" }
                "achievements" -> AchievementsScreen(runtime.repository, owner) { navigation.mePage = "services" }
                "familiarity" -> FamiliarityOverviewScreen(runtime.repository, runtime.chat, owner) { navigation.mePage = "services" }
                else -> MePage(runtime, owner, navigation, onTheme, onLogout)
            }
        "微伴" ->
            ChatScreen(
                runtime.repository,
                runtime.chat,
                owner,
                navigation.conversationId,
                onModelsRequested = { navigation.route("/models") },
            ) { navigation.conversationId = it }
        "发现" ->
            DiscoverScreen(runtime.repository, runtime.chat, owner, navigation.moments, { navigation.moments = it }, navigation::open)
        else ->
            key(navigation.tab) {
                RoleBrowser(runtime.repository, runtime.chat, owner, false, navigation::open, plazaRequest = navigation.plazaRequest)
            }
    }
}

@Composable private fun MePage(
    runtime: WeibanApplication,
    owner: OwnerRecord,
    navigation: NavigationUi,
    onTheme: (String) -> Unit,
    onLogout: () -> Unit,
) {
    MeScreen(
        runtime.repository,
        onTheme = onTheme,
        onLogout = onLogout,
        entry =
            MeEntry(
                navigation.mePage,
                notificationControls(runtime, owner),
                onMyMoments = {
                    navigation.tab = "发现"
                    navigation.moments = "me"
                },
                onMyStickers = { navigation.mePage = "stickers" },
                onFavorites = { navigation.mePage = "favorites" },
                onGrowth = { page ->
                    // 宠物是全局浮层（T-086），其余是「我」里的页面。
                    when {
                        page == "pets" -> GrowthNavigation.openPets()
                        // 五个玩法是全局浮层（T-100）。
                        page.startsWith("play:") -> PlayNavigation.openRoute(page.removePrefix("play:"))
                        else -> navigation.mePage = page
                    }
                },
            ),
    )
}

private fun applyNotification(
    runtime: WeibanApplication,
    auth: AuthResponse,
    navigation: NavigationUi,
    target: NotificationTarget,
) {
    if (target.owner.userId != auth.user.userId || target.owner.sessionId != auth.session.sessionId) return
    if (target.route == "/admin/alerts") {
        val address = adminNotificationAddress(BuildConfig.ADMIN_PUBLIC_ORIGIN)
        if (address != null && auth.user.role == "admin") {
            runCatching { runtime.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(address)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        } else {
            app.weiban.designsystem.WbToast.show("暂时无法打开管理提醒", app.weiban.designsystem.ToastKind.Warning)
        }
    } else {
        navigation.route(target.route)
    }
    runtime.push.navigation.consume(target)
}

/** 标签栏角标：「微伴」= 非免打扰会话未读总数；「发现」= 朋友圈未读互动数（无互动但有新动态时红点）。 */
private data class TabBadges(
    val chat: Int,
    val discover: Int,
    val discoverDot: Boolean,
)

/**
 * 底部标签栏（规格 4.1）：底 bg.bar，顶部 1 物理像素线；位图图标显示在 28×28 内并整体着色（未选 tab.icon、选中 brand）；
 * 文字 10（选中 500）；不做切换动画。
 */
@Composable private fun Tabs(
    tab: String,
    badges: TabBadges,
    meDot: Boolean,
    onSelect: (String) -> Unit,
) {
    val colors = app.weiban.designsystem.LocalWeibanColors.current
    val mode = app.weiban.designsystem.LocalWeibanModeColors.current
    Column(Modifier.fillMaxWidth().background(colors.bgTabBar).windowInsetsPadding(WindowInsets.navigationBars)) {
        Box(Modifier.fillMaxWidth().height(app.weiban.designsystem.hairline).background(mode.uiTabLine))
        Row(Modifier.fillMaxWidth().height(WbSize.TabBar)) {
            for (label in listOf("微伴", "通讯录", "发现", "我")) {
                val selected = tab == label
                val tint = if (selected) colors.brandPrimary else mode.uiTabIcon
                Column(
                    Modifier
                        .weight(1f)
                        .fillMaxHeight()
                        .clickable(indication = null, interactionSource = null) { onSelect(label) },
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Box {
                        Icon(painterResource(tabIcon(label, selected)), label, Modifier.size(28.dp), tint = tint)
                        val count =
                            when (label) {
                                "微伴" -> badges.chat
                                "发现" -> badges.discover
                                else -> 0
                            }
                        val dot = (label == "发现" && count == 0 && badges.discoverDot) || (label == "我" && meDot)
                        if (count > 0) {
                            app.weiban.designsystem.CountBadge(
                                count,
                                Modifier.align(Alignment.TopEnd).offset(x = 10.dp, y = (-4).dp),
                                small = true,
                                stroke = colors.bgTabBar,
                            )
                        } else if (dot) {
                            app.weiban.designsystem.DotBadge(
                                10.dp,
                                colors.bgTabBar,
                                Modifier.align(Alignment.TopEnd).offset(x = 4.dp, y = (-2).dp),
                            )
                        }
                    }
                    Spacer(Modifier.height(2.dp))
                    Text(label, style = app.weiban.designsystem.wbText(10.sp, if (selected) 500 else 400, tint, 1.15f))
                }
            }
        }
    }
}

private fun tabIcon(
    label: String,
    selected: Boolean,
): Int =
    when (label) {
        "微伴" -> if (selected) DsR.drawable.wb_tab_chat_pre else DsR.drawable.wb_tab_chat_nor
        "通讯录" -> if (selected) DsR.drawable.wb_tab_contacts_pre else DsR.drawable.wb_tab_contacts_nor
        "发现" -> if (selected) DsR.drawable.wb_tab_discover_pre else DsR.drawable.wb_tab_discover_nor
        else -> if (selected) DsR.drawable.wb_tab_me_pre else DsR.drawable.wb_tab_me_nor
    }
