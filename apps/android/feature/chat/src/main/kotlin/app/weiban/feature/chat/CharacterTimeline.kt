package app.weiban.feature.chat

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import app.weiban.contracts.*
import app.weiban.data.OwnerRecord
import app.weiban.data.SessionCallOptions
import app.weiban.data.SessionRepository
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.tokens.WbSize
import app.weiban.designsystem.tokens.WbSpace
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** 「TA 的动态」时间线（SIM-11 第 3、4 条）：契约 3.0 listTimeline，90 天内日常事件、角色互动、公开动态，倒序分页。 */
private class TimelinePager(
    private val repository: SessionRepository,
    private val owner: OwnerRecord,
    private val characterId: String,
) {
    val items = mutableStateListOf<TimelineEntry>()
    var cursor by mutableStateOf<String?>(null)
    var finished by mutableStateOf(false)
    var loading by mutableStateOf(false)
    var failed by mutableStateOf(false)
    var initialized by mutableStateOf(false)
    var deleting by mutableStateOf(false)
    var removeError by mutableStateOf<String?>(null)

    @Suppress("TooGenericExceptionCaught")
    suspend fun remove(entry: TimelineEntry): Boolean {
        if (deleting) return false
        deleting = true
        removeError = null
        return try {
            repository.call(
                Endpoints.timelineEndpointsRemoveEpisode,
                params =
                    mapOf(
                        "characterId" to characterId,
                        "episodeId" to entry.entryId,
                    ),
                options = SessionCallOptions(owner = owner, networkOnly = true),
            )
            items.removeAll { it.entryId == entry.entryId }
            true
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            removeError = "删除失败，请重试"
            false
        } finally {
            deleting = false
        }
    }

    @Suppress("TooGenericExceptionCaught") // UI boundary: show retry instead of crashing.
    suspend fun next() {
        if (loading || finished) return
        loading = true
        failed = false
        try {
            val page =
                repository.call(
                    Endpoints.timelineEndpointsListTimeline,
                    params = mapOf("characterId" to characterId),
                    query = buildMap<String, String> { cursor?.let { put("cursor", it) } },
                    options = SessionCallOptions(owner = owner, networkOnly = true),
                )
            items.addAll(page.items.filter { incoming -> items.none { it.entryId == incoming.entryId } })
            cursor = page.nextCursor
            finished = page.nextCursor == null
            initialized = true
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            failed = true
        } finally {
            loading = false
        }
    }
}

@Composable internal fun CharacterTimeline(
    repository: SessionRepository,
    owner: OwnerRecord,
    characterId: String,
    name: String,
    onBack: () -> Unit,
    onAsk: ((String) -> Unit)? = null,
    onOpenCharacter: ((String) -> Unit)? = null,
) {
    BackHandler(onBack = onBack)
    val pager = remember(owner, characterId) { TimelinePager(repository, owner, characterId) }
    val scope = rememberCoroutineScope()
    val list = rememberLazyListState()
    val colors = LocalWeibanColors.current
    var removing by remember(owner, characterId) { mutableStateOf<TimelineEntry?>(null) }
    val companion =
        remote("${owner.sessionId}:timeline:$characterId") {
            repository.call(
                Endpoints.companionEndpointsGetForCharacter,
                params = mapOf("characterId" to characterId),
                options = SessionCallOptions(owner = owner),
            )
        }
    val profiles = characterProfiles(repository, pager.items.flatMap { it.withCharacterIds })
    val names = profiles.mapValues { it.value.name }
    LaunchedEffect(pager) { pager.next() }
    val nearEnd by remember {
        derivedStateOf {
            val last =
                list.layoutInfo.visibleItemsInfo
                    .lastOrNull()
                    ?.index ?: 0
            last >= list.layoutInfo.totalItemsCount - 2
        }
    }
    LaunchedEffect(nearEnd, pager.initialized) { if (nearEnd && pager.initialized && !pager.failed) pager.next() }
    val groups = timelineGroups(pager.items)
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onBack) { Text("‹ 返回") }
            Text("TA 的动态", style = MaterialTheme.typography.titleMedium)
        }
        if (companion.data?.dailyLife == false) {
            Row(Modifier.fillMaxWidth().padding(horizontal = WbSpace.S5), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "你关闭了 TA 的动态，不会有新的动态",
                    Modifier.weight(1f),
                    color = colors.textSecondary,
                    style = MaterialTheme.typography.bodySmall,
                )
                TextButton(onClick = onBack) { Text("去开启") }
            }
        }
        when {
            !pager.initialized && pager.failed ->
                Column(Modifier.fillMaxWidth().padding(WbSpace.S8), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("加载失败")
                    Button(onClick = { scope.launch { pager.next() } }) { Text("重试") }
                }
            !pager.initialized -> LinearProgressIndicator(Modifier.fillMaxWidth())
            pager.items.isEmpty() ->
                Text("TA 的动态会出现在这里", Modifier.fillMaxWidth().padding(WbSpace.S8), color = colors.textSecondary)
            else ->
                LazyColumn(state = list, modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(WbSpace.S5)) {
                    groups.forEach { (day, entries) ->
                        item(key = "day-$day") {
                            Text(
                                timelineDayLabel(day),
                                Modifier.fillMaxWidth().padding(vertical = WbSpace.S3),
                                style = MaterialTheme.typography.titleSmall,
                            )
                        }
                        items(entries, key = { it.entryId }) { entry ->
                            TimelineRow(entry, names, onAsk, onOpenCharacter) { removing = entry }
                        }
                    }
                    item(key = "footer") { TimelineFooter(pager) { scope.launch { pager.next() } } }
                }
        }
    }
    removing?.let { entry ->
        AlertDialog(onDismissRequest = { if (!pager.deleting) removing = null }, title = { Text("删除这段共同经历？") }, text = {
            Text(pager.removeError ?: "TA 将不再通过共同经历想起这件事，旧任务也不会重新写回。")
        }, confirmButton = {
            TextButton(enabled = !pager.deleting, onClick = {
                scope.launch { if (pager.remove(entry)) removing = null }
            }) { Text(if (pager.deleting) "正在删除…" else "删除并忘记") }
        }, dismissButton = { TextButton(enabled = !pager.deleting, onClick = { removing = null }) { Text("取消") } })
    }
}

