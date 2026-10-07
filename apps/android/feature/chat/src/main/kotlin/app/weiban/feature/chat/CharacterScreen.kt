package app.weiban.feature.chat

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.weiban.contracts.*
import app.weiban.data.*
import app.weiban.designsystem.tokens.WbSpace
import app.weiban.network.ApiFailure
import kotlinx.coroutines.*
import kotlinx.serialization.json.encodeToJsonElement

private class CharacterUi(
    private val repository: SessionRepository,
    private val runtime: ChatRuntime,
    private val owner: OwnerRecord,
    private val characterId: String,
    private val scope: CoroutineScope,
) {
    var greeting by mutableStateOf("")
    var pending by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    var restore by mutableStateOf(false)
    var added by mutableStateOf<Contact?>(null)

    fun add(mode: String? = null) {
        if (pending) return
        pending = true
        error = null
        scope.launch {
            userAction({ error = it }) {
                try {
                    added =
                        repository.call(
                            Endpoints.contactsEndpointsAdd,
                            body =
                                repository.api.json.encodeToJsonElement(
                                    AddContactRequestInput(characterId, greeting.ifBlank { null }, mode),
                                ),
                            options = SessionCallOptions(owner = owner),
                        )
                    restore = false
                    runtime.refresh(owner)
                } catch (failure: ApiFailure) {
                    if (failure.code == "restore_choice_required") restore = true else error = contactError(failure)
                } finally {
                    pending = false
                }
            }
        }
    }
}

@Composable internal fun ColumnScope.CharacterScreen(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    state: ClientSyncState,
    characterId: String,
    onOpenConversation: (String) -> Unit,
) {
    val profile =
        remote(characterId) {
            repository.call(
                Endpoints.characterEndpointsGetProfile,
                params = mapOf("characterId" to characterId),
                options = SessionCallOptions(owner = owner),
            )
        }
    val scope = rememberCoroutineScope()
    val ui = remember(characterId, owner) { CharacterUi(repository, runtime, owner, characterId, scope) }
    val contact = state.contacts.find { it.characterId == characterId } ?: ui.added
    Column(
        Modifier
            .weight(1f)
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(WbSpace.S5),
        verticalArrangement = Arrangement.spacedBy(WbSpace.S3),
    ) {
        if (profile.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        profile.data?.let { role ->
            RoleAvatar(repository, owner, RoleAvatarIdentity(role.characterId, role.name, role.avatar, contact?.customAvatarMediaId), 64.dp)
            Text(contact?.remark ?: role.name, style = MaterialTheme.typography.headlineSmall)
            if (contact?.remark != null) Text("名字：${role.name}")
            Text(role.tagline)
            Text(role.intro)
            if (role.tags.isNotEmpty()) Text(role.tags.joinToString(" · "))
            if (role.works.isNotEmpty()) Text("作品：${role.works.joinToString("、")}")
            if (role.showPublicSourceNotice) Text("本角色根据公开资料创作，不代表本人", style = MaterialTheme.typography.bodySmall)
        }
        contact?.let {
            Text("认识于 ${it.knownSince}")
            ContactAvatarEditor(repository, runtime, owner, it)
        }
        (ui.error ?: profile.error)?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        CharacterAction(contact, ui, profile.data != null, onOpenConversation)
        TextButton(onClick = {
            profile.refresh()
            scope.launch { userAction({ ui.error = it }) { runtime.refresh(owner) } }
        }) { Text("刷新资料") }
    }
    if (ui.restore) RestoreContact(ui)
}

@Composable private fun CharacterAction(
    contact: Contact?,
    ui: CharacterUi,
    loaded: Boolean,
    onOpen: (String) -> Unit,
) {
    val conversationId = contact?.conversationId
    when {
        conversationId != null ->
            Button(
                onClick = { onOpen(conversationId) },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("发消息") }
        contact?.status == "pending" -> Text("等待通过好友申请")
        else -> {
            OutlinedTextField(ui.greeting, {
                ui.greeting = it.take(50)
            }, Modifier.fillMaxWidth(), label = { Text("打个招呼（选填，${ui.greeting.length}/50）") })
            Button(onClick = { ui.add() }, enabled = loaded && !ui.pending, modifier = Modifier.fillMaxWidth()) {
                Text(if (ui.pending) "正在发送…" else "添加到通讯录")
            }
        }
    }
}

@Composable private fun RestoreContact(ui: CharacterUi) {
    AlertDialog(
        onDismissRequest = { if (!ui.pending) ui.restore = false },
        title = { Text("你们以前认识过") },
        text = { Text("选择恢复以前的聊天记录和记忆，或者重新认识。") },
        confirmButton = { TextButton(onClick = { ui.add("restore") }, enabled = !ui.pending) { Text("恢复旧记录") } },
        dismissButton = { TextButton(onClick = { ui.add("fresh") }, enabled = !ui.pending) { Text("重新认识") } },
    )
}
