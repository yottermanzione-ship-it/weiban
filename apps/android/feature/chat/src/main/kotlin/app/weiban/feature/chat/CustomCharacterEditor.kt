package app.weiban.feature.chat

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import app.weiban.contracts.*
import app.weiban.data.*
import app.weiban.designsystem.PhotoCropper
import app.weiban.designsystem.tokens.WbSpace
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

internal data class CustomEditorOpen(
    val owner: OwnerRecord,
    val characterId: String? = null,
    val nonce: Long = System.nanoTime(),
    val seedName: String? = null,
    val seedDescription: String? = null,
)

@Composable internal fun ColumnScope.MyCustomCharacters(
    repository: SessionRepository,
    owner: OwnerRecord,
    onSelect: (String) -> Unit,
) {
    val roles =
        remote("${owner.sessionId}:my-custom") {
            repository.call(Endpoints.userCustomEndpointsList, options = SessionCallOptions(owner = owner, networkOnly = true))
        }
    val editor by L6Overlays.customEditor.collectAsState()
    LaunchedEffect(editor) { if (editor == null) roles.refresh() }
    if (roles.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
    roles.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    LazyColumn(Modifier.weight(1f)) {
        items(roles.data?.items.orEmpty(), key = { it.characterId }) { role ->
            ListItem(
                headlineContent = { Text(role.name) },
                leadingContent = { RoleAvatar(repository, owner, RoleAvatarIdentity(role.characterId, role.name, role.avatar)) },
                supportingContent = { Text(role.tagline) },
                trailingContent = { if (role.added) Text("已添加") },
                modifier = Modifier.clickable { onSelect(role.characterId) },
            )
        }
        if (!roles.loading && roles.data?.items?.isEmpty() == true) item { Text("还没有自己创建的角色", Modifier.padding(WbSpace.S5)) }
    }
    TextButton(onClick = { roles.refresh() }) { Text("刷新我的角色") }
}

internal class CustomCharacterDraft(
    existing: UserCustomCharacter? = null,
) {
    var name by mutableStateOf(existing?.name.orEmpty())
    var description by mutableStateOf(existing?.description.orEmpty())
    var birthday by mutableStateOf(existing?.birthday.orEmpty())
    var phrases by mutableStateOf((existing?.catchphrases ?: listOfNotNull(existing?.catchphrase)).joinToString("\n"))
    var style by mutableStateOf(existing?.speechStyle.orEmpty())
    var examples by mutableStateOf(existing?.exampleDialogue.orEmpty())
    var tags by mutableStateOf(existing?.tags.orEmpty().joinToString("，"))
    var avatarMediaId by mutableStateOf(existing?.avatar?.image?.mediaId)
    var voiceId by mutableStateOf(existing?.voiceId)
    var basis by mutableStateOf(existing?.classification?.basis ?: "original")
    var age by mutableStateOf(existing?.classification?.ageSetting ?: "adult")
    var realKind by mutableStateOf(existing?.classification?.realPersonKind ?: "private_person")
    var childAppearance by mutableStateOf(existing?.classification?.childAppearance ?: false)
    val existingClassification = existing?.classification
    var plazaCopy by mutableStateOf(false)

    fun basisAllowed(next: String): Boolean {
        val existing = existingClassification
        return when {
            existing == null -> true
            existing.basis == "real_person" -> next == "real_person"
            else -> !plazaCopy || next == existing.basis || next == "real_person"
        }
    }

    fun body(): JsonObject =
        buildJsonObject {
            put("name", name.trim())
            put("description", description.trim())
            put("birthday", birthday.trim().takeIf(String::isNotEmpty)?.let(::JsonPrimitive) ?: JsonNull)
            put(
                "catchphrases",
                JsonArray(
                    phrases
                        .lines()
                        .map(String::trim)
                        .filter(String::isNotEmpty)
                        .map(::JsonPrimitive),
                ),
            )
            put("speechStyle", style.trim())
            put("exampleDialogue", examples)
            put(
                "tags",
                JsonArray(
                    tags
                        .split(',', '，', '、')
                        .map(String::trim)
                        .filter(String::isNotEmpty)
                        .map(::JsonPrimitive),
                ),
            )
            put("avatarMediaId", avatarMediaId?.let(::JsonPrimitive) ?: JsonNull)
            put("voiceId", voiceId?.let(::JsonPrimitive) ?: JsonNull)
            put(
                "classification",
                buildJsonObject {
                    put("basis", basis)
                    put("ageSetting", age)
                    put("realPersonKind", if (basis == "real_person") JsonPrimitive(realKind) else JsonNull)
                    put("childAppearance", childAppearance)
                },
            )
        }

    fun validationError(): String? {
        val phraseList = phrases.lines().map(String::trim).filter(String::isNotEmpty)
        val tagList = tags.split(',', '，', '、').map(String::trim).filter(String::isNotEmpty)
        return when {
            name.trim().isEmpty() -> "请填写角色名字"
            basis !in setOf("original", "fictional", "real_person") -> "请选择角色原型分类"
            description.trim().length < 50 -> "人设描述至少需要50字"
            phraseList.size > 10 || phraseList.any { it.length > 50 } -> "最多10句口头禅，每句最多50字"
            tagList.size > 10 || tagList.any { it.length > 16 } -> "最多10个标签，每个最多16字"
            birthday.isNotBlank() && runCatching { java.time.LocalDate.parse(birthday.trim()) }.isFailure -> "生日请填写有效的YYYY-MM-DD日期"
            else -> null
        }
    }
}

@Composable internal fun CustomCharacterEditEntry(
    repository: SessionRepository,
    owner: OwnerRecord,
    characterId: String,
) {
    var owned by remember(owner, characterId) { mutableStateOf(false) }
    LaunchedEffect(owner, characterId) {
        userAction({}) {
            owned =
                repository
                    .call(Endpoints.userCustomEndpointsList, options = SessionCallOptions(owner = owner, networkOnly = true))
                    .items
                    .any { it.characterId == characterId }
        }
    }
    if (owned) TextButton(onClick = { L6Overlays.customEditor.value = CustomEditorOpen(owner, characterId) }) { Text("编辑角色人设") }
}

@Composable internal fun CustomCharacterEditor(
    repository: SessionRepository,
    runtime: ChatRuntime,
    open: CustomEditorOpen,
    onClose: () -> Unit,
) {
    val auth by repository.auth.collectAsState()
    if (auth?.user?.userId != open.owner.userId || auth?.session?.sessionId != open.owner.sessionId) return
    var draft by remember(open) {
        mutableStateOf(
            if (open.characterId == null) {
                CustomCharacterDraft().also {
                    open.seedName?.let { name ->
                        it.name = name.take(32)
                        it.basis = ""
                    }
                    open.seedDescription?.let { description -> it.description = description.take(2000) }
                }
            } else {
                null
            },
        )
    }
    var error by remember(open) { mutableStateOf<String?>(null) }
    var saved by remember(open) { mutableStateOf<UserCustomCharacter?>(null) }
    LaunchedEffect(open) {
        if (open.characterId != null) {
            userAction({ error = it }) {
                val role =
                    repository
                        .call(Endpoints.userCustomEndpointsList, options = SessionCallOptions(owner = open.owner, networkOnly = true))
                        .items
                        .find { it.characterId == open.characterId } ?: error("这个角色无法编辑")
                val origin =
                    repository
                        .call(
                            Endpoints.customCharacterOriginEndpointsGetOrigin,
                            params = mapOf("characterId" to open.characterId),
                            options = SessionCallOptions(owner = open.owner, networkOnly = true),
                        ).origin
                draft =
                    CustomCharacterDraft(role).also {
                        it.plazaCopy =
                            (origin as? JsonObject)?.get("kind")?.jsonPrimitive?.content == "plaza_copy"
                    }
            }
        }
    }
    BackHandler(onBack = onClose)
    Surface(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            TextButton(onClick = onClose) { Text("‹ 返回") }
            val result = saved
            val fields = draft
            when {
                result != null -> CustomCharacterSaved(repository, runtime, open.owner, result, onClose)
                fields != null -> CustomCharacterForm(repository, open, fields, onSaved = { saved = it })
                error != null -> Text(error.orEmpty(), Modifier.padding(WbSpace.S5), color = MaterialTheme.colorScheme.error)
                else -> LinearProgressIndicator(Modifier.fillMaxWidth())
            }
        }
    }
}

