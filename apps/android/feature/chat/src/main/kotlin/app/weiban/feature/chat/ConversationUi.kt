package app.weiban.feature.chat

import androidx.compose.runtime.*
import app.weiban.contracts.*
import app.weiban.data.*
import kotlinx.coroutines.*

internal class ConversationUi(
    val repository: SessionRepository,
    val runtime: ChatRuntime,
    val owner: OwnerRecord,
    var conversation: Conversation,
    val scope: CoroutineScope,
    draft: MutableState<String>,
) {
    var text by draft
    var quoteId by mutableStateOf<String?>(null)
    var error by mutableStateOf<String?>(null)
    var sending by mutableStateOf(false)
    var loadingHistory by mutableStateOf(false)
    var openProfile: (ProfileTarget) -> Unit = {}
    var groupGreeting: String? = null
    var choosing by mutableStateOf(false)
    lateinit var media: ChatMediaUi

    /** 多选（T-085）：多选收藏、生成分享图。 */
    var selecting by mutableStateOf(false)
    val selected = mutableStateListOf<String>()

    /** 搜索 / 收藏定位后闪一下的那条消息 seq。 */
    var highlightSeq by mutableStateOf<Long?>(null)

    fun toggleSelected(messageId: String) {
        if (messageId in selected) selected.remove(messageId) else selected.add(messageId)
    }

    fun endSelection() {
        selecting = false
        selected.clear()
    }

    /** 多选收藏（CHAT-11）：一次最多 30 条。 */
    fun favoriteSelected(messages: List<Message>) {
        val chosen = messages.filter { it.messageId in selected }.take(SHARE_MAX_ITEMS)
        if (chosen.isEmpty()) return
        scope.launch {
            userAction({ media.toast("收藏失败，请稍后再试") }) {
                repository.call(
                    Endpoints.libraryEndpointsAddFavorites,
                    body =
                        kotlinx.serialization.json.buildJsonObject {
                            put(
                                "items",
                                kotlinx.serialization.json.JsonArray(
                                    chosen.map { message ->
                                        kotlinx.serialization.json.buildJsonObject {
                                            put("kind", kotlinx.serialization.json.JsonPrimitive("message"))
                                            put("conversationId", kotlinx.serialization.json.JsonPrimitive(message.conversationId))
                                            put("messageId", kotlinx.serialization.json.JsonPrimitive(message.messageId))
                                        }
                                    },
                                ),
                            )
                        },
                    options = SessionCallOptions(owner = owner),
                )
                media.toast("已收藏")
                endSelection()
            }
        }
    }

    /** 卡片按钮（ADR-0026）：只能点一次；结果经 message.updated 同步回来。 */
    fun choose(
        message: Message,
        actionId: String,
    ) {
        if (choosing) return
        choosing = true
        scope.launch {
            try {
                userAction({ error = it }) {
                    try {
                        repository.call(
                            Endpoints.chatActionEndpointsChooseMessageAction,
                            params = mapOf("conversationId" to message.conversationId, "messageId" to message.messageId),
                            body =
                                kotlinx.serialization.json.buildJsonObject {
                                    put(
                                        "actionId",
                                        kotlinx.serialization.json.JsonPrimitive(actionId),
                                    )
                                },
                            options = SessionCallOptions(owner = owner),
                        )
                    } catch (failure: app.weiban.network.ApiFailure) {
                        error = if (failure.code == "action_already_chosen") "已经选过了" else "操作暂未完成，请稍后再试"
                    }
                }
            } finally {
                choosing = false
            }
        }
    }

    /** 群聊 @：插入的「@名字」→ 参与者 ID（SOC-04 第 1 条）。发送时只保留仍在文字里的。 */
    var mentions by mutableStateOf<Map<String, String>>(emptyMap())

    fun mention(
        name: String,
        participantId: String,
    ) {
        val base = if (text.endsWith("@")) text.dropLast(1) else text
        text = (base + "@" + name + " ").take(4_000)
        mentions = mentions + (name to participantId)
    }

    fun send() {
        if (sending || text.isBlank()) return
        sending = true
        val captured = text
        val mentioned = mentions.filterKeys { captured.contains("@$it") }.values.distinct()
        val quotedId =
            runtime.snapshot.value.state.messages
                .find { it.messageId == quoteId && it.status == "normal" }
                ?.messageId
        scope.launch {
            try {
                userAction({ error = it }) {
                    runtime.send(owner, conversation.conversationId, captured, quotedId, mentioned)
                    if (text == captured) {
                        text = ""
                        mentions = emptyMap()
                    }
                    quoteId = null
                }
            } finally {
                sending = false
            }
        }
    }

    fun older(beforeSeq: Long) {
        loadingHistory = true
        scope.launch {
            try {
                userAction({ error = it }) { runtime.history.older(owner, conversation.conversationId, beforeSeq) }
            } finally {
                loadingHistory = false
            }
        }
    }

    fun retry(clientMsgId: String) {
        scope.launch {
            userAction({ error = it }) {
                runtime.retry(owner, conversation.conversationId, clientMsgId)
            }
        }
    }
}

/** 打开角色资料页：群里点头像带打招呼默认语；名片带推荐人（CHR-04 第 3 条）。 */
internal data class ProfileTarget(
    val characterId: String,
    val greeting: String? = null,
    val referrerCharacterId: String? = null,
)
