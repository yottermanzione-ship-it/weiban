package app.weiban.designsystem

import android.graphics.Bitmap
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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream

private fun avatarPng(preview: Bitmap): ByteArray =
    ByteArrayOutputStream().use { out ->
        check(preview.compress(Bitmap.CompressFormat.PNG, 100, out))
        out.toByteArray()
    }

private class PhotoCropState(
    private val scope: kotlinx.coroutines.CoroutineScope,
) {
    var original by mutableStateOf<Bitmap?>(null)
    var busy by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)

    @Suppress("TooGenericExceptionCaught") // Picker/storage/network errors are presented; cancellation propagates.
    fun perform(
        message: String,
        work: suspend () -> Unit,
    ) {
        if (busy) return
        busy = true
        error = null
        scope.launch {
            try {
                work()
            } catch (failure: kotlinx.coroutines.CancellationException) {
                throw failure
            } catch (_: Exception) {
                error = message
            } finally {
                busy = false
            }
        }
    }
}

@Composable
fun PhotoCropper(
    enabled: Boolean = true,
    onSaved: suspend (ByteArray) -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val state = remember { PhotoCropState(scope) }
    val allowed by rememberUpdatedState(enabled)
    val save by rememberUpdatedState(onSaved)
    val picker =
        rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
            if (uri != null && allowed) {
                state.perform("图片无法读取，请选一张不超过 10 MB 的图片") {
                    state.original = withContext(Dispatchers.IO) { readAvatar(context, uri) }
                }
            }
        }
    OutlinedButton(enabled = enabled && !state.busy, onClick = { picker.launch("image/*") }) {
        Text(if (state.busy) "请稍候…" else "选择并裁剪头像")
    }
    state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    state.original?.let { image ->
        AvatarDialog(image, state.busy || !enabled, { state.original = null }) { preview ->
            state.perform("头像保存失败，请稍后重试") {
                val bytes = withContext(Dispatchers.IO) { avatarPng(preview) }
                check(allowed)
                save(bytes)
                state.original = null
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
