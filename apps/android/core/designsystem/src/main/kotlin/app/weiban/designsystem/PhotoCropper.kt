package app.weiban.designsystem

import android.graphics.Bitmap
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream

private fun avatarPng(preview: Bitmap): ByteArray =
    ByteArrayOutputStream().use { out ->
        check(preview.compress(Bitmap.CompressFormat.PNG, 100, out))
        out.toByteArray()
    }

internal class PhotoCropState(
    private val scope: kotlinx.coroutines.CoroutineScope,
) {
    var original by mutableStateOf<Bitmap?>(null)
    var busy by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    var camera by mutableStateOf<CameraPhoto?>(null)

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
    val scope = rememberCoroutineScope()
    val state = remember { PhotoCropState(scope) }
    val allowed by rememberUpdatedState(enabled)
    val save by rememberUpdatedState(onSaved)
    PhotoPicker(state, enabled)
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
