package app.weiban.feature.me

import androidx.compose.runtime.*
import app.weiban.contracts.Endpoints
import app.weiban.data.*
import app.weiban.designsystem.PhotoCropper
import kotlinx.serialization.json.*

@Composable
fun AvatarPicker(
    repository: SessionRepository,
    onSaved: () -> Unit,
) {
    val auth = repository.auth.collectAsState().value ?: return
    val owner = OwnerRecord(userId = auth.user.userId, sessionId = auth.session.sessionId)
    key(owner) {
        PhotoCropper { bytes ->
            val media = uploadAvatar(repository, owner, bytes, "user_avatar")
            repository.call(
                Endpoints.identityEndpointsUpdateProfile,
                buildJsonObject { put("avatarMediaId", media.mediaId) },
                options = SessionCallOptions(owner = owner),
            )
            onSaved()
        }
    }
}
