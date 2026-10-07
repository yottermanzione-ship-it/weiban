package app.weiban.feature.chat

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import app.weiban.contracts.*
import app.weiban.data.*
import app.weiban.designsystem.tokens.WbSpace
import kotlinx.coroutines.*
import kotlinx.serialization.json.*

private class InformationActions(
    private val repository: SessionRepository,
    private val runtime: ChatRuntime,
    private val owner: OwnerRecord,
    private val scope: CoroutineScope,
) {
    var pending by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    var saved by mutableStateOf(false)

    fun change(
        after: () -> Unit = {},
        operation: suspend () -> Unit,
    ) {
        if (pending) return
        pending = true
        error = null
        saved = false
        scope.launch {
            try {
                userAction({ error = it }) {
                    operation()
                    runtime.history.synchronize(owner)
                    saved = true
                    after()
                }
            } finally {
                pending = false
            }
        }
    }

    suspend fun <T> call(
        endpoint: ContractEndpoint<T>,
        id: String,
        body: JsonElement,
    ): T = repository.call(endpoint, params = mapOf("characterId" to id), body = body, options = SessionCallOptions(owner = owner))

    suspend fun updateState(
        id: String,
        body: JsonElement,
    ) {
        repository.call(
            Endpoints.chatEndpointsUpdateState,
            params = mapOf("conversationId" to id),
            body = body,
            options = SessionCallOptions(owner = owner),
        )
    }

    suspend fun clear(id: String) = runtime.history.clear(owner, id)

    suspend fun remove(
        id: String,
        mode: String,
    ) {
        repository.call(
            Endpoints.contactsEndpointsRemove,
            params = mapOf("characterId" to id),
            query = mapOf("mode" to mode),
            options = SessionCallOptions(owner = owner),
        )
    }
}

@Composable internal fun ChatInformation(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    state: ClientSyncState,
    conversation: Conversation,
    onBack: () -> Unit,
    onRemoved: () -> Unit,
) {
    val characterId = conversation.participants.find { it.kind == "character" }?.refId ?: return
    val contact = state.contacts.find { it.characterId == characterId }
    val scope = rememberCoroutineScope()
    val actions = remember(owner, conversation.conversationId) { InformationActions(repository, runtime, owner, scope) }
    val companion =
        remote("${owner.sessionId}:$characterId") {
            repository.call(
                Endpoints.companionEndpointsGetForCharacter,
                params = mapOf("characterId" to characterId),
                options = SessionCallOptions(owner = owner),
            )
        }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(WbSpace.S5),
        verticalArrangement = Arrangement.spacedBy(WbSpace.S3),
    ) {
        TextButton(onBack, enabled = !actions.pending) { Text("返回聊天") }
        Text("聊天信息", style = MaterialTheme.typography.headlineSmall)
        Text(title(state, conversation, characterNames(repository, listOf(characterId))))
        InformationPreferences(actions, conversation, companion, characterId)
        InformationNames(actions, contact, characterId)
        (actions.error ?: companion.error)?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (actions.saved) Text("已保存")
        InformationRemoval(actions, conversation.conversationId, characterId, onBack, onRemoved)
    }
}

@Composable private fun InformationPreferences(
    actions: InformationActions,
    conversation: Conversation,
    companion: NativeRemote<CompanionEndpointsGetForCharacterResponse>,
    characterId: String,
) {
    InformationToggle("置顶聊天", conversation.state.pinned, !actions.pending) { value ->
        actions.change { actions.updateState(conversation.conversationId, buildJsonObject { put("pinned", value) }) }
    }
    InformationToggle("消息免打扰", conversation.state.muted, !actions.pending) { value ->
        actions.change { actions.updateState(conversation.conversationId, buildJsonObject { put("muted", value) }) }
    }
    companion.data?.let { settings ->
        InformationToggle("秒回", settings.instantReply, !actions.pending) { value ->
            actions.change(after = companion::refresh) {
                actions.call(Endpoints.companionEndpointsUpdateForCharacter, characterId, buildJsonObject { put("instantReply", value) })
            }
        }
        InformationToggle("拆条", settings.splitBubbles, !actions.pending) { value ->
            actions.change(after = companion::refresh) {
                actions.call(Endpoints.companionEndpointsUpdateForCharacter, characterId, buildJsonObject { put("splitBubbles", value) })
            }
        }
    }
}

