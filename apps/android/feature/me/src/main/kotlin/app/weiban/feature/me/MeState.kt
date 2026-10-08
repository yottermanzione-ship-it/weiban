package app.weiban.feature.me

import androidx.compose.runtime.*
import app.weiban.contracts.*
import app.weiban.data.OwnerRecord
import app.weiban.data.SessionCallOptions
import app.weiban.data.SessionRepository
import app.weiban.network.ApiFailure
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

internal class MeState(
    val repository: SessionRepository,
    val owner: OwnerRecord,
    val firstProfile: Boolean,
    val onTheme: (String) -> Unit,
    private val scope: CoroutineScope,
) {
    var page by mutableStateOf(if (firstProfile) "profile" else "me")
    var profile by mutableStateOf<Profile?>(null)
    var wallet by mutableStateOf<Wallet?>(null)
    var ledger by mutableStateOf<List<LedgerEntry>>(emptyList())
    var cursor by mutableStateOf<String?>(null)
    var models by mutableStateOf<List<ModelInfo>>(emptyList())
    var selection by mutableStateOf<ModelSelection?>(null)
    var notificationSettings by mutableStateOf<NotificationSettings?>(null)
    var nickname by mutableStateOf("")
    var city by mutableStateOf("")
    var about by mutableStateOf("")
    var birthday by mutableStateOf("")
    var gender by mutableStateOf("unspecified")
    var threshold by mutableStateOf("")
    var daily by mutableStateOf("")
    var message by mutableStateOf<String?>(null)
    var busy by mutableStateOf(false)
    private var operations = 0

    suspend fun <T> call(
        endpoint: ContractEndpoint<T>,
        body: JsonElement? = null,
        query: Map<String, String> = emptyMap(),
    ): T {
        val result =
            repository.call(
                endpoint,
                body,
                query = query,
                options =
                    SessionCallOptions(
                        owner = owner,
                        networkOnly =
                            endpoint.id == Endpoints.identityEndpointsGetNotificationSettings.id,
                    ),
            )
        val current = repository.auth.value
        if (current?.user?.userId != owner.userId || current.session.sessionId != owner.sessionId) throw ApiFailure("session_changed", 0)
        return result
    }

    suspend fun load() {
        val p = call(Endpoints.identityEndpointsGetProfile)
        profile = p
        nickname = p.nickname.orEmpty()
        city = p.city.orEmpty()
        about =
            p.about.orEmpty()
        birthday = p.birthday.orEmpty()
        gender = p.gender
        val w = call(Endpoints.billingEndpointsGetWallet)
        wallet = w
        threshold = yuan(w.lowBalanceThresholdMicros)
        daily =
            yuan(w.backgroundBudget.dailyLimitMicros)
        val prefs = call(Endpoints.identityEndpointsGetPreferences)
        onTheme(prefs.theme)
    }

    fun openPage(next: String) {
        page = next
        when (next) {
            "wallet" ->
                perform {
                    val result = call(Endpoints.billingEndpointsListLedger)
                    ledger = result.items
                    cursor = result.nextCursor
                }
            "models" ->
                perform {
                    models = call(Endpoints.modelAccessEndpointsListModels).items
                    selection = call(Endpoints.modelAccessEndpointsGetSelection)
                }
            "notifications" -> perform { notificationSettings = call(Endpoints.identityEndpointsGetNotificationSettings) }
        }
    }

    @Suppress("TooGenericExceptionCaught") // Present a generic user message for service/storage failures.
    fun perform(work: suspend () -> Unit) {
        operations++
        busy = true
        message = null
        scope.launch {
            try {
                work()
            } catch (_: IllegalArgumentException) {
                message =
                    "请检查填写的内容"
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                message = "暂时无法完成，请稍后重试"
            } finally {
                operations--
                busy = operations > 0
            }
        }
    }
}
