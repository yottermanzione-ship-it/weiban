package app.weiban.feature.chat

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import app.weiban.contracts.*
import app.weiban.data.*
import app.weiban.designsystem.tokens.WbSpace
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import java.util.UUID

private class MemoryActions(
    private val repository: SessionRepository,
    private val owner: OwnerRecord,
    private val characterId: String,
    private val scope: CoroutineScope,
) {
    var pending by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)

    fun change(
        after: () -> Unit,
        operation: suspend () -> Unit,
    ) {
        if (pending) return
        pending = true
        error = null
        scope.launch {
            try {
                userAction({ error = it }) {
                    operation()
                    after()
                }
            } finally {
                pending = false
            }
        }
    }

    suspend fun <T> call(
        endpoint: ContractEndpoint<T>,
        body: JsonElement? = null,
        memoryId: String? = null,
    ): T {
        val params = mutableMapOf("characterId" to characterId)
        memoryId?.let { params["memoryId"] = it }
        return repository.call(endpoint, params = params, body = body, options = SessionCallOptions(owner = owner, networkOnly = true))
    }
}

@Composable internal fun MemoryManagement(
    repository: SessionRepository,
    owner: OwnerRecord,
    characterId: String,
    onBack: () -> Unit,
) {
    var afterId by remember(owner, characterId) { mutableStateOf<String?>(null) }
    val records =
        remote("${owner.sessionId}:memories:$characterId:$afterId") {
            val query = mutableMapOf("limit" to "50")
            afterId?.let { query["afterId"] = it }
            repository.call(
                Endpoints.memoryEndpointsList,
                params = mapOf("characterId" to characterId),
                query = query,
                options = SessionCallOptions(owner = owner, networkOnly = true),
            )
        }
    val scope = rememberCoroutineScope()
    val actions = remember(owner, characterId) { MemoryActions(repository, owner, characterId, scope) }
    BackHandler(enabled = !actions.pending, onBack = onBack)
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(WbSpace.S5),
        verticalArrangement = Arrangement.spacedBy(WbSpace.S3),
    ) {
        TextButton(onBack, enabled = !actions.pending) { Text("返回聊天信息") }
        Text("TA记住了什么", style = MaterialTheme.typography.headlineSmall)
        Text("删除后旧消息不会重新记下这条信息；再次主动提起时可以重新记下。")
        MemoryCreation(actions, records::refresh)
        records.data?.items?.forEach { entry -> key(entry.memoryId, entry.updatedAt) { MemoryEditor(entry, actions, records::refresh) } }
        MemoryPaging(records, actions.pending, afterId, { afterId = it })
        (actions.error ?: records.error)?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    }
}

@Composable private fun MemoryCreation(
    actions: MemoryActions,
    refresh: () -> Unit,
) {
    var content by remember { mutableStateOf("") }
    var clientId by remember { mutableStateOf(UUID.randomUUID().toString()) }
    OutlinedTextField(content, {
        if (it.length <= 1000) {
            content = it
            clientId = UUID.randomUUID().toString()
        }
    }, label = { Text("我想让TA记住…") }, enabled = !actions.pending)
    Button(enabled = !actions.pending && content.isNotBlank(), onClick = {
        actions.change({
            content = ""
            clientId = UUID.randomUUID().toString()
            refresh()
        }) {
            actions.call(
                Endpoints.memoryEndpointsCreate,
                buildJsonObject {
                    put("clientMemoryId", clientId)
                    put("content", content)
                    put("category", "basic")
                },
            )
        }
    }) { Text("添加记忆") }
}

@Composable private fun MemoryEditor(
    entry: MemoryEntry,
    actions: MemoryActions,
    refresh: () -> Unit,
) {
    var content by remember { mutableStateOf(entry.content) }
    var confirm by remember { mutableStateOf(false) }
    var past by remember { mutableStateOf(entry.status == "past") }
    HorizontalDivider()
    OutlinedTextField(content, { if (it.length <= 1000) content = it }, enabled = !actions.pending, label = { Text("记忆内容") })
    Row {
        Text("属于过去")
        Switch(past, { past = it }, enabled = !actions.pending)
    }
    Text("${if (entry.scope == "adult") "来自成人模式" else "日常记忆"} · 仅这位角色知道")
    Text("记下日期：${entry.createdAt.take(10)}")
    Button(enabled = !actions.pending && content.isNotBlank(), onClick = {
        actions.change(refresh) {
            actions.call(
                Endpoints.memoryEndpointsUpdate,
                buildJsonObject {
                    put("content", content)
                    put("status", if (past) "past" else "current")
                },
                entry.memoryId,
            )
        }
    }) { Text("保存修改") }
    TextButton(enabled = !actions.pending, onClick = { confirm = true }) { Text("删除这条记忆") }
    if (confirm) {
        AlertDialog(
            onDismissRequest = { if (!actions.pending) confirm = false },
            title = { Text("确认让TA忘记这条？") },
            confirmButton = {
                TextButton(enabled = !actions.pending, onClick = {
                    actions.change(refresh) { actions.call(Endpoints.memoryEndpointsRemove, memoryId = entry.memoryId) }
                }) { Text("确认删除") }
            },
            dismissButton = { TextButton(enabled = !actions.pending, onClick = { confirm = false }) { Text("取消") } },
        )
    }
}

@Composable private fun MemoryPaging(
    records: NativeRemote<MemoryEndpointsListResponse>,
    pending: Boolean,
    afterId: String?,
    setPage: (String?) -> Unit,
) {
    if (records.data?.items?.isEmpty() == true) Text("还没有记下的事情")
    TextButton(enabled = !pending && afterId != null, onClick = { setPage(null) }) { Text("第一页") }
    TextButton(enabled = !pending && records.data?.nextCursor != null, onClick = { setPage(records.data?.nextCursor) }) { Text("下一页") }
}
