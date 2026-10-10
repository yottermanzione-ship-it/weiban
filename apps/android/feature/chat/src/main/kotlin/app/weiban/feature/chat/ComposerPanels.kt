package app.weiban.feature.chat

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import app.weiban.contracts.*
import app.weiban.data.AppUpdates
import app.weiban.data.OwnerRecord
import app.weiban.data.SessionCallOptions
import app.weiban.data.SessionRepository
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.tokens.WbSize
import app.weiban.designsystem.tokens.WbSpace
import java.io.File
import java.io.IOException

private val PANEL_HEIGHT = 240.dp
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

/** 表情面板（C 5.2）：分「我的表情」和内置包，点一下直接发出。 */
@Composable internal fun StickerPanel(ui: ConversationUi) {
    val colors = LocalWeibanColors.current
    val library = rememberStickerLibrary(ui.repository, ui.owner)
    val packs = library.packs.data?.items.orEmpty().filter { it.enabled && it.userVisible && it.stickers.isNotEmpty() }
    var tab by rememberSaveable { mutableIntStateOf(0) }
    Column(Modifier.fillMaxWidth().height(PANEL_HEIGHT)) {
        Box(Modifier.weight(1f)) {
            if (tab == 0) {
                val mine = library.mine.data?.items.orEmpty().sortedBy { it.order }
                when {
                    library.mine.loading && library.mine.data == null -> LinearProgressIndicator(Modifier.fillMaxWidth())
                    mine.isEmpty() ->
                        Text(
                            "长按聊天里的图片或表情，选「添加到表情」",
                            Modifier.padding(WbSpace.S5),
                            color = colors.textSecondary,
                        )
                    else ->
                        LazyVerticalGrid(GridCells.Fixed(4), contentPadding = PaddingValues(WbSpace.S3)) {
                            items(mine, key = { it.stickerId }) { sticker ->
                                Box(Modifier.padding(WbSpace.S2), contentAlignment = Alignment.Center) {
                                    StickerMessage(
                                        ui.repository,
                                        ui.owner,
                                        sticker.mediaId,
                                        Modifier.clickable { ui.media.sendSticker(sticker.stickerId, "user", sticker.mediaId, null) },
                                        PANEL_STICKER,
                                    )
                                }
                            }
                        }
                }
            } else {
                val pack = packs.getOrNull(tab - 1)
                if (pack != null) {
                    LazyVerticalGrid(GridCells.Fixed(4), contentPadding = PaddingValues(WbSpace.S3)) {
                        items(pack.stickers, key = { it.stickerId }) { sticker ->
                            Box(Modifier.padding(WbSpace.S2), contentAlignment = Alignment.Center) {
                                StickerMessage(
                                    ui.repository,
                                    ui.owner,
                                    sticker.mediaId,
                                    Modifier.clickable {
                                        ui.media.sendSticker(sticker.stickerId, "library", sticker.mediaId, sticker.description)
                                    },
                                    PANEL_STICKER,
                                )
                            }
                        }
                    }
                }
            }
        }
        HorizontalDivider(color = colors.borderHairline)
        Row(Modifier.fillMaxWidth().padding(horizontal = WbSpace.S3), horizontalArrangement = Arrangement.spacedBy(WbSpace.S2)) {
            FilterChip(selected = tab == 0, onClick = { tab = 0 }, label = { Text("我的表情") })
            packs.forEachIndexed { index, pack ->
                FilterChip(selected = tab == index + 1, onClick = { tab = index + 1 }, label = { Text(pack.name, maxLines = 1) })
            }
        }
    }
}

/** 「+」面板（C 5.3）：相册（系统照片选择器，最多 9 张）、拍摄。语音通话入口在 T-075。 */
@Composable internal fun PlusPanel(ui: ConversationUi) {
    val context = LocalContext.current
    var photo by remember { mutableStateOf<File?>(null) }
    val characterId = ui.conversation.participants.find { it.kind == "character" }?.refId.takeIf { !ui.conversation.isGroup() }
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
    Row(
        Modifier.fillMaxWidth().height(PANEL_HEIGHT / 2).padding(WbSpace.S5),
        horizontalArrangement = Arrangement.spacedBy(WbSpace.S8),
    ) {
        PanelButton("相册") { gallery.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }
        PanelButton("拍摄") {
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
        // 语音通话（MED-06 第 1、11 条）：只在私聊、平台开通语音服务时显示。
        if (callable && characterId != null) PanelButton("语音通话") { dial(characterId, names[characterId].orEmpty().ifEmpty { "角色" }) }
    }
}

@Composable private fun PanelButton(
    label: String,
    onClick: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    val glyph =
        when (label) {
            "相册" -> "▦"
            "拍摄" -> "◉"
            else -> "✆"
        }
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Surface(
            color = colors.bgSurface,
            shape = MaterialTheme.shapes.medium,
            modifier = Modifier.size(WbSize.GridCell - WbSpace.S5).clickable(onClick = onClick),
        ) {
            Box(contentAlignment = Alignment.Center) { Text(glyph, style = MaterialTheme.typography.headlineSmall) }
        }
        Text(label, style = MaterialTheme.typography.bodySmall, color = colors.textSecondary)
    }
}

/** 拍照写入的临时文件（与头像拍照共用 FileProvider 授权目录 avatar-camera/）。 */
private fun chatCameraCapture(context: Context): Pair<File, Uri> {
    val directory = File(context.cacheDir, "avatar-camera")
    if (!directory.isDirectory && !directory.mkdirs()) throw IOException("Unable to create camera cache")
    val file = File.createTempFile("chat-", ".jpg", directory)
    return file to androidx.core.content.FileProvider.getUriForFile(context, "${context.packageName}.avatar.camera", file)
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
