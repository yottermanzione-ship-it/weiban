package app.weiban.feature.chat

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import app.weiban.contracts.*
import app.weiban.data.*
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.PhotoCropper
import app.weiban.designsystem.tokens.WbSpace
import app.weiban.network.ApiFailure
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import java.io.IOException
import java.util.UUID

/** 单次导入上限（契约 IMPORT_LIMITS）。 */
private const val IMPORT_MAX_CHARS = 200_000
private const val IMPORT_MAX_SCREENSHOTS = 30
private const val IMPORT_FILE_MAX_BYTES = 5 * 1024 * 1024
private const val JOB_POLL_MS = 2_000L
private const val DESCRIPTION_MIN = 50
private const val DESCRIPTION_MAX = 2_000
private const val SUPPLEMENT_MAX = 5_000

private fun importToast(
    context: Context,
    text: String,
) {
    Toast.makeText(context, text, Toast.LENGTH_SHORT).show()
}

private fun failureText(failure: String?): String =
    when (failure) {
        "format_unrecognized" -> "没能识别出两个以上的发言人，请换一份聊天记录"
        "insufficient_balance" -> "余额不足，充值后可以重试"
        "model_unavailable" -> "模型暂时不可用，请稍后重试"
        "vision_unavailable" -> "当前没有可用的识图模型，暂时不能导入截图"
        else -> "导入没有完成，请重试"
    }

private fun yuanText(micros: Long): String = "%.2f".format(micros / 1_000_000.0)

private fun JsonElement?.obj(): JsonObject? = this as? JsonObject

private fun JsonElement?.str(): String? = (this as? JsonPrimitive)?.contentOrNull

private fun JsonElement?.strings(): List<String> = (this as? JsonArray)?.mapNotNull { it.str() }.orEmpty()

/** 导入生成的角色卡草稿摊平到编辑器字段（与网页 custom-character.tsx draftFields 一致）。 */
@Suppress("LongParameterList") // 首次本机构建（2026-10-11）：保留既有逻辑，复杂度待重构
private class DraftFields(
    val name: String,
    val description: String,
    val catchphrase: String,
    val speechStyle: String,
    val exampleDialogue: String,
    val tags: String,
    val realPersonKind: String,
    val basis: String,
    val ageSetting: String,
    val detectedRealNames: List<String>,
    val birthday: String,
    val avatarMediaId: String?,
    val childAppearance: Boolean,
    val voiceId: String?,
)

private fun draftFields(
    result: JsonObject,
    speaker: String?,
): DraftFields {
    val data = result["draft"].obj()?.get("data").obj()
    val persona = data?.get("persona").obj()
    val speech = data?.get("speech").obj()
    val editor = result["editorFields"].obj()
    val description =
        listOfNotNull(
            persona?.get("summary").str(),
            persona?.get("personality").str(),
            persona?.get("background").str(),
        ).filter { it.isNotBlank() }
            .joinToString("\n")
            .take(DESCRIPTION_MAX)
    val examples =
        (data?.get("examples") as? JsonArray)
            .orEmpty()
            .take(6)
            .flatMap { example ->
                (example.obj()?.get("turns") as? JsonArray).orEmpty().map { turn ->
                    val who = if (turn.obj()?.get("role").str() == "user") "我" else "TA"
                    "$who：${turn.obj()?.get("text").str().orEmpty()}"
                }
            }.joinToString("\n")
            .take(DESCRIPTION_MAX)
    val classification = result["suggestedClassification"].obj()
    return DraftFields(
        name = editor?.get("name").str() ?: speaker.orEmpty().take(32),
        description = editor?.get("description").str() ?: description,
        catchphrase =
            (editor?.get("catchphrases") ?: speech?.get("catchphrases"))
                .strings()
                .joinToString("\n"),
        speechStyle = editor?.get("speechStyle").str() ?: speech?.get("tone").str().orEmpty(),
        exampleDialogue = editor?.get("exampleDialogue").str() ?: examples,
        tags =
            (editor?.get("tags") ?: persona?.get("personaTagsCustom"))
                .strings()
                .take(10)
                .joinToString("，"),
        realPersonKind = classification?.get("realPersonKind").str() ?: "private_person",
        basis = classification?.get("basis").str() ?: "real_person",
        ageSetting = classification?.get("ageSetting").str() ?: "adult",
        detectedRealNames = result["detectedRealNames"].strings(),
        birthday = editor?.get("birthday").str().orEmpty(),
        avatarMediaId = editor?.get("avatarMediaId").str(),
        childAppearance = classification?.get("childAppearance")?.jsonPrimitive?.booleanOrNull ?: false,
        voiceId = editor?.get("voiceId").str(),
    )
}

/** 读取一个文件 / 图片的字节和显示名；超过上限返回 null。 */
private suspend fun readPicked(
    context: Context,
    uri: Uri,
    maxBytes: Int,
): Pair<ByteArray, String>? =
    withContext(Dispatchers.IO) {
        val resolver = context.contentResolver
        val name =
            resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) cursor.getString(0) else null
            } ?: "import"
        val bytes = resolver.openInputStream(uri)?.use { it.readBytes() } ?: return@withContext null
        if (bytes.size > maxBytes) null else bytes to name
    }

