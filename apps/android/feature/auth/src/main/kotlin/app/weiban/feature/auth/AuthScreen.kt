package app.weiban.feature.auth

import android.os.Build
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.weiban.core.designsystem.R as DsR
import app.weiban.designsystem.LocalWbDark
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.LocalWeibanModeColors
import app.weiban.designsystem.wbText
import androidx.compose.ui.text.input.*
import app.weiban.contracts.*
import app.weiban.data.SessionRepository
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
        val validPassword = password.length in 8..128
        return validUsername && validPassword
    }

    @Suppress("TooGenericExceptionCaught") // UI handles service/storage failures; cancellation is rethrown.
    fun submit() {
        if (!valid()) {
            message = "请填写正确的用户名和密码（8–128 位）"
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
            if (registering && invite.isNotBlank()) put("inviteCode", invite.trim())
            put(
                "device",
                buildJsonObject {
                    put("platform", "android")
                    put("name", Build.MODEL.take(64))
                    put("appVersion", "0.1.0")
                    put("timeZone", ZoneId.systemDefault().id)
                },
            )
        }
}

/**
 * 登录 / 注册（规格 4.14）：页面灰底 + 居中的 Logo 水印（最大 260），上面盖一层 90% → 72% → 95% 的页面灰渐变；
 * 内容：上 24 → Logo 96（圆角 24）→ 20 →「微伴」36 → 40 → 下划线式输入（间距 14）→ 错误 13 → 26 → 胶囊登录按钮 → 14 → 文字链接 14。
 */
@Composable fun AuthScreen(repository: SessionRepository) {
    val scope = rememberCoroutineScope()
    val state = remember(repository) { AuthState(repository, scope) }
    val colors = LocalWeibanColors.current
    val dark = LocalWbDark.current
    with(state) {
        Box(Modifier.fillMaxSize().background(colors.bgPage)) {
            Image(
                painterResource(DsR.drawable.wb_logo),
                null,
                Modifier.align(Alignment.Center).sizeIn(maxWidth = 260.dp, maxHeight = 260.dp).fillMaxWidth(0.6f),
            )
            Box(
                Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            listOf(colors.bgPage.copy(alpha = 0.9f), colors.bgPage.copy(alpha = 0.72f), colors.bgPage.copy(alpha = 0.95f)),
                        ),
                    ),
            )
            Column(
                Modifier
                    .fillMaxSize()
                    .systemBarsPadding()
                    .imePadding()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 32.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Spacer(Modifier.height(24.dp))
                Image(
                    painterResource(DsR.drawable.wb_logo),
                    "微伴",
                    Modifier
                        .padding(top = 24.dp)
                        .size(96.dp)
                        .shadow(12.dp, RoundedCornerShape(24.dp), ambientColor = Color(0x2923C86B), spotColor = Color(0x2923C86B))
                        .clip(RoundedCornerShape(24.dp)),
                )
                Spacer(Modifier.height(20.dp))
                Text("微伴", style = wbText(36.sp, 400, if (dark) colors.textPrimary else Color(0xFF1F2933)))
                Spacer(Modifier.height(40.dp))
                AuthFields(state)
                if (registering) {
                    Spacer(Modifier.height(14.dp))
                    UnderlineField(invite, { invite = it }, "邀请码（选填）", !busy)
                }
                message?.let {
                    Spacer(Modifier.height(8.dp))
                    Text(it, Modifier.fillMaxWidth(), style = wbText(13.sp, color = colors.textDanger))
                }
                Spacer(Modifier.height(26.dp))
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(50.dp)
                        .clip(RoundedCornerShape(25.dp))
                        .background(if (busy) LocalWeibanModeColors.current.uiBrandDisabled else colors.brandPrimary)
                        .clickable(enabled = !busy) { submit() },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        when {
                            busy -> "请稍候…"
                            registering -> "注册"
                            else -> "登录"
                        },
                        style = wbText(17.sp, 500, Color.White),
                    )
                }
                Spacer(Modifier.height(14.dp))
                Text(
                    if (registering) "已有账号，去登录" else "注册新账号",
                    Modifier
                        .clickable(enabled = !busy) {
                            registering = !registering
                            message = null
                            password = ""
                        }.padding(8.dp),
                    style = wbText(14.sp, color = colors.brandPrimary),
                )
                Spacer(Modifier.height(32.dp))
            }
        }
    }
}

/** 下划线式标签输入（旧版 Material 输入框）。 */
@Composable private fun UnderlineField(
    value: String,
    onChange: (String) -> Unit,
    label: String,
    enabled: Boolean,
    password: Boolean = false,
) {
    val colors = LocalWeibanColors.current
    TextField(
        value,
        onChange,
        Modifier.fillMaxWidth(),
        enabled = enabled,
        label = { Text(label) },
        singleLine = true,
        visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions =
            if (password) {
                KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done)
            } else {
                KeyboardOptions(autoCorrectEnabled = false)
            },
        colors =
            TextFieldDefaults.colors(
                focusedContainerColor = Color.Transparent,
                unfocusedContainerColor = Color.Transparent,
                disabledContainerColor = Color.Transparent,
                focusedIndicatorColor = colors.brandPrimary,
                unfocusedIndicatorColor = colors.borderStrong,
                focusedLabelColor = colors.brandPrimary,
                cursorColor = colors.brandPrimary,
            ),
    )
}

@Composable private fun AuthFields(state: AuthState) =
    with(state) {
        UnderlineField(username, { username = it }, "用户名", !busy)
        Spacer(Modifier.height(14.dp))
        UnderlineField(password, { password = it }, "密码（8–128 位）", !busy, password = true)
    }
