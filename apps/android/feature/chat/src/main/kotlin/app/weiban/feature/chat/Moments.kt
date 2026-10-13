package app.weiban.feature.chat

import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.weiban.core.designsystem.R as DsR
import app.weiban.contracts.*
import app.weiban.data.*
import app.weiban.designsystem.ActionSheet
import app.weiban.designsystem.CheckCircle
import app.weiban.designsystem.EmptyState
import app.weiban.designsystem.ImmersiveStatusBar
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.LocalWeibanModeColors
import app.weiban.designsystem.MenuGroup
import app.weiban.designsystem.MenuRow
import app.weiban.designsystem.SheetAction
import app.weiban.designsystem.SmallBrandButton
import app.weiban.designsystem.ToastKind
import app.weiban.designsystem.WbConfirm
import app.weiban.designsystem.WbIcon
import app.weiban.designsystem.WbNavBar
import app.weiban.designsystem.WbSheet
import app.weiban.designsystem.WbToast
import app.weiban.designsystem.hairline
import app.weiban.designsystem.pressable
import app.weiban.designsystem.wbText
import app.weiban.designsystem.tokens.WbSize
import app.weiban.designsystem.tokens.WbSpace
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import java.util.UUID

private const val MOMENT_IMAGE_LIMIT = 9
private const val MOMENT_TEXT_LIMIT = 2_000
private const val COMMENT_LIMIT = 500

/** 名字解析：用户本人显示「我」，角色优先备注。 */
private class MomentNames(
    val state: ClientSyncState,
    val profiles: Map<String, CharacterProfile>,
) {
    fun of(actor: MomentsActor?): String =
        when {
            actor == null -> ""
            actor.kind == "user" -> "我"
            else -> state.contacts.find { it.characterId == actor.refId }?.remark ?: profiles[actor.refId]?.name ?: "角色"
        }
}

/** 一条动态的操作（点赞、评论、删除），结果直接替换列表里的这条。 */
private class MomentActions(
    val repository: SessionRepository,
    val owner: OwnerRecord,
    private val scope: kotlinx.coroutines.CoroutineScope,
    private val onPost: (MomentsPost) -> Unit,
    private val onDeleted: (String) -> Unit,
) {
    var pending by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    var notice by mutableStateOf<String?>(null)
    var replying by mutableStateOf<Pair<MomentsPost, MomentsComment?>?>(null)

    private val options get() = SessionCallOptions(owner = owner)

    private fun launchAction(work: suspend () -> Unit) {
        if (pending) return
        pending = true
        error = null
        notice = null
        scope.launch {
            try {
                userAction({ error = it }) { work() }
            } finally {
                pending = false
            }
        }
    }

    fun like(post: MomentsPost) =
        launchAction {
            val endpoint = if (post.likedByMe) Endpoints.momentsEndpointsUnlike else Endpoints.momentsEndpointsLike
            onPost(repository.call(endpoint, params = mapOf("postId" to post.postId), options = options))
        }

    fun comment(
        post: MomentsPost,
        replyTo: MomentsComment?,
        text: String,
        done: () -> Unit,
    ) = launchAction {
        onPost(
            repository.call(
                Endpoints.momentsEndpointsComment,
                params = mapOf("postId" to post.postId),
                body =
                    buildJsonObject {
                        put("clientRequestId", UUID.randomUUID().toString())
                        put("text", text.trim())
                        replyTo?.let { put("replyToCommentId", it.commentId) }
                    },
                options = options,
            ),
        )
        done()
    }

    fun deleteComment(
        post: MomentsPost,
        comment: MomentsComment,
    ) = launchAction {
        onPost(
            repository.call(
                Endpoints.momentsEndpointsDeleteComment,
                params = mapOf("postId" to post.postId, "commentId" to comment.commentId),
                options = options,
            ),
        )
    }

    /** 朋友圈「…」› 收藏（CHAT-11）。 */
    fun favorite(post: MomentsPost) =
        launchAction {
            repository.call(
                Endpoints.libraryEndpointsAddFavorites,
                body =
                    buildJsonObject {
                        put(
                            "items",
                            buildJsonArray {
                                add(
                                    buildJsonObject {
                                        put("kind", "moments_post")
                                        put("postId", post.postId)
                                    },
                                )
                            },
                        )
                    },
                options = options,
            )
            notice = "已收藏"
        }

    fun deletePost(post: MomentsPost) =
        launchAction {
            repository.call(Endpoints.momentsEndpointsDeletePost, params = mapOf("postId" to post.postId), options = options)
            onDeleted(post.postId)
        }
}

/**
 * 朋友圈（SOC-07～SOC-09；moments.md、social-l4.md 第 3 节）。
 * target：feed / me / character:<id> / post:<id>。
 */
