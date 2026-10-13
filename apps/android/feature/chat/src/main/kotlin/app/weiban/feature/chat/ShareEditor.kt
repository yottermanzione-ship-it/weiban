package app.weiban.feature.chat

import android.Manifest
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.Settings
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.Crossfade
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import app.weiban.contracts.*
import app.weiban.data.*
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.defaultAvatarStyle
import app.weiban.designsystem.shareImage
import app.weiban.designsystem.tokens.WbColorSets
import app.weiban.designsystem.tokens.WbSpace
import app.weiban.network.ApiFailure
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import java.io.File
import java.io.IOException

private const val IMAGE_TIMEOUT_MS = 5_000L

private val templates =
    listOf(
        "pink_filter" to "粉色滤镜",
        "chat_original" to "聊天原样",
        "simple_white" to "简洁白底",
        "card_style" to "卡片风",
    )

/** 编辑页一次准备好的素材：服务器内容 + 已下载的头像 / 图片 / 卡面。 */
@Suppress("LongParameterList") // 首次本机构建（2026-10-11）：保留既有逻辑，复杂度待重构
private class ShareMaterials(
    val data: ShareImageData,
    val items: List<ShareRenderItem>,
    val people: Map<String, SharePerson>,
    val meHidden: SharePerson,
    val meShown: SharePerson,
    val title: String,
    val group: Boolean,
    val daysKnown: Long?,
    val card: ShareRenderCard?,
    val missingImages: Int,
    val defaultTemplate: String,
)

private class ShareEditorState {
    var materials by mutableStateOf<ShareMaterials?>(null)
    var loadFailed by mutableStateOf(false)
    var rejected by mutableStateOf<String?>(null)
    var template by mutableStateOf("pink_filter")
    var defaultTemplate by mutableStateOf("pink_filter")
    var showMe by mutableStateOf(false)
    var showTime by mutableStateOf(true)
    var showDays by mutableStateOf(true)
    var preview by mutableStateOf<Bitmap?>(null)
    var rendering by mutableStateOf(false)
    var renderFailed by mutableStateOf(false)
    var saving by mutableStateOf(false)
    var permissionDialog by mutableStateOf(false)
    var revision by mutableIntStateOf(0)
}

/**
 * 分享图编辑页（EXP-01、EXP-02；share-templates.md 第 5～7 节）。
 * 服务器决定能放进图里的内容和贴纸文案；本页在手机本地绘制，保存到系统相册或交给系统分享。
 */
