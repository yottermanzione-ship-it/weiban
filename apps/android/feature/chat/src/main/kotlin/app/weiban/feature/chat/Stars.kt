package app.weiban.feature.chat

import androidx.compose.runtime.*
import app.weiban.data.OwnerRecord
import app.weiban.data.SessionRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * 星标朋友（规格 4.6、4.12）：契约里没有字段，与网页一样先存本机（按账号，不跨设备）。
 */
internal object StarStore {
    private const val KEY = "contacts:stars"
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var repository: SessionRepository? = null
    private var owner: OwnerRecord? = null

    var ids by mutableStateOf<Set<String>>(emptySet())
        private set

    suspend fun load(
        repository: SessionRepository,
        owner: OwnerRecord,
    ) {
        if (this.owner == owner) return
        this.repository = repository
        this.owner = owner
        ids = emptySet()
        userAction({}) {
            ids =
                repository.flags
                    .get(owner, KEY)
                    ?.split(',')
                    ?.filter(String::isNotBlank)
                    ?.toSet()
                    .orEmpty()
        }
    }

    fun toggle(characterId: String) {
        ids = if (characterId in ids) ids - characterId else ids + characterId
        val repo = repository ?: return
        val who = owner ?: return
        val value = ids.joinToString(",")
        scope.launch { userAction({}) { repo.flags.set(who, KEY, value) } }
    }
}

@Composable internal fun rememberStars(
    repository: SessionRepository,
    owner: OwnerRecord,
): Set<String> {
    LaunchedEffect(owner) { StarStore.load(repository, owner) }
    return StarStore.ids
}