/**
 * 导入（CHR-08、CHR-09；design pages/import.md）：说明 → 粘贴 / 选文件 / 相册截图 → 识别 →
 * 截图确认识别结果 → 选哪一方是 TA → 保留原文 + 预计花费 → 生成中（可离开）→ 编辑草稿 / 确认补充设定。
 */
@Suppress("LongMethod", "CyclomaticComplexMethod") // One state machine following the job status.
@Composable
internal fun ImportOverlay(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    open: ImportOpen,
    onClose: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    var jobId by remember(open) { mutableStateOf(open.jobId) }
    var job by remember(open) { mutableStateOf<ImportJob?>(null) }
    var created by remember(open) { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val activeId = jobId
    // 轮询任务状态（服务器也会推送导入完成通知）。
    LaunchedEffect(activeId) {
        val id = activeId ?: return@LaunchedEffect
        while (true) {
            userAction({}) {
                job =
                    repository.call(
                        Endpoints.importerEndpointsGetJob,
                        params = mapOf("jobId" to id),
                        options = SessionCallOptions(owner = owner, networkOnly = true),
                    )
            }
            val status = job?.status
            val merged = job?.mergedIntoJobId
            if (status == "completed" && merged != null) {
                job = null
                jobId = merged
                return@LaunchedEffect
            }
            if (status != "detecting" && status != "analyzing" && status != "collecting") {
                delay(JOB_POLL_MS * 5)
            } else {
                delay(JOB_POLL_MS)
            }
        }
    }
    Surface(Modifier.fillMaxSize(), color = colors.bgPage) {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            val createdId = created
            val current = job
            when {
                createdId != null -> {
                    BackHandler(onBack = onClose)
                    TextButton(onClick = onClose) { Text("‹ 完成") }
                    val snapshot by runtime.snapshot.collectAsState()
                    val state = if (snapshot.owner == owner) snapshot.state else SyncEngine.freshState()
                    CharacterScreen(repository, runtime, owner, state, createdId, { conversationId ->
                        onClose()
                        GrowthNavigation.openConversation(conversationId)
                    })
                }
                activeId == null ->
                    ImportStart(repository, owner, open, onClose, onOpenJob = { jobId = it }) { started ->
                        job = started
                        jobId = started.jobId
                    }
                current == null -> {
                    BackHandler(onBack = onClose)
                    LinearProgressIndicator(Modifier.fillMaxWidth())
                }
                else ->
                    ImportJobPage(repository, owner, current, onClose, { job = it }, {
                        scope.launch {
                            userAction({}) {
                                repository.call(
                                    Endpoints.importerEndpointsCancel,
                                    params = mapOf("jobId" to current.jobId),
                                    options = SessionCallOptions(owner = owner, networkOnly = true),
                                )
                            }
                            jobId = null
                            job = null
                        }
                    }) { created = it }
            }
        }
    }
}

@Composable private fun ImportHeader(
    title: String,
    onBack: () -> Unit,
) {
    BackHandler(onBack = onBack)
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        TextButton(onClick = onBack) { Text("‹ 返回") }
        Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
    }
}

// ---------- 开始：说明、选来源、进行中的导入 ----------

