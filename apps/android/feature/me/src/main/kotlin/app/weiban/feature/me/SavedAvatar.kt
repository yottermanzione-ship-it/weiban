package app.weiban.feature.me

import android.graphics.Bitmap
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import app.weiban.contracts.Endpoints
import app.weiban.contracts.Profile
import app.weiban.data.OwnerRecord
import app.weiban.data.SessionCallOptions
import app.weiban.data.SessionRepository
import app.weiban.designsystem.DefaultAvatar
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.decodeAvatar
import app.weiban.designsystem.defaultAvatarStyle
import app.weiban.designsystem.tokens.WbMotion
import app.weiban.designsystem.tokens.WbRadius
import app.weiban.designsystem.tokens.WbSize
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@Composable internal fun SavedAvatar(
    repository: SessionRepository,
    owner: OwnerRecord,
    profile: Profile?,
) {
    val auth by repository.auth.collectAsState()
    val authorized = auth?.user?.userId == owner.userId && auth?.session?.sessionId == owner.sessionId
    val mediaId = if (authorized) profile?.avatarMediaId else null
    var bitmap by remember(repository, mediaId, owner) { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(repository, mediaId, owner) {
        if (mediaId != null) bitmap = avatar(repository, mediaId, owner)
    }
    val colors = LocalWeibanColors.current
    val style =
        defaultAvatarStyle(owner.userId, if (authorized) profile?.nickname ?: "我" else "我", pattern = "none")
            .copy(background = colors.bgUserAvatar, foreground = colors.textUserAvatar)
    val opacity by animateFloatAsState(if (bitmap == null) 0f else 1f, tween(WbMotion.FastMs), label = "头像淡入")
    Box(
        Modifier.size(WbSize.AvatarXl).clip(RoundedCornerShape(WbSize.AvatarXl * WbRadius.AvatarRatio)).clearAndSetSemantics {
            contentDescription =
                "我的头像"
        },
    ) {
        DefaultAvatar(style, WbSize.AvatarXl)
        bitmap?.takeIf { authorized }?.let { image ->
            Image(image.asImageBitmap(), null, Modifier.size(WbSize.AvatarXl).alpha(opacity), contentScale = ContentScale.Crop)
            DisposableEffect(image) { onDispose { image.recycle() } }
        }
    }
}

@Suppress("TooGenericExceptionCaught") // A missing/expired picture must not block the profile; cancellation propagates.
private suspend fun avatar(repository: SessionRepository, mediaId: String, owner: OwnerRecord): Bitmap? =
    try {
        val media =
            repository.call(
                Endpoints.mediaEndpointsGetMedia,
                params = mapOf("mediaId" to mediaId),
                options = SessionCallOptions(owner = owner),
            )
        val bytes = repository.download(media, owner)
        withContext(Dispatchers.IO) { decodeAvatar(bytes) }
    } catch (error: CancellationException) {
        throw error
    } catch (_: Exception) {
        null
    }
