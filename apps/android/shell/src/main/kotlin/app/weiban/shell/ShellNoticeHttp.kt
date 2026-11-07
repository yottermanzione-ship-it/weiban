package app.weiban.shell

import app.weiban.contracts.AuthResponse
import app.weiban.contracts.NotificationEnvelope
import app.weiban.contracts.PushDevice
import app.weiban.network.ContractJson
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

internal class NoticeHttpFailure(
    val status: Int,
) : Exception("notification request failed")

internal class ShellNoticeHttp(
    private val origin: String = ShellPolicy.ORIGIN,
) {
    private val client =
        OkHttpClient
            .Builder()
            .callTimeout(12, TimeUnit.SECONDS)
            .followRedirects(false)
            .followSslRedirects(false)
            .build()

    fun register(
        auth: AuthResponse,
        installation: String,
    ): String {
        val raw =
            request(
                auth,
                "/api/v1/push/devices",
                "POST",
                JSONObject().put("kind", "android").put("provider", "local_poll").put("token", installation),
            )
        val device =
            noticeJson.decodeFromJsonElement(
                PushDevice.serializer(),
                ContractJson.normalize("PushDevice", noticeJson.parseToJsonElement(raw)),
            )
        require(device.sessionId == auth.session.sessionId && device.kind == "android")
        return device.pushDeviceId
    }

    fun poll(state: ShellNoticeState): List<NotificationEnvelope> {
        val items = JSONObject(request(state.auth, "/api/v1/push/local/${state.deviceId}")).getJSONArray("items")
        require(items.length() <= 32)
        return (0 until items.length()).map { index ->
            val raw = items.getJSONObject(index).toString()
            require(raw.toByteArray().size <= 8192)
            noticeJson.decodeFromJsonElement(
                NotificationEnvelope.serializer(),
                ContractJson.normalize("NotificationEnvelope", noticeJson.parseToJsonElement(raw)),
            )
        }
    }

    fun acknowledge(
        state: ShellNoticeState,
        ids: List<String>,
    ) {
        request(state.auth, "/api/v1/push/local/${state.deviceId}/ack", "POST", JSONObject().put("notificationIds", JSONArray(ids)))
    }

    fun unregister(state: ShellNoticeState) {
        request(state.auth, "/api/v1/push/devices/${state.deviceId}", "DELETE")
    }

    private fun request(
        auth: AuthResponse,
        path: String,
        method: String = "GET",
        body: JSONObject? = null,
    ): String {
        val request =
            Request
                .Builder()
                .url(origin + path)
                .header("Authorization", "Bearer ${auth.session.token}")
                .method(
                    method,
                    if (method ==
                        "POST"
                    ) {
                        (body?.toString() ?: "{}").toRequestBody("application/json".toMediaType())
                    } else {
                        null
                    },
                ).build()
        return client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw NoticeHttpFailure(response.code)
            val source = response.body?.source() ?: return@use ""
            source.request(262145)
            require(source.buffer.size <= 262144)
            source.readUtf8()
        }
    }
}
