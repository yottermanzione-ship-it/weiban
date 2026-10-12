package app.weiban.feature.me

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import app.weiban.contracts.Endpoints
import app.weiban.data.SessionCallOptions
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.tokens.WbSpace
import app.weiban.network.ApiFailure
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.IOException

/** 注销后被删除的内容（ACC-06 第 2 条；design account-deletion.md 第 2 节，固定全部列出）。 */
private val deletedItems =
    listOf(
        "所有聊天记录和 TA 们的记忆",
        "你创建和导入的角色、导入的原始记录",
        "你上传的头像和图片",
        "余额和余额明细",
        "卡片、成就、宠物",
        "经期日记",
        "提醒、心愿清单、每日一问的回答、信件",
        "你在人设广场发布的作品、评论和点赞",
    )

/**
 * 注销账号（ACC-06；design pages/account-deletion.md）：说明页 → 输入密码 → 完成页。
 * 密码错误（403 invalid_credentials）只提示、不退出登录；只有服务器明确返回「未登录」才退出。
 */
@Suppress("LongMethod", "CyclomaticComplexMethod") // Three steps of one flow.
@Composable
internal fun AccountDeletionPage(
    state: MeState,
    onLogout: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    var asking by remember { mutableStateOf(false) }
    var done by remember { mutableStateOf(false) }
    var password by remember { mutableStateOf("") }
    var visible by remember { mutableStateOf(false) }
    var submitting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var blocked by remember { mutableStateOf(false) }
    if (done) {
        // 完成页不可返回；点「好的」清除本机数据回到登录页。
        BackHandler {}
        Column(Modifier.fillMaxWidth().padding(WbSpace.S8), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("✓", style = MaterialTheme.typography.displaySmall, color = colors.textTertiary)
            Text("账号已注销", style = MaterialTheme.typography.titleLarge)
            Text("这个账号的数据会被删除，所有设备都已退出登录。", color = colors.textSecondary)
            Spacer(Modifier.height(WbSpace.S5))
            Button(onClick = onLogout) { Text("好的") }
        }
        return
    }
    Text("注销后，这个账号的全部数据会被删除，无法恢复。", style = MaterialTheme.typography.titleMedium)
    Text("将被删除的内容", style = MaterialTheme.typography.titleSmall)
    deletedItems.forEach { Text("· $it") }
    val balance = state.wallet?.balanceMicros ?: 0L
    if (balance > 0) Text("剩余余额 ¥${yuan(balance)} 将作废")
    Text("别人已经从人设广场添加的角色属于对方，会保留，作者显示为「已注销用户」。", color = colors.textSecondary)
    Button(
        onClick = {
            password = ""
            error = null
            asking = true
        },
        colors = ButtonDefaults.buttonColors(containerColor = colors.textDanger),
        modifier = Modifier.fillMaxWidth(),
    ) { Text("注销账号") }
    if (asking) {
        val focus = remember { FocusRequester() }
        LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
        AlertDialog(
            onDismissRequest = { if (!submitting) asking = false },
            title = { Text("输入密码确认注销") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
                    Text("注销后无法恢复。")
                    OutlinedTextField(
                        password,
                        { password = it.take(128) },
                        Modifier.fillMaxWidth().focusRequester(focus),
                        singleLine = true,
                        enabled = !submitting,
                        label = { Text("密码") },
                        visualTransformation = if (visible) VisualTransformation.None else PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        trailingIcon = { TextButton(onClick = { visible = !visible }) { Text(if (visible) "隐藏" else "显示") } },
                    )
                    error?.let { Text(it, color = colors.textDanger, style = MaterialTheme.typography.bodySmall) }
                }
            },
            confirmButton = {
                TextButton(enabled = password.isNotEmpty() && !submitting && !blocked, onClick = {
                    submitting = true
                    error = null
                    scope.launch {
                        try {
                            state.repository.call(
                                Endpoints.identityEndpointsDeleteAccount,
                                body =
                                    buildJsonObject {
                                        put("password", password)
                                        put("confirm", "DELETE")
                                    },
                                options = SessionCallOptions(owner = state.owner, networkOnly = true),
                            )
                            asking = false
                            done = true
                        } catch (failure: CancellationException) {
                            throw failure
                        } catch (failure: ApiFailure) {
                            when {
                                // 密码错误：只提示、清空输入，保持登录（ACC-06 第 4 条）。
                                failure.code == "invalid_credentials" || failure.status == 403 -> {
                                    error = "密码错误"
                                    password = ""
                                }
                                failure.status == 429 -> {
                                    error = "尝试次数过多，请稍后再试"
                                    blocked = true
                                }
                                // 只有服务器明确返回「未登录」才退出（会话层已清除本机登录）。
                                failure.code == "unauthenticated" -> onLogout()
                                failure.code == "session_changed" -> asking = false
                                else -> error = "暂时无法注销，请稍后重试"
                            }
                        } catch (_: IOException) {
                            error = "网络不可用，请重试"
                        } finally {
                            submitting = false
                        }
                    }
                }) { Text(if (submitting) "正在注销…" else "注销", color = colors.textDanger) }
            },
            dismissButton = { TextButton(enabled = !submitting, onClick = { asking = false }) { Text("取消") } },
        )
    }
}
