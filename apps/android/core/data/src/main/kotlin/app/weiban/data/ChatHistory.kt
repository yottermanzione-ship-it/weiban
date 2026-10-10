package app.weiban.data

import app.weiban.contracts.*
import app.weiban.network.ApiFailure
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first

/** History requests belong to the application owner, not the lifetime of a screen. */
class ChatHistory(
    private val repository: SessionRepository,
    private val scope: CoroutineScope,
    private val runner: suspend (OwnerRecord) -> SyncRunner?,
    private val refresh: suspend (OwnerRecord) -> Long?,
) {
    suspend fun older(
        expected: OwnerRecord,
        conversationId: String,
        beforeSeq: Long,
    ) {
        val current = runner(expected) ?: return
        val page =
            repository.call(
                Endpoints.chatEndpointsListMessages,
                params = mapOf("conversationId" to conversationId),
                query = mapOf("beforeSeq" to beforeSeq.toString(), "limit" to "50"),
                options = SessionCallOptions(networkOnly = true, owner = expected),
            )
        if (runner(expected) === current) current.history(conversationId, beforeSeq, page)
    }

    /**
     * 搜索 / 收藏定位（CHAT-12，T-085）：把 seq 附近的消息加载到本地。
     * earliest = 本地已有的最早 seq；从它往前连续翻页（每页 200，最多 10 页），保证时间线没有缺口；
     * 太远时直接取 seq 前后一页。
     */
    suspend fun reveal(
        expected: OwnerRecord,
        conversationId: String,
        seq: Long,
        earliest: Long?,
    ) {
        if (earliest != null && earliest <= seq) return
        var before = earliest ?: (seq + REVEAL_AROUND)
        var pages = 0
        while (before > seq && before > 1 && pages < REVEAL_PAGES) {
            val current = runner(expected) ?: return
            val page =
                repository.call(
                    Endpoints.chatEndpointsListMessages,
                    params = mapOf("conversationId" to conversationId),
                    query = mapOf("beforeSeq" to before.toString(), "limit" to REVEAL_PAGE_SIZE.toString()),
                    options = SessionCallOptions(networkOnly = true, owner = expected),
                )
            if (runner(expected) !== current) return
            current.history(conversationId, before, page)
            before = page.items.minOfOrNull { it.seq } ?: return
            pages++
        }
        if (before > seq && before > 1) {
            val current = runner(expected) ?: return
            val around = seq + REVEAL_AROUND
            val page =
                repository.call(
                    Endpoints.chatEndpointsListMessages,
                    params = mapOf("conversationId" to conversationId),
                    query = mapOf("beforeSeq" to around.toString(), "limit" to (REVEAL_AROUND * 2).toString()),
                    options = SessionCallOptions(networkOnly = true, owner = expected),
                )
            if (runner(expected) === current) current.history(conversationId, around, page)
        }
    }

    suspend fun clear(
        expected: OwnerRecord,
        conversationId: String,
    ) {
        val current = ready(expected)
        scope
            .async {
                val confirmed =
                    repository.call(
                        Endpoints.chatEndpointsClearHistory,
                        params = mapOf("conversationId" to conversationId),
                        options = SessionCallOptions(networkOnly = true, owner = expected),
                    )
                verify(expected, current)
                current.clearHistory(conversationId, confirmed.clearedThroughSeq)
                verify(expected, current)
            }.await()
    }

    /** A no-content mutation completes only after its committed server updates are durable locally. */
    suspend fun synchronize(expected: OwnerRecord) {
        val current = ready(expected)
        val sequence = refresh(expected) ?: throw ApiFailure("sync_not_ready", 0)
        withTimeout(10_000) {
            combine(current.state, repository.auth) { state, auth ->
                auth?.user?.userId != expected.userId || auth.session.sessionId != expected.sessionId ||
                    (state.initialized && state.lastUpdateSeq >= sequence)
            }.first { it }
        }
        verify(expected, current)
    }

    private suspend fun ready(expected: OwnerRecord): SyncRunner =
        runner(expected)?.takeIf { it.active } ?: throw ApiFailure("sync_not_ready", 0)

    private suspend fun verify(
        expected: OwnerRecord,
        current: SyncRunner,
    ) {
        val auth = repository.auth.value
        val matching = auth?.user?.userId == expected.userId && auth.session.sessionId == expected.sessionId
        if (!matching || runner(expected) !== current || !current.active) throw ApiFailure("session_changed", 0)
    }
}

private const val REVEAL_PAGE_SIZE = 200
private const val REVEAL_PAGES = 10
private const val REVEAL_AROUND = 25L
