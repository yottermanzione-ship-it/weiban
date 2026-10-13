package app.weiban.feature.chat

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.weiban.contracts.*
import app.weiban.data.*
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.LocalWeibanModeColors
import app.weiban.designsystem.tokens.WbMotion
import app.weiban.designsystem.tokens.WbRadius
import app.weiban.designsystem.tokens.WbSize
import app.weiban.designsystem.tokens.WbSpace

private const val GRID_COLUMNS = 3
private const val BADGE_COLUMNS = 4

@Composable private fun cardTone(kind: String): Color {
    val mode = LocalWeibanModeColors.current
    return when (kind) {
        "anniversary" -> mode.cardMemorial
        "familiarity" -> mode.cardFamiliarity
        "holiday" -> mode.cardFestival
        else -> mode.cardMoment
    }
}

@Composable private fun PageHeader(
    title: String,
    onBack: () -> Unit,
) {
    BackHandler(onBack = onBack)
    app.weiban.designsystem.WbNavBar(title, onBack) {
        CapsuleSpace()
    }
}

/** 卡册「看过」的张数（红点：有比上次看过更多的卡时亮，T-083 同一规则）。 */
private fun seenKey(characterId: String) = "cards:seen:$characterId"

// ---------- 卡册总览（我 › 服务 › 卡册） ----------

@Suppress("LongMethod") // Album list with per-role badge.
@Composable
fun CardAlbumsScreen(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    onBack: () -> Unit,
) {
    var opened by remember(owner) { mutableStateOf<String?>(null) }
    opened?.let { id ->
        Column(Modifier.fillMaxSize()) { CardAlbumPage(repository, runtime, owner, id) { opened = null } }
        return
    }
    val colors = LocalWeibanColors.current
    val albums =
        remote("${owner.sessionId}:card-albums") {
            repository.call(Endpoints.growthCardEndpointsListAlbums, options = SessionCallOptions(owner = owner))
        }
    LaunchedEffect(albums) {
        AppUpdates.updates.collect { if (it is UserUpdateDataChanged && it.data.section == "cards") albums.refresh() }
    }
    val snapshot by runtime.snapshot.collectAsState()
    val contacts = if (snapshot.owner == owner) snapshot.state.contacts else emptyList()
    val items = albums.data?.items.orEmpty()
    val profiles = characterProfiles(repository, items.map { it.characterId })
    var seen by remember(owner) { mutableStateOf<Map<String, Long>>(emptyMap()) }
    LaunchedEffect(items) {
        seen = items.associate { it.characterId to (repository.flags.get(owner, seenKey(it.characterId))?.toLongOrNull() ?: 0L) }
    }
    Column(Modifier.fillMaxSize()) {
        PageHeader("卡册", onBack)
        when {
            albums.loading && albums.data == null -> LinearProgressIndicator(Modifier.fillMaxWidth())
            albums.error != null && albums.data == null -> RetryRow(albums.error.orEmpty(), albums::refresh)
            items.isEmpty() -> Text("和角色认识满 7 天，会收到第一张纪念卡", Modifier.padding(WbSpace.S5), color = colors.textSecondary)
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            items.sortedByDescending { it.latestObtainedOn.orEmpty() }.forEach { album ->
                val profile = profiles[album.characterId]
                val contact = contacts.find { it.characterId == album.characterId }
                ListItem(
                    leadingContent = {
                        RoleAvatar(
                            repository,
                            owner,
                            RoleAvatarIdentity(album.characterId, profile?.name.orEmpty(), profile?.avatar, contact?.customAvatarMediaId),
                            WbSize.AvatarMd,
                        )
                    },
                    headlineContent = { Text(contact?.remark ?: profile?.name ?: "角色") },
                    supportingContent = {
                        Text(
                            "已收集 ${album.obtainedCount} 张" + (album.latestObtainedOn?.let { " · 最近获得 $it" } ?: ""),
                            color = colors.textSecondary,
                        )
                    },
                    trailingContent = {
                        if (album.obtainedCount > (seen[album.characterId] ?: album.obtainedCount)) {
                            Badge(containerColor = LocalWeibanModeColors.current.badgeUnread)
                        }
                    },
                    modifier = Modifier.clickable { opened = album.characterId },
                )
                HorizontalDivider(color = colors.borderHairline)
            }
        }
    }
}

