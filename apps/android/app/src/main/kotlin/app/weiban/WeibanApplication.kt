package app.weiban

import android.app.Application
import androidx.room.Room
import app.weiban.data.*
import app.weiban.network.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

class WeibanApplication : Application() {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    val database by lazy { Room.databaseBuilder(this, LocalDatabase::class.java, "weiban-local.db").build() }
    val api by lazy { ApiClient(BuildConfig.API_BASE_URL) }
    val repository by lazy { SessionRepository(api, database, TokenVault(this, api.json)) }
}
