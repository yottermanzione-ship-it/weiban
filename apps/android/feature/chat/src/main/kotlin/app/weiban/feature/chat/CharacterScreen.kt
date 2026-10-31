package app.weiban.feature.chat

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.weiban.contracts.*
import app.weiban.data.*
import app.weiban.designsystem.tokens.WbSpace
import app.weiban.network.ApiFailure
import kotlinx.coroutines.*
import kotlinx.serialization.json.encodeToJsonElement

@Suppress("LongParameterList") // 首次本机构建（2026-10-11）：保留既有逻辑，复杂度待重构
private class CharacterUi(
    private val repository: SessionRepository,
    private val runtime: ChatRuntime,
    private val owner: OwnerRecord,
    private val characterId: String,
    private val scope: CoroutineScope,
    initialGreeting: String,
    private val referrerCharacterId: String? = null,
) {
    var dismissed by mutableStateOf(false)

    /** 名片「不感兴趣」（CHR-04 第 4 条）：直接生效，不二次确认。 */
    fun dismiss() {
        if (referrerCharacterId == null || pending) return
        pending = true
        scope.launch {
            try {
                userAction({ error = it }) {
                    repository.call(
                        Endpoints.contactCardEndpointsDismissRecommendation,
                        params = mapOf("characterId" to characterId),
                        options = SessionCallOptions(owner = owner),
                    )
                    dismissed = true
                }
            } finally {
                pending = false
            }
        }
    }

    var greeting by mutableStateOf(initialGreeting)
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
                                    AddContactRequestInput(characterId, greeting.ifBlank { null }, mode, referrerCharacterId),
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
    progress: OnboardingProgress? = null,
    referral: ProfileTarget? = null,
    onTimelineAsk: ((conversationId: String, text: String) -> Unit)? = null,
    onOpenCharacter: ((String) -> Unit)? = null,
) {
    var sub by remember(characterId) { mutableStateOf<String?>(null) }
    when (sub) {
        "moments" -> {
            CharacterMoments(repository, owner, state, characterId) { sub = null }
            return
        }
        "relations" -> {
            CharacterRelations(repository, owner, state, characterId) { sub = null }
            return
        }
        "cards" -> {
            CardAlbumPage(repository, runtime, owner, characterId) { sub = null }
            return
        }
    }
    val profile =
        remote(characterId) {
            repository.call(
                Endpoints.characterEndpointsGetProfile,
                params = mapOf("characterId" to characterId),
                options = SessionCallOptions(owner = owner),
            )
        }
    val scope = rememberCoroutineScope()
    val ui =
        remember(characterId, owner) {
            CharacterUi(
                repository,
                runtime,
                owner,
                characterId,
                scope,
                progress?.draft?.greeting ?: referral?.greeting.orEmpty(),
                referral?.referrerCharacterId,
            )
        }
    val customEditor by L6Overlays.customEditor.collectAsState()
    LaunchedEffect(customEditor) { if (customEditor == null) profile.refresh() }
    val contact = state.contacts.find { it.characterId == characterId } ?: ui.added
    if (sub == "timeline") {
        val ask =
            if (onTimelineAsk != null) {
                contact?.conversationId?.let { cid ->
                    { text: String -> onTimelineAsk(cid, text) }
                }
            } else {
                null
            }
        CharacterTimeline(
            repository,
            owner,
            characterId,
            contact?.remark ?: profile.data?.name.orEmpty(),
            { sub = null },
            onAsk = ask,
            onOpenCharacter = onOpenCharacter,
        )
        return
    }
    Column(
        Modifier
            .weight(1f)
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(WbSpace.S5),
        verticalArrangement = Arrangement.spacedBy(WbSpace.S3),
    ) {
        // 固定布局：进度条占位、头部定高、主操作紧随其后；资料异步到达时「发消息」等按钮不跳位。
        Box(Modifier.fillMaxWidth().height(4.dp)) {
            if (profile.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        }
        CharacterHeader(repository, owner, profile.data, contact)
        CharacterAction(contact, ui, profile.data, onOpenConversation, progress?.let { it::greet })
        if (referral?.referrerCharacterId != null && contact == null) {
            if (ui.dismissed) {
                Text("好的，不会再推荐 TA", style = MaterialTheme.typography.bodySmall)
            } else {
                TextButton(onClick = ui::dismiss, enabled = !ui.pending) { Text("不感兴趣") }
            }
        }
        (ui.error ?: profile.error)?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        profile.data?.let { role ->
            if (role.personaUpdatedUnseen) PersonaUpdatedBadge(repository, owner, role.characterId) { profile.refresh() }
            // 复制来的角色：来源标注与新版本提示（PLZ-04 第 4 条、PLZ-05 第 4 条）。
            if (role.kind == "custom") {
                PlazaOriginNote(repository, owner, role.characterId)
                CustomCharacterEditEntry(repository, owner, role.characterId)
            }
            Text(role.tagline)
            Text(role.intro)
            if (role.tags.isNotEmpty()) Text(role.tags.joinToString(" · "))
            if (role.works.isNotEmpty()) Text("作品：${role.works.joinToString("、")}")
            if (role.showPublicSourceNotice) Text("本角色根据公开资料创作，不代表本人", style = MaterialTheme.typography.bodySmall)
        }
        contact?.let {
            if (it.conversationId != null) {
                FamiliaritySummary(repository, owner, characterId)
            } else {
                Text("认识于 ${it.knownSince}")
            }
            ContactAvatarEditor(repository, runtime, owner, it)
        }
        if (progress == null) {
            TextButton(onClick = { sub = "moments" }) { Text("朋友圈 ›") }
            if (contact?.conversationId != null) {
                RecentTimelineRow(repository, owner, characterId) { sub = "timeline" }
            }
            // 角色资料页 › 卡册（GRW-05；cards-familiarity.md 3.1）。
            if (contact?.conversationId != null) TextButton(onClick = { sub = "cards" }) { Text("卡册 ›") }
            if (contact?.conversationId != null && profile.data?.kind == "custom") {
                CustomRelationsEntry(repository, owner, characterId) { sub = "relations" }
            }
        }
        TextButton(onClick = {
            profile.refresh()
            scope.launch { userAction({ ui.error = it }) { runtime.refresh(owner) } }
        }) { Text("刷新资料") }
    }
    if (ui.restore) RestoreContact(ui)
}

/** 资料页「TA 的动态」行（网页版 RecentRow 同款）：右侧显示最近一条事件文字，点进时间线页。 */
@Composable private fun ColumnScope.RecentTimelineRow(
    repository: SessionRepository,
    owner: OwnerRecord,
    characterId: String,
    onOpen: () -> Unit,
) {
    val latest =
        remote("timeline-latest:$characterId") {
            repository.call(
                Endpoints.timelineEndpointsListTimeline,
                params = mapOf("characterId" to characterId),
                query = mapOf("limit" to "1"),
                options = SessionCallOptions(owner = owner, networkOnly = true),
            )
        }
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(vertical = WbSpace.S3),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(WbSpace.S3),
    ) {
        Text("TA 的动态 ›", style = MaterialTheme.typography.bodyLarge)
        Text(
            latest.data?.items?.firstOrNull()?.summary.orEmpty(),
            Modifier.weight(1f),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

/** 资料页头部：定高 64dp，资料未到时用同尺寸占位，避免下方按钮随加载移动。 */
@Composable private fun CharacterHeader(
    repository: SessionRepository,
    owner: OwnerRecord,
    role: CharacterProfile?,
    contact: Contact?,
) {
    Row(
        Modifier.fillMaxWidth().height(64.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(WbSpace.S3),
    ) {
        Box(Modifier.size(64.dp)) {
            if (role != null) {
                val identity = RoleAvatarIdentity(role.characterId, role.name, role.avatar, contact?.customAvatarMediaId)
                RoleAvatar(repository, owner, identity, 64.dp)
            }
        }
        Column {
            Text(contact?.remark ?: role?.name.orEmpty(), style = MaterialTheme.typography.headlineSmall, maxLines = 1)
            if (contact?.remark != null && role != null) Text("名字：${role.name}", maxLines = 1)
        }
    }
}

@Composable private fun CharacterAction(
    contact: Contact?,
    ui: CharacterUi,
    role: CharacterProfile?,
    onOpen: (String) -> Unit,
    onGreetingChange: ((String) -> Unit)?,
) {
    val conversationId = contact?.conversationId
    val loaded = role != null
    when {
        conversationId != null -> {
            Button(
                onClick = { onOpen(conversationId) },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("发消息") }
            // 资料页「语音通话」（MED-06 第 1 条）；平台未开通时不显示。
            if (role != null && rememberCallEntry(role.characterId)) {
                val dial = rememberDial()
                OutlinedButton(
                    onClick = { dial(role.characterId, contact?.remark ?: role.name) },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("语音通话") }
            }
        }
        contact?.status == "pending" -> Text("等待通过好友申请")
        else -> {
            OutlinedTextField(ui.greeting, {
                ui.greeting = it.take(50)
                onGreetingChange?.invoke(ui.greeting)
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
