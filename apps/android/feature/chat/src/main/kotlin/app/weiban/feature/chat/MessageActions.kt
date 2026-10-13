package app.weiban.feature.chat

import app.weiban.contracts.*

/** 角色发来的表情 / 1MB 以内的图片可以「收藏到表情」。 */
internal fun canAddToStickers(message: Message): Boolean {
    if (message.senderKind != "character") return false
    return when (val content = message.content) {
        is ReceivedMessageContentSticker -> true
        is ReceivedMessageContentImage -> content.sizeBytes?.let { it < 1_048_576L } ?: true
        else -> false
    }
}
