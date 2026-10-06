package app.weiban.feature.me

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import app.weiban.contracts.Endpoints
import app.weiban.data.SessionRepository
import app.weiban.designsystem.tokens.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import kotlin.math.roundToInt

internal fun decodeAvatar(bytes: ByteArray): Bitmap {
    val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
    require(options.outWidth > 0 && options.outHeight > 0 && options.outWidth.toLong() * options.outHeight <= 40_000_000)
    var sample = 1
    while (maxOf(options.outWidth, options.outHeight) / sample > 2048)sample *= 2
    val decoded =
        BitmapFactory.decodeByteArray(
            bytes,
            0,
            bytes.size,
            BitmapFactory.Options().apply { inSampleSize = sample },
        ) ?: error("Invalid image")
    val orientation =
        runCatching {
            ExifInterface(ByteArrayInputStream(bytes)).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)
    val matrix = orientationMatrix(orientation)
    return if (matrix.isIdentity) {
        decoded
    } else {
        Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true).also {
            if (it !==
                decoded
            ) {
                decoded.recycle()
            }
        }
    }
}

internal fun cropAvatar(
    original: Bitmap,
    zoom: Float,
    x: Float,
    y: Float,
): Bitmap {
    val side = (minOf(original.width, original.height) / zoom).roundToInt().coerceAtLeast(1)
    val left = ((original.width - side) * (x + 1f) / 2).roundToInt().coerceIn(0, original.width - side)
    val top = ((original.height - side) * (y + 1f) / 2).roundToInt().coerceIn(0, original.height - side)
    val cropped = Bitmap.createBitmap(original, left, top, side, side)
    return Bitmap.createScaledBitmap(cropped, 512, 512, true).also { if (cropped !== original && cropped !== it)cropped.recycle() }
}

private fun orientationMatrix(orientation: Int): Matrix {
    val matrix = Matrix()
    when (orientation) {
        ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.setScale(-1f, 1f)
        ExifInterface.ORIENTATION_ROTATE_180 -> matrix.setRotate(180f)
        ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.setScale(1f, -1f)
        ExifInterface.ORIENTATION_TRANSPOSE -> {
            matrix.setRotate(90f)
            matrix.postScale(-1f, 1f)
        }
        ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
        ExifInterface.ORIENTATION_TRANSVERSE -> {
            matrix.setRotate(270f)
            matrix.postScale(-1f, 1f)
        }
        ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(270f)
    }
    return matrix
}

private fun readAvatar(
    context: android.content.Context,
    uri: Uri,
): Bitmap {
    val bytes =
        context.contentResolver.openInputStream(uri)?.use { input ->
            val out = ByteArrayOutputStream()
            val buffer = ByteArray(8192)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                require(out.size() + count <= 10_485_760)
                out.write(buffer, 0, count)
            }
            out.toByteArray()
        } ?: error("Cannot read selected image")
    return decodeAvatar(bytes)
}

private suspend fun uploadAvatar(
    repository: SessionRepository,
    preview: Bitmap,
) {
    val bytes =
        withContext(Dispatchers.IO) {
            ByteArrayOutputStream().use { out ->
                check(preview.compress(Bitmap.CompressFormat.PNG, 100, out))
                out.toByteArray()
            }
        }
    val multipart =
        MultipartBody
            .Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("file", "avatar.png", bytes.toRequestBody("image/png".toMediaType()))
            .build()
    val media = repository.call(Endpoints.mediaEndpointsUpload, query = mapOf("purpose" to "user_avatar"), multipart = multipart)
    repository.call(Endpoints.identityEndpointsUpdateProfile, buildJsonObject { put("avatarMediaId", media.mediaId) })
}

@Suppress("TooGenericExceptionCaught") // Picker/storage/network failures are user-visible; cancellation propagates.
@Composable
fun AvatarPicker(repository: SessionRepository, onSaved: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var original by remember { mutableStateOf<Bitmap?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val picker =
        rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
            if (uri != null) {
                scope.launch {
                    busy = true
                    error = null
                    try {
                        original = withContext(Dispatchers.IO) { readAvatar(context, uri) }
                    } catch (failure: kotlinx.coroutines.CancellationException) {
                        throw failure
                    } catch (_: Exception) {
                        error = "图片无法读取，请选一张不超过 10 MB 的图片"
                    } finally {
                        busy = false
                    }
                }
            }
        }
    OutlinedButton(enabled = !busy, onClick = { picker.launch("image/*") }) { Text(if (busy) "请稍候…" else "选择并裁剪头像") }
    error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    original?.let { image ->
        AvatarDialog(image, busy, { original = null }) { preview ->
            scope.launch {
                busy = true
                error = null
                try {
                    uploadAvatar(repository, preview)
                    original = null
                    onSaved()
                } catch (failure: kotlinx.coroutines.CancellationException) {
                    throw failure
                } catch (_: Exception) {
                    error = "头像保存失败，请稍后重试"
                } finally {
                    busy = false
                }
            }
        }
        DisposableEffect(image) { onDispose { image.recycle() } }
    }
}

@Composable private fun AvatarDialog(
    image: Bitmap,
    busy: Boolean,
    onDismiss: () -> Unit,
    onSave: (Bitmap) -> Unit,
) {
    var zoom by remember(image) { mutableFloatStateOf(1f) }
    var x by remember(image) { mutableFloatStateOf(0f) }
    var y by remember(image) { mutableFloatStateOf(0f) }
    val preview = remember(image, zoom, x, y) { cropAvatar(image, zoom, x, y) }
    DisposableEffect(preview) { onDispose { if (preview !== image) preview.recycle() } }
    AlertDialog(onDismissRequest = { if (!busy) onDismiss() }, title = { Text("调整头像") }, text = {
        Column {
            Image(preview.asImageBitmap(), "头像裁剪预览", Modifier.fillMaxWidth().aspectRatio(1f))
            Text("缩放")
            Slider(zoom, { zoom = it }, valueRange = 1f..3f, enabled = !busy)
            Text("左右位置")
            Slider(x, { x = it }, valueRange = -1f..1f, enabled = !busy)
            Text("上下位置")
            Slider(y, { y = it }, valueRange = -1f..1f, enabled = !busy)
        }
    }, confirmButton = {
        TextButton(enabled = !busy, onClick = { onSave(preview) }) { Text("使用头像") }
    }, dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("取消") } })
}