@Composable private fun InformationNames(
    actions: InformationActions,
    contact: Contact?,
    characterId: String,
) {
    var remark by remember(contact?.remark) { mutableStateOf(contact?.remark.orEmpty()) }
    var addressAs by remember(contact?.addressAs) { mutableStateOf(contact?.addressAs.orEmpty()) }
    OutlinedTextField(remark, { if (it.length <= 20) remark = it }, label = { Text("备注名") }, enabled = !actions.pending)
    OutlinedTextField(addressAs, { if (it.length <= 20) addressAs = it }, label = { Text("TA怎么叫我") }, enabled = !actions.pending)
    Button(enabled = !actions.pending, onClick = {
        actions.change {
            actions.call(
                Endpoints.contactsEndpointsUpdate,
                characterId,
                buildJsonObject {
                    put("remark", remark.takeIf { it.isNotBlank() }?.let(::JsonPrimitive) ?: JsonNull)
                    put("addressAs", addressAs.takeIf { it.isNotBlank() }?.let(::JsonPrimitive) ?: JsonNull)
                },
            )
        }
    }) { Text("保存称呼") }
}

@Composable private fun InformationRemoval(
    actions: InformationActions,
    conversationId: String,
    characterId: String,
    onBack: () -> Unit,
    onRemoved: () -> Unit,
) {
    var confirmation by remember { mutableStateOf<String?>(null) }
    BackHandler {
        if (!actions.pending) {
            if (confirmation != null) {
                confirmation = null
            } else {
                onBack()
            }
        }
    }
    TextButton(enabled = !actions.pending, onClick = { confirmation = "clear" }) { Text("清空聊天记录") }
    TextButton(enabled = !actions.pending, onClick = { confirmation = "soft" }) { Text("删除角色") }
    TextButton(enabled = !actions.pending, onClick = { confirmation = "purge" }) { Text("永久删除角色和数据") }
    confirmation?.let { mode ->
        InformationConfirmation(mode, actions.pending, { confirmation = null }) {
            if (mode == "purge") {
                confirmation = "purgeConfirmed"
            } else {
                actions.change(after = {
                    confirmation = null
                    if (mode != "clear") onRemoved()
                }) {
                    if (mode == "clear") {
                        actions.clear(conversationId)
                    } else {
                        actions.remove(characterId, if (mode == "soft") "soft" else "purge")
                    }
                }
            }
        }
    }
}

@Composable private fun InformationToggle(
    label: String,
    checked: Boolean,
    enabled: Boolean,
    onChange: (Boolean) -> Unit,
) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label)
        Switch(checked, onChange, modifier = Modifier.semantics { contentDescription = label }, enabled = enabled)
    }
}

@Composable private fun InformationConfirmation(
    mode: String,
    pending: Boolean,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    val text =
        when (mode) {
            "clear" -> "只清空聊天记录显示，TA的记忆和养成数据会保留"
            "soft" -> "角色和聊天将从列表移除，30天内重新添加可恢复"
            "purge" -> "这会永久删除聊天记录、记忆和养成数据，无法恢复"
            else -> "再次确认永久删除：重新添加也无法恢复这些数据"
        }
    AlertDialog(
        onDismissRequest = { if (!pending) onDismiss() },
        title = { Text("确认操作") },
        text = { Text(text) },
        confirmButton = { TextButton(onConfirm, enabled = !pending) { Text("确认") } },
        dismissButton = { TextButton(onDismiss, enabled = !pending) { Text("取消") } },
    )
}