@Suppress("LongMethod", "CyclomaticComplexMethod") // Loading, preview, options and the two actions.
@Composable
internal fun ShareEditor(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    request: ShareRequest,
    onClose: () -> Unit,
) {
    val context = LocalContext.current
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    val editor = remember(request) { ShareEditorState() }
    BackHandler(onBack = onClose)
    LaunchedEffect(request, editor.revision) {
        editor.loadFailed = false
        editor.rejected = null
        try {
            val loaded = prepareMaterials(repository, runtime, owner, request)
            editor.defaultTemplate = loaded.defaultTemplate
            editor.template =
                when (request.origin) {
                    "card" -> "card_style"
                    "moments" -> if (loaded.defaultTemplate == "card_style") "pink_filter" else loaded.defaultTemplate
                    else -> loaded.defaultTemplate
                }
            editor.materials = loaded
        } catch (error: CancellationException) {
            throw error
        } catch (error: ApiFailure) {
            if (error.code == "share_content_not_allowed" || error.status == 422) {
                val source = request.source
                val ids =
                    ((source["messageIds"] ?: source["favoriteIds"]) as? JsonArray)
                        .orEmpty()
                        .mapNotNull { it.jsonPrimitive.contentOrNull }
                val reasons =
                    (error.details?.get("rejected") as? JsonArray).orEmpty().map { value ->
                        val reason = (value as? JsonObject)?.get("reason")?.jsonPrimitive?.contentOrNull
                        val index = ids.indexOf((value as? JsonObject)?.get("id")?.jsonPrimitive?.contentOrNull)
                        (if (index >= 0) "第 ${index + 1} 条：" else "内容：") +
                            when (reason) {
                                "adult_scope" -> "成人模式内容"
                                "health_label" -> "健康相关内容"
                                "recalled" -> "消息已撤回"
                                else -> "内容不可用于分享"
                            }
                    }
                editor.rejected = reasons.joinToString("\n").ifEmpty { error.message ?: SHARE_REJECT_TEXT }
            } else {
                editor.loadFailed = true
            }
        } catch (_: IOException) {
            editor.loadFailed = true
        }
    }
    val materials = editor.materials
    LaunchedEffect(materials, editor.template, editor.showMe, editor.showTime, editor.showDays) {
        val ready = materials ?: return@LaunchedEffect
        editor.rendering = true
        editor.renderFailed = false
        val input =
            ShareRenderInput(
                template = editor.template,
                label = ready.data.label,
                items = ready.items,
                people = ready.people,
                me = if (editor.showMe) ready.meShown else ready.meHidden,
                title = ready.title,
                group = ready.group,
                daysKnown = ready.daysKnown?.takeIf { editor.showDays },
                showTime = editor.showTime,
                card = ready.card,
            )
        val bitmap =
            withContext(Dispatchers.Default) {
                try {
                    renderShareImage(input)
                } catch (_: OutOfMemoryError) {
                    null
                } catch (_: IllegalArgumentException) {
                    null
                }
            }
        if (bitmap == null) editor.renderFailed = true else editor.preview = bitmap
        editor.rendering = false
    }
    val permission =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) save(context, repository, owner, editor, scope) else editor.permissionDialog = true
        }
    Surface(Modifier.fillMaxSize(), color = colors.bgPage) {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onClose) { Text("‹ 取消") }
                Text("分享图", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
            }
            Box(Modifier.weight(1f).fillMaxWidth().background(colors.bgPage), contentAlignment = Alignment.Center) {
                when {
                    editor.rejected != null ->
                        Text(
                            editor.rejected.orEmpty(),
                            Modifier.padding(WbSpace.S5),
                            color = MaterialTheme.colorScheme.error,
                        )
                    editor.loadFailed -> RetryBlock("内容加载失败") { editor.revision++ }
                    materials == null -> CircularProgressIndicator(Modifier.size(16.dp))
                    editor.renderFailed && editor.preview == null -> RetryBlock("生成失败") { editor.revision++ }
                    else -> PreviewImage(editor)
                }
            }
            if (materials != null) ShareOptions(repository, owner, editor, materials, request, scope)
            Row(Modifier.fillMaxWidth().padding(WbSpace.S5), horizontalArrangement = Arrangement.spacedBy(WbSpace.S4)) {
                val ready = materials != null && editor.preview != null && !editor.renderFailed && !editor.rendering
                Button(
                    enabled = ready && !editor.saving,
                    modifier = Modifier.weight(1f),
                    onClick = {
                        val needsPermission =
                            Build.VERSION.SDK_INT < Build.VERSION_CODES.Q &&
                                context.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED
                        if (needsPermission) {
                            permission.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                        } else {
                            save(context, repository, owner, editor, scope)
                        }
                    },
                ) { Text(if (editor.saving) "正在保存…" else "保存到相册") }
                FilledTonalButton(
                    enabled = ready,
                    modifier = Modifier.weight(1f),
                    onClick = { share(context, repository, owner, editor, scope) },
                ) {
                    Text("分享")
                }
            }
        }
    }
    if (editor.permissionDialog) {
        AlertDialog(
            onDismissRequest = { editor.permissionDialog = false },
            title = { Text("需要相册权限才能保存") },
            confirmButton = {
                TextButton(onClick = {
                    editor.permissionDialog = false
                    context.startActivity(
                        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                    )
                }) { Text("去设置") }
            },
            dismissButton = { TextButton(onClick = { editor.permissionDialog = false }) { Text("取消") } },
        )
    }
}

@Composable private fun RetryBlock(
    text: String,
    onRetry: () -> Unit,
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(text)
        TextButton(onClick = onRetry) { Text("重试") }
    }
}

@Composable private fun PreviewImage(editor: ShareEditorState) {
    Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(WbSpace.S5), contentAlignment = Alignment.TopCenter) {
        // 旧预览保留到新图出来再交叉淡入（7.2）。
        Crossfade(editor.preview, label = "分享图预览") { bitmap ->
            if (bitmap != null) {
                Image(bitmap.asImageBitmap(), "分享图预览", Modifier.widthIn(max = 280.dp).fillMaxWidth(), contentScale = ContentScale.FillWidth)
            }
        }
        if (editor.rendering) CircularProgressIndicator(Modifier.size(16.dp).align(Alignment.Center))
    }
}

