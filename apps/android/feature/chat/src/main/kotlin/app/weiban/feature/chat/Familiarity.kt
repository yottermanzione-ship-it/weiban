package app.weiban.feature.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import app.weiban.contracts.*
import app.weiban.data.OwnerRecord
import app.weiban.data.SessionCallOptions
import app.weiban.data.SessionRepository
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.LocalWeibanModeColors
import app.weiban.designsystem.tokens.WbRadius
import app.weiban.designsystem.tokens.WbSpace
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.LocalDate
import java.time.format.DateTimeParseException
import java.time.temporal.ChronoUnit

private const val CUSTOM_ANNIVERSARY_LIMIT = 10
private const val ANNIVERSARY_LABEL_LIMIT = 20

internal fun familiarityName(level: Long): String =
    when (level.toInt()) {
        1 -> "初识"
        2 -> "眼熟"
        3 -> "熟络"
        4 -> "老友"
        else -> "知己"
    }

@Composable private fun familiarityColor(level: Long): Color {
    val mode = LocalWeibanModeColors.current
    return when (level.toInt()) {
        1 -> mode.familiarityL1
        2 -> mode.familiarityL2
        3 -> mode.familiarityL3
        4 -> mode.familiarityL4
        else -> mode.familiarityL5
    }
}

internal fun daysKnownLabel(info: DaysKnownInfo): String = if (info.isRomantic) "在一起第 ${info.daysKnown} 天" else "认识第 ${info.daysKnown} 天"

/**
 * 资料页头部副信息「认识第 N 天 · L3 熟络 ›」与展开后的熟悉度 / 纪念日详情（GRW-03、GRW-04；design l3-companion.md 第 4、5 节）。
 * 天数和点数都只显示服务器给的数。
 */
@Composable internal fun FamiliaritySummary(
    repository: SessionRepository,
    owner: OwnerRecord,
    characterId: String,
) {
    val colors = LocalWeibanColors.current
    val options = SessionCallOptions(owner = owner)
    val familiarity =
        remote("${owner.sessionId}:familiarity:$characterId") {
            repository.call(Endpoints.growthEndpointsGetFamiliarity, params = mapOf("characterId" to characterId), options = options)
        }
    val days =
        remote("${owner.sessionId}:days:$characterId") {
            repository.call(Endpoints.growthEndpointsGetDaysKnown, params = mapOf("characterId" to characterId), options = options)
        }
    var open by remember(characterId) { mutableStateOf(false) }
    val level = familiarity.data
    val known = days.data
    when {
        level == null && known == null && (familiarity.loading || days.loading) ->
            Box(Modifier.size(160.dp, 16.dp).background(colors.bgSkeleton))
        level == null || known == null ->
            Text("认识第 — 天", color = colors.textSecondary)
        else ->
            Text(
                "${daysKnownLabel(known)} · L${level.level} ${familiarityName(level.level)} ${if (open) "⌃" else "›"}",
                Modifier.clickable { open = !open },
                color = colors.textSecondary,
            )
    }
    if (open && level != null && known != null) {
        FamiliarityDetail(level, known)
        Anniversaries(repository, owner, characterId, known) { days.refresh() }
    }
}

@Composable private fun FamiliarityDetail(
    level: FamiliarityInfo,
    known: DaysKnownInfo,
) {
    val colors = LocalWeibanColors.current
    val mode = LocalWeibanModeColors.current
    Column(
        Modifier
            .fillMaxWidth()
            .background(
                colors.bgSurface,
                androidx.compose.foundation.shape
                    .RoundedCornerShape(WbRadius.Md),
            ).padding(WbSpace.S5),
        verticalArrangement = Arrangement.spacedBy(WbSpace.S3),
    ) {
        Text(daysKnownLabel(known), style = MaterialTheme.typography.headlineSmall)
        Text("从 ${known.knownSince} 开始", color = colors.textSecondary, style = MaterialTheme.typography.bodySmall)
        Text("和 TA 的相处：L${level.level} ${familiarityName(level.level)}", style = MaterialTheme.typography.titleSmall)
        val span = level.pointsToNextLevel
        if (span != null && span > 0) {
            LinearProgressIndicator(
                progress = { (level.pointsInLevel.toFloat() / span).coerceIn(0f, 1f) },
                modifier = Modifier.fillMaxWidth(),
                color = familiarityColor(level.level),
                trackColor = mode.familiarityTrack,
            )
            Text("距下一级还差 ${(span - level.pointsInLevel).coerceAtLeast(0)} 点", color = colors.textSecondary)
        } else {
            LinearProgressIndicator(
                progress = { 1f },
                modifier = Modifier.fillMaxWidth(),
                color = familiarityColor(level.level),
                trackColor = mode.familiarityTrack,
            )
            Text("已经是最高等级", color = colors.textSecondary)
        }
        Text(
            "L1 初识 · L2 眼熟 · L3 熟络 · L4 老友 · L5 知己",
            color = colors.textTertiary,
            style = MaterialTheme.typography.bodySmall,
        )
        known.nextAnniversary?.let { next ->
            val until =
                next.nextOccurrence?.let {
                    runCatching {
                        ChronoUnit.DAYS.between(
                            LocalDate.now(),
                            LocalDate.parse(it),
                        )
                    }.getOrNull()
                }
            Text("下一个：${next.label}" + (until?.let { " · 还有 $it 天" } ?: ""), color = colors.textSecondary)
        }
    }
}

