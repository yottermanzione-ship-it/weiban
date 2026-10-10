package app.weiban

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import app.weiban.contracts.AuthResponse
import app.weiban.contracts.Endpoints
import app.weiban.data.OwnerRecord
import app.weiban.designsystem.WeibanTheme
import app.weiban.designsystem.tokens.WbSize
import app.weiban.feature.auth.AuthScreen
import app.weiban.feature.chat.AchievementsScreen
import app.weiban.feature.chat.CallOverlay
import app.weiban.feature.chat.CardAlbumsScreen
import app.weiban.feature.chat.FamiliarityOverviewScreen
import app.weiban.feature.chat.FavoritesScreen
import app.weiban.feature.chat.GrowthNavigation
import app.weiban.feature.chat.GrowthShareOverlay
import app.weiban.feature.chat.ChatScreen
import app.weiban.feature.chat.DiscoverScreen
import app.weiban.feature.chat.LocalCalls
import app.weiban.feature.chat.MyStickersScreen
import app.weiban.feature.chat.rememberMomentsBadge
import app.weiban.feature.chat.RoleBrowser
import app.weiban.feature.me.MeEntry
import app.weiban.feature.me.MeScreen
import app.weiban.network.ApiClient
import app.weiban.platform.CallNotices
import app.weiban.platform.NotificationTarget
import app.weiban.platform.adminNotificationAddress
import kotlinx.coroutines.CancellationException
import androidx.lifecycle.lifecycleScope
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
        Surface(Modifier.fillMaxSize()) {
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

    /** 发现页里打开的朋友圈：feed / me / post:<id>；null = 发现首页。 */
    var moments by mutableStateOf<String?>(null)

    fun open(id: String) {
        conversationId = id
        tab = "微伴"
    }

    fun route(value: String) {
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
        MeScreen(runtime.repository, true, onTheme, onLogout)
    } else if (onboarding) {
        val owner = OwnerRecord(userId = auth.user.userId, sessionId = auth.session.sessionId)
        RoleBrowser(runtime.repository, runtime.chat, owner, true, { id ->
            scope.launch { finishOnboarding(runtime, owner, id, navigation::open) }
        }, onboarding = true)
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
        val callRoute by runtime.callRoute.collectAsState()
        LaunchedEffect(callRoute) {
            callRoute?.let {
                navigation.route(it)
                runtime.callRoute.value = null
            }
        }
        CompositionLocalProvider(LocalCalls provides runtime.calls) {
            Box(Modifier.fillMaxSize()) {
                Scaffold(bottomBar = {
                    if (navigation.conversationId == null) {
                        val badge = rememberMomentsBadge(runtime.repository, owner)
                        Tabs(navigation.tab, (badge?.unseenPostCount ?: 0) > 0) {
                            navigation.tab = it
                            navigation.mePage = null
                            navigation.moments = null
                        }
                    }
                }) { padding ->
                    Box(Modifier.padding(padding)) { SignedInPage(runtime, auth, navigation, onTheme, onLogout) }
                }
                // 通话页 / 来电页 / 通话中胶囊盖在所有页面上（design/pages/call.md）。
                CallOverlay(runtime.repository, owner)
                // 分享图编辑页、卡片详情、获得成就轻提示（T-085）。
                GrowthShareOverlay(runtime.repository, runtime.chat, owner)
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
        Toast.makeText(runtime, "无法保存引导进度，请重试", Toast.LENGTH_SHORT).show()
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
        else -> key(navigation.tab) { RoleBrowser(runtime.repository, runtime.chat, owner, false, navigation::open) }
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
                    if (page == "pets") GrowthNavigation.openPets() else navigation.mePage = page
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
            Toast.makeText(runtime, "暂时无法打开管理提醒", Toast.LENGTH_SHORT).show()
        }
    } else {
        navigation.route(target.route)
    }
    runtime.push.navigation.consume(target)
}

@Composable private fun Tabs(
    tab: String,
    discoverDot: Boolean,
    onSelect: (String) -> Unit,
) {
    NavigationBar {
        for (label in listOf("微伴", "通讯录", "发现", "我")) {
            val selected = tab == label
            NavigationBarItem(selected = selected, onClick = { onSelect(label) }, icon = {
                // 朋友圈新动态不推送，只在「发现」标签显示红点（SOC-07 第 7 条）。
                BadgedBox(badge = { if (label == "发现" && discoverDot) Badge() }) {
                    Icon(painterResource(tabIcon(label, selected)), null, Modifier.size(WbSize.ListIcon))
                }
            }, label = { Text(label) })
        }
    }
}

private fun tabIcon(
    label: String,
    selected: Boolean,
): Int =
    when (label) {
        "微伴" -> if (selected) R.drawable.ic_chat_fill else R.drawable.ic_chat_regular
        "通讯录" -> if (selected) R.drawable.ic_contacts_fill else R.drawable.ic_contacts_regular
        "发现" -> if (selected) R.drawable.ic_discover_fill else R.drawable.ic_discover_regular
        else -> if (selected) R.drawable.ic_me_fill else R.drawable.ic_me_regular
    }
