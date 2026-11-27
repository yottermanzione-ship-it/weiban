package app.weiban.data

import app.weiban.contracts.*
import kotlinx.serialization.json.Json

internal object QuietOutbox {
    fun extend(
        queue: List<ClientPendingSend>,
        id: String,
        due: Long,
    ) = queue.map {
        if (it.conversationId == id && it.body.quietBatch == true &&
            it.state == "pending"
        ) {
            it.copy(retryAt = maxOf(it.retryAt, due))
        } else {
            it
        }
    }

    fun flush(
        queue: List<ClientPendingSend>,
        now: Long,
        json: Json,
        effects: MutableList<ClientSyncEffect>,
    ): List<ClientPendingSend> {
        val sending = mutableSetOf<String>()
        for ((id, items) in queue.groupBy { it.conversationId }) {
            val first = items.first()
            if (first.state != "pending" || first.retryAt > now) continue
            if (first.body.quietBatch == true) {
                val batch = readyBatch(items, now, json)
                effects +=
                    ClientSyncEffectSendBatch(
                        conversationId = id,
                        items = batch,
                        more = batch.size < items.size,
                        nextKey =
                            items
                                .getOrNull(batch.size)
                                ?.takeIf {
                                    it.body.quietBatch ==
                                        true &&
                                        it.state == "pending"
                                }?.body
                                ?.clientMsgId,
                    )
                batch.forEach { sending.add(it.clientMsgId) }
            } else {
                effects += ClientSyncEffectSend(conversationId = id, body = first.body)
                sending.add(first.body.clientMsgId)
            }
        }
        return queue.map { if (it.body.clientMsgId in sending) it.copy(state = "sending") else it }
    }

    private fun readyBatch(
        queue: List<ClientPendingSend>,
        now: Long,
        json: Json,
    ): List<SendMessageRequest> {
        val batch = mutableListOf<SendMessageRequest>()
        var size = 0
        val ready = queue.asSequence().take(100).takeWhile { it.body.quietBatch == true && it.state == "pending" && it.retryAt <= now }
        for (item in ready) {
            val bytes = json.encodeToString(SendMessageRequest.serializer(), item.body).length * 3
            if (batch.isNotEmpty() && size + bytes > 80_000) break
            batch.add(item.body)
            size += bytes
        }
        return batch
    }
}
