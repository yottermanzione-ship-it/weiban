@file:Suppress("TooGenericExceptionCaught", "LongMethod", "CyclomaticComplexMethod", "LongParameterList", "ComplexCondition")

package app.weiban.feature.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import app.weiban.contracts.*
import app.weiban.data.*
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.PhotoCropper
import app.weiban.designsystem.tokens.WbSpace
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

// ---------- 设置广场昵称（PLZ-02 第 2 条） ----------

@Composable internal fun PlazaProfilePage(
    repository: SessionRepository,
    owner: OwnerRecord,
) {
    PlazaHeader("广场昵称")
    NicknameForm(repository, owner) { PlazaNav.back() }
}

/** 广场昵称表单：默认我的昵称和头像；最多 12 字；提示其他用户能看到什么。 */
@Composable private fun NicknameForm(
    repository: SessionRepository,
    owner: OwnerRecord,
    onDone: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val mine =
        remote("${owner.sessionId}:plaza-profile") {
            repository.call(Endpoints.plazaEndpointsGetMyProfile, options = SessionCallOptions(owner = owner, networkOnly = true))
        }
    val me =
        remote("${owner.sessionId}:plaza-me") {
            repository.call(Endpoints.identityEndpointsGetProfile, options = SessionCallOptions(owner = owner))
        }
    var nickname by remember { mutableStateOf<String?>(null) }
    // 选过的头像：mediaId 为 null 表示不用头像；未选过时沿用广场资料或我的头像。
    var chosenMedia by remember { mutableStateOf<String?>(null) }
    var chosen by remember { mutableStateOf(false) }
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val existing = mine.data
    val current =
        nickname ?: existing?.nickname ?: me.data
            ?.nickname
            .orEmpty()
            .let { codePointSlice(it, 0, PLAZA_NICKNAME_MAX) }
    val mediaId = if (chosen) chosenMedia else existing?.avatarMediaId ?: me.data?.avatarMediaId
    val length = plazaChars(current.trim())
    Column(
        Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(WbSpace.S5),
        verticalArrangement = Arrangement.spacedBy(WbSpace.S3),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (chosen && chosenMedia != null) {
            Text("已选择新头像", color = LocalWeibanColors.current.textSecondary)
        } else {
            PlazaAvatar("plaza-me", current.ifBlank { "我" }, existing?.avatarUrl.takeIf { !chosen }, 64.dp)
        }
        // 更换头像：从相册选择（或拍照）后裁剪上传 / 使用我的头像。
        PhotoCropper(enabled = !pending) { bytes ->
            val media = uploadAvatar(repository, owner, bytes, "user_avatar")
            chosenMedia = media.mediaId
            chosen = true
        }
        TextButton(onClick = {
            chosen = true
            chosenMedia = me.data?.avatarMediaId
        }, enabled = !pending) { Text("使用我的头像") }
        OutlinedTextField(
            current,
            { nickname = it },
            Modifier.fillMaxWidth(),
            singleLine = true,
            label = { Text("广场昵称") },
            supportingText = { CharCount(length, PLAZA_NICKNAME_MAX) },
        )
        PlazaFootnote("ⓘ 其他用户会看到你的广场昵称和头像，不会看到你的通讯录、朋友圈和聊天")
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Button(
            onClick = {
                pending = true
                error = null
                scope.launch {
                    try {
                        repository.call(
                            Endpoints.plazaEndpointsPutMyProfile,
                            body =
                                buildJsonObject {
                                    put("nickname", current.trim())
                                    put("avatarMediaId", mediaId?.let(::JsonPrimitive) ?: JsonNull)
                                },
                            options = SessionCallOptions(owner = owner),
                        )
                        plazaToast(context, "已保存")
                        onDone()
                    } catch (failure: CancellationException) {
                        throw failure
                    } catch (_: Exception) {
                        error = "操作暂未完成，请稍后再试"
                    } finally {
                        pending = false
                    }
                }
            },
            enabled = !pending && length in 1..PLAZA_NICKNAME_MAX,
            modifier = Modifier.fillMaxWidth(),
        ) { Text("下一步") }
    }
}

// ---------- 我发布的（PLZ-02 第 1 条、PLZ-03、PLZ-06、PLZ-07 第 4 条） ----------

