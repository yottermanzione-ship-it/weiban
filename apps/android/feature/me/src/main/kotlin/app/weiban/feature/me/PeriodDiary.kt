package app.weiban.feature.me

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import app.weiban.data.OwnerRecord
import app.weiban.data.SessionRepository
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.LocalWeibanModeColors
import app.weiban.designsystem.tokens.WbRadius
import app.weiban.designsystem.tokens.WbSize
import app.weiban.designsystem.tokens.WbSpace
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/** 经期日记入口页（PLAY-01；设计 period-diary.md）。子页面：day:yyyy-mm-dd / history / auth / settings。 */
@Composable internal fun PeriodDiaryPage(
    repository: SessionRepository,
    owner: OwnerRecord,
) {
    val scope = rememberCoroutineScope()
    val state = remember(repository, owner) { PeriodState(repository, owner, scope) }
    var sub by remember(state) { mutableStateOf("home") }
    LaunchedEffect(state) {
        state.readAcknowledged()
        state.load()
    }
    val colors = LocalWeibanColors.current
    when (state.acknowledged) {
        null -> {
            LinearProgressIndicator(Modifier.fillMaxWidth())
            return
        }
        false -> {
            PeriodNotice(state)
            return
        }
        true -> Unit
    }
    if (sub != "home") BackHandler { sub = "home" }
    state.message?.let { Text(it, color = colors.textSecondary) }
    when {
        sub.startsWith("day:") -> PeriodDayPage(state, LocalDate.parse(sub.removePrefix("day:"))) { sub = "home" }
        sub == "history" -> PeriodHistoryPage(state) { sub = "home" }
        sub == "auth" -> PeriodAuthorizationPage(state) { sub = "home" }
        sub == "settings" -> PeriodSettingsPage(state) { sub = "home" }
        state.loading && state.cycles.isEmpty() -> LinearProgressIndicator(Modifier.fillMaxWidth())
        state.failed ->
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                Text("加载失败")
                Button(onClick = { state.perform { } }) { Text("重试") }
            }
        else -> PeriodHome(state) { sub = it }
    }
}

@Composable private fun PeriodNotice(state: PeriodState) {
    val colors = LocalWeibanColors.current
    Column(
        Modifier.fillMaxWidth().padding(vertical = WbSpace.S8),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(WbSpace.S7),
    ) {
        Text(PeriodState.NOTICE, textAlign = TextAlign.Center, color = colors.textPrimary)
        Button(onClick = state::acknowledge, modifier = Modifier.fillMaxWidth()) { Text("开始记录") }
    }
}

@Composable private fun PeriodHome(
    state: PeriodState,
    open: (String) -> Unit,
) {
    val colors = LocalWeibanColors.current
    var noticeOpen by remember { mutableStateOf(false) }
    var clearing by remember { mutableStateOf(false) }
    PeriodStatusCard(state, open)
    PeriodCalendar(state) { open("day:$it") }
    HorizontalDivider(color = colors.borderHairline)
    val names = periodCharacterNames(state)
    val who =
        when {
            state.authorized.isEmpty() -> listOf("还没有")
            else -> state.authorized.mapNotNull { names[it] }.ifEmpty { listOf("${state.authorized.size} 个角色") }
        }
    PeriodRow("让谁知道", who.joinToString("、")) { open("auth") }
    PeriodRow("历史记录", "") { open("history") }
    val settingsValue = state.settings?.let { "${it.cycleLengthDays} 天 / ${it.periodLengthDays} 天" }.orEmpty()
    PeriodRow("周期设置", settingsValue) { open("settings") }
    TextButton(onClick = { clearing = true }, enabled = !state.busy) { Text("清空经期日记", color = colors.textDanger) }
    Text(
        if (noticeOpen) PeriodState.NOTICE else "加密保存，只有你授权的角色知道",
        Modifier.clickable { noticeOpen = !noticeOpen },
        color = colors.textTertiary,
        style = MaterialTheme.typography.bodySmall,
    )
    if (clearing) {
        AlertDialog(
            onDismissRequest = { if (!state.busy) clearing = false },
            title = { Text("清空经期日记？") },
            text = { Text("所有经期记录、周期设置和「让谁知道」的授权都会删除，不能恢复。授权的角色也会立即不再知道。") },
            confirmButton = {
                TextButton(enabled = !state.busy, onClick = {
                    state.perform(success = "已清空", after = { clearing = false }) { state.clearAll() }
                }) { Text("清空", color = colors.textDanger) }
            },
            dismissButton = { TextButton(enabled = !state.busy, onClick = { clearing = false }) { Text("取消") } },
        )
    }
}

@Composable internal fun PeriodRow(
    label: String,
    value: String,
    onClick: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    Row(
        Modifier.fillMaxWidth().heightIn(min = WbSize.SettingRow).clickable(onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, Modifier.weight(1f))
        Text("$value ›", color = colors.textSecondary, maxLines = 1)
    }
}

