package app.weiban.testvectors

import app.weiban.contracts.*
import app.weiban.data.SyncEngine
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class HistoryTest {
    private val json = Json { ignoreUnknownKeys = true }
    private val source = File("../../../../packages/contracts/test-vectors/recall-before-history.json").readText()
    private val vector = json.decodeFromString(ProtocolVector.serializer(), source)
    private val cid =
        vector.initialState.conversations
            .first()
            .conversationId
    private val original: Message =
        json.decodeFromJsonElement(
            Message.serializer(),
            json
                .parseToJsonElement(source)
                .jsonObject
                .getValue("steps")
                .jsonArray[2]
                .jsonObject
                .getValue("operation")
                .jsonObject
                .getValue("update")
                .jsonObject
                .getValue("data")
                .jsonObject
                .getValue("message"),
        )

    @Test fun olderHistoryCannotResurrectRecalledContent() {
        val engine = SyncEngine(vector.initialState)
        engine.apply(vector.steps.first().operation)
        engine.history(cid, 3, MessagePage(items = listOf(original), hasMore = false))
        assertEquals(
            "recalled",
            engine.state.messages
                .first()
                .status,
        )
        assertNull(
            engine.state.messages
                .first()
                .content,
        )
        val before = engine.state
        assertTrue(runCatching { engine.history(cid, 1, MessagePage(items = listOf(original), hasMore = false)) }.isFailure)
        assertEquals(before, engine.state)
    }

    @Test fun negativeHistoryCoverageRemovesCachedContent() {
        val engine = SyncEngine(vector.initialState)
        engine.history(cid, 3, MessagePage(items = listOf(original), hasMore = false))
        engine.history(
            cid,
            3,
            MessagePage(
                items = emptyList(),
                hasMore = false,
                coverage =
                    MessagePageCoverage(
                        fromSeq = 1,
                        throughSeq = 1,
                        excludedRanges =
                            listOf(
                                MessagePageCoverageExcludedRangesItem(fromSeq = 1, throughSeq = 1, reason = "hidden"),
                            ),
                    ),
            ),
        )
        assertTrue(engine.state.messages.isEmpty())
        assertEquals(1, engine.state.excluded.size)
    }

    @Test fun clearConfirmationKeepsCursorAndSurvivesRestartAndLateHistory() {
        val engine = SyncEngine(vector.initialState)
        engine.history(cid, 3, MessagePage(listOf(original), false))
        engine.clearHistory(cid, 1)
        assertEquals(0L, engine.state.lastUpdateSeq)
        assertTrue(engine.state.messages.isEmpty())
        val restarted =
            SyncEngine(json.decodeFromString(ClientSyncState.serializer(), json.encodeToString(ClientSyncState.serializer(), engine.state)))
        restarted.history(cid, 3, MessagePage(listOf(original), false))
        assertTrue(restarted.state.messages.isEmpty())
        assertEquals(
            1L,
            restarted.state.conversations
                .first()
                .state.clearedThroughSeq,
        )
        val before = restarted.state
        assertTrue(runCatching { restarted.clearHistory(cid, -1) }.isFailure)
        assertEquals(before, restarted.state)
    }

    @Test fun clearConfirmationCannotBeOverwrittenByEarlierSnapshotOrConversation() {
        val engine = SyncEngine(vector.initialState)
        engine.apply(ClientSyncOperationCursorExpired())
        engine.apply(ClientSyncOperationRebuildState(latestUpdateSeq = 0))
        engine.clearHistory(cid, 1)
        engine.apply(
            ClientSyncOperationSnapshot(
                startSeq = 0,
                snapshot =
                    ClientFullSyncSnapshot(
                        vector.initialState.conversations,
                        listOf(original),
                        emptyList(),
                        emptyMap(),
                        emptyList(),
                    ),
            ),
        )
        assertTrue(engine.state.messages.isEmpty())
        val first = (vector.steps.first().operation as ClientSyncOperationUpdate).update
        engine.apply(
            ClientSyncOperationUpdate(
                update =
                    UserUpdateConversationUpdated(
                        updateSeq = first.updateSeq,
                        occurredAt = first.occurredAt,
                        data = UserUpdateConversationUpdatedData(vector.initialState.conversations.first()),
                    ),
            ),
        )
        assertEquals(
            1L,
            engine.state.conversations
                .first()
                .state.clearedThroughSeq,
        )
        assertNull(
            engine.state.conversations
                .first()
                .lastMessage,
        )
        assertTrue(engine.state.messages.isEmpty())
    }
}
