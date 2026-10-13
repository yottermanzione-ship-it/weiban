package app.weiban.feature.chat

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import app.weiban.contracts.*
import app.weiban.data.OwnerRecord
import app.weiban.data.SessionCallOptions
import app.weiban.data.SessionRepository
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.MenuGroup
import app.weiban.designsystem.MenuRow
import app.weiban.designsystem.WbSheet
import app.weiban.designsystem.tokens.WbRadius
import app.weiban.designsystem.tokens.WbSpace
import app.weiban.network.ApiFailure
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/*
 * 情景预设（docs/refactor/02 第 5 节）：聊天「+」面板与私聊副标题打开同一个弹层。
 * 顺序、资格、说明都以服务器 listModes 为准（section = private 放底部「私密」一栏；没资格的不返回）。
 */

/** 显示名（服务器没给名字时兜底；系统提示「已切换到…」也用它）。 */
internal val presetNames =
    mapOf(
        "auto" to "自动",
        "daily" to "日常聊天",
        "romance" to "情侣暧昧",
        "treehole" to "树洞分享",
        "tsundere" to "傲娇斗嘴",
        "cheer" to "加油打气",
        "adult" to "私密",
    )

private val presetGlyphs =
    mapOf("auto" to "✦", "daily" to "☀", "romance" to "♥", "treehole" to "☾", "tsundere" to "ϟ", "cheer" to "⇧", "adult" to "🔒")

/** 私聊副标题：日常聊天不显示；成人内容显示「私密」。 */
internal fun presetSubtitle(mode: String?): String? = if (mode == null || mode == "daily") null else presetNames[mode]

private const val PRIVATE_INTRO_FLAG = "scenario:private-intro-seen"

/** 情景预设的目标：私聊（角色）或群聊。 */
internal sealed interface ScenarioTarget {
    data class Character(
        val characterId: String,
    ) : ScenarioTarget

    data class Group(
        val conversationId: String,
    ) : ScenarioTarget
}

/** 当前预设（私聊读陪伴设置，群聊读群设置）；收到 data.changed(companion) 时由调用方 refresh。 */
internal class CurrentPreset(
    val mode: String?,
    val refresh: () -> Unit,
)

@Composable internal fun rememberCurrentPreset(
    repository: SessionRepository,
    owner: OwnerRecord,
    target: ScenarioTarget,
): CurrentPreset {
    val remote =
        remote("${owner.sessionId}:preset:$target") {
            when (target) {
                is ScenarioTarget.Character ->
                    repository
                        .call(
                            Endpoints.companionEndpointsGetForCharacter,
                            params = mapOf("characterId" to target.characterId),
                            options = SessionCallOptions(owner = owner, networkOnly = true),
                        ).scenarioMode
                is ScenarioTarget.Group ->
                    repository
                        .call(
                            Endpoints.groupCompanionEndpointsGetSettings,
                            params = mapOf("conversationId" to target.conversationId),
                            options = SessionCallOptions(owner = owner, networkOnly = true),
                        ).scenarioMode
            }
        }
    return CurrentPreset(remote.data, remote::refresh)
}

