package app.weiban.data

import app.weiban.network.ContractJson
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive

internal const val ONBOARDING_DRAFT_KEY = "ui:onboardingDraft"

/** Local UI state, not a second network contract. */
@Serializable
data class OnboardingDraft(
    val characterId: String,
    val greeting: String = "",
) {
    init {
        ContractJson.normalize("Id", JsonPrimitive(characterId))
        require(greeting.length <= 50)
    }
}

class OnboardingDraftStore internal constructor(
    private val database: LocalDatabase,
    private val json: Json,
    private val lock: Mutex,
    private val pendingOwner: suspend (OwnerRecord) -> Boolean,
) {
    suspend fun load(owner: OwnerRecord): OnboardingDraft? =
        lock.withLock {
            if (!pendingOwner(owner)) return@withLock null
            val saved = database.local().cache(ONBOARDING_DRAFT_KEY) ?: return@withLock null
            if (saved == "null") return@withLock null
            try {
                json.decodeFromString(OnboardingDraft.serializer(), saved)
            } catch (_: SerializationException) {
                null
            } catch (_: IllegalArgumentException) {
                null
            }
        }

    suspend fun save(
        owner: OwnerRecord,
        draft: OnboardingDraft?,
    ): Boolean =
        lock.withLock {
            if (!pendingOwner(owner)) return@withLock false
            val value = draft?.let { json.encodeToString(OnboardingDraft.serializer(), it) } ?: "null"
            database.local().cache(CacheRecord(ONBOARDING_DRAFT_KEY, value))
            true
        }
}
