package app.weiban.feature.chat

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import android.net.Uri
import androidx.compose.foundation.clickable
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import app.weiban.contracts.*
import app.weiban.data.*
import app.weiban.designsystem.LocalWeibanColors
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
    var replying by mutableStateOf<Pair<MomentsPost, MomentsComment?>?>(null)

    private val options get() = SessionCallOptions(owner = owner)

    private fun launchAction(work: suspend () -> Unit) {
        if (pending) return
        pending = true
        error = null
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
    MomentsList(repository, owner, state, page, onBack, { page = "post:$it" }) { composing = true }
}

@Composable private fun MomentsList(
    repository: SessionRepository,
    owner: OwnerRecord,
    state: ClientSyncState,
    mode: String,
    onBack: () -> Unit,
    onOpenPost: (String) -> Unit,
    onCompose: () -> Unit,
) {
    BackHandler(onBack = onBack)
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    val pager = remember(owner, mode) { MomentsPager(repository, owner, mode) }
    val actions = remember(pager) { MomentActions(repository, owner, scope, pager::replace, pager::remove) }
    val list = rememberLazyListState()
    val badge = rememberMomentsBadge(repository, owner)
    val ids = pager.items.flatMap { post -> listOf(post.author) + post.likes + post.comments.flatMap { listOfNotNull(it.author, it.replyTo) } }
    val profiles = characterProfiles(repository, ids.filter { it.kind == "character" }.map { it.refId })
    val names = MomentNames(state, profiles)
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
            val last = list.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            last >= list.layoutInfo.totalItemsCount - 2
        }
    }
    LaunchedEffect(nearEnd, pager.initialized) { if (nearEnd && pager.initialized && !pager.failed) pager.next() }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("‹ 返回") }
            val heading =
                when {
                    mode == "me" -> "我的朋友圈"
                    mode.startsWith("character:") -> "${names.of(MomentsActor("character", mode.removePrefix("character:")))} 的朋友圈"
                    else -> "朋友圈"
                }
            Text(heading, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
            if (!mode.startsWith("character:")) TextButton(onClick = onCompose) { Text("发朋友圈") }
        }
        val interactions = badge?.unseenInteractionCount ?: 0
        if (mode == "feed" && interactions > 0) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                AssistChip(onClick = {
                    scope.launch {
                        userAction({}) {
                            repository.call(
                                Endpoints.momentsEndpointsMarkSeen,
                                body = buildJsonObject { put("scope", "interactions") },
                                options = SessionCallOptions(owner = owner),
                            )
                        }
                    }
                }, label = { Text("$interactions 条新消息") })
            }
        }
        actions.error?.let { Text(it, Modifier.padding(horizontal = WbSpace.S5), color = MaterialTheme.colorScheme.error) }
        when {
            !pager.initialized && pager.failed ->
                Column(Modifier.fillMaxWidth().padding(WbSpace.S8), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("加载失败")
                    Button(onClick = { scope.launch { pager.next() } }) { Text("重试") }
                }
            !pager.initialized -> LinearProgressIndicator(Modifier.fillMaxWidth())
            pager.items.isEmpty() ->
                Text(
                    when {
                        mode == "me" -> "你还没有发过朋友圈"
                        mode.startsWith("character:") -> "TA 还没有发过朋友圈"
                        else -> "还没有朋友圈动态"
                    },
                    Modifier.fillMaxWidth().padding(WbSpace.S8),
                    color = colors.textSecondary,
                )
            else ->
                LazyColumn(state = list, modifier = Modifier.weight(1f), contentPadding = PaddingValues(WbSpace.S5)) {
                    items(pager.items, key = { it.postId }) { post ->
                        MomentCard(post, names, actions, full = false) { onOpenPost(post.postId) }
                    }
                    item(key = "footer") {
                        Box(Modifier.fillMaxWidth().padding(WbSpace.S5), contentAlignment = Alignment.Center) {
                            when {
                                pager.loading -> CircularProgressIndicator(Modifier.size(WbSize.ListIcon))
                                pager.failed ->
                                    Text(
                                        "加载失败，点击重试",
                                        Modifier.clickable { scope.launch { pager.next() } },
                                        color = colors.textLink,
                                    )
                            }
                        }
                    }
                }
        }
        CommentBar(actions)
    }
}

