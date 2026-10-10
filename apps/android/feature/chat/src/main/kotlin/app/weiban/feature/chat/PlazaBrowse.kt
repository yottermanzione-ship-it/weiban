@file:Suppress("TooGenericExceptionCaught", "LongMethod", "CyclomaticComplexMethod", "LongParameterList")

package app.weiban.feature.chat

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.weiban.contracts.*
import app.weiban.data.*
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.tokens.WbSpace
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

/**
 * 广场浮层：盖在所有页面上，按 PlazaNav 返回栈显示作品页、作者页、举报、广场昵称、我发布的、发布流程。
 * 由 GrowthShareOverlay 放置。
 */
@Composable internal fun PlazaOverlay(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
) {
    val stack by PlazaNav.stack.collectAsState()
    // 换账号或退出登录时清空广场返回栈。
    DisposableEffect(owner) { onDispose { PlazaNav.close() } }
    val page = stack.lastOrNull() ?: return
    val colors = LocalWeibanColors.current
    BackHandler(onBack = PlazaNav::back)
    Surface(Modifier.fillMaxSize(), color = colors.bgPage) {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            key(stack.size, page) {
                when (page) {
                    is PlazaPage.Work -> WorkPage(repository, runtime, owner, page.workId)
                    is PlazaPage.Author -> AuthorPage(repository, owner, page.authorId)
                    is PlazaPage.Report -> ReportPage(repository, owner, page)
                    PlazaPage.Profile -> PlazaProfilePage(repository, owner)
                    PlazaPage.MyWorks -> MyWorksPage(repository, owner)
                    is PlazaPage.Publish -> PublishPage(repository, owner, page)
                }
            }
        }
    }
}

// ---------- 广场分页（PLZ-01） ----------

private val plazaSorts = listOf("hot" to "热门", "latest" to "最新发布", "most_liked" to "点赞最多")
private val plazaKinds = listOf("" to "全部类型", "custom_character" to "自定义角色", "preset_variant" to "预设改版")
private val plazaBases = listOf("" to "全部分类", "original" to "原创", "fictional" to "虚构", "real_person" to "真人")

/** 「角色广场 › 人设广场」分页：搜索、排序、两种筛选、作品列表、右上「我发布的」红点。 */
@Composable internal fun ColumnScope.PlazaTab(
    repository: SessionRepository,
    owner: OwnerRecord,
) {
    val badge = rememberPlazaBadge(repository, owner)
    var query by remember { mutableStateOf("") }
    var search by remember { mutableStateOf("") }
    var sort by remember { mutableStateOf("hot") }
    var kind by remember { mutableStateOf("") }
    var basis by remember { mutableStateOf("") }
    Row(Modifier.fillMaxWidth().padding(horizontal = WbSpace.S5), verticalAlignment = Alignment.CenterVertically) {
        Text("人设广场", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
        TextButton(onClick = { PlazaNav.open(PlazaPage.MyWorks) }) {
            Text("我发布的")
            if (badge != null && badge.myWorksUnseen + badge.reportResultsUnseen > 0) RedDot()
        }
    }
    Row(Modifier.fillMaxWidth().padding(horizontal = WbSpace.S5), verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(
            query,
            { query = it.take(50) },
            Modifier.weight(1f),
            singleLine = true,
            label = { Text("搜索角色、标签、作者、基于的角色") },
        )
        TextButton(onClick = { search = query.trim() }) { Text("搜索") }
    }
    Row(Modifier.fillMaxWidth().padding(horizontal = WbSpace.S5), horizontalArrangement = Arrangement.spacedBy(WbSpace.S2)) {
        PlazaPicker(plazaSorts, sort, true) { sort = it }
        PlazaPicker(plazaKinds, kind, true) {
            kind = it
            if (it == "preset_variant") basis = ""
        }
        PlazaPicker(plazaBases, basis, kind != "preset_variant") { basis = it }
    }
    key(search, sort, kind, basis) {
        WorkList(repository, owner, search = search, sort = sort, kind = kind, basis = basis, authorId = null)
    }
}

/** 胶囊 + 下拉选项（排序 / 类型 / 分类）。 */
@Composable private fun PlazaPicker(
    options: List<Pair<String, String>>,
    value: String,
    enabled: Boolean,
    onChange: (String) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    Box {
        FilterChip(
            selected = value != options.first().first,
            enabled = enabled,
            onClick = { open = true },
            label = { Text((options.find { it.first == value }?.second ?: options.first().second) + " ▾") },
        )
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { (id, label) ->
                DropdownMenuItem(text = { Text(label) }, onClick = {
                    open = false
                    onChange(id)
                })
            }
        }
    }
}

private class WorkListState {
    val items = mutableStateListOf<PlazaWorkCard>()
    var cursor by mutableStateOf<String?>(null)
    var loading by mutableStateOf(true)
    var failed by mutableStateOf(false)
}

