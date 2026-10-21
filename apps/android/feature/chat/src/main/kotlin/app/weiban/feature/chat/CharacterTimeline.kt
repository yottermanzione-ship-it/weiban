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

/** 「TA 的近况」时间线（SIM-11 第 3、4 条）：契约 3.0 listTimeline，90 天内日常事件、朋友圈、角色互动、公开动态，倒序分页。 */
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
        try {
            repository.call(Endpoints.timelineEndpointsRemoveEpisode, params = mapOf("characterId" to characterId, "episodeId" to entry.entryId), options = SessionCallOptions(owner = owner, networkOnly = true))
            items.removeAll { it.entryId == entry.entryId }
            return true
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            removeError = "删除失败，请重试"
            return false
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
) {
    BackHandler(onBack = onBack)
    val pager = remember(owner, characterId) { TimelinePager(repository, owner, characterId) }
    val scope = rememberCoroutineScope()
    val list = rememberLazyListState()
    val colors = LocalWeibanColors.current
    var removing by remember(owner, characterId) { mutableStateOf<TimelineEntry?>(null) }
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
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onBack) { Text("‹ 返回") }
            Text("${name.ifBlank { "TA" }} 的近况", style = MaterialTheme.typography.titleMedium)
        }
        when {
            !pager.initialized && pager.failed ->
                Column(Modifier.fillMaxWidth().padding(WbSpace.S8), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("加载失败")
                    Button(onClick = { scope.launch { pager.next() } }) { Text("重试") }
                }
            !pager.initialized -> LinearProgressIndicator(Modifier.fillMaxWidth())
            pager.items.isEmpty() ->
                Text("TA 的近况会出现在这里", Modifier.fillMaxWidth().padding(WbSpace.S8), color = colors.textSecondary)
            else ->
                LazyColumn(state = list, modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(WbSpace.S5)) {
                    items(pager.items, key = { it.entryId }) { entry -> TimelineRow(entry) { removing = entry } }
                    item(key = "footer") { TimelineFooter(pager) { scope.launch { pager.next() } } }
                }
        }
    }
    removing?.let { entry ->
        AlertDialog(onDismissRequest = { if (!pager.deleting) removing = null }, title = { Text("删除这段共同经历？") }, text = { Text(pager.removeError ?: "TA 将不再通过共同经历想起这件事，旧任务也不会重新写回。") }, confirmButton = {
            TextButton(enabled = !pager.deleting, onClick = { scope.launch { if (pager.remove(entry)) removing = null } }) { Text(if (pager.deleting) "正在删除…" else "删除并忘记") }
        }, dismissButton = { TextButton(enabled = !pager.deleting, onClick = { removing = null }) { Text("取消") } })
    }
}

@Composable private fun TimelineRow(entry: TimelineEntry, onRemove: () -> Unit) {
    val colors = LocalWeibanColors.current
    Column(Modifier.fillMaxWidth().padding(vertical = WbSpace.S3)) {
        Text(momentTime(entry.occurredAt), color = colors.textSecondary, style = MaterialTheme.typography.bodySmall)
        Row(horizontalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
            entry.kind?.let { Text(timelineKindLabel(it), color = colors.textSecondary, style = MaterialTheme.typography.bodySmall) }
            Text(entry.summary, style = MaterialTheme.typography.bodyMedium)
        }
        val source =
            when (entry.source) {
                "public_update" -> "公开资料"
                "moments_post" -> "朋友圈"
                "character_interaction" -> "和其他角色"
                "shared_episode" -> "我们一起"
                else -> null
            }
        source?.let { Text(it, color = colors.textTertiary, style = MaterialTheme.typography.bodySmall) }
        if (entry.source == "shared_episode") TextButton(onClick = onRemove) { Text("删除并忘记") }
        if (entry.ref?.kind ==
            "url"
        ) {
            Text(entry.ref?.id.orEmpty(), color = colors.textLink, style = MaterialTheme.typography.bodySmall, maxLines = 1)
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
