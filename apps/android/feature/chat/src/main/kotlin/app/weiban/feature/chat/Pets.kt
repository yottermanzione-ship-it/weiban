package app.weiban.feature.chat

import android.content.Context
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.weiban.contracts.*
import app.weiban.data.*
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.tokens.WbMotion
import app.weiban.designsystem.tokens.WbOpacity
import app.weiban.designsystem.tokens.WbRadius
import app.weiban.designsystem.tokens.WbSpace
import app.weiban.network.ApiFailure
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.Dispatchers
import kotlinx.serialization.json.*
import java.util.UUID

/** P-38、P-39（契约 PET_LIMITS）。 */
private const val PET_ACTIVE_LIMIT = 3
private const val PET_NAME_MAX = 8
private const val NAMING_POLL_MS = 2_000L
private const val NAMING_POLL_TIMES = 30

private fun stageName(stage: String): String =
    when (stage) {
        "junior" -> "少年"
        "adult" -> "成年"
        else -> "幼年"
    }

/** 名字长度按字符（码点）计，表情等算一个字（与网页 Array.from 一致）。 */
private fun nameLength(name: String): Int = name.trim().codePointCount(0, name.trim().length)

/** 照顾按钮的预置小反应（不调用模型；正式文案待 AI / 产品给出）。 */
private fun reaction(kind: String): String =
    when (kind) {
        "feed" -> "吧唧吧唧，吃得好香"
        "play" -> "开心地转起了圈圈"
        else -> "舒服地眯起了眼睛"
    }

private fun petToast(
    context: Context,
    text: String,
) {
    Toast.makeText(context, text, Toast.LENGTH_SHORT).show()
}

/**
 * 共同领养宠物（PLAY-02；design pages/pet.md）：总览、领养流程、宠物主页、相册、设置。
 * 全屏浮层，从 我 › 服务 › 宠物、聊天信息页「我们的宠物」、私聊提议卡片「去看看」进入。
 */
@Composable internal fun PetsOverlay(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    open: PetsOpen,
    onClose: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    // list / adopt / pet:<id>
    var page by remember(open) { mutableStateOf(if (open.adopt) "adopt" else "list") }
    var fresh by remember(open) { mutableStateOf<String?>(null) }
    val snapshot by runtime.snapshot.collectAsState()
    val state = if (snapshot.owner == owner) snapshot.state else SyncEngine.freshState()
    val pets =
        remote("${owner.sessionId}:pets:${open.characterId}") {
            repository
                .call(
                    Endpoints.petEndpointsListPets,
                    query = buildMap { open.characterId?.let { put("characterId", it) } },
                    options = SessionCallOptions(owner = owner, networkOnly = true),
                ).items
        }
    LaunchedEffect(pets) {
        AppUpdates.updates.collect { if (it is UserUpdateDataChanged && it.data.section == "pets") pets.refresh() }
    }
    // 某角色的宠物：有在养的直接进宠物主页。
    LaunchedEffect(pets.data) {
        val mine = pets.data?.find { it.status == "active" }
        if (open.characterId != null && !open.adopt && page == "list" && mine != null) page = "pet:${mine.petId}"
    }
    Surface(Modifier.fillMaxSize(), color = colors.bgPage) {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            val current = page
            when {
                current == "adopt" ->
                    AdoptFlow(repository, owner, state, pets.data.orEmpty(), open.characterId, { page = "list" }) { adopted ->
                        fresh = adopted.petId
                        pets.refresh()
                        page = "pet:${adopted.petId}"
                    }
                current.startsWith("pet:") ->
                    PetPage(repository, owner, state, current.removePrefix("pet:"), fresh == current.removePrefix("pet:")) {
                        pets.refresh()
                        page = "list"
                    }
                else -> PetList(repository, owner, state, pets, onClose, { page = "adopt" }) { page = "pet:$it" }
            }
        }
    }
}

@Composable private fun PetHeader(
    title: String,
    trailing: String? = null,
    onBack: () -> Unit,
) {
    BackHandler(onBack = onBack)
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        TextButton(onClick = onBack) { Text("‹ 返回") }
        Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
        trailing?.let { Text(it, Modifier.padding(horizontal = WbSpace.S5), color = LocalWeibanColors.current.textSecondary) }
    }
}

