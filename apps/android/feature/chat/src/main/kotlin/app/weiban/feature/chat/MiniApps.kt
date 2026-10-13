package app.weiban.feature.chat

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.weiban.core.designsystem.R as DsR
import app.weiban.data.OwnerRecord
import app.weiban.designsystem.MiniAppIcon
import app.weiban.designsystem.tintColor
import app.weiban.designsystem.wbText
import app.weiban.designsystem.ActionSheet
import app.weiban.designsystem.SheetAction
import app.weiban.designsystem.WbConfirm
import app.weiban.designsystem.WbIcon
import app.weiban.designsystem.pressMenu
import app.weiban.data.SessionRepository
import app.weiban.designsystem.IconTile
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.MenuGroup
import app.weiban.designsystem.MenuRow
import app.weiban.designsystem.Tint
import app.weiban.designsystem.WbNavBar
import app.weiban.designsystem.WbSheet
import app.weiban.designsystem.tokens.WbMotion
import app.weiban.designsystem.tokens.WbRadius
import app.weiban.designsystem.tokens.WbSpace
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

/**
 * 微伴小程序（docs/refactor/02 第 4 节）：11 个专属功能的登记表。名字、说明、颜色、按 TA 的入口与网页
 * features/miniapps.tsx 的 miniApps 表一致。
 */
@Suppress("LongParameterList") // 登记表：每个小程序一行，字段与网页 miniApps 表对应。
internal enum class MiniApp(
    val id: String,
    val title: String,
    val desc: String,
    val glyph: String,
    val tint: Tint,
    /** 按 TA：从聊天里打开时直接进入当前 TA 的那一页。 */
    val perTa: Boolean,
    /** 「关于这个小程序」里写明会用到的数据。 */
    val data: String,
    /** 默认不进最近使用（经期日记）。 */
    val privateByDefault: Boolean = false,
    /** 旧版风格图标（规格 5.1）：点缀色方块 + 白色线框图标。 */
    val icon: Int = DsR.drawable.wb_discover_mini_program,
    /** 图标本身是彩色图（慢信 mail.png），直接显示原图。 */
    val original: Boolean = false,
) {
    Cards("cards", "卡册", "和 TA 的每一个特别时刻", "▤", Tint.Pink, true, "你和每个 TA 获得的卡片、纪念日与熟悉度", icon = DsR.drawable.wb_drawn_cards),
    Achievements("achievements", "成就", "一起走过的里程碑", "✪", Tint.Gold, false, "你的成就进度", icon = DsR.drawable.wb_star),
    Pets("pets", "宠物", "和 TA 一起养一只小家伙", "❀", Tint.Orange, true, "你和 TA 一起养的宠物、互动记录与相册", icon = DsR.drawable.wb_drawn_paw),
    Daily("daily", "每日一问", "每天一个问题，说给 TA 听", "?", Tint.Gold, false, "你的回答，以及你选择发给哪个 TA", icon = DsR.drawable.wb_chat),
    Wishlist("wishlist", "心愿清单", "想和 TA 一起做的事", "☑", Tint.Teal, true, "你和每个 TA 的心愿", icon = DsR.drawable.wb_check),
    Letters(
        "letters",
        "慢信",
        "写一封慢慢寄到的信",
        "✉",
        Tint.Orange,
        true,
        "你和 TA 之间的信件",
        icon = DsR.drawable.wb_mail,
        original = true,
    ),
    Focus("focus", "陪你专注", "让 TA 陪你专心一会儿", "⌛", Tint.Lilac, true, "专注时长与陪你的 TA", icon = DsR.drawable.wb_drawn_hourglass),
    Reminders("reminders", "TA 的提醒", "让 TA 到点叫你", "⏰", Tint.Blue, true, "你设置的提醒内容与时间", icon = DsR.drawable.wb_bell),
    Period(
        "period",
        "经期日记",
        "记录身体，也让 TA 懂你",
        "✿",
        Tint.Pink,
        false,
        "加密保存的经期记录，只有你授权的 TA 知道",
        true,
        icon = DsR.drawable.wb_drawn_flower,
    ),
    Plaza("plaza", "人设广场", "看看大家创作的角色", "☷", Tint.Blue, false, "你发布、点赞和添加的作品", icon = DsR.drawable.wb_drawn_people),
    Import("import", "导入角色", "用聊天记录生成一个 TA", "⇩", Tint.Cyan, false, "你上传的聊天记录（生成完成后可删除）", icon = DsR.drawable.wb_drawn_import),
    ;

    companion object {
        fun of(id: String): MiniApp? = entries.find { it.id == id }

        val perTaApps: List<MiniApp> get() = entries.filter { it.perTa }
    }
}

