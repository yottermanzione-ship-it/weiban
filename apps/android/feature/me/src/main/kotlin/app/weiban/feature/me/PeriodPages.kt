package app.weiban.feature.me

import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import app.weiban.contracts.*
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.tokens.WbSpace
import kotlinx.coroutines.CancellationException
import java.io.IOException
import java.time.LocalDate
import java.time.temporal.ChronoUnit

private const val NOTES_LIMIT = 200
private val flows = listOf("light" to "少", "medium" to "中", "heavy" to "多")
private val pains = listOf("none" to "无", "mild" to "轻", "moderate" to "中", "severe" to "重")

private fun shortDate(value: String): String = LocalDate.parse(value).let { "${it.monthValue} 月 ${it.dayOfMonth} 日" }

/** 通讯录里已添加的角色 id → 显示名（备注优先）。 */
@Composable internal fun periodCharacterNames(state: PeriodState): Map<String, String> {
    var names by remember(state) { mutableStateOf<Map<String, String>>(emptyMap()) }
    LaunchedEffect(state) {
        try {
            val contacts = state.call(Endpoints.contactsEndpointsList).items.filter { it.conversationId != null }
            val loaded = mutableMapOf<String, String>()
            for (contact in contacts) {
                val name =
                    contact.remark ?: try {
                        state.call(Endpoints.characterEndpointsGetProfile, params = mapOf("characterId" to contact.characterId)).name
                    } catch (error: CancellationException) {
                        throw error
                    } catch (_: IOException) {
                        "角色"
                    }
                loaded[contact.characterId] = name
            }
            names = loaded
        } catch (error: CancellationException) {
            throw error
        } catch (_: IOException) {
            names = emptyMap()
        }
    }
    return names
}

@Composable private fun SubHeader(
    title: String,
    onBack: () -> Unit,
    action: (@Composable () -> Unit)? = null,
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        TextButton(onClick = onBack) { Text("‹ 经期日记") }
        Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
        action?.invoke()
    }
}

/** 某一天的记录页（PLAY-01 第 2 条；设计 3.2）。 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun PeriodDayPage(
    state: PeriodState,
    date: LocalDate,
    onBack: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    val containing = state.cycleContaining(date)
    val existing = containing?.dayLogs?.find { it.date == date.toString() }
    var inPeriod by remember(date) { mutableStateOf(containing != null) }
    var flow by remember(date) { mutableStateOf(existing?.flow) }
    var pain by remember(date) { mutableStateOf(existing?.pain) }
    var symptoms by remember(date) { mutableStateOf(existing?.symptoms?.toSet().orEmpty()) }
    var notes by remember(date) { mutableStateOf(existing?.notes.orEmpty()) }
    var dirty by remember(date) { mutableStateOf(false) }
    var leaving by remember { mutableStateOf(false) }
    var deletingCycle by remember { mutableStateOf<CycleRecord?>(null) }
    val back: () -> Unit = { if (dirty) leaving = true else onBack() }
    BackHandler(onBack = back)
    SubHeader(shortDate(date.toString()), back) {
        TextButton(enabled = !state.busy, onClick = {
            val log = dayLogJson(date, flow, pain, symptoms, notes)
            val hasContent = flow != null || pain != null || symptoms.isNotEmpty() || notes.isNotBlank()
            when {
                inPeriod && containing != null ->
                    state.perform(success = "已保存", after = onBack) { state.updateCycle(containing.cycleId, dayLog = log) }
                inPeriod -> state.perform(success = "已保存", after = onBack) { savePeriodDay(state, date, log, hasContent) }
                containing != null && containing.startDate == date.toString() -> deletingCycle = containing
                containing != null ->
                    state.perform(success = "已保存", after = onBack) {
                        state.updateCycle(containing.cycleId, endDate = date.minusDays(1))
                    }
                else -> onBack()
            }
        }) { Text("保存") }
    }
    PeriodSwitchRow("这天在经期中", inPeriod, !state.busy) {
        inPeriod = it
        dirty = true
    }
    if (inPeriod) {
        Text("流量", style = MaterialTheme.typography.titleSmall)
        ChoiceRow(flows, flow) {
            flow = it
            dirty = true
        }
        Text("痛感", style = MaterialTheme.typography.titleSmall)
        ChoiceRow(pains, pain) {
            pain = it
            dirty = true
        }
        Text("症状", style = MaterialTheme.typography.titleSmall)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
            (state.symptomTags + symptoms.filter { it !in state.symptomTags }).forEach { tag ->
                FilterChip(selected = tag in symptoms, onClick = {
                    symptoms = if (tag in symptoms) symptoms - tag else symptoms + tag
                    dirty = true
                }, label = { Text(tag) })
            }
        }
        OutlinedTextField(
            notes,
            {
                if (it.length <= NOTES_LIMIT) {
                    notes = it
                    dirty = true
                }
            },
            Modifier.fillMaxWidth(),
            label = { Text("备注（${notes.length}/$NOTES_LIMIT）") },
            minLines = 3,
        )
        Text("只有你自己能看到，不会告诉任何角色", color = colors.textSecondary, style = MaterialTheme.typography.bodySmall)
    }
    if (existing != null) {
        TextButton(enabled = !state.busy, onClick = {
            state.perform(success = "已删除这天的记录", after = onBack) {
                state.updateCycle(containing.cycleId, dayLog = dayLogJson(date, null, null, emptyList(), null))
            }
        }) { Text("删除这天的记录", color = colors.textDanger) }
    }
    if (leaving) {
        AlertDialog(
            onDismissRequest = { leaving = false },
            title = { Text("放弃这次修改？") },
            confirmButton = { TextButton(onClick = onBack) { Text("放弃", color = colors.textDanger) } },
            dismissButton = { TextButton(onClick = { leaving = false }) { Text("取消") } },
        )
    }
    deletingCycle?.let { cycle -> DeleteCycleDialog(state, cycle, { deletingCycle = null }, onBack) }
}

/** 不在已有经期里的一天标为经期：紧接上一次经期则延长，否则新建（过去的日期把结束日设为当天）。 */
private suspend fun savePeriodDay(
    state: PeriodState,
    date: LocalDate,
    log: kotlinx.serialization.json.JsonObject,
    hasContent: Boolean,
) {
    val previous = state.cycles.firstOrNull { it.endDate == date.minusDays(1).toString() }
    if (previous != null) {
        state.updateCycle(previous.cycleId, endDate = date, dayLog = log.takeIf { hasContent })
        return
    }
    val created = state.createCycle(date)
    val past = date.isBefore(LocalDate.now())
    if (past || hasContent) state.updateCycle(created.cycleId, endDate = date.takeIf { past }, dayLog = log.takeIf { hasContent })
}