@Composable internal fun ColumnScope.MyWorksPage(
    repository: SessionRepository,
    owner: OwnerRecord,
) {
    val colors = LocalWeibanColors.current
    var tab by remember { mutableStateOf("works") }
    val profile =
        remote("${owner.sessionId}:plaza-my-profile") {
            repository.call(Endpoints.plazaEndpointsGetMyProfile, options = SessionCallOptions(owner = owner, networkOnly = true))
        }
    val works =
        remote("${owner.sessionId}:plaza-my-works") {
            repository.call(Endpoints.plazaEndpointsListMyWorks, options = SessionCallOptions(owner = owner, networkOnly = true)).items
        }
    val badge = rememberPlazaBadge(repository, owner)
    val unseen = (badge?.myWorksUnseen ?: 0L) + (badge?.reportResultsUnseen ?: 0L)
    // 从作品页、昵称页返回时刷新。
    val stack by PlazaNav.stack.collectAsState()
    LaunchedEffect(stack.size) {
        profile.refresh()
        works.refresh()
    }
    PlazaHeader("我发布的")
    val me = profile.data
    Row(
        Modifier.fillMaxWidth().clickable { PlazaNav.open(PlazaPage.Profile) }.padding(WbSpace.S5),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(WbSpace.S3),
    ) {
        PlazaAvatar("plaza-me", me?.nickname ?: "我", me?.avatarUrl, 40.dp)
        Text("广场昵称：${me?.nickname ?: "未设置"}", Modifier.weight(1f))
        Text("›", color = colors.textTertiary)
    }
    me?.bannedUntil?.let { until ->
        Text(
            "你暂时不能发布作品" + if (until == "permanent") "" else "，${plazaDate(until)}后恢复",
            Modifier.fillMaxWidth().background(colors.bgSurface).padding(WbSpace.S4),
            color = colors.textDanger,
        )
    }
    Row(Modifier.fillMaxWidth().padding(horizontal = WbSpace.S5), horizontalArrangement = Arrangement.spacedBy(WbSpace.S2)) {
        FilterChip(selected = tab == "works", onClick = { tab = "works" }, label = { Text("作品") })
        FilterChip(selected = tab == "notices", onClick = { tab = "notices" }, label = {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(WbSpace.S2)) {
                Text("消息")
                if (unseen > 0 && tab != "notices") RedDot()
            }
        })
    }
    if (tab == "notices") {
        NoticeList(repository, owner)
        return
    }
    val items = works.data.orEmpty()
    when {
        works.loading && works.data == null -> LinearProgressIndicator(Modifier.fillMaxWidth())
        works.error != null && works.data == null ->
            Column(Modifier.padding(WbSpace.S5)) {
                Text("加载失败")
                TextButton(onClick = works::refresh) { Text("重试") }
            }
        items.isEmpty() ->
            Text(
                "还没有发布过作品 · 在和自己的角色聊天时，打开「聊天信息」就能发布",
                Modifier.padding(WbSpace.S5),
                color = colors.textSecondary,
            )
        else -> {
            val presets = characterProfiles(repository, items.mapNotNull { it.basedOnPresetId })
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
                items.forEach { work ->
                    WorkRow(
                        repository,
                        owner,
                        work.summary(),
                        presets[work.basedOnPresetId.orEmpty()],
                        status = plazaStatusNames[work.status] ?: "未知状态",
                    )
                    HorizontalDivider()
                }
            }
        }
    }
}

