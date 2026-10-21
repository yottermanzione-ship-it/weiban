package app.weiban.feature.me

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import app.weiban.contracts.*
import app.weiban.designsystem.LocalWeibanColors
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

private val sharingLevels =
    listOf(
        "off" to "关闭",
        "basic" to "只共享基础资料",
        "friends" to "互相认识的角色之间可以聊起",
    )

/** 设置 › 隐私 › 跨角色共享（MEM-07 第 1 条；MemorySharingEndpoints，默认 friends）。 */
@Composable internal fun PrivacyPage(state: MeState) {
    val colors = LocalWeibanColors.current
    Text("为排查故障，微伴自动上报不含聊天内容、输入内容和登录凭证的技术运行记录。明细保留 30 天，问题分组保留 180 天；注销时删除关联记录。", style = MaterialTheme.typography.bodySmall)
    var sharing by remember { mutableStateOf<MemorySharingSettings?>(null) }
    LaunchedEffect(state) { state.perform { sharing = state.call(Endpoints.memorySharingEndpointsGet) } }
    Text("跨角色共享", style = MaterialTheme.typography.titleSmall)
    Text(
        "决定一个角色从你这里知道的事，能不能被你通讯录里认识 TA 的其他角色提起。",
        color = colors.textSecondary,
        style = MaterialTheme.typography.bodySmall,
    )
    val current = sharing ?: return
    sharingLevels.forEach { (id, label) ->
        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            RadioButton(selected = current.level == id, enabled = !state.busy, onClick = {
                if (current.level != id) {
                    state.perform {
                        sharing = state.call(Endpoints.memorySharingEndpointsUpdate, buildJsonObject { put("level", id) })
                        state.message = "已保存，立即生效"
                    }
                }
            })
            Text(label)
        }
    }
}