@Composable internal fun MomentsScreen(
    repository: SessionRepository,
    owner: OwnerRecord,
    state: ClientSyncState,
    target: String,
    onBack: () -> Unit,
) {
    var page by remember(target) { mutableStateOf(target) }
    var composing by remember { mutableStateOf(false) }
    if (composing) {
        ComposeMoment(repository, owner, state, { composing = false }) { composing = false }
        return
    }
    if (page.startsWith("post:")) {
        MomentDetail(repository, owner, state, page.removePrefix("post:")) {
            if (target.startsWith("post:")) onBack() else page = target
        }
        return
    }
    if (page == "notifications") {
        MomentsNotifications(repository, owner, state, { page = target }) { page = "post:$it" }
        return
    }
    MomentsList(repository, owner, state, page, onBack, { page = "post:$it" }, { page = "notifications" }) { composing = true }
}

/** 朋友圈消息页（规格 4.11「与我的互动消息」）：头像 46 圆角 6 → 名字 15 + 内容 14 + 时间 12 → 右侧原动态缩略图 46。 */
@Composable private fun MomentsNotifications(
    repository: SessionRepository,
    owner: OwnerRecord,
    state: ClientSyncState,
    onBack: () -> Unit,
    onOpenPost: (String) -> Unit,
) {
    BackHandler(onBack = onBack)
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    val rows = remember(owner) { mutableStateListOf<MomentsNotification>() }
    var cursor by remember(owner) { mutableStateOf<String?>(null) }
    var finished by remember(owner) { mutableStateOf(false) }
    var loading by remember(owner) { mutableStateOf(false) }
    var failed by remember(owner) { mutableStateOf(false) }
    val load: suspend () -> Unit = {
        if (!loading && !finished) {
            loading = true
            failed = false
            userAction({ failed = true }) {
                val page =
                    repository.call(
                        Endpoints.momentsEndpointsListNotifications,
                        query = buildMap<String, String> { cursor?.let { put("cursor", it) } },
                        options = SessionCallOptions(owner = owner, networkOnly = true),
                    )
                rows.addAll(page.items.filter { incoming -> rows.none { it.notificationId == incoming.notificationId } })
                cursor = page.nextCursor
                finished = page.nextCursor == null
            }
            loading = false
        }
    }
    LaunchedEffect(owner) {
        load()
        userAction({}) {
            repository.call(
                Endpoints.momentsEndpointsMarkSeen,
                body = buildJsonObject { put("scope", "interactions") },
                options = SessionCallOptions(owner = owner),
            )
        }
    }
    val actors = rows.flatMap { listOf(it.actor, it.post.author) }
    val profiles = characterProfiles(repository, actors.filter { it.kind == "character" }.map { it.refId })
    val names = MomentNames(state, profiles)
    Column(Modifier.fillMaxSize().background(colors.bgPage)) {
        WbNavBar("消息", onBack)
        if (rows.isEmpty() && finished) EmptyState("暂无消息", DsR.drawable.wb_chat)
        LazyColumn(Modifier.weight(1f).background(colors.bgSurface)) {
            items(rows, key = { it.notificationId }) { item ->
                val action =
                    when (item.kind) {
                        "like" -> "赞了你的动态"
                        "reply" -> "回复了你：${item.text.orEmpty()}"
                        "mention" -> "在评论中提到了你：${item.text.orEmpty()}"
                        else -> "评论：${item.text.orEmpty()}"
                    }
                Row(
                    Modifier.fillMaxWidth().pressable { onOpenPost(item.postId) }.padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.Top,
                ) {
                    RoleAvatar(
                        repository,
                        owner,
                        RoleAvatarIdentity(item.actor.refId, names.of(item.actor), profiles[item.actor.refId]?.avatar),
                        46.dp,
                        6.dp,
                    )
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(names.of(item.actor), style = wbText(15.sp, 500, colors.textLink))
                        Spacer(Modifier.height(3.dp))
                        Text(action, style = wbText(14.sp, color = colors.textPrimary, lineHeight = 1.35f), maxLines = 2)
                        Spacer(Modifier.height(3.dp))
                        Text(momentTime(item.createdAt), style = wbText(12.sp, color = colors.textPlaceholder))
                    }
                    Spacer(Modifier.width(8.dp))
                    val image = item.post.imageMediaId
                    if (image != null) {
                        Box(Modifier.clip(RoundedCornerShape(4.dp))) { MediaThumb(repository, owner, image, 46.dp) }
                    } else {
                        Text(item.post.text.take(12), Modifier.width(46.dp), maxLines = 3, style = wbText(12.sp, color = colors.textSecondary))
                    }
                }
                Box(Modifier.fillMaxWidth().padding(start = 74.dp).height(hairline).background(colors.borderHairline))
            }
            item(key = "footer") {
                Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
                    when {
                        loading -> CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                        failed -> Text("加载失败，点击重试", Modifier.clickable { scope.launch { load() } }, style = wbText(14.sp, color = colors.textLink))
                        !finished -> {
                            LaunchedEffect(rows.size) { load() }
                        }
                    }
                }
            }
        }
    }
}