/** 消息分页：拉取即已读（T-087 交接）；点赞、评论、回复可跳作品页，举报结果、下架通知不跳转。 */
@Composable private fun ColumnScope.NoticeList(
    repository: SessionRepository,
    owner: OwnerRecord,
) {
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    val items = remember { mutableStateListOf<PlazaNotice>() }
    var cursor by remember { mutableStateOf<String?>(null) }
    var state by remember { mutableStateOf("loading") }
    suspend fun load(after: String?) {
        state = "loading"
        try {
            val page =
                repository.call(
                    Endpoints.plazaEndpointsListNotices,
                    query = buildMap { after?.let { put("cursor", it) } },
                    options = SessionCallOptions(owner = owner, networkOnly = true),
                )
            if (after == null) items.clear()
            items.addAll(page.items)
            cursor = page.nextCursor
            state = "ready"
        } catch (failure: CancellationException) {
            throw failure
        } catch (_: Exception) {
            state = "error"
        }
    }
    LaunchedEffect(Unit) { load(null) }
    if (state == "error" && items.isEmpty()) {
        Column(Modifier.padding(WbSpace.S5)) {
            Text("加载失败")
            TextButton(onClick = { scope.launch { load(null) } }) { Text("重试") }
        }
        return
    }
    if (state == "ready" && items.isEmpty()) {
        Text("还没有消息", Modifier.padding(WbSpace.S5), color = colors.textSecondary)
        return
    }
    val jumps = setOf("work_liked", "work_commented", "comment_replied")
    Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
        if (state == "loading" && items.isEmpty()) LinearProgressIndicator(Modifier.fillMaxWidth())
        items.forEach { notice ->
            val workId = notice.workId
            val jumpable = workId != null && notice.kind in jumps
            Row(
                Modifier
                    .fillMaxWidth()
                    .clickable(enabled = jumpable) { if (workId != null) PlazaNav.open(PlazaPage.Work(workId)) }
                    .padding(horizontal = WbSpace.S5, vertical = WbSpace.S3),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(WbSpace.S3),
            ) {
                if (!notice.seen) RedDot() else Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f)) {
                    Text(notice.text)
                    Text(plazaTime(notice.createdAt), color = colors.textTertiary, style = MaterialTheme.typography.bodySmall)
                }
            }
            HorizontalDivider()
        }
        val next = cursor
        if (next != null) {
            TextButton(onClick = { scope.launch { load(next) } }, enabled = state != "loading", modifier = Modifier.fillMaxWidth()) {
                Text("加载更多")
            }
        }
    }
}

// ---------- 发布流程（PLZ-02、PLZ-05） ----------

private class PublishUi {
    var step by mutableStateOf("form")
    var tagline by mutableStateOf("")
    var note by mutableStateOf("")
    var allowRemix by mutableStateOf(true)
    var commentsOpen by mutableStateOf(true)
    var useAvatar by mutableStateOf(true)
    var rights by mutableStateOf(false)
    var changeNote by mutableStateOf("")
    var existing by mutableStateOf<PlazaWorkDetail?>(null)
    var prefilled by mutableStateOf(false)
    var draft by mutableStateOf<PlazaPublishDraft?>(null)
    val kept = mutableStateListOf<String>()
    var confirmKeep by mutableStateOf<String?>(null)
    var rewrite by mutableStateOf<PrivacySpan?>(null)
    var blocked by mutableStateOf<String?>(null)
    var balanceShort by mutableStateOf(false)
    var slow by mutableStateOf(false)
    var loosened by mutableStateOf(false)
    var neverSheet by mutableStateOf(false)
    var publishing by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
}