@Composable private fun MomentCard(
    post: MomentsPost,
    names: MomentNames,
    actions: MomentActions,
    full: Boolean,
    onOpen: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    var deleting by remember { mutableStateOf<MomentsComment?>(null) }
    var deletingPost by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().padding(vertical = WbSpace.S4)) {
        val author = post.author
        if (author.kind == "character") {
            RoleAvatar(
                actions.repository,
                actions.owner,
                RoleAvatarIdentity(author.refId, names.of(author), names.profiles[author.refId]?.avatar),
                WbSize.AvatarMd,
            )
        } else {
            RoleAvatar(actions.repository, actions.owner, RoleAvatarIdentity(actions.owner.userId, "我", null, user = true), WbSize.AvatarMd)
        }
        Spacer(Modifier.width(WbSpace.S4))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(WbSpace.S2)) {
            Text(names.of(author), color = colors.textNameInMoments, style = MaterialTheme.typography.titleSmall)
            if (post.text.isNotBlank()) {
                Text(post.text, maxLines = if (full) Int.MAX_VALUE else 6, modifier = Modifier.clickable(onClick = onOpen))
            }
            MomentImages(actions, post)
            post.link?.let { link -> Text("${link.title}  ${link.source.orEmpty()}", color = colors.textLink) }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(momentTime(post.createdAt), color = colors.textTertiary, style = MaterialTheme.typography.bodySmall)
                val selected = (post.visibility as? JsonObject)?.get("kind")?.jsonPrimitive?.contentOrNull == "selected"
                if (selected) {
                    val count = (post.visibility as? JsonObject)?.get("characterIds")?.jsonArray?.size ?: 0
                    Text("  部分可见（仅 $count 个角色）", color = colors.textTertiary, style = MaterialTheme.typography.bodySmall)
                }
                Spacer(Modifier.weight(1f))
                if (post.author.kind == "user") {
                    TextButton(onClick = { deletingPost = true }, enabled = !actions.pending) { Text("删除", color = colors.textLink) }
                }
                TextButton(onClick = { actions.like(post) }, enabled = !actions.pending) { Text(if (post.likedByMe) "取消" else "赞") }
                TextButton(onClick = { actions.replying = post to null }, enabled = !actions.pending) { Text("评论") }
            }
            if (post.likes.isNotEmpty()) {
                Text("♡ " + post.likes.joinToString("，") { names.of(it) }, color = colors.textNameInMoments, style = MaterialTheme.typography.bodySmall)
            }
            post.comments.forEach { comment ->
                val who = names.of(comment.author)
                val line =
                    if (comment.replyTo != null) "$who 回复 ${names.of(comment.replyTo)}：${comment.text}" else "$who：${comment.text}"
                Text(
                    line,
                    Modifier.fillMaxWidth().clickable(enabled = !actions.pending) {
                        if (comment.author.kind == "user") deleting = comment else actions.replying = post to comment
                    },
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
    HorizontalDivider(color = colors.borderHairline)
    deleting?.let { comment ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text("删除这条评论？") },
            confirmButton = {
                TextButton(onClick = {
                    actions.deleteComment(post, comment)
                    deleting = null
                }) { Text("删除", color = colors.textDanger) }
            },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text("取消") } },
        )
    }
    if (deletingPost) {
        AlertDialog(
            onDismissRequest = { deletingPost = false },
            title = { Text("删除这条朋友圈？") },
            confirmButton = {
                TextButton(onClick = {
                    actions.deletePost(post)
                    deletingPost = false
                }) { Text("删除", color = colors.textDanger) }
            },
            dismissButton = { TextButton(onClick = { deletingPost = false }) { Text("取消") } },
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun MomentImages(
    actions: MomentActions,
    post: MomentsPost,
) {
    if (post.images.isEmpty()) return
    val edge = if (post.images.size == 1) 160.dp else 88.dp
    FlowRow(horizontalArrangement = Arrangement.spacedBy(WbSpace.S2), verticalArrangement = Arrangement.spacedBy(WbSpace.S2)) {
        post.images.forEach { image -> MediaThumb(actions.repository, actions.owner, image.mediaId, edge) }
    }
}

/** 底部评论输入栏：点「评论」或别人的评论时出现。 */
@Composable private fun CommentBar(actions: MomentActions) {
    val target = actions.replying ?: return
    var text by remember(target) { mutableStateOf("") }
    BackHandler { actions.replying = null }
    Row(Modifier.fillMaxWidth().imePadding().padding(WbSpace.S3), verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(
            text,
            { text = it.take(COMMENT_LIMIT) },
            Modifier.weight(1f),
            placeholder = { Text(target.second?.let { "回复 ${it.text.take(8)}…" } ?: "评论") },
            maxLines = 4,
        )
        TextButton(enabled = text.isNotBlank() && !actions.pending, onClick = {
            actions.comment(target.first, target.second, text) { actions.replying = null }
        }) { Text("发送") }
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
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("‹ 返回") }
            Text("详情", style = MaterialTheme.typography.titleMedium)
        }
        when {
            deleted || post.error != null && current == null ->
                Text("该动态已删除", Modifier.fillMaxWidth().padding(WbSpace.S8), color = colors.textSecondary)
            current == null -> LinearProgressIndicator(Modifier.fillMaxWidth())
            else ->
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(WbSpace.S5)) {
                    MomentCard(current, MomentNames(state, profiles), actions, full = true) {}
                }
        }
        actions.error?.let { Text(it, Modifier.padding(horizontal = WbSpace.S5), color = MaterialTheme.colorScheme.error) }
        CommentBar(actions)
    }
}