/** 封面预设渐变（规格 4.11，10 套，按名字稳定随机，从上到下）。 */
private val coverGradients =
    listOf(
        0xFF6E8EAE to 0xFFC9D6DF,
        0xFF6D597A to 0xFFB56576,
        0xFF52796F to 0xFF94B49F,
        0xFFB08968 to 0xFFE6CCB2,
        0xFF4A6FA5 to 0xFF9FB8D4,
        0xFF9A8C98 to 0xFFC9ADA7,
        0xFF5F7470 to 0xFFA4B8AE,
        0xFFBC6C25 to 0xFFE9B872,
        0xFF3D5A80 to 0xFF98C1D9,
        0xFF7B6D8D to 0xFFC4B2CE,
    )

/**
 * 朋友圈封面（MomentsCover）：高 370，预设渐变 + 底部压暗渐变；头像 70 圆角 8，右距 16.6，下沿探出 23.4；
 * 昵称 22 白色右对齐，距头像 14、距封面底 15；头像到第一条动态留白 38（白底）。
 */
@Composable private fun MomentsCover(
    name: String,
    avatar: @Composable () -> Unit,
    onProfile: (() -> Unit)?,
) {
    val colors = LocalWeibanColors.current
    val (top, bottom) = coverGradients[(name.hashCode() and Int.MAX_VALUE) % coverGradients.size]
    Box(Modifier.fillMaxWidth().background(colors.bgSurface)) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(370.dp)
                .background(Brush.verticalGradient(listOf(Color(top), Color(bottom)))),
        ) {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Brush.verticalGradient(listOf(Color(0x0D000000), Color(0x73000000)))),
            )
            Text(
                name,
                Modifier.align(Alignment.BottomEnd).padding(end = 16.6.dp + 70.dp + 14.dp, bottom = 15.dp),
                style = wbText(22.sp, 500, Color.White),
                maxLines = 1,
            )
        }
        Box(
            Modifier
                .align(Alignment.TopEnd)
                .padding(top = 370.dp - 70.dp + 23.4.dp, end = 16.6.dp)
                .then(if (onProfile != null) Modifier.clickableNoRipple(onProfile) else Modifier),
        ) { avatar() }
        Spacer(Modifier.padding(top = 370.dp).height(23.4.dp + 38.dp))
    }
}

