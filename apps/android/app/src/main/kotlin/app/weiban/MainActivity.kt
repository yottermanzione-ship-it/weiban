package app.weiban

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
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

@Composable private fun SignedIn(
    runtime: WeibanApplication,
    auth: AuthResponse,
    onTheme: (String) -> Unit,
    onLogout: () -> Unit,
) {
    var tab by rememberSaveable { mutableStateOf("微伴") }
    if (!auth.user.profileCompleted) {
        MeScreen(runtime.repository, true, onTheme, onLogout)
    } else {
        Scaffold(bottomBar = { Tabs(tab) { tab = it } }) { padding ->
            Box(Modifier.padding(padding)) {
                when (tab) {
                    "我" -> MeScreen(runtime.repository, onTheme = onTheme, onLogout = onLogout)
                    "微伴" ->
                        ChatScreen(
                            runtime.repository,
                            runtime.chat,
                            OwnerRecord(userId = auth.user.userId, sessionId = auth.session.sessionId),
                            {},
                        )
                    else -> Placeholder(tab)
                }
            }
        }
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

@Composable private fun Placeholder(tab: String) {
    Column {
        Text(tab, style = MaterialTheme.typography.headlineSmall)
        Text(
            when (tab) {
                "聊天" -> "添加喜欢的角色后，聊天会出现在这里"
                "通讯录" -> "和角色慢慢熟悉，从添加好友开始"
                else -> "更多玩法正在准备中"
            },
        )
    }
}