/** 作品列表（广场分页与作者页共用）：行高固定 88，「加载更多」；骨架、空、无结果、失败四种状态。 */
@Composable internal fun ColumnScope.WorkList(
    repository: SessionRepository,
    owner: OwnerRecord,
    search: String,
    sort: String,
    kind: String,
    basis: String,
    authorId: String?,
) {
    val colors = LocalWeibanColors.current
    val list = remember { WorkListState() }
    val scope = rememberCoroutineScope()

    suspend fun load(after: String?) {
        list.loading = true
        list.failed = false
        try {
            val page =
                repository.call(
                    Endpoints.plazaEndpointsListWorks,
                    query =
                        buildMap {
                            put("sort", sort)
                            put("limit", "20")
                            if (search.isNotBlank()) put("q", search)
                            if (kind.isNotBlank()) put("kind", kind)
                            if (basis.isNotBlank()) put("basis", basis)
                            authorId?.let { put("authorId", it) }
                            after?.let { put("cursor", it) }
                        },
                    options = SessionCallOptions(owner = owner, networkOnly = true),
                )
            if (after == null) list.items.clear()
            list.items.addAll(page.items)
            list.cursor = page.nextCursor
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            list.failed = true
        } finally {
            list.loading = false
        }
    }
    LaunchedEffect(Unit) { load(null) }
    val presets = characterProfiles(repository, list.items.mapNotNull { it.basedOnPresetId })
    when {
        list.loading && list.items.isEmpty() ->
            Column(Modifier.padding(WbSpace.S5), verticalArrangement = Arrangement.spacedBy(WbSpace.S2)) {
                repeat(if (authorId != null) 3 else 6) {
                    Surface(Modifier.fillMaxWidth().height(80.dp), color = colors.bgSkeleton, shape = MaterialTheme.shapes.small) {}
                }
            }
        list.failed && list.items.isEmpty() ->
            Column(Modifier.padding(WbSpace.S5)) {
                Text("加载失败")
                TextButton(onClick = { scope.launch { load(null) } }) { Text("重试") }
            }
        list.items.isEmpty() ->
            Text(
                when {
                    authorId != null -> "TA 还没有公开的作品"
                    search.isNotBlank() -> "没有找到「$search」"
                    else -> "还没有人发布角色 · 在和自己的角色聊天时，可以从「聊天信息」发布到这里"
                },
                Modifier.padding(WbSpace.S5),
                color = colors.textSecondary,
            )
        else ->
            LazyColumn(Modifier.weight(1f)) {
                items(list.items, key = { it.workId }) { work ->
                    WorkRow(repository, owner, work.summary(), presets[work.basedOnPresetId.orEmpty()], search)
                    HorizontalDivider()
                }
                list.cursor?.let { next ->
                    item {
                        TextButton(onClick = { scope.launch { load(next) } }, enabled = !list.loading, modifier = Modifier.fillMaxWidth()) {
                            Text(if (list.loading) "正在读取…" else "加载更多")
                        }
                    }
                }
            }
    }
}