@Composable private fun MomentsList(
    repository: SessionRepository,
    owner: OwnerRecord,
    state: ClientSyncState,
    mode: String,
    onBack: () -> Unit,
    onOpenPost: (String) -> Unit,
    onNotifications: () -> Unit,
    onCompose: () -> Unit,
) {
    BackHandler(onBack = onBack)
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    val pager = remember(owner, mode) { MomentsPager(repository, owner, mode) }
    val actions = remember(pager) { MomentActions(repository, owner, scope, pager::replace, pager::remove) }
    val list = rememberLazyListState()
    val badge = rememberMomentsBadge(repository, owner)
    val ids =
        pager.items.flatMap { post ->
            listOf(post.author) + post.likes +
                post.comments.flatMap { listOfNotNull(it.author, it.replyTo) }
        }
    val characterId = mode.removePrefix("character:").takeIf { mode.startsWith("character:") }
    val profiles = characterProfiles(repository, ids.filter { it.kind == "character" }.map { it.refId } + listOfNotNull(characterId))
    val names = MomentNames(state, profiles)
    val me =
        remote("${owner.sessionId}:moments-me") {
            repository.call(Endpoints.identityEndpointsGetProfile, options = SessionCallOptions(owner = owner))
        }
    LaunchedEffect(pager) {
        pager.next()
        if (mode == "feed") {
            userAction({}) {
                repository.call(
                    Endpoints.momentsEndpointsMarkSeen,
                    body = buildJsonObject { put("scope", "posts") },
                    options = SessionCallOptions(owner = owner),
                )
            }
        }
    }
    LaunchedEffect(pager) {
        AppUpdates.updates.collect { update ->
            if (update is UserUpdateMomentsPostChanged) pager.changed(update.data.postId, update.data.deleted)
        }
    }
    val nearEnd by remember {
        derivedStateOf {
            val last =
                list.layoutInfo.visibleItemsInfo
                    .lastOrNull()
                    ?.index ?: 0
            last >= list.layoutInfo.totalItemsCount - 2
        }
    }
    LaunchedEffect(nearEnd, pager.initialized) { if (nearEnd && pager.initialized && !pager.failed) pager.next() }
    LaunchedEffect(actions.error) { actions.error?.let { WbToast.show(it, ToastKind.Warning) } }
    LaunchedEffect(actions.notice) { actions.notice?.let { WbToast.show(it, ToastKind.Success) } }
    val scrolled by remember { derivedStateOf { list.firstVisibleItemIndex > 0 || list.firstVisibleItemScrollOffset > 600 } }
    var cameraSheet by remember { mutableStateOf(false) }
    ImmersiveStatusBar(lightIcons = !scrolled)
    Box(Modifier.fillMaxSize().background(colors.bgPage)) {
        Column(Modifier.fillMaxSize()) {
            LazyColumn(state = list, modifier = Modifier.weight(1f).fillMaxWidth()) {
                item(key = "cover") {
                    if (characterId != null) {
                        val name = names.of(MomentsActor("character", characterId))
                        MomentsCover(name, {
                            RoleAvatar(repository, owner, RoleAvatarIdentity(characterId, name, profiles[characterId]?.avatar), 70.dp, 8.dp)
                        }, null)
                    } else {
                        val nickname = me.data?.nickname ?: "我"
                        MomentsCover(nickname, {
                            RoleAvatar(
                                repository,
                                owner,
                                RoleAvatarIdentity(owner.userId, nickname, null, me.data?.avatarMediaId, user = true),
                                70.dp,
                                8.dp,
                            )
                        }, null)
                    }
                }
                val interactions = badge?.unseenInteractionCount ?: 0
                if (mode == "feed" && interactions > 0) {
                    item(key = "new") {
                        Box(Modifier.fillMaxWidth().background(colors.bgSurface).padding(top = 16.dp, bottom = 8.dp), contentAlignment = Alignment.Center) {
                            Row(
                                Modifier
                                    .heightIn(min = 44.dp)
                                    .background(LocalWeibanModeColors.current.uiMomentsNewMsgBg, RoundedCornerShape(6.dp))
                                    .clickableNoRipple(onNotifications)
                                    .padding(horizontal = 12.dp, vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                WbIcon(DsR.drawable.wb_chat, 20.dp, Color.White)
                                Spacer(Modifier.width(8.dp))
                                Text("${interactions}条新消息", style = wbText(15.sp, 500, Color.White))
                            }
                        }
                    }
                }
                when {
                    !pager.initialized && pager.failed ->
                        item(key = "failed") { EmptyState("加载失败", DsR.drawable.wb_warning, action = "重试", onAction = { scope.launch { pager.next() } }) }
                    !pager.initialized -> item(key = "loading") { LinearProgressIndicator(Modifier.fillMaxWidth(), color = colors.brandPrimary) }
                    pager.items.isEmpty() ->
                        item(key = "empty") {
                            Text(
                                when {
                                    mode == "me" -> "你还没有发过朋友圈"
                                    characterId != null -> "TA 还没有发过朋友圈"
                                    else -> "暂时没有动态"
                                },
                                Modifier.fillMaxWidth().background(colors.bgSurface).padding(start = 16.dp, top = 32.dp, end = 16.dp, bottom = 20.dp),
                                style = wbText(14.sp, color = colors.textSecondary),
                                textAlign = TextAlign.Center,
                            )
                        }
                    else ->
                        items(pager.items, key = { it.postId }) { post ->
                            MomentCard(post, names, actions, full = false) { onOpenPost(post.postId) }
                            Spacer(Modifier.height(1.dp))
                        }
                }
                item(key = "footer") {
                    Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
                        when {
                            pager.loading -> CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                            pager.failed && pager.initialized ->
                                Text("加载失败，点击重试", Modifier.clickable { scope.launch { pager.next() } }, style = wbText(14.sp, color = colors.textLink))
                        }
                    }
                }
            }
            CommentBar(actions)
        }
        // 顶栏：透明悬浮在封面上，白色图标；滚过封面后变成普通顶栏。
        val tint = if (scrolled) colors.textPrimary else Color.White
        Box(Modifier.fillMaxWidth().background(if (scrolled) colors.bgNavBar else Color.Transparent).statusBarsPadding()) {
            WbNavBar(
                if (characterId != null) "${names.of(MomentsActor("character", characterId))}的朋友圈" else if (scrolled) "朋友圈" else "",
                onBack,
                background = Color.Transparent,
                contentColor = tint,
            ) {
                if (characterId == null) {
                    Box(
                        Modifier
                            .size(42.dp, 48.dp)
                            .pointerInput(Unit) { detectTapGestures(onTap = { cameraSheet = true }, onLongPress = { onCompose() }) },
                        contentAlignment = Alignment.Center,
                    ) {
                        WbIcon(DsR.drawable.wb_camera, 24.dp, tint, contentDescription = "发朋友圈")
                    }
                }
            }
        }
    }
    if (cameraSheet) {
        ActionSheet(listOf(SheetAction("拍摄", onClick = onCompose), SheetAction("从相册选择", onClick = onCompose))) { cameraSheet = false }
    }
}

