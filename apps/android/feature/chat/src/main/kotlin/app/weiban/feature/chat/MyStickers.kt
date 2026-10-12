package app.weiban.feature.chat

import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import app.weiban.contracts.*
import app.weiban.data.OwnerRecord
import app.weiban.data.SessionCallOptions
import app.weiban.data.SessionRepository
import app.weiban.data.uploadChatMedia
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.tokens.WbSpace
import app.weiban.network.ApiFailure
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

private const val STICKER_LIMIT = 300

/**
 * 「我 › 表情」（me-and-services.md 1.5、media-l5.md 5.2）：4 列网格，从相册添加，整理时可移到最前或删除，
 * 底部显示总数，点开全屏预览。数据随 data.changed(stickers) 刷新。
 */
@Composable fun MyStickersScreen(
    repository: SessionRepository,
    owner: OwnerRecord,
    onBack: () -> Unit,
) {
    BackHandler(onBack = onBack)
    val context = LocalContext.current
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    val library = rememberStickerLibrary(repository, owner)
    val stickers =
        library.mine.data
            ?.items
            .orEmpty()
            .sortedBy { it.order }
    var organizing by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var preview by remember { mutableStateOf<UserSticker?>(null) }

    fun toast(text: String) = Toast.makeText(context, text, Toast.LENGTH_SHORT).show()

    fun act(work: suspend () -> Unit) {
        if (busy) return
        busy = true
        scope.launch {
            try {
                work()
            } catch (error: CancellationException) {
                throw error
            } catch (error: ApiFailure) {
                toast(
                    when (error.code) {
                        "conflict" -> "已经添加过了"
                        "limit_reached" -> "表情已满，先删除一些"
                        "bad_request" -> "这张图片无法添加"
                        else -> "操作失败，请稍后再试"
                    },
                )
            } catch (_: java.io.IOException) {
                toast("操作失败，请稍后再试")
            } finally {
                busy = false
                library.mine.refresh()
            }
        }
    }
    val picker =
        rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            if (uri != null) {
                act {
                    val image = prepareChatImage(context, uri)
                    val media = uploadChatMedia(repository, owner, image.bytes, image.mimeType, "user_sticker")
                    repository.call(
                        Endpoints.stickerEndpointsAddMySticker,
                        body =
                            buildJsonObject {
                                put("from", "upload")
                                put("mediaId", media.mediaId)
                            },
                        options = SessionCallOptions(owner = owner),
                    )
                    toast("已添加")
                }
            }
        }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("‹ 返回") }
            Text("我的表情", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
            if (stickers.isNotEmpty()) TextButton(onClick = { organizing = !organizing }) { Text(if (organizing) "完成" else "整理") }
        }
        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        when {
            library.mine.loading && library.mine.data == null -> LinearProgressIndicator(Modifier.fillMaxWidth())
            library.mine.error != null && library.mine.data == null ->
                Column(Modifier.fillMaxWidth().padding(WbSpace.S8), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("加载失败")
                    Button(onClick = library.mine::refresh) { Text("重试") }
                }
            else ->
                LazyVerticalGrid(GridCells.Fixed(4), Modifier.weight(1f), contentPadding = PaddingValues(WbSpace.S3)) {
                    if (!organizing) {
                        item(key = "add") {
                            Box(
                                Modifier
                                    .padding(WbSpace.S2)
                                    .aspectRatio(1f)
                                    .background(colors.bgSurface)
                                    .clickable(enabled = !busy && stickers.size < STICKER_LIMIT) {
                                        picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                                    },
                                contentAlignment = Alignment.Center,
                            ) { Text("＋", style = MaterialTheme.typography.headlineMedium, color = colors.textSecondary) }
                        }
                    }
                    items(stickers, key = { it.stickerId }) { sticker ->
                        Column(Modifier.padding(WbSpace.S2), horizontalAlignment = Alignment.CenterHorizontally) {
                            StickerMessage(
                                repository,
                                owner,
                                sticker.mediaId,
                                Modifier.clickable { if (!organizing) preview = sticker },
                                72.dp,
                            )
                            if (organizing) {
                                Row {
                                    TextButton(enabled = !busy, onClick = {
                                        act {
                                            val order =
                                                listOf(sticker.stickerId) + stickers.map { it.stickerId }.filter { it != sticker.stickerId }
                                            repository.call(
                                                Endpoints.stickerEndpointsReorderMyStickers,
                                                body = buildJsonObject { put("stickerIds", JsonArray(order.map(::JsonPrimitive))) },
                                                options = SessionCallOptions(owner = owner),
                                            )
                                        }
                                    }) { Text("最前", style = MaterialTheme.typography.bodySmall) }
                                    TextButton(enabled = !busy, onClick = {
                                        act {
                                            repository.call(
                                                Endpoints.stickerEndpointsDeleteMySticker,
                                                params = mapOf("stickerId" to sticker.stickerId),
                                                options = SessionCallOptions(owner = owner),
                                            )
                                        }
                                    }) { Text("删除", color = colors.textDanger, style = MaterialTheme.typography.bodySmall) }
                                }
                            }
                        }
                    }
                }
        }
        Text(
            "共 ${stickers.size} 个表情",
            Modifier.fillMaxWidth().padding(WbSpace.S5),
            color = colors.textTertiary,
            style = MaterialTheme.typography.bodySmall,
        )
    }
    preview?.let { sticker ->
        Dialog(onDismissRequest = { preview = null }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            Box(Modifier.fillMaxSize().background(Color.Black).clickable { preview = null }, contentAlignment = Alignment.Center) {
                StickerMessage(repository, owner, sticker.mediaId, edge = 240.dp)
            }
        }
    }
}
