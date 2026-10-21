package app.weiban.feature.chat

import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import app.weiban.contracts.*
import app.weiban.data.OwnerRecord
import app.weiban.data.SessionCallOptions
import app.weiban.data.SessionRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** S 原生补齐：手动公开候选，不冒充 P1 的联想 / 同名身份引擎。 */
@Composable internal fun WebCharacterCandidates(
    repository: SessionRepository,
    owner: OwnerRecord,
    query: String,
) {
    val term = query.trim()
    if (term.length !in 2..64) return
    key(owner, term) {
        var candidates by remember { mutableStateOf<List<CharacterSearchCandidate>?>(null) }
        var busy by remember { mutableStateOf(false) }
        var error by remember { mutableStateOf<String?>(null) }
        val scope = rememberCoroutineScope()
        val uri = LocalUriHandler.current
        Column(Modifier.fillMaxWidth()) {
            TextButton(enabled = !busy, onClick = {
                busy = true
                error = null
                scope.launch {
                    try {
                        candidates =
                            repository
                                .call(
                                    Endpoints.searchEndpointsCharacterCandidates,
                                    buildJsonObject {
                                        put("query", term)
                                    },
                                    options = SessionCallOptions(owner = owner, networkOnly = true),
                                ).items
                    } catch (
                        cancelled: CancellationException,
                    ) {
                        throw cancelled
                    } catch (failure: Exception) {
                        error =
                            when ((failure as? app.weiban.network.ApiFailure)?.code) {
                                "rate_limited" -> "查询次数较多，请稍后再试"
                                "bad_request" -> "请使用公开人物或作品的名称"
                                else -> "联网查找暂时不可用，请稍后重试"
                            }
                    } finally {
                        busy = false
                    }
                }
            }) {
                Text(
                    if (busy) {
                        "正在查找公开资料…"
                    } else if (error != null) {
                        "重试联网查找"
                    } else {
                        "联网找找公开角色"
                    },
                )
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            if (candidates?.isEmpty() == true) Text("暂未找到公开候选，可尝试完整名字或作品名")
            candidates.orEmpty().forEach { candidate ->
                ListItem(headlineContent = { Text(candidate.name) }, supportingContent = { Text(candidate.description) })
                Row {
                    TextButton(onClick = {
                        L6Overlays.customEditor.value =
                            CustomEditorOpen(
                                owner,
                                seedName = candidate.name,
                                seedDescription = "${candidate.description}\n公开资料参考：${candidate.sourceUrl}".take(2000),
                            )
                    }) { Text("用作创建参考") }
                    TextButton(onClick = {
                        val source = Uri.parse(candidate.sourceUrl)
                        if (source.scheme in setOf("https", "http")) runCatching { uri.openUri(candidate.sourceUrl) }
                    }) { Text("查看公开来源") }
                }
            }
            if (!candidates.isNullOrEmpty()) Text("候选来自公开网页，请核实身份、资料及角色分类后创建。", style = MaterialTheme.typography.bodySmall)
        }
    }
}