@Composable private fun PetPicture(
    repository: SessionRepository,
    owner: OwnerRecord,
    mediaId: String,
    size: Dp,
    modifier: Modifier = Modifier,
) {
    val colors = LocalWeibanColors.current
    val picture = rememberMediaBitmap(repository, owner, mediaId, thumbnail = false, maxEdge = 480)
    Box(modifier.size(size).clip(RoundedCornerShape(WbRadius.Md)).background(colors.bgSkeleton)) {
        picture.bitmap?.let { Image(it.asImageBitmap(), null, Modifier.matchParentSize(), contentScale = ContentScale.Fit) }
    }
}

private fun roleName(
    state: ClientSyncState,
    profiles: Map<String, CharacterProfile>,
    id: String,
): String = state.contacts.find { it.characterId == id }?.remark ?: profiles[id]?.name ?: "TA"

// ---------- 总览 ----------

@Suppress("LongParameterList", "LongMethod") // Overview list with memories section.
@Composable private fun PetList(
    repository: SessionRepository,
    owner: OwnerRecord,
    state: ClientSyncState,
    pets: NativeRemote<List<Pet>>,
    onBack: () -> Unit,
    onAdopt: () -> Unit,
    onOpen: (String) -> Unit,
) {
    val colors = LocalWeibanColors.current
    val items = pets.data.orEmpty()
    val active = items.filter { it.status == "active" }
    val memories = items.filter { it.status != "active" }
    val profiles = characterProfiles(repository, items.map { it.characterId })
    PetHeader("宠物", onBack = onBack)
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(WbSpace.S5),
        verticalArrangement = Arrangement.spacedBy(WbSpace.S3),
    ) {
        when {
            pets.loading && pets.data == null -> LinearProgressIndicator(Modifier.fillMaxWidth())
            pets.error != null && pets.data == null -> {
                Text(pets.error.orEmpty(), color = MaterialTheme.colorScheme.error)
                TextButton(onClick = pets::refresh) { Text("重试") }
            }
        }
        Text("在养 ${active.size} 只（最多 $PET_ACTIVE_LIMIT 只）", color = colors.textSecondary, style = MaterialTheme.typography.bodySmall)
        if (pets.data != null && items.isEmpty()) Text("和 TA 一起养一只小家伙吧", color = colors.textSecondary)
        active.forEach { pet ->
            ListItem(
                leadingContent = { PetPicture(repository, owner, pet.image.mediaId, 56.dp) },
                headlineContent = { Text(pet.name) },
                supportingContent = {
                    Text("和 ${roleName(state, profiles, pet.characterId)} 一起养 · 第 ${pet.daysAdopted} 天 · ${stageName(pet.stage)}")
                },
                modifier = Modifier.clickable { onOpen(pet.petId) },
            )
        }
        TextButton(onClick = onAdopt, enabled = active.size < PET_ACTIVE_LIMIT, modifier = Modifier.fillMaxWidth()) {
            Text(if (active.size < PET_ACTIVE_LIMIT) "＋ 和 TA 一起领养" else "最多同时养 $PET_ACTIVE_LIMIT 只")
        }
        if (memories.isNotEmpty()) {
            Text("回忆", style = MaterialTheme.typography.titleSmall)
            memories.forEach { pet ->
                ListItem(
                    leadingContent = { PetPicture(repository, owner, pet.image.mediaId, 56.dp) },
                    headlineContent = { Text(pet.name) },
                    supportingContent = { Text("和 ${roleName(state, profiles, pet.characterId)} · 养了 ${pet.daysAdopted} 天") },
                    modifier = Modifier.alpha(WbOpacity.Muted).clickable { onOpen(pet.petId) },
                )
            }
        }
    }
}

// ---------- 领养流程 ----------