@Suppress("LongMethod", "LongParameterList") // Template list and five options.
@Composable
private fun ShareOptions(
    repository: SessionRepository,
    owner: OwnerRecord,
    editor: ShareEditorState,
    materials: ShareMaterials,
    request: ShareRequest,
    scope: CoroutineScope,
) {
    val context = LocalContext.current
    val colors = LocalWeibanColors.current
    Column(Modifier.fillMaxWidth().padding(horizontal = WbSpace.S5), verticalArrangement = Arrangement.spacedBy(WbSpace.S2)) {
        if (materials.missingImages > 0) {
            Text("有 ${materials.missingImages} 张图片没加载出来", color = colors.textSecondary, style = MaterialTheme.typography.bodySmall)
        }
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
            for ((id, name) in templates) {
                val allowed =
                    when (request.origin) {
                        "card" -> id == "card_style"
                        "moments" -> id != "card_style"
                        else -> true
                    }
                FilterChip(
                    selected = editor.template == id,
                    onClick = {
                        when {
                            allowed -> editor.template = id
                            request.origin == "moments" -> toast(context, "这条内容不适合卡片风")
                            else -> toast(context, "卡片只能生成卡片风分享图")
                        }
                    },
                    label = { Text(name, color = if (allowed) colors.textPrimary else colors.textTertiary) },
                )
            }
        }
        if (editor.template == "card_style" && materials.card == null && cardStyleOverflow(materials.items)) {
            Text("内容太多，建议用其他模板", color = colors.textSecondary, style = MaterialTheme.typography.bodySmall)
        }
        if (materials.items.any { it.mine }) OptionSwitch("显示我的头像和昵称", editor.showMe) { editor.showMe = it }
        if (editor.template != "card_style" || materials.card == null) OptionSwitch("显示时间", editor.showTime) { editor.showTime = it }
        if (materials.daysKnown != null) OptionSwitch("显示「认识第 N 天」", editor.showDays) { editor.showDays = it }
        if (materials.data.label == "weiban_not_real_person") {
            // 3.4：锁定说明，没有开关。
            Text("🔒 含真人角色内容，图片会带上「非本人，请谨慎识别」", color = colors.textSecondary, style = MaterialTheme.typography.bodySmall)
        }
        OptionSwitch("设为默认模板", editor.template == editor.defaultTemplate, enabled = editor.template != editor.defaultTemplate) { on ->
            if (on) {
                val chosen = editor.template
                scope.launch {
                    userAction({ toast(context, "设置失败，请稍后再试") }) {
                        val saved =
                            repository.call(
                                Endpoints.shareEndpointsUpdatePreferences,
                                body = buildJsonObject { put("defaultTemplate", chosen) },
                                options = SessionCallOptions(owner = owner),
                            )
                        editor.defaultTemplate = saved.defaultTemplate
                    }
                }
            }
        }
    }
}

@Composable private fun OptionSwitch(
    label: String,
    checked: Boolean,
    enabled: Boolean = true,
    onChange: (Boolean) -> Unit,
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f))
        Switch(checked = checked, enabled = enabled, onCheckedChange = onChange)
    }
}

private fun toast(
    context: Context,
    text: String,
) {
    Toast.makeText(context, text, Toast.LENGTH_SHORT).show()
}

// ---------- 保存与分享 ----------

private fun save(
    context: Context,
    repository: SessionRepository,
    owner: OwnerRecord,
    editor: ShareEditorState,
    scope: CoroutineScope,
) {
    val bitmap = editor.preview ?: return
    if (editor.saving) return
    editor.saving = true
    scope.launch {
        try {
            val saved =
                withContext(Dispatchers.IO) {
                    val (bytes, mime) = exportShareImage(bitmap)
                    saveImageToGallery(context, bytes, mime)
                }
            if (saved) {
                toast(context, "已保存到相册")
                recordGenerated(repository, owner, editor.template)
            } else if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                editor.permissionDialog = true
            } else {
                toast(context, "保存失败，请稍后再试")
            }
        } finally {
            editor.saving = false
        }
    }
}

