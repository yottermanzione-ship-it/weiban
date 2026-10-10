@file:Suppress("TooGenericExceptionCaught", "LongMethod", "CyclomaticComplexMethod", "LongParameterList")

package app.weiban.feature.chat

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import app.weiban.contracts.*
import app.weiban.data.*
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.tokens.WbSpace
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import java.time.LocalDate
import java.time.LocalTime

// ---------- 陪你专注（PLAY-06） ----------

private val focusPresets = listOf(25, 45, 60, 90)

@Composable internal fun ColumnScope.FocusPage(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    initialCharacterId: String?,
) {
    val context = LocalContext.current
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    val contacts = playContacts(runtime, owner)
    val active =
        playRemote("${owner.sessionId}:focus", "focus") {
            repository.call(Endpoints.focusEndpointsGetActive, options = SessionCallOptions(owner = owner, networkOnly = true))
        }
    var selected by remember { mutableStateOf(initialCharacterId) }
    var minutes by remember { mutableIntStateOf(25) }
    var custom by remember { mutableStateOf("") }
    var useCustom by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf("") }
    var pending by remember { mutableStateOf(false) }
    var confirmEnd by remember { mutableStateOf(false) }
    // 刚结束的一次（时间到或提前结束），用于显示「专注结束」。
    var finished by remember { mutableStateOf<FocusSession?>(null) }
    val session = active.data?.session?.takeIf { it.result == "in_progress" }
    val profiles = rememberPlayNames(repository, contacts, listOfNotNull(session?.characterId, finished?.characterId))
    PlayHeader("陪你专注") { if (session != null) TextButton(onClick = PlayNav::close) { Text("收起") } }
    Column(
        Modifier
            .weight(1f)
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(WbSpace.S5),
        verticalArrangement = Arrangement.spacedBy(WbSpace.S4),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        val done = finished
        when {
            active.loading && active.data == null -> LinearProgressIndicator(Modifier.fillMaxWidth())
            session != null -> {
                val end = epochOf(session.endsAt) ?: 0L
                var now by remember(session.focusId) { mutableLongStateOf(System.currentTimeMillis()) }
                LaunchedEffect(session.focusId) {
                    while (now < end) {
                        delay(1_000)
                        now = System.currentTimeMillis()
                    }
                    finished = session.copy(result = "completed")
                    active.refresh()
                }
                Text("和 ${playName(contacts, profiles, session.characterId)} 一起专注", color = colors.textSecondary)
                session.note?.let { Text(it, style = MaterialTheme.typography.titleMedium) }
                // 以服务器 endsAt 为准，离开页面计时照常。
                Text(clockText(end - now), style = MaterialTheme.typography.displayMedium)
                OutlinedButton(onClick = { confirmEnd = true }, enabled = !pending) { Text("提前结束") }
            }
            done != null -> {
                val name = playName(contacts, profiles, done.characterId)
                Text("专注结束", style = MaterialTheme.typography.headlineSmall)
                Text("${done.plannedMinutes} 分钟的专注" + if (done.result == "ended_early") "，提前结束了" else "", color = colors.textSecondary)
                Button(onClick = { openChatWith(contacts, done.characterId) }) { Text("去和 $name 聊聊") }
                TextButton(onClick = { finished = null }) { Text("再来一次") }
            }
            else -> {
                Text("选一个陪你的人", Modifier.fillMaxWidth())
                RolePickerRow(repository, owner, contacts, profiles, selected) { selected = it }
                Text("时长", Modifier.fillMaxWidth())
                Row(
                    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(WbSpace.S2),
                ) {
                    focusPresets.forEach { value ->
                        FilterChip(selected = !useCustom && minutes == value, onClick = {
                            useCustom = false
                            minutes = value
                        }, label = { Text("$value") })
                    }
                    FilterChip(selected = useCustom, onClick = { useCustom = true }, label = { Text("自定义") })
                }
                val customMinutes = custom.toIntOrNull()
                if (useCustom) {
                    OutlinedTextField(
                        custom,
                        { value -> custom = value.filter(Char::isDigit).take(3) },
                        Modifier.fillMaxWidth(),
                        singleLine = true,
                        label = { Text("分钟（$FOCUS_MIN–$FOCUS_MAX）") },
                    )
                }
                OutlinedTextField(
                    note,
                    { note = it },
                    Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text("做什么（选填）") },
                    supportingText = { CharCount(plazaChars(note), FOCUS_NOTE_MAX) },
                )
                PlazaFootnote("TA 可能会记住这件事")
                val chosenMinutes = if (useCustom) customMinutes else minutes
                val valid = chosenMinutes != null && chosenMinutes in FOCUS_MIN..FOCUS_MAX
                Button(
                    onClick = start@{
                        val characterId = selected ?: return@start
                        val value = chosenMinutes ?: return@start
                        pending = true
                        scope.launch {
                            try {
                                val started =
                                    repository.call(
                                        Endpoints.focusEndpointsStart,
                                        body =
                                            buildJsonObject {
                                                put("clientRequestId", newRequestId())
                                                put("characterId", characterId)
                                                put("minutes", value)
                                                if (note.isNotBlank()) put("note", note.trim())
                                            },
                                        options = SessionCallOptions(owner = owner),
                                    )
                                active.data = FocusEndpointsGetActiveResponse(started)
                            } catch (error: CancellationException) {
                                throw error
                            } catch (error: Exception) {
                                if (plazaCode(error) == "focus_in_progress" || plazaCode(error) == "conflict") {
                                    plazaToast(context, "已经有一次专注在进行")
                                    active.refresh()
                                } else {
                                    plazaToast(context, "没成功，请重试")
                                }
                            } finally {
                                pending = false
                            }
                        }
                    },
                    enabled = !pending && selected != null && valid && plazaChars(note) <= FOCUS_NOTE_MAX,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("开始") }
            }
        }
    }
    // 提前结束：只有「结束 / 取消」，没有挽留、不用红色（SAFE-08）。
    if (confirmEnd && session != null) {
        AlertDialog(
            onDismissRequest = { confirmEnd = false },
            title = { Text("结束这次专注？") },
            confirmButton = {
                TextButton(onClick = {
                    confirmEnd = false
                    pending = true
                    scope.launch {
                        try {
                            finished =
                                repository.call(
                                    Endpoints.focusEndpointsEnd,
                                    params = mapOf("focusId" to session.focusId),
                                    options = SessionCallOptions(owner = owner),
                                )
                            active.refresh()
                        } catch (error: CancellationException) {
                            throw error
                        } catch (_: Exception) {
                            plazaToast(context, "没成功，请重试")
                        } finally {
                            pending = false
                        }
                    }
                }) { Text("结束") }
            },
            dismissButton = { TextButton(onClick = { confirmEnd = false }) { Text("取消") } },
        )
    }
}