@Suppress("LongParameterList", "LongMethod", "CyclomaticComplexMethod") // Four short steps share one state holder.
@Composable private fun AdoptFlow(
    repository: SessionRepository,
    owner: OwnerRecord,
    state: ClientSyncState,
    pets: List<Pet>,
    preset: String?,
    onBack: () -> Unit,
    onAdopted: (PetDetail) -> Unit,
) {
    val context = LocalContext.current
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    var characterId by remember { mutableStateOf(preset) }
    var species by remember { mutableStateOf<PetSpecies?>(null) }
    var appearance by remember { mutableStateOf<PetAppearance?>(null) }
    var name by remember { mutableStateOf("") }
    var naming by remember { mutableStateOf<PetNamingRequest?>(null) }
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val clientRequestId = remember { UUID.randomUUID().toString() }
    val catalog =
        remote("${owner.sessionId}:pet-species") {
            repository.call(Endpoints.petEndpointsListSpecies, options = SessionCallOptions(owner = owner)).items
        }
    val candidates = state.contacts.filter { it.status == "active" && it.conversationId != null }
    val profiles = characterProfiles(repository, candidates.map { it.characterId })
    val chosen = characterId
    val back: () -> Unit = {
        when {
            appearance != null -> appearance = null
            species != null -> species = null
            chosen != null && preset == null -> characterId = null
            else -> onBack()
        }
    }
    val title = chosen?.let { "和 ${roleName(state, profiles, it)} 一起领养" } ?: "选一个 TA"
    val step =
        when {
            chosen == null -> null
            species == null -> "1/3"
            appearance == null -> "2/3"
            else -> "3/3"
        }
    PetHeader(title, step, back)
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(WbSpace.S5),
        verticalArrangement = Arrangement.spacedBy(WbSpace.S3),
    ) {
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        val pickedSpecies = species
        val pickedAppearance = appearance
        when {
            chosen == null -> {
                if (candidates.isEmpty()) Text("先添加一个角色，再一起领养吧", color = colors.textSecondary)
                candidates.forEach { contact ->
                    val existing = pets.find { it.characterId == contact.characterId && it.status == "active" }
                    val profile = profiles[contact.characterId]
                    ListItem(
                        leadingContent = {
                            RoleAvatar(
                                repository,
                                owner,
                                RoleAvatarIdentity(
                                    contact.characterId,
                                    profile?.name.orEmpty(),
                                    profile?.avatar,
                                    contact.customAvatarMediaId,
                                ),
                            )
                        },
                        headlineContent = { Text(roleName(state, profiles, contact.characterId)) },
                        supportingContent = { existing?.let { Text("已经有 ${it.name} 了", color = colors.textTertiary) } },
                        modifier =
                            Modifier
                                .alpha(if (existing == null) 1f else WbOpacity.Disabled)
                                .clickable(enabled = existing == null) { characterId = contact.characterId },
                    )
                }
            }
            pickedSpecies == null -> {
                if (catalog.loading && catalog.data == null) LinearProgressIndicator(Modifier.fillMaxWidth())
                catalog.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                catalog.data.orEmpty().filter { it.listed }.forEach { item ->
                    ListItem(
                        leadingContent = {
                            item.appearances.firstOrNull()?.let { PetPicture(repository, owner, it.images.baby.mediaId, 56.dp) }
                        },
                        headlineContent = { Text(item.name) },
                        supportingContent = { Text(item.intro, maxLines = 2) },
                        modifier = Modifier.clickable { species = item },
                    )
                }
            }
            pickedAppearance == null -> {
                Text("选一个样子（会从幼年长到成年）", color = colors.textSecondary)
                pickedSpecies.appearances.forEach { item ->
                    Column(Modifier.fillMaxWidth().clickable { appearance = item }.padding(vertical = WbSpace.S3)) {
                        Text(item.name, style = MaterialTheme.typography.titleSmall)
                        Row(horizontalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
                            val stages = listOf(item.images.baby to "幼年", item.images.junior to "少年", item.images.adult to "成年")
                            for ((image, label) in stages) {
                                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                    PetPicture(repository, owner, image.mediaId, 72.dp)
                                    Text(label, style = MaterialTheme.typography.bodySmall, color = colors.textSecondary)
                                }
                            }
                        }
                    }
                    HorizontalDivider(color = colors.borderHairline)
                }
            }
            else -> {
                PetPicture(repository, owner, pickedAppearance.images.baby.mediaId, 160.dp, Modifier.align(Alignment.CenterHorizontally))
                OutlinedTextField(
                    name,
                    { name = it.take(PET_NAME_MAX * 2) },
                    Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text("给它起个名字（1～$PET_NAME_MAX 个字）") },
                    isError = nameLength(name) > PET_NAME_MAX,
                    supportingText = { Text("${nameLength(name)} / $PET_NAME_MAX") },
                )
                val request = naming
                when {
                    request == null ->
                        TextButton(enabled = !pending, onClick = {
                            pending = true
                            error = null
                            scope.launch {
                                try {
                                    var latest =
                                        repository.call(
                                            Endpoints.petEndpointsRequestNames,
                                            body =
                                                buildJsonObject {
                                                    put("characterId", chosen)
                                                    put("speciesId", pickedSpecies.speciesId)
                                                    put("appearanceId", pickedAppearance.appearanceId)
                                                },
                                            options = SessionCallOptions(owner = owner, networkOnly = true),
                                        )
                                    naming = latest
                                    var times = 0
                                    while (latest.status == "pending" && times < NAMING_POLL_TIMES) {
                                        delay(NAMING_POLL_MS)
                                        latest =
                                            repository.call(
                                                Endpoints.petEndpointsGetNamingRequest,
                                                params = mapOf("requestId" to latest.requestId),
                                                options = SessionCallOptions(owner = owner, networkOnly = true),
                                            )
                                        naming = latest
                                        times++
                                    }
                                } catch (failure: CancellationException) {
                                    throw failure
                                } catch (failure: ApiFailure) {
                                    error = if (failure.code == "insufficient_balance") "余额不足，暂时不能让 TA 起名" else "起名暂时没成功，可以自己起一个"
                                } catch (_: java.io.IOException) {
                                    error = "网络不可用，请重试"
                                } finally {
                                    pending = false
                                }
                            }
                        }) { Text("让 TA 起名") }
                    request.status == "pending" -> Text("TA 正在想名字…", color = colors.textSecondary)
                    request.names.isEmpty() -> Text("TA 没想出来，可以自己起一个", color = colors.textSecondary)
                    else ->
                        Row(horizontalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
                            request.names.forEach { candidate ->
                                FilterChip(selected = name == candidate, onClick = { name = candidate }, label = { Text(candidate) })
                            }
                        }
                }
                Button(
                    enabled = !pending && nameLength(name) in 1..PET_NAME_MAX,
                    modifier = Modifier.fillMaxWidth(),
                    onClick = {
                        pending = true
                        error = null
                        scope.launch {
                            try {
                                val adopted =
                                    repository.call(
                                        Endpoints.petEndpointsAdopt,
                                        body =
                                            buildJsonObject {
                                                put("clientRequestId", clientRequestId)
                                                put("characterId", chosen)
                                                put("speciesId", pickedSpecies.speciesId)
                                                put("appearanceId", pickedAppearance.appearanceId)
                                                put("name", name.trim())
                                                naming?.let { put("namingRequestId", it.requestId) }
                                            },
                                        options = SessionCallOptions(owner = owner, networkOnly = true),
                                    )
                                onAdopted(adopted)
                            } catch (failure: CancellationException) {
                                throw failure
                            } catch (failure: ApiFailure) {
                                error =
                                    if (failure.code == "limit_reached") {
                                        "最多同时养 $PET_ACTIVE_LIMIT 只，每个 TA 只能一起养 1 只"
                                    } else {
                                        "领养暂时没成功，请稍后再试"
                                    }
                            } catch (_: java.io.IOException) {
                                petToast(context, "网络不可用，请重试")
                            } finally {
                                pending = false
                            }
                        }
                    },
                ) { Text("领养") }
            }
        }
    }
}

