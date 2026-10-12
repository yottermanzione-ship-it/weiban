package app.weiban.feature.chat

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import app.weiban.contracts.*
import app.weiban.data.OwnerRecord
import app.weiban.data.SessionCallOptions
import app.weiban.data.SessionRepository
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.tokens.WbSpace
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

@Composable internal fun rememberVoices(
    repository: SessionRepository,
    owner: OwnerRecord,
): NativeRemote<VoiceEndpointsListVoicesResponse> =
    remote("${owner.sessionId}:voices") {
        repository.call(Endpoints.voiceEndpointsListVoices, options = SessionCallOptions(owner = owner, networkOnly = true))
    }

/** 聊天信息页「TA 的声音」行：平台没开通语音合成（音色列表为空）时不显示（media-l5.md 第 6 节）。 */
@Composable internal fun VoiceToneRow(
    repository: SessionRepository,
    owner: OwnerRecord,
    voiceId: String?,
    enabled: Boolean,
    onOpen: () -> Unit,
) {
    val voices = rememberVoices(repository, owner)
    val items =
        voices.data
            ?.items
            .orEmpty()
            .filter { it.enabled }
    if (items.isEmpty()) return
    val name = voiceId?.let { id -> items.find { it.voiceId == id }?.name } ?: "默认"
    TextButton(onClick = onOpen, enabled = enabled) { Text("TA 的声音  $name ›") }
}

/**
 * 音色选择页（MED-03 第 1 条）：第一行「默认」（voiceId = null，用管理员给 TA 选的默认音色）；
 * 点行即选中并保存（乐观更新，失败退回 + 提示）；试听独立，不选中、不扣费。
 */
@Composable internal fun VoiceTonePage(
    repository: SessionRepository,
    owner: OwnerRecord,
    characterId: String,
    initialVoiceId: String?,
    onBack: () -> Unit,
) {
    BackHandler(onBack = onBack)
    val context = LocalContext.current
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    val voices = rememberVoices(repository, owner)
    val sample = remember(owner) { SamplePlayer(context, repository, owner, scope) }
    DisposableEffect(sample) { onDispose { sample.stop() } }
    var current by remember(characterId) { mutableStateOf(initialVoiceId) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun choose(id: String?) {
        if (saving || id == current) return
        val before = current
        current = id
        saving = true
        error = null
        scope.launch {
            userAction({
                current = before
                error = "保存失败，请稍后再试"
            }) {
                repository.call(
                    Endpoints.companionEndpointsUpdateForCharacter,
                    params = mapOf("characterId" to characterId),
                    body = buildJsonObject { put("voiceId", id?.let(::JsonPrimitive) ?: JsonNull) },
                    options = SessionCallOptions(owner = owner),
                )
            }
            saving = false
        }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(WbSpace.S5)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("‹") }
            Text("TA 的声音", style = MaterialTheme.typography.titleMedium)
        }
        when {
            voices.loading && voices.data == null ->
                repeat(
                    5,
                ) { LinearProgressIndicator(Modifier.fillMaxWidth().padding(vertical = WbSpace.S5)) }
            voices.error != null && voices.data == null ->
                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth().padding(WbSpace.S8)) {
                    Text("加载失败")
                    Button(onClick = voices::refresh) { Text("重试") }
                }
            else -> {
                VoiceOption("默认", emptyList(), current == null, null, false, { choose(null) }) {}
                voices.data
                    ?.items
                    .orEmpty()
                    .filter { it.enabled }
                    .forEach { voice ->
                        VoiceOption(
                            voice.name,
                            voice.tags,
                            current == voice.voiceId,
                            voice.sampleMediaId,
                            sample.playing == voice.voiceId,
                            { choose(voice.voiceId) },
                        ) {
                            voice.sampleMediaId?.let { media ->
                                sample.toggle(voice.voiceId, media) { error = "试听暂时不可用" }
                            }
                        }
                    }
            }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Spacer(Modifier.height(WbSpace.S5))
        Text(
            "所有声音都是合成音色，不模仿任何真人的声音。改了以后，语音消息和通话都会用新的声音。",
            color = colors.textSecondary,
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

@Composable private fun VoiceOption(
    name: String,
    tags: List<String>,
    selected: Boolean,
    sampleMediaId: String?,
    playing: Boolean,
    onChoose: () -> Unit,
    onPreview: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onChoose).padding(vertical = WbSpace.S3),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (sampleMediaId != null) {
            TextButton(onClick = onPreview) { Text(if (playing) "■" else "▶") }
        } else {
            Spacer(Modifier.width(WbSpace.S8))
        }
        Text(name)
        tags.forEach { tag ->
            Spacer(Modifier.width(WbSpace.S2))
            SuggestionChip(onClick = onChoose, label = { Text(tag) })
        }
        Spacer(Modifier.weight(1f))
        if (selected) Text("✓", color = colors.brandPrimary)
    }
    HorizontalDivider(color = colors.borderHairline)
}
