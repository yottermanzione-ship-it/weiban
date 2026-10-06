package app.weiban.testvectors

import app.weiban.contracts.*
import app.weiban.data.SyncEngine
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized
import java.io.File

@RunWith(Parameterized::class)
class ProtocolVectorsTest(
    private val name: String,
    private val source: String,
) {
    companion object {
        @JvmStatic
        @Parameterized.Parameters(name = "{0}")
        fun vectors(): List<Array<String>> {
            val directory = File("../../../../packages/contracts/test-vectors").canonicalFile
            val files = directory.listFiles { f -> f.extension == "json" }?.sortedBy { it.name } ?: error("Shared vectors missing")
            require(files.isNotEmpty())
            return files.map { arrayOf(it.name, it.readText()) }
        }
    }

    @Test fun fullStateAndEffectsMatchSharedExpectation() {
        val json = Json { ignoreUnknownKeys = true }
        val vector = json.decodeFromString(ProtocolVector.serializer(), source)
        var engine = SyncEngine(vector.initialState)
        val effects = mutableListOf<ClientSyncEffect>()
        for (step in vector.steps) {
            val before = engine.state
            if (step.expectError ==
                true
            ) {
                assertTrue(runCatching { engine.apply(step.operation) }.isFailure)
                assertEquals(before, engine.state)
            } else if (step.operation is ClientSyncOperationRestart) {
                engine =
                    SyncEngine(
                        json.decodeFromString(
                            ClientSyncState.serializer(),
                            json.encodeToString(ClientSyncState.serializer(), engine.state),
                        ),
                    )
            } else {
                engine.apply(step.operation)
            }
            step.expectState?.let { assertEquals(it, engine.state) }
            effects += engine.drainEffects()
        }
        assertEquals(
            json.encodeToJsonElement(ClientSyncState.serializer(), vector.expected.state),
            json.encodeToJsonElement(ClientSyncState.serializer(), engine.state),
        )
        assertEquals(vector.expected.effects, effects)
    }
}
