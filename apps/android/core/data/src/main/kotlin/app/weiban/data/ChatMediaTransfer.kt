package app.weiban.data

import app.weiban.contracts.Endpoints
import app.weiban.contracts.MediaObject
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody
import okio.BufferedSink

private const val PROGRESS_CHUNK = 16 * 1024

/** 上传时按已写出的字节回报进度（0..1），供图片气泡上的百分比使用（media-l5.md 2.1）。 */
private class ProgressBody(
    private val bytes: ByteArray,
    private val type: MediaType,
    private val onProgress: (Float) -> Unit,
) : RequestBody() {
    override fun contentType(): MediaType = type

    override fun contentLength(): Long = bytes.size.toLong()

    override fun writeTo(sink: BufferedSink) {
        var written = 0
        while (written < bytes.size) {
            val count = minOf(PROGRESS_CHUNK, bytes.size - written)
            sink.write(bytes, written, count)
            written += count
            onProgress(written.toFloat() / bytes.size)
        }
    }
}

/**
 * L5 聊天媒体上传（T-074）：chat_image / chat_voice / user_sticker。
 * 语音必须带表单字段 durationMs（整数毫秒，T-069 交接）；文件名用 purpose（与网页一致）。
 */
suspend fun uploadChatMedia(
    repository: SessionRepository,
    owner: OwnerRecord,
    bytes: ByteArray,
    mimeType: String,
    purpose: String,
    durationMs: Long? = null,
    onProgress: (Float) -> Unit = {},
): MediaObject {
    require(purpose == "chat_image" || purpose == "chat_voice" || purpose == "user_sticker")
    val builder =
        MultipartBody
            .Builder()
            .setType(MultipartBody.FORM)
    durationMs?.let { builder.addFormDataPart("durationMs", it.toString()) }
    builder.addFormDataPart("file", purpose, ProgressBody(bytes, mimeType.toMediaType(), onProgress))
    return repository.call(
        Endpoints.mediaEndpointsUpload,
        query = mapOf("purpose" to purpose),
        multipart = builder.build(),
        options = SessionCallOptions(owner = owner, networkOnly = true),
    )
}

/** 取一个媒体的字节：thumbnail = 用缩略图链接（同一路径，只换令牌）；audio = 语音。 */
suspend fun downloadChatMedia(
    repository: SessionRepository,
    owner: OwnerRecord,
    mediaId: String,
    thumbnail: Boolean = false,
    audio: Boolean = false,
): ByteArray {
    val media =
        repository.call(
            Endpoints.mediaEndpointsGetMedia,
            params = mapOf("mediaId" to mediaId),
            options = SessionCallOptions(owner = owner, networkOnly = true),
        )
    val target = media.thumbnailUrl?.takeIf { thumbnail }?.let { media.copy(url = it) } ?: media
    return repository.download(target, owner, audio)
}