@Composable private fun RetryRow(
    text: String,
    onRetry: () -> Unit,
) {
    Row(Modifier.fillMaxWidth().padding(WbSpace.S5), verticalAlignment = Alignment.CenterVertically) {
        Text(text, Modifier.weight(1f), color = MaterialTheme.colorScheme.error)
        TextButton(onClick = onRetry) { Text("重试") }
    }
}

// ---------- 某角色的卡册 ----------

@Suppress("LongMethod", "CyclomaticComplexMethod") // Header plus four card groups in one scroll.
@Composable
internal fun CardAlbumPage(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    characterId: String,
    onBack: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    val album =
        remote("${owner.sessionId}:card-album:$characterId") {
            repository.call(
                Endpoints.growthCardEndpointsGetAlbum,
                params = mapOf("characterId" to characterId),
                options = SessionCallOptions(owner = owner),
            )
        }
    LaunchedEffect(album) {
        AppUpdates.updates.collect { if (it is UserUpdateDataChanged && it.data.section == "cards") album.refresh() }
    }
    val snapshot by runtime.snapshot.collectAsState()
    val contact = if (snapshot.owner == owner) snapshot.state.contacts.find { it.characterId == characterId } else null
    val names = characterNames(repository, listOf(characterId))
    val name = contact?.remark ?: names[characterId] ?: "角色"
    val data = album.data
    LaunchedEffect(data?.obtained?.size) {
        data?.let { repository.flags.set(owner, seenKey(characterId), it.obtained.size.toString()) }
    }
    PageHeader("和 $name 的卡册", onBack)
    // 「卡片 / 我们的瞬间」两个视图（旧版好交互，放进卡册小程序）。
    var moments by androidx.compose.runtime.saveable
        .rememberSaveable(characterId) { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().padding(horizontal = WbSpace.S5), horizontalArrangement = Arrangement.spacedBy(WbSpace.S2)) {
        FilterChip(selected = !moments, onClick = { moments = false }, label = { Text("卡片") })
        FilterChip(selected = moments, onClick = { moments = true }, label = { Text("我们的瞬间") })
    }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(WbSpace.S5),
        verticalArrangement = Arrangement.spacedBy(WbSpace.S4),
    ) {
        when {
            data == null && album.loading -> LinearProgressIndicator(Modifier.fillMaxWidth())
            data == null -> RetryRow(album.error ?: "加载失败", album::refresh)
        }
        val value = data ?: return@Column
        if (moments) {
            MomentsTimeline(repository, owner, value.obtained) { L6Overlays.openCard(characterId, it) }
            return@Column
        }
        Text("已收集 ${value.obtained.size} 张", style = MaterialTheme.typography.titleLarge)
        value.obtained.maxByOrNull { it.obtainedOn }?.let {
            Text("最近获得：${it.obtainedOn}", color = colors.textSecondary, style = MaterialTheme.typography.bodySmall)
        }
        if (value.obtained.isEmpty() && value.locked.isEmpty()) {
            Text("和 TA 认识满 7 天，会收到第一张纪念卡", color = colors.textSecondary)
        }
        val groups =
            listOf(
                Triple("纪念卡", listOf("anniversary"), null),
                Triple("熟悉度卡", listOf("familiarity"), null),
                Triple("节日卡", listOf("holiday"), "节日当天和 TA 聊天，就会收到节日卡"),
                Triple("瞬间卡", listOf("moment", "pet", "play"), "一起经历特别的时刻，会收到瞬间卡"),
            )
        for ((title, kinds, empty) in groups) {
            val obtained = value.obtained.filter { it.kind in kinds }.sortedBy { it.serialNo }
            // 瞬间卡、节日卡不显示未获得项（GRW-05 第 4 条）。
            val showsLocked = kinds.first() == "anniversary" || kinds.first() == "familiarity"
            val locked = if (showsLocked) value.locked.filter { it.kind in kinds } else emptyList()
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(8.dp).clip(CircleShape).background(cardTone(kinds.first())))
                Spacer(Modifier.width(WbSpace.S3))
                Text(title, style = MaterialTheme.typography.titleSmall)
            }
            if (obtained.isEmpty() && locked.isEmpty() && empty != null) {
                Text(empty, color = colors.textSecondary, style = MaterialTheme.typography.bodySmall)
            }
            val tiles: List<Any> = obtained + locked
            tiles.chunked(GRID_COLUMNS).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(WbSpace.S4)) {
                    row.forEach { tile ->
                        when (tile) {
                            is GrowthCard ->
                                CardTile(repository, owner, tile, Modifier.weight(1f)) { L6Overlays.openCard(characterId, tile.cardId) }
                            is LockedCard -> LockedTile(tile, Modifier.weight(1f))
                        }
                    }
                    repeat(GRID_COLUMNS - row.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
    }
}