@Composable private fun ChoiceRow(
    options: List<Pair<String, String>>,
    selected: String?,
    onSelect: (String?) -> Unit,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
        options.forEach { (id, label) ->
            FilterChip(selected = selected == id, onClick = { onSelect(if (selected == id) null else id) }, label = { Text(label) })
        }
    }
}

@Composable internal fun PeriodSwitchRow(
    label: String,
    checked: Boolean,
    enabled: Boolean,
    onChange: (Boolean) -> Unit,
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = onChange, enabled = enabled)
    }
}

@Composable private fun DeleteCycleDialog(
    state: PeriodState,
    cycle: CycleRecord,
    onDismiss: () -> Unit,
    onDone: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    AlertDialog(
        onDismissRequest = { if (!state.busy) onDismiss() },
        title = { Text("删除这次经期的全部记录？") },
        text = { Text("${shortDate(cycle.startDate)} 开始的这次经期和其中每天的记录都会删除。") },
        confirmButton = {
            TextButton(enabled = !state.busy, onClick = {
                state.perform(success = "已删除", after = {
                    onDismiss()
                    onDone()
                }) { state.deleteCycle(cycle.cycleId) }
            }) { Text("删除", color = colors.textDanger) }
        },
        dismissButton = { TextButton(enabled = !state.busy, onClick = onDismiss) { Text("取消") } },
    )
}