/** WorkRow（C 18.1）：列表里没有「添加」按钮，必须进作品页看完再拿。 */
@Composable internal fun WorkRow(
    repository: SessionRepository,
    owner: OwnerRecord,
    work: WorkSummary,
    preset: CharacterProfile?,
    search: String = "",
    status: String? = null,
) {
    val colors = LocalWeibanColors.current
    val hit = search.isNotBlank() && work.basedOnPresetName?.contains(search) == true
    Row(
        Modifier
            .fillMaxWidth()
            .height(88.dp)
            .clickable { PlazaNav.open(PlazaPage.Work(work.workId)) }
            .padding(horizontal = WbSpace.S5),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(WbSpace.S4),
    ) {
        WorkAvatar(repository, owner, work, preset)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(WbSpace.S1)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(WbSpace.S2)) {
                Text(work.name, Modifier.weight(1f, fill = false), maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (status != null) {
                    Text(
                        status,
                        color =
                            if (status ==
                                "展示中"
                            ) {
                                colors.textSecondary
                            } else {
                                colors.textDanger
                            },
                        style = MaterialTheme.typography.labelSmall,
                    )
                } else {
                    KindTag(work, hit)
                }
            }
            if (status == null) {
                Text(
                    work.tagline,
                    color = colors.textSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.bodySmall,
                )
                Text(
                    "${plazaAuthorName(work.author)} · 赞 ${work.likeCount} · 添加 ${work.adoptCount}",
                    color = colors.textTertiary,
                    style = MaterialTheme.typography.bodySmall,
                )
            } else {
                Text(
                    "版本 ${work.currentVersion} · 赞 ${work.likeCount} · 添加 ${work.adoptCount}",
                    color = colors.textTertiary,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
        if (status == null && work.adoptedByMe) Text("已添加", color = colors.textTertiary, style = MaterialTheme.typography.bodySmall)
    }
}

// ---------- 作品页（PLZ-01 第 6 条、PLZ-03、PLZ-04） ----------

/** 公开快照里已遮盖的「▢」高亮显示（C 18.4）。 */
@Composable internal fun MaskedText(text: String) {
    val colors = LocalWeibanColors.current
    val annotated =
        androidx.compose.ui.text.buildAnnotatedString {
            Regex("▢+|[^▢]+").findAll(text).forEach { part ->
                if (part.value.startsWith("▢")) {
                    pushStyle(
                        androidx.compose.ui.text
                            .SpanStyle(background = colors.brandSoft, color = colors.brandOnSoft),
                    )
                    append(part.value)
                    pop()
                } else {
                    append(part.value)
                }
            }
        }
    Text(annotated)
}

/** ContentPreview（C 18.3）：自定义角色先列分类；预设改版先列基于的角色。 */
@Composable internal fun ContentPreview(
    repository: SessionRepository,
    owner: OwnerRecord,
    snapshot: ParsedSnapshot,
    extra: @Composable () -> Unit = {},
    renderText: @Composable (SnapshotField) -> Unit,
) {
    val colors = LocalWeibanColors.current
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(WbSpace.S2)) {
        when (snapshot) {
            is ParsedSnapshot.Variant -> {
                val presetId = snapshot.value.presetCharacterId
                val preset = characterProfiles(repository, listOf(presetId))[presetId]
                Text("基于的角色", color = colors.textSecondary, style = MaterialTheme.typography.labelMedium)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(WbSpace.S2)) {
                    RoleAvatar(repository, owner, RoleAvatarIdentity(presetId, preset?.name.orEmpty(), preset?.avatar), 24.dp)
                    Text("${preset?.name ?: "预设角色"}（预设角色）")
                }
            }
            is ParsedSnapshot.Custom -> {
                val c = snapshot.value.classification
                Text("分类", color = colors.textSecondary, style = MaterialTheme.typography.labelMedium)
                Text(classificationText(c.basis, c.realPersonKind, c.ageSetting, c.childAppearance))
                PlazaFootnote("添加后分类与原作品相同，之后只能改得更严格")
            }
        }
        extra()
        snapshotFields(snapshot).forEach { field ->
            if (field.label.isNotEmpty()) Text(field.label, color = colors.textSecondary, style = MaterialTheme.typography.labelMedium)
            renderText(field)
        }
        if (snapshot is ParsedSnapshot.Custom) {
            snapshot.value.birthday?.let {
                Text("生日", color = colors.textSecondary, style = MaterialTheme.typography.labelMedium)
                Text(it)
            }
            snapshot.value.voiceName?.let {
                Text("音色", color = colors.textSecondary, style = MaterialTheme.typography.labelMedium)
                Text(it)
            }
        }
    }
}

private class WorkUi {
    var work by mutableStateOf<PlazaWorkDetail?>(null)
    var state by mutableStateOf("loading")
    var pending by mutableStateOf(false)
    var dialog by mutableStateOf<String?>(null)
    var adoptedCharacter by mutableStateOf<String?>(null)
    var revision by mutableIntStateOf(0)
}