/**
 * 动态卡（规格 4.11）：白底，内距 14 / 16 / 14 / 12；头像 42 圆角 4 → 10 → 昵称 15/600 link → 5 → 正文 15/1.45 →
 * 8 → 图片 → 8 → 底行：时间 12 + 右侧 ·· 按钮；赞 / 评论灰框。
 */
@Composable private fun MomentCard(
    post: MomentsPost,
    names: MomentNames,
    actions: MomentActions,
    full: Boolean,
    onOpen: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    val mode = LocalWeibanModeColors.current
    var deleting by remember { mutableStateOf<MomentsComment?>(null) }
    var deletingPost by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().background(colors.bgSurface).padding(start = 12.dp, top = 14.dp, end = 16.dp, bottom = 14.dp)) {
        val author = post.author
        if (author.kind == "character") {
            RoleAvatar(actions.repository, actions.owner, RoleAvatarIdentity(author.refId, names.of(author), names.profiles[author.refId]?.avatar), 42.dp, 4.dp)
        } else {
            RoleAvatar(actions.repository, actions.owner, RoleAvatarIdentity(actions.owner.userId, "我", null, user = true), 42.dp, 4.dp)
        }
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(names.of(author), style = wbText(15.sp, 600, colors.textNameInMoments))
            if (post.text.isNotBlank()) {
                Spacer(Modifier.height(5.dp))
                Text(
                    post.text,
                    Modifier.clickableNoRipple(onOpen),
                    style = wbText(15.sp, 400, colors.textPrimary, 1.45f),
                    maxLines = if (full) Int.MAX_VALUE else 6,
                    overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                )
            }
            MomentImages(actions, post)
            post.link?.let { link ->
                Spacer(Modifier.height(8.dp))
                Text(
                    "${link.title}  ${link.source.orEmpty()}",
                    Modifier.fillMaxWidth().background(colors.bgPage).padding(8.dp),
                    style = wbText(14.sp, color = colors.textLink),
                    maxLines = 2,
                )
            }
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(momentTime(post.createdAt), style = wbText(12.sp, color = colors.textSecondary))
                val selected = (post.visibility as? JsonObject)?.get("kind")?.jsonPrimitive?.contentOrNull == "selected"
                if (selected) {
                    val count = (post.visibility as? JsonObject)?.get("characterIds")?.jsonArray?.size ?: 0
                    Text("  部分可见（$count）", style = wbText(12.sp, color = colors.textSecondary))
                }
                Spacer(Modifier.weight(1f))
                MomentMore(actions, post) { deletingPost = true }
            }
            if (post.likes.isNotEmpty() || post.comments.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                Column(Modifier.fillMaxWidth().background(mode.uiMomentsSocialBg, RoundedCornerShape(3.dp)).padding(8.dp)) {
                    if (post.likes.isNotEmpty()) {
                        Row(verticalAlignment = Alignment.Top) {
                            WbIcon(DsR.drawable.wb_like, 14.dp, colors.textLink, Modifier.padding(top = 2.dp))
                            Spacer(Modifier.width(4.dp))
                            Text(post.likes.joinToString("、") { names.of(it) }, style = wbText(14.sp, 400, colors.textLink, 1.3f))
                        }
                    }
                    if (post.likes.isNotEmpty() && post.comments.isNotEmpty()) {
                        Box(Modifier.padding(vertical = 5.dp).fillMaxWidth().height(0.5.dp).background(colors.borderHairline))
                    }
                    post.comments.forEach { comment ->
                        val line =
                            buildAnnotatedString {
                                withStyle(SpanStyle(color = colors.textLink)) { append(names.of(comment.author)) }
                                comment.replyTo?.let {
                                    append("回复")
                                    withStyle(SpanStyle(color = colors.textLink)) { append(names.of(it)) }
                                }
                                append("：")
                                append(comment.text)
                            }
                        Text(
                            line,
                            Modifier
                                .fillMaxWidth()
                                .pointerInput(comment.commentId) {
                                    detectTapGestures(
                                        onTap = { if (!actions.pending) actions.replying = post to comment.takeIf { it.author.kind != "user" } },
                                        onLongPress = { if (comment.author.kind == "user") deleting = comment },
                                    )
                                }.padding(vertical = 1.dp),
                            style = wbText(14.sp, 400, colors.textPrimary, 1.35f),
                        )
                    }
                }
            }
        }
    }
    deleting?.let { comment ->
        WbConfirm("删除这条评论？", "删除", danger = true, onDismiss = { deleting = null }) {
            actions.deleteComment(post, comment)
            deleting = null
        }
    }
    if (deletingPost) {
        WbConfirm("删除这条朋友圈？", "删除", danger = true, onDismiss = { deletingPost = false }) {
            actions.deletePost(post)
            deletingPost = false
        }
    }
}

