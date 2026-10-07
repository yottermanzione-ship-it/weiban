package app.weiban.feature.chat

import androidx.compose.runtime.*
import app.weiban.contracts.*
import app.weiban.data.SessionRepository
import app.weiban.network.ApiFailure
import kotlinx.coroutines.*
import java.io.IOException

internal class NativeRemote<T> {
    var data by mutableStateOf<T?>(null)
    var error by mutableStateOf<String?>(null)
    var loading by mutableStateOf(true)
    var revision by mutableIntStateOf(0)

    fun refresh() {
        revision++
    }
}

@Composable internal fun <T> remote(
    key: String,
    request: suspend () -> T,
): NativeRemote<T> {
    // Creating the holder by key also clears the previous role/page before the next effect starts.
    val state = remember(key) { NativeRemote<T>() }
    val action by rememberUpdatedState(request)
    LaunchedEffect(state, state.revision) {
        state.loading = true
        state.error = null
        userAction({ state.error = it }) { state.data = action() }
        state.loading = false
    }
    return state
}

@Composable internal fun characterProfiles(
    repository: SessionRepository,
    ids: List<String>,
): Map<String, CharacterProfile> {
    val owner =
        repository.auth
            .collectAsState()
            .value
            ?.session
            ?.sessionId
    var names by remember(owner) { mutableStateOf<Map<String, CharacterProfile>>(emptyMap()) }
    val wanted = ids.distinct().sorted()
    LaunchedEffect(owner, wanted) {
        for (batch in wanted.chunked(4)) {
            val loaded =
                coroutineScope {
                    batch.map { id -> async { readProfile(repository, id)?.let { id to it } } }.awaitAll().filterNotNull()
                }
            names = names + loaded
        }
    }
    return names
}

@Composable internal fun characterNames(
    repository: SessionRepository,
    ids: List<String>,
): Map<String, String> = characterProfiles(repository, ids).mapValues { it.value.name }

private suspend fun readProfile(
    repository: SessionRepository,
    id: String,
): CharacterProfile? =
    try {
        repository.call(Endpoints.characterEndpointsGetProfile, params = mapOf("characterId" to id))
    } catch (error: CancellationException) {
        throw error
    } catch (_: IOException) {
        null
    }

internal fun contactError(error: ApiFailure): String =
    when (error.code) {
        "contact_limit_reached" -> "通讯录已满 50 个角色，先删除一些再添加吧"
        "character_not_available" -> "这个角色暂时无法添加"
        "contact_exists" -> "已经添加或正在等待通过，请稍后刷新"
        else -> "操作暂未完成，请稍后再试"
    }
