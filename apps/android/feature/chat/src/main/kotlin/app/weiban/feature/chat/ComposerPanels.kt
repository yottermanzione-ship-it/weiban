package app.weiban.feature.chat

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.unit.sp
import app.weiban.contracts.*
import app.weiban.core.designsystem.R as DsR
import app.weiban.data.AppUpdates
import app.weiban.data.OwnerRecord
import app.weiban.data.SessionCallOptions
import app.weiban.data.SessionRepository
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.tokens.WbSize
import app.weiban.designsystem.tokens.WbSpace
import java.io.File
import java.io.IOException

/** 「+」面板与表情面板同高（互换时不跳，规格 4.4.10 / 4.4.11）。 */
private val PANEL_HEIGHT = 300.dp
private val PANEL_STICKER = 64.dp

/** 我的表情 + 用户可见的内置表情包；data.changed(stickers) 时重新拉取。 */
internal class StickerLibrary(
    val mine: NativeRemote<StickerEndpointsListMyStickersResponse>,
    val packs: NativeRemote<StickerEndpointsListPacksResponse>,
)

@Composable internal fun rememberStickerLibrary(
    repository: SessionRepository,
    owner: OwnerRecord,
): StickerLibrary {
    val mine =
        remote("${owner.sessionId}:my-stickers") {
            repository.call(Endpoints.stickerEndpointsListMyStickers, options = SessionCallOptions(owner = owner, networkOnly = true))
        }
    val packs =
        remote("${owner.sessionId}:sticker-packs") {
            repository.call(Endpoints.stickerEndpointsListPacks, options = SessionCallOptions(owner = owner))
        }
    LaunchedEffect(owner) {
        AppUpdates.updates.collect { update ->
            if (update is UserUpdateDataChanged && update.data.section == "stickers") mine.refresh()
        }
    }
    return StickerLibrary(mine, packs)
}

/**
 * 表情面板（规格 4.4.11）：高 300，底 bg.page；顶部切换条高 50（每格 36，选中白底圆角 6；「我的表情」smile、
 * 内置包 heart / star 图标，其余用封面）；4 列宫格，格间距 10，内距 14 / 8 / 14 / 12，点一下直接发出。
 */
@Composable internal fun StickerPanel(ui: ConversationUi) {
    val colors = LocalWeibanColors.current
    val library = rememberStickerLibrary(ui.repository, ui.owner)
    val packs =
        library.packs.data
            ?.items
            .orEmpty()
            .filter { it.enabled && it.userVisible && it.stickers.isNotEmpty() }
    var tab by rememberSaveable { mutableIntStateOf(0) }
    Column(Modifier.fillMaxWidth().height(PANEL_HEIGHT).background(colors.bgPage)) {
        Row(
            Modifier.fillMaxWidth().height(50.dp).horizontalScroll(rememberScrollState()).padding(horizontal = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            StickerTab(tab == 0, { tab = 0 }) { app.weiban.designsystem.WbIcon(DsR.drawable.wb_smile, 22.dp, colors.textSecondary) }
            packs.forEachIndexed { index, pack ->
                StickerTab(tab == index + 1, { tab = index + 1 }) {
                    when (index) {
                        0 -> app.weiban.designsystem.WbIcon(DsR.drawable.wb_heart, 20.dp, colors.textSecondary)
                        1 -> app.weiban.designsystem.WbIcon(DsR.drawable.wb_star, 20.dp, colors.textSecondary)
                        else -> StickerMessage(ui.repository, ui.owner, pack.stickers.first().mediaId, edge = 28.dp)
                    }
                }
            }
            StickerTab(false, { ui.media.toast("在「我 › 表情」里管理添加的表情") }) {
                app.weiban.designsystem.WbIcon(DsR.drawable.wb_more, 20.dp, colors.textSecondary)
            }
        }
        Box(Modifier.fillMaxWidth().height(0.5.dp).background(colors.borderHairline))
        Box(Modifier.weight(1f)) {
            if (tab == 0) {
                val mine =
                    library.mine.data
                        ?.items
                        .orEmpty()
                        .sortedBy { it.order }
                when {
                    library.mine.loading && library.mine.data == null ->
                        CircularProgressIndicator(Modifier.align(Alignment.Center).size(20.dp), strokeWidth = 2.dp)
                    mine.isEmpty() ->
                        Text(
                            "长按聊天里的图片或表情，选「收藏到表情」",
                            Modifier.align(Alignment.Center).padding(24.dp),
                            style = app.weiban.designsystem.wbText(13.sp, color = androidx.compose.ui.graphics.Color(0xFF888888)),
                        )
                    else ->
                        StickerGrid(ui.repository, ui.owner, mine.map { it.stickerId to it.mediaId }) { id, media -> ui.media.sendSticker(id, "user", media, null) }
                }
            } else {
                val pack = packs.getOrNull(tab - 1)
                if (pack != null) {
                    StickerGrid(ui.repository, ui.owner, pack.stickers.map { it.stickerId to it.mediaId }) { id, media ->
                        ui.media.sendSticker(id, "library", media, pack.stickers.find { it.stickerId == id }?.description)
                    }
                }
            }
        }
    }
}

@Composable private fun StickerTab(
    selected: Boolean,
    onClick: () -> Unit,
    content: @Composable () -> Unit,
) {
    val colors = LocalWeibanColors.current
    Box(
        Modifier
            .padding(start = 7.dp, top = 4.dp, end = 6.dp, bottom = 4.dp)
            .size(36.dp)
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(6.dp))
            .background(if (selected) colors.bgSurface else androidx.compose.ui.graphics.Color.Transparent)
            .clickableNoRipple(onClick),
        contentAlignment = Alignment.Center,
    ) { content() }
}