@Suppress("LongMethod", "CyclomaticComplexMethod", "LongParameterList") // Intro, three sources and the job list.
@Composable
private fun ImportStart(
    repository: SessionRepository,
    owner: OwnerRecord,
    open: ImportOpen,
    onClose: () -> Unit,
    onOpenJob: (String) -> Unit,
    onStarted: (ImportJob) -> Unit,
) {
    val context = LocalContext.current
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    var mode by remember { mutableStateOf<String?>(null) }
    var text by remember { mutableStateOf("") }
    var pending by remember { mutableStateOf(false) }
    var progress by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val jobs =
        remote("${owner.sessionId}:imports") {
            repository.call(Endpoints.importerEndpointsListJobs, options = SessionCallOptions(owner = owner, networkOnly = true)).items
        }
    val model =
        remote("${owner.sessionId}:import-model") {
            repository.call(Endpoints.modelAccessEndpointsGetModelStatus, options = SessionCallOptions(owner = owner, networkOnly = true))
        }

    fun create(
        sourceKind: String,
        upload: suspend (String) -> Unit = {},
    ) {
        pending = true
        error = null
        scope.launch {
            try {
                var started =
                    repository.call(
                        Endpoints.importerEndpointsCreateJob,
                        body =
                            buildJsonObject {
                                put("clientRequestId", UUID.randomUUID().toString())
                                put("kind", open.kind)
                                open.targetCharacterId?.let { put("targetCharacterId", it) }
                                put("sourceKind", sourceKind)
                                open.mergeIntoJobId?.let { put("mergeIntoJobId", it) }
                                if (sourceKind == "text") put("text", text.take(IMPORT_MAX_CHARS * 2))
                            },
                        options = SessionCallOptions(owner = owner, networkOnly = true),
                    )
                if (sourceKind != "text") {
                    upload(started.jobId)
                    started =
                        repository.call(
                            Endpoints.importerEndpointsFinishUpload,
                            params = mapOf("jobId" to started.jobId),
                            options = SessionCallOptions(owner = owner, networkOnly = true),
                        )
                }
                onStarted(started)
            } catch (failure: CancellationException) {
                throw failure
            } catch (failure: ApiFailure) {
                error = if (failure.code == "limit_reached") "单次最多 $IMPORT_MAX_SCREENSHOTS 张截图，请分批导入" else "导入暂时无法开始，请稍后再试"
            } catch (_: IOException) {
                error = "网络不可用，请重试"
            } finally {
                pending = false
                progress = null
            }
        }
    }
    val file =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            if (uri == null) return@rememberLauncherForActivityResult
            scope.launch {
                val picked = readPicked(context, uri, IMPORT_FILE_MAX_BYTES)
                if (picked == null) {
                    importToast(context, "文件太大或无法读取")
                    return@launch
                }
                val (bytes, name) = picked
                val mime = if (name.endsWith(".csv", true)) "text/csv" else "text/plain"
                create("file") { id -> uploadImportFile(repository, owner, id, bytes, mime, name) }
            }
        }
    val shots =
        rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(IMPORT_MAX_SCREENSHOTS)) { uris ->
            if (uris.isEmpty()) return@rememberLauncherForActivityResult
            if (uris.size > IMPORT_MAX_SCREENSHOTS) importToast(context, "单次最多 $IMPORT_MAX_SCREENSHOTS 张，已取前 $IMPORT_MAX_SCREENSHOTS 张")
            create("screenshots") { id ->
                uris.take(IMPORT_MAX_SCREENSHOTS).forEachIndexed { index, uri ->
                    progress = "正在上传第 ${index + 1} / ${uris.size.coerceAtMost(IMPORT_MAX_SCREENSHOTS)} 张"
                    val picked = readPicked(context, uri, IMPORT_FILE_MAX_BYTES * 2) ?: throw IOException("unreadable")
                    val mime = context.contentResolver.getType(uri) ?: "image/jpeg"
                    uploadImportFile(repository, owner, id, picked.first, mime, picked.second)
                }
            }
        }
    val title = if (open.kind == "supplement") "导入资料" else "导入聊天记录"
    ImportHeader(title) { if (mode != null && !pending) mode = null else onClose() }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(WbSpace.S5),
        verticalArrangement = Arrangement.spacedBy(WbSpace.S3),
    ) {
        Text(
            if (open.kind == "supplement") {
                "把你整理的资料或聊天记录导入，生成只对你生效的补充设定。"
            } else {
                "把和 TA 的聊天记录导入，生成一个像 TA 的角色。"
            },
        )
        Text("微伴不会读取你手机里其他 App 的数据，请只导入你有权使用的内容。原文默认在生成后删除。", color = colors.textSecondary)
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        progress?.let { Text(it, color = colors.textSecondary) }
        if (pending) LinearProgressIndicator(Modifier.fillMaxWidth())
        when (mode) {
            "text" -> {
                OutlinedTextField(
                    text,
                    { text = it.take(IMPORT_MAX_CHARS * 2) },
                    Modifier.fillMaxWidth().heightIn(min = 200.dp),
                    label = { Text("粘贴聊天记录") },
                )
                Text("${text.length} 字" + if (text.length > IMPORT_MAX_CHARS) " · 超出部分只取最近的内容" else "", color = colors.textTertiary)
                Button(enabled = !pending && text.isNotBlank(), onClick = { create("text") }, modifier = Modifier.fillMaxWidth()) {
                    Text("下一步")
                }
            }
            else -> {
                OutlinedButton(enabled = !pending, onClick = { mode = "text" }, modifier = Modifier.fillMaxWidth()) { Text("粘贴文字") }
                OutlinedButton(
                    enabled = !pending,
                    onClick = { file.launch(arrayOf("text/plain", "text/csv", "text/comma-separated-values")) },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("选择文件（.txt / .csv）") }
                OutlinedButton(
                    enabled = !pending && open.kind != "supplement" && model.data?.visionAvailable != false,
                    onClick = { shots.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(if (model.data?.visionAvailable == false) "当前模型不能识图，请先更换模型" else "从相册选截图（最多 $IMPORT_MAX_SCREENSHOTS 张）") }
                val running = jobs.data.orEmpty().filter { it.kind == open.kind && it.status != "cancelled" }
                if (running.isNotEmpty()) {
                    Text("进行中的导入", style = MaterialTheme.typography.titleSmall)
                    running.forEach { item ->
                        ListItem(
                            headlineContent = { Text(jobStatusText(item)) },
                            supportingContent = { Text(item.createdAt.take(16).replace('T', ' '), color = colors.textTertiary) },
                            modifier = Modifier.clickable { onOpenJob(item.jobId) },
                        )
                    }
                }
            }
        }
    }
}