@Composable private fun Anniversaries(
    repository: SessionRepository,
    owner: OwnerRecord,
    characterId: String,
    known: DaysKnownInfo,
    onChanged: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    var label by remember { mutableStateOf("") }
    var date by remember { mutableStateOf("") }
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var removing by remember { mutableStateOf<Anniversary?>(null) }
    val custom = known.anniversaries.filter { it.kind == "custom" }
    Text("纪念日", style = MaterialTheme.typography.titleSmall)
    known.anniversaries.filter { it.kind == "system" }.forEach { item ->
        AnniversaryRow(item, null)
    }
    if (custom.isEmpty()) {
        Text("可以把你们的重要日子记下来", color = colors.textSecondary)
    }
    custom.forEach { item -> AnniversaryRow(item) { removing = item } }
    val full = custom.size >= CUSTOM_ANNIVERSARY_LIMIT
    OutlinedTextField(
        label,
        { if (it.length <= ANNIVERSARY_LABEL_LIMIT) label = it },
        Modifier.fillMaxWidth(),
        label = { Text("纪念日名称") },
        enabled = !pending && !full,
        singleLine = true,
    )
    OutlinedTextField(
        date,
        { date = it.take(10) },
        Modifier.fillMaxWidth(),
        label = { Text("日期（如 2026-07-12）") },
        enabled = !pending && !full,
        singleLine = true,
    )
    Button(
        enabled = !pending && !full && label.isNotBlank() && date.isNotBlank(),
        onClick = {
            val parsed =
                try {
                    LocalDate.parse(date.trim())
                } catch (_: DateTimeParseException) {
                    null
                }
            if (parsed == null) {
                error = "日期格式不对，请写成 2026-07-12"
            } else {
                pending = true
                error = null
                scope.launch {
                    userAction({ error = it }) {
                        repository.call(
                            Endpoints.growthEndpointsAddAnniversary,
                            params = mapOf("characterId" to characterId),
                            body =
                                buildJsonObject {
                                    put("label", label.trim())
                                    put("date", parsed.toString())
                                },
                            options = SessionCallOptions(owner = owner),
                        )
                        label = ""
                        date = ""
                        onChanged()
                    }
                    pending = false
                }
            }
        },
    ) { Text(if (full) "最多 10 个纪念日" else "添加纪念日") }
    Text("纪念日当天，TA 会记得给你发消息。", color = colors.textSecondary, style = MaterialTheme.typography.bodySmall)
    error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    removing?.let { target ->
        AlertDialog(
            onDismissRequest = { if (!pending) removing = null },
            title = { Text("删除纪念日") },
            text = { Text("删除后 TA 不会再在这天特别找你") },
            confirmButton = {
                TextButton(enabled = !pending, onClick = {
                    pending = true
                    scope.launch {
                        userAction({ error = it }) {
                            repository.call(
                                Endpoints.growthEndpointsRemoveAnniversary,
                                params = mapOf("characterId" to characterId, "anniversaryId" to target.id),
                                options = SessionCallOptions(owner = owner),
                            )
                            onChanged()
                        }
                        removing = null
                        pending = false
                    }
                }) { Text("删除", color = colors.textDanger) }
            },
            dismissButton = { TextButton(enabled = !pending, onClick = { removing = null }) { Text("取消") } },
        )
    }
}

@Composable private fun AnniversaryRow(
    item: Anniversary,
    onRemove: (() -> Unit)?,
) {
    val colors = LocalWeibanColors.current
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(item.label, Modifier.weight(1f))
        Text(item.date, color = colors.textSecondary)
        if (onRemove != null) TextButton(onClick = onRemove) { Text("删除", color = colors.textDanger) }
    }
}