/** 历史记录（设计 3.3）：按周期倒序，可删除整次经期。 */
@Composable internal fun PeriodHistoryPage(
    state: PeriodState,
    onBack: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    var deleting by remember { mutableStateOf<CycleRecord?>(null) }
    SubHeader("历史记录", onBack)
    if (state.cycles.isEmpty()) Text("还没有记录", color = colors.textSecondary)
    state.cycles.forEachIndexed { index, cycle ->
        val start = LocalDate.parse(cycle.startDate)
        val end = cycle.endDate?.let(LocalDate::parse)
        val length = end?.let { ChronoUnit.DAYS.between(start, it) + 1 }
        val newer =
            state.cycles
                .getOrNull(index - 1)
                ?.startDate
                ?.let(LocalDate::parse)
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                val range = "${shortDate(cycle.startDate)} – ${cycle.endDate?.let(::shortDate) ?: "至今"}"
                Text(range + (length?.let { " · $it 天" } ?: ""), Modifier.padding(top = WbSpace.S3))
                newer?.let {
                    Text(
                        "周期 ${ChronoUnit.DAYS.between(start, it)} 天",
                        color = colors.textSecondary,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
            TextButton(onClick = {
                state.month = java.time.YearMonth.from(start)
                onBack()
            }) { Text("查看") }
            TextButton(enabled = !state.busy, onClick = { deleting = cycle }) { Text("删除", color = colors.textDanger) }
        }
        HorizontalDivider(color = colors.borderHairline)
    }
    deleting?.let { cycle -> DeleteCycleDialog(state, cycle, { deleting = null }) {} }
}

/** 让谁知道（PLAY-01 第 4 条；设计第 4 节）：默认全关，打开先确认，关闭立即生效。 */
@Composable internal fun PeriodAuthorizationPage(
    state: PeriodState,
    onBack: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    val context = LocalContext.current
    val names = periodCharacterNames(state)
    var confirming by remember { mutableStateOf<String?>(null) }
    SubHeader("让谁知道", onBack)
    Text(
        "你授权的角色会知道你现在是否在经期、第几天、预计下次开始日，以及当天记录的痛感和症状；不知道流量、备注和历史记录。",
        color = colors.textSecondary,
        style = MaterialTheme.typography.bodySmall,
    )
    if (names.isEmpty()) Text("还没有角色", color = colors.textSecondary)
    names.entries.sortedBy { it.value }.forEach { (id, name) ->
        PeriodSwitchRow(name, id in state.authorized, !state.busy) { on ->
            if (on) {
                confirming = id
            } else {
                state.perform(after = { Toast.makeText(context, "$name 已不再知道", Toast.LENGTH_SHORT).show() }) {
                    state.saveAuthorization(state.authorized - id)
                }
            }
        }
    }
    Text("群聊里不会提起；未授权的角色和人设广场都拿不到这些记录。", color = colors.textSecondary, style = MaterialTheme.typography.bodySmall)
    confirming?.let { id ->
        val name = names[id].orEmpty()
        AlertDialog(
            onDismissRequest = { if (!state.busy) confirming = null },
            title = { Text("让 $name 知道？") },
            text = { Text("TA 会知道你的经期状态，并可能在合适的时候关心你") },
            confirmButton = {
                TextButton(enabled = !state.busy, onClick = {
                    state.perform(after = { confirming = null }) { state.saveAuthorization(state.authorized + id) }
                }) { Text("让 TA 知道") }
            },
            dismissButton = { TextButton(enabled = !state.busy, onClick = { confirming = null }) { Text("取消") } },
        )
    }
}

/** 周期设置（P-37；设计 3.4）。 */
@Composable internal fun PeriodSettingsPage(
    state: PeriodState,
    onBack: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    var cycle by remember(state.settings) {
        mutableStateOf(
            state.settings
                ?.cycleLengthDays
                ?.toString()
                .orEmpty(),
        )
    }
    var period by remember(state.settings) {
        mutableStateOf(
            state.settings
                ?.periodLengthDays
                ?.toString()
                .orEmpty(),
        )
    }
    SubHeader("周期设置", onBack)
    OutlinedTextField(cycle, { cycle = it.filter(Char::isDigit).take(2) }, label = { Text("平时的周期长度（15–60 天）") })
    OutlinedTextField(period, { period = it.filter(Char::isDigit).take(2) }, label = { Text("平时经期天数（1–15 天）") })
    Text("记录不足 2 个周期时，用这里的数字预测", color = colors.textSecondary, style = MaterialTheme.typography.bodySmall)
    val cycleValue = cycle.toIntOrNull()
    val periodValue = period.toIntOrNull()
    val valid = cycleValue != null && cycleValue in 15..60 && periodValue != null && periodValue in 1..15
    Button(enabled = valid && !state.busy, onClick = {
        if (cycleValue != null && periodValue != null) {
            state.perform(success = "已保存", after = onBack) { state.saveSettings(cycleValue, periodValue) }
        }
    }) { Text("保存") }
}