private fun jobStatusText(job: ImportJob): String =
    when (job.status) {
        "collecting" -> "等待上传"
        "detecting" -> "正在识别"
        "awaiting_dialogue_confirmation" -> "等你确认识别结果"
        "awaiting_speaker" -> "等你选择哪一方是 TA"
        "ready" -> "可以开始生成"
        "analyzing" -> "正在生成 ${job.progress}%"
        "completed" -> "已生成，点开查看"
        "failed" -> "没有完成"
        else -> "导入任务"
    }

// ---------- 任务页：按状态显示 ----------

@Suppress("LongMethod", "CyclomaticComplexMethod", "LongParameterList") // One page per job status.
@Composable
private fun ImportJobPage(
    repository: SessionRepository,
    owner: OwnerRecord,
    job: ImportJob,
    onClose: () -> Unit,
    onJob: (ImportJob) -> Unit,
    onDiscard: () -> Unit,
    onCreated: (String) -> Unit,
) {
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var discarding by remember { mutableStateOf(false) }
    val act: (suspend () -> ImportJob) -> Unit = { work ->
        if (!pending) {
            pending = true
            error = null
            scope.launch {
                try {
                    onJob(work())
                } catch (failure: CancellationException) {
                    throw failure
                } catch (failure: ApiFailure) {
                    error = if (failure.code == "insufficient_balance") failureText("insufficient_balance") else "操作暂未完成，请稍后再试"
                } catch (_: IOException) {
                    error = "网络不可用，请重试"
                } finally {
                    pending = false
                }
            }
        }
    }
    if (job.status == "completed") {
        ImportResultPage(repository, owner, job, onClose, onCreated)
        return
    }
    ImportHeader(if (job.kind == "supplement") "导入资料" else "导入聊天记录", onClose)
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(WbSpace.S5),
        verticalArrangement = Arrangement.spacedBy(WbSpace.S3),
    ) {
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (job.truncated) Text("内容超过 ${IMPORT_MAX_CHARS / 10_000} 万字，只取了最近的部分", color = colors.textSecondary)
        when (job.status) {
            "collecting", "detecting" -> {
                Text("正在识别聊天记录…")
                LinearProgressIndicator(Modifier.fillMaxWidth())
            }
            "awaiting_dialogue_confirmation" -> DialogueConfirm(repository, owner, job, pending, act)
            "awaiting_speaker" -> {
                Text("哪一方是要生成的 TA？", style = MaterialTheme.typography.titleSmall)
                job.speakers.forEach { speaker ->
                    ListItem(
                        headlineContent = { Text(speaker.name) },
                        supportingContent = { Text("${speaker.messageCount} 条发言", color = colors.textSecondary) },
                        modifier =
                            Modifier.clickable(enabled = !pending) {
                                act {
                                    repository.call(
                                        Endpoints.importerEndpointsSelectSpeaker,
                                        params = mapOf("jobId" to job.jobId),
                                        body = buildJsonObject { put("speaker", speaker.name) },
                                        options = SessionCallOptions(owner = owner, networkOnly = true),
                                    )
                                }
                            },
                    )
                }
            }
            "ready" -> ReadyToStart(repository, owner, job, pending, act)
            "analyzing" -> {
                Text("正在生成…（${job.progress}%）")
                LinearProgressIndicator(progress = { job.progress / 100f }, modifier = Modifier.fillMaxWidth())
                Text("可以先离开，生成完成后会通知你，也可以在「进行中的导入」里找到。", color = colors.textSecondary)
                TextButton(onClick = onClose) { Text("先离开") }
            }
            "failed" -> {
                Text(failureText(job.failure))
                if (job.selectedSpeaker != null) {
                    Button(enabled = !pending, onClick = {
                        act {
                            repository.call(
                                Endpoints.importerEndpointsStart,
                                params = mapOf("jobId" to job.jobId),
                                body = buildJsonObject { put("keepRaw", job.keepRaw) },
                                options = SessionCallOptions(owner = owner, networkOnly = true),
                            )
                        }
                    }) { Text("重试") }
                }
                TextButton(onClick = { discarding = true }) { Text("放弃", color = colors.textDanger) }
            }
            else -> Text(jobStatusText(job))
        }
        if (job.status != "failed" && job.status != "analyzing") {
            TextButton(onClick = { discarding = true }) { Text("取消导入", color = colors.textDanger) }
        }
    }
    if (discarding) {
        AlertDialog(
            onDismissRequest = { discarding = false },
            title = { Text("放弃这次导入？") },
            text = { Text("导入的原文和截图会立即删除。") },
            confirmButton = {
                TextButton(onClick = {
                    discarding = false
                    onDiscard()
                }) { Text("放弃", color = colors.textDanger) }
            },
            dismissButton = { TextButton(onClick = { discarding = false }) { Text("取消") } },
        )
    }
}