/** 发朋友圈（SOC-09）：文字 + 最多 9 张图 + 谁可以看。 */
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
    var error by remember { mutableStateOf<String?>(null) }
    var leaving by remember { mutableStateOf(false) }
    val picker =
        rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(MOMENT_IMAGE_LIMIT)) { picked ->
            images = (images + picked).distinct().take(MOMENT_IMAGE_LIMIT)
        }
    val dirty = text.isNotBlank() || images.isNotEmpty()
    BackHandler { if (dirty) leaving = true else onCancel() }
    val contacts = state.contacts.filter { it.status == "active" }
    val profiles = characterProfiles(repository, contacts.map { it.characterId })
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(WbSpace.S5),
        verticalArrangement = Arrangement.spacedBy(WbSpace.S3),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { if (dirty) leaving = true else onCancel() }, enabled = !pending) { Text("取消") }
            Spacer(Modifier.weight(1f))
            Button(enabled = !pending && dirty && (!selectedOnly || visibleTo.isNotEmpty()), onClick = {
                pending = true
                error = null
                scope.launch {
                    userAction({ error = "发表失败，请重试" }) {
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
                                            put(
                                                "characterIds",
                                                JsonArray((if (selectedOnly) visibleTo.toList() else emptyList()).map(::JsonPrimitive)),
                                            )
                                        },
                                    )
                                },
                            options = SessionCallOptions(owner = owner),
                        )
                        onPosted()
                    }
                    pending = false
                }
            }) { Text(if (pending) "发表中…" else "发表") }
        }
        OutlinedTextField(
            text,
            { text = it.take(MOMENT_TEXT_LIMIT) },
            Modifier.fillMaxWidth(),
            placeholder = { Text("这一刻的想法…") },
            minLines = 4,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
            Text("图片 ${images.size}/$MOMENT_IMAGE_LIMIT")
            if (images.size < MOMENT_IMAGE_LIMIT) {
                TextButton(enabled = !pending, onClick = {
                    picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                }) { Text("添加图片") }
            }
            if (images.isNotEmpty()) TextButton(enabled = !pending, onClick = { images = emptyList() }) { Text("清除") }
        }
        Text("谁可以看", style = MaterialTheme.typography.titleSmall)
        Row(verticalAlignment = Alignment.CenterVertically) {
            RadioButton(selected = !selectedOnly, onClick = { selectedOnly = false }, enabled = !pending)
            Text("全部角色")
            RadioButton(selected = selectedOnly, onClick = { selectedOnly = true }, enabled = !pending)
            Text("部分角色可见")
        }
        if (selectedOnly) {
            contacts.forEach { contact ->
                val id = contact.characterId
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = id in visibleTo, enabled = !pending, onCheckedChange = {
                        visibleTo = if (id in visibleTo) visibleTo - id else visibleTo + id
                    })
                    Text(contact.remark ?: profiles[id]?.name ?: "角色")
                }
            }
        }
        Text("看不到的角色不会点赞评论，也不会在聊天里提起这条动态", color = colors.textSecondary, style = MaterialTheme.typography.bodySmall)
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    }
    if (leaving) {
        AlertDialog(
            onDismissRequest = { leaving = false },
            title = { Text("退出编辑？") },
            text = { Text("这次编辑的内容不会保留") },
            confirmButton = { TextButton(onClick = onCancel) { Text("不保留", color = colors.textDanger) } },
            dismissButton = { TextButton(onClick = { leaving = false }) { Text("继续编辑") } },
        )
    }
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

/** 发现页（SOC-07）：顶部「朋友圈」入口（新动态角色头像 + 红点），下面是角色广场。 */
@Composable fun DiscoverScreen(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    momentsTarget: String?,
    onMomentsTarget: (String?) -> Unit,
    onOpenConversation: (String) -> Unit,
) {
    val snapshot by runtime.snapshot.collectAsState()
    val state = if (snapshot.owner == owner) snapshot.state else SyncEngine.freshState()
    if (momentsTarget != null) {
        Column(Modifier.fillMaxSize()) { MomentsScreen(repository, owner, state, momentsTarget) { onMomentsTarget(null) } }
        return
    }
    val badge = rememberMomentsBadge(repository, owner)
    val colors = LocalWeibanColors.current
    Column(Modifier.fillMaxSize()) {
        val profiles = characterProfiles(repository, badge?.characterIds.orEmpty())
        Row(
            Modifier.fillMaxWidth().clickable { onMomentsTarget("feed") }.padding(WbSpace.S5),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("朋友圈", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
            badge?.characterIds?.forEach { id ->
                RoleAvatar(repository, owner, RoleAvatarIdentity(id, profiles[id]?.name.orEmpty(), profiles[id]?.avatar), WbSize.AvatarSm)
            }
            if ((badge?.unseenPostCount ?: 0) > 0 || (badge?.unseenInteractionCount ?: 0) > 0) {
                Badge(containerColor = app.weiban.designsystem.LocalWeibanModeColors.current.badgeUnread)
            }
            Text(" ›", color = colors.textSecondary)
        }
        HorizontalDivider(color = colors.borderHairline)
        RoleBrowser(repository, runtime, owner, true, onOpenConversation)
    }
}
