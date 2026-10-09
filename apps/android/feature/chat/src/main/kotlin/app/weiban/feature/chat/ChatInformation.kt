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
    val repository: SessionRepository,
    private val runtime: ChatRuntime,
    val owner: OwnerRecord,
    private val scope: CoroutineScope,
) {
    var pending by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    var saved by mutableStateOf(false)
    var notice by mutableStateOf<String?>(null)

    fun change(
        after: () -> Unit = {},
        failed: () -> Unit = {},
        operation: suspend () -> Unit,
    ) {
        if (pending) return
        pending = true
        error = null
        saved = false
        notice = null
        scope.launch {
            try {
                userAction({
                    error = it
                    failed()
                }) {
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

internal data class InformationNavigation(
    val back: () -> Unit,
    val models: () -> Unit = {},
)

@Composable internal fun ChatInformation(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    state: ClientSyncState,
    conversation: Conversation,
    navigation: InformationNavigation,
    onRemoved: () -> Unit,
) {
    val characterId = conversation.participants.find { it.kind == "character" }?.refId ?: return
    val contact = state.contacts.find { it.characterId == characterId }
    var memoryPage by remember(owner, characterId) { mutableStateOf(false) }
    var timelinePage by remember(owner, characterId) { mutableStateOf(false) }
    if (memoryPage) {
        MemoryManagement(repository, owner, characterId) { memoryPage = false }
        return
    }
    val names = characterNames(repository, listOf(characterId))
    if (timelinePage) {
        CharacterTimeline(repository, owner, characterId, contact?.remark ?: names[characterId].orEmpty()) { timelinePage = false }
        return
    }
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
        TextButton(navigation.back, enabled = !actions.pending) { Text("返回聊天") }
        Text("聊天信息", style = MaterialTheme.typography.headlineSmall)
        Text(title(state, conversation, names))
        InformationPreferences(actions, conversation, companion, characterId)
        Text("和 TA 的相处", style = MaterialTheme.typography.titleSmall)
        TextButton(onClick = { timelinePage = true }, enabled = !actions.pending) { Text("TA 的近况 ›") }
        companion.data?.let { InformationProactive(actions, companion, characterId, it) }
        TextButton(onClick = navigation.models, enabled = !actions.pending) { Text("模型选择") }
        TextButton(onClick = { memoryPage = true }, enabled = !actions.pending) { Text("TA记住了什么") }
        InformationNames(actions, contact, characterId)
        (actions.error ?: companion.error)?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (actions.saved) Text(actions.notice ?: "已保存")
        InformationRemoval(actions, conversation.conversationId, characterId, navigation.back, onRemoved)
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
        InformationPersona(actions, companion, characterId, settings)
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
    var relationship by remember(contact?.relationship) { mutableStateOf(contact?.relationship ?: "朋友") }
    OutlinedTextField(remark, { if (it.length <= 20) remark = it }, label = { Text("备注名") }, enabled = !actions.pending)
    OutlinedTextField(addressAs, { if (it.length <= 20) addressAs = it }, label = { Text("TA怎么叫我") }, enabled = !actions.pending)
    OutlinedTextField(relationship, { if (it.length <= 30) relationship = it }, label = { Text("我们的关系") }, enabled = !actions.pending)
    Button(enabled = !actions.pending && relationship.isNotBlank(), onClick = {
        actions.change {
            actions.call(
                Endpoints.contactsEndpointsUpdate,
                characterId,
                buildJsonObject {
                    put("remark", remark.takeIf { it.isNotBlank() }?.let(::JsonPrimitive) ?: JsonNull)
                    put("relationship", relationship)
                    put("addressAs", addressAs.takeIf { it.isNotBlank() }?.let(::JsonPrimitive) ?: JsonNull)
                },
            )
        }
    }) { Text("保存称呼和关系") }
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

@Composable private fun InformationPersona(
    actions: InformationActions,
    companion: NativeRemote<CompanionEndpointsGetForCharacterResponse>,
    characterId: String,
    settings: CompanionEndpointsGetForCharacterResponse,
) {
    val modes =
        remote("${actions.owner.sessionId}:modes:$characterId") {
            actions.repository.call(
                Endpoints.companionEndpointsListModes,
                params = mapOf("characterId" to characterId),
                options = SessionCallOptions(owner = actions.owner),
            )
        }
    var fit by remember(settings.personaFit) { mutableFloatStateOf((settings.personaFit ?: 3).toFloat()) }
    Text("人设贴合度：${fit.toInt()}（1更顺从，5更贴合人设）")
    Slider(fit, { fit = it }, valueRange = 1f..5f, steps = 3, enabled = !actions.pending, onValueChangeFinished = {
        actions.change(after = companion::refresh) {
            actions.call(Endpoints.companionEndpointsUpdateForCharacter, characterId, buildJsonObject { put("personaFit", fit.toInt()) })
        }
    })
    Text("情景模式")
    modes.data?.items?.forEach { mode ->
        TextButton(enabled = !actions.pending && settings.scenarioMode != mode.id, onClick = {
            actions.change(after = companion::refresh) {
                actions.call(Endpoints.companionEndpointsUpdateForCharacter, characterId, buildJsonObject { put("scenarioMode", mode.id) })
            }
        }) { Text(mode.name) }
    }
    modes.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
}

private val proactiveFrequencies = listOf("low" to "少", "medium" to "适中", "high" to "多")

/** 主动消息（SIM-10、CHAT-13 第 2 条）：开关 + 三档频率，乐观更新，失败退回；另含「TA 的日常」（SIM-13）。 */
@Composable private fun InformationProactive(
    actions: InformationActions,
    companion: NativeRemote<CompanionEndpointsGetForCharacterResponse>,
    characterId: String,
    settings: CompanionEndpointsGetForCharacterResponse,
) {
    val global =
        remote("${actions.owner.sessionId}:notification-settings") {
            actions.repository.call(
                Endpoints.identityEndpointsGetNotificationSettings,
                options = SessionCallOptions(owner = actions.owner, networkOnly = true),
            )
        }
    val globalOff = global.data?.proactiveMessagesEnabled == false
    var enabled by remember(settings.proactiveMessages) { mutableStateOf(settings.proactiveMessages ?: true) }
    var frequency by remember(settings.proactiveFrequency) { mutableStateOf(settings.proactiveFrequency ?: "medium") }
    var daily by remember(settings.dailyLife) { mutableStateOf(settings.dailyLife ?: true) }
    InformationToggle("TA 主动找我", enabled && !globalOff, !actions.pending && !globalOff) { value ->
        val before = enabled
        enabled = value
        actions.change(after = companion::refresh, failed = { enabled = before }) {
            actions.call(Endpoints.companionEndpointsUpdateForCharacter, characterId, buildJsonObject { put("proactiveMessages", value) })
        }
    }
    if (globalOff) {
        Text("已在 我 › 服务 › 主动消息与免打扰 中关闭", style = MaterialTheme.typography.bodySmall)
    } else if (enabled) {
        Row(horizontalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
            Text("频率")
            proactiveFrequencies.forEach { (id, label) ->
                FilterChip(
                    selected = frequency == id,
                    enabled = !actions.pending,
                    onClick = {
                        if (frequency != id) {
                            val before = frequency
                            frequency = id
                            actions.change(after = {
                                actions.notice = "下一次主动消息开始生效"
                                companion.refresh()
                            }, failed = { frequency = before }) {
                                actions.call(
                                    Endpoints.companionEndpointsUpdateForCharacter,
                                    characterId,
                                    buildJsonObject { put("proactiveFrequency", id) },
                                )
                            }
                        }
                    },
                    label = { Text(label) },
                )
            }
        }
    }
    InformationToggle("TA 的日常", daily, !actions.pending) { value ->
        val before = daily
        daily = value
        actions.change(after = companion::refresh, failed = { daily = before }) {
            actions.call(Endpoints.companionEndpointsUpdateForCharacter, characterId, buildJsonObject { put("dailyLife", value) })
        }
    }
}