private fun share(
    context: Context,
    repository: SessionRepository,
    owner: OwnerRecord,
    editor: ShareEditorState,
    scope: CoroutineScope,
) {
    val bitmap = editor.preview ?: return
    scope.launch {
        val exported = withContext(Dispatchers.Default) { exportShareImage(bitmap) }
        val opened =
            try {
                shareImage(context, exported.first, exported.second, "分享图")
                true
            } catch (_: IOException) {
                false
            } catch (_: IllegalArgumentException) {
                false
            } catch (_: android.content.ActivityNotFoundException) {
                false
            }
        if (opened) recordGenerated(repository, owner, editor.template) else toast(context, "无法调起分享，请先保存到相册")
    }
}

private suspend fun recordGenerated(
    repository: SessionRepository,
    owner: OwnerRecord,
    template: String,
) {
    userAction({}) {
        repository.call(
            Endpoints.shareEndpointsRecordGenerated,
            body = buildJsonObject { put("template", template) },
            options = SessionCallOptions(owner = owner, networkOnly = true),
        )
    }
}

/** 保存到系统相册 Pictures/微伴（安卓 10 起 MediaStore 不需要权限；8～9 需要先拿到写入权限）。 */
@Suppress("TooGenericExceptionCaught") // Any storage failure reports false so the page can explain it.
private fun saveImageToGallery(
    context: Context,
    bytes: ByteArray,
    mimeType: String,
): Boolean =
    try {
        val name = "weiban-share-${System.currentTimeMillis()}." + if (mimeType == "image/jpeg") "jpg" else "png"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values =
                ContentValues().apply {
                    put(MediaStore.Images.Media.DISPLAY_NAME, name)
                    put(MediaStore.Images.Media.MIME_TYPE, mimeType)
                    put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/微伴")
                    put(MediaStore.Images.Media.IS_PENDING, 1)
                }
            val resolver = context.contentResolver
            val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: throw IOException("no gallery")
            resolver.openOutputStream(uri)?.use { it.write(bytes) } ?: throw IOException("no stream")
            values.clear()
            values.put(MediaStore.Images.Media.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
        } else {
            legacyShareSave(context, name, bytes, mimeType)
        }
        true
    } catch (_: Exception) {
        false
    }

@Suppress("DEPRECATION") // Android 8–9 path: public Pictures directory plus a media scan.
private fun legacyShareSave(
    context: Context,
    name: String,
    bytes: ByteArray,
    mimeType: String,
) {
    val directory = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "微伴").apply { mkdirs() }
    val file = File(directory, name)
    file.writeBytes(bytes)
    android.media.MediaScannerConnection.scanFile(context, arrayOf(file.absolutePath), arrayOf(mimeType), null)
}

// ---------- 素材准备 ----------