@Composable private fun CardFace(
    repository: SessionRepository,
    owner: OwnerRecord,
    card: GrowthCard,
    modifier: Modifier,
    maxEdge: Int,
) {
    val tone = cardTone(card.kind)
    Box(modifier.background(tone), contentAlignment = Alignment.Center) {
        // 卡面图没有或加载失败时用类型色 + 星星占位（cards-familiarity.md 第 6 节）。
        Text("★", color = Color.White, style = MaterialTheme.typography.headlineMedium)
        val mediaId = card.face.mediaId
        if (mediaId != null) {
            val picture = rememberMediaBitmap(repository, owner, mediaId, thumbnail = false, maxEdge = maxEdge)
            picture.bitmap?.let { Image(it.asImageBitmap(), null, Modifier.matchParentSize(), contentScale = ContentScale.Crop) }
        }
    }
}

@Composable private fun CardTile(
    repository: SessionRepository,
    owner: OwnerRecord,
    card: GrowthCard,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    Column(modifier.clickable(onClick = onClick)) {
        CardFace(repository, owner, card, Modifier.fillMaxWidth().aspectRatio(3f / 4f).clip(RoundedCornerShape(WbRadius.Md)), 360)
        Text(card.title, maxLines = 1, style = MaterialTheme.typography.bodySmall)
        Text(serialText(card.serialNo), color = colors.textTertiary, style = MaterialTheme.typography.labelSmall)
    }
}

@Composable private fun LockedTile(
    card: LockedCard,
    modifier: Modifier,
) {
    val colors = LocalWeibanColors.current
    Column(modifier) {
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(3f / 4f)
                .clip(RoundedCornerShape(WbRadius.Md))
                .background(LocalWeibanModeColors.current.cardSilhouette)
                .padding(WbSpace.S3),
            contentAlignment = Alignment.Center,
        ) {
            Text(card.condition, color = colors.textSecondary, textAlign = TextAlign.Center, style = MaterialTheme.typography.bodySmall)
        }
        Text(card.title, maxLines = 1, color = colors.textTertiary, style = MaterialTheme.typography.bodySmall)
    }
}

// ---------- 卡片详情（全屏浮层） ----------

@Suppress("LongMethod") // Scrim, pager and the two actions.
@Composable
internal fun CardDetailOverlay(
    repository: SessionRepository,
    owner: OwnerRecord,
    open: CardOpen,
    onClose: () -> Unit,
) {
    BackHandler(onBack = onClose)
    val colors = LocalWeibanColors.current
    val album =
        remote("${owner.sessionId}:card-album:${open.characterId}") {
            repository.call(
                Endpoints.growthCardEndpointsGetAlbum,
                params = mapOf("characterId" to open.characterId),
                options = SessionCallOptions(owner = owner),
            )
        }
    val single =
        remote("${owner.sessionId}:card:${open.cardId}") {
            repository.call(
                Endpoints.growthCardEndpointsGetCard,
                params = mapOf("cardId" to open.cardId),
                options = SessionCallOptions(owner = owner),
            )
        }
    val cards =
        album.data
            ?.obtained
            ?.sortedBy { it.serialNo }
            ?.takeIf { list -> list.any { it.cardId == open.cardId } } ?: listOfNotNull(single.data)
    Box(
        Modifier.fillMaxSize().background(colors.bgScrim).clickable(onClick = onClose),
        contentAlignment = Alignment.Center,
    ) {
        if (cards.isEmpty()) {
            if (album.error != null && single.error != null) Text("卡片加载失败", color = Color.White) else CircularProgressIndicator()
            return@Box
        }
        val start = cards.indexOfFirst { it.cardId == open.cardId }.coerceAtLeast(0)
        val pager = rememberPagerState(initialPage = start) { cards.size }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            // 左右滑动切换同一本卡册的其他已获得卡片（3.3）。
            HorizontalPager(pager, Modifier.fillMaxWidth()) { page ->
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { FlipCard(repository, owner, cards[page]) }
            }
            Spacer(Modifier.height(WbSpace.S5))
            Row(horizontalArrangement = Arrangement.spacedBy(WbSpace.S4)) {
                FilledTonalButton(onClick = {
                    val card = cards.getOrNull(pager.currentPage) ?: return@FilledTonalButton
                    onClose()
                    L6Overlays.shareCard(card.cardId)
                }) { Text("生成分享图") }
                TextButton(onClick = onClose) { Text("关闭", color = Color.White) }
            }
        }
    }
}