/** 小程序宿主页（卡册、成就、人设广场、经期日记）：没有自己浮层的小程序在这里显示。 */
internal data class MiniHostOpen(
    val app: MiniApp,
    val characterId: String? = null,
    val nonce: Long = System.nanoTime(),
)

internal object MiniHostNav {
    val open = MutableStateFlow<MiniHostOpen?>(null)
}

/** 宿主（发现、通知、服务页）打开小程序。characterId 只对「按 TA」的小程序有效。 */
@Suppress("CyclomaticComplexMethod") // 一个小程序一个分支，按登记表直译。
object MiniAppNavigation {
    /** 关闭宿主页里的小程序（经期日记等由宿主提供页面的小程序）。 */
    fun close() {
        MiniHostNav.open.value = null
    }

    fun open(
        id: String,
        characterId: String? = null,
    ): Boolean {
        val app = MiniApp.of(id) ?: return false
        MiniAppPrefs.touch(app)
        val ta = characterId.takeIf { app.perTa }
        when (app) {
            MiniApp.Pets -> L6Overlays.pets.value = PetsOpen(ta)
            MiniApp.Daily -> PlayNav.stack.value = listOf(PlayPage.Daily())
            MiniApp.Wishlist -> PlayNav.stack.value = listOf(ta?.let { PlayPage.Wishlist(it) } ?: PlayPage.Wishlists)
            MiniApp.Letters -> PlayNav.stack.value = listOf(ta?.let { PlayPage.LetterWrite(it) } ?: PlayPage.Letters)
            MiniApp.Focus -> PlayNav.stack.value = listOf(PlayPage.Focus(ta))
            MiniApp.Reminders -> PlayNav.stack.value = listOf(ta?.let { PlayPage.ReminderEdit(null, it) } ?: PlayPage.Reminders)
            MiniApp.Import -> L6Overlays.openImport()
            MiniApp.Cards, MiniApp.Achievements, MiniApp.Plaza, MiniApp.Period -> MiniHostNav.open.value = MiniHostOpen(app, ta)
        }
        return true
    }
}

/** 小程序图标（规格 5.1）：48 圆角 12（下拉面板、主页），40 圆角 10（聊天信息页一行）。 */
@Composable internal fun MiniAppGlyph(
    app: MiniApp,
    size: androidx.compose.ui.unit.Dp = 48.dp,
) {
    MiniAppIcon(app.icon, tintColor(app.tint), size, app.original)
}