/** 截图识别结果确认：点一条改成另一方说的，或删除（右侧气泡 = 导入者本人）。 */
@Composable private fun DialogueConfirm(
    repository: SessionRepository,
    owner: OwnerRecord,
    job: ImportJob,
    pending: Boolean,
    act: (suspend () -> ImportJob) -> Unit,
) {
    val colors = LocalWeibanColors.current
    val lines = remember(job.jobId) { mutableStateListOf<RecognizedDialogueLine>() }
    var loaded by remember(job.jobId) { mutableStateOf(false) }
    var editing by remember { mutableStateOf<RecognizedDialogueLine?>(null) }
    LaunchedEffect(job.jobId) {
        userAction({}) {
            val items =
                repository
                    .call(
                        Endpoints.importerEndpointsGetRecognizedDialogue,
                        params = mapOf("jobId" to job.jobId),
                        options = SessionCallOptions(owner = owner, networkOnly = true),
                    ).items
            lines.clear()
            lines.addAll(items)
        }
        loaded = true
    }
    Text("确认识别结果", style = MaterialTheme.typography.titleSmall)
    Text("点一条可以改成另一方说的，或者删掉识别错的内容。", color = colors.textSecondary)
    if (!loaded) LinearProgressIndicator(Modifier.fillMaxWidth())
    lines.forEach { line ->
        ListItem(
            headlineContent = { Text(line.text, maxLines = 4) },
            overlineContent = { Text("${line.speaker} · 第 ${line.screenshotIndex + 1} 张") },
            modifier = Modifier.clickable { editing = line },
        )
    }
    Button(enabled = !pending && loaded && lines.isNotEmpty(), modifier = Modifier.fillMaxWidth(), onClick = {
        val edited = lines.toList()
        act {
            repository.call(
                Endpoints.importerEndpointsConfirmDialogue,
                params = mapOf("jobId" to job.jobId),
                body =
                    buildJsonObject {
                        put(
                            "lines",
                            JsonArray(
                                edited.map {
                                    buildJsonObject {
                                        put("lineId", it.lineId)
                                        put("speaker", it.speaker)
                                        put("text", it.text)
                                        put("screenshotIndex", it.screenshotIndex)
                                    }
                                },
                            ),
                        )
                    },
                options = SessionCallOptions(owner = owner, networkOnly = true),
            )
        }
    }) { Text("确认，下一步") }
    editing?.let { line ->
        val speakers = (lines.map { it.speaker } + job.speakers.map { it.name }).distinct()
        AlertDialog(
            onDismissRequest = { editing = null },
            title = { Text("这一条是谁说的？") },
            text = {
                Column {
                    speakers.forEach { speaker ->
                        TextButton(onClick = {
                            val index = lines.indexOfFirst { it.lineId == line.lineId }
                            if (index >= 0) lines[index] = line.copy(speaker = speaker)
                            editing = null
                        }) { Text(if (speaker == line.speaker) "✓ $speaker" else speaker) }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    lines.removeAll { it.lineId == line.lineId }
                    editing = null
                }) { Text("删除这一条", color = colors.textDanger) }
            },
            dismissButton = { TextButton(onClick = { editing = null }) { Text("取消") } },
        )
    }
}

/** 已选发言人：保留原文开关（默认关）+ 预计花费 + 开始；余额不足时禁用并给出去处（CHR-08 第 7 条）。 */
@Composable private fun ReadyToStart(
    repository: SessionRepository,
    owner: OwnerRecord,
    job: ImportJob,
    pending: Boolean,
    act: (suspend () -> ImportJob) -> Unit,
) {
    val colors = LocalWeibanColors.current
    var keepRaw by remember(job.jobId) { mutableStateOf(job.keepRaw) }
    val wallet =
        remote("${owner.sessionId}:import-wallet:${job.jobId}") {
            repository.call(Endpoints.billingEndpointsGetWallet, options = SessionCallOptions(owner = owner, networkOnly = true))
        }
    val estimate = job.estimatedMicros
    val enough = estimate == null || (wallet.data?.availableMicros ?: Long.MAX_VALUE) >= estimate
    Text("TA 是「${job.selectedSpeaker.orEmpty()}」", style = MaterialTheme.typography.titleSmall)
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text("保留原文以便以后补充")
            Text("默认不保留，生成完成后原文会删除", color = colors.textSecondary, style = MaterialTheme.typography.bodySmall)
        }
        Switch(checked = keepRaw, onCheckedChange = { keepRaw = it })
    }
    estimate?.let { Text("预计花费 ¥${yuanText(it)}（从余额扣除）", color = colors.textSecondary) }
    if (!enough) Text("余额不足，请先到 我 › 服务 › 余额与账单 充值", color = MaterialTheme.colorScheme.error)
    Button(enabled = !pending && enough, modifier = Modifier.fillMaxWidth(), onClick = {
        act {
            repository.call(
                Endpoints.importerEndpointsStart,
                params = mapOf("jobId" to job.jobId),
                body = buildJsonObject { put("keepRaw", keepRaw) },
                options = SessionCallOptions(owner = owner, networkOnly = true),
            )
        }
    }) { Text("开始生成") }
}

// ---------- 结果：新角色草稿 / 补充设定确认 ----------