@Composable private fun StickerGrid(
    repository: SessionRepository,
    owner: OwnerRecord,
    stickers: List<Pair<String, String>>,
    onSend: (String, String) -> Unit,
) {
    LazyVerticalGrid(
        GridCells.Fixed(4),
        contentPadding = PaddingValues(start = 14.dp, top = 8.dp, end = 14.dp, bottom = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        items(stickers, key = { it.first }) { (id, media) ->
            Box(
                Modifier.aspectRatio(1f).clip(androidx.compose.foundation.shape.RoundedCornerShape(10.dp)).clickableNoRipple { onSend(id, media) },
                contentAlignment = Alignment.Center,
            ) {
                StickerMessage(repository, owner, media, edge = PANEL_STICKER)
            }
        }
    }
}

/** 「+」面板的一格。 */
private class PanelItem(
    val label: String,
    val icon: Int,
    val dot: Boolean = false,
    val onClick: () -> Unit,
)

/**
 * 「+」面板（02a 1.1）：每页 4×2，左右翻页 + 分页圆点。
 * 私聊：相册 · 拍摄 · 语音通话 · 情景预设 / 写信 · 陪我专注 · 提醒 · 小程序 ｜ 心愿 · 名片*；群聊：相册 · 拍摄 · 情景预设 · 名片*。
 */
@Composable internal fun PlusPanel(ui: ConversationUi) {
    val context = LocalContext.current
    var photo by remember { mutableStateOf<File?>(null) }
    var taApps by remember { mutableStateOf(false) }
    val characterId =
        ui.conversation.participants
            .find { it.kind == "character" }
            ?.refId
            .takeIf { !ui.conversation.isGroup() }
    val callable = rememberCallEntry(characterId)
    val dial = rememberDial()
    val names = characterNames(ui.repository, listOfNotNull(characterId))
    val gallery =
        rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(ChatMediaUi.IMAGE_PICK_LIMIT)) { picked ->
            if (picked.isNotEmpty()) {
                ui.media.panel = 0
                ui.media.sendImages(picked)
            }
        }
    val camera =
        rememberLauncherForActivityResult(ChatCameraContract()) { captured ->
            val file = photo
            photo = null
            if (captured && file != null) {
                ui.media.panel = 0
                ui.media.sendImages(listOf(Uri.fromFile(file)))
            }
        }
    val shoot: () -> Unit = {
        val capture =
            try {
                chatCameraCapture(context)
            } catch (_: IOException) {
                null
            } catch (_: IllegalArgumentException) {
                null
            }
        if (capture == null) {
            ui.media.toast("照片暂时无法保存，请从相册选择")
        } else {
            photo = capture.first
            try {
                camera.launch(capture.second)
            } catch (_: ActivityNotFoundException) {
                photo = null
                ui.media.toast("没有可用的相机，请从相册选择")
            }
        }
    }
    val close: (() -> Unit) -> () -> Unit = { action ->
        {
            ui.media.panel = 0
            action()
        }
    }
    val presetDot = ui.presetMode != null && ui.presetMode != "daily" && ui.presetMode != "auto"
    val items =
        buildList {
            add(PanelItem("照片", DsR.drawable.wb_album) { gallery.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) })
            add(PanelItem("拍摄", DsR.drawable.wb_camera, onClick = shoot))
            // 语音通话（MED-06 第 1、11 条）：只在私聊、平台开通语音服务时显示。
            if (callable && characterId != null) {
                add(PanelItem("语音通话", DsR.drawable.wb_voice_call) { dial(characterId, names[characterId].orEmpty().ifEmpty { "角色" }) })
            }
            add(PanelItem("情景预设", DsR.drawable.wb_drawn_scenario_sparkle, presetDot) { ui.scenarioOpen = true })
            // 写信、陪我专注、提醒、小程序、心愿（PLAY-03～06）：只在私聊里出现。
            if (characterId != null) {
                add(PanelItem("写信", DsR.drawable.wb_drawn_letter, onClick = close { MiniAppNavigation.open(MiniApp.Letters.id, characterId) }))
                add(PanelItem("陪我专注", DsR.drawable.wb_drawn_hourglass, onClick = close { MiniAppNavigation.open(MiniApp.Focus.id, characterId) }))
                add(PanelItem("提醒", DsR.drawable.wb_bell, onClick = close { MiniAppNavigation.open(MiniApp.Reminders.id, characterId) }))
                add(PanelItem("小程序", DsR.drawable.wb_discover_mini_program) { taApps = true })
                add(PanelItem("心愿", DsR.drawable.wb_star, onClick = close { MiniAppNavigation.open(MiniApp.Wishlist.id, characterId) }))
            }
            add(PanelItem("名片", DsR.drawable.wb_person) { app.weiban.designsystem.ComingSoon.notice("card") })
        }
    val pages = items.chunked(PANEL_PAGE_SIZE)
    val pager = rememberPagerState { pages.size }
    Column(Modifier.fillMaxWidth().height(PANEL_HEIGHT).background(LocalWeibanColors.current.bgTabBar)) {
        HorizontalPager(pager, Modifier.weight(1f)) { index ->
            Column(
                Modifier.fillMaxSize().padding(start = 24.dp, top = 20.dp, end = 24.dp, bottom = 12.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                pages[index].chunked(PANEL_COLUMNS).forEach { row ->
                    Row(Modifier.fillMaxWidth()) {
                        row.forEach { item -> PanelButton(item, Modifier.weight(1f)) }
                        repeat(PANEL_COLUMNS - row.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
            }
        }
        if (pages.size > 1) {
            val colors = LocalWeibanColors.current
            Row(Modifier.fillMaxWidth().padding(bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally)) {
                repeat(pages.size) { index ->
                    Box(
                        Modifier
                            .size(6.3.dp)
                            .clip(CircleShape)
                            .background(if (pager.currentPage == index) colors.textSecondary else colors.borderHairline),
                    )
                }
            }
        }
    }
    if (taApps && characterId != null) {
        TogetherSheet(characterId, { taApps = false }) { ui.media.panel = 0 }
    }
}

private const val PANEL_PAGE_SIZE = 8
private const val PANEL_COLUMNS = 4

/** 「和 TA 一起用」半屏（「+」› 小程序）：只列按 TA 的小程序，当前 TA 已选好。 */
@Composable internal fun TogetherSheet(
    characterId: String,
    onDismiss: () -> Unit,
    onOpened: () -> Unit = {},
) {
    app.weiban.designsystem.WbSheet("和 TA 一起用", onDismiss) {
        MiniAppGrid(MiniApp.perTaApps) { app ->
            onDismiss()
            onOpened()
            MiniAppNavigation.open(app.id, characterId)
        }
    }
}

/** 「+」面板一格（4.4.10）：白方块 58 圆角 14，图标 28 着色 text.primary → 6.6 → 标签 13 次要色；情景预设非日常时右上 8 红点。 */
@Composable private fun PanelButton(
    item: PanelItem,
    modifier: Modifier,
) {
    val colors = LocalWeibanColors.current
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Box {
            Box(
                Modifier
                    .size(58.dp)
                    .clip(androidx.compose.foundation.shape.RoundedCornerShape(14.dp))
                    .background(colors.bgSurface)
                    .clickableNoRipple(item.onClick),
                contentAlignment = Alignment.Center,
            ) {
                app.weiban.designsystem.WbIcon(item.icon, 28.dp, colors.textPrimary, contentDescription = item.label)
            }
            if (item.dot) app.weiban.designsystem.DotBadge(8.dp, null, Modifier.align(Alignment.TopEnd).offset(2.dp, (-2).dp))
        }
        Spacer(Modifier.height(6.6.dp))
        Text(item.label, style = app.weiban.designsystem.wbText(13.sp, color = colors.textSecondary), maxLines = 1)
    }
}

/** 拍照写入的临时文件（与头像拍照共用 FileProvider 授权目录 avatar-camera/）。 */
private fun chatCameraCapture(context: Context): Pair<File, Uri> {
    val directory = File(context.cacheDir, "avatar-camera")
    if (!directory.isDirectory && !directory.mkdirs()) throw IOException("Unable to create camera cache")
    val file = File.createTempFile("chat-", ".jpg", directory)
    return file to
        androidx.core.content.FileProvider
            .getUriForFile(context, "${context.packageName}.avatar.camera", file)
}

private class ChatCameraContract : ActivityResultContracts.TakePicture() {
    override fun createIntent(
        context: Context,
        input: Uri,
    ): Intent =
        super.createIntent(context, input).apply {
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            clipData = ClipData.newRawUri("聊天照片", input)
        }
}