/** 按本地日期分组（条目已按时间倒序，组内顺序不变）。 */
private fun timelineGroups(items: List<TimelineEntry>): List<Pair<java.time.LocalDate, List<TimelineEntry>>> {
    val groups = ArrayList<Pair<java.time.LocalDate, MutableList<TimelineEntry>>>()
    for (entry in items) {
        val day = timelineDay(entry.occurredAt)
        val last = groups.lastOrNull()
        if (last != null && last.first == day) last.second.add(entry) else groups.add(day to mutableListOf(entry))
    }
    return groups
}

private fun timelineDay(occurredAt: String): java.time.LocalDate =
    try {
        java.time.Instant.parse(occurredAt).atZone(java.time.ZoneId.systemDefault()).toLocalDate()
    } catch (_: Exception) {
        java.time.LocalDate.now(java.time.ZoneId.systemDefault())
    }

/** 网页版 dayLabel 同款：今天 / 昨天 / M 月 d 日 星期X。 */
private fun timelineDayLabel(day: java.time.LocalDate): String {
    val zone = java.time.ZoneId.systemDefault()
    val today = java.time.LocalDate.now(zone)
    if (day == today) return "今天"
    if (day == today.minusDays(1)) return "昨天"
    val week = arrayOf("日", "一", "二", "三", "四", "五", "六")[day.dayOfWeek.value % 7]
    return "${day.monthValue} 月 ${day.dayOfMonth} 日 星期$week"
}

/** 行内时间：时钟 HH:mm（网页版 TimelineItem 同款）。 */
private fun timelineClock(occurredAt: String): String =
    try {
        java.time.Instant
            .parse(occurredAt)
            .atZone(java.time.ZoneId.systemDefault())
            .format(java.time.format.DateTimeFormatter.ofPattern("HH:mm"))
    } catch (_: Exception) {
        momentTime(occurredAt)
    }

@Composable private fun TimelineRow(
    entry: TimelineEntry,
    names: Map<String, String>,
    onAsk: ((String) -> Unit)?,
    onOpenCharacter: ((String) -> Unit)?,
    onRemove: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    val context = androidx.compose.ui.platform.LocalContext.current
    var expanded by remember(entry.entryId) { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(vertical = WbSpace.S3)) {
        Row(horizontalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
            Text(timelineClock(entry.occurredAt), color = colors.textSecondary, style = MaterialTheme.typography.bodySmall)
            entry.kind?.let { Text(timelineKindLabel(it), color = colors.textSecondary, style = MaterialTheme.typography.bodySmall) }
        }
        Text(
            entry.summary,
            style = MaterialTheme.typography.bodyMedium,
            maxLines = if (expanded) Int.MAX_VALUE else 4,
        )
        if (entry.summary.length > 80 && !expanded) {
            TextButton(onClick = { expanded = true }) { Text("展开") }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
            if (entry.source == "shared_episode") {
                Text("我们一起", color = colors.textTertiary, style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = onRemove) { Text("删除并忘记") }
            }
            entry.withCharacterIds.forEach { id ->
                val label = names[id] ?: "角色"
                if (onOpenCharacter != null) {
                    TextButton(onClick = { onOpenCharacter(id) }) { Text(label) }
                } else {
                    Text(label, color = colors.textLink, style = MaterialTheme.typography.bodySmall)
                }
            }
            if (entry.source == "public_update") {
                Text("公开资料", color = colors.textTertiary, style = MaterialTheme.typography.bodySmall)
                val ref = entry.ref
                if (ref?.kind == "url") {
                    TextButton(onClick = { openLink(context, ref.id) }) { Text("来源") }
                }
            }
            if (onAsk != null) {
                TextButton(onClick = { onAsk("${entry.summary}是怎么回事？") }) { Text("问问 TA ›") }
            }
        }
    }
    HorizontalDivider(color = colors.borderHairline)
}

@Composable private fun TimelineFooter(
    pager: TimelinePager,
    onRetry: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    Box(Modifier.fillMaxWidth().padding(WbSpace.S5), contentAlignment = Alignment.Center) {
        when {
            pager.loading -> CircularProgressIndicator(Modifier.size(WbSize.ListIcon))
            pager.failed -> Text("加载失败，点击重试", Modifier.clickable(onClick = onRetry), color = colors.textLink)
            pager.finished -> Text("只保留最近 90 天", color = colors.textTertiary, style = MaterialTheme.typography.bodySmall)
        }
    }
}
