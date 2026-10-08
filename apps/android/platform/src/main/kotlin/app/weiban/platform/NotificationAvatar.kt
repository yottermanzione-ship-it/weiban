package app.weiban.platform

import android.content.Context
import android.graphics.BitmapFactory
import app.weiban.contracts.*
import app.weiban.data.*
import app.weiban.designsystem.avatarImagePng
import app.weiban.designsystem.decodeAvatar
import app.weiban.designsystem.defaultAvatarPng
import app.weiban.designsystem.defaultAvatarStyle
import kotlinx.coroutines.CancellationException

internal class NotificationAvatar(
    private val context: Context,
    private val repository: SessionRepository,
) {
    @Suppress("TooGenericExceptionCaught") // Missing images use the canonical role glyph; owner checks still gate OS publication.
    suspend fun load(owner: OwnerRecord, envelope: NotificationEnvelope): android.graphics.Bitmap {
        val fallback = defaultAvatarStyle(envelope.conversationId ?: envelope.collapseKey, "微伴", emptyList(), null, "none")
        var png = defaultAvatarPng(context, fallback)
        try {
            val characterId = character(owner, envelope) ?: return BitmapFactory.decodeByteArray(png, 0, png.size)
            val options = SessionCallOptions(owner = owner)
            val profile =
                repository.call(
                    Endpoints.characterEndpointsGetProfile,
                    params = mapOf("characterId" to characterId),
                    options = options,
                )
            val display = profile.avatar.display
            png =
                defaultAvatarPng(
                    context,
                    defaultAvatarStyle(characterId, profile.name, display.supportColors, display.avatarText, display.avatarPattern),
                )
            val contacts = repository.call(Endpoints.contactsEndpointsList, options = options)
            val mediaId = contacts.items.firstOrNull { it.characterId == characterId }?.customAvatarMediaId ?: profile.avatar.image?.mediaId
            if (mediaId != null) {
                val media = repository.call(Endpoints.mediaEndpointsGetMedia, params = mapOf("mediaId" to mediaId), options = options)
                val bitmap = decodeAvatar(repository.download(media, owner))
                try {
                    png = avatarImagePng(bitmap)
                } finally {
                    bitmap.recycle()
                }
            }
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            // Retain the validated default.
        }
        return BitmapFactory.decodeByteArray(png, 0, png.size)
    }

    private suspend fun character(
        owner: OwnerRecord,
        envelope: NotificationEnvelope,
    ): String? {
        val conversationId = envelope.conversationId ?: return null
        val conversation =
            repository.call(
                Endpoints.chatEndpointsGetConversation,
                params = mapOf("conversationId" to conversationId),
                options = SessionCallOptions(owner = owner),
            )
        return conversation.participants.firstOrNull { it.kind == "character" }?.refId
    }
}