@Composable private fun CustomCharacterForm(
    repository: SessionRepository,
    open: CustomEditorOpen,
    draft: CustomCharacterDraft,
    onSaved: (UserCustomCharacter) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var trial by remember { mutableStateOf<String?>(null) }
    trial?.let { conversationId -> CharacterTrialDialog(repository, open.owner, conversationId, draft.name) { trial = null } }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(WbSpace.S5),
        verticalArrangement = Arrangement.spacedBy(WbSpace.S3),
    ) {
        Text(if (open.characterId == null) "创建自己的角色" else "编辑角色人设", style = MaterialTheme.typography.headlineSmall)
        CustomCharacterTextFields(draft)
        CustomCharacterClassification(draft)
        DraftVoiceSelection(repository, open.owner, draft.voiceId, !pending) { draft.voiceId = it }
        Text("角色头像")
        PhotoCropper(enabled = !pending, onRestore = draft.avatarMediaId?.let { { draft.avatarMediaId = null } }) { bytes ->
            pending = true
            try {
                draft.avatarMediaId = uploadMedia(repository, open.owner, bytes, "image/png", "custom_character_avatar").mediaId
            } finally {
                pending = false
            }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Button(enabled = !pending, onClick = {
            error = draft.validationError()
            if (error == null) {
                pending = true
                scope.launch {
                    try {
                        userAction({ error = it }) {
                            val endpoint =
                                if (open.characterId ==
                                    null
                                ) {
                                    Endpoints.userCustomEndpointsCreate
                                } else {
                                    Endpoints.userCustomEndpointsUpdate
                                }
                            onSaved(
                                repository.call(
                                    endpoint,
                                    params = open.characterId?.let { mapOf("characterId" to it) }.orEmpty(),
                                    body = draft.body(),
                                    options = SessionCallOptions(owner = open.owner, networkOnly = true),
                                ),
                            )
                        }
                    } finally {
                        pending = false
                    }
                }
            }
        }) { Text(if (pending) "正在保存…" else "保存角色") }
        TextButton(enabled = !pending && trial == null, onClick = {
            error = draft.validationError()
            if (error == null) {
                val body = JsonObject(draft.body() + open.characterId?.let { mapOf("sourceCharacterId" to JsonPrimitive(it)) }.orEmpty())
                pending = true
                scope.launch {
                    try {
                        userAction({ error = it }) {
                            trial =
                                repository
                                    .call(
                                        Endpoints.userCustomEndpointsDraftTrial,
                                        body = body,
                                        options = SessionCallOptions(owner = open.owner, networkOnly = true),
                                    ).conversationId
                        }
                    } finally {
                        pending = false
                    }
                }
            }
        }) { Text("保存前试聊") }
    }
}

