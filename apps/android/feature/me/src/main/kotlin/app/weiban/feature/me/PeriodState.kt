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
import java.time.LocalDate
import java.time.YearMonth

/** 经期日记（PLAY-01）的数据与操作。健康数据一律 networkOnly，不写入本机响应缓存。 */
@Suppress("TooManyFunctions") // 首次本机构建（2026-10-11）：保留既有逻辑，复杂度待重构
internal class PeriodState(
    val repository: SessionRepository,
    val owner: OwnerRecord,
    private val scope: CoroutineScope,
) {
    var acknowledged by mutableStateOf<Boolean?>(null)
    var cycles by mutableStateOf<List<CycleRecord>>(emptyList())
    var prediction by mutableStateOf<PredictionResult?>(null)
    var settings by mutableStateOf<HealthSettings?>(null)
    var authorized by mutableStateOf<Set<String>>(emptySet())
    var symptomTags by mutableStateOf(DEFAULT_SYMPTOMS)
    var loading by mutableStateOf(true)
    var failed by mutableStateOf(false)
    var busy by mutableStateOf(false)
    var message by mutableStateOf<String?>(null)
    var month by mutableStateOf(YearMonth.now())

    suspend fun <T> call(
        endpoint: ContractEndpoint<T>,
        body: JsonElement? = null,
        params: Map<String, String> = emptyMap(),
        query: Map<String, String> = emptyMap(),
    ): T = repository.call(endpoint, body, params, query, options = SessionCallOptions(owner = owner, networkOnly = true))

    suspend fun readAcknowledged() {
        acknowledged = repository.flags.get(owner, NOTICE_FLAG) == "yes"
    }

    fun acknowledge() {
        scope.launch {
            repository.flags.set(owner, NOTICE_FLAG, "yes")
            acknowledged = true
        }
    }

    @Suppress("TooGenericExceptionCaught") // Load failure shows the "加载失败 / 重试" empty state.
    suspend fun load() {
        loading = true
        failed = false
        try {
            val all = mutableListOf<CycleRecord>()
            var cursor: String? = null
            do {
                val page =
                    call(
                        Endpoints.healthEndpointsListCycles,
                        query =
                            buildMap<String, String> {
                                put("limit", "100")
                                cursor?.let { put("cursor", it) }
                            },
                    )
                all.addAll(page.items)
                cursor = page.nextCursor
            } while (cursor != null && all.size < MAX_CYCLES)
            cycles = all.sortedByDescending { it.startDate }
            prediction = call(Endpoints.healthEndpointsGetPrediction)
            settings = call(Endpoints.healthEndpointsGetSettings)
            authorized = call(Endpoints.healthEndpointsGetAuthorization).authorizedCharacterIds.toSet()
            symptomTags = loadTags()
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            failed = true
        } finally {
            loading = false
        }
    }

    @Suppress("TooGenericExceptionCaught") // Tag list is optional; fall back to the design defaults.
    private suspend fun loadTags(): List<String> =
        try {
            call(Endpoints.healthTagEndpointsListSymptomTags)
                .items
                .filter { it.enabled }
                .sortedBy { it.order }
                .map { it.name }
                .ifEmpty { DEFAULT_SYMPTOMS }
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            DEFAULT_SYMPTOMS
        }

    /** Runs a write, reloads on success and maps known errors to user text. */
    @Suppress("TooGenericExceptionCaught") // UI operation boundary.
    fun perform(
        success: String? = null,
        after: () -> Unit = {},
        work: suspend () -> Unit,
    ) {
        if (busy) return
        busy = true
        message = null
        scope.launch {
            try {
                work()
                load()
                success?.let { message = it }
                after()
            } catch (error: CancellationException) {
                throw error
            } catch (failure: ApiFailure) {
                message =
                    when {
                        failure.status == HTTP_CONFLICT || failure.code == "conflict" -> "这段日期与已有的经期记录重叠"
                        failure.code == "bad_request" || failure.code == "validation_failed" -> "请检查填写的内容"
                        else -> "暂时无法完成，请稍后重试"
                    }
            } catch (_: Exception) {
                message = "暂时无法完成，请稍后重试"
            } finally {
                busy = false
            }
        }
    }

    fun cycleContaining(date: LocalDate): CycleRecord? =
        cycles.firstOrNull { cycle ->
            val start = LocalDate.parse(cycle.startDate)
            val today = LocalDate.now()
            val end = cycle.endDate?.let(LocalDate::parse) ?: if (start.isAfter(today)) start else today
            !date.isBefore(start) && !date.isAfter(end)
        }

    fun predictedDays(): Set<LocalDate> {
        val start = prediction?.predictedNextStart?.let(LocalDate::parse) ?: return emptySet()
        val days = (prediction?.predictedDays ?: settings?.periodLengthDays ?: DEFAULT_PERIOD_DAYS).toInt()
        return (0 until days).map { start.plusDays(it.toLong()) }.toSet()
    }

    suspend fun createCycle(start: LocalDate): CycleRecord =
        call(Endpoints.healthEndpointsCreateCycle, buildJsonObject { put("startDate", start.toString()) })

    suspend fun updateCycle(
        cycleId: String,
        endDate: LocalDate? = null,
        dayLog: JsonObject? = null,
    ): CycleRecord =
        call(
            Endpoints.healthEndpointsUpdateCycle,
            buildJsonObject {
                endDate?.let { put("endDate", it.toString()) }
                dayLog?.let { put("dayLog", it) }
            },
            params = mapOf("cycleId" to cycleId),
        )

    suspend fun deleteCycle(cycleId: String) {
        call(Endpoints.healthEndpointsDeleteCycle, params = mapOf("cycleId" to cycleId))
    }

    suspend fun clearAll() {
        call(Endpoints.healthEndpointsClearAll, buildJsonObject { put("confirm", "CLEAR") })
        repository.flags.set(owner, NOTICE_FLAG, "no")
        acknowledged = false
    }

    suspend fun saveAuthorization(ids: Set<String>) {
        authorized =
            call(
                Endpoints.healthEndpointsUpdateAuthorization,
                buildJsonObject { put("authorizedCharacterIds", JsonArray(ids.sorted().map(::JsonPrimitive))) },
            ).authorizedCharacterIds.toSet()
    }

    suspend fun saveSettings(
        cycleLength: Int,
        periodLength: Int,
    ) {
        settings =
            call(
                Endpoints.healthEndpointsUpdateSettings,
                buildJsonObject {
                    put("cycleLengthDays", cycleLength)
                    put("periodLengthDays", periodLength)
                },
            )
    }

    companion object {
        const val NOTICE_FLAG = "health:noticeAcknowledged"
        const val HTTP_CONFLICT = 409
        const val MAX_CYCLES = 1_000
        const val DEFAULT_PERIOD_DAYS = 5L
        val DEFAULT_SYMPTOMS = listOf("腹痛", "腰酸", "头痛", "乳房胀痛", "情绪低落", "乏力", "长痘")
        const val NOTICE =
            "经期记录会加密保存，只有你授权的角色知道；不会出现在朋友圈、群聊、分享图里，也不会随角色发布到人设广场。" +
                "预测仅供参考，不能用于避孕或医疗判断。"
    }
}

internal fun dayLogJson(
    date: LocalDate,
    flow: String?,
    pain: String?,
    symptoms: Collection<String>,
    notes: String?,
): JsonObject =
    buildJsonObject {
        put("date", date.toString())
        put("flow", flow?.let(::JsonPrimitive) ?: JsonNull)
        put("pain", pain?.let(::JsonPrimitive) ?: JsonNull)
        put("symptoms", JsonArray(symptoms.map(::JsonPrimitive)))
        put("notes", notes?.takeIf { it.isNotBlank() }?.let(::JsonPrimitive) ?: JsonNull)
    }
