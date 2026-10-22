package app.weiban.data

import android.content.Context
import android.os.Build
import android.util.AtomicFile
import app.weiban.contracts.*
import app.weiban.network.ApiClient
import app.weiban.network.ApiFailureRecord
import app.weiban.network.ContractJson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import java.io.File
import java.time.Instant
import java.util.Locale
import java.util.UUID

@Serializable
private data class SavedRuntimeLogs(
    val owner: String?,
    val events: List<ClientRuntimeEvent>,
)

/** Only fixed technical classifications and app source coordinates. Never serialize a Throwable. */
class ClientRuntimeLogs(
    context: Context,
    private val api: ApiClient,
    private val scope: CoroutineScope,
    versionName: String,
    versionCode: Long,
) {
    private val lock = Any()
    private val file = AtomicFile(File(context.filesDir, "runtime-logs.json"))
    private val preferences = context.getSharedPreferences("runtime-log-rate", Context.MODE_PRIVATE)
    private val version = versionName.takeIf { Regex("\\d{1,4}\\.\\d{1,4}\\.\\d{1,4}").matches(it) } ?: "dev"
    private val build = versionCode.toString().takeIf { it.length <= 12 } ?: "unknown"
    private var owner: String? = null
    private var bound = false
    private var generation = 0
    private var session = UUID.randomUUID().toString()
    private var page = "/"
    private var queue = mutableListOf<ClientRuntimeEvent>()
    private val recent = mutableListOf<ClientRuntimeEvent>()
    private val known = mutableMapOf<String, ClientRuntimeEvent>()
    private var saved =
        runCatching {
            val raw = api.json.parseToJsonElement(file.readFully().toString(Charsets.UTF_8)).jsonObject
            val events =
                raw["events"]?.jsonArray.orEmpty().takeLast(200).mapNotNull { value ->
                    runCatching {
                        api.json.decodeFromJsonElement(ClientRuntimeEvent.serializer(), ContractJson.normalize("ClientRuntimeEvent", value))
                    }.getOrNull()
                }
            SavedRuntimeLogs(raw["owner"]?.jsonPrimitive?.contentOrNull, events)
        }.getOrNull()
    private var sending = false
    private var sentSession = false
    private val environment =
        ClientLogEnvironment(
            os = "android",
            browser = "native",
            major =
                Build.VERSION.SDK_INT
                    .toLong()
                    .coerceIn(0, 999),
            screen =
                when {
                    context.resources.configuration.screenWidthDp < 480 -> "small"
                    context.resources.configuration.screenWidthDp < 1024 -> "medium"
                    else -> "large"
                },
            language =
                when (Locale.getDefault().language) {
                    "zh" -> "zh"
                    "en" -> "en"
                    else -> "other"
                },
            network = "unknown",
        )

    init {
        api.onOwnerChanged = ::bind
        api.onFailure = ::apiFailure
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching {
                synchronized(lock) {
                    if (!bound) {
                        bound = true
                        owner = null
                        queue.clear()
                        saved = null
                    }
                    record("app_crash", "app_crash", error = error, synchronous = true)
                }
            }
            previous?.uncaughtException(thread, error)
                ?: run {
                    android.os.Process.killProcess(android.os.Process.myPid())
                    kotlin.system.exitProcess(10)
                }
        }
        scope.launch {
            while (true) {
                delay(30000)
                flush()
            }
        }
    }

    fun bind(userId: String?) =
        synchronized(lock) {
            if (bound && owner == userId) return@synchronized
            generation++
            owner = userId
            bound = true
            session = UUID.randomUUID().toString()
            sentSession = false
            page = if (userId == null) "/login" else "/me"
            queue = (saved?.takeIf { it.owner == userId }?.events ?: emptyList()).toMutableList()
            saved = null
            recent.clear()
            known.clear()
            persist()
            scope.launch { flush() }
        }

    fun page(route: String) = synchronized(lock) { page = this.route(route) }

    fun pushFailure() = record("push_issue", "push_failed")

    private fun apiFailure(event: ApiFailureRecord) {
        val requestId = event.requestId?.takeIf { runCatching { UUID.fromString(it).toString() == it.lowercase() }.getOrDefault(false) }
        record(
            "api_failure",
            when {
                event.timeout -> "timeout"
                event.status >= 500 -> "server_error"
                else -> "network_error"
            },
            apiEvent = ClientRuntimeEventApi(route(event.route), event.method, event.status.toLong(), event.durationMs, requestId),
        )
    }

    private fun record(
        kind: String,
        code: String,
        error: Throwable? = null,
        apiEvent: ClientRuntimeEventApi? = null,
        synchronous: Boolean = false,
    ) = synchronized(lock) {
        if (!bound) return@synchronized
        val now = System.currentTimeMillis()
        var start = preferences.getLong("start", now)
        var count = preferences.getInt("count", 0)
        if (now - start >= 3600000 || now < start) {
            start = now
            count = 0
        }
        if (count >= 50) return@synchronized
        preferences
            .edit()
            .putLong("start", start)
            .putInt("count", count + 1)
            .apply()
        val frames = safeFrames(error)
        val key = listOf(kind, code, page, apiEvent?.route, apiEvent?.method, apiEvent?.status, frames).joinToString("|")
        val before = known[key]
        val event =
            before?.copy(count = (before.count + 1).coerceAtMost(10000)) ?: ClientRuntimeEvent(
                clientEventId = UUID.randomUUID().toString(),
                sessionId = session,
                occurredAt = Instant.ofEpochMilli(now).toString(),
                kind = kind,
                appKind = "android",
                version = version,
                build = build,
                page = page,
                code = code,
                frames = frames,
                environment = environment,
                count = 1,
                api = apiEvent,
            )
        known[key] = event
        queue.removeAll { it.clientEventId == event.clientEventId }
        queue.add(event)
        while (queue.size > 200) queue.removeAt(0)
        recent.removeAll { it.clientEventId == event.clientEventId }
        recent.add(event)
        while (recent.size > 20) recent.removeAt(0)
        if (synchronous) {
            persist()
        } else {
            val captured = generation
            scope.launch {
                synchronized(lock) { if (captured == generation) persist() }
                if (queue.size >= 20) flush()
            }
        }
    }

    fun snapshot(): JsonArray =
        synchronized(lock) {
            JsonArray(recent.map { api.json.encodeToJsonElement(ClientRuntimeEvent.serializer(), it) })
        }

    private fun safeFrames(error: Throwable?): List<ClientLogFrame> =
        error
            ?.stackTrace
            .orEmpty()
            .filter { it.className.startsWith("app.weiban.") }
            .take(20)
            .map {
                ClientLogFrame(
                    "app.kt",
                    it.lineNumber.toLong().coerceIn(0, 10000000),
                    0,
                    it.className
                        .hashCode()
                        .toUInt()
                        .toString(16)
                        .padStart(8, '0'),
                )
            }

    @Suppress("TooGenericExceptionCaught") // AtomicFile must abort every failed write before the failure is contained.
    private fun persist() {
        val bytes = api.json.encodeToString(SavedRuntimeLogs.serializer(), SavedRuntimeLogs(owner, queue.toList())).toByteArray()
        runCatching {
            val stream = file.startWrite()
            try {
                stream.write(bytes)
                file.finishWrite(stream)
            } catch (error: Exception) {
                file.failWrite(stream)
                throw error
            }
        }
    }

    suspend fun flush() {
        val work =
            synchronized(lock) {
                if (!readyToSend()) return
                val batch = pendingBatch()
                sending = true
                Triple(generation, owner, batch)
            }
        try {
            val auth = api.current()
            if (auth?.user?.userId != work.second) return
            val endpoint = if (work.second == null) Endpoints.clientLogEndpointsReportAnonymous else Endpoints.clientLogEndpointsReport
            api.call(endpoint, api.json.encodeToJsonElement(ClientLogBatch.serializer(), work.third), expectedSession = auth)
            synchronized(lock) {
                if (generation != work.first) return@synchronized
                val sent = work.third.events.associate { it.clientEventId to it.count }
                queue.removeAll { sent[it.clientEventId] == it.count }
                if (work.third.sessionId == session) sentSession = true
                persist()
            }
        } catch (
            _: java.io.IOException,
        ) {
            // queued until connectivity returns
        } catch (
            _: IllegalArgumentException,
        ) {
            // malformed local record cannot break the app
        } finally {
            synchronized(lock) { sending = false }
        }
    }

    private fun readyToSend(): Boolean {
        if (!bound || sending) return false
        return queue.isNotEmpty() || !sentSession
    }

    // Called while holding lock, so old-session replay stays partitioned through serialization.
    private fun pendingBatch(): ClientLogBatch {
        val first = queue.firstOrNull()
        val batchSession = first?.sessionId ?: session
        val batchVersion = first?.version ?: version
        val batchBuild = first?.build ?: build
        val events =
            queue
                .filter { it.sessionId == batchSession && it.version == batchVersion && it.build == batchBuild }
                .take(
                    20,
                ).toMutableList()
        var batch = ClientLogBatch(batchSession, "android", batchVersion, batchBuild, events.toList())
        while (api.json
                .encodeToString(ClientLogBatch.serializer(), batch)
                .toByteArray()
                .size > 30000
        ) {
            events.removeAt(events.lastIndex)
            batch = batch.copy(events = events.toList())
        }
        return batch
    }

    private val allowedRouteSegments =
        setOf(
            "api",
            "v1",
            "me",
            "admin",
            "auth",
            "login",
            "register",
            "chat",
            "contacts",
            "discover",
            "settings",
            "privacy",
            "profile",
            "support",
            "tickets",
            "messages",
            "conversations",
            "characters",
            "models",
            "billing",
            "calls",
            "media",
            "push",
            "devices",
            "sync",
            "updates",
            "moments",
            "posts",
            "comments",
            "likes",
            "memories",
            "episodes",
            "timeline",
            "assets",
            "pets",
            "library",
            "plaza",
            "play",
            "health",
            "growth",
            "avatar",
            "cover",
            "status",
            "notifications",
            "token",
            "sessions",
            "logout",
            "refresh",
            "password",
            "email",
            "phone",
            "verify",
            "read",
            "replies",
            "seen",
        )

    private fun route(value: String): String =
        "/" +
            value.substringBefore('?').substringBefore('#').split('/').filter { it.isNotEmpty() }.take(12).joinToString("/") {
                if (it in
                    allowedRouteSegments
                ) {
                    it
                } else {
                    ":id"
                }
            }
}
