package app.weiban

import android.app.Application
import androidx.room.Room
import app.weiban.data.*
import app.weiban.network.*
import app.weiban.platform.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class WeibanApplication :
    Application(),
    NativePushHost {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    val database by lazy { Room.databaseBuilder(this, LocalDatabase::class.java, "weiban-local.db").build() }
    val api by lazy { ApiClient(BuildConfig.API_BASE_URL) }
    val repository by lazy { SessionRepository(api, database, TokenVault(this, api.json)) }
    val chat by lazy { ChatRuntime(repository, scope) { ChatWork.enqueue(this, it) } }
    private val transport by lazy {
        FirebasePushTransport(
            this,
            FirebasePushConfig(BuildConfig.FCM_APP_ID, BuildConfig.FCM_SENDER_ID, BuildConfig.FCM_PROJECT_ID, BuildConfig.FCM_API_KEY),
        )
    }
    override val push by lazy { NativePushRuntime(this, repository, transport, MainActivity::class.java) }

    override suspend fun prepareNativePush() = initialize()

    private val initialization = Mutex()
    private var restored = false

    suspend fun initialize() =
        initialization.withLock {
            if (!restored) {
                repository.restore()
                restored = true
            }
        }

    override fun onCreate() {
        super.onCreate()
        transport.initialize()
        scope.launch {
            var previous: OwnerRecord? = null
            repository.auth.collectLatest { auth ->
                val next = auth?.let { OwnerRecord(userId = it.user.userId, sessionId = it.session.sessionId) }
                val changed = previous != next
                if (changed) {
                    previous?.let {
                        ChatWork.cancel(this@WeibanApplication, it)
                        push.detach(it)
                    }
                }
                previous = next
                if (next == null) {
                    chat.detach()
                } else {
                    chat.attach(next)
                    if (changed) push.rebind()
                    if (changed &&
                        chat.snapshot.value.state.outbox
                            .isNotEmpty()
                    ) {
                        ChatWork.enqueue(this@WeibanApplication, next)
                    }
                }
            }
        }
    }
}
