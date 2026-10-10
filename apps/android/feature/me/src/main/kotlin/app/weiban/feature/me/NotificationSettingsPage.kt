package app.weiban.feature.me

import androidx.compose.foundation.layout.Row
import androidx.compose.material3.*
import androidx.compose.runtime.*
import app.weiban.contracts.Endpoints
import app.weiban.data.DeviceNotificationControls
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

@Composable internal fun MeSettings(state: MeState) {
    OutlinedButton(onClick = { state.openPage("notifications") }) { Text("新消息通知") }
    OutlinedButton(onClick = { state.openPage("theme") }) { Text("主题") }
    OutlinedButton(onClick = { state.openPage("privacy") }) { Text("隐私") }
    // 危险型行（account-deletion.md 第 2 节）。
    TextButton(onClick = { state.openPage("delete-account") }) {
        Text("注销账号", color = app.weiban.designsystem.LocalWeibanColors.current.textDanger)
    }
}

@Composable internal fun MeServices(
    state: MeState,
    entry: MeEntry = MeEntry(),
) {
    OutlinedButton(onClick = { state.openPage("wallet") }) { Text("余额与账单") }
    OutlinedButton(onClick = { state.openPage("models") }) { Text("模型选择") }
    OutlinedButton(onClick = { state.openPage("proactive") }) { Text("主动消息与免打扰") }
    Text("互动玩法")
    OutlinedButton(onClick = { state.openPage("period") }) { Text("经期日记") }
    entry.onGrowth?.let { open -> OutlinedButton(onClick = { open("pets") }) { Text("宠物") } }
    // 五个玩法（SVC-01、PLAY-03～07）：信箱有未读来信时红点；每日一问不显示红点。
    entry.onGrowth?.let { open ->
        var unread by remember { mutableLongStateOf(0L) }
        LaunchedEffect(state.owner) {
            runCatching {
                unread =
                    state.repository
                        .call(
                            Endpoints.letterEndpointsGetBadge,
                            options = app.weiban.data.SessionCallOptions(owner = state.owner, networkOnly = true),
                        ).unreadCount
            }
        }
        OutlinedButton(onClick = { open("play:daily") }) { Text("每日一问") }
        OutlinedButton(onClick = { open("play:wishlists") }) { Text("心愿清单") }
        OutlinedButton(onClick = { open("play:letters") }) { Text(if (unread > 0) "信箱 ●" else "信箱") }
        OutlinedButton(onClick = { open("play:focus") }) { Text("陪你专注") }
        OutlinedButton(onClick = { open("play:reminders") }) { Text("TA 的提醒") }
    }
    // 陪伴分组（SVC-01）：卡册、成就、熟悉度。
    entry.onGrowth?.let { open ->
        Text("陪伴")
        OutlinedButton(onClick = { open("cards") }) { Text("卡册") }
        OutlinedButton(onClick = { open("achievements") }) { Text("成就") }
        OutlinedButton(onClick = { open("familiarity") }) { Text("熟悉度") }
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