@Composable internal fun ColumnScope.PublishPage(
    repository: SessionRepository,
    owner: OwnerRecord,
    page: PlazaPage.Publish,
) {
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    val ui = remember(page) { PublishUi() }
    val subjectId = page.characterId ?: page.presetId
    if (subjectId == null) {
        PlazaHeader("发布到人设广场")
        Text("没有找到要发布的角色", Modifier.padding(WbSpace.S5))
        return
    }
    val isVariant = page.characterId == null
    val source =
        buildJsonObject {
            if (isVariant) {
                put("kind", "preset_variant")
                put("presetCharacterId", subjectId)
            } else {
                put("kind", "custom_character")
                put("characterId", subjectId)
            }
        }
    val profile =
        remote("${owner.sessionId}:plaza-publish-profile:$subjectId") {
            repository.call(
                Endpoints.characterEndpointsGetProfile,
                params = mapOf("characterId" to subjectId),
                options = SessionCallOptions(owner = owner),
            )
        }
    // 已发布过时预填上一版的设置（发布新版本，PLZ-05 第 1 条）。契约没有来源角色 ID：按名字 / 预设 ID 匹配（同网页 T-097）。
    LaunchedEffect(profile.data) {
        val role = profile.data ?: return@LaunchedEffect
        if (ui.prefilled) return@LaunchedEffect
        userAction({}) {
            val mine = repository.call(Endpoints.plazaEndpointsListMyWorks, options = SessionCallOptions(owner = owner, networkOnly = true))
            val match =
                mine.items.find { work ->
                    when (val snapshot = parseSnapshot(repository.api.json, work.snapshot)) {
                        is ParsedSnapshot.Variant -> isVariant && snapshot.value.presetCharacterId == subjectId
                        is ParsedSnapshot.Custom -> !isVariant && snapshot.value.name == role.name
                        null -> false
                    }
                }
            ui.prefilled = true
            if (match != null) {
                ui.existing = match
                ui.tagline = match.settings.tagline
                ui.note = match.settings.publishNote
                ui.allowRemix = match.settings.allowRemix
                ui.commentsOpen = match.settings.commentsOpen
            }
        }
    }
    LaunchedEffect(ui.step) {
        if (ui.step != "checking") return@LaunchedEffect
        ui.slow = false
        delay(30_000)
        ui.slow = true
    }
    val role = profile.data
    val isReal = role?.basis == "real_person"
    val hasAvatar = !isVariant && role?.avatar?.image != null
    val newVersion = ui.draft?.workId != null || ui.existing != null

    suspend fun check() {
        ui.step = "checking"
        try {
            val value =
                repository.call(
                    Endpoints.plazaEndpointsCreatePublishDraft,
                    body = buildJsonObject { put("source", source) },
                    options = SessionCallOptions(owner = owner, networkOnly = true),
                )
            ui.draft = value
            if (value.needsAuthorProfile) {
                ui.step = "nickname"
                return
            }
            ui.kept.clear()
            ui.loosened = false
            ui.step = "confirm"
        } catch (failure: CancellationException) {
            throw failure
        } catch (failure: Exception) {
            when (plazaCode(failure)) {
                "insufficient_balance", "budget_exceeded" -> {
                    ui.balanceShort = true
                    ui.step = "form"
                }
                "plaza_publish_forbidden" -> {
                    ui.blocked = "暂时不能发布：可能是角色以身边的人为原型、原作者没有允许改编、作品已被管理员下架，或你暂时不能发布作品"
                    ui.step = "form"
                }
                "plaza_check_unavailable", "service_unavailable" -> ui.step = "check_failed"
                else -> {
                    ui.error = "操作暂未完成，请稍后再试"
                    ui.step = "form"
                }
            }
        }
    }

    fun next() {
        ui.error = null
        ui.balanceShort = false
        scope.launch {
            try {
                val mine = repository.call(Endpoints.plazaEndpointsGetMyProfile, options = SessionCallOptions(owner = owner, networkOnly = true))
                if (mine == null) {
                    ui.step = "nickname"
                    return@launch
                }
            } catch (failure: CancellationException) {
                throw failure
            } catch (_: Exception) {
                // 读不到时交给生成草稿判断。
            }
            check()
        }
    }

    when (ui.step) {
        "nickname" -> {
            PlazaHeader("广场昵称")
            NicknameForm(repository, owner) { scope.launch { check() } }
            return
        }
        "checking" -> {
            PlazaHeader("发布到人设广场")
            Column(Modifier.fillMaxWidth().padding(WbSpace.S5), verticalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
                repeat(3) { Surface(Modifier.fillMaxWidth().height(64.dp), color = colors.bgSkeleton, shape = MaterialTheme.shapes.small) {} }
                Text(if (ui.slow) "内容比较多，还在检查…" else "正在检查要发布的内容…", color = colors.textSecondary)
            }
            return
        }
        "check_failed" -> {
            PlazaHeader("发布到人设广场")
            Column(Modifier.padding(WbSpace.S5)) {
                Text("检查没有完成，请稍后再试")
                TextButton(onClick = { scope.launch { check() } }) { Text("重试") }
            }
            return
        }
    }
    val draft = ui.draft
    if (ui.step == "confirm" && draft != null) {
        PublishConfirm(repository, owner, ui, draft, isVariant, subjectId, hasAvatar && !isReal) { scope.launch { check() } }
        return
    }
    PublishForm(repository, owner, ui, role, isVariant, subjectId, hasAvatar, isReal, newVersion, ::next)
}

