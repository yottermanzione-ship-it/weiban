@file:Suppress("TooManyFunctions")

package app.weiban.feature.chat

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.weiban.contracts.*
import app.weiban.data.OwnerRecord
import app.weiban.data.SessionRepository
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.tokens.WbMotion
import app.weiban.designsystem.tokens.WbRadius
import app.weiban.designsystem.tokens.WbSize
import app.weiban.designsystem.tokens.WbSpace

private val STICKER_EDGE = 120.dp
private val LINK_COVER = 48.dp
private const val THUMB_DECODE_EDGE = 720
private const val VOICE_BASE_WIDTH = 86
private const val VOICE_PER_SECOND = 4
private const val VOICE_MIN_WIDTH = 108
private const val VOICE_MAX_WIDTH = 220

/** 图片在聊天里的显示尺寸（规格 4.4.5）：按原图比例，最小 80、最大 150。 */
internal fun imageBox(
    width: Long?,
    height: Long?,
): Pair<Dp, Dp> {
    val max = WbSize.ImageMessageMax
    val w = (width ?: 0L).toFloat()
    val h = (height ?: 0L).toFloat()
    if (w <= 0f || h <= 0f) return max to max
    val ratio = (w / h).coerceIn(80f / 150f, 150f / 80f)
    return if (ratio >= 1f) max to max / ratio else max * ratio to max
}

/** 网络图片：占位色块 → 淡入；失败显示损坏标记，点一下重试（media-l5.md 2.2）。 */
@Composable internal fun ChatPicture(
    repository: SessionRepository,
    owner: OwnerRecord,
    mediaId: String,
    width: Dp,
    height: Dp,
    modifier: Modifier = Modifier,
    thumbnail: Boolean = true,
    contentScale: ContentScale = ContentScale.Crop,
) {
    val colors = LocalWeibanColors.current
    val state = rememberMediaBitmap(repository, owner, mediaId, thumbnail, THUMB_DECODE_EDGE)
    val opacity by animateFloatAsState(if (state.bitmap == null) 0f else 1f, tween(WbMotion.FastMs), label = "图片淡入")
    Box(
        modifier.size(width, height).clip(RoundedCornerShape(WbRadius.Md)).background(colors.bgSkeleton),
        contentAlignment = Alignment.Center,
    ) {
        val bitmap = state.bitmap
        when {
            bitmap != null ->
                Image(bitmap.asImageBitmap(), null, Modifier.fillMaxSize().alpha(opacity), contentScale = contentScale)
            state.failed ->
                Text(
                    "图片损坏\n点击重试",
                    Modifier.clickable(onClick = state::retry),
                    color = colors.textTertiary,
                    style = MaterialTheme.typography.bodySmall,
                )
        }
    }
}

@Composable internal fun ImageMessage(
    ui: ConversationUi,
    content: ReceivedMessageContentImage,
    modifier: Modifier,
) {
    val (w, h) = imageBox(content.width, content.height)
    ChatPicture(ui.repository, ui.owner, content.mediaId, w, h, modifier)
}

/** 表情包：无气泡、120 方块（C 4.2）；动图只显示第一帧（见 docs/android/media-l5.md 遗留）。 */
@Composable internal fun StickerMessage(
    repository: SessionRepository,
    owner: OwnerRecord,
    mediaId: String,
    modifier: Modifier = Modifier,
    edge: Dp = STICKER_EDGE,
) {
    ChatPicture(repository, owner, mediaId, edge, edge, modifier, thumbnail = false, contentScale = ContentScale.Fit)
}

/**
 * 语音气泡（规格 4.4.5）：气泡色同文字气泡，内距 14×9；宽 = 86 + 秒数（1–30）× 4，最小 108、最大 220；
 * 波纹 22×18 + 8 + 时长「5''」16/500；我发的波纹在右、时长在左并镜像；播放中 #1F7A32，出错 #E84040 + 「重试」。
 */