@Composable private fun ColumnScope.WorkPage(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    workId: String,
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    val ui = remember(workId) { WorkUi() }
    val snapshot by runtime.snapshot.collectAsState()
    val chat = if (snapshot.owner == owner) snapshot.state else SyncEngine.freshState()
    var sheet by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(ui.revision) {
        if (ui.work == null) ui.state = "loading"
        try {
            ui.work =
                repository.call(
                    Endpoints.plazaEndpointsGetWork,
                    params = mapOf("workId" to workId),
                    options = SessionCallOptions(owner = owner, networkOnly = true),
                )
            ui.state = "ready"
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            ui.state = if (plazaCode(error) == "not_found") "gone" else "error"
        }
    }
    val w = ui.work
    if (w == null || ui.state == "gone") {
        PlazaHeader("")
        when (ui.state) {
            "loading" -> LinearProgressIndicator(Modifier.fillMaxWidth())
            "gone" -> Text("这个作品已经看不到了", Modifier.padding(WbSpace.S5), color = colors.textSecondary)
            else ->
                Column(Modifier.padding(WbSpace.S5)) {
                    Text("加载失败")
                    TextButton(onClick = { ui.revision++ }) { Text("重试") }
                }
        }
        return
    }
    val parsed = remember(w.snapshot) { parseSnapshot(repository.api.json, w.snapshot) }
    val presetId = (parsed as? ParsedSnapshot.Variant)?.value?.presetCharacterId
    val presetContact = presetId?.let { id -> chat.contacts.find { it.characterId == id } }
    val presetName = w.basedOnPresetName ?: "预设角色"
    val latest = w.versions.maxByOrNull { it.version }
    val removedByAdmin = w.status == "removed_by_admin"

    fun adopt() {
        ui.dialog = null
        ui.pending = true
        scope.launch {
            try {
                val result =
                    repository.call(
                        Endpoints.plazaEndpointsAdopt,
                        params = mapOf("workId" to workId),
                        body =
                            buildJsonObject {
                                put(
                                    "adoptionId",
                                    java.util.UUID
                                        .randomUUID()
                                        .toString(),
                                )
                            },
                        options = SessionCallOptions(owner = owner),
                    )
                // 服务器已自动加进通讯录（T-088），只同步一次通讯录，不调 POST /contacts。
                userAction({}) { runtime.refresh(owner) }
                ui.adoptedCharacter = result.characterId
                ui.work = w.copy(adoptedByMe = true, adoptCount = w.adoptCount + 1)
                plazaToast(context, "已添加，等待 TA 通过好友申请")
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                if (plazaCode(error) == "contact_limit_reached") ui.dialog = "full" else plazaToast(context, "操作暂未完成，请稍后再试")
            } finally {
                ui.pending = false
            }
        }
    }

    fun applyVariant(confirmReplace: Boolean) {
        ui.dialog = null
        ui.pending = true
        scope.launch {
            try {
                val result =
                    repository.call(
                        Endpoints.plazaEndpointsApply,
                        params = mapOf("workId" to workId),
                        body =
                            buildJsonObject {
                                put(
                                    "adoptionId",
                                    java.util.UUID
                                        .randomUUID()
                                        .toString(),
                                )
                                put("confirmReplaceSupplement", confirmReplace)
                            },
                        options = SessionCallOptions(owner = owner),
                    )
                userAction({}) { runtime.refresh(owner) }
                ui.adoptedCharacter = result.characterId
                ui.work = w.copy(adoptedByMe = true)
                plazaToast(context, if (presetContact != null) "已应用到 $presetName" else "已添加 $presetName 并应用改版")
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                when (plazaCode(error)) {
                    "conflict" -> ui.dialog = "replace"
                    "contact_limit_reached" -> ui.dialog = "full"
                    else -> plazaToast(context, "操作暂未完成，请稍后再试")
                }
            } finally {
                ui.pending = false
            }
        }
    }

    fun toggleLike() {
        val before = w
        val liked = !w.likedByMe
        ui.work = w.copy(likedByMe = liked, likeCount = (w.likeCount + if (liked) 1 else -1).coerceAtLeast(0))
        scope.launch {
            try {
                val params = mapOf("workId" to workId)
                val options = SessionCallOptions(owner = owner)
                if (liked) {
                    val result = repository.call(Endpoints.plazaEndpointsLike, params = params, options = options)
                    ui.work = ui.work?.copy(likeCount = result.likeCount, likedByMe = result.likedByMe)
                } else {
                    val result = repository.call(Endpoints.plazaEndpointsUnlike, params = params, options = options)
                    ui.work = ui.work?.copy(likeCount = result.likeCount, likedByMe = result.likedByMe)
                }
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                ui.work = before
                plazaToast(context, "没成功，请重试")
            }
        }
    }

    fun manage(action: String) {
        sheet = null
        ui.dialog = null
        ui.pending = true
        scope.launch {
            try {
                val params = mapOf("workId" to workId)
                val options = SessionCallOptions(owner = owner)
                when (action) {
                    "comments" -> {
                        val open = !w.settings.commentsOpen
                        ui.work =
                            repository.call(
                                Endpoints.plazaEndpointsUpdateWorkSettings,
                                params = params,
                                body = buildJsonObject { put("commentsOpen", open) },
                                options = options,
                            )
                        plazaToast(context, if (open) "已开启评论" else "已关闭评论")
                    }
                    "unlist" -> {
                        ui.work = repository.call(Endpoints.plazaEndpointsUnlistWork, params = params, options = options)
                        plazaToast(context, "已下架")
                    }
                    "relist" -> {
                        ui.work = repository.call(Endpoints.plazaEndpointsRelistWork, params = params, options = options)
                        plazaToast(context, "已重新上架")
                    }
                    else -> {
                        repository.call(Endpoints.plazaEndpointsDeleteWork, params = params, options = options)
                        plazaToast(context, "已删除")
                        PlazaNav.back()
                    }
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                plazaToast(context, if (plazaCode(error) == "plaza_publish_forbidden") "这个作品已被管理员下架" else "操作暂未完成，请稍后再试")
            } finally {
                ui.pending = false
            }
        }
    }

    fun publishNewVersion() {
        sheet = null
        when (parsed) {
            is ParsedSnapshot.Variant -> PlazaNav.open(PlazaPage.Publish(null, parsed.value.presetCharacterId))
            is ParsedSnapshot.Custom ->
                scope.launch {
                    // 契约没有作品的来源角色 ID：按名字匹配我的自定义角色（与网页 T-097 相同）。
                    userAction({ plazaToast(context, it) }) {
                        val mine =
                            repository.call(
                                Endpoints.userCustomEndpointsList,
                                options = SessionCallOptions(owner = owner, networkOnly = true),
                            )
                        val match = mine.items.find { it.name == parsed.value.name }
                        if (match != null) {
                            PlazaNav.open(PlazaPage.Publish(match.characterId, null))
                        } else {
                            plazaToast(context, "请从这个角色的「聊天信息」发布新版本")
                        }
                    }
                }
            null -> plazaToast(context, "请从这个角色的「聊天信息」发布新版本")
        }
    }

    PlazaHeader("") { TextButton(onClick = { sheet = "menu" }) { Text("···") } }
    Column(
        Modifier
            .weight(1f)
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = WbSpace.S5),
        verticalArrangement = Arrangement.spacedBy(WbSpace.S3),
    ) {
        Column(
            Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(WbSpace.S2),
        ) {
            val presetProfile = presetId?.let { characterProfiles(repository, listOf(it))[it] }
            WorkAvatar(repository, owner, w.summary(), presetProfile, 64.dp)
            Text(w.name, style = MaterialTheme.typography.titleLarge)
            KindTag(w.summary())
            Text(w.tagline, color = colors.textSecondary)
            w.remixOf?.let { remix ->
                Text(
                    "改编自《${remix.name}》· 原作者 ${remix.authorNickname}",
                    Modifier.clickable(enabled = remix.available) { PlazaNav.open(PlazaPage.Work(remix.workId)) },
                    color = colors.textSecondary,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            if (w.author.deleted) {
                Text("已注销用户", color = colors.textSecondary)
            } else {
                Row(
                    Modifier.clickable { PlazaNav.open(PlazaPage.Author(w.author.authorId)) },
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(WbSpace.S2),
                ) {
                    PlazaAvatar(w.author.authorId, w.author.nickname, w.author.avatarUrl, 24.dp)
                    Text("${w.author.nickname} ›")
                }
            }
            TextButton(onClick = { sheet = "versions" }) {
                Text("版本 ${w.currentVersion}" + (latest?.let { " · ${plazaDate(it.createdAt)}更新" } ?: ""))
            }
            if (w.isMine && w.status != "listed") {
                Text(
                    when (w.status) {
                        "removed_by_admin" -> "被管理员下架"
                        "author_banned" -> "暂不展示"
                        else -> "已下架"
                    },
                    color = colors.textDanger,
                )
            }
        }
        if (w.settings.publishNote.isNotBlank()) {
            Text("发布说明", style = MaterialTheme.typography.titleSmall)
            Text(w.settings.publishNote)
        }
        Text("你将得到的内容", style = MaterialTheme.typography.titleSmall)
        if (parsed != null) ContentPreview(repository, owner, parsed) { MaskedText(it.text) }
        PlazaFootnote("ⓘ 只复制上面这些内容；作者的聊天记录、记忆和个人资料不会出现在广场上")
        CommentSection(repository, owner, w) { count -> ui.work = ui.work?.copy(commentCount = count) }
    }
    HorizontalDivider()
    Row(
        Modifier.fillMaxWidth().padding(horizontal = WbSpace.S5, vertical = WbSpace.S2),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(WbSpace.S2),
    ) {
        TextButton(onClick = ::toggleLike) { Text((if (w.likedByMe) "已赞 " else "赞 ") + w.likeCount) }
        Text("评论 ${w.commentCount}", color = colors.textSecondary)
        Spacer(Modifier.weight(1f))
        val adopted = ui.adoptedCharacter
        when {
            w.isMine -> OutlinedButton(onClick = { sheet = "menu" }, enabled = !ui.pending) { Text("管理") }
            adopted != null ->
                TextButton(onClick = {
                    val conversationId = chat.contacts.find { it.characterId == adopted }?.conversationId
                    if (conversationId != null) {
                        PlazaNav.close()
                        GrowthNavigation.openConversation(conversationId)
                    } else {
                        plazaToast(context, "等待 TA 通过好友申请")
                    }
                }) { Text("已添加 · 去聊天") }
            else -> {
                val adoptLabel = if (w.kind == "preset_variant") "添加为新角色" else "添加为我的角色"
                if (w.kind == "preset_variant") {
                    OutlinedButton(onClick = { if (w.adoptedByMe) ui.dialog = "adopted" else adopt() }, enabled = !ui.pending) {
                        Text(if (ui.pending) "正在添加…" else adoptLabel)
                    }
                    Button(onClick = { applyVariant(false) }, enabled = !ui.pending) {
                        Text(if (presetContact != null) "应用到我的 $presetName" else "添加 $presetName 并应用", maxLines = 1)
                    }
                } else {
                    Button(onClick = { if (w.adoptedByMe) ui.dialog = "adopted" else adopt() }, enabled = !ui.pending) {
                        Text(if (ui.pending) "正在添加…" else adoptLabel)
                    }
                }
            }
        }
    }
    when (sheet) {
        "versions" ->
            AlertDialog(
                onDismissRequest = { sheet = null },
                title = { Text("版本记录") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
                        w.versions.sortedByDescending { it.version }.forEach { version ->
                            Text("版本 ${version.version} · ${version.createdAt.take(10)}")
                            version.changeNote?.let { PlazaFootnote(it) }
                        }
                    }
                },
                confirmButton = { TextButton(onClick = { sheet = null }) { Text("关闭") } },
            )
        "menu" ->
            AlertDialog(
                onDismissRequest = { sheet = null },
                title = { Text(if (w.isMine) "管理" else "更多") },
                text = {
                    Column {
                        if (w.isMine) {
                            if (!removedByAdmin) TextButton(onClick = ::publishNewVersion) { Text("发布新版本") }
                            TextButton(onClick = { manage("comments") }) { Text(if (w.settings.commentsOpen) "关闭评论" else "开启评论") }
                            if (w.status == "listed") TextButton(onClick = { ui.dialog = "unlist" }) { Text("下架") }
                            if (w.status == "unlisted_by_author") TextButton(onClick = { manage("relist") }) { Text("重新上架") }
                            TextButton(onClick = { ui.dialog = "delete" }) { Text("删除作品", color = colors.textDanger) }
                        } else if ("work:$workId" in PlazaReported.targets) {
                            TextButton(onClick = {}, enabled = false) { Text("已举报") }
                        } else {
                            TextButton(onClick = {
                                sheet = null
                                PlazaNav.open(PlazaPage.Report(workId, null))
                            }) { Text("举报") }
                        }
                    }
                },
                confirmButton = { TextButton(onClick = { sheet = null }) { Text("取消") } },
            )
    }
    WorkDialogs(ui, ::adopt, ::applyVariant, ::manage)
}

@Composable private fun WorkDialogs(
    ui: WorkUi,
    adopt: () -> Unit,
    apply: (Boolean) -> Unit,
    manage: (String) -> Unit,
) {
    val close = { ui.dialog = null }
    when (ui.dialog) {
        "adopted" -> PlazaConfirm("你已添加过这个角色", null, "再添加一份", close, adopt)
        "replace" -> PlazaConfirm("替换补充设定？", "将替换你现有的补充设定。你们的聊天记录、记忆和熟悉度都不会变", "替换", close) { apply(true) }
        "full" ->
            AlertDialog(
                onDismissRequest = close,
                title = { Text("通讯录已满") },
                text = { Text("通讯录已满 50 个角色，先删除一些再添加吧") },
                confirmButton = { TextButton(onClick = close) { Text("知道了") } },
            )
        "unlist" -> PlazaConfirm("下架作品？", "下架后，广场上看不到这个作品，已经添加的人不受影响", "下架", close) { manage("unlist") }
        "delete" -> PlazaConfirm("删除作品？", "作品和它的点赞、评论都会删除，不能恢复。已经添加的人不受影响", "删除", close) { manage("delete") }
    }
}

@Composable internal fun PlazaConfirm(
    title: String,
    text: String?,
    confirm: String,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text =
            if (text != null) {
                { Text(text) }
            } else {
                null
            },
        confirmButton = { TextButton(onClick = onConfirm) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

// ---------- 评论（PLZ-03） ----------

private class CommentUi {
    val items = mutableStateListOf<PlazaComment>()
    var cursor by mutableStateOf<String?>(null)
    var loading by mutableStateOf(true)
    var showAll by mutableStateOf(false)
    var composing by mutableStateOf(false)
    var text by mutableStateOf("")
    var replyTo by mutableStateOf<PlazaComment?>(null)
    var sending by mutableStateOf(false)
    var requestId =
        java.util.UUID
            .randomUUID()
            .toString()
}

@Composable private fun CommentSection(
    repository: SessionRepository,
    owner: OwnerRecord,
    work: PlazaWorkDetail,
    onCount: (Long) -> Unit,
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    val ui = remember(work.workId) { CommentUi() }

    suspend fun load(after: String?) {
        ui.loading = true
        try {
            val page =
                repository.call(
                    Endpoints.plazaEndpointsListComments,
                    params = mapOf("workId" to work.workId),
                    query = buildMap { after?.let { put("cursor", it) } },
                    options = SessionCallOptions(owner = owner, networkOnly = true),
                )
            if (after == null) ui.items.clear()
            ui.items.addAll(page.items)
            ui.cursor = page.nextCursor
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            // 评论读不到时只显示空列表。
        } finally {
            ui.loading = false
        }
    }
    LaunchedEffect(work.workId, work.settings.commentsOpen) { load(null) }
    // 安卓系统返回在评论输入栏打开时先收起输入栏（设计第 9 节）。
    BackHandler(ui.composing) {
        ui.composing = false
        ui.replyTo = null
    }
    if (!work.settings.commentsOpen) {
        Text("评论", style = MaterialTheme.typography.titleSmall)
        Text("作者关闭了评论", color = colors.textTertiary, style = MaterialTheme.typography.bodySmall)
        return
    }

    fun startCompose(target: PlazaComment?) {
        scope.launch {
            try {
                val profile =
                    repository.call(
                        Endpoints.plazaEndpointsGetMyProfile,
                        options = SessionCallOptions(owner = owner, networkOnly = true),
                    )
                if (profile == null) {
                    PlazaNav.open(PlazaPage.Profile)
                    return@launch
                }
                if (profile.bannedUntil != null) {
                    plazaToast(context, "你暂时不能评论")
                    return@launch
                }
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                // 读不到资料时照常打开输入栏，提交时由服务器判断。
            }
            ui.replyTo = target
            ui.composing = true
        }
    }

    fun send() {
        val value = ui.text.trim()
        if (value.isEmpty() || plazaChars(value) > PLAZA_COMMENT_MAX) return
        ui.sending = true
        scope.launch {
            try {
                val comment =
                    repository.call(
                        Endpoints.plazaEndpointsAddComment,
                        params = mapOf("workId" to work.workId),
                        body =
                            buildJsonObject {
                                put("clientRequestId", ui.requestId)
                                put("text", value)
                                ui.replyTo?.let { put("replyToCommentId", it.commentId) }
                            },
                        options = SessionCallOptions(owner = owner),
                    )
                ui.requestId =
                    java.util.UUID
                        .randomUUID()
                        .toString()
                ui.items.add(comment)
                onCount(work.commentCount + 1)
                ui.text = ""
                ui.replyTo = null
                ui.composing = false
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                when (plazaCode(error)) {
                    "conflict" -> PlazaNav.open(PlazaPage.Profile)
                    "plaza_publish_forbidden" -> plazaToast(context, "你暂时不能评论")
                    // 失败时输入框内容保留。
                    else -> plazaToast(context, "没成功，请重试")
                }
            } finally {
                ui.sending = false
            }
        }
    }

    fun remove(comment: PlazaComment) {
        scope.launch {
            userAction({ plazaToast(context, it) }) {
                repository.call(
                    Endpoints.plazaEndpointsDeleteComment,
                    params = mapOf("commentId" to comment.commentId),
                    options = SessionCallOptions(owner = owner),
                )
                ui.items.removeAll { it.commentId == comment.commentId }
                onCount((work.commentCount - 1).coerceAtLeast(0))
            }
        }
    }

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
        Text("评论 ${work.commentCount}", style = MaterialTheme.typography.titleSmall)
        if (ui.loading && ui.items.isEmpty()) LinearProgressIndicator(Modifier.fillMaxWidth())
        val visible = if (ui.showAll) ui.items.toList() else ui.items.take(20)
        visible.forEach { comment ->
            // 点评论者头像没有反应：没有私信、关注、个人主页（PLZ-03 第 6 条）。
            Row(horizontalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
                PlazaAvatar(comment.author.authorId, plazaAuthorName(comment.author), comment.author.avatarUrl, 32.dp)
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(WbSpace.S2)) {
                        Text(plazaAuthorName(comment.author), style = MaterialTheme.typography.labelLarge)
                        if (comment.author.authorId == work.author.authorId) {
                            Text("作者", color = colors.textSecondary, style = MaterialTheme.typography.labelSmall)
                        }
                    }
                    Text((comment.replyTo?.let { "回复 ${plazaAuthorName(it)}：" } ?: "") + comment.text)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(plazaTime(comment.createdAt), color = colors.textTertiary, style = MaterialTheme.typography.bodySmall)
                        TextButton(onClick = { startCompose(comment) }) { Text("回复") }
                        if (comment.deletable) {
                            TextButton(onClick = { remove(comment) }) { Text("删除") }
                        } else if ("comment:${comment.commentId}" in PlazaReported.targets) {
                            Text("已举报", color = colors.textTertiary, style = MaterialTheme.typography.bodySmall)
                        } else {
                            TextButton(onClick = { PlazaNav.open(PlazaPage.Report(null, comment.commentId)) }) { Text("举报") }
                        }
                    }
                }
            }
        }
        if (!ui.showAll && ui.items.size > 20) {
            TextButton(onClick = { ui.showAll = true }) { Text("查看全部 ${work.commentCount} 条评论") }
        }
        val next = ui.cursor
        if (ui.showAll && next != null) {
            TextButton(onClick = { scope.launch { load(next) } }, enabled = !ui.loading) { Text("加载更多评论") }
        }
        if (ui.composing) {
            val count = plazaChars(ui.text)
            val reply = ui.replyTo
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(WbSpace.S2)) {
                OutlinedTextField(
                    ui.text,
                    { ui.text = it },
                    Modifier.weight(1f),
                    label = { Text(if (reply != null) "回复 ${plazaAuthorName(reply.author)}" else "评论") },
                )
                CharCount(count, PLAZA_COMMENT_MAX)
                Button(onClick = ::send, enabled = !ui.sending && ui.text.isNotBlank() && count <= PLAZA_COMMENT_MAX) { Text("发送") }
            }
        } else {
            OutlinedButton(onClick = { startCompose(null) }, modifier = Modifier.fillMaxWidth()) { Text("说点什么…") }
        }
    }
}