@Composable private fun PeriodStatusCard(
    state: PeriodState,
    open: (String) -> Unit,
) {
    val colors = LocalWeibanColors.current
    val today = LocalDate.now()
    val current = state.cycleContaining(today)
    val prediction = state.prediction
    Column(
        Modifier
            .fillMaxWidth()
            .background(colors.bgSurface, RoundedCornerShape(WbRadius.Md))
            .padding(WbSpace.S5),
        verticalArrangement = Arrangement.spacedBy(WbSpace.S3),
    ) {
        when {
            current != null -> {
                val day = ChronoUnit.DAYS.between(LocalDate.parse(current.startDate), today) + 1
                Text("经期第 $day 天", style = MaterialTheme.typography.titleLarge)
                val total = prediction?.predictedDays ?: state.settings?.periodLengthDays
                if (total != null && total - day > 0) Text("预计还有 ${total - day} 天 · 仅供参考", color = colors.textSecondary)
            }
            state.cycles.isEmpty() -> Text("记下最近一次经期，就能帮你预测下一次")
            else -> {
                val next = prediction?.predictedNextStart?.let(LocalDate::parse)
                if (next != null) {
                    val until = ChronoUnit.DAYS.between(today, next)
                    val text = if (until > 0) "距下次预计还有 $until 天" else "预计这几天开始"
                    Text(text, style = MaterialTheme.typography.titleLarge)
                } else {
                    Text("还不能预测下一次", style = MaterialTheme.typography.titleLarge)
                }
            }
        }
        if (prediction?.confidence == "irregular" || prediction?.confidence == "insufficient_data") {
            Text("记录较少 / 不规律，预测可能不准", color = colors.textSecondary, style = MaterialTheme.typography.bodySmall)
        }
        // 「仅供参考」文案由服务器提供，必须展示（PLAY-01 第 3 条）。
        prediction?.let { Text(it.disclaimer, color = colors.textSecondary, style = MaterialTheme.typography.bodySmall) }
        Row(horizontalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
            when {
                current != null -> {
                    OutlinedButton(onClick = { open("day:$today") }, enabled = !state.busy) { Text("记录今天") }
                    if (current.endDate == null) {
                        Button(enabled = !state.busy, onClick = {
                            state.perform(success = "已记下") { state.updateCycle(current.cycleId, endDate = today) }
                        }) { Text("经期结束了") }
                    }
                }
                state.cycles.isEmpty() ->
                    Button(enabled = !state.busy, onClick = { state.perform(success = "已记下") { state.createCycle(today) } }) {
                        Text("记录一次经期")
                    }
                else -> {
                    Button(enabled = !state.busy, onClick = { state.perform(success = "已记下") { state.createCycle(today) } }) {
                        Text("经期开始了")
                    }
                    OutlinedButton(onClick = { open("day:$today") }, enabled = !state.busy) { Text("记录今天") }
                }
            }
        }
    }
}

private val weekdays = listOf("一", "二", "三", "四", "五", "六", "日")

@Composable private fun PeriodCalendar(
    state: PeriodState,
    onDay: (LocalDate) -> Unit,
) {
    val colors = LocalWeibanColors.current
    val pink = LocalWeibanModeColors.current.tintPink
    val month = state.month
    val today = LocalDate.now()
    val predicted = state.predictedDays()
    val logged = state.cycles.flatMap { cycle -> cycle.dayLogs.map { it.date } }.toSet()
    Column(
        Modifier
            .fillMaxWidth()
            .background(colors.bgSurface, RoundedCornerShape(WbRadius.Md))
            .padding(WbSpace.S3),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { state.month = month.minusMonths(1) }) { Text("‹") }
            Text("${month.year} 年 ${month.monthValue} 月", Modifier.weight(1f), textAlign = TextAlign.Center)
            TextButton(onClick = { state.month = month.plusMonths(1) }) { Text("›") }
        }
        Row(Modifier.fillMaxWidth()) {
            weekdays.forEach { Text(it, Modifier.weight(1f), textAlign = TextAlign.Center, color = colors.textSecondary) }
        }
        val first = month.atDay(1)
        val offset = first.dayOfWeek.value - 1
        val cells = (0 until offset).map { null } + (1..month.lengthOfMonth()).map { month.atDay(it) }
        cells.chunked(weekdays.size).forEach { week ->
            Row(Modifier.fillMaxWidth()) {
                week.forEach { day ->
                    Box(Modifier.weight(1f).aspectRatio(1f).padding(WbSpace.S1), contentAlignment = Alignment.Center) {
                        if (day != null) {
                            val recorded = state.cycleContaining(day) != null
                            val future = day.isAfter(today)
                            var cell = Modifier.fillMaxSize()
                            cell =
                                when {
                                    recorded -> cell.background(pink, CircleShape)
                                    day in predicted -> cell.border(BorderStroke(WbSpace.S1, pink), CircleShape)
                                    else -> cell
                                }
                            if (!future) cell = cell.clickable { onDay(day) }
                            Box(cell, contentAlignment = Alignment.Center) {
                                Text(
                                    day.dayOfMonth.toString() + if (day.toString() in logged) "·" else "",
                                    color = if (future) colors.textTertiary else colors.textPrimary,
                                    fontWeight = if (day == today) FontWeight.Bold else FontWeight.Normal,
                                )
                            }
                        }
                    }
                }
                repeat(weekdays.size - week.size) { Spacer(Modifier.weight(1f)) }
            }
        }
        Text("● 已记录   ◌ 预测（仅供参考）", color = colors.textSecondary, style = MaterialTheme.typography.bodySmall)
    }
}