// ---------- TA 的提醒（PLAY-07） ----------

private val weekdayNames = listOf("一", "二", "三", "四", "五", "六", "日")

/** 解析后的重复方式（契约 ReminderRepeat 为 JSON 联合类型）。 */
internal data class RepeatValue(
    val kind: String,
    val date: String? = null,
    val weekdays: List<Int> = emptyList(),
)

internal fun parseRepeat(element: JsonElement): RepeatValue =
    try {
        val value = element.jsonObject
        RepeatValue(
            value["kind"]?.jsonPrimitive?.contentOrNull ?: "daily",
            value["date"]?.jsonPrimitive?.contentOrNull,
            (value["weekdays"] as? JsonArray)?.mapNotNull { it.jsonPrimitive.intOrNull }.orEmpty(),
        )
    } catch (_: Exception) {
        RepeatValue("daily")
    }

internal fun repeatJson(value: RepeatValue): JsonObject =
    buildJsonObject {
        put("kind", value.kind)
        if (value.kind == "once") {
            put("date", value.date ?: todayText())
        } else {
            put("weekdays", JsonArray(if (value.kind == "weekly") value.weekdays.sorted().map(::JsonPrimitive) else emptyList()))
        }
    }

internal fun repeatText(value: RepeatValue): String =
    when (value.kind) {
        "once" -> value.date?.let { "不重复 · ${monthDay(it)}" } ?: "不重复"
        "workdays" -> "工作日"
        "weekly" -> "每周" + value.weekdays.sorted().joinToString("、") { weekdayNames.getOrElse(it - 1) { "" } }
        else -> "每天"
    }