// ---------- 作者页（PLZ-01 第 7 条）：只有头像、昵称和作品列表 ----------

@Composable private fun ColumnScope.AuthorPage(
    repository: SessionRepository,
    owner: OwnerRecord,
    authorId: String,
) {
    val author =
        remote("${owner.sessionId}:plaza-author:$authorId") {
            repository.call(
                Endpoints.plazaEndpointsGetAuthor,
                params = mapOf("authorId" to authorId),
                options = SessionCallOptions(owner = owner, networkOnly = true),
            )
        }
    PlazaHeader("")
    author.error?.let { Text(it, Modifier.padding(WbSpace.S5), color = MaterialTheme.colorScheme.error) }
    author.data?.let { data ->
        Column(Modifier.fillMaxWidth().padding(WbSpace.S5), horizontalAlignment = Alignment.CenterHorizontally) {
            PlazaAvatar(data.authorId, plazaAuthorName(data), data.avatarUrl, 64.dp)
            Text(plazaAuthorName(data), style = MaterialTheme.typography.titleLarge)
        }
    }
    WorkList(repository, owner, search = "", sort = "latest", kind = "", basis = "", authorId = authorId)
}

// ---------- 举报（PLZ-07） ----------

@Composable private fun ReportPage(
    repository: SessionRepository,
    owner: OwnerRecord,
    page: PlazaPage.Report,
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    var reason by remember { mutableStateOf<String?>(null) }
    var note by remember { mutableStateOf("") }
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val key = if (page.workId != null) "work:${page.workId}" else "comment:${page.commentId}"
    PlazaHeader("举报")
    Column(Modifier.fillMaxWidth().padding(WbSpace.S5), verticalArrangement = Arrangement.spacedBy(WbSpace.S2)) {
        Text("举报原因", style = MaterialTheme.typography.titleSmall)
        plazaReasonNames.forEach { (id, label) ->
            Row(Modifier.fillMaxWidth().clickable { reason = id }, verticalAlignment = Alignment.CenterVertically) {
                RadioButton(selected = reason == id, onClick = { reason = id })
                Text(label)
            }
        }
        OutlinedTextField(
            note,
            { if (plazaChars(it) <= PLAZA_REPORT_NOTE_MAX) note = it },
            Modifier.fillMaxWidth(),
            label = { Text("补充说明（选填）") },
            supportingText = { Text("${plazaChars(note)}/$PLAZA_REPORT_NOTE_MAX") },
        )
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Button(
            onClick = submit@{
                val chosen = reason ?: return@submit
                pending = true
                error = null
                scope.launch {
                    try {
                        repository.call(
                            Endpoints.plazaEndpointsReport,
                            body =
                                buildJsonObject {
                                    put(
                                        "target",
                                        buildJsonObject {
                                            if (page.workId != null) {
                                                put("kind", "work")
                                                put("workId", page.workId)
                                            } else {
                                                put("kind", "comment")
                                                put("commentId", page.commentId.orEmpty())
                                            }
                                        },
                                    )
                                    put("reason", chosen)
                                    if (note.isNotBlank()) put("note", note.trim())
                                },
                            options = SessionCallOptions(owner = owner),
                        )
                        PlazaReported.add(key)
                        plazaToast(context, "已提交，管理员会尽快处理")
                        PlazaNav.back()
                    } catch (failure: CancellationException) {
                        throw failure
                    } catch (failure: Exception) {
                        if (plazaCode(failure) == "conflict") {
                            PlazaReported.add(key)
                            error = "你已经举报过这个内容"
                        } else {
                            error = "操作暂未完成，请稍后再试"
                        }
                    } finally {
                        pending = false
                    }
                }
            },
            enabled = reason != null && !pending,
            modifier = Modifier.fillMaxWidth(),
        ) { Text("提交") }
    }
}
