package app.weiban.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import app.weiban.contracts.AuthResponse
import app.weiban.network.ApiClient
import app.weiban.network.SessionVault
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 26])
class LegacyStorageBoundaryTest {
    @Test fun nativeSessionRestoreAndLogoutDoNotDeleteOrImportLegacyFlutterStores() =
        runBlocking {
            val context = ApplicationProvider.getApplicationContext<Context>()
            val messages = context.getDatabasePath("weiban_messages.db")
            val personas = context.getDatabasePath("weiban_persona.db")
            messages.parentFile!!.mkdirs()
            val marker = "legacy-storage-fixture-not-user-data".toByteArray()
            messages.writeBytes(marker)
            personas.writeBytes(marker)
            val preferences = context.getSharedPreferences("FlutterSharedPreferences", Context.MODE_PRIVATE)
            preferences.edit().putString("flutter.legacy_test_marker", "preserved").commit()
            val database = Room.inMemoryDatabaseBuilder(context, LocalDatabase::class.java).build()
            val vault =
                object : SessionVault {
                    override fun load(): AuthResponse? = null

                    override fun save(auth: AuthResponse) = Unit

                    override fun clear() = Unit
                }
            try {
                val repository = SessionRepository(ApiClient("http://127.0.0.1:1"), database, vault)
                repository.restore()
                repository.forget()
                assertNull(repository.auth.value)
                assertArrayEquals(marker, messages.readBytes())
                assertArrayEquals(marker, personas.readBytes())
                assertEquals("preserved", preferences.getString("flutter.legacy_test_marker", null))
            } finally {
                database.close()
                context.deleteDatabase("weiban_messages.db")
                context.deleteDatabase("weiban_persona.db")
                preferences.edit().clear().commit()
            }
        }
}
