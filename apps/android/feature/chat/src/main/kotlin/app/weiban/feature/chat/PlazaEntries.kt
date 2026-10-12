@file:Suppress("TooGenericExceptionCaught")

package app.weiban.feature.chat

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalContext
import app.weiban.contracts.*
import app.weiban.data.*
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.tokens.WbOpacity
import app.weiban.designsystem.tokens.WbSpace
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

/*
 * 入口与来源标注（CHAT-13、PLZ-02 第 1 条、PLZ-04 第 4 条、PLZ-05 第 4 条）。
 */

/** 解析后的自定义角色来源（契约 CustomCharacterOrigin 为 JSON 联合类型）。 */
private data class PlazaCopyOrigin(
    val workId: String,
    val version: Long,
    val authorName: String,
    val authorDeleted: Boolean,
    val workAvailable: Boolean,
    val newerVersion: Long?,
)

@Suppress("ReturnCount") // 首次本机构建（2026-10-11）：保留既有逻辑，复杂度待重构
private fun parseOrigin(origin: JsonElement): PlazaCopyOrigin? {
    val value = origin as? JsonObject ?: return null
    if (value["kind"]?.jsonPrimitive?.contentOrNull != "plaza_copy") return null
    val workId = value["workId"]?.jsonPrimitive?.contentOrNull ?: return null
    return PlazaCopyOrigin(
        workId,
        value["version"]?.jsonPrimitive?.longOrNull ?: 1L,
        value["authorName"]?.jsonPrimitive?.contentOrNull.orEmpty(),
        value["authorDeleted"]?.jsonPrimitive?.booleanOrNull == true,
        value["workAvailable"]?.jsonPrimitive?.booleanOrNull == true,
        value["newerVersionAvailable"]?.jsonPrimitive?.longOrNull,
    )
}

/**
 * 聊天信息页「发布到人设广场」：只有自定义角色。「基于身边真人」或曾经是 → 禁用并写原因（裁定 C1）。
 */
@Composable internal fun PlazaPublishRow(
    repository: SessionRepository,
    owner: OwnerRecord,
    characterId: String,
    enabled: Boolean,
) {
    val profile =
        remote("${owner.sessionId}:plaza-row-profile:$characterId") {
            repository.call(
                Endpoints.characterEndpointsGetProfile,
                params = mapOf("characterId" to characterId),
                options = SessionCallOptions(owner = owner),
            )
        }
    val role = profile.data ?: return
    if (role.kind != "custom") return
    val origin =
        remote("${owner.sessionId}:plaza-row-origin:$characterId") {
            repository.call(
                Endpoints.customCharacterOriginEndpointsGetOrigin,
                params = mapOf("characterId" to characterId),
                options = SessionCallOptions(owner = owner, networkOnly = true),
            )
        }
    val privatePerson = origin.data?.everPrivatePerson == true || role.classification.realPersonKind == "private_person"
    val works =
        remote("${owner.sessionId}:plaza-row-works:$characterId") {
            repository.call(Endpoints.plazaEndpointsListMyWorks, options = SessionCallOptions(owner = owner, networkOnly = true))
        }
    val published = works.data?.items?.find { it.sourceCharacterId == characterId }
    if (privatePerson) {
        Column(Modifier.alpha(WbOpacity.Disabled)) {
            Text("发布到人设广场")
            PlazaFootnote("以身边的人为原型的角色不能发布，这是为了保护 TA 的隐私")
        }
    } else {
        TextButton(onClick = { PlazaNav.open(PlazaPage.Publish(characterId, null)) }, enabled = enabled) {
            Text(published?.let { "已发布 · 版本 ${it.currentVersion} · 发布新版本 ›" } ?: "发布到人设广场 ›")
        }
    }
}

/** 补充设定页底部「发布为改版」（只有预设角色且有补充设定时）。 */
@Composable internal fun VariantPublishButton(
    characterId: String,
    enabled: Boolean,
) {
    TextButton(onClick = { PlazaNav.open(PlazaPage.Publish(null, characterId)) }, enabled = enabled) { Text("发布为改版") }
}

