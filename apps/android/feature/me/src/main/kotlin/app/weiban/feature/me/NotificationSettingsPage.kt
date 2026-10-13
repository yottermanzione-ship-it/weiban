package app.weiban.feature.me

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import app.weiban.contracts.Endpoints
import app.weiban.data.DeviceNotificationControls
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * 我 › 服务（瘦身，docs/refactor/02 第 4.5 节）：钱包卡（余额、聊天模型）+ 模型与花费 + 偏好。
 * 卡册、成就、宠物、玩法、经期日记都搬进了「发现 › 小程序」。
 */
@Composable internal fun MeServices(
    state: MeState,
    entry: MeEntry = MeEntry(),
) {
    val colors = app.weiban.designsystem.LocalWeibanColors.current
    LaunchedEffect(state.owner) {
        if (state.selection == null || state.models.isEmpty()) {
            state.perform {
                state.models = state.call(Endpoints.modelAccessEndpointsListModels).items
                state.selection = state.call(Endpoints.modelAccessEndpointsGetSelection)
            }
        }
    }
    val chatKey = state.selection?.chat?.modelKey
    val chatModel = if (chatKey == null) "平台默认" else state.models.find { it.modelKey == chatKey }?.displayName ?: chatKey
    Row(
        Modifier
            .fillMaxWidth()
            .padding(app.weiban.designsystem.tokens.WbSpace.S5)
            .clip(RoundedCornerShape(app.weiban.designsystem.tokens.WbRadius.Lg))
            .background(colors.brandPrimary)
            .padding(app.weiban.designsystem.tokens.WbSpace.S5),
    ) {
        Column(Modifier.weight(1f).clickable { state.openPage("wallet") }) {
            Text("余额", color = colors.textOnBrand, style = MaterialTheme.typography.bodySmall)
            Text(
                "¥ " + (state.wallet?.availableMicros?.let(::yuan) ?: "--"),
                color = colors.textOnBrand,
                style = MaterialTheme.typography.headlineSmall,
            )
        }
        Column(Modifier.weight(1f).clickable { state.openPage("models") }) {
            Text("聊天模型", color = colors.textOnBrand, style = MaterialTheme.typography.bodySmall)
            Text(chatModel, color = colors.textOnBrand, style = MaterialTheme.typography.titleMedium, maxLines = 1)
        }
    }
    app.weiban.designsystem.MenuGroup("模型与花费") {
        app.weiban.designsystem.MenuRow("余额明细与后台预算") { state.openPage("wallet") }
        app.weiban.designsystem.MenuRow("模型选择") { state.openPage("models") }
    }
    app.weiban.designsystem.MenuGroup("偏好") {
        app.weiban.designsystem.MenuRow("主动消息与免打扰") { state.openPage("proactive") }
        entry.onGrowth?.let { open -> app.weiban.designsystem.MenuRow("熟悉度总览") { open("familiarity") } }
    }
}

@Composable internal fun NotificationSettingsPage(
    state: MeState,
    controls: DeviceNotificationControls?,
) {
    Text(controls?.status ?: "此设备暂不支持消息通知")
    if (controls != null) {
        Row {
            OutlinedButton(enabled = controls.available && !controls.busy, onClick = controls.enable) {
                Text(if (controls.enabled) "重新连接" else "开启通知")
            }
            if (controls.enabled) TextButton(enabled = !controls.busy, onClick = controls.disable) { Text("关闭通知") }
        }
    }
    controls?.systemSettings?.let { open -> TextButton(onClick = open) { Text("系统通知设置") } }
    state.notificationSettings?.let { settings ->
        ListItem(headlineContent = { Text("声音") }, trailingContent = {
            Switch(checked = settings.pushSoundEnabled, enabled = !state.busy, onCheckedChange = { enabled ->
                state.perform {
                    state.notificationSettings =
                        state.call(
                            Endpoints.identityEndpointsUpdateNotificationSettings,
                            buildJsonObject { put("pushSoundEnabled", enabled) },
                        )
                }
            })
        })
        ListItem(headlineContent = { Text("通知显示消息内容") }, trailingContent = {
            Switch(checked = settings.pushShowContent, enabled = !state.busy, onCheckedChange = { enabled ->
                state.perform {
                    state.notificationSettings =
                        state.call(
                            Endpoints.identityEndpointsUpdateNotificationSettings,
                            buildJsonObject { put("pushShowContent", enabled) },
                        )
                }
            })
        })
        Text("关闭消息内容后，通知只显示新消息提醒。")
        QuietHoursSettings(state)
    }
}

@Composable private fun QuietHoursSettings(state: MeState) {
    val quiet = state.notificationSettings?.doNotDisturb ?: return
    var start by remember(quiet.start) { mutableStateOf(quiet.start) }
    var end by remember(quiet.end) { mutableStateOf(quiet.end) }
    val valid = Regex("(?:[01][0-9]|2[0-3]):[0-5][0-9]")

    fun save(
        enabled: Boolean,
        from: String,
        until: String,
    ) {
        state.perform {
            state.notificationSettings =
                state.call(
                    Endpoints.identityEndpointsUpdateNotificationSettings,
                    buildJsonObject {
                        put(
                            "doNotDisturb",
                            buildJsonObject {
                                put("enabled", enabled)
                                put("start", from)
                                put("end", until)
                            },
                        )
                    },
                )
        }
    }
    ListItem(headlineContent = { Text("免打扰时段") }, trailingContent = {
        Switch(checked = quiet.enabled, enabled = !state.busy, onCheckedChange = { save(it, quiet.start, quiet.end) })
    })
    OutlinedTextField(value = start, onValueChange = { start = it }, label = { Text("开始时间") }, singleLine = true, enabled = !state.busy)
    OutlinedTextField(value = end, onValueChange = { end = it }, label = { Text("结束时间") }, singleLine = true, enabled = !state.busy)
    val timesValid = valid.matches(start) && valid.matches(end)
    if (!timesValid) Text("请填写 24 小时制时间，例如 22:00。")
    Text("按账号时区执行；开始与结束相同时全天静音。")
    OutlinedButton(enabled = !state.busy && timesValid, onClick = { save(quiet.enabled, start, end) }) { Text("保存免打扰时段") }
}
