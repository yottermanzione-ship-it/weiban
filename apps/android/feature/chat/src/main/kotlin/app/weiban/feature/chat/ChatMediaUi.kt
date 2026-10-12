package app.weiban.feature.chat

import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.widget.Toast
import androidx.compose.runtime.*
import app.weiban.contracts.*
import app.weiban.data.AppUpdates
import app.weiban.data.SessionCallOptions
import app.weiban.data.uploadChatMedia
import app.weiban.network.ApiFailure
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import java.io.File
import java.util.UUID

/** 本机正在上传的一条图片 / 语音（上传完成后进入发送队列）。 */
@Suppress("LongParameterList") // 首次本机构建（2026-10-11）：保留既有逻辑，复杂度待重构
internal class LocalSend(
    val id: String,
    val kind: String,
    val bytes: ByteArray,
    val mimeType: String,
    val width: Int = 0,
    val height: Int = 0,
    val durationMs: Long = 0,
    val preview: Bitmap? = null,
) {
    var progress by mutableFloatStateOf(0f)
    var failed by mutableStateOf(false)
    var uploading by mutableStateOf(false)
}

/** 转文字块：shown 时显示；text = null 且 status = pending 显示「转换中…」。 */
internal data class TranscriptView(
    val shown: Boolean,
    val status: String,
    val text: String?,
)

/**
 * 聊天里的多媒体操作（T-074）：发图 / 发语音 / 发表情、转文字、添加到表情、收藏、保存。
 * 与 ConversationUi 同生命周期（一个会话一份）。
 */