@Composable internal fun ColumnScope.RemindersPage(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
) {
    val context = LocalContext.current
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    val contacts = playContacts(runtime, owner)
    val list =
        playRemote("${owner.sessionId}:reminders", "reminders") {
            repository.call(Endpoints.reminderEndpointsListReminders, options = SessionCallOptions(owner = owner, networkOnly = true))
        }
    val stack by PlayNav.stack.collectAsState()
    LaunchedEffect(stack.size) { list.refresh() }
    val items = list.data?.items.orEmpty()
    val limit = list.data?.limit ?: 10L
    val profiles = rememberPlayNames(repository, contacts, items.map { it.characterId })
    PlayHeader("TA 的提醒") {
        Text("${items.size} / $limit", color = colors.textTertiary, style = MaterialTheme.typography.bodySmall)
        TextButton(onClick = {
            if (items.size >= limit) plazaToast(context, "最多 10 条提醒") else PlayNav.open(PlayPage.ReminderEdit(null))
        }) { Text("＋") }
    }
    if (list.loading && list.data == null) LinearProgressIndicator(Modifier.fillMaxWidth())
    if (list.error != null && list.data == null) {
        Column(Modifier.padding(WbSpace.S5)) {
            Text("加载失败")
            TextButton(onClick = list::refresh) { Text("重试") }
        }
    }
    Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())) {
        if (list.data != null && items.isEmpty()) Text("还没有提醒，让 TA 到点叫你一声吧", Modifier.padding(WbSpace.S5), color = colors.textSecondary)
        items.forEach { reminder ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .clickable { PlayNav.open(PlayPage.ReminderEdit(reminder.reminderId)) }
                    .padding(horizontal = WbSpace.S5, vertical = WbSpace.S3),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(WbSpace.S2)) {
                        Text(reminder.time, style = MaterialTheme.typography.titleLarge)
                        Text(reminder.text)
                        if (reminder.health) Text("健康", color = colors.brandPrimary, style = MaterialTheme.typography.labelSmall)
                    }
                    Text(
                        "${playName(contacts, profiles, reminder.characterId)} 提醒 · ${repeatText(parseRepeat(reminder.repeat))}" +
                            if (reminder.pausedByContactRemoval) " · 已暂停" else "",
                        color = colors.textSecondary,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                Switch(reminder.enabled, { value ->
                    scope.launch {
                        userAction({ plazaToast(context, "没成功，请重试") }) {
                            repository.call(
                                Endpoints.reminderEndpointsUpdateReminder,
                                params = mapOf("reminderId" to reminder.reminderId),
                                body = buildJsonObject { put("enabled", value) },
                                options = SessionCallOptions(owner = owner),
                            )
                            list.refresh()
                        }
                    }
                })
            }
            HorizontalDivider()
        }
    }
}

private val reminderQuickFills = listOf("喝水", "吃药", "休息一下", "早点睡", "吃饭")