@Composable private fun ImportResultPage(
    repository: SessionRepository,
    owner: OwnerRecord,
    job: ImportJob,
    onClose: () -> Unit,
    onCreated: (String) -> Unit,
) {
    val result =
        remote("${owner.sessionId}:import-result:${job.jobId}") {
            repository.call(
                Endpoints.importerEndpointsGetResult,
                params = mapOf("jobId" to job.jobId),
                options = SessionCallOptions(owner = owner, networkOnly = true),
            )
        }
    val data = result.data.obj()
    when {
        data == null -> {
            ImportHeader("导入结果", onClose)
            if (result.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            result.error?.let {
                Text(it, Modifier.padding(WbSpace.S5), color = MaterialTheme.colorScheme.error)
                TextButton(onClick = result::refresh) { Text("重试") }
            }
        }
        data["kind"].str() == "supplement" -> SupplementResult(repository, owner, job, data, onClose)
        else -> DraftEditor(repository, owner, job, data, draftFields(data, job.selectedSpeaker), onClose, onCreated)
    }
}

/** 导入草稿编辑器（CHR-08 第 4 条）：默认「真人」，不勾选声明不能改成原创 / 虚构。 */
@Suppress("LongMethod", "CyclomaticComplexMethod", "LongParameterList") // One form.
@Composable
private fun DraftEditor(
    repository: SessionRepository,
    owner: OwnerRecord,
    job: ImportJob,
    result: JsonObject,
    fields: DraftFields,
    onClose: () -> Unit,
    onCreated: (String) -> Unit,
) {
    val context = LocalContext.current
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    var name by remember(job.jobId) { mutableStateOf(fields.name) }
    var description by remember(job.jobId) { mutableStateOf(fields.description) }
    var catchphrase by remember(job.jobId) { mutableStateOf(fields.catchphrase) }
    var speechStyle by remember(job.jobId) { mutableStateOf(fields.speechStyle) }
    var examples by remember(job.jobId) { mutableStateOf(fields.exampleDialogue) }
    var tags by remember(job.jobId) { mutableStateOf(fields.tags) }
    var basis by remember(job.jobId) { mutableStateOf(fields.basis) }
    var birthday by remember(job.jobId) { mutableStateOf(fields.birthday) }
    var avatarMediaId by remember(job.jobId) { mutableStateOf(fields.avatarMediaId) }
    var voiceId by remember(job.jobId) { mutableStateOf(fields.voiceId) }
    var realKind by remember(job.jobId) { mutableStateOf(fields.realPersonKind) }
    var age by remember(job.jobId) { mutableStateOf(fields.ageSetting) }
    var childAppearance by remember(job.jobId) { mutableStateOf(fields.childAppearance) }
    var declared by remember(job.jobId) { mutableStateOf(false) }
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    ImportHeader("编辑角色", onClose)
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(WbSpace.S5),
        verticalArrangement = Arrangement.spacedBy(WbSpace.S3),
    ) {
        Text(
            if (job.keepRaw && job.rawDeletedAt == null) "原文已按你的选择保留" else "原文已删除，下面是生成的草稿",
            color = colors.textSecondary,
        )
        if (fields.detectedRealNames.isNotEmpty()) {
            Text("草稿里可能有真实姓名：${fields.detectedRealNames.joinToString("、")}，建议替换", color = colors.textSecondary)
        }
        OutlinedTextField(name, { name = it.take(32) }, Modifier.fillMaxWidth(), singleLine = true, label = { Text("名字 · 来自导入") })
        OutlinedTextField(
            description,
            { description = it.take(DESCRIPTION_MAX) },
            Modifier.fillMaxWidth(),
            label = { Text("人设描述（至少 $DESCRIPTION_MIN 字）· 来自导入") },
            supportingText = { Text("${description.length} / $DESCRIPTION_MAX") },
        )
        OutlinedTextField(
            catchphrase,
            { catchphrase = it.take(510) },
            Modifier.fillMaxWidth(),
            label = { Text("口头禅（每行一条，最多 10 条，每条 50 字）") },
        )
        OutlinedTextField(speechStyle, { speechStyle = it.take(500) }, Modifier.fillMaxWidth(), label = { Text("说话方式") })
        OutlinedTextField(examples, { examples = it.take(DESCRIPTION_MAX) }, Modifier.fillMaxWidth(), label = { Text("示例对话（可选）· 来自导入") })
        OutlinedTextField(tags, { tags = it.take(200) }, Modifier.fillMaxWidth(), singleLine = true, label = { Text("标签（用逗号分隔）") })
        OutlinedTextField(
            birthday,
            { birthday = it.take(10) },
            Modifier.fillMaxWidth(),
            singleLine = true,
            label = { Text("生日（YYYY-MM-DD，可不填）") },
        )
        DraftVoiceSelection(repository, owner, voiceId, !pending) { voiceId = it }
        Text("角色头像")
        PhotoCropper(enabled = !pending, onRestore = avatarMediaId?.let { { avatarMediaId = null } }) { bytes ->
            pending = true
            try {
                avatarMediaId = uploadMedia(repository, owner, bytes, "image/png", "custom_character_avatar").mediaId
            } finally {
                pending = false
            }
        }
        Text("角色分类", style = MaterialTheme.typography.titleSmall)
        Row(horizontalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
            for ((id, label) in listOf("real_person" to "真人", "original" to "原创", "fictional" to "虚构")) {
                FilterChip(
                    selected = basis == id,
                    enabled = id == "real_person" || declared,
                    onClick = { basis = id },
                    label = { Text(label) },
                )
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = declared, onCheckedChange = {
                declared = it
                if (!it) basis = "real_person"
            })
            Text("我声明这个角色不是以真实存在的人为原型", style = MaterialTheme.typography.bodySmall)
        }
        if (declared && basis != "real_person") {
            Text("请把草稿里的真实姓名等信息替换掉", color = colors.textSecondary, style = MaterialTheme.typography.bodySmall)
        }
        if (basis == "real_person") {
            Row {
                listOf("private_person" to "身边真人", "celebrity" to "公众人物", "historical" to "历史人物").forEach { (kind, label) ->
                    FilterChip(selected = realKind == kind, onClick = { realKind = kind }, label = { Text(label) })
                }
            }
        }
        Row {
            FilterChip(selected = age == "adult", onClick = { age = "adult" }, label = { Text("成年") })
            FilterChip(selected = age == "minor", onClick = { age = "minor" }, label = { Text("未成年") })
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(childAppearance, onCheckedChange = { childAppearance = it })
            Text("具有儿童外貌特征")
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        OutlinedButton(enabled = !pending, onClick = {
            pending = true
            scope.launch {
                try {
                    userAction({ error = it }) {
                        val editor =
                            buildJsonObject {
                                put("name", name)
                                put("description", description)
                                put("speechStyle", speechStyle)
                                put("exampleDialogue", examples)
                                put("birthday", birthday.trim().takeIf(String::isNotEmpty)?.let(::JsonPrimitive) ?: JsonNull)
                                put("avatarMediaId", avatarMediaId?.let(::JsonPrimitive) ?: JsonNull)
                                put("voiceId", voiceId?.let(::JsonPrimitive) ?: JsonNull)
                                put(
                                    "catchphrases",
                                    JsonArray(
                                        catchphrase
                                            .lines()
                                            .map { it.trim() }
                                            .filter { it.isNotEmpty() }
                                            .map(::JsonPrimitive),
                                    ),
                                )
                                put(
                                    "tags",
                                    JsonArray(
                                        tags
                                            .split(',', '，', '、')
                                            .map { it.trim() }
                                            .filter { it.isNotEmpty() }
                                            .map(::JsonPrimitive),
                                    ),
                                )
                            }
                        val classification =
                            JsonObject(
                                result["suggestedClassification"].obj().orEmpty() +
                                    mapOf(
                                        "basis" to JsonPrimitive(basis),
                                        "realPersonKind" to if (basis == "real_person") JsonPrimitive(realKind) else JsonNull,
                                        "ageSetting" to JsonPrimitive(age),
                                        "childAppearance" to JsonPrimitive(childAppearance),
                                    ),
                            )
                        repository.call(
                            Endpoints.importerEndpointsSaveResultDraft,
                            params = mapOf("jobId" to job.jobId),
                            body = JsonObject(result + mapOf("editorFields" to editor, "suggestedClassification" to classification)),
                            options = SessionCallOptions(owner = owner, networkOnly = true),
                        )
                        error = null
                        importToast(context = context, text = "草稿已保存")
                    }
                } finally {
                    pending = false
                }
            }
        }) { Text("保存草稿") }
        ContinueImport(job, pending)
        Button(
            enabled = !pending && name.isNotBlank() && description.length >= DESCRIPTION_MIN,
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                pending = true
                error = null
                scope.launch {
                    try {
                        val tagList =
                            tags
                                .split(',', '，', '、')
                                .map { it.trim().take(16) }
                                .filter { it.isNotEmpty() }
                                .take(10)
                        val created =
                            repository.call(
                                Endpoints.userCustomEndpointsCreate,
                                body =
                                    buildJsonObject {
                                        put("name", name.trim())
                                        put("description", description)
                                        put("birthday", birthday.trim().takeIf(String::isNotEmpty)?.let(::JsonPrimitive) ?: JsonNull)
                                        put("avatarMediaId", avatarMediaId?.let(::JsonPrimitive) ?: JsonNull)
                                        put("voiceId", voiceId?.let(::JsonPrimitive) ?: JsonNull)
                                        put(
                                            "classification",
                                            buildJsonObject {
                                                put("basis", basis)
                                                val kind = if (basis == "real_person") JsonPrimitive(realKind) else JsonNull
                                                put("realPersonKind", kind)
                                                put("ageSetting", age)
                                                put("childAppearance", childAppearance)
                                            },
                                        )
                                        put(
                                            "catchphrases",
                                            JsonArray(
                                                catchphrase
                                                    .lines()
                                                    .map { it.trim() }
                                                    .filter { it.isNotEmpty() }
                                                    .map(::JsonPrimitive),
                                            ),
                                        )
                                        put("speechStyle", speechStyle)
                                        if (examples.isNotBlank()) put("exampleDialogue", examples)
                                        if (tagList.isNotEmpty()) put("tags", JsonArray(tagList.map(::JsonPrimitive)))
                                    },
                                options = SessionCallOptions(owner = owner, networkOnly = true),
                            )
                        onCreated(created.characterId)
                    } catch (failure: CancellationException) {
                        throw failure
                    } catch (failure: ApiFailure) {
                        error = if (failure.code == "classification_change_forbidden") "这个分类不能这样改" else "创建暂未完成，请检查填写的内容"
                    } catch (_: IOException) {
                        error = "网络不可用，请重试"
                    } finally {
                        pending = false
                    }
                }
            },
        ) { Text("创建角色") }
    }
}