@Composable private fun ColumnScope.PublishForm(
    repository: SessionRepository,
    owner: OwnerRecord,
    ui: PublishUi,
    role: CharacterProfile?,
    isVariant: Boolean,
    subjectId: String,
    hasAvatar: Boolean,
    isReal: Boolean,
    newVersion: Boolean,
    onNext: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    val formReady =
        plazaChars(ui.tagline.trim()) > 0 &&
            plazaChars(ui.tagline) <= PLAZA_TAGLINE_MAX &&
            plazaChars(ui.note) <= PLAZA_NOTE_MAX &&
            (!newVersion || plazaChars(ui.changeNote.trim()) in 1..PLAZA_CHANGE_NOTE_MAX) &&
            (!hasAvatar || isReal || !ui.useAvatar || ui.rights)
    PlazaHeader(if (newVersion) "发布新版本" else "发布到人设广场") {
        Text("1/2", Modifier.padding(horizontal = WbSpace.S5), color = colors.textTertiary, style = MaterialTheme.typography.labelSmall)
    }
    Column(
        Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(WbSpace.S5),
        verticalArrangement = Arrangement.spacedBy(WbSpace.S3),
    ) {
        ui.blocked?.let { Text(it, color = colors.textDanger) }
        if (newVersion) {
            OutlinedTextField(
                ui.changeNote,
                { ui.changeNote = it },
                Modifier.fillMaxWidth(),
                label = { Text("更新说明（必填）") },
                supportingText = { CharCount(plazaChars(ui.changeNote), PLAZA_CHANGE_NOTE_MAX) },
            )
        }
        Text("介绍", style = MaterialTheme.typography.titleSmall)
        OutlinedTextField(
            ui.tagline,
            { ui.tagline = it },
            Modifier.fillMaxWidth(),
            singleLine = true,
            label = { Text("一句话介绍") },
            supportingText = { CharCount(plazaChars(ui.tagline), PLAZA_TAGLINE_MAX) },
        )
        OutlinedTextField(
            ui.note,
            { ui.note = it },
            Modifier.fillMaxWidth(),
            minLines = 3,
            label = { Text("发布说明（选填）") },
            supportingText = { CharCount(plazaChars(ui.note), PLAZA_NOTE_MAX) },
        )
        if (!isVariant) {
            Text("头像", style = MaterialTheme.typography.titleSmall)
            when {
                isReal -> PlazaFootnote("真人角色的头像不会发布，广场上显示默认头像")
                hasAvatar -> {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
                        RoleAvatar(repository, owner, RoleAvatarIdentity(subjectId, role?.name.orEmpty(), role?.avatar), 40.dp)
                        Text("使用这张头像", Modifier.weight(1f))
                        Switch(ui.useAvatar, { ui.useAvatar = it })
                    }
                    if (ui.useAvatar) {
                        Row(Modifier.clickable { ui.rights = !ui.rights }, verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(ui.rights, { ui.rights = it })
                            Text("我有权使用这张图片")
                        }
                    }
                }
                else -> PlazaFootnote("这个角色没有上传头像，广场上显示默认头像")
            }
        }
        Text("设置", style = MaterialTheme.typography.titleSmall)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("允许改编后再发布")
                PlazaFootnote("别人添加后修改，可以再发布为新作品，并标注改编自你")
            }
            Switch(ui.allowRemix, { ui.allowRemix = it })
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("开放评论", Modifier.weight(1f))
            Switch(ui.commentsOpen, { ui.commentsOpen = it })
        }
        role?.classification?.let { c ->
            if (!isVariant) PlazaFootnote("分类：${classificationText(c.basis, c.realPersonKind, c.ageSetting, c.childAppearance)}")
        }
        if (ui.balanceShort) {
            Text("余额不足，暂时不能发布 · 可在 我 › 服务 › 钱包 查看余额", color = colors.textDanger)
        }
        ui.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    }
    Button(
        onClick = onNext,
        enabled = formReady && ui.blocked == null && !ui.balanceShort,
        modifier = Modifier.fillMaxWidth().padding(horizontal = WbSpace.S5, vertical = WbSpace.S2),
    ) { Text("下一步") }
}

