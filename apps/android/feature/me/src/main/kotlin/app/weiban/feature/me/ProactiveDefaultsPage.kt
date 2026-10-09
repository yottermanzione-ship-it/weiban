package app.weiban.feature.me

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import app.weiban.contracts.*
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.tokens.WbSpace
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

private val frequencies = listOf("low" to "少", "medium" to "适中", "high" to "多")

/** 服务 › 主动消息与免打扰（ACC-03、SIM-10；设计 me-and-services.md 3.4）：总开关 + 默认频率。 */
@Composable internal fun ProactiveDefaultsPage(state: MeState) {
    val colors = LocalWeibanColors.current
    var defaults by remember { mutableStateOf<CompanionSettings?>(null) }
    LaunchedEffect(state) {
        state.perform {
            state.notificationSettings = state.call(Endpoints.identityEndpointsGetNotificationSettings)
            defaults = state.call(Endpoints.companionEndpointsGetDefaults)
        }
    }
    val settings = state.notificationSettings ?: return
    PeriodSwitchRow("角色主动找我", settings.proactiveMessagesEnabled, !state.busy) { enabled ->
        state.perform {
            state.notificationSettings =
                state.call(Endpoints.identityEndpointsUpdateNotificationSettings, buildJsonObject { put("proactiveMessagesEnabled", enabled) })
        }
    }
    Text("关闭后所有角色都不会主动发消息；你发消息时 TA 照常回复。", color = colors.textSecondary, style = MaterialTheme.typography.bodySmall)
    val current = defaults
    if (settings.proactiveMessagesEnabled && current != null) {
        Text("默认主动消息频率", style = MaterialTheme.typography.titleSmall)
        Row(horizontalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
            frequencies.forEach { (id, label) ->
                FilterChip(
                    selected = (current.proactiveFrequency ?: "medium") == id,
                    enabled = !state.busy,
                    onClick = {
                        state.perform {
                            defaults = state.call(Endpoints.companionEndpointsUpdateDefaults, buildJsonObject { put("proactiveFrequency", id) })
                            state.message = "下一次主动消息开始生效"
                        }
                    },
                    label = { Text(label) },
                )
            }
        }
        Text("单个角色可在聊天信息里另外设置。", color = colors.textSecondary, style = MaterialTheme.typography.bodySmall)
    }
}