/**
 * ·· 按钮（4.11）：30×22，底 bg.page，圆角 3；点 → 向左弹出深色菜单（menu.dark，圆角 4）：
 * 赞 / 取消 · 评论 · 收藏 · 分享图（自己的动态多一个删除），每项白色图标 18 + 8 + 白字 15。
 */
@Composable private fun MomentMore(
    actions: MomentActions,
    post: MomentsPost,
    onDelete: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    val mode = LocalWeibanModeColors.current
    val dark = app.weiban.designsystem.LocalWbDark.current
    var open by remember { mutableStateOf(false) }
    Box {
        Box(
            Modifier.size(30.dp, 22.dp).background(colors.bgPage, RoundedCornerShape(3.dp)).clickableNoRipple { open = true },
            contentAlignment = Alignment.Center,
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                repeat(2) { Box(Modifier.size(4.dp).background(colors.textLink, androidx.compose.foundation.shape.CircleShape)) }
            }
        }
        if (open) {
            val items =
                buildList {
                    add(Triple(if (post.likedByMe) "取消" else "赞", if (post.likedByMe) DsR.drawable.wb_like_filled else DsR.drawable.wb_like) { actions.like(post) })
                    add(Triple("评论", DsR.drawable.wb_chat) { actions.replying = post to null })
                    add(Triple("收藏", DsR.drawable.wb_star) { actions.favorite(post) })
                    add(Triple("分享图", DsR.drawable.wb_share) { L6Overlays.shareMoment(post.postId) })
                    if (post.author.kind == "user") add(Triple("删除", DsR.drawable.wb_delete, onDelete))
                }
            androidx.compose.ui.window.Popup(
                popupPositionProvider = LeftOfAnchor,
                onDismissRequest = { open = false },
                properties = androidx.compose.ui.window.PopupProperties(focusable = true),
            ) {
                Row(
                    Modifier.height(40.dp).background(if (dark) Color(0xFF2C2C2E) else mode.overlayMenu, RoundedCornerShape(4.dp)),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    items.forEachIndexed { index, (label, icon, action) ->
                        if (index > 0) Box(Modifier.size(0.5.dp, 20.dp).background(mode.uiMenuLine))
                        Row(
                            Modifier.fillMaxHeight().clickableNoRipple {
                                open = false
                                if (!actions.pending) action()
                            }.padding(horizontal = 14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            WbIcon(icon, 18.dp, Color.White)
                            Spacer(Modifier.width(8.dp))
                            Text(label, style = wbText(15.sp, 400, Color.White))
                        }
                    }
                }
            }
        }
    }
}

/** 浮层出现在锚点左侧、垂直居中（朋友圈 ·· 菜单）。 */
private object LeftOfAnchor : androidx.compose.ui.window.PopupPositionProvider {
    override fun calculatePosition(
        anchorBounds: androidx.compose.ui.unit.IntRect,
        windowSize: androidx.compose.ui.unit.IntSize,
        layoutDirection: androidx.compose.ui.unit.LayoutDirection,
        popupContentSize: androidx.compose.ui.unit.IntSize,
    ): androidx.compose.ui.unit.IntOffset =
        androidx.compose.ui.unit.IntOffset(
            (anchorBounds.left - popupContentSize.width - 8).coerceAtLeast(8),
            anchorBounds.top + anchorBounds.height / 2 - popupContentSize.height / 2,
        )
}

/** 图片：单图 180×135 圆角 4；多图 3 列宫格，每格 90 间距 4。 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MomentImages(
    actions: MomentActions,
    post: MomentsPost,
) {
    if (post.images.isEmpty()) return
    Spacer(Modifier.height(8.dp))
    if (post.images.size == 1) {
        ChatPicture(actions.repository, actions.owner, post.images.first().mediaId, 180.dp, 135.dp, Modifier.clip(RoundedCornerShape(4.dp)))
        return
    }
    FlowRow(Modifier.width(278.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp), maxItemsInEachRow = 3) {
        post.images.forEach { image -> MediaThumb(actions.repository, actions.owner, image.mediaId, 90.dp) }
    }
}

/** 底部评论输入栏：点「评论」或别人的评论时出现（输入栏样式同聊天页）。 */
@Composable private fun CommentBar(actions: MomentActions) {
    val target = actions.replying ?: return
    val colors = LocalWeibanColors.current
    var text by remember(target) { mutableStateOf("") }
    BackHandler { actions.replying = null }
    Column(Modifier.fillMaxWidth().background(colors.bgInputBar).imePadding()) {
        Box(Modifier.fillMaxWidth().height(0.5.dp).background(colors.borderHairline))
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            androidx.compose.foundation.text.BasicTextField(
                text,
                { text = it.take(COMMENT_LIMIT) },
                Modifier.weight(1f).heightIn(min = 40.dp).background(colors.bgInputField, RoundedCornerShape(8.dp)).padding(horizontal = 12.dp, vertical = 9.dp),
                textStyle = wbText(17.sp, color = colors.textPrimary),
                cursorBrush = SolidColor(colors.brandPrimary),
                maxLines = 4,
                decorationBox = { inner ->
                    Box {
                        if (text.isEmpty()) {
                            Text(target.second?.let { "回复 ${it.text.take(8)}…" } ?: "评论", style = wbText(17.sp, color = colors.textPlaceholder))
                        }
                        inner()
                    }
                },
            )
            Spacer(Modifier.width(8.dp))
            SmallBrandButton("发送", enabled = text.isNotBlank() && !actions.pending) {
                actions.comment(target.first, target.second, text) { actions.replying = null }
            }
        }
    }
}