@Composable private fun CustomCharacterTextFields(draft: CustomCharacterDraft) {
    OutlinedTextField(draft.name, { draft.name = it.take(32) }, Modifier.fillMaxWidth(), label = { Text("名字（必填）") })
    OutlinedTextField(draft.description, { draft.description = it.take(2000) }, Modifier.fillMaxWidth(), label = { Text("人设描述（至少50字）") })
    OutlinedTextField(draft.birthday, { draft.birthday = it.take(10) }, Modifier.fillMaxWidth(), label = { Text("生日（YYYY-MM-DD，可不填）") })
    OutlinedTextField(draft.phrases, { draft.phrases = it }, Modifier.fillMaxWidth(), label = { Text("口头禅（每行一句，最多10句）") })
    OutlinedTextField(draft.style, { draft.style = it.take(500) }, Modifier.fillMaxWidth(), label = { Text("说话风格") })
    OutlinedTextField(draft.examples, { draft.examples = it.take(2000) }, Modifier.fillMaxWidth(), label = { Text("示例对话") })
    OutlinedTextField(draft.tags, { draft.tags = it }, Modifier.fillMaxWidth(), label = { Text("标签（逗号分隔）") })
}

@Composable private fun CustomCharacterClassification(draft: CustomCharacterDraft) {
    Text("分类（必选）")
    Text("原创角色：名字和经历是新编的，不以任何真实人物的身份出现。以某位真人的性格、说话风格为灵感也算原创，只要不用 TA 的真名、不写 TA 的真实作品、人际关系和经历。")
    Text("虚构作品中的角色：出自影视、动画、小说、游戏等作品。")
    Text("真人：以真实人物本人的身份出现：用 TA 的真名，或写了 TA 的真实作品、人际关系、经历。包括你身边的朋友、家人。")
    Text("选择『真人』的角色不会有成人模式，也不会生成 TA 的肖像。")
    Row(horizontalArrangement = Arrangement.spacedBy(WbSpace.S2)) {
        listOf("original" to "原创", "fictional" to "虚构", "real_person" to "真人").forEach { (basis, label) ->
            FilterChip(
                selected = draft.basis == basis,
                onClick = { draft.basis = basis },
                label = { Text(label) },
                enabled = draft.basisAllowed(basis),
            )
        }
    }
    if (draft.basis == "real_person") {
        Row {
            listOf("private_person" to "身边真人", "celebrity" to "公众人物", "historical" to "历史人物").forEach { (kind, label) ->
                FilterChip(
                    selected = draft.realKind == kind,
                    onClick = { draft.realKind = kind },
                    label = { Text(label) },
                    enabled =
                        !draft.plazaCopy || draft.existingClassification?.basis != "real_person" ||
                            kind == draft.existingClassification.realPersonKind,
                )
            }
        }
    }
    Row {
        FilterChip(
            selected = draft.age == "adult",
            onClick = { draft.age = "adult" },
            label = { Text("成年") },
            enabled = draft.existingClassification?.ageSetting != "minor",
        )
        FilterChip(selected = draft.age == "minor", onClick = { draft.age = "minor" }, label = { Text("未成年") })
    }
    Row {
        Checkbox(
            draft.childAppearance,
            onCheckedChange = { draft.childAppearance = it },
            enabled =
                draft.existingClassification?.childAppearance != true,
        )
        Text("具有儿童外貌特征")
    }
    if (draft.existingClassification?.childFeaturesDetected == true) Text("已检测到儿童特征，相关功能会按未成年角色设置。")
    if (draft.plazaCopy) Text("这个角色来自人设广场，分类与原作品相同，只能改得更严格。")
}

