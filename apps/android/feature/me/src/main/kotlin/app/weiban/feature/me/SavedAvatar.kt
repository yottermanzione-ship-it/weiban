package app.weiban.feature.me

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import app.weiban.contracts.Endpoints
import app.weiban.data.SessionRepository
import app.weiban.designsystem.tokens.WbSize
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@Composable internal fun SavedAvatar(
    repository: SessionRepository,
    mediaId: String?,
) {
    var bitmap by remember(repository, mediaId) { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(repository, mediaId) {
        if (mediaId != null) bitmap = avatar(repository, mediaId)
    }
    val image = bitmap
    if (image == null) {
        Text("头像")
    } else {
        Image(image.asImageBitmap(), "我的头像", Modifier.size(WbSize.AvatarXl).clip(CircleShape))
        DisposableEffect(image) { onDispose { image.recycle() } }
    }
}

@Suppress("TooGenericExceptionCaught") // A missing/expired picture must not block the profile; cancellation propagates.
private suspend fun avatar(repository: SessionRepository, mediaId: String): Bitmap? =
    try {
        val media = repository.call(Endpoints.mediaEndpointsGetMedia, params = mapOf("mediaId" to mediaId))
        val bytes = repository.download(media)
        withContext(Dispatchers.IO) { decodeAvatar(bytes) }
    } catch (error: CancellationException) {
        throw error
    } catch (_: Exception) {
        null
    }