@Composable internal fun VoiceMessage(
    ui: ConversationUi,
    message: Message,
    content: ReceivedMessageContentVoice,
    modifier: Modifier = Modifier,
) {
    val colors = LocalWeibanColors.current
    val mode = app.weiban.designsystem.LocalWeibanModeColors.current
    val player = ui.media.player
    val mine = message.senderKind == "user"
    val playing = player.playingId == message.messageId
    val loading = player.loadingId == message.messageId
    val failed = player.failed[message.messageId] == true
    val unplayed = !mine && player.played[message.messageId] == false
    val seconds = ((content.durationMs + 500) / 1000).coerceIn(1, 60)
    val width = (VOICE_BASE_WIDTH + seconds.coerceAtMost(30) * VOICE_PER_SECOND).toInt().coerceIn(VOICE_MIN_WIDTH, VOICE_MAX_WIDTH).dp
    val tint =
        when {
            failed -> mode.uiVoiceError
            playing -> mode.uiVoicePlaying
            mine -> colors.bubbleSelfText
            else -> colors.textPrimary
        }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Bubble(mine, modifier.width(width), padding = PaddingValues(horizontal = 14.dp, vertical = 9.dp)) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val duration = "$seconds''"
                if (mine) {
                    if (loading) CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 1.5.dp)
                    Text(if (failed) "重试" else duration, style = app.weiban.designsystem.wbText(16.sp, 500, tint))
                    Spacer(Modifier.width(8.dp))
                    VoiceWaves(playing, tint, mirrored = true)
                } else {
                    VoiceWaves(playing, tint, mirrored = false)
                    Spacer(Modifier.width(8.dp))
                    Text(if (failed) "重试" else duration, style = app.weiban.designsystem.wbText(16.sp, 500, tint))
                    if (loading) {
                        Spacer(Modifier.width(4.dp))
                        CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 1.5.dp)
                    }
                }
            }
        }
        if (unplayed) {
            Spacer(Modifier.width(6.dp))
            Box(Modifier.size(8.dp).clip(CircleShape).background(colors.textDanger))
        }
    }
}

