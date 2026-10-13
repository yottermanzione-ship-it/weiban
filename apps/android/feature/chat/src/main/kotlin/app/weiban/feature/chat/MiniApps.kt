package app.weiban.feature.chat

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.weiban.data.OwnerRecord
import app.weiban.data.SessionRepository
import app.weiban.designsystem.IconTile
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.Tint
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
) {
    Cards("cards", "卡册", "和 TA 的每一个特别时刻", "▤", Tint.Pink, true, "你和每个 TA 获得的卡片、纪念日与熟悉度"),
    Achievements("achievements", "成就", "一起走过的里程碑", "✪", Tint.Gold, false, "你的成就进度"),
    Pets("pets", "宠物", "和 TA 一起养一只小家伙", "❀", Tint.Orange, true, "你和 TA 一起养的宠物、互动记录与相册"),
    Daily("daily", "每日一问", "每天一个问题，说给 TA 听", "?", Tint.Gold, false, "你的回答，以及你选择发给哪个 TA"),
    Wishlist("wishlist", "心愿清单", "想和 TA 一起做的事", "☑", Tint.Teal, true, "你和每个 TA 的心愿"),
    Letters("letters", "慢信", "写一封慢慢寄到的信", "✉", Tint.Lilac, true, "你和 TA 之间的信件"),
    Focus("focus", "陪你专注", "让 TA 陪你专心一会儿", "⌛", Tint.Pink, true, "专注时长与陪你的 TA"),
    Reminders("reminders", "TA 的提醒", "让 TA 到点叫你", "⏰", Tint.Blue, true, "你设置的提醒内容与时间"),
    Period("period", "经期日记", "记录身体，也让 TA 懂你", "✿", Tint.Pink, false, "加密保存的经期记录，只有你授权的 TA 知道", true),
    Plaza("plaza", "人设广场", "看看大家创作的角色", "☷", Tint.Blue, false, "你发布、点赞和添加的作品"),
    Import("import", "导入角色", "用聊天记录生成一个 TA", "⇩", Tint.Teal, false, "你上传的聊天记录（生成完成后可删除）"),
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

/** 小程序宫格的一格：圆角方块图标 + 名字。 */
@Composable internal fun MiniAppCell(
    app: MiniApp,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Column(
        modifier.clickable(onClick = onClick).padding(vertical = WbSpace.S3),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(WbSpace.S2),
    ) {
        IconTile(app.glyph, app.tint, 52.dp)
        Text(app.title, style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center, maxLines = 1)
    }
}

/** 4 列宫格（不用 Lazy，放在可滚动页面里）。 */
@Composable internal fun MiniAppGrid(
    apps: List<MiniApp>,
    onOpen: (MiniApp) -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = WbSpace.S3)) {
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
                        app.weiban.designsystem.WbNavBar("人设广场", close)
                        PlazaTab(repository, owner)
                    }
                    MiniApp.Period -> periodPage()
                    else -> Unit
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