@Composable private fun ColumnScope.PublishConfirm(
    repository: SessionRepository,
    owner: OwnerRecord,
    ui: PublishUi,
    draft: PlazaPublishDraft,
    isVariant: Boolean,
    subjectId: String,
    avatarAllowed: Boolean,
    onRecheck: () -> Unit,
) {
    val context = LocalContext.current
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    val parsed = remember(draft) { parseSnapshot(repository.api.json, draft.snapshot) }
    val spans = remember(draft) { draft.spans.sortedWith(compareBy<PrivacySpan>({ it.fieldKey }, { it.start })) }
    val fields = remember(parsed) { parsed?.let(::snapshotFields).orEmpty().associateBy { it.key } }
    val pending = spans.filter { it.spanId !in ui.kept }
    fun numberOf(span: PrivacySpan) = spans.indexOfFirst { it.spanId == span.spanId }
    fun original(span: PrivacySpan) = codePointSlice(fields[span.fieldKey]?.text.orEmpty(), span.start.toInt(), span.end.toInt())
    fun boxes(span: PrivacySpan) = "▢".repeat((span.end - span.start).toInt().coerceIn(1, 8))

    fun publish() {
        ui.publishing = true
        ui.error = null
        scope.launch {
            try {
                val work =
                    repository.call(
                        Endpoints.plazaEndpointsConfirmPublish,
                        params = mapOf("draftId" to draft.draftId),
                        body =
                            buildJsonObject {
                                put(
                                    "settings",
                                    buildJsonObject {
                                        put("tagline", ui.tagline.trim())
                                        put("publishNote", ui.note)
                                        put("allowRemix", ui.allowRemix)
                                        put("commentsOpen", ui.commentsOpen)
                                    },
                                )
                                put("keptSpanIds", JsonArray(ui.kept.map(::JsonPrimitive)))
                                put("avatarRightsConfirmed", avatarAllowed && ui.useAvatar && ui.rights)
                                if (draft.workId != null) put("changeNote", ui.changeNote.trim())
                            },
                        options = SessionCallOptions(owner = owner),
                    )
                plazaToast(context, "已发布")
                PlazaNav.replace(PlazaPage.Work(work.workId))
            } catch (failure: CancellationException) {
                throw failure
            } catch (failure: Exception) {
                when (plazaCode(failure)) {
                    "plaza_classification_loosened" -> ui.loosened = true
                    "not_found" -> {
                        ui.error = "草稿已过期，请重新检查"
                        ui.step = "form"
                    }
                    "plaza_publish_forbidden" -> ui.error = "暂时不能发布"
                    else -> ui.error = "操作暂未完成，请稍后再试"
                }
            } finally {
                ui.publishing = false
            }
        }
    }

    val changeNoteBad = draft.workId != null && plazaChars(ui.changeNote.trim()) !in 1..PLAZA_CHANGE_NOTE_MAX
    val customClass = (parsed as? ParsedSnapshot.Custom)?.value?.classification
    PlazaHeader("发布内容确认") {
        Text("2/2", Modifier.padding(horizontal = WbSpace.S5), color = colors.textTertiary, style = MaterialTheme.typography.labelSmall)
    }
    Column(
        Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(WbSpace.S5),
        verticalArrangement = Arrangement.spacedBy(WbSpace.S3),
    ) {
        if (pending.isNotEmpty()) {
            Text(
                "⚠ 有 ${pending.size} 处可能是你的私人信息，已先遮住",
                Modifier.fillMaxWidth().background(colors.brandSoft).padding(WbSpace.S3),
                color = colors.brandOnSoft,
            )
            Text("需要你确认", style = MaterialTheme.typography.titleSmall)
            pending.forEach { span ->
                val text = fields[span.fieldKey]?.text.orEmpty()
                val before = codePointSlice(text, span.start.toInt() - 8, span.start.toInt())
                val after = codePointSlice(text, span.end.toInt(), span.end.toInt() + 8)
                Column(verticalArrangement = Arrangement.spacedBy(WbSpace.S1)) {
                    Text("${plazaMark(numberOf(span))} ${fieldLabel(span.fieldKey)} · 「…$before${boxes(span)}$after…」")
                    PlazaFootnote(span.kinds.joinToString(" / ") { plazaPrivacyNames[it] ?: "私人信息" })
                    Row(horizontalArrangement = Arrangement.spacedBy(WbSpace.S2)) {
                        FilledTonalButton(onClick = { ui.rewrite = span }) { Text("改写") }
                        OutlinedButton(onClick = { ui.confirmKeep = span.spanId }) { Text("保留") }
                    }
                }
            }
        }
        Text("将要发布的内容", style = MaterialTheme.typography.titleSmall)
        if (parsed != null) {
            ContentPreview(
                repository,
                owner,
                parsed,
                extra = {
                    if (draft.childFeaturesDetected && customClass?.ageSetting == "adult") {
                        Text("人设中有未成年特征，这个作品在任何人那里都不能开启成人模式", color = colors.textDanger)
                    }
                    if (ui.loosened) Text("新版本的分类不能比上一版更宽", color = colors.textDanger)
                },
            ) { field ->
                Text(maskedDraftText(field, spans, ui.kept, colors.brandSoft, colors.brandOnSoft, ::numberOf))
            }
        }
        Text("一句话介绍", color = colors.textSecondary, style = MaterialTheme.typography.labelMedium)
        Text(ui.tagline)
        if (ui.note.isNotBlank()) {
            Text("发布说明", color = colors.textSecondary, style = MaterialTheme.typography.labelMedium)
            Text(ui.note)
        }
        Text("设置", color = colors.textSecondary, style = MaterialTheme.typography.labelMedium)
        Text((if (ui.allowRemix) "允许改编后再发布" else "不允许改编") + " · " + (if (ui.commentsOpen) "开放评论" else "关闭评论"))
        if (draft.workId != null) {
            OutlinedTextField(
                ui.changeNote,
                { ui.changeNote = it },
                Modifier.fillMaxWidth(),
                label = { Text("更新说明（必填）") },
                supportingText = { CharCount(plazaChars(ui.changeNote), PLAZA_CHANGE_NOTE_MAX) },
            )
        }
        TextButton(onClick = { ui.neverSheet = true }) { Text("哪些内容不会发布 ›") }
        ui.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    }
    // 有待处理项时也可以发布：遮住的照样遮住发布（PLZ-02 验收）。
    Button(
        onClick = ::publish,
        enabled = !ui.publishing && !ui.loosened && !changeNoteBad,
        modifier = Modifier.fillMaxWidth().padding(horizontal = WbSpace.S5, vertical = WbSpace.S2),
    ) { Text(if (ui.publishing) "正在发布…" else "发布") }

    spans.find { it.spanId == ui.confirmKeep }?.let { span ->
        AlertDialog(
            onDismissRequest = { ui.confirmKeep = null },
            title = { Text("这不是你的私人信息？") },
            text = { Text("「${original(span)}」") },
            confirmButton = {
                TextButton(onClick = {
                    if (span.spanId !in ui.kept) ui.kept.add(span.spanId)
                    ui.confirmKeep = null
                }) { Text("这不是我的私人信息") }
            },
            dismissButton = { TextButton(onClick = { ui.confirmKeep = null }) { Text("取消") } },
        )
    }
    ui.rewrite?.let { span ->
        RewriteDialog(repository, owner, span, parsed, isVariant, subjectId, { ui.rewrite = null }) {
            ui.rewrite = null
            onRecheck()
        }
    }
    if (ui.neverSheet) {
        AlertDialog(
            onDismissRequest = { ui.neverSheet = false },
            title = { Text("这些内容永远不会发布") },
            text = { Column { plazaNeverPublished.forEach { Text("· $it") } } },
            confirmButton = { TextButton(onClick = { ui.neverSheet = false }) { Text("知道了") } },
        )
    }
}

