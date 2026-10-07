package app.weiban.designsystem

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException

@Composable internal fun PhotoPicker(
    state: PhotoCropState,
    enabled: Boolean,
) {
    val context = LocalContext.current
    val allowed by rememberUpdatedState(enabled)
    DisposableEffect(state) { onDispose { state.camera?.discard() } }
    val camera =
        rememberLauncherForActivityResult(AvatarCameraContract()) { captured ->
            receiveCamera(state, context, captured && allowed)
        }
    val gallery =
        rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
            if (uri != null && allowed) {
                state.perform("图片无法读取，请选一张不超过 10 MB 的图片") {
                    state.original = withContext(Dispatchers.IO) { readAvatar(context, uri) }
                }
            }
        }
    var choosing by remember { mutableStateOf(false) }
    OutlinedButton(enabled = enabled && !state.busy, onClick = { choosing = true }) {
        Text(if (state.busy) "请稍候…" else "选择并裁剪头像")
    }
    DropdownMenu(choosing, { choosing = false }) {
        DropdownMenuItem(text = { Text("从相册选择") }, onClick = {
            choosing = false
            gallery.launch("image/*")
        })
        DropdownMenuItem(text = { Text("拍照") }, onClick = {
            choosing = false
            launchCamera(state, context) { camera.launch(it) }
        })
    }
}

private fun receiveCamera(
    state: PhotoCropState,
    context: Context,
    captured: Boolean,
) {
    val photo = state.camera ?: return
    state.camera = null
    if (!captured) {
        photo.discard()
        return
    }
    state.perform("照片无法读取，请重新拍摄") {
        try {
            state.original = withContext(Dispatchers.IO) { readAvatar(context, photo.uri) }
        } finally {
            photo.discard()
        }
    }
}

private fun launchCamera(
    state: PhotoCropState,
    context: Context,
    launch: (Uri) -> Unit,
) {
    try {
        state.camera = CameraPhoto.create(context)
        launch(state.camera!!.uri)
    } catch (_: ActivityNotFoundException) {
        state.camera?.discard()
        state.camera = null
        state.error = "没有可用的相机，请从相册选择"
    } catch (_: IOException) {
        state.error = "照片暂时无法保存，请从相册选择"
    }
}

private class AvatarCameraContract : ActivityResultContracts.TakePicture() {
    override fun createIntent(
        context: Context,
        input: Uri,
    ): Intent =
        super.createIntent(context, input).apply {
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            clipData = ClipData.newRawUri("头像照片", input)
        }
}
