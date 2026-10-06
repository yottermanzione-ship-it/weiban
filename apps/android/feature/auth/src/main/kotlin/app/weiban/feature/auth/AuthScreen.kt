package app.weiban.feature.auth

import android.os.Build
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.*
import app.weiban.contracts.*
import app.weiban.data.SessionRepository
import app.weiban.designsystem.tokens.WbSpace
import app.weiban.network.ApiFailure
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import java.time.ZoneId

fun displayError(error: Throwable) =
    when ((error as? ApiFailure)?.code) {
        "invalid_credentials" -> "用户名或密码不正确"
        "username_taken" -> "这个用户名已被使用"
        "invite_invalid", "invite_expired" -> "邀请码无效或已过期"
        "session_changed", "unauthenticated" -> "登录已失效，请重新登录"
        "invalid_response" -> "暂时无法读取数据，请稍后重试"
        else -> "暂时无法连接，请检查网络后重试"
    }

private class AuthState(
    private val repository: SessionRepository,
    private val scope: kotlinx.coroutines.CoroutineScope,
) {
    var registering by mutableStateOf(false)
    var username by mutableStateOf("")

    // Password is deliberately not saved across activity recreation or in Bundle state.
    var password by mutableStateOf("")
    var invite by mutableStateOf("")
    var busy by mutableStateOf(false)
    var message by mutableStateOf<String?>(null)

    private fun valid(): Boolean {
        val validUsername = Regex("^[A-Za-z0-9_]{4,32}$").matches(username)
        val validPassword = password.length in 10..128
        return validUsername && validPassword && (!registering || invite.isNotBlank())
    }

    @Suppress("TooGenericExceptionCaught") // UI handles service/storage failures; cancellation is rethrown.
    fun submit() {
        if (!valid()) {
            message = "请填写正确的用户名、密码和邀请码"
            return
        }
        busy = true
        message = null
        val capturedPassword = password
        scope.launch {
            try {
                val body = body(capturedPassword)
                val auth =
                    repository.call(
                        if (registering)Endpoints.identityEndpointsRegister else Endpoints.identityEndpointsLogin,
                        body,
                    )
                password = ""
                repository.authenticate(auth)
            } catch (error: kotlinx.coroutines.CancellationException) {
                throw error
            } catch (error: Exception) {
                message = displayError(error)
            } finally {
                busy = false
            }
        }
    }

    private fun body(capturedPassword: String): JsonObject =
        buildJsonObject {
            put("username", username)
            put("password", capturedPassword)
            put("kind", "app")
            if (registering)put("inviteCode", invite)
            put(
                "device",
                buildJsonObject {
                    put("platform", "android")
                    put("name", Build.MODEL.take(80))
                    put("appVersion", "0.1.0")
                    put("timeZone", ZoneId.systemDefault().id)
                },
            )
        }
}

@Composable fun AuthScreen(repository: SessionRepository) {
    val scope = rememberCoroutineScope()
    val state = remember(repository) { AuthState(repository, scope) }
    with(state) {
        Column(
            Modifier
                .fillMaxSize()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(WbSpace.S5),
            verticalArrangement = Arrangement.spacedBy(WbSpace.S5),
        ) {
            Spacer(Modifier.weight(1f, fill = false))
            Text(if (registering) "加入微伴" else "欢迎回来", style = MaterialTheme.typography.headlineMedium)
            Text("和喜欢的角色，慢慢熟悉彼此。", color = MaterialTheme.colorScheme.onSurfaceVariant)
            AuthFields(state)
            if (registering) {
                OutlinedTextField(invite, {
                    invite = it
                }, label = { Text("邀请码") }, singleLine = true, enabled = !busy, modifier = Modifier.fillMaxWidth())
            }
            message?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Button(onClick = { submit() }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                Text(
                    if (busy) {
                        "请稍候…"
                    } else if (registering) {
                        "注册"
                    } else {
                        "登录"
                    },
                )
            }
            TextButton(onClick = {
                registering = !registering
                message = null
                password = ""
            }, enabled = !busy) { Text(if (registering) "已有账号，去登录" else "有邀请码？创建账号") }
            Spacer(Modifier.weight(1f, fill = false))
        }
    }
}

@Composable private fun AuthFields(state: AuthState) =
    with(state) {
        OutlinedTextField(
            username,
            {
                username = it
            },
            label = {
                Text("用户名")
            },
            singleLine = true,
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
            keyboardOptions =
                KeyboardOptions(
                    autoCorrectEnabled = false,
                ),
        )
        OutlinedTextField(
            password,
            {
                password = it
            },
            label = {
                Text("密码")
            },
            supportingText = {
                Text("10–128 位")
            },
            singleLine = true,
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions =
                KeyboardOptions(
                    keyboardType = KeyboardType.Password,
                    imeAction = ImeAction.Done,
                ),
        )
    }