@Composable internal fun ColumnScope.ReminderEditPage(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    reminderId: String?,
) {
    val context = LocalContext.current
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    val contacts = playContacts(runtime, owner)
    val list =
        playRemote("${owner.sessionId}:reminders-edit", null) {
            repository.call(Endpoints.reminderEndpointsListReminders, options = SessionCallOptions(owner = owner, networkOnly = true))
        }
    val existing = reminderId?.let { id -> list.data?.items?.find { it.reminderId == id } }
    var loaded by remember { mutableStateOf(reminderId == null) }
    var text by remember { mutableStateOf("") }
    var time by remember { mutableStateOf("08:00") }
    var repeat by remember { mutableStateOf(RepeatValue("daily")) }
    var characterId by remember { mutableStateOf(contacts.firstOrNull()?.characterId) }
    var health by remember { mutableStateOf(false) }
    var bypass by remember { mutableStateOf(false) }
    var enabled by remember { mutableStateOf(true) }
    var pending by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    LaunchedEffect(existing) {
        if (existing != null && !loaded) {
            text = existing.text
            time = existing.time
            repeat = parseRepeat(existing.repeat)
            characterId = existing.characterId
            health = existing.health
            bypass = existing.bypassDoNotDisturb
            enabled = existing.enabled
            loaded = true
        }
    }
    val profiles = rememberPlayNames(repository, contacts, listOfNotNull(characterId))
    PlayHeader(if (reminderId == null) "新建提醒" else "编辑提醒")
    if (!loaded) {
        if (list.error != null) Text("加载失败", Modifier.padding(WbSpace.S5)) else LinearProgressIndicator(Modifier.fillMaxWidth())
        return
    }
    val count = plazaChars(text)
    Column(
        Modifier
            .weight(1f)
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(WbSpace.S5),
        verticalArrangement = Arrangement.spacedBy(WbSpace.S3),
    ) {
        OutlinedTextField(
            text,
            { text = it },
            Modifier.fillMaxWidth(),
            singleLine = true,
            label = { Text("提醒内容") },
            supportingText = { CharCount(count, REMINDER_TEXT_MAX) },
        )
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(WbSpace.S2)) {
            reminderQuickFills.forEach { fill ->
                AssistChip(onClick = {
                    text = fill
                    // 只提示，不自动打开「归类为健康」。
                    if (fill == "吃药") plazaToast(context, "吃药类提醒建议归类为健康")
                }, label = { Text(fill) })
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("时间", Modifier.weight(1f))
            TextButton(onClick = {
                val base = runCatching { LocalTime.parse(time) }.getOrDefault(LocalTime.of(8, 0))
                TimePickerDialog(context, { _, hour, minute ->
                    time = "%02d:%02d".format(java.util.Locale.ROOT, hour, minute)
                }, base.hour, base.minute, true).show()
            }) { Text(time, style = MaterialTheme.typography.titleLarge) }
        }
        Text("重复")
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(WbSpace.S2)) {
            listOf("once" to "不重复", "daily" to "每天", "workdays" to "工作日", "weekly" to "自定义").forEach { (kind, label) ->
                FilterChip(selected = repeat.kind == kind, onClick = {
                    repeat =
                        when (kind) {
                            "once" -> RepeatValue("once", repeat.date ?: todayText())
                            "weekly" ->
                                RepeatValue(
                                    "weekly",
                                    weekdays = repeat.weekdays.ifEmpty { listOf(LocalDate.now().dayOfWeek.value) },
                                )
                            else -> RepeatValue(kind)
                        }
                }, label = { Text(label) })
            }
        }
        if (repeat.kind == "weekly") {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(WbSpace.S1)) {
                weekdayNames.forEachIndexed { index, name ->
                    val day = index + 1
                    val on = day in repeat.weekdays
                    FilterChip(selected = on, onClick = {
                        val next = if (on) repeat.weekdays - day else repeat.weekdays + day
                        if (next.isNotEmpty()) repeat = repeat.copy(weekdays = next)
                    }, label = { Text(name) })
                }
            }
        }
        if (repeat.kind == "once") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("日期", Modifier.weight(1f))
                TextButton(onClick = {
                    val base = repeat.date?.let { runCatching { LocalDate.parse(it) }.getOrNull() } ?: LocalDate.now()
                    DatePickerDialog(context, { _, year, month, day ->
                        repeat = repeat.copy(date = LocalDate.of(year, month + 1, day).toString())
                    }, base.year, base.monthValue - 1, base.dayOfMonth).show()
                }) { Text(repeat.date?.let(::monthDay) ?: "今天") }
            }
        }
        Text("谁来提醒")
        if (reminderId == null) {
            RolePickerRow(repository, owner, contacts, profiles, characterId) { characterId = it }
        } else {
            Text(playName(contacts, profiles, characterId), color = colors.textSecondary)
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("归类为健康")
                PlazaFootnote("通知不显示内容，也不会进分享图")
            }
            Switch(health, { health = it })
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("免打扰时段也提醒", Modifier.weight(1f))
            Switch(bypass, { bypass = it })
        }
        if (reminderId != null) {
            TextButton(onClick = { confirmDelete = true }) { Text("删除提醒", color = colors.textDanger) }
        }
    }
    Button(
        onClick = save@{
            val target = characterId ?: return@save
            pending = true
            scope.launch {
                try {
                    val body =
                        buildJsonObject {
                            if (reminderId == null) {
                                put("clientRequestId", newRequestId())
                                put("characterId", target)
                            }
                            put("text", text.trim())
                            put("time", time)
                            put("repeat", repeatJson(repeat))
                            put("health", health)
                            put("bypassDoNotDisturb", bypass)
                            put("enabled", enabled)
                        }
                    if (reminderId == null) {
                        repository.call(Endpoints.reminderEndpointsCreateReminder, body = body, options = SessionCallOptions(owner = owner))
                    } else {
                        repository.call(
                            Endpoints.reminderEndpointsUpdateReminder,
                            params = mapOf("reminderId" to reminderId),
                            body = body,
                            options = SessionCallOptions(owner = owner),
                        )
                    }
                    plazaToast(context, "已保存")
                    PlayNav.back()
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    plazaToast(context, if (plazaCode(error) == "limit_reached") "最多 10 条提醒" else "没成功，请重试")
                } finally {
                    pending = false
                }
            }
        },
        enabled = !pending && text.isNotBlank() && count <= REMINDER_TEXT_MAX && characterId != null,
        modifier = Modifier.fillMaxWidth().padding(horizontal = WbSpace.S5, vertical = WbSpace.S2),
    ) { Text("保存") }
    if (confirmDelete && reminderId != null) {
        PlazaConfirm("删除这条提醒？", null, "删除", { confirmDelete = false }) {
            confirmDelete = false
            scope.launch {
                userAction({ plazaToast(context, it) }) {
                    repository.call(
                        Endpoints.reminderEndpointsDeleteReminder,
                        params = mapOf("reminderId" to reminderId),
                        options = SessionCallOptions(owner = owner),
                    )
                    PlayNav.back()
                }
            }
        }
    }
}