/** 补充设定导入结果确认（CHR-09）：勾选确认后追加到我的补充设定；自定义角色合并进人设描述。 */
@Suppress("LongMethod") // One confirmation form.
@Composable
private fun SupplementResult(
    repository: SessionRepository,
    owner: OwnerRecord,
    job: ImportJob,
    result: JsonObject,
    onClose: () -> Unit,
) {
    val context = LocalContext.current
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    val targetId = result["targetCharacterId"].str() ?: job.targetCharacterId.orEmpty()
    var text by remember(job.jobId) { mutableStateOf(result["text"].str().orEmpty()) }
    var confirmed by remember { mutableStateOf(false) }
    var pending by remember { mutableStateOf(false) }
    ImportHeader("确认补充设定", onClose)
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(WbSpace.S5),
        verticalArrangement = Arrangement.spacedBy(WbSpace.S3),
    ) {
        Text("下面的内容会加到你的补充设定里，只对你生效。涉及分类、年龄的内容不会生效。", color = colors.textSecondary)
        OutlinedTextField(text, { text = it.take(SUPPLEMENT_MAX) }, Modifier.fillMaxWidth(), label = { Text("补充设定") })
        val filtered = result["filteredCount"]?.jsonPrimitive?.longOrNull ?: 0L
        if (filtered > 0) Text("$filtered 条不会生效", color = colors.textSecondary)
        (result["conflicts"] as? JsonArray).orEmpty().forEach { value ->
            val conflict = value.obj()
            Text(
                "${conflict?.get(
                    "field",
                ).str()}：导入内容「${conflict?.get("supplementValue").str()}」与公开资料「${conflict?.get("publicValue").str()}」冲突，以公开资料为准。",
                color = colors.textSecondary,
            )
        }
        OutlinedButton(enabled = !pending, onClick = {
            pending = true
            scope.launch {
                try {
                    userAction({ importToast(context, it) }) {
                        repository.call(
                            Endpoints.importerEndpointsSaveResultDraft,
                            params = mapOf("jobId" to job.jobId),
                            body = JsonObject(result + ("text" to JsonPrimitive(text))),
                            options = SessionCallOptions(owner = owner, networkOnly = true),
                        )
                        importToast(context, "草稿已保存")
                    }
                } finally {
                    pending = false
                }
            }
        }) { Text("保存草稿") }
        ContinueImport(job, pending)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = confirmed, onCheckedChange = { confirmed = it })
            Text("我已确认这些内容")
        }
        val canAdd = confirmed && text.isNotBlank() && !pending && targetId.isNotEmpty()
        Button(enabled = canAdd, modifier = Modifier.fillMaxWidth(), onClick = {
            pending = true
            scope.launch {
                try {
                    userAction({ importToast(context, it) }) {
                        val custom =
                            repository
                                .call(Endpoints.userCustomEndpointsList, options = SessionCallOptions(owner = owner, networkOnly = true))
                                .items
                                .find { it.characterId == targetId }
                        if (custom != null) {
                            // 自定义角色：直接合并进人设描述（契约 putSupplement 说明）。
                            repository.call(
                                Endpoints.userCustomEndpointsUpdate,
                                params = mapOf("characterId" to targetId),
                                body =
                                    buildJsonObject {
                                        put("description", (custom.description + "\n" + text.trim()).take(DESCRIPTION_MAX))
                                    },
                                options = SessionCallOptions(owner = owner, networkOnly = true),
                            )
                        } else {
                            val existing =
                                repository.call(
                                    Endpoints.characterSupplementEndpointsGetSupplement,
                                    params = mapOf("characterId" to targetId),
                                    options = SessionCallOptions(owner = owner, networkOnly = true),
                                )
                            val merged =
                                listOfNotNull(existing?.text?.takeIf { it.isNotBlank() }, text.trim())
                                    .joinToString("\n")
                                    .take(SUPPLEMENT_MAX)
                            repository.call(
                                Endpoints.characterSupplementEndpointsPutSupplement,
                                params = mapOf("characterId" to targetId),
                                body = buildJsonObject { put("text", merged) },
                                options = SessionCallOptions(owner = owner, networkOnly = true),
                            )
                        }
                        importToast(context, "已添加到补充设定")
                        onClose()
                    }
                } finally {
                    pending = false
                }
            }
        }) { Text("添加") }
    }
}

@Composable private fun ContinueImport(
    job: ImportJob,
    pending: Boolean,
) {
    TextButton(enabled = !pending, onClick = {
        L6Overlays.imports.value = ImportOpen(job.kind, job.targetCharacterId, mergeIntoJobId = job.jobId)
    }) { Text("继续导入下一批（请先保存编辑）") }
}
