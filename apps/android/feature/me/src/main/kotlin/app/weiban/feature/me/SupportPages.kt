package app.weiban.feature.me

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import app.weiban.contracts.*
import app.weiban.data.SessionCallOptions
import kotlinx.serialization.json.*
import java.util.UUID

@Composable internal fun SupportPage(state: MeState) {
    var tickets by remember { mutableStateOf<List<SupportTicket>>(emptyList()) }
    var cursor by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(state) {
        state.perform {
            val page = state.call(Endpoints.supportEndpointsListMine)
            tickets = page.items
            cursor = page.nextCursor
        }
    }
    Button(onClick = { state.openPage("support-new") }, enabled = !state.busy) { Text("提交反馈") }
    tickets.forEach { ticket ->
        TextButton(onClick = {
            state.openPage("support-ticket:${ticket.ticketId}")
        }) { Text("${supportStatus(ticket.status)} · ${ticket.text.take(80)}${if (ticket.unseen) " · 新回复" else ""}") }
    }
    if (tickets.isEmpty() && !state.busy) Text("暂无反馈或投诉")
    cursor?.let { after ->
        TextButton(onClick = {
            state.perform {
                val page = state.call(Endpoints.supportEndpointsListMine, query = mapOf("cursor" to after))
                tickets =
                    tickets + page.items
                cursor = page.nextCursor
            }
        }, enabled = !state.busy) { Text("加载更多") }
    }
}

@Composable internal fun SupportCreatePage(state: MeState) {
    var text by remember { mutableStateOf("") }
    var category by remember { mutableStateOf("bug") }
    val requestId = remember { UUID.randomUUID().toString() }
    listOf(
        "bug" to "功能异常",
        "suggestion" to "产品建议",
        "character" to "角色表现",
        "billing" to "积分与充值",
        "account" to "账号与登录",
        "other" to "其他",
    ).forEach { (id, label) ->
        Row {
            RadioButton(selected = category == id, onClick = { category = id }, enabled = !state.busy)
            Text(label)
        }
    }
    OutlinedTextField(value = text, onValueChange = {
        text = it.take(2000)
    }, enabled = !state.busy, label = { Text("请描述遇到的问题或建议") }, modifier = Modifier.fillMaxWidth(), minLines = 4)
    Text("会附带最近的运行记录，不含聊天内容。", style = MaterialTheme.typography.bodySmall)
    Button(enabled = !state.busy && text.isNotBlank(), onClick = {
        state.perform {
            val ticket =
                state.call(
                    Endpoints.supportEndpointsCreate,
                    buildJsonObject {
                        put("clientRequestId", requestId)
                        put("kind", "feedback")
                        put("category", category)
                        put("text", text.trim())
                    },
                )
            state.back()
            state.openPage("support-ticket:${ticket.ticketId}")
        }
    }) { Text("提交") }
}

@Composable internal fun SupportTicketPage(
    state: MeState,
    ticketId: String,
) {
    var ticket by remember(ticketId) { mutableStateOf<SupportTicket?>(null) }
    var reply by remember(ticketId) { mutableStateOf("") }
    LaunchedEffect(state, ticketId) {
        state.perform {
            ticket =
                state.repository.call(
                    Endpoints.supportEndpointsGet,
                    params = mapOf("ticketId" to ticketId),
                    options = SessionCallOptions(owner = state.owner, networkOnly = true),
                )
        }
    }
    ticket?.let { value ->
        Text(supportStatus(value.status), style = MaterialTheme.typography.titleMedium)
        Text(value.text)
        value.replies.forEach { Text("${if (it.from == "admin") "官方回复" else "我的补充"}：${it.text}") }
        if (value.status != "resolved") {
            OutlinedTextField(value = reply, onValueChange = {
                reply = it.take(2000)
            }, enabled = !state.busy, label = { Text("补充说明") }, modifier = Modifier.fillMaxWidth())
            Button(enabled = !state.busy && reply.isNotBlank(), onClick = {
                state.perform {
                    ticket =
                        state.repository.call(
                            Endpoints.supportEndpointsAddReply,
                            buildJsonObject { put("text", reply.trim()) },
                            params =
                                mapOf("ticketId" to ticketId),
                            options = SessionCallOptions(owner = state.owner, networkOnly = true),
                        )
                    reply = ""
                }
            }) { Text("发送补充") }
        }
    }
}

private fun supportStatus(value: String): String =
    when (value) {
        "open" -> "待处理"
        "replied" -> "已回复"
        "resolved" -> "已解决"
        else -> "处理中"
    }