/** 新版本弹层（6 节）：更新说明、更新到新版本、暂不更新；我改过人设时 409 → 「你对 TA 的修改会被覆盖」。 */
@Composable private fun NewVersionDialog(
    repository: SessionRepository,
    owner: OwnerRecord,
    characterId: String,
    workId: String,
    version: Long,
    onClose: (Boolean) -> Unit,
) {
    val context = LocalContext.current
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    val work =
        remote("${owner.sessionId}:plaza-work-note:$workId") {
            repository.call(
                Endpoints.plazaEndpointsGetWork,
                params = mapOf("workId" to workId),
                options = SessionCallOptions(owner = owner, networkOnly = true),
            )
        }
    var overwrite by remember { mutableStateOf(false) }
    var pending by remember { mutableStateOf(false) }
    val note =
        work.data
            ?.versions
            ?.find { it.version == version }
            ?.changeNote

    fun decide(
        decision: String,
        confirmOverwrite: Boolean = false,
    ) {
        pending = true
        scope.launch {
            try {
                repository.call(
                    Endpoints.plazaEndpointsUpdateAdopted,
                    params = mapOf("characterId" to characterId),
                    body =
                        buildJsonObject {
                            put("decision", decision)
                            put("confirmOverwrite", confirmOverwrite)
                        },
                    options = SessionCallOptions(owner = owner),
                )
                plazaToast(context, if (decision == "update") "已更新到新版本" else "好的，暂不更新")
                onClose(true)
            } catch (failure: CancellationException) {
                throw failure
            } catch (failure: Exception) {
                if (plazaCode(failure) == "conflict") overwrite = true else plazaToast(context, "操作暂未完成，请稍后再试")
            } finally {
                pending = false
            }
        }
    }
    AlertDialog(
        onDismissRequest = { onClose(false) },
        title = { Text("作者发布了新版本（版本 $version）") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(WbSpace.S2)) {
                note?.let { Text("更新说明：$it", color = colors.textSecondary) }
                Text("你们的聊天记录、记忆、熟悉度都不会变", color = colors.textTertiary, style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = { Button(onClick = { decide("update") }, enabled = !pending) { Text("更新到版本 $version") } },
        dismissButton = { TextButton(onClick = { decide("dismiss") }, enabled = !pending) { Text("暂不更新") } },
    )
    if (overwrite) {
        PlazaConfirm("你对 TA 的修改会被覆盖", null, "仍然更新", { overwrite = false }) {
            overwrite = false
            decide("update", true)
        }
    }
}

@Composable private fun SourceNote(
    text: String,
    available: Boolean,
    workId: String,
) {
    val colors = LocalWeibanColors.current
    Text(
        if (available) "$text ›" else text,
        Modifier.clickable(enabled = available) { PlazaNav.open(PlazaPage.Work(workId)) },
        color = colors.textSecondary,
        style = MaterialTheme.typography.bodySmall,
    )
}

@Composable private fun NewVersionBadge(onClick: () -> Unit) {
    Row(
        Modifier.clickable(onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(WbSpace.S2),
    ) {
        Text("作者发布了新版本", style = MaterialTheme.typography.bodySmall)
        RedDot()
    }
}

/** 3.1（W9）：作品页里，我添加过的复制品有新版本时直接「更新到版本 N」。 */
@Composable internal fun AdoptedUpdateButton(
    repository: SessionRepository,
    owner: OwnerRecord,
    characterId: String,
    workId: String,
) {
    val origin =
        remote("${owner.sessionId}:plaza-adopted-origin:$characterId") {
            repository.call(
                Endpoints.customCharacterOriginEndpointsGetOrigin,
                params = mapOf("characterId" to characterId),
                options = SessionCallOptions(owner = owner, networkOnly = true),
            )
        }
    var open by remember { mutableStateOf(false) }
    val copy = origin.data?.let { parseOrigin(it.origin) }
    val newer = copy?.newerVersion
    if (copy == null || copy.workId != workId || newer == null) return
    TextButton(onClick = { open = true }) { Text("更新到版本 $newer") }
    if (open) {
        NewVersionDialog(repository, owner, characterId, workId, newer) { done ->
            open = false
            if (done) origin.refresh()
        }
    }
}

/** 复制来的自定义角色：资料页「来自人设广场 · 作者 XX · 版本 N」与「作者发布了新版本 ●」。 */
@Composable internal fun PlazaOriginNote(
    repository: SessionRepository,
    owner: OwnerRecord,
    characterId: String,
) {
    val origin =
        remote("${owner.sessionId}:plaza-origin:$characterId") {
            repository.call(
                Endpoints.customCharacterOriginEndpointsGetOrigin,
                params = mapOf("characterId" to characterId),
                options = SessionCallOptions(owner = owner, networkOnly = true),
            )
        }
    var open by remember { mutableStateOf(false) }
    val copy = origin.data?.let { parseOrigin(it.origin) } ?: return
    val author = if (copy.authorDeleted) "已注销用户" else copy.authorName
    SourceNote("来自人设广场 · 作者 $author · 版本 ${copy.version}", copy.workAvailable, copy.workId)
    val newer = copy.newerVersion ?: return
    NewVersionBadge { open = true }
    if (open) {
        NewVersionDialog(repository, owner, characterId, copy.workId, newer) { done ->
            open = false
            if (done) origin.refresh()
        }
    }
}

/** 应用了改版的预设角色：补充设定页顶部来源标注 + 新版本提示（版本号与作品当前版本比较）。 */
@Composable internal fun SupplementSourceNote(
    repository: SessionRepository,
    owner: OwnerRecord,
    characterId: String,
    source: UserSupplementPlazaSource,
    onChanged: () -> Unit,
) {
    val work =
        remote("${owner.sessionId}:plaza-source-work:${source.workId}") {
            repository.call(
                Endpoints.plazaEndpointsGetWork,
                params = mapOf("workId" to source.workId),
                options = SessionCallOptions(owner = owner, networkOnly = true),
            )
        }
    var open by remember { mutableStateOf(false) }
    val current = work.data?.currentVersion
    SourceNote("来自人设广场 · 作者 ${source.authorName} · 版本 ${source.version}", work.error == null, source.workId)
    if (current == null || current <= source.version) return
    NewVersionBadge { open = true }
    if (open) {
        NewVersionDialog(repository, owner, characterId, source.workId, current) { done ->
            open = false
            if (done) onChanged()
        }
    }
}