/** 确认页的字段文字：未保留的片段以「① ▢▢▢」遮盖，已保留的片段高亮（C 18.4）。按码点切片。 */
private fun maskedDraftText(
    field: SnapshotField,
    spans: List<PrivacySpan>,
    kept: List<String>,
    soft: androidx.compose.ui.graphics.Color,
    onSoft: androidx.compose.ui.graphics.Color,
    numberOf: (PrivacySpan) -> Int,
) = buildAnnotatedString {
    val list = spans.filter { it.fieldKey == field.key }
    val total = plazaChars(field.text)
    var at = 0
    list.forEach { span ->
        val start = span.start.toInt().coerceIn(at, total)
        val end = span.end.toInt().coerceIn(start, total)
        if (start > at) append(codePointSlice(field.text, at, start))
        if (span.spanId in kept) {
            withStyle(SpanStyle(background = soft)) { append(codePointSlice(field.text, start, end)) }
        } else {
            withStyle(SpanStyle(background = soft, color = onSoft)) {
                append("${plazaMark(numberOf(span))} " + "▢".repeat((end - start).coerceIn(1, 8)))
            }
        }
        at = end
    }
    if (at < total) append(codePointSlice(field.text, at, total))
}

/**
 * 「改写」：推入单个字段的编辑（这里用弹窗），保存后重新生成草稿（系统对改动后的文字重新识别）。
 * 自定义角色写回 PATCH /characters/custom/:id；预设改版写回补充设定。说话方式和第 2 条以后的口头禅契约没有对应的可写字段，
 * 提示到网页修改。
 */
