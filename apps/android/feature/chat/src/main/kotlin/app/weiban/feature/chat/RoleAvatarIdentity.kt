package app.weiban.feature.chat

import android.graphics.Bitmap
import android.graphics.BitmapFactory
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
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.weiban.contracts.*
import app.weiban.data.*
import app.weiban.designsystem.DefaultAvatar
import app.weiban.designsystem.defaultAvatarStyle
import app.weiban.designsystem.tokens.WbMotion
import app.weiban.designsystem.tokens.WbRadius
import kotlinx.coroutines.*

data class RoleAvatarIdentity(
    val id: String,
    val name: String,
    val avatar: CharacterAvatar?,
    val privateMediaId: String? = null,
)

@Composable internal fun RoleAvatar(
    repository: SessionRepository,
    owner: OwnerRecord,
    role: RoleAvatarIdentity,
    size: Dp = 48.dp,
) {
    val auth by repository.auth.collectAsState()
    val authorized = auth?.user?.userId == owner.userId && auth?.session?.sessionId == owner.sessionId
    val mediaId = if (authorized) role.privateMediaId ?: role.avatar?.image?.mediaId else null
    var bitmap by remember(owner, role.id, mediaId) { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(owner, role.id, mediaId) {
        if (mediaId != null) bitmap = rolePicture(repository, owner, mediaId)
    }
    val opacity by animateFloatAsState(if (bitmap == null) 0f else 1f, tween(WbMotion.FastMs), label = "头像淡入")
    val display = if (authorized) role.avatar?.display else null
    val name = if (authorized) role.name else ""
    val style =
        defaultAvatarStyle(
            role.id,
            name,
            display?.supportColors.orEmpty(),
            display?.avatarText,
            display?.avatarPattern ?: "star",
        )
    Box(
        Modifier.size(size).clip(RoundedCornerShape(size * WbRadius.AvatarRatio)).clearAndSetSemantics {
            contentDescription = "${name.ifEmpty { "角色" }}头像"
        },
    ) {
        DefaultAvatar(style, size)
        bitmap?.let { image ->
            Image(image.asImageBitmap(), null, Modifier.size(size).alpha(opacity), contentScale = ContentScale.Crop)
            DisposableEffect(image) { onDispose { image.recycle() } }
        }
    }
}

@Suppress("TooGenericExceptionCaught") // Missing/expired images keep the default; cancellation must stop the old owner request.
private suspend fun rolePicture(repository: SessionRepository, owner: OwnerRecord, mediaId: String): Bitmap? =
    try {
        val media =
            repository.call(
                Endpoints.mediaEndpointsGetMedia,
                params = mapOf("mediaId" to mediaId),
                options = SessionCallOptions(owner = owner),
            )
        val bytes = repository.download(media, owner)
        withContext(Dispatchers.IO) {
            val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
            require(options.outWidth > 0 && options.outHeight > 0 && options.outWidth.toLong() * options.outHeight <= 40_000_000)
            var sample = 1
            while (maxOf(options.outWidth, options.outHeight) / sample > 192) sample *= 2
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
        }
    } catch (error: CancellationException) {
        throw error
    } catch (_: Exception) {
        null
    }