/** 小程序宫格的一格：图标 48 → 8 → 名字 12。 */
@Composable internal fun MiniAppCell(
    app: MiniApp,
    modifier: Modifier = Modifier,
    nameColor: androidx.compose.ui.graphics.Color = LocalWeibanColors.current.textPrimary,
    onLongPress: ((androidx.compose.ui.geometry.Offset) -> Unit)? = null,
    onClick: () -> Unit,
) {
    Column(
        modifier
            .then(
                if (onLongPress != null) {
                    Modifier.pressMenu(onClick, onLongPress, pressedColor = false)
                } else {
                    Modifier.clickable(indication = null, interactionSource = null, onClick = onClick)
                },
            ).padding(vertical = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        MiniAppGlyph(app)
        Spacer(Modifier.height(8.dp))
        Text(
            app.title,
            style = wbText(12.sp, color = nameColor),
            textAlign = TextAlign.Center,
            maxLines = 1,
            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
        )
    }
}

/** 4 列宫格（不用 Lazy，放在可滚动页面里）。 */
@Composable internal fun MiniAppGrid(
    apps: List<MiniApp>,
    onOpen: (MiniApp) -> Unit,
) {
    Column(Modifier.fillMaxWidth().background(LocalWeibanColors.current.bgSurface).padding(horizontal = WbSpace.S3, vertical = 6.dp)) {
        apps.chunked(4).forEach { row ->
            Row(Modifier.fillMaxWidth()) {
                row.forEach { app -> MiniAppCell(app, Modifier.weight(1f)) { onOpen(app) } }
                repeat(4 - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

/** 小程序宿主浮层：卡册 / 成就 / 人设广场 / 经期日记（经期日记的页面由宿主应用提供）。 */
@Composable internal fun MiniHostOverlay(
    repository: SessionRepository,
    runtime: app.weiban.data.ChatRuntime,
    owner: OwnerRecord,
    periodPage: @Composable () -> Unit,
) {
    val open by MiniHostNav.open.collectAsState()
    val current = open ?: return
    val close: () -> Unit = { MiniHostNav.open.value = null }
    BackHandler(onBack = close)
    MiniAppFrame(current.app, close, { MiniHostNav.open.value = current.copy(nonce = System.nanoTime()) }) {
        Surface(Modifier.fillMaxSize(), color = LocalWeibanColors.current.bgPage) {
            Column(
                Modifier
                    .fillMaxSize()
                    .background(LocalWeibanColors.current.bgPage)
                    .statusBarsPadding()
                    .navigationBarsPadding(),
            ) {
                key(current) {
                    when (current.app) {
                        MiniApp.Cards ->
                            current.characterId?.let { CardAlbumPage(repository, runtime, owner, it, close) }
                                ?: CardAlbumsScreen(repository, runtime, owner, close)
                        MiniApp.Achievements -> AchievementsScreen(repository, owner, close)
                        MiniApp.Plaza -> {
                            WbNavBar("人设广场", close)
                            PlazaTab(repository, owner)
                        }
                        MiniApp.Period -> periodPage()
                        else -> Unit
                    }
                }
            }
        }
    }
}

internal const val MINI_RECENT_MAX = 8

/**
 * 本机小程序偏好：最近使用（最多 8 个）、我的小程序、经期日记是否进最近使用、不在最近使用中显示。
 * 只存本机（按账号），不跨设备（方案第 11 节第 6 条待架构评估）。
 */
internal object MiniAppPrefs {
    private const val RECENT = "miniapps:recent"
    private const val MINE = "miniapps:mine"
    private const val SHOW_PRIVATE = "miniapps:show-in-recent"
    private const val HIDE_RECENT = "miniapps:hide-in-recent"
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var repository: SessionRepository? = null
    private var owner: OwnerRecord? = null

    var recentIds by mutableStateOf<List<String>>(emptyList())
    var mineIds by mutableStateOf<List<String>?>(null)
    var showPrivate by mutableStateOf<Set<String>>(emptySet())
    var hidden by mutableStateOf<Set<String>>(emptySet())

    val recent: List<MiniApp>
        get() =
            recentIds.mapNotNull(MiniApp::of).filter { it.id !in hidden && (!it.privateByDefault || it.id in showPrivate) }
    val mine: List<MiniApp> get() = mineIds?.mapNotNull(MiniApp::of) ?: MiniApp.entries

    fun inRecent(app: MiniApp): Boolean = app.id !in hidden && (!app.privateByDefault || app.id in showPrivate)

    suspend fun load(
        repository: SessionRepository,
        owner: OwnerRecord,
    ) {
        if (this.owner == owner) return
        this.repository = repository
        this.owner = owner
        recentIds = emptyList()
        mineIds = null
        showPrivate = emptySet()
        hidden = emptySet()
        userAction({}) {
            recentIds = read(RECENT).orEmpty()
            mineIds = read(MINE)
            showPrivate = read(SHOW_PRIVATE).orEmpty().toSet()
            hidden = read(HIDE_RECENT).orEmpty().toSet()
        }
    }

    fun touch(app: MiniApp) {
        recentIds = (listOf(app.id) + recentIds.filter { it != app.id }).take(MINI_RECENT_MAX * 2)
        save(RECENT, recentIds)
    }

    fun toggleMine(app: MiniApp) {
        val current = mine.map { it.id }
        mineIds = if (app.id in current) current - app.id else current + app.id
        save(MINE, mineIds.orEmpty())
    }

    fun moveToFront(app: MiniApp) {
        mineIds = listOf(app.id) + mine.map { it.id }.filter { it != app.id }
        save(MINE, mineIds.orEmpty())
    }

    fun toggleRecent(app: MiniApp) {
        if (app.privateByDefault) {
            showPrivate = if (app.id in showPrivate) showPrivate - app.id else showPrivate + app.id
            save(SHOW_PRIVATE, showPrivate.toList())
        } else {
            hidden = if (app.id in hidden) hidden - app.id else hidden + app.id
            save(HIDE_RECENT, hidden.toList())
        }
    }

    private suspend fun read(key: String): List<String>? {
        val repo = repository
        val who = owner
        val raw = if (repo != null && who != null) repo.flags.get(who, key) else null
        return raw?.split(',')?.filter(String::isNotBlank)
    }

    private fun save(
        key: String,
        values: List<String>,
    ) {
        val repo = repository ?: return
        val who = owner ?: return
        scope.launch { userAction({}) { repo.flags.set(who, key, values.joinToString(",")) } }
    }
}

@Composable internal fun rememberMiniAppPrefs(
    repository: SessionRepository,
    owner: OwnerRecord,
): MiniAppPrefs {
    LaunchedEffect(owner) { MiniAppPrefs.load(repository, owner) }
    return MiniAppPrefs
}

/** 小程序外壳里，标题栏右侧给胶囊让出的宽度（各小程序页头末尾留空）。 */
internal val LocalCapsuleInset = compositionLocalOf { 0.dp }

/** 页头末尾给胶囊留空（不在小程序里时宽度为 0）。 */
@Composable internal fun RowScope.CapsuleSpace() {
    Spacer(Modifier.width(LocalCapsuleInset.current))
}

/**
 * 小程序外壳（方案 4.2）：右上胶囊「··· | ◯」，从底部升起（只动 transform），盖住底部标签栏。
 * ◯ 一步回到打开小程序之前的页面；··· 菜单：添加到 / 移出我的小程序、不在 / 在最近使用中显示、关于这个小程序、重新进入。
 */
@Composable internal fun MiniAppFrame(
    app: MiniApp,
    onClose: () -> Unit,
    onReenter: () -> Unit,
    content: @Composable () -> Unit,
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val reduceMotion =
        remember {
            android.provider.Settings.Global.getFloat(
                context.contentResolver,
                android.provider.Settings.Global.ANIMATOR_DURATION_SCALE,
                1f,
            ) == 0f
        }
    val rise = remember { Animatable(if (reduceMotion) 0f else 1f) }
    LaunchedEffect(app) { rise.animateTo(0f, tween(WbMotion.PageMs, easing = WbMotion.Decelerate)) }
    var more by remember { mutableStateOf(false) }
    var about by remember { mutableStateOf(false) }
    Box(Modifier.fillMaxSize().graphicsLayer { translationY = rise.value * size.height }) {
        CompositionLocalProvider(LocalCapsuleInset provides CAPSULE_INSET) { content() }
        Capsule(Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(top = WbSpace.S2, end = WbSpace.S3), { more = true }, onClose)
    }
    if (more) {
        val prefs = MiniAppPrefs
        ActionSheet(
            listOf(
                SheetAction(if (app in prefs.mine) "从我的小程序移除" else "添加到我的小程序") { prefs.toggleMine(app) },
                SheetAction(if (prefs.inRecent(app)) "不在最近使用中显示" else "在最近使用中显示") {
                    prefs.toggleRecent(app)
                },
                SheetAction("关于这个小程序") { about = true },
                SheetAction("重新进入", onClick = onReenter),
            ),
            app.title,
        ) { more = false }
    }
    if (about) {
        WbConfirm(
            "${app.desc}\n\n会用到的数据：${app.data}",
            "知道了",
            title = app.title,
            cancel = null,
            onDismiss = { about = false },
        ) { about = false }
    }
}

private val CAPSULE_INSET = 104.dp

@Composable private fun Capsule(
    modifier: Modifier,
    onMore: () -> Unit,
    onClose: () -> Unit,
) {
    // 胶囊（规格 5.1）：88×32，全圆角，白底 + 0.5 线框；左 more.svg、右 capsule_close.svg（20），中间 0.5×18 竖线。
    val colors = LocalWeibanColors.current
    val shape = RoundedCornerShape(WbRadius.Full)
    Row(
        modifier
            .size(88.dp, 32.dp)
            .clip(shape)
            .background(colors.bgSurface)
            .border(0.5.dp, colors.borderStrong, shape),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.weight(1f).fillMaxHeight().clickable(onClick = onMore), contentAlignment = Alignment.Center) {
            WbIcon(DsR.drawable.wb_more, 20.dp, colors.textPrimary, contentDescription = "更多")
        }
        Box(Modifier.width(0.5.dp).height(18.dp).background(colors.borderHairline))
        Box(Modifier.weight(1f).fillMaxHeight().clickable(onClick = onClose), contentAlignment = Alignment.Center) {
            WbIcon(DsR.drawable.wb_drawn_capsule_close, 20.dp, colors.textPrimary, contentDescription = "关闭")
        }
    }
}