@Composable internal fun ScenarioSheet(
    repository: SessionRepository,
    owner: OwnerRecord,
    target: ScenarioTarget,
    current: String?,
    onDismiss: () -> Unit,
    onChanged: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val modes =
        remote("${owner.sessionId}:modes:$target") {
            when (target) {
                is ScenarioTarget.Character ->
                    repository
                        .call(
                            Endpoints.companionEndpointsListModes,
                            params = mapOf("characterId" to target.characterId),
                            options = SessionCallOptions(owner = owner, networkOnly = true),
                        ).items
                is ScenarioTarget.Group ->
                    repository
                        .call(
                            Endpoints.groupCompanionEndpointsListModes,
                            params = mapOf("conversationId" to target.conversationId),
                            options = SessionCallOptions(owner = owner, networkOnly = true),
                        ).items
            }
        }
    var pending by remember { mutableStateOf(false) }
    // model：没选成人模式模型；intro：第一次开启私密的说明。
    var prompt by remember { mutableStateOf<String?>(null) }
    val toast: (String) -> Unit = { Toast.makeText(context, it, Toast.LENGTH_SHORT).show() }
    val apply: (String) -> Unit = { id ->
        pending = true
        scope.launch {
            try {
                when (target) {
                    is ScenarioTarget.Character ->
                        repository.call(
                            Endpoints.companionEndpointsUpdateForCharacter,
                            params = mapOf("characterId" to target.characterId),
                            body = buildJsonObject { put("scenarioMode", id) },
                            options = SessionCallOptions(owner = owner),
                        )
                    is ScenarioTarget.Group ->
                        repository.call(
                            Endpoints.groupCompanionEndpointsUpdateSettings,
                            params = mapOf("conversationId" to target.conversationId),
                            body = buildJsonObject { put("scenarioMode", id) },
                            options = SessionCallOptions(owner = owner),
                        )
                }
                onChanged()
                onDismiss()
            } catch (failure: kotlinx.coroutines.CancellationException) {
                throw failure
            } catch (failure: ApiFailure) {
                when (failure.code) {
                    "adult_model_missing" -> prompt = "model"
                    "adult_mode_not_eligible" -> toast("群里有成员不能使用这个预设")
                    "romance_not_allowed" -> toast("有成员不能使用情侣暧昧")
                    else -> toast("切换没有成功，请稍后再试")
                }
            } catch (_: java.io.IOException) {
                toast("网络不可用，请重试")
            } finally {
                pending = false
            }
        }
    }
    val choose: (ScenarioModeOption) -> Unit = { option ->
        if (option.id == (current ?: "daily")) {
            onDismiss()
        } else if (option.id != "adult") {
            apply(option.id)
        } else {
            scope.launch {
                val selection =
                    runCatching {
                        repository.call(
                            Endpoints.modelAccessEndpointsGetSelection,
                            options = SessionCallOptions(owner = owner, networkOnly = true),
                        )
                    }.getOrNull()
                val seen = runCatching { repository.flags.get(owner, PRIVATE_INTRO_FLAG) == "1" }.getOrDefault(false)
                when {
                    selection != null && selection.adult == null -> prompt = "model"
                    !seen -> prompt = "intro"
                    else -> apply("adult")
                }
            }
        }
    }
    val items = modes.data.orEmpty()
    val presets = items.filter { (it.section ?: if (it.id == "adult") "private" else "preset") == "preset" }
    val privates = items.filter { (it.section ?: if (it.id == "adult") "private" else "preset") == "private" }
    WbSheet("情景预设", onDismiss) {
        if (modes.loading && modes.data == null) LinearProgressIndicator(Modifier.fillMaxWidth().padding(WbSpace.S5))
        if (modes.error != null && modes.data == null) {
            Row(Modifier.padding(WbSpace.S5), verticalAlignment = Alignment.CenterVertically) {
                Text("加载失败", Modifier.weight(1f))
                TextButton(onClick = modes::refresh) { Text("重试") }
            }
        }
        Column(Modifier.padding(horizontal = WbSpace.S5), verticalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
            presets.filter { it.id == "auto" }.forEach {
                PresetCard(
                    it,
                    it.id == (current ?: "daily"),
                    !pending,
                    Modifier.fillMaxWidth(),
                    choose,
                )
            }
            presets.filter { it.id != "auto" }.chunked(2).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
                    row.forEach { PresetCard(it, it.id == (current ?: "daily"), !pending, Modifier.weight(1f), choose) }
                    if (row.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }
        if (privates.isNotEmpty()) {
            MenuGroup("私密") {
                privates.forEach { option ->
                    MenuRow("成人内容", "🔒", value = if (option.id == current) "已开启" else "未开启", enabled = !pending) { choose(option) }
                }
            }
        }
    }
    when (prompt) {
        "model" ->
            AlertDialog(
                onDismissRequest = { prompt = null },
                title = { Text("还没有选择成人模式模型") },
                text = { Text("开启前，请先在「我 › 服务 › 模型选择」中选择成人模式模型") },
                confirmButton = { TextButton(onClick = { prompt = null }) { Text("知道了") } },
            )
        "intro" ->
            AlertDialog(
                onDismissRequest = { prompt = null },
                title = { Text("只在你们俩之间") },
                text = { Text("这里的内容只留在你和 TA 之间：不会出现在朋友圈、其他角色那里、分享图和推送里。") },
                confirmButton = {
                    TextButton(onClick = {
                        prompt = null
                        scope.launch {
                            runCatching { repository.flags.set(owner, PRIVATE_INTRO_FLAG, "1") }
                            apply("adult")
                        }
                    }) { Text("开启") }
                },
                dismissButton = { TextButton(onClick = { prompt = null }) { Text("取消") } },
            )
    }
}

@Composable private fun PresetCard(
    option: ScenarioModeOption,
    selected: Boolean,
    enabled: Boolean,
    modifier: Modifier,
    onChoose: (ScenarioModeOption) -> Unit,
) {
    val colors = LocalWeibanColors.current
    val shape = RoundedCornerShape(WbRadius.Md)
    Column(
        modifier
            .clip(shape)
            .background(colors.bgSurface)
            .border(if (selected) 2.dp else 1.dp, if (selected) colors.brandPrimary else colors.borderHairline, shape)
            .clickable(enabled = enabled) { onChoose(option) }
            .padding(WbSpace.S4),
        verticalArrangement = Arrangement.spacedBy(WbSpace.S1),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(WbSpace.S2)) {
            Text(presetGlyphs[option.id] ?: "☀")
            Text(option.name.ifBlank { presetNames[option.id].orEmpty() }, style = MaterialTheme.typography.titleSmall)
            if (option.recommended == true) {
                Text(
                    "推荐",
                    Modifier.clip(RoundedCornerShape(WbRadius.Xs)).background(colors.brandSoft).padding(horizontal = WbSpace.S2),
                    color = colors.brandOnSoft,
                    style = MaterialTheme.typography.labelSmall,
                )
            }
            Spacer(Modifier.weight(1f))
            if (selected) Text("✓", color = colors.brandPrimary, style = MaterialTheme.typography.titleMedium)
        }
        option.description?.let { Text(it, color = colors.textSecondary, style = MaterialTheme.typography.bodySmall) }
    }
}