@Suppress("LongMethod", "CyclomaticComplexMethod") // One linear preparation pass: server data, people, pictures, card and badges.
private suspend fun prepareMaterials(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    request: ShareRequest,
): ShareMaterials =
    coroutineScope {
        val options = SessionCallOptions(owner = owner, networkOnly = true)
        val data =
            repository.call(
                Endpoints.shareEndpointsPrepare,
                body = buildJsonObject { put("source", request.source) },
                options = options,
            )
        val preferences =
            async {
                runCatchingIo {
                    repository.call(Endpoints.shareEndpointsGetPreferences, options = SessionCallOptions(owner = owner)).defaultTemplate
                } ?: "pink_filter"
            }
        val snapshot = runtime.snapshot.value
        val state = if (snapshot.owner == owner) snapshot.state else SyncEngine.freshState()
        val conversation = request.conversationId?.let { id -> state.conversations.find { it.conversationId == id } }
        val group = conversation?.isGroup() == true
        val ids = (data.characterIds + data.items.mapNotNull { it.characterId }).distinct()
        val profiles =
            ids
                .map { id ->
                    async {
                        id to
                            runCatchingIo {
                                repository.call(
                                    Endpoints.characterEndpointsGetProfile,
                                    params = mapOf("characterId" to id),
                                    options = SessionCallOptions(owner = owner),
                                )
                            }
                    }
                }.awaitAll()
                .toMap()
        val people =
            ids
                .map { id ->
                    async {
                        val profile = profiles[id]
                        val contact = state.contacts.find { it.characterId == id }
                        val name = contact?.remark ?: profile?.name ?: "角色"
                        val style =
                            defaultAvatarStyle(
                                id,
                                profile?.name.orEmpty(),
                                profile
                                    ?.avatar
                                    ?.display
                                    ?.supportColors
                                    .orEmpty(),
                                profile?.avatar?.display?.avatarText,
                            )
                        // SAFE-01 第 5 条：用户上传 > 管理员上传 > 默认头像。
                        val mediaId = contact?.customAvatarMediaId ?: profile?.avatar?.image?.mediaId
                        val image = mediaId?.let { picture(repository, owner, it, 192) }
                        id to SharePerson(name, style.letters, style.background.toArgb(), style.foreground.toArgb(), image)
                    }
                }.awaitAll()
                .toMap()
        val pink = WbColorSets.GreenLight // v3 令牌删除了粉色主题
        val meHidden = SharePerson("我", "我", pink.bgUserAvatar.toArgb(), pink.textUserAvatar.toArgb(), null)
        val meShown =
            if (data.items.any { it.senderKind == "user" }) {
                val profile =
                    runCatchingIo { repository.call(Endpoints.identityEndpointsGetProfile, options = SessionCallOptions(owner = owner)) }
                val nickname = profile?.nickname?.ifBlank { null } ?: "我"
                SharePerson(
                    nickname,
                    defaultAvatarStyle(owner.userId, nickname).letters,
                    pink.bgUserAvatar.toArgb(),
                    pink.textUserAvatar.toArgb(),
                    profile?.avatarMediaId?.let { picture(repository, owner, it, 192) },
                )
            } else {
                meHidden
            }
        val pictures =
            data.items
                .map { item ->
                    async {
                        when (val content = item.content) {
                            is ReceivedMessageContentImage -> picture(repository, owner, content.mediaId, 480, thumbnail = true)
                            is ReceivedMessageContentSticker -> picture(repository, owner, content.mediaId, 240, thumbnail = false)
                            else -> null
                        }
                    }
                }.awaitAll()
        val items =
            data.items.mapIndexed { index, item ->
                ShareRenderItem(item.senderKind == "user", item.characterId, item.content, item.createdAt, pictures[index])
            }
        val missing = data.items.indices.count { isPicture(data.items[it].content) && pictures[it] == null }
        val card =
            data.cardId?.let { cardId ->
                runCatchingIo {
                    repository.call(Endpoints.growthCardEndpointsGetCard, params = mapOf("cardId" to cardId), options = options)
                }
            }
        val renderCard =
            card?.let {
                ShareRenderCard(
                    it.title,
                    it.line,
                    it.serialNo,
                    it.obtainedOn,
                    it.kind,
                    it.face.mediaId?.let { media -> picture(repository, owner, media, 960) },
                    it.characterId,
                )
            }
        val single = (card?.characterId ?: data.characterIds.singleOrNull())?.takeIf { !group }
        val daysKnown =
            single?.let { id ->
                runCatchingIo {
                    repository
                        .call(
                            Endpoints.growthEndpointsGetDaysKnown,
                            params = mapOf("characterId" to id),
                            options = SessionCallOptions(owner = owner),
                        ).daysKnown
                }
            }
        val heading =
            when {
                conversation != null -> title(state, conversation, people.mapValues { it.value.name })
                single != null -> people[single]?.name ?: "微伴"
                else -> "微伴"
            }
        ShareMaterials(
            data,
            items,
            people,
            meHidden,
            meShown,
            heading,
            group,
            daysKnown,
            renderCard,
            missing,
            preferences.await(),
        )
    }

/** 下载并解码一张图片；超过 5 秒或失败返回 null（画占位，7.2）。 */
@Suppress("TooGenericExceptionCaught") // Missing pictures fall back to a placeholder; cancellation still propagates.
private suspend fun picture(
    repository: SessionRepository,
    owner: OwnerRecord,
    mediaId: String,
    maxEdge: Int,
    thumbnail: Boolean = false,
): Bitmap? =
    try {
        withTimeoutOrNull(IMAGE_TIMEOUT_MS) {
            val bytes = downloadChatMedia(repository, owner, mediaId, thumbnail = thumbnail)
            withContext(Dispatchers.Default) { decodeSampled(bytes, maxEdge) }
        }
    } catch (error: CancellationException) {
        throw error
    } catch (_: Exception) {
        null
    }

@Suppress("TooGenericExceptionCaught") // Optional decorations (preferences, profile, days) degrade to defaults.
private suspend fun <T> runCatchingIo(block: suspend () -> T): T? =
    try {
        block()
    } catch (error: CancellationException) {
        throw error
    } catch (_: Exception) {
        null
    }