@Composable private fun MomentDetail(
    repository: SessionRepository,
    owner: OwnerRecord,
    state: ClientSyncState,
    postId: String,
    onBack: () -> Unit,
) {
    BackHandler(onBack = onBack)
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    val post =
        remote("${owner.sessionId}:moment:$postId") {
            repository.call(
                Endpoints.momentsEndpointsGetPost,
                params = mapOf("postId" to postId),
                options = SessionCallOptions(owner = owner, networkOnly = true),
            )
        }
    var deleted by remember { mutableStateOf(false) }
    val actions = remember(postId) { MomentActions(repository, owner, scope, { post.data = it }) { deleted = true } }
    val current = post.data
    val ids = current?.let { p -> listOf(p.author) + p.likes + p.comments.flatMap { listOfNotNull(it.author, it.replyTo) } }.orEmpty()
    val profiles = characterProfiles(repository, ids.filter { it.kind == "character" }.map { it.refId })
    LaunchedEffect(actions.error) { actions.error?.let { WbToast.show(it, ToastKind.Warning) } }
    LaunchedEffect(actions.notice) { actions.notice?.let { WbToast.show(it, ToastKind.Success) } }
    Column(Modifier.fillMaxSize().background(colors.bgPage)) {
        WbNavBar("详情", onBack)
        when {
            deleted || post.error != null && current == null -> EmptyState("该动态已删除", DsR.drawable.wb_info)
            current == null -> LinearProgressIndicator(Modifier.fillMaxWidth(), color = colors.brandPrimary)
            else ->
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
                    MomentCard(current, MomentNames(state, profiles), actions, full = true) {}
                }
        }
        CommentBar(actions)
    }
}

