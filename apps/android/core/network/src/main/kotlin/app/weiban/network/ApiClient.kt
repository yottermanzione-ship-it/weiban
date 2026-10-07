package app.weiban.network

import app.weiban.contracts.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

class ApiFailure(
    val code: String,
    val status: Int,
) : IOException(code)

/** No credentials in logs, URLs or a logging interceptor. Every reply belongs to one auth object. */
class ApiClient(
    baseUrl: String,
    val json: Json = Json { ignoreUnknownKeys = true },
    private val client: OkHttpClient =
        OkHttpClient
            .Builder()
            .followRedirects(false)
            .followSslRedirects(false)
            .retryOnConnectionFailure(false)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .build(),
) {
    private val root =
        baseUrl.toHttpUrl().also {
            require(it.username.isEmpty() && it.password.isEmpty() && it.query == null && it.fragment == null)
            require(it.isHttps || it.host in setOf("localhost", "127.0.0.1", "10.0.2.2"))
        }
    private val session = AtomicReference<AuthResponse?>(null)

    fun authenticate(auth: AuthResponse?) {
        session.set(auth)
    }

    fun current(): AuthResponse? = session.get()

    suspend fun <T> call(
        endpoint: ContractEndpoint<T>,
        body: JsonElement? = null,
        params: Map<String, String> = emptyMap(),
        query: Map<String, String> = emptyMap(),
        idempotencyKey: String? = null,
        multipart: okhttp3.MultipartBody? = null,
    ): T =
        withContext(Dispatchers.IO) {
            val auth = session.get()
            if (endpoint.auth != "none" && auth == null) throw ApiFailure("unauthenticated", 401)
            val request = request(endpoint, auth, body, params, query, idempotencyKey, multipart)
            client.newCall(request).awaitDecoded { response ->
                if (session.get() !== auth) throw ApiFailure("session_changed", 0)
                val bytes = response.body?.byteStream()?.use { it.readBounded(4_194_305) } ?: byteArrayOf()
                if (bytes.size > 4_194_304) throw ApiFailure("invalid_response", 0)
                if (!response.isSuccessful) {
                    val error =
                        runCatching {
                            val raw = json.parseToJsonElement(bytes.toString(Charsets.UTF_8))
                            json.decodeFromJsonElement(ApiError.serializer(), ContractJson.normalize("ApiError", raw))
                        }.getOrNull()
                    if (error?.error?.code == "unauthenticated" && endpoint.auth != "none") session.compareAndSet(auth, null)
                    throw ApiFailure(error?.error?.code ?: "unsupported", response.code)
                }
                decode(endpoint, bytes, auth)
            }
        }

    private fun <T> request(
        endpoint: ContractEndpoint<T>,
        auth: AuthResponse?,
        body: JsonElement?,
        params: Map<String, String>,
        query: Map<String, String>,
        idempotencyKey: String?,
        multipart: okhttp3.MultipartBody?,
    ): Request {
        var path = endpoint.path
        for ((key, value) in params) {
            val encoded =
                HttpUrl
                    .Builder()
                    .scheme("https")
                    .host("localhost")
                    .addPathSegment(value)
                    .build()
                    .encodedPath
                    .removePrefix("/")
            path = path.replace(":$key", encoded)
        }
        require(!Regex(":\\w+").containsMatchIn(path))
        val url = root.resolve(path)!!.newBuilder()
        for ((key, value) in query) url.addQueryParameter(key, value)
        val request = Request.Builder().url(url.build()).header("Accept", "application/json")
        if (endpoint.auth != "none") request.header("Authorization", "Bearer ${auth!!.session.token}")
        if (idempotencyKey != null) request.header("Idempotency-Key", idempotencyKey)
        val bodySchema = endpoint.bodySchema
        val normalizedBody = if (body != null && bodySchema != null) ContractJson.normalize(bodySchema, body) else body
        val payload = multipart ?: normalizedBody?.toString()?.toRequestBody("application/json; charset=utf-8".toMediaType())
        request.method(
            endpoint.method,
            payload
                ?: if (endpoint.method in setOf("POST", "PATCH", "PUT")) "{}".toRequestBody("application/json".toMediaType()) else null,
        )
        return request.build()
    }

    private fun <T> decode(
        endpoint: ContractEndpoint<T>,
        bytes: ByteArray,
        auth: AuthResponse?,
    ): T =
        try {
            val raw = json.parseToJsonElement(bytes.toString(Charsets.UTF_8).ifEmpty { "null" })
            val value = json.decodeFromJsonElement(endpoint.response, ContractJson.normalize(endpoint.responseSchema, raw))
            if (session.get() !== auth) throw ApiFailure("session_changed", 0)
            value
        } catch (error: ApiFailure) {
            throw error
        } catch (_: IllegalArgumentException) {
            throw ApiFailure("invalid_response", 0)
        }

    /** A media grant is bound to this API origin and path; never attach the bearer to its URL. */
    suspend fun download(media: MediaObject): ByteArray =
        withContext(Dispatchers.IO) {
            val auth = session.get() ?: throw ApiFailure("unauthenticated", 401)
            val url = grantUrl(media)
            client
                .newCall(
                    Request
                        .Builder()
                        .url(url)
                        .header("Accept", "image/webp")
                        .build(),
                ).awaitDecoded { response ->
                    if (session.get() !== auth) throw ApiFailure("session_changed", 0)
                    if (!response.isSuccessful) throw ApiFailure("media_unavailable", response.code)
                    if (response.header("Content-Type")?.substringBefore(';') != "image/webp") throw ApiFailure("invalid_response", 0)
                    val bytes = response.body?.byteStream()?.use { it.readBounded(10_485_761) } ?: byteArrayOf()
                    if (bytes.isEmpty() || bytes.size > 10_485_760) throw ApiFailure("invalid_response", 0)
                    if (session.get() !== auth) throw ApiFailure("session_changed", 0)
                    bytes
                }
        }

    private fun grantUrl(media: MediaObject): HttpUrl {
        val url = media.url.toHttpUrl()
        val expected = root.resolve("/api/v1/media/${media.mediaId}/content")!!
        require(url.scheme == expected.scheme && url.host == expected.host && url.port == expected.port)
        require(url.encodedPath == expected.encodedPath && url.username.isEmpty() && url.password.isEmpty() && url.fragment == null)
        require(url.queryParameterNames == setOf("token") && url.queryParameterValues("token").size == 1)
        require(url.queryParameter("token").orEmpty().length in 1..1000)
        return url
    }
}
