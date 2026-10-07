package app.weiban.feature.chat

import androidx.compose.runtime.*
import androidx.compose.ui.unit.dp
import app.weiban.contracts.*
import app.weiban.data.*
import kotlinx.coroutines.CancellationException

internal data class MessageAvatars(
    val roles: Map<String, RoleAvatarIdentity>,
    val user: RoleAvatarIdentity,
) {
    fun sender(message: Message): RoleAvatarIdentity? =
        when {
            message.status != "normal" || message.senderKind == "system" -> null
            message.senderKind == "user" -> user
            else -> roles[message.senderParticipantId]
        }
}

@Composable internal fun messageAvatars(
    repository: SessionRepository,
    owner: OwnerRecord,
    state: ClientSyncState,
    conversation: Conversation,
): MessageAvatars {
    val characters = conversation.participants.filter { it.kind == "character" }
    val profiles = characterProfiles(repository, characters.map { it.refId })
    var profile by remember(owner) { mutableStateOf<Profile?>(null) }
    LaunchedEffect(owner) { profile = userProfile(repository, owner) }
    return MessageAvatars(
        characters.associate { participant ->
            val role = profiles[participant.refId]
            participant.participantId to
                RoleAvatarIdentity(
                    participant.refId,
                    role?.name.orEmpty(),
                    role?.avatar,
                    state.contacts
                        .find {
                            it.characterId ==
                                participant.refId
                        }?.customAvatarMediaId,
                )
        },
        RoleAvatarIdentity(owner.userId, profile?.nickname ?: "我", null, profile?.avatarMediaId, user = true),
    )
}

@Composable internal fun MessageAvatar(
    repository: SessionRepository,
    owner: OwnerRecord,
    identity: RoleAvatarIdentity,
) {
    RoleAvatar(repository, owner, identity, 40.dp)
}

@Suppress("TooGenericExceptionCaught") // An unavailable profile keeps the local default; cancellation cannot carry it into a new owner.
private suspend fun userProfile(repository: SessionRepository, owner: OwnerRecord): Profile? =
    try {
        repository.call(Endpoints.identityEndpointsGetProfile, options = SessionCallOptions(owner = owner))
    } catch (error: CancellationException) {
        throw error
    } catch (_: Exception) {
        null
    }
