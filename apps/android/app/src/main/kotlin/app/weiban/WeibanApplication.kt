package app.weiban

import android.app.Application
import androidx.room.Room
import app.weiban.data.*
import app.weiban.network.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

class WeibanApplication : Application() {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    val database by lazy { Room.databaseBuilder(this, LocalDatabase::class.java, "weiban-local.db").build() }
    val api by lazy { ApiClient(BuildConfig.API_BASE_URL) }
    val repository by lazy { SessionRepository(api, database, TokenVault(this, api.json)) }
    val chat by lazy { ChatRuntime(repository, scope) }

    override fun onCreate() {
        super.onCreate()
        scope.launch {
            repository.auth.collectLatest { auth ->
                if (auth == null) chat.detach() else chat.attach(OwnerRecord(userId = auth.user.userId, sessionId = auth.session.sessionId))
            }
        }
    }
}
