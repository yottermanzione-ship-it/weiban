package app.weiban.feature.chat

import androidx.compose.foundation.layout.Box
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import app.weiban.data.OwnerRecord
import app.weiban.data.SessionRepository

/** 默认音色随编辑表单保存，试听只播放库内样音。 */
@Composable internal fun DraftVoiceSelection(
    repository: SessionRepository,
    owner: OwnerRecord,
    voiceId: String?,
    enabled: Boolean,
    onSelect: (String?) -> Unit,
) {
    val voices = rememberVoices(repository, owner)
    val items =
        voices.data
            ?.items
            .orEmpty()
            .filter { it.enabled }
    val selected = items.find { it.voiceId == voiceId }
    var expanded by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val sample = remember(owner) { SamplePlayer(context, repository, owner, scope) }
    DisposableEffect(sample, voiceId) { onDispose { sample.stop() } }
    Box {
        TextButton(enabled = enabled && !voices.loading, onClick = { expanded = true }) {
            Text("音色：${selected?.name ?: if (voiceId == null) "默认" else "原音色暂不可用"}")
        }
        DropdownMenu(expanded && enabled, onDismissRequest = { expanded = false }) {
            DropdownMenuItem(text = { Text("默认（不指定音色）") }, onClick = {
                expanded = false
                onSelect(null)
            })
            items.forEach { voice ->
                DropdownMenuItem(text = { Text(voice.name) }, onClick = {
                    expanded = false
                    onSelect(voice.voiceId)
                })
            }
        }
    }
    if (voices.loading) Text("正在读取音色库")
    if (voices.error != null) TextButton(onClick = voices::refresh) { Text("音色库加载失败，重试") }
    selected?.sampleMediaId?.let { mediaId ->
        TextButton(enabled = enabled, onClick = { sample.toggle(selected.voiceId, mediaId) { error = "试听暂时不可用" } }) {
            Text(if (sample.playing == selected.voiceId) "停止试听" else "试听音色")
        }
    }
    error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    Text("音色用于语音消息和通话，聊天设置中单独选的音色优先。试听不扣余额。", style = MaterialTheme.typography.bodySmall)
}