@Suppress("LongMethod") // Front and back faces of one card.
@Composable
private fun FlipCard(
    repository: SessionRepository,
    owner: OwnerRecord,
    card: GrowthCard,
) {
    val colors = LocalWeibanColors.current
    var back by remember(card.cardId) { mutableStateOf(false) }
    val front by animateFloatAsState(if (back) 0f else 1f, tween(WbMotion.FastMs), label = "卡片翻面")
    // 第一次打开新卡播放弹出动画（M-13），之后不再播放。
    val pop = remember(card.cardId) { Animatable(1f) }
    LaunchedEffect(card.cardId) {
        val key = "card:opened:${card.cardId}"
        if (repository.flags.get(owner, key) == null) {
            repository.flags.set(owner, key, "1")
            pop.snapTo(0.6f)
            pop.animateTo(1f, tween(WbMotion.SlowMs, easing = WbMotion.Spring))
        }
    }
    Box(
        Modifier
            .width(280.dp)
            .aspectRatio(3f / 4f)
            .scale(pop.value)
            .clip(RoundedCornerShape(WbRadius.Lg))
            .background(colors.bgSurface)
            .clickable { back = !back },
    ) {
        Column(Modifier.fillMaxSize().alpha(front)) {
            CardFace(repository, owner, card, Modifier.fillMaxWidth().weight(1f), 840)
            Column(Modifier.padding(WbSpace.S4)) {
                Text(card.line.ifBlank { card.title }, maxLines = 2, style = MaterialTheme.typography.bodyLarge)
                Text(
                    "${serialText(card.serialNo)} · ${card.obtainedOn}",
                    color = colors.textTertiary,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
        if (front < 1f) {
            Column(
                Modifier.fillMaxSize().alpha(1f - front).padding(WbSpace.S5),
                verticalArrangement = Arrangement.spacedBy(WbSpace.S3, Alignment.CenterVertically),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(card.title, style = MaterialTheme.typography.titleMedium)
                Text(cardKindName(card.kind), color = colors.textSecondary)
                Text(serialText(card.serialNo), color = colors.textSecondary)
                Text("获得于 ${card.obtainedOn}", color = colors.textSecondary)
                if (card.line.isNotBlank()) Text("「${card.line}」", textAlign = TextAlign.Center)
            }
        }
    }
}

// ---------- 成就页（我 › 服务 › 成就） ----------

private val achievementGroups =
    listOf(
        "acquaintance" to "相识",
        "chat_call" to "聊天与通话",
        "group_moments" to "群聊与朋友圈",
        "collect" to "收藏与卡片",
        "anniversary" to "纪念日与熟悉度",
        "play" to "互动玩法",
    )

@Composable private fun achievementTone(group: String): Color {
    val mode = LocalWeibanModeColors.current
    return when (group) {
        "acquaintance" -> mode.achievementMeet
        "chat_call" -> mode.achievementChat
        "group_moments" -> mode.achievementSocial
        "collect" -> mode.achievementCollect
        "anniversary" -> mode.achievementMemorial
        else -> mode.achievementPlay
    }
}

@Suppress("LongMethod") // Header, grouped badge grid and the detail dialog.
@Composable
fun AchievementsScreen(
    repository: SessionRepository,
    owner: OwnerRecord,
    onBack: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    val list = remote("${owner.sessionId}:achievements") { loadAchievements(repository, owner) }
    LaunchedEffect(list) {
        AppUpdates.updates.collect { if (it is UserUpdateDataChanged && it.data.section == "achievements") list.refresh() }
    }
    var fresh by remember(owner) { mutableStateOf<Set<String>>(emptySet()) }
    LaunchedEffect(owner) {
        fresh =
            repository.flags
                .get(owner, ACHIEVEMENT_NEW_FLAG)
                .orEmpty()
                .split(',')
                .filter(String::isNotBlank)
                .toSet()
        // 新获得的红点只在这一次进入时显示，离开成就页后消失（5.1）。
        repository.flags.set(owner, ACHIEVEMENT_NEW_FLAG, "")
    }
    var detail by remember { mutableStateOf<Achievement?>(null) }
    val items = list.data.orEmpty()
    Column(Modifier.fillMaxSize()) {
        PageHeader("成就", onBack)
        when {
            list.loading && list.data == null -> LinearProgressIndicator(Modifier.fillMaxWidth())
            list.error != null && list.data == null -> RetryRow(list.error.orEmpty(), list::refresh)
        }
        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(WbSpace.S5),
            verticalArrangement = Arrangement.spacedBy(WbSpace.S4),
        ) {
            if (items.isNotEmpty()) {
                // 分母按接口返回的数量算（分批上线，GRW-06 验收）。
                Text(
                    "已获得 ${items.count { it.unlockedAt != null }} / ${items.size}",
                    Modifier.fillMaxWidth(),
                    textAlign = TextAlign.Center,
                    style = MaterialTheme.typography.headlineSmall,
                )
            }
            for ((group, title) in achievementGroups) {
                val inGroup =
                    items
                        .filter { it.group == group }
                        .sortedWith(compareBy<Achievement> { it.unlockedAt == null }.thenBy { it.unlockedAt.orEmpty() }.thenBy { it.no })
                if (inGroup.isEmpty()) continue
                Text(title, style = MaterialTheme.typography.titleSmall)
                inGroup.chunked(BADGE_COLUMNS).forEach { row ->
                    Row(horizontalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
                        row.forEach { item -> AchievementBadge(item, item.key in fresh, Modifier.weight(1f)) { detail = item } }
                        repeat(BADGE_COLUMNS - row.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
            }
        }
    }
    detail?.let { item ->
        AlertDialog(
            onDismissRequest = { detail = null },
            title = { Text(item.name) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(WbSpace.S2)) {
                    Text(item.condition)
                    item.progress?.let { Text("进度 ${it.current} / ${it.target}", color = colors.textSecondary) }
                    Text(
                        item.unlockedAt?.let { "获得于 ${it.take(10)}" } ?: "还未获得",
                        color = colors.textSecondary,
                    )
                }
            },
            confirmButton = { TextButton(onClick = { detail = null }) { Text("知道了") } },
        )
    }
}

@Composable private fun AchievementBadge(
    item: Achievement,
    isNew: Boolean,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    val unlocked = item.unlockedAt != null
    val tone = if (unlocked) achievementTone(item.group) else LocalWeibanModeColors.current.achievementLocked
    Column(modifier.clickable(onClick = onClick), horizontalAlignment = Alignment.CenterHorizontally) {
        BadgedBox(badge = { if (isNew && unlocked) Badge(containerColor = LocalWeibanModeColors.current.badgeUnread) }) {
            // 徽章插画未到位：分组色底座 + 编号占位（cards-familiarity.md 5.3）。
            Box(Modifier.size(56.dp).clip(CircleShape).background(tone), contentAlignment = Alignment.Center) {
                Text(if (unlocked) "★" else item.no.toString(), color = Color.White, style = MaterialTheme.typography.titleMedium)
            }
        }
        Text(
            item.name,
            maxLines = 1,
            color = if (unlocked) colors.textPrimary else colors.textTertiary,
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

// ---------- 熟悉度总览（我 › 服务 › 熟悉度） ----------

@Suppress("LongMethod") // One list page with progress rows.
@Composable
fun FamiliarityOverviewScreen(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    onBack: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    val mode = LocalWeibanModeColors.current
    val list =
        remote("${owner.sessionId}:familiarity-all") {
            repository.call(Endpoints.growthCardEndpointsListFamiliarity, options = SessionCallOptions(owner = owner)).items
        }
    LaunchedEffect(list) {
        AppUpdates.updates.collect { if (it is UserUpdateDataChanged && it.data.section == "familiarity") list.refresh() }
    }
    val snapshot by runtime.snapshot.collectAsState()
    val contacts = if (snapshot.owner == owner) snapshot.state.contacts else emptyList()
    val items = list.data.orEmpty()
    val profiles = characterProfiles(repository, items.map { it.characterId })
    Column(Modifier.fillMaxSize()) {
        PageHeader("熟悉度", onBack)
        when {
            list.loading && list.data == null -> LinearProgressIndicator(Modifier.fillMaxWidth())
            list.error != null && list.data == null -> RetryRow(list.error.orEmpty(), list::refresh)
            items.isEmpty() -> Text("添加角色后，这里会显示你们的熟悉度", Modifier.padding(WbSpace.S5), color = colors.textSecondary)
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            items.sortedWith(compareByDescending<FamiliarityInfo> { it.level }.thenByDescending { it.totalPoints }).forEach { info ->
                val profile = profiles[info.characterId]
                val contact = contacts.find { it.characterId == info.characterId }
                ListItem(
                    leadingContent = {
                        RoleAvatar(
                            repository,
                            owner,
                            RoleAvatarIdentity(info.characterId, profile?.name.orEmpty(), profile?.avatar, contact?.customAvatarMediaId),
                            WbSize.AvatarMd,
                        )
                    },
                    headlineContent = {
                        Text((contact?.remark ?: profile?.name ?: "角色") + " · L${info.level} ${familiarityName(info.level)}")
                    },
                    supportingContent = {
                        val span = info.pointsToNextLevel
                        Column {
                            LinearProgressIndicator(
                                progress = { if (span != null && span > 0) (info.pointsInLevel.toFloat() / span).coerceIn(0f, 1f) else 1f },
                                modifier = Modifier.fillMaxWidth(),
                                trackColor = mode.familiarityTrack,
                            )
                            Text(
                                if (span != null && span > 0) "距下一级还差 ${(span - info.pointsInLevel).coerceAtLeast(0)} 点" else "已经是最高等级",
                                color = colors.textSecondary,
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                    },
                )
            }
            Text(
                "多聊天、多互动，就会越来越熟",
                Modifier.fillMaxWidth().padding(WbSpace.S5),
                textAlign = TextAlign.Center,
                color = colors.textTertiary,
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

/** 卡册「我们的瞬间」：按获得日期排成时间线，点一条打开卡片详情。 */
@Composable private fun MomentsTimeline(
    repository: SessionRepository,
    owner: OwnerRecord,
    cards: List<GrowthCard>,
    onOpen: (String) -> Unit,
) {
    val colors = LocalWeibanColors.current
    if (cards.isEmpty()) {
        Text("还没有一起的瞬间，多聊聊吧", color = colors.textSecondary)
        return
    }
    cards.sortedByDescending { it.obtainedOn }.groupBy { it.obtainedOn.take(7) }.forEach { (month, items) ->
        Text(month.replace("-", " 年 ") + " 月", style = MaterialTheme.typography.titleSmall, color = colors.textSecondary)
        items.forEach { card ->
            Row(
                Modifier.fillMaxWidth().clickable { onOpen(card.cardId) }.padding(vertical = WbSpace.S2),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(WbSpace.S4),
            ) {
                Box(Modifier.size(10.dp).clip(CircleShape).background(cardTone(card.kind)))
                CardFace(repository, owner, card, Modifier.size(48.dp, 64.dp).clip(RoundedCornerShape(WbRadius.Sm)), 160)
                Column(Modifier.weight(1f)) {
                    Text(card.title, maxLines = 1)
                    Text(
                        "${card.obtainedOn} · ${cardKindName(card.kind)}",
                        color = colors.textSecondary,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
    }
}
