package app.weiban.designsystem

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import app.weiban.designsystem.tokens.WbRadius

@Composable internal fun AvatarDialog(
    image: Bitmap,
    busy: Boolean,
    onDismiss: () -> Unit,
    onSave: (Bitmap) -> Unit,
) {
    val transform = remember(image) { AvatarTransform(image) }
    val gesture = avatarGesture(transform, busy)
    val colors = LocalWeibanColors.current
    val preview =
        remember(image, transform.zoom, transform.x, transform.y) {
            cropAvatar(image, transform.zoom, transform.x, transform.y)
        }
    DisposableEffect(preview) { onDispose { if (preview !== image) preview.recycle() } }
    AlertDialog(
        containerColor = LocalWeibanModeColors.current.overlayViewer,
        titleContentColor = colors.textOnBrand,
        textContentColor = colors.textOnBrand,
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("调整头像") },
        text = { AvatarAdjustments(transform, preview, gesture, busy) },
        confirmButton = {
            TextButton(colors = ButtonDefaults.textButtonColors(contentColor = colors.textOnBrand), enabled = !busy, onClick = {
                onSave(preview)
            }) { Text("使用头像") }
        },
        dismissButton = {
            TextButton(colors = ButtonDefaults.textButtonColors(contentColor = colors.textOnBrand), enabled = !busy, onClick = onDismiss) {
                Text("取消")
            }
        },
    )
}

@Composable private fun AvatarAdjustments(
    transform: AvatarTransform,
    preview: Bitmap,
    gesture: Modifier,
    busy: Boolean,
) {
    Column {
        val corners = RoundedCornerShape(percent = (WbRadius.AvatarRatio * 100).toInt())
        Image(
            preview.asImageBitmap(),
            "头像裁剪预览",
            Modifier
                .fillMaxWidth()
                .aspectRatio(1f)
                .clip(corners)
                .then(gesture),
        )
        Text("缩放")
        Slider(transform.zoom, { transform.zoom = it }, valueRange = 1f..3f, enabled = !busy)
        Text("左右位置")
        Slider(transform.x, { transform.x = it }, valueRange = -1f..1f, enabled = !busy)
        Text("上下位置")
        Slider(transform.y, { transform.y = it }, valueRange = -1f..1f, enabled = !busy)
    }
}

private class AvatarTransform(
    val image: Bitmap,
) {
    var zoom by mutableFloatStateOf(1f)
    var x by mutableFloatStateOf(0f)
    var y by mutableFloatStateOf(0f)
    var width by mutableFloatStateOf(1f)

    fun move(
        pan: androidx.compose.ui.geometry.Offset,
        scale: Float,
    ) {
        zoom = (zoom * scale).coerceIn(1f, 3f)
        val shortest = minOf(image.width, image.height).toFloat()
        val horizontal = width * (image.width / shortest * zoom - 1f)
        val vertical = width * (image.height / shortest * zoom - 1f)
        if (horizontal > 0f) x = (x - 2f * pan.x / horizontal).coerceIn(-1f, 1f)
        if (vertical > 0f) y = (y - 2f * pan.y / vertical).coerceIn(-1f, 1f)
    }
}

private fun avatarGesture(
    transform: AvatarTransform,
    busy: Boolean,
): Modifier =
    Modifier
        .onSizeChanged { transform.width = it.width.toFloat().coerceAtLeast(1f) }
        .pointerInput(transform, busy) {
            detectTransformGestures { _, pan, scale, _ -> if (!busy) transform.move(pan, scale) }
        }
