package app.weiban.feature.chat

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.LruCache
import androidx.compose.runtime.*
import app.weiban.data.OwnerRecord
import app.weiban.data.SessionRepository
import app.weiban.data.downloadChatMedia
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException

private const val SEND_MAX_EDGE = 2_048
private const val JPEG_QUALITY = 85
private const val MAX_SOURCE_BYTES = 30 * 1024 * 1024
private const val MAX_UPLOAD_BYTES = 10 * 1024 * 1024
private const val MAX_PIXELS = 40_000_000L
private const val PREVIEW_EDGE = 480

/** 准备好上传的一张图（media-l5.md 2.1：长边超过 2048 先压缩；不提供原图）。 */
internal class PreparedImage(
    val bytes: ByteArray,
    val mimeType: String,
    val width: Int,
    val height: Int,
    val preview: Bitmap?,
)

/** 读取相册 / 相机的图片：GIF 小于上限原样上传（保留动图），其余按方向转正、压到 2048 内的 JPEG。 */
@Suppress("CyclomaticComplexMethod", "LongMethod") // 首次本机构建（2026-10-11）：保留既有逻辑，复杂度待重构
internal suspend fun prepareChatImage(
    context: Context,
    uri: Uri,
): PreparedImage =
    withContext(Dispatchers.IO) {
        val resolver = context.contentResolver
        val raw = resolver.openInputStream(uri)?.use { it.readBytes() } ?: throw IOException("image unavailable")
        if (raw.size > MAX_SOURCE_BYTES) throw IOException("image too large")
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(raw, 0, raw.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0 || bounds.outWidth.toLong() * bounds.outHeight > MAX_PIXELS) {
            throw IOException("unsupported image")
        }
        val preview = decodeSampled(raw, PREVIEW_EDGE)
        if (bounds.outMimeType == "image/gif" && raw.size <= MAX_UPLOAD_BYTES &&
            maxOf(bounds.outWidth, bounds.outHeight) <= SEND_MAX_EDGE
        ) {
            return@withContext PreparedImage(raw, "image/gif", bounds.outWidth, bounds.outHeight, preview)
        }
        var bitmap = decodeSampled(raw, SEND_MAX_EDGE) ?: throw IOException("unsupported image")
        val rotation =
            try {
                when (ExifInterface(raw.inputStream()).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                    ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                    ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                    ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                    else -> 0f
                }
            } catch (_: IOException) {
                0f
            }
        val edge = maxOf(bitmap.width, bitmap.height)
        if (rotation != 0f || edge > SEND_MAX_EDGE) {
            val scale = if (edge > SEND_MAX_EDGE) SEND_MAX_EDGE.toFloat() / edge else 1f
            val matrix =
                Matrix().apply {
                    postScale(scale, scale)
                    postRotate(rotation)
                }
            val turned = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
            if (turned !== bitmap) bitmap.recycle()
            bitmap = turned
        }
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)
        val bytes = out.toByteArray()
        val result =
            PreparedImage(
                bytes,
                "image/jpeg",
                bitmap.width,
                bitmap.height,
                if (rotation !=
                    0f
                ) {
                    decodeSampled(bytes, PREVIEW_EDGE)
                } else {
                    preview
                },
            )
        bitmap.recycle()
        if (bytes.size > MAX_UPLOAD_BYTES) throw IOException("image too large")
        result
    }

internal fun decodeSampled(
    bytes: ByteArray,
    maxEdge: Int,
): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0 || bounds.outWidth.toLong() * bounds.outHeight > MAX_PIXELS) return null
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxEdge) sample *= 2
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
}

/** 聊天图片内存缓存：滚动回来不重新下载。缓存里的图不回收（交给 LRU 与 GC）。 */
internal object ChatBitmaps {
    private val cache =
        object : LruCache<String, Bitmap>((Runtime.getRuntime().maxMemory() / 8).toInt()) {
            override fun sizeOf(
                key: String,
                value: Bitmap,
            ): Int = value.byteCount
        }

    fun get(key: String): Bitmap? = cache.get(key)

    fun put(
        key: String,
        bitmap: Bitmap,
    ) {
        cache.put(key, bitmap)
    }
}

internal class MediaBitmapState {
    var bitmap by mutableStateOf<Bitmap?>(null)
    var failed by mutableStateOf(false)
    var attempt by mutableIntStateOf(0)

    fun retry() {
        failed = false
        attempt++
    }
}

/** 按需下载并解码一张聊天图片（thumbnail = 缩略图链接）。失败时 failed = true，可 retry()。 */
@Composable internal fun rememberMediaBitmap(
    repository: SessionRepository,
    owner: OwnerRecord,
    mediaId: String,
    thumbnail: Boolean,
    maxEdge: Int,
): MediaBitmapState {
    val key = "$mediaId:${if (thumbnail) "t" else "o"}:$maxEdge"
    val state = remember(owner, key) { MediaBitmapState().apply { bitmap = ChatBitmaps.get(key) } }
    LaunchedEffect(state, state.attempt) {
        if (state.bitmap != null) return@LaunchedEffect
        val loaded = loadMediaBitmap(repository, owner, mediaId, thumbnail, maxEdge)
        if (loaded == null) {
            state.failed = true
        } else {
            ChatBitmaps.put(key, loaded)
            state.bitmap = loaded
        }
    }
    return state
}

@Suppress("TooGenericExceptionCaught") // Missing / expired images show the broken placeholder with retry.
private suspend fun loadMediaBitmap(
    repository: SessionRepository,
    owner: OwnerRecord,
    mediaId: String,
    thumbnail: Boolean,
    maxEdge: Int,
): Bitmap? =
    try {
        val bytes = downloadChatMedia(repository, owner, mediaId, thumbnail = thumbnail)
        withContext(Dispatchers.Default) { decodeSampled(bytes, maxEdge) }
    } catch (error: CancellationException) {
        throw error
    } catch (_: Exception) {
        null
    }

/** 保存到系统相册（安卓 10 起不需要存储权限；更早的版本由调用方先申请写入权限）。 */
@Suppress("TooGenericExceptionCaught") // Any storage failure reports false to show a toast.
internal suspend fun saveToGallery(
    context: Context,
    repository: SessionRepository,
    owner: OwnerRecord,
    mediaId: String,
): Boolean =
    try {
        val bytes = downloadChatMedia(repository, owner, mediaId)
        withContext(Dispatchers.IO) {
            val name = "weiban-${System.currentTimeMillis()}.webp"
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values =
                    ContentValues().apply {
                        put(MediaStore.Images.Media.DISPLAY_NAME, name)
                        put(MediaStore.Images.Media.MIME_TYPE, "image/webp")
                        put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/微伴")
                        put(MediaStore.Images.Media.IS_PENDING, 1)
                    }
                val resolver = context.contentResolver
                val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: throw IOException("no gallery")
                resolver.openOutputStream(uri)?.use { it.write(bytes) } ?: throw IOException("no stream")
                values.clear()
                values.put(MediaStore.Images.Media.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
            } else {
                legacySave(context, name, bytes)
            }
        }
        true
    } catch (error: CancellationException) {
        throw error
    } catch (_: Exception) {
        false
    }

@Suppress("DEPRECATION") // Android 8–9 path: public Pictures directory plus a media scan.
private fun legacySave(
    context: Context,
    name: String,
    bytes: ByteArray,
) {
    val directory = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "微伴").apply { mkdirs() }
    val file = File(directory, name)
    file.writeBytes(bytes)
    android.media.MediaScannerConnection.scanFile(context, arrayOf(file.absolutePath), arrayOf("image/webp"), null)
}