@OptIn(ExperimentalLayoutApi::class)
/** 发表页（规格 4.11）：顶栏左「取消」、右「发表」小按钮；文字输入区 + 图片格 90（圆角 6）；谁可以看。 */
@Composable private fun ComposeMoment(
    repository: SessionRepository,
    owner: OwnerRecord,
    state: ClientSyncState,
    onCancel: () -> Unit,
    onPosted: () -> Unit,
) {
    val context = LocalContext.current
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    val requestId = remember { UUID.randomUUID().toString() }
    var text by remember { mutableStateOf("") }
    var images by remember { mutableStateOf<List<Uri>>(emptyList()) }
    var selectedOnly by remember { mutableStateOf(false) }
    var visibleTo by remember { mutableStateOf<Set<String>>(emptySet()) }
    var pending by remember { mutableStateOf(false) }
    var leaving by remember { mutableStateOf(false) }
    var chooseVisibility by remember { mutableStateOf(false) }
    val picker =
        rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(MOMENT_IMAGE_LIMIT)) { picked ->
            images = (images + picked).distinct().take(MOMENT_IMAGE_LIMIT)
        }
    val dirty = text.isNotBlank() || images.isNotEmpty()
    BackHandler { if (dirty) leaving = true else onCancel() }
    val contacts = state.contacts.filter { it.status == "active" }
    val profiles = characterProfiles(repository, contacts.map { it.characterId })
    val publish: () -> Unit = {
        pending = true
        scope.launch {
            userAction({ WbToast.show("发表失败，请重试", ToastKind.Error) }) {
                val mediaIds = images.map { uploadMomentImage(context, repository, owner, it) }
                repository.call(
                    Endpoints.momentsEndpointsCreatePost,
                    body =
                        buildJsonObject {
                            put("clientRequestId", requestId)
                            put("text", text)
                            put("imageMediaIds", JsonArray(mediaIds.map(::JsonPrimitive)))
                            put(
                                "visibility",
                                buildJsonObject {
                                    put("kind", if (selectedOnly) "selected" else "all_characters")
                                    put("characterIds", JsonArray((if (selectedOnly) visibleTo.toList() else emptyList()).map(::JsonPrimitive)))
                                },
                            )
                        },
                    options = SessionCallOptions(owner = owner),
                )
                onPosted()
            }
            pending = false
        }
    }
    Column(Modifier.fillMaxSize().background(colors.bgPage)) {
        WbNavBar("", leading = {
            Text(
                "取消",
                Modifier.clickableNoRipple { if (dirty) leaving = true else onCancel() }.padding(horizontal = 16.dp, vertical = 12.dp),
                style = wbText(16.sp, color = colors.textPrimary),
            )
        }) {
            SmallBrandButton(if (pending) "发表中…" else "发表", enabled = !pending && dirty && (!selectedOnly || visibleTo.isNotEmpty()), onClick = publish)
            Spacer(Modifier.width(10.dp))
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            Column(Modifier.fillMaxWidth().background(colors.bgSurface).padding(16.dp)) {
                androidx.compose.foundation.text.BasicTextField(
                    text,
                    { text = it.take(MOMENT_TEXT_LIMIT) },
                    Modifier.fillMaxWidth().heightIn(min = 96.dp),
                    textStyle = wbText(17.sp, color = colors.textPrimary, lineHeight = 1.45f),
                    cursorBrush = SolidColor(colors.brandPrimary),
                    decorationBox = { inner ->
                        Box {
                            if (text.isEmpty()) Text("这一刻的想法…", style = wbText(17.sp, color = colors.textPlaceholder))
                            inner()
                        }
                    },
                )
                Spacer(Modifier.height(12.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp), maxItemsInEachRow = 3) {
                    images.forEach { uri ->
                        Box(Modifier.size(90.dp).clip(RoundedCornerShape(6.dp)).background(colors.bgSkeleton)) {
                            LocalImage(uri, Modifier.fillMaxSize())
                            Box(
                                Modifier.align(Alignment.TopEnd).padding(4.dp).size(18.dp).background(Color(0x66000000), androidx.compose.foundation.shape.CircleShape).clickableNoRipple {
                                    images = images - uri
                                },
                                contentAlignment = Alignment.Center,
                            ) { WbIcon(DsR.drawable.wb_close, 12.dp, Color.White) }
                        }
                    }
                    if (images.size < MOMENT_IMAGE_LIMIT) {
                        Box(
                            Modifier.size(90.dp).background(colors.bgPage, RoundedCornerShape(6.dp)).clickableNoRipple {
                                if (!pending) picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                            },
                            contentAlignment = Alignment.Center,
                        ) { WbIcon(DsR.drawable.wb_add, 32.dp, colors.textPlaceholder) }
                    }
                }
            }
            MenuGroup {
                MenuRow("谁可以看", value = if (selectedOnly) "部分可见（${visibleTo.size}）" else "全部角色", enabled = !pending) { chooseVisibility = true }
            }
            Text(
                "看不到的角色不会点赞评论，也不会在聊天里提起这条动态",
                Modifier.padding(16.dp),
                style = wbText(13.sp, color = colors.textSecondary),
            )
        }
    }
    if (chooseVisibility) {
        WbSheet("谁可以看", { chooseVisibility = false }, action = "完成" to { chooseVisibility = false }) {
            Column(Modifier.heightIn(max = 480.dp).verticalScroll(rememberScrollState())) {
                MenuGroup {
                    MenuRow("全部角色", trailing = { CheckCircle(!selectedOnly) }) { selectedOnly = false }
                    MenuRow("部分角色可见", trailing = { CheckCircle(selectedOnly) }) { selectedOnly = true }
                }
                if (selectedOnly) {
                    MenuGroup("选择角色") {
                        contacts.forEach { contact ->
                            val id = contact.characterId
                            MenuRow(contact.remark ?: profiles[id]?.name ?: "角色", trailing = { CheckCircle(id in visibleTo) }) {
                                visibleTo = if (id in visibleTo) visibleTo - id else visibleTo + id
                            }
                        }
                    }
                }
            }
        }
    }
    if (leaving) {
        WbConfirm("这次编辑的内容不会保留", "不保留", title = "退出编辑？", danger = true, cancel = "继续编辑", onDismiss = { leaving = false }, onConfirm = onCancel)
    }
}

/** 发表页里的本地图片缩略图。 */
@Composable private fun LocalImage(
    uri: Uri,
    modifier: Modifier,
) {
    val context = LocalContext.current
    var bitmap by remember(uri) { mutableStateOf<android.graphics.Bitmap?>(null) }
    LaunchedEffect(uri) {
        bitmap =
            kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                runCatching {
                    context.contentResolver.openInputStream(uri)?.use { input ->
                        android.graphics.BitmapFactory.decodeStream(input, null, android.graphics.BitmapFactory.Options().apply { inSampleSize = 4 })
                    }
                }.getOrNull()
            }
    }
    bitmap?.let { Image(it.asImageBitmap(), null, modifier, contentScale = ContentScale.Crop) }
}

/** 资料页 › 朋友圈：只看该角色。 */
@Composable internal fun CharacterMoments(
    repository: SessionRepository,
    owner: OwnerRecord,
    state: ClientSyncState,
    characterId: String,
    onBack: () -> Unit,
) {
    MomentsScreen(repository, owner, state, "character:$characterId", onBack)
}
