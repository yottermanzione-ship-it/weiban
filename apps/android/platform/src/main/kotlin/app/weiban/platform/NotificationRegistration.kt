package app.weiban.platform

import app.weiban.contracts.Endpoints
import app.weiban.data.OwnerRecord
import app.weiban.data.SessionCallOptions
import app.weiban.data.SessionRepository
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

internal class NotificationRegistration(
    private val repository: SessionRepository,
    private val transport: PushTransport,
    private val notices: NativeNotices,
) {
    private val lock = Mutex()

    suspend fun bind(owner: OwnerRecord) =
        lock.withLock {
            if (!transport.available || !notices.permitted() || !repository.notifications.enabled(owner)) return@withLock
            val token = transport.token()
            if (!repository.notifications.enabled(owner) || !notices.permitted()) return@withLock
            val result =
                repository.call(
                    Endpoints.pushEndpointsRegisterDevice,
                    buildJsonObject {
                        put("kind", "android")
                        put("provider", transport.provider)
                        put("token", token)
                    },
                    options = SessionCallOptions(owner = owner, networkOnly = true),
                )
            repository.notifications.saveDevice(owner, result.pushDeviceId)
        }

    suspend fun disable(owner: OwnerRecord) {
        // Shut the local display gate before waiting for a token request or network deletion.
        if (!repository.notifications.setEnabled(owner, false)) return
        notices.cancel(owner)
        lock.withLock {
            val device = repository.notifications.deviceId(owner)
            if (device != null) {
                repository.call(
                    Endpoints.pushEndpointsUnregisterDevice,
                    params = mapOf("pushDeviceId" to device),
                    options = SessionCallOptions(owner = owner, networkOnly = true),
                )
                repository.notifications.saveDevice(owner, null)
            }
            if (owned(owner)) transport.stop()
        }
    }

    private fun owned(owner: OwnerRecord): Boolean {
        val auth = repository.auth.value
        return auth?.user?.userId == owner.userId && auth.session.sessionId == owner.sessionId
    }
}
