package app.weiban.data

import app.weiban.contracts.*
import app.weiban.network.ContractJson
import kotlinx.serialization.json.Json

/** Independent Kotlin implementation of the shared protocol; no HTTP, UI or Android calls. */
class SyncEngine(
    initial: ClientSyncState = freshState(),
) {
    private val json = Json { ignoreUnknownKeys = true }
    var state: ClientSyncState =
        json.decodeFromJsonElement(
            ClientSyncState.serializer(),
            ContractJson.normalize("ClientSyncState", json.encodeToJsonElement(ClientSyncState.serializer(), initial)),
        )
        private set
    private var online = false
    private var pulling = false
    private var rebuilding = false
    private var start: Long? = null
    private var pulls = mutableMapOf<String, Long>()
    private var effects = mutableListOf<ClientSyncEffect>()

    init {
        resetSending()
    }

    companion object {
        fun freshState() =
            ClientSyncState(
                initialized = false,
                lastUpdateSeq = 0,
                messages = emptyList(),
                recalled = emptyList(),
                conversations = emptyList(),
                contacts = emptyList(),
                outbox = emptyList(),
                excluded = emptyList(),
                scannedThrough = emptyMap(),
                pendingUpdates = emptyList(),
                settings = emptyMap(),
            )
    }

    fun drainEffects(): List<ClientSyncEffect> = effects.toList().also { effects.clear() }

    fun apply(input: ClientSyncOperation) {
        val op =
            json.decodeFromJsonElement(
                ClientSyncOperation.serializer(),
                ContractJson.normalize("ClientSyncOperation", json.encodeToJsonElement(ClientSyncOperation.serializer(), input)),
            )
        val before = state
        val beforeEffects = effects.toMutableList()
        val beforePulls = pulls.toMutableMap()
        val wasOnline = online
        val wasPulling = pulling
        val wasRebuilding = rebuilding
        val wasStart = start
        var committed = false
        try {
            dispatch(op)
            committed = true
        } finally {
            if (!committed) {
                state = before
                effects = beforeEffects
                pulls = beforePulls
                online = wasOnline
                pulling = wasPulling
                rebuilding = wasRebuilding
                start = wasStart
            }
        }
    }

    // Exhaustive protocol dispatch keeps new generated operation types visible to the compiler.
    @Suppress("CyclomaticComplexMethod")
    private fun dispatch(op: ClientSyncOperation) {
        when (op) {
            is ClientSyncOperationOffline -> offline()
            is ClientSyncOperationReconnect -> reconnect(op)
            is ClientSyncOperationEnqueue -> enqueue(op)
            is ClientSyncOperationAck -> acknowledge(op)
            is ClientSyncOperationSendFailed -> sendFailed(op)
            is ClientSyncOperationRetry -> retry(op)
            is ClientSyncOperationTick -> flush(op.now)
            is ClientSyncOperationUpdate -> receive(op.update)
            is ClientSyncOperationUpdatesPage -> updates(op.page, op.now)
            is ClientSyncOperationCursorExpired -> expire()
            is ClientSyncOperationRebuildState -> rebuildState(op)
            is ClientSyncOperationSnapshot -> snapshot(op.startSeq, op.snapshot)
            is ClientSyncOperationInspect -> inspect(op.conversationId)
            is ClientSyncOperationMessagesPage -> messagePage(op.conversationId, op.page)
            is ClientSyncOperationRestart -> {
                offline()
                effects.clear()
            }
            is ClientSyncOperationAccountReset -> {
                state = freshState()
                offline()
                effects.clear()
            }
        }
    }

    /** Older history is separate from a running forward gap pull. */
    fun history(
        cid: String,
        beforeSeq: Long,
        input: MessagePage,
    ) {
        require(beforeSeq in 1..9_007_199_254_740_991L)
        require(state.conversations.any { it.conversationId == cid })
        val page =
            json.decodeFromJsonElement(
                MessagePage.serializer(),
                ContractJson.normalize("MessagePage", json.encodeToJsonElement(MessagePage.serializer(), input)),
            )
        val cover = page.coverage
        require(cover == null || cover.throughSeq < beforeSeq)
        require(page.items.all { it.conversationId == cid && it.seq < beforeSeq })
        val before = state
        var committed = false
        try {
            page.items.forEach { upsert(it) }
            page.coverage?.let { coverage(cid, it) }
            committed = true
        } finally {
            if (!committed) state = before
        }
    }

    /** Persist the HTTP confirmation without inventing a user update sequence. */
    fun clearHistory(
        cid: String,
        throughSeq: Long,
    ) {
        state = ClearedHistory.confirm(state, cid, throughSeq)
    }

    private fun resetSending() {
        state = state.copy(outbox = state.outbox.map { if (it.state == "sending")it.copy(state = "pending")else it })
    }

    private fun offline() {
        online = false
        pulling = false
        rebuilding = false
        start = null
        pulls.clear()
        resetSending()
    }

    private fun flush(now: Long) {
        if (!online || pulling || rebuilding)return
        val blocked = mutableSetOf<String>()
        state =
            state.copy(
                outbox =
                    state.outbox.map { item ->
                        if (!blocked.add(item.conversationId) || item.state != "pending" || item.retryAt > now) {
                            item
                        } else {
                            effects += ClientSyncEffectSend(conversationId = item.conversationId, body = item.body)
                            item.copy(state = "sending")
                        }
                    },
            )
    }

    private fun pull() {
        if (online && !pulling && !rebuilding) {
            pulling = true
            effects += ClientSyncEffectUpdates(since = state.lastUpdateSeq)
        }
    }

    private fun receive(update: UserUpdate) {
        if (update.updateSeq <= state.lastUpdateSeq)return
        if (state.pendingUpdates.none { it.updateSeq == update.updateSeq }) {
            state =
                state.copy(
                    pendingUpdates = state.pendingUpdates + update,
                )
        }
        if (rebuilding || pulling)return
        pending()
        if (state.pendingUpdates.isNotEmpty())pull()
    }

    private fun pending(max: Long = Long.MAX_VALUE) {
        state = state.copy(pendingUpdates = state.pendingUpdates.sortedBy { it.updateSeq })
        while (state.pendingUpdates.firstOrNull()?.updateSeq == state.lastUpdateSeq + 1 && state.pendingUpdates[0].updateSeq <= max) {
            val item = state.pendingUpdates[0]
            state = state.copy(pendingUpdates = state.pendingUpdates.drop(1))
            applyUpdate(item)
            state =
                state.copy(lastUpdateSeq = item.updateSeq)
        }
        state = state.copy(pendingUpdates = state.pendingUpdates.filter { it.updateSeq > state.lastUpdateSeq })
    }

    private fun updates(
        page: SyncEndpointsGetUpdatesResponse,
        now: Long,
    ) {
        require(pulling && !rebuilding)
        val before = state.lastUpdateSeq
        var prior = -1L
        for (item in page.items) {
            require(item.updateSeq > prior)
            prior = item.updateSeq
            if (item.updateSeq > state.lastUpdateSeq &&
                state.pendingUpdates.none { it.updateSeq == item.updateSeq }
            ) {
                state = state.copy(pendingUpdates = state.pendingUpdates + item)
            }
        }
        pending(if (page.hasMore)maxOf(before, page.items.maxOfOrNull { it.updateSeq } ?: before)else Long.MAX_VALUE)
        pulling = false
        if (page.hasMore || state.lastUpdateSeq < page.latestUpdateSeq ||
            state.pendingUpdates.isNotEmpty()
        ) {
            require(state.lastUpdateSeq > before)
            pull()
        } else {
            flush(now)
        }
    }

    private fun expire() {
        pulling = false
        rebuilding = true
        start = null
        effects += ClientSyncEffectState()
    }

    private fun snapshot(
        seq: Long,
        snapshot: ClientFullSyncSnapshot,
    ) {
        require(rebuilding && start != null && seq == start)
        state =
            freshState().copy(
                initialized = true,
                lastUpdateSeq = seq,
                conversations = snapshot.conversations.map { ClearedHistory.clean(state, it) },
                excluded = state.excluded.filter { it.range.reason == "cleared" && it.range.fromSeq == 1L },
                contacts = snapshot.contacts,
                settings = snapshot.settings,
                outbox = state.outbox,
                pendingUpdates =
                    state.pendingUpdates.filter {
                        it.updateSeq >
                            seq
                    },
            )
        for (message in snapshot.messages)upsert(message)
        for (part in snapshot.coverages)coverage(part.conversationId, part.coverage)
        rebuilding = false
        start = null
        pull()
    }

    private fun excluded(
        cid: String,
        seq: Long,
    ) = state.excluded.any {
        it.conversationId == cid && seq in it.range.fromSeq..it.range.throughSeq
    }

    private fun inspect(cid: String) {
        val conversation = state.conversations.find { it.conversationId == cid } ?: return
        if (!online || rebuilding || pulls.containsKey(cid))return
        var contiguous = maxOf(conversation.state.clearedThroughSeq, state.scannedThrough[cid] ?: 0)
        val present =
            state.messages
                .filter { it.conversationId == cid }
                .map { it.seq }
                .toSet()
        while (contiguous < conversation.lastSeq && (contiguous + 1 in present || excluded(cid, contiguous + 1)))contiguous++
        if (contiguous < conversation.lastSeq) {
            pulls[cid] = contiguous
            effects += ClientSyncEffectMessages(conversationId = cid, afterSeq = contiguous)
        }
    }

    private fun messagePage(
        cid: String,
        page: MessagePage,
    ) {
        val after = pulls[cid] ?: error("No active conversation pull")
        val cover = page.coverage
        if (cover != null)require(cover.fromSeq == 0L || cover.fromSeq == after + 1)
        pulls.remove(cid)
        for (message in page.items) {
            require(message.conversationId == cid && message.seq > after)
            upsert(message)
        }
        if (cover != null)coverage(cid, cover)
        val through = cover?.throughSeq ?: maxOf(after, page.items.maxOfOrNull { it.seq } ?: after)
        val conversation = state.conversations.find { it.conversationId == cid }
        require(through > after || (!page.hasMore && (conversation == null || conversation.lastSeq <= after)))
        if (page.hasMore) {
            pulls[cid] = through
            effects += ClientSyncEffectMessages(conversationId = cid, afterSeq = through)
        } else {
            inspect(cid)
        }
    }

    private fun coverage(
        cid: String,
        value: MessagePageCoverage,
    ) {
        state = SyncCoverage.apply(state, cid, value)
    }

    // Reject gates prevent excluded/cleared/recalled content from resurrecting.
    @Suppress("ReturnCount")
    private fun upsert(input: Message) {
        var message = sanitizeRecall(input)
        state =
            state.copy(
                outbox =
                    state.outbox.filter {
                        it.body.clientMsgId != message.clientMsgId || it.conversationId != message.conversationId
                    },
            )
        if (excluded(message.conversationId, message.seq))return
        val conversation = state.conversations.find { it.conversationId == message.conversationId }
        if (conversation != null && message.seq <= conversation.state.clearedThroughSeq)return
        val incomingQuote = message.quote
        if (incomingQuote != null &&
            (incomingQuote.seq <= (conversation?.state?.clearedThroughSeq ?: 0) || excluded(message.conversationId, incomingQuote.seq))
        ) {
            message =
                message.copy(quote = incomingQuote.copy(preview = null))
        }
        if (conversation != null)edit(conversation.copy(lastSeq = maxOf(conversation.lastSeq, message.seq)))
        if (state.messages.any { it.messageId == message.messageId && it.status == "recalled" } && message.status == "normal")return
        state =
            state.copy(
                messages =
                    (
                        state.messages.filter {
                            it.messageId != message.messageId
                        } + message
                    ).sortedWith(compareBy<Message> { it.conversationId }.thenBy { it.seq }),
            )
    }

    private fun edit(conversation: Conversation) {
        state =
            state.copy(
                conversations =
                    state.conversations.map {
                        if (it.conversationId ==
                            conversation.conversationId
                        ) {
                            conversation
                        } else {
                            it
                        }
                    },
            )
    }

    private fun replace(conversation: Conversation) {
        state =
            state.copy(
                conversations =
                    state.conversations.filter { it.conversationId != conversation.conversationId } +
                        ClearedHistory.clean(state, conversation),
            )
    }

    // Exhaustive generated update dispatch has one branch per wire type.
    @Suppress("CyclomaticComplexMethod")
    private fun applyUpdate(update: UserUpdate) {
        when (update) {
            is UserUpdateMessageCreated -> upsert(update.data.message)
            is UserUpdateMessageRecalled -> recall(update)
            is UserUpdateMessageHidden -> hide(update)
            is UserUpdateConversationCreated -> replace(update.data.conversation)
            is UserUpdateConversationUpdated -> replace(update.data.conversation)
            is UserUpdateConversationStateUpdated -> conversationState(update)
            is UserUpdateConversationPeerReadUpdated ->
                state.conversations
                    .find {
                        it.conversationId == update.data.conversationId
                    }?.let { edit(it.copy(peerReadSeq = update.data.peerReadSeq)) }
            is UserUpdateContactUpserted ->
                state =
                    state.copy(contacts = state.contacts.filter { it.characterId != update.data.contact.characterId } + update.data.contact)
            is UserUpdateContactRemoved ->
                state =
                    state.copy(
                        contacts = state.contacts.filter { it.characterId != update.data.characterId },
                    )
            is UserUpdateSettingsUpdated ->
                if (update.data.section !=
                    "unsupported"
                ) {
                    effects += ClientSyncEffectSettings(section = update.data.section, characterId = update.data.characterId)
                }
            is UserUpdateModelStatusUpdated -> effects += ClientSyncEffectModelStatus(status = update.data.status)
            is UserUpdateUnsupported -> Unit
        }
    }

    private fun reconnect(op: ClientSyncOperationReconnect) {
        online = true
        if (!state.initialized) {
            expire()
        } else {
            require(op.latestUpdateSeq >= state.lastUpdateSeq)
            if (op.latestUpdateSeq > state.lastUpdateSeq ||
                state.pendingUpdates.isNotEmpty()
            ) {
                pull()
            } else {
                flush(op.now)
            }
        }
    }

    private fun enqueue(op: ClientSyncOperationEnqueue) {
        val duplicate = state.outbox.find { it.body.clientMsgId == op.body.clientMsgId }
        if (duplicate != null) {
            require(duplicate.body == op.body && duplicate.conversationId == op.conversationId)
        } else if (state.messages.none { it.clientMsgId == op.body.clientMsgId }) {
            state =
                state.copy(
                    outbox =
                        state.outbox +
                            ClientPendingSend(
                                conversationId = op.conversationId,
                                body = op.body,
                                state = "pending",
                                failures = 0,
                                retryAt = op.now,
                            ),
                )
            flush(op.now)
        }
    }

    private fun acknowledge(op: ClientSyncOperationAck) {
        val ack = op.ack
        require(ack.clientMsgId == ack.message.clientMsgId)
        val pending = state.outbox.find { it.body.clientMsgId == ack.clientMsgId }
        if (pending != null ||
            state.messages.any { it.clientMsgId == ack.clientMsgId && it.conversationId == ack.message.conversationId }
        ) {
            if (pending != null)require(pending.conversationId == ack.message.conversationId)
            upsert(ack.message)
            flush(op.now)
        }
    }

    private fun sendFailed(op: ClientSyncOperationSendFailed) {
        state =
            state.copy(
                outbox =
                    state.outbox.map { item ->
                        if (item.conversationId != op.conversationId || item.body.clientMsgId != op.clientMsgId) {
                            item
                        } else if (op.httpStatus != null && op.httpStatus!! in 400..499) {
                            item.copy(state = "failed")
                        } else if (!online) {
                            item.copy(state = "pending")
                        } else {
                            val failures =
                                item.failures + 1
                            item.copy(
                                state =
                                    if (failures >=
                                        5
                                    ) {
                                        "failed"
                                    } else {
                                        "pending"
                                    },
                                failures = failures,
                                retryAt =
                                    if (failures >=
                                        5
                                    ) {
                                        item.retryAt
                                    } else {
                                        op.now + minOf(30_000L, 1000L shl (failures.toInt() - 1))
                                    },
                            )
                        }
                    },
            )
        flush(op.now)
    }

    private fun retry(op: ClientSyncOperationRetry) {
        state =
            state.copy(
                outbox =
                    state.outbox.map {
                        if (it.conversationId == op.conversationId &&
                            it.body.clientMsgId == op.clientMsgId
                        ) {
                            it.copy(state = "pending", failures = 0, retryAt = op.now)
                        } else {
                            it
                        }
                    },
            )
        flush(op.now)
    }

    private fun rebuildState(op: ClientSyncOperationRebuildState) {
        require(rebuilding && start == null)
        start = op.latestUpdateSeq
        effects +=
            ClientSyncEffectSnapshot(startSeq = op.latestUpdateSeq)
    }

    private fun recall(update: UserUpdateMessageRecalled) {
        val d = update.data
        state =
            state.copy(
                recalled =
                    state.recalled.filter { it.messageId != d.messageId } + ClientSyncStateRecalledItem(d.messageId, d.recalledAt),
                messages =
                    state.messages.map { m ->
                        var next =
                            if (m.messageId ==
                                d.messageId
                            ) {
                                m.copy(content = null, status = "recalled", recalledAt = d.recalledAt)
                            } else {
                                m
                            }
                        val quote = next.quote
                        if (quote?.messageId == d.messageId)next = next.copy(quote = quote.copy(preview = null))
                        next
                    },
                conversations =
                    state.conversations.map { c ->
                        val preview = c.lastMessage
                        if (preview?.messageId ==
                            d.messageId
                        ) {
                            c.copy(lastMessage = preview.copy(text = "[消息已撤回]"))
                        } else {
                            c
                        }
                    },
            )
    }

    private fun hide(update: UserUpdateMessageHidden) {
        val d = update.data
        val old = state.messages.find { it.messageId == d.messageId }
        if (old !=
            null
        ) {
            state =
                state.copy(
                    excluded =
                        state.excluded +
                            ClientSyncStateExcludedItem(
                                d.conversationId,
                                ClientSyncStateExcludedItemRange(old.seq, old.seq, "hidden"),
                            ),
                )
        }
        state =
            state.copy(
                messages =
                    state.messages.filter { it.messageId != d.messageId }.map { m ->
                        val quote = m.quote
                        if (quote?.messageId ==
                            d.messageId
                        ) {
                            m.copy(quote = quote.copy(preview = null))
                        } else {
                            m
                        }
                    },
                conversations =
                    state.conversations.map {
                        if (it.lastMessage?.messageId ==
                            d.messageId
                        ) {
                            it.copy(lastMessage = null)
                        } else {
                            it
                        }
                    },
            )
    }

    private fun conversationState(update: UserUpdateConversationStateUpdated) {
        val data = update.data
        val conversation = state.conversations.find { it.conversationId == data.conversationId }
        if (conversation != null) {
            val cleaned = ClearedHistory.clean(state, conversation.copy(state = data.state, unreadCount = data.unreadCount))
            edit(cleaned)
            state = ClearedHistory.remove(state, data.conversationId, cleaned.state.clearedThroughSeq)
        }
    }

    private fun sanitizeRecall(input: Message): Message {
        var message = input
        val tombstone = state.recalled.find { it.messageId == message.messageId }
        if (tombstone != null)message = message.copy(status = "recalled", recalledAt = tombstone.recalledAt)
        if (message.status == "recalled") {
            message = message.copy(content = null)
            val time = message.recalledAt
            if (tombstone == null && time != null) {
                state =
                    state.copy(
                        recalled = state.recalled + ClientSyncStateRecalledItem(message.messageId, time),
                    )
            }
        }
        val quote = message.quote
        val recalledQuote =
            quote?.let { q ->
                state.messages.any { it.messageId == q.messageId && it.status == "recalled" } ||
                    state.recalled.any { it.messageId == q.messageId }
            } == true
        if (quote != null && recalledQuote) {
            message = message.copy(quote = quote.copy(preview = null))
        }
        return message
    }
}
