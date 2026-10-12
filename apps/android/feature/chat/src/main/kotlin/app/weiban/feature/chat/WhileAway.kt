@file:Suppress("MatchingDeclarationName")

package app.weiban.feature.chat

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import app.weiban.contracts.*
import app.weiban.data.OwnerRecord
import app.weiban.data.SessionCallOptions
import app.weiban.data.SessionRepository
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.tokens.WbRadius
import app.weiban.designsystem.tokens.WbSpace
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withTimeoutOrNull
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit

/** "你不在时" card state (SIM-11, P-18). Last-active and shown markers live in Room via [SessionRepository.flags]. */
internal class WhileAwayState {
    var data by mutableStateOf<TimelineSummaryResponse?>(null)
    var expanded by mutableStateOf(false)
    var ready by mutableStateOf(false)
}

private const val SUMMARY_TIMEOUT_MS = 2_000L
private const val CARD_EVENT_LIMIT = 5

internal fun nowTimestamp(): String = Instant.now().truncatedTo(ChronoUnit.MILLIS).toString()

@Composable internal fun rememberWhileAway(
    repository: SessionRepository,
    owner: OwnerRecord,
    conversationId: String,
    characterId: String?,
    lastMessageId: String?,
): WhileAwayState {
    val state = remember(owner, conversationId) { WhileAwayState() }
    LaunchedEffect(state) {
        val activeKey = "lastActive:$conversationId"
        val now = nowTimestamp()
        // T-066：服务器以每次调用摘要接口记录「进入私聊」的时间，所以每次打开私聊都调用；本机没有记录时传当前时刻。
        val previous = repository.flags.get(owner, activeKey) ?: now
        repository.flags.set(owner, activeKey, now)
        state.ready = true
        if (characterId == null) return@LaunchedEffect
        val summary = loadSummary(repository, owner, conversationId, characterId, previous) ?: return@LaunchedEffect
        if (summary.summary == null) return@LaunchedEffect
        val shownKey = "whileAway:$conversationId:$previous"
        val alreadyShown = repository.flags.get(owner, shownKey) != null
        state.data = summary
        state.expanded = !alreadyShown
        repository.flags.set(owner, shownKey, "shown")
    }
    // Keep "last active" fresh while the user is in this chat, so the next absence is measured from here.
    LaunchedEffect(state.ready, lastMessageId) {
        if (state.ready) repository.flags.set(owner, "lastActive:$conversationId", nowTimestamp())
    }
    return state
}

@Suppress("TooGenericExceptionCaught") // The card is optional: any failure or timeout simply hides it (design 2.3).
private suspend fun loadSummary(
    repository: SessionRepository,
    owner: OwnerRecord,
    conversationId: String,
    characterId: String,
    lastActiveAt: String,
): TimelineSummaryResponse? =
    withTimeoutOrNull(SUMMARY_TIMEOUT_MS) {
        try {
            repository.call(
                Endpoints.timelineEndpointsGetSummary,
                params = mapOf("conversationId" to conversationId),
                query = mapOf("characterId" to characterId, "lastActiveAt" to lastActiveAt),
                options = SessionCallOptions(owner = owner, networkOnly = true),
            )
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            null
        }
    }

internal fun whileAwayTitle(offlineSeconds: Long): String {
    val zone = ZoneId.systemDefault()
    val since =
        Instant
            .now()
            .minusSeconds(offlineSeconds)
            .atZone(zone)
            .toLocalDate()
    val days = ChronoUnit.DAYS.between(since, LocalDate.now(zone))
    return if (days < 1) "你不在的这段时间，TA……" else "你不在的这 $days 天，TA……"
}

internal fun timelineKindLabel(kind: String): String =
    when (kind) {
        "work" -> "工作"
        "social" -> "相处"
        "leisure" -> "休闲"
        "errand" -> "办事"
        "rest" -> "休息"
        "unexpected" -> "插曲"
        else -> "日常"
    }

@Composable internal fun WhileAwayCard(
    state: WhileAwayState,
    onAsk: (String) -> Unit,
) {
    val data = state.data ?: return
    val summary = data.summary ?: return
    val colors = LocalWeibanColors.current
    BackHandler(state.expanded) { state.expanded = false }
    if (!state.expanded) {
        Row(Modifier.fillMaxWidth().padding(horizontal = WbSpace.S5), horizontalArrangement = Arrangement.End) {
            AssistChip(onClick = { state.expanded = true }, label = { Text("TA 的近况") })
        }
        return
    }
    val events = data.events.take(CARD_EVENT_LIMIT).sortedBy { it.seq }
    Card(
        Modifier.fillMaxWidth().padding(horizontal = WbSpace.S5, vertical = WbSpace.S3),
        shape =
            androidx.compose.foundation.shape
                .RoundedCornerShape(WbRadius.Md),
        colors = CardDefaults.cardColors(containerColor = colors.bgSurface, contentColor = colors.textPrimary),
    ) {
        Column(Modifier.padding(WbSpace.S5), verticalArrangement = Arrangement.spacedBy(WbSpace.S2)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(whileAwayTitle(data.offlineSeconds), Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                TextButton(onClick = { state.expanded = false }) { Text("收起") }
            }
            Text(summary, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
            events.forEach { event ->
                Row(horizontalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
                    Text(timelineKindLabel(event.kind), color = colors.textSecondary, style = MaterialTheme.typography.bodySmall)
                    Text(event.summary, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
                }
            }
            events.firstOrNull()?.let { first ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = {
                        onAsk("${first.summary}是怎么回事？")
                        state.expanded = false
                    }) { Text("问问 TA ›") }
                }
            }
        }
    }
}