/** 链接卡片（C 4.2、media-l5.md 4.1）：标题、摘要、来源、封面；没有封面按音乐 / 视频 / 网页显示标记。 */
@Composable internal fun LinkCardMessage(
    repository: SessionRepository,
    owner: OwnerRecord,
    content: ReceivedMessageContentLink,
    modifier: Modifier = Modifier,
) {
    val colors = LocalWeibanColors.current
    Column(modifier.widthIn(max = 240.dp)) {
        Text(content.title, style = MaterialTheme.typography.titleSmall, maxLines = 2)
        Row(Modifier.padding(top = WbSpace.S2), verticalAlignment = Alignment.Top) {
            Text(
                content.description.orEmpty(),
                Modifier.weight(1f),
                color = colors.textSecondary,
                style = MaterialTheme.typography.bodySmall,
                maxLines = 3,
            )
            Spacer(Modifier.width(WbSpace.S3))
            val cover = content.coverMediaId
            if (cover != null) {
                ChatPicture(repository, owner, cover, LINK_COVER, LINK_COVER)
            } else {
                Box(Modifier.size(LINK_COVER).background(colors.bgPage), contentAlignment = Alignment.Center) {
                    Text(
                        when (content.appHint) {
                            "music" -> "♪"
                            "video" -> "▶"
                            else -> "↗"
                        },
                        color = colors.textSecondary,
                    )
                }
            }
        }
        HorizontalDivider(Modifier.padding(vertical = WbSpace.S2), color = colors.borderHairline)
        Text(
            content.source ?: linkPlatform(content.url)?.name ?: "网页",
            color = colors.textTertiary,
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

/** 通话记录文案（与网页 callRecordText 一致）。 */
internal fun callRecordText(content: ReceivedMessageContentCallRecord): String {
    val minutes = content.durationSec / 60
    val seconds = content.durationSec % 60
    return when (content.outcome) {
        "completed", "time_limit" -> "通话时长 %02d:%02d".format(minutes, seconds)
        "insufficient_balance" -> "余额不足，通话已结束"
        "missed", "declined" -> if (content.direction == "incoming") "未接来电" else "对方未接听"
        "cancelled" -> if (content.direction == "outgoing") "已取消" else "未接来电"
        "failed" -> "通话中断"
        else -> "语音通话"
    }
}

@Composable internal fun CallRecordMessage(content: ReceivedMessageContentCallRecord) {
    val text = callRecordText(content)
    Row(verticalAlignment = Alignment.CenterVertically) {
        app.weiban.designsystem.WbIcon(app.weiban.core.designsystem.R.drawable.wb_drawn_phone, 18.dp, LocalContentColor.current)
        Spacer(Modifier.width(8.dp))
        Text(text, style = app.weiban.designsystem.wbText(15.sp, 400, LocalContentColor.current))
    }
}

/** 文字里的链接可点（text.link），点开走唤起 App / 浏览器（media-l5.md 4.2）。 */
@Composable internal fun LinkifiedText(text: String) {
    val ranges = linkRanges(text)
    if (ranges.isEmpty()) {
        Text(text)
        return
    }
    val context = LocalContext.current
    val colors = LocalWeibanColors.current
    val styles = TextLinkStyles(SpanStyle(color = colors.textLink))
    val annotated =
        buildAnnotatedString {
            var cursor = 0
            ranges.forEach { range ->
                append(text.substring(cursor, range.first))
                val url = text.substring(range)
                withLink(LinkAnnotation.Clickable(url, styles) { openLink(context, url) }) { append(url) }
                cursor = range.last + 1
            }
            append(text.substring(cursor))
        }
    Text(annotated)
}

/** 本机正在上传的图片 / 语音：图片上叠遮罩 + 百分比；失败红色感叹号，点它选「重新发送 / 删除」。 */
@Composable internal fun LocalSendRow(
    ui: ConversationUi,
    item: LocalSend,
    avatars: MessageAvatars,
) {
    val colors = LocalWeibanColors.current
    var choosing by remember { mutableStateOf(false) }
    Row(
        Modifier.fillMaxWidth().padding(vertical = 6.dp),
        horizontalArrangement = Arrangement.End,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (item.failed) {
            SendStatus(true) { choosing = true }
        } else if (item.uploading && item.kind != "image") {
            SendStatus(false) {}
        }
        if (item.kind == "image") {
            val (w, h) = imageBox(item.width.toLong(), item.height.toLong())
            Box(
                Modifier.size(w, h).clip(RoundedCornerShape(WbRadius.Md)).background(colors.bgSkeleton),
                contentAlignment = Alignment.Center,
            ) {
                item.preview?.let { Image(it.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop) }
                if (item.uploading || item.failed) {
                    Box(Modifier.fillMaxSize().background(colors.bgScrim), contentAlignment = Alignment.Center) {
                        if (item.uploading) {
                            Text(
                                "${(item.progress * 100).toInt()}%",
                                color = colors.textOnBrand,
                                fontFamily = FontFamily.Monospace,
                                style = MaterialTheme.typography.titleSmall,
                            )
                        }
                    }
                }
            }
        } else {
            val seconds = ((item.durationMs + 500) / 1000).coerceIn(1, 60)
            val width = (VOICE_BASE_WIDTH + seconds.coerceAtMost(30) * VOICE_PER_SECOND).toInt().coerceIn(VOICE_MIN_WIDTH, VOICE_MAX_WIDTH).dp
            Bubble(true, Modifier.width(width), padding = PaddingValues(horizontal = 14.dp, vertical = 9.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
                    Text("$seconds''", style = app.weiban.designsystem.wbText(16.sp, 500, colors.bubbleSelfText))
                    Spacer(Modifier.width(8.dp))
                    VoiceWaves(false, colors.bubbleSelfText, mirrored = true)
                }
            }
        }
        Spacer(Modifier.width(6.dp))
        RoleAvatar(ui.repository, ui.owner, avatars.user, 40.dp, 4.dp)
    }
    if (choosing) {
        app.weiban.designsystem.ActionSheet(
            listOf(
                app.weiban.designsystem.SheetAction("重新发送") { ui.media.retry(item) },
                app.weiban.designsystem.SheetAction("删除", danger = true) { ui.media.remove(item) },
            ),
            if (item.kind == "image") "图片未发送" else "语音未发送",
        ) { choosing = false }
    }
}

/** 发送队列里还没确认的消息（文字以外的类型）。 */
@Composable internal fun PendingContent(
    ui: ConversationUi,
    content: UserSendableContent,
) {
    when (content) {
        is UserSendableContentText -> Text(content.text)
        is UserSendableContentImage -> {
            val (w, h) = imageBox(content.width, content.height)
            ChatPicture(ui.repository, ui.owner, content.mediaId, w, h)
        }
        is UserSendableContentSticker -> StickerMessage(ui.repository, ui.owner, content.mediaId, edge = 108.dp)
        is UserSendableContentVoice -> Text("${((content.durationMs + 500) / 1000).coerceIn(1, 60)}''")
        is UserSendableContentLink -> Text(content.title)
        else -> Text("拍了拍")
    }
}
