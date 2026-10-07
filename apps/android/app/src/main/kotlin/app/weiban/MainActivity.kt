package app.weiban

import android.os.Bundle
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
import app.weiban.feature.chat.ChatScreen
import app.weiban.feature.chat.RoleBrowser
import app.weiban.feature.me.MeScreen
import app.weiban.network.ApiClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onResume() {
        super.onResume()
        (application as WeibanApplication).chat.foreground(true)
    }

    override fun onPause() {
        (application as WeibanApplication).chat.foreground(false)
        super.onPause()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val runtime = application as WeibanApplication
        setContent { WeibanRoot(runtime) }
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

    fun open(id: String) {
        conversationId = id
        tab = "微伴"
    }

    companion object {
        val saver =
            listSaver<NavigationUi, String>(
                save = { listOf(it.tab, it.conversationId.orEmpty()) },
                restore = { NavigationUi(it[0], it[1].ifBlank { null }) },
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
    if (!auth.user.profileCompleted) {
        MeScreen(runtime.repository, true, onTheme, onLogout)
    } else {
        Scaffold(bottomBar = { Tabs(navigation.tab) { navigation.tab = it } }) { padding ->
            Box(Modifier.padding(padding)) { SignedInPage(runtime, auth, navigation, onTheme, onLogout) }
        }
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
        "我" -> MeScreen(runtime.repository, onTheme = onTheme, onLogout = onLogout)
        "微伴" -> ChatScreen(runtime.repository, runtime.chat, owner, navigation.conversationId) { navigation.conversationId = null }
        else -> key(navigation.tab) { RoleBrowser(runtime.repository, runtime.chat, owner, navigation.tab == "发现", navigation::open) }
    }
}

@Composable private fun Tabs(
    tab: String,
    onSelect: (String) -> Unit,
) {
    NavigationBar {
        for (label in listOf("微伴", "通讯录", "发现", "我")) {
            val selected = tab == label
            NavigationBarItem(selected = selected, onClick = { onSelect(label) }, icon = {
                Icon(painterResource(tabIcon(label, selected)), null, Modifier.size(WbSize.ListIcon))
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