@Composable private fun ColumnScope.CustomCharacterSaved(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    role: UserCustomCharacter,
    onClose: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var trialConversationId by remember { mutableStateOf<String?>(null) }
    trialConversationId?.let { conversationId ->
        CharacterTrialDialog(repository, owner, conversationId, role.name) {
            trialConversationId =
                null
        }
    }
    Text("角色已保存", Modifier.padding(WbSpace.S5))
    if (role.childFeaturesDetected) Text("检测到儿童特征，相关功能会按未成年角色设置。", Modifier.padding(WbSpace.S5))
    TextButton(enabled = !pending, onClick = {
        pending = true
        scope.launch {
            try {
                userAction({ error = it }) {
                    val trial =
                        repository.call(
                            Endpoints.userCustomEndpointsStartTrial,
                            params = mapOf("characterId" to role.characterId),
                            options = SessionCallOptions(owner = owner, networkOnly = true),
                        )
                    trialConversationId = trial.conversationId
                }
            } finally {
                pending = false
            }
        }
    }) { Text("试聊一下") }
    error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    val snapshot by runtime.snapshot.collectAsState()
    val state = if (snapshot.owner == owner) snapshot.state else SyncEngine.freshState()
    CharacterScreen(repository, runtime, owner, state, role.characterId, { conversationId ->
        onClose()
        GrowthNavigation.openConversation(conversationId)
    })
}
