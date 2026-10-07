package app.weiban.data

import app.weiban.contracts.*
import app.weiban.network.ApiFailure
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.encodeToJsonElement
import java.io.IOException

/** HTTP is the reliable send/fallback transport; sync pulls must never read a stale GET cache. */
class SyncHttp(
    private val repository: SessionRepository,
) {
    private val json = repository.api.json

    suspend fun execute(effect: ClientSyncEffect): List<ClientSyncOperation> =
        when (effect) {
            is ClientSyncEffectSend -> send(effect)
            is ClientSyncEffectUpdates -> updates(effect)
            is ClientSyncEffectState ->
                listOf(
                    ClientSyncOperationRebuildState(
                        latestUpdateSeq = repository.call(Endpoints.syncEndpointsGetState, networkOnly = true).latestUpdateSeq,
                    ),
                )
            is ClientSyncEffectSnapshot -> listOf(ClientSyncOperationSnapshot(startSeq = effect.startSeq, snapshot = snapshot()))
            is ClientSyncEffectMessages ->
                listOf(
                    ClientSyncOperationMessagesPage(
                        conversationId = effect.conversationId,
                        page =
                            repository.call(
                                Endpoints.chatEndpointsListMessages,
                                params = mapOf("conversationId" to effect.conversationId),
                                query = mapOf("afterSeq" to effect.afterSeq.toString(), "limit" to effect.limit.toString()),
                                networkOnly = true,
                            ),
                    ),
                )
            is ClientSyncEffectSettings -> {
                refreshSetting(effect)
                emptyList()
            }
            is ClientSyncEffectModelStatus -> emptyList()
        }

    private suspend fun send(effect: ClientSyncEffectSend): List<ClientSyncOperation> =
        try {
            val ack =
                repository.call(
                    Endpoints.chatEndpointsSendMessage,
                    body = json.encodeToJsonElement(SendMessageRequest.serializer(), effect.body),
                    params = mapOf("conversationId" to effect.conversationId),
                    networkOnly = true,
                )
            listOf(ClientSyncOperationAck(ack = ack, now = System.currentTimeMillis()))
        } catch (error: CancellationException) {
            throw error
        } catch (error: IOException) {
            listOf(
                ClientSyncOperationSendFailed(
                    conversationId = effect.conversationId,
                    clientMsgId = effect.body.clientMsgId,
                    httpStatus = (error as? ApiFailure)?.status?.takeIf { it >= 400 }?.toLong(),
                    now = System.currentTimeMillis(),
                ),
            )
        }

    private suspend fun updates(effect: ClientSyncEffectUpdates): List<ClientSyncOperation> =
        try {
            val page =
                repository.call(
                    Endpoints.syncEndpointsGetUpdates,
                    query = mapOf("since" to effect.since.toString(), "limit" to effect.limit.toString()),
                    networkOnly = true,
                )
            listOf(ClientSyncOperationUpdatesPage(page = page, now = System.currentTimeMillis()))
        } catch (error: ApiFailure) {
            if (error.code != "sync_cursor_expired") throw error
            listOf(ClientSyncOperationCursorExpired())
        }

    private suspend fun snapshot(): ClientFullSyncSnapshot {
        val conversations = repository.call(Endpoints.chatEndpointsListConversations, networkOnly = true).items
        val contacts = repository.call(Endpoints.contactsEndpointsList, networkOnly = true).items
        val messages = mutableListOf<Message>()
        val coverages = mutableListOf<ClientFullSyncSnapshotCoveragesItem>()
        for (conversation in conversations) {
            val page =
                repository.call(
                    Endpoints.chatEndpointsListMessages,
                    params = mapOf("conversationId" to conversation.conversationId),
                    query = mapOf("limit" to "50"),
                    networkOnly = true,
                )
            messages += page.items
            page.coverage?.let { coverages += ClientFullSyncSnapshotCoveragesItem(conversation.conversationId, it) }
        }
        val settings =
            mapOf(
                "profile" to json.encodeToJsonElement(repository.call(Endpoints.identityEndpointsGetProfile, networkOnly = true)),
                "notification" to
                    json.encodeToJsonElement(repository.call(Endpoints.identityEndpointsGetNotificationSettings, networkOnly = true)),
                "preferences" to json.encodeToJsonElement(repository.call(Endpoints.identityEndpointsGetPreferences, networkOnly = true)),
                "model_selection" to
                    json.encodeToJsonElement(repository.call(Endpoints.modelAccessEndpointsGetSelection, networkOnly = true)),
                "wallet" to json.encodeToJsonElement(repository.call(Endpoints.billingEndpointsGetWallet, networkOnly = true)),
            )
        return ClientFullSyncSnapshot(conversations, messages, contacts, settings, coverages)
    }

    private suspend fun refreshSetting(effect: ClientSyncEffectSettings) {
        when (effect.section) {
            "profile" -> repository.call(Endpoints.identityEndpointsGetProfile, networkOnly = true)
            "notification" -> repository.call(Endpoints.identityEndpointsGetNotificationSettings, networkOnly = true)
            "preferences" -> repository.call(Endpoints.identityEndpointsGetPreferences, networkOnly = true)
            "wallet" -> repository.call(Endpoints.billingEndpointsGetWallet, networkOnly = true)
            "companion" ->
                effect.characterId?.let {
                    repository.call(Endpoints.companionEndpointsGetForCharacter, params = mapOf("characterId" to it), networkOnly = true)
                }
            "model_selection" -> repository.call(Endpoints.modelAccessEndpointsGetSelection, networkOnly = true)
        }
    }
}
