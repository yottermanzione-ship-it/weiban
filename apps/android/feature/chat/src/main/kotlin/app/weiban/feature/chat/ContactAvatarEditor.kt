package app.weiban.feature.chat

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.*
import androidx.compose.runtime.*
import app.weiban.contracts.Contact
import app.weiban.contracts.Endpoints
import app.weiban.data.*
import app.weiban.designsystem.PhotoCropper
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

@Composable internal fun ContactAvatarEditor(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    contact: Contact,
) {
    val auth = repository.auth.collectAsState().value
    if (auth?.user?.userId != owner.userId || auth.session.sessionId != owner.sessionId) return
    key(owner, contact.characterId) {
        ContactAvatarControls(repository, runtime, owner, contact)
    }
}

@Composable private fun ContactAvatarControls(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    contact: Contact,
) {
    val scope = rememberCoroutineScope()
    var expanded by remember { mutableStateOf(false) }
    var pending by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val restore: () -> Unit = {
        pending = true
        message = null
        error = null
        scope.launch {
            try {
                userAction({ error = it }) {
                    updateContactAvatar(repository, runtime, owner, contact.characterId, null)
                    message = "已恢复默认头像"
                }
            } finally {
                pending = false
            }
        }
    }
    TextButton(onClick = { expanded = !expanded }, enabled = !pending) { Text("设置头像") }
    if (!expanded) return
    Column {
        Text("上传的头像只有你自己能看到")
        PhotoCropper(
            enabled = !pending,
            onRestore = if (contact.customAvatarMediaId != null) restore else null,
        ) { bytes ->
            pending = true
            message = null
            error = null
            try {
                val media = uploadAvatar(repository, owner, bytes, "contact_avatar")
                updateContactAvatar(repository, runtime, owner, contact.characterId, media.mediaId)
                message = "已设置，只有你能看到"
            } finally {
                pending = false
            }
        }
        message?.let { Text(it) }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    }
}

internal suspend fun updateContactAvatar(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    characterId: String,
    mediaId: String?,
) {
    repository.call(
        Endpoints.contactsEndpointsUpdate,
        body = buildJsonObject { put("customAvatarMediaId", mediaId?.let(::JsonPrimitive) ?: JsonNull) },
        params = mapOf("characterId" to characterId),
        options = SessionCallOptions(owner = owner),
    )
    runtime.history.synchronize(owner)
}