@Suppress("TooManyFunctions") // 首次本机构建（2026-10-11）：保留既有逻辑，复杂度待重构
internal class ChatMediaUi(
    context: Context,
    private val ui: ConversationUi,
) {
    private val app = context.applicationContext
    private val repository = ui.repository
    private val owner = ui.owner
    private val scope = ui.scope
    val player = VoicePlayer(app, repository, owner, scope)
    val sends = mutableStateListOf<LocalSend>()
    val transcripts = mutableStateMapOf<String, TranscriptView>()
    private var recognitionNoticeShown = false
    private val myVoiceMedia = mutableSetOf<String>()

    /** 1 = 表情面板，2 = 「+」面板，0 = 都收起。 */
    var panel by mutableIntStateOf(0)
    var voiceMode by mutableStateOf(false)

    /** 正在全屏查看的图片消息。 */
    var viewing by mutableStateOf<String?>(null)

    init {
        player.onFailure = ::toast
    }

    fun toast(text: String) {
        Toast.makeText(app, text, Toast.LENGTH_SHORT).show()
    }

    private val options get() = SessionCallOptions(owner = owner)

    // ---------- 发送 ----------

    /** 选完立即发出，每张一条，按选择顺序（先全部显示本地图，再依次上传，保证顺序）。 */
    fun sendImages(uris: List<Uri>) {
        scope.launch {
            val items =
                uris.take(IMAGE_PICK_LIMIT).mapNotNull { uri ->
                    val prepared =
                        try {
                            prepareChatImage(app, uri)
                        } catch (error: CancellationException) {
                            throw error
                        } catch (_: java.io.IOException) {
                            null
                        } catch (_: OutOfMemoryError) {
                            null
                        } finally {
                            // 拍照的临时文件读完即删。
                            if (uri.scheme == "file") uri.path?.let { File(it).delete() }
                        }
                    if (prepared == null) {
                        toast("这张图片无法发送")
                        null
                    } else {
                        LocalSend(
                            UUID.randomUUID().toString(),
                            "image",
                            prepared.bytes,
                            prepared.mimeType,
                            prepared.width,
                            prepared.height,
                            preview = prepared.preview,
                        ).also { sends.add(it) }
                    }
                }
            items.forEach { upload(it) }
        }
    }

    fun sendVoice(
        file: File,
        durationMs: Long,
    ) {
        scope.launch {
            val bytes =
                try {
                    withContext(Dispatchers.IO) { consumeRecording(file) }
                } catch (_: java.io.IOException) {
                    toast("语音发送失败")
                    return@launch
                }
            val item = LocalSend(UUID.randomUUID().toString(), "voice", bytes, "audio/mp4", durationMs = durationMs)
            sends.add(item)
            upload(item)
        }
    }

    fun retry(item: LocalSend) {
        if (item.uploading) return
        item.failed = false
        scope.launch { upload(item) }
    }

    fun remove(item: LocalSend) {
        sends.remove(item)
    }

    @Suppress("TooGenericExceptionCaught") // Upload failures keep the bubble with a red mark for retry / delete.
    private suspend fun upload(item: LocalSend) {
        item.uploading = true
        item.progress = 0f
        try {
            val purpose = if (item.kind == "image") "chat_image" else "chat_voice"
            val media =
                uploadChatMedia(
                    repository,
                    owner,
                    item.bytes,
                    item.mimeType,
                    purpose,
                    durationMs = item.durationMs.takeIf { item.kind == "voice" },
                ) { fraction -> scope.launch(Dispatchers.Main) { item.progress = fraction } }
            val content: UserSendableContent =
                if (item.kind == "image") {
                    UserSendableContentImage(
                        mediaId = media.mediaId,
                        width = (media.width ?: item.width.toLong()),
                        height = (media.height ?: item.height.toLong()),
                    )
                } else {
                    myVoiceMedia += media.mediaId
                    UserSendableContentVoice(mediaId = media.mediaId, durationMs = item.durationMs, transcript = null)
                }
            ui.runtime.sendContent(owner, ui.conversation.conversationId, content, quoteFor())
            ui.quoteId = null
            sends.remove(item)
        } catch (error: CancellationException) {
            throw error
        } catch (error: ApiFailure) {
            item.failed = true
            if (error.code == "bad_request" || error.code == "payload_too_large") toast(if (item.kind == "image") "这张图片无法发送" else "语音发送失败")
        } catch (_: Exception) {
            item.failed = true
        } finally {
            item.uploading = false
        }
    }

    private fun quoteFor(): String? =
        ui.runtime.snapshot.value.state.messages
            .find { it.messageId == ui.quoteId && it.status == "normal" }
            ?.messageId

    fun sendSticker(
        stickerId: String,
        source: String,
        mediaId: String,
        description: String?,
    ) {
        panel = 0
        scope.launch {
            userAction({ ui.error = it }) {
                ui.runtime.sendContent(
                    owner,
                    ui.conversation.conversationId,
                    UserSendableContentSticker(stickerId = stickerId, source = source, mediaId = mediaId, description = description),
                    quoteFor(),
                )
                ui.quoteId = null
            }
        }
    }

    // ---------- 转文字 ----------

    /** 长按「转文字 / 隐藏文字」：角色语音直接显示原文；用户语音向服务器查询，并随 media.transcript_ready 更新。 */
    @Suppress("ReturnCount") // 首次本机构建（2026-10-11）：保留既有逻辑，复杂度待重构
    fun toggleTranscript(message: Message) {
        val content = message.content as? ReceivedMessageContentVoice ?: return
        val current = transcripts[message.messageId]
        if (current?.shown == true) {
            transcripts[message.messageId] = current.copy(shown = false)
            return
        }
        if (content.transcript != null) {
            transcripts[message.messageId] = TranscriptView(true, "ready", content.transcript)
            return
        }
        if (current != null && current.status != "pending") {
            transcripts[message.messageId] = current.copy(shown = true)
            return
        }
        transcripts[message.messageId] = TranscriptView(true, "pending", null)
        scope.launch {
            userAction({ transcripts[message.messageId] = TranscriptView(true, "failed", null) }) {
                val result =
                    repository.call(
                        Endpoints.mediaExtraEndpointsGetTranscript,
                        params = mapOf("mediaId" to content.mediaId),
                        options = SessionCallOptions(owner = owner, networkOnly = true),
                    )
                applyTranscript(message.messageId, result)
            }
        }
    }

    private fun applyTranscript(
        messageId: String,
        result: MediaTranscript,
    ) {
        val shown = transcripts[messageId]?.shown ?: false
        transcripts[messageId] = TranscriptView(shown, result.status, result.text)
    }

    /** 订阅转写结果：更新已展开的转写块；本会话第一次遇到「识别不可用」时提示一次。 */
    suspend fun watchTranscripts(messages: () -> List<Message>) {
        AppUpdates.updates.collect { update ->
            if (update !is UserUpdateMediaTranscriptReady) return@collect
            val transcript = update.data.transcript
            messages()
                .filter { (it.content as? ReceivedMessageContentVoice)?.mediaId == transcript.mediaId }
                .forEach { message -> if (transcripts.containsKey(message.messageId)) applyTranscript(message.messageId, transcript) }
            if (transcript.status == "unavailable" && transcript.mediaId in myVoiceMedia && !recognitionNoticeShown) {
                recognitionNoticeShown = true
                toast("当前无法识别语音")
            }
        }
    }

    // ---------- 长按菜单 ----------

    /** 「添加到表情」：409 已经添加过了；422 表情已满（media-l5.md 5.2）。 */
    fun addToStickers(message: Message) {
        if (!canAddToStickers(message)) return
        scope.launch {
            try {
                repository.call(
                    Endpoints.stickerEndpointsAddMySticker,
                    body =
                        buildJsonObject {
                            put("from", "message")
                            put("conversationId", message.conversationId)
                            put("messageId", message.messageId)
                        },
                    options = options,
                )
                toast("已添加")
            } catch (error: CancellationException) {
                throw error
            } catch (error: ApiFailure) {
                toast(
                    when (error.code) {
                        "conflict" -> "已经添加过了"
                        "limit_reached" -> "表情已满，先在 我 › 表情 里删除一些"
                        else -> "添加失败，请稍后再试"
                    },
                )
            } catch (_: java.io.IOException) {
                toast("添加失败，请稍后再试")
            }
        }
    }

    fun favorite(message: Message) {
        scope.launch {
            userAction({ toast("收藏失败，请稍后再试") }) {
                repository.call(
                    Endpoints.libraryEndpointsAddFavorites,
                    body =
                        buildJsonObject {
                            put(
                                "items",
                                buildJsonArray {
                                    add(
                                        buildJsonObject {
                                            put("kind", "message")
                                            put("conversationId", message.conversationId)
                                            put("messageId", message.messageId)
                                        },
                                    )
                                },
                            )
                        },
                    options = options,
                )
                toast("已收藏")
            }
        }
    }

    fun save(
        context: Context,
        mediaId: String,
    ) {
        scope.launch {
            toast(if (saveToGallery(context, repository, owner, mediaId)) "已保存到相册" else "保存失败，请稍后再试")
        }
    }

    fun release() {
        player.stop()
    }

    companion object {
        const val IMAGE_PICK_LIMIT = 9
    }
}