@Composable private fun RewriteDialog(
    repository: SessionRepository,
    owner: OwnerRecord,
    span: PrivacySpan,
    parsed: ParsedSnapshot?,
    isVariant: Boolean,
    subjectId: String,
    onDismiss: () -> Unit,
    onSaved: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val custom = (parsed as? ParsedSnapshot.Custom)?.value
    val key = span.fieldKey
    val index = key.substringAfter('.', "").toIntOrNull()
    val initial =
        when {
            isVariant -> (parsed as? ParsedSnapshot.Variant)?.value?.variantText.orEmpty()
            key == "name" -> custom?.name.orEmpty()
            key == "description" -> custom?.description.orEmpty()
            key == "exampleDialogue" -> custom?.exampleDialogue.orEmpty()
            key.startsWith("tags.") && index != null -> custom?.tags?.getOrNull(index).orEmpty()
            key == "catchphrases.0" -> custom?.catchphrases?.firstOrNull().orEmpty()
            else -> null
        }
    var text by remember(span.spanId) { mutableStateOf(initial.orEmpty()) }
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = { if (!pending) onDismiss() },
        title = { Text("改写 · ${fieldLabel(key)}") },
        text = {
            if (initial == null) {
                Text("这一项暂时不能在安卓上直接改写，请到网页的角色编辑里修改后再发布；也可以选择「保留」或直接发布（会遮住）。")
            } else {
                Column {
                    OutlinedTextField(text, { text = it }, Modifier.fillMaxWidth(), minLines = 3)
                    error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                }
            }
        },
        confirmButton = {
            if (initial != null) {
                TextButton(enabled = !pending && text.isNotBlank(), onClick = {
                    pending = true
                    error = null
                    scope.launch {
                        try {
                            if (isVariant) {
                                repository.call(
                                    Endpoints.characterSupplementEndpointsPutSupplement,
                                    params = mapOf("characterId" to subjectId),
                                    body = buildJsonObject { put("text", text.trim()) },
                                    options = SessionCallOptions(owner = owner, networkOnly = true),
                                )
                            } else {
                                val body =
                                    buildJsonObject {
                                        when {
                                            key.startsWith("tags.") && index != null && custom != null ->
                                                put(
                                                    "tags",
                                                    JsonArray(
                                                        custom.tags
                                                            .mapIndexed { i, tag -> if (i == index) text.trim() else tag }
                                                            .filter { it.isNotBlank() }
                                                            .map(::JsonPrimitive),
                                                    ),
                                                )
                                            key == "catchphrases.0" -> put("catchphrase", text.trim())
                                            else -> put(key, text.trim())
                                        }
                                    }
                                repository.call(
                                    Endpoints.userCustomEndpointsUpdate,
                                    params = mapOf("characterId" to subjectId),
                                    body = body,
                                    options = SessionCallOptions(owner = owner),
                                )
                            }
                            onSaved()
                        } catch (failure: CancellationException) {
                            throw failure
                        } catch (failure: Exception) {
                            error =
                                if (plazaCode(failure) == "classification_change_forbidden") {
                                    "分类只能改得更严格"
                                } else {
                                    "保存没有成功，请稍后再试"
                                }
                        } finally {
                            pending = false
                        }
                    }
                }) { Text("保存并重新检查") }
            }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !pending) { Text("取消") } },
    )
}