// ---------- 宠物主页 ----------

@Suppress("LongParameterList", "LongMethod", "CyclomaticComplexMethod") // Page with care buttons, timeline, album and settings.
@Composable private fun PetPage(
    repository: SessionRepository,
    owner: OwnerRecord,
    state: ClientSyncState,
    petId: String,
    justAdopted: Boolean,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    val detail =
        remote("${owner.sessionId}:pet:$petId") {
            repository.call(
                Endpoints.petEndpointsGetPet,
                params = mapOf("petId" to petId),
                options = SessionCallOptions(owner = owner, networkOnly = true),
            )
        }
    val album =
        remote("${owner.sessionId}:pet-album:$petId") {
            repository
                .call(
                    Endpoints.petEndpointsListAlbum,
                    params = mapOf("petId" to petId),
                    options = SessionCallOptions(owner = owner, networkOnly = true),
                ).items
        }
    LaunchedEffect(detail) {
        AppUpdates.updates.collect {
            if (it is UserUpdateDataChanged && it.data.section == "pets") {
                detail.refresh()
                album.refresh()
            }
        }
    }
    var reactionText by remember { mutableStateOf<String?>(null) }
    var renaming by remember { mutableStateOf(false) }
    var sendingAway by remember { mutableStateOf(false) }
    var viewing by remember { mutableStateOf<PetAlbumPhoto?>(null) }
    var busy by remember { mutableStateOf(false) }
    val bounce = remember { Animatable(1f) }
    // 领养完成：形象弹出一次（M-13）。
    LaunchedEffect(justAdopted) {
        if (justAdopted) {
            bounce.snapTo(0.6f)
            bounce.animateTo(1f, tween(WbMotion.SlowMs, easing = WbMotion.Spring))
        }
    }
    val pet = detail.data
    val profiles = characterProfiles(repository, listOfNotNull(pet?.characterId))
    val upload =
        rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri: Uri? ->
            if (uri == null) return@rememberLauncherForActivityResult
            busy = true
            scope.launch {
                try {
                    userAction({ petToast(context, "上传失败，请稍后再试") }) {
                        val bytes =
                            withContext(Dispatchers.IO) { context.contentResolver.openInputStream(uri)?.use { it.readBytes() } }
                                ?: return@userAction
                        val mime = context.contentResolver.getType(uri) ?: "image/jpeg"
                        val media = uploadMedia(repository, owner, bytes, mime, "pet_photo")
                        repository.call(
                            Endpoints.petEndpointsAddAlbumPhoto,
                            params = mapOf("petId" to petId),
                            body = buildJsonObject { put("mediaId", media.mediaId) },
                            options = SessionCallOptions(owner = owner, networkOnly = true),
                        )
                        album.refresh()
                    }
                } finally {
                    busy = false
                }
            }
        }
    val act: (suspend () -> Unit) -> Unit = { work ->
        if (!busy) {
            busy = true
            scope.launch {
                try {
                    userAction({ petToast(context, it) }) { work() }
                } finally {
                    busy = false
                }
            }
        }
    }
    PetHeader(pet?.name ?: "宠物", if (pet?.status == "sent_away") "回忆" else null, onBack)
    if (pet == null) {
        if (detail.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        detail.error?.let {
            Text(it, Modifier.padding(WbSpace.S5), color = MaterialTheme.colorScheme.error)
            TextButton(onClick = detail::refresh) { Text("重试") }
        }
        return
    }
    val active = pet.status == "active"
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(WbSpace.S5),
        verticalArrangement = Arrangement.spacedBy(WbSpace.S3),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        PetPicture(repository, owner, pet.image.mediaId, 200.dp, Modifier.scale(bounce.value))
        Text("和 ${roleName(state, profiles, pet.characterId)} 一起养", color = colors.textSecondary)
        Text("领养第 ${pet.daysAdopted} 天 · ${stageName(pet.stage)} · 亲密值 ${pet.intimacy}")
        reactionText?.let { Text("${pet.name}$it", color = colors.textSecondary) }
        if (active) {
            Row(horizontalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
                for ((kind, label) in listOf("feed" to "喂食", "play" to "玩耍", "pat" to "摸摸")) {
                    FilledTonalButton(enabled = !busy, onClick = {
                        // 点了就有反应（M-19），不等服务器；亲密值按服务器结果更新。
                        reactionText = reaction(kind)
                        scope.launch {
                            bounce.snapTo(0.9f)
                            bounce.animateTo(1f, tween(WbMotion.BaseMs, easing = WbMotion.Spring))
                        }
                        act {
                            repository.call(
                                Endpoints.petEndpointsInteract,
                                params = mapOf("petId" to petId),
                                body =
                                    buildJsonObject {
                                        put("kind", kind)
                                        put("clientActionId", UUID.randomUUID().toString())
                                    },
                                options = SessionCallOptions(owner = owner, networkOnly = true),
                            )
                            detail.refresh()
                        }
                    }) { Text(label) }
                }
            }
        }
        Text("成长记录", Modifier.fillMaxWidth(), style = MaterialTheme.typography.titleSmall)
        pet.timeline.sortedByDescending { it.at }.forEach { entry ->
            val text =
                when (entry.kind) {
                    "adopted" -> "一起领养了 ${pet.name}"
                    "stage_changed" -> "长成${stageName(entry.detail["stage"].orEmpty())}啦"
                    "renamed" -> "改名：${entry.detail["from"].orEmpty()} → ${entry.detail["to"].orEmpty()}"
                    "sent_away" -> "送养了"
                    else -> "成长记录"
                }
            Row(Modifier.fillMaxWidth()) {
                Text(entry.at.take(10), Modifier.width(96.dp), color = colors.textTertiary, style = MaterialTheme.typography.bodySmall)
                Text(text, style = MaterialTheme.typography.bodySmall)
            }
        }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("相册", Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
            if (active) {
                TextButton(
                    enabled = !busy,
                    onClick = { upload.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                ) {
                    Text("上传照片")
                }
            }
        }
        val photos = album.data.orEmpty()
        if (album.data != null && photos.isEmpty()) Text("还没有照片", Modifier.fillMaxWidth(), color = colors.textSecondary)
        photos.chunked(3).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
                row.forEach { photo ->
                    Box(Modifier.weight(1f).aspectRatio(1f).clickable { viewing = photo }) {
                        val picture = rememberMediaBitmap(repository, owner, photo.mediaId, thumbnail = true, maxEdge = 320)
                        Box(Modifier.matchParentSize().background(colors.bgSkeleton))
                        picture.bitmap?.let {
                            Image(it.asImageBitmap(), null, Modifier.matchParentSize(), contentScale = ContentScale.Crop)
                        }
                    }
                }
                repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
        if (active) {
            Text("设置", Modifier.fillMaxWidth(), style = MaterialTheme.typography.titleSmall)
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("允许 TA 在朋友圈晒${pet.name}", Modifier.weight(1f))
                Switch(checked = pet.allowMomentsShare, enabled = !busy, onCheckedChange = { value ->
                    act {
                        detail.data =
                            repository.call(
                                Endpoints.petEndpointsUpdatePet,
                                params = mapOf("petId" to petId),
                                body = buildJsonObject { put("allowMomentsShare", value) },
                                options = SessionCallOptions(owner = owner, networkOnly = true),
                            )
                    }
                })
            }
            TextButton(onClick = { renaming = true }, modifier = Modifier.fillMaxWidth()) { Text("改名") }
            TextButton(onClick = { sendingAway = true }, modifier = Modifier.fillMaxWidth()) { Text("送养", color = colors.textDanger) }
        }
    }
    if (renaming) {
        var next by remember { mutableStateOf(pet.name) }
        AlertDialog(
            onDismissRequest = { renaming = false },
            title = { Text("改名") },
            text = {
                OutlinedTextField(
                    next,
                    { next = it.take(PET_NAME_MAX * 2) },
                    singleLine = true,
                    isError = nameLength(next) > PET_NAME_MAX,
                    supportingText = { Text("${nameLength(next)} / $PET_NAME_MAX") },
                )
            },
            confirmButton = {
                TextButton(enabled = nameLength(next) in 1..PET_NAME_MAX && !busy, onClick = {
                    act {
                        detail.data =
                            repository.call(
                                Endpoints.petEndpointsUpdatePet,
                                params = mapOf("petId" to petId),
                                body = buildJsonObject { put("name", next.trim()) },
                                options = SessionCallOptions(owner = owner, networkOnly = true),
                            )
                        renaming = false
                    }
                }) { Text("保存") }
            },
            dismissButton = { TextButton(onClick = { renaming = false }) { Text("取消") } },
        )
    }
    if (sendingAway) {
        AlertDialog(
            onDismissRequest = { sendingAway = false },
            title = { Text("送养${pet.name}？") },
            text = { Text("送养后${pet.name}会移到「回忆」，成长记录和相册都会保留。") },
            confirmButton = {
                TextButton(enabled = !busy, onClick = {
                    act {
                        detail.data =
                            repository.call(
                                Endpoints.petEndpointsSendAway,
                                params = mapOf("petId" to petId),
                                options = SessionCallOptions(owner = owner, networkOnly = true),
                            )
                        sendingAway = false
                    }
                }) { Text("送养", color = colors.textDanger) }
            },
            dismissButton = { TextButton(onClick = { sendingAway = false }) { Text("取消") } },
        )
    }
    viewing?.let { photo ->
        AlertDialog(
            onDismissRequest = { viewing = null },
            text = { PetPicture(repository, owner, photo.mediaId, 280.dp) },
            confirmButton = { TextButton(onClick = { viewing = null }) { Text("关闭") } },
            dismissButton = {
                if (active) {
                    TextButton(onClick = {
                        act {
                            repository.call(
                                Endpoints.petEndpointsDeleteAlbumPhoto,
                                params = mapOf("petId" to petId, "photoId" to photo.photoId),
                                options = SessionCallOptions(owner = owner, networkOnly = true),
                            )
                            viewing = null
                            album.refresh()
                        }
                    }) { Text("从相册移除") }
                }
            },
        )
    }
}
