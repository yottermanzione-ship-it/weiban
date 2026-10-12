package app.weiban.feature.chat

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.os.Build
import androidx.compose.ui.graphics.toArgb
import app.weiban.contracts.*
import app.weiban.designsystem.tokens.WbColorSets
import app.weiban.designsystem.tokens.WbLineHeight
import app.weiban.designsystem.tokens.WbShare
import java.io.ByteArrayOutputStream
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sin

/*
 * 分享图原生绘制（share-templates.md 第 2～4 节；与网页 share-render.ts 同一份排版）。
 * 以 360 逻辑像素宽排版、放大 3 倍导出 1080 宽。四套模板固定浅色，不跟随用户主题；「聊天原样」固定用微伴粉浅色令牌。
 */

internal const val SHARE_WIDTH = 360f
private const val SHARE_SCALE = 3f
private const val MIN_HEIGHT = 480f
private const val MAX_HEIGHT = 6_000f
private const val PNG_LIMIT = 4 * 1024 * 1024

/** 原色板（tokens.json primitive.color；令牌生成物里没有原色，只在分享图里用到）。 */
private object Palette {
    const val PINK_50 = 0xFFFFF4F7.toInt()
    const val PINK_100 = 0xFFFFE6EE.toInt()
    const val PINK_200 = 0xFFFFD3E1.toInt()
    const val PINK_300 = 0xFFFFB3CA.toInt()
    const val PINK_400 = 0xFFF784A8.toInt()
    const val PINK_500 = 0xFFE0457B.toInt()
    const val PINK_600 = 0xFFC7346A.toInt()
    const val PINK_700 = 0xFFA32457.toInt()
    const val LILAC_100 = 0xFFF1EBFF.toInt()
    const val NEUTRAL_0 = 0xFFFFFFFF.toInt()
    const val NEUTRAL_25 = 0xFFFBF9FA.toInt()
    const val NEUTRAL_600 = 0xFF655F63.toInt()
    const val INK = 0xFF1F1A1D.toInt()
    const val GRAY_150 = 0xFFE5E5E5.toInt()
    const val GRAY_200 = 0xFFD9D9D9.toInt()
    const val GRAY_400 = 0xFFADADAD.toInt()
    const val WHITE_85 = 0xD9FFFFFF.toInt()
    const val PINK_200_30 = 0x4DFFD3E1
    const val SHADOW = 0x1A000000
}

internal class SharePerson(
    val name: String,
    val letters: String,
    val background: Int,
    val foreground: Int,
    val image: Bitmap?,
)

internal class ShareRenderItem(
    val mine: Boolean,
    val characterId: String?,
    val content: ReceivedMessageContent,
    val createdAt: String,
    /** 图片 / 表情的已加载图像；没加载出来为 null（画占位）。 */
    val image: Bitmap?,
)

@Suppress("LongParameterList") // 首次本机构建（2026-10-11）：保留既有逻辑，复杂度待重构
internal class ShareRenderCard(
    val title: String,
    val line: String,
    val serialNo: Long,
    val obtainedOn: String,
    val kind: String,
    val face: Bitmap?,
    val characterId: String,
)

@Suppress("LongParameterList") // 首次本机构建（2026-10-11）：保留既有逻辑，复杂度待重构
internal class ShareRenderInput(
    val template: String,
    val label: String,
    val items: List<ShareRenderItem>,
    val people: Map<String, SharePerson>,
    val me: SharePerson,
    val title: String,
    val group: Boolean,
    val daysKnown: Long?,
    val showTime: Boolean,
    val card: ShareRenderCard?,
)

/** 画笔：canvas = null 时只量尺寸不画。 */
private class Painter(
    val canvas: Canvas?,
) {
    val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    val dry get() = canvas == null

    fun font(
        size: Float,
        weight: Int = 400,
        serif: Boolean = false,
    ) {
        val family = if (serif) Typeface.SERIF else Typeface.SANS_SERIF
        paint.typeface =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                Typeface.create(family, weight, false)
            } else {
                Typeface.create(family, if (weight >= 600) Typeface.BOLD else Typeface.NORMAL)
            }
        paint.textSize = size
    }

    fun width(text: String): Float = paint.measureText(text)

    fun wrap(
        text: String,
        maxWidth: Float,
    ): List<String> {
        val lines = mutableListOf<String>()
        for (paragraph in text.split('\n')) {
            val line = StringBuilder()
            var index = 0
            while (index < paragraph.length) {
                val code = paragraph.codePointAt(index)
                val ch = String(Character.toChars(code))
                if (line.isNotEmpty() && width(line.toString() + ch) > maxWidth) {
                    lines += line.toString()
                    line.clear()
                }
                line.append(ch)
                index += Character.charCount(code)
            }
            lines += line.toString()
        }
        return lines
    }

    /** y 为文字顶部（与网页 textBaseline = top 一致）。 */
    fun text(
        text: String,
        x: Float,
        y: Float,
        color: Int,
        align: Paint.Align = Paint.Align.LEFT,
    ) {
        val c = canvas ?: return
        paint.style = Paint.Style.FILL
        paint.color = color
        paint.textAlign = align
        c.drawText(text, x, y - paint.fontMetrics.ascent, paint)
        paint.textAlign = Paint.Align.LEFT
    }

    @Suppress("LongParameterList") // Canvas round-rect with optional stroke, dash and shader.
    fun rect(
        x: Float,
        y: Float,
        w: Float,
        h: Float,
        radii: FloatArray,
        fill: Int?,
        stroke: Int? = null,
        lineWidth: Float = 1f,
        dashed: Boolean = false,
        shader: Shader? = null,
    ) {
        val c = canvas ?: return
        val corners = radii.flatMap { listOf(it, it) }.toFloatArray()
        val path = Path().apply { addRoundRect(RectF(x, y, x + w, y + h), corners, Path.Direction.CW) }
        if (fill != null || shader != null) {
            paint.style = Paint.Style.FILL
            paint.shader = shader
            paint.color = fill ?: Palette.NEUTRAL_0
            c.drawPath(path, paint)
            paint.shader = null
        }
        if (stroke != null) {
            paint.style = Paint.Style.STROKE
            paint.color = stroke
            paint.strokeWidth = lineWidth
            paint.pathEffect = if (dashed) android.graphics.DashPathEffect(floatArrayOf(3f, 3f), 0f) else null
            c.drawPath(path, paint)
            paint.pathEffect = null
            paint.style = Paint.Style.FILL
        }
    }

    @Suppress("LongParameterList") // Uniform-radius shorthand of the call above.
    fun rect(
        x: Float,
        y: Float,
        w: Float,
        h: Float,
        radius: Float,
        fill: Int?,
        stroke: Int? = null,
        lineWidth: Float = 1f,
        dashed: Boolean = false,
    ) = rect(x, y, w, h, floatArrayOf(radius, radius, radius, radius), fill, stroke, lineWidth, dashed)

    fun image(
        bitmap: Bitmap,
        x: Float,
        y: Float,
        w: Float,
        h: Float,
        radius: Float = 0f,
    ) {
        val c = canvas ?: return
        c.save()
        c.clipPath(Path().apply { addRoundRect(RectF(x, y, x + w, y + h), radius, radius, Path.Direction.CW) })
        // 居中裁剪铺满。
        val scale = max(w / bitmap.width, h / bitmap.height)
        val dw = bitmap.width * scale
        val dh = bitmap.height * scale
        val left = x + (w - dw) / 2
        val top = y + (h - dh) / 2
        // 画笔可能残留半透明颜色（顶部白色卡片），图片一律不透明绘制。
        paint.alpha = 255
        c.drawBitmap(bitmap, null, RectF(left, top, left + dw, top + dh), paint)
        c.restore()
    }

    fun avatar(
        person: SharePerson,
        x: Float,
        y: Float,
        size: Float,
        radiusRatio: Float = 0.12f,
    ) {
        val radius = size * radiusRatio
        rect(x, y, size, size, radius, person.background)
        val bitmap = person.image
        if (bitmap != null) {
            image(bitmap, x, y, size, size, radius)
        } else {
            font(size * if (person.letters.codePointCount(0, person.letters.length) == 1) 0.44f else 0.34f, 600)
            val c = canvas ?: return
            paint.color = person.foreground
            paint.textAlign = Paint.Align.CENTER
            val metrics = paint.fontMetrics
            c.drawText(person.letters, x + size / 2, y + size / 2 - (metrics.ascent + metrics.descent) / 2, paint)
            paint.textAlign = Paint.Align.LEFT
        }
    }

    fun star(
        cx: Float,
        cy: Float,
        r: Float,
        color: Int,
    ) {
        val c = canvas ?: return
        val path = Path()
        for (i in 0 until 10) {
            val radius = if (i % 2 == 0) r else r * 0.45f
            val angle = -PI / 2 + i * PI / 5
            val px = cx + radius * cos(angle).toFloat()
            val py = cy + radius * sin(angle).toFloat()
            if (i == 0) path.moveTo(px, py) else path.lineTo(px, py)
        }
        path.close()
        paint.style = Paint.Style.FILL
        paint.color = color
        c.drawPath(path, paint)
    }

    fun placeholder(
        x: Float,
        y: Float,
        w: Float,
        h: Float,
        radius: Float,
    ) {
        rect(x, y, w, h, radius, Palette.GRAY_150)
        star(x + w / 2, y + h / 2, 8f, Palette.GRAY_400)
    }
}

// ---------- 微伴贴纸（第 3 节） ----------

private const val STICKER_MAIN = "微伴AI聊天"
private const val STICKER_SUB = "非本人，请谨慎识别"

/** 微伴 logo（brand.md 第 7 节：对话气泡 + 星星），高 20。 */
private fun drawLogo(
    p: Painter,
    x: Float,
    y: Float,
    ink: Boolean,
) {
    val c = p.canvas ?: return
    val s = 20f / 98f
    val bubble = if (ink) WbShare.StickerInkText.toArgb() else WbShare.Logo.toArgb()
    val starColor = if (ink) WbShare.StickerInkBg.toArgb() else WbShare.StickerBg.toArgb()
    c.save()
    c.translate(x - 43 * s, y - 48 * s)
    c.scale(s, s)
    val path =
        Path().apply {
            moveTo(43f, 48f)
            lineTo(149f, 48f)
            lineTo(149f, 124f)
            lineTo(89f, 124f)
            lineTo(59f, 146f)
            lineTo(59f, 124f)
            lineTo(43f, 124f)
            close()
        }
    p.paint.style = Paint.Style.FILL
    p.paint.color = bubble
    c.drawPath(path, p.paint)
    c.restore()
    p.star(x + 54 * s, y + 38 * s, 22 * s, starColor)
}

private fun stickerSize(
    p: Painter,
    label: String,
): Pair<Float, Float> {
    val real = label == "weiban_not_real_person"
    p.font(14f, 700)
    val main = p.width(STICKER_MAIN)
    p.font(12f, 500)
    val sub = if (real) p.width(STICKER_SUB) else 0f
    val textHeight = if (real) 18f + 2f + 16f else 18f
    return (12f + 20f + 8f + max(main, sub) + 12f) to (8f + max(20f, textHeight) + 8f)
}

/** 画贴纸：anchorX / anchorY 为锚点（fromRight 时为右下角，否则左下角），angle 为角度。 */
@Suppress("LongParameterList") // Mirrors the web renderer's sticker signature one-to-one.
private fun drawSticker(
    p: Painter,
    label: String,
    anchorX: Float,
    anchorY: Float,
    fromRight: Boolean,
    ink: Boolean,
    pill: Boolean,
    angle: Float,
) {
    val (w, h) = stickerSize(p, label)
    val c = p.canvas ?: return
    val left = if (fromRight) anchorX - w else anchorX
    val top = anchorY - h
    c.save()
    c.translate(left + w / 2, top + h / 2)
    c.rotate(angle)
    c.translate(-w / 2, -h / 2)
    p.rect(
        0f,
        0f,
        w,
        h,
        if (pill) h / 2 else 12f,
        if (ink) WbShare.StickerInkBg.toArgb() else WbShare.StickerBg.toArgb(),
        if (ink) null else WbShare.StickerBorder.toArgb(),
        1.5f,
    )
    drawLogo(p, 12f, (h - 20f) / 2, ink)
    val real = label == "weiban_not_real_person"
    val textTop = if (real) 8f else (h - 18f) / 2
    p.font(14f, 700)
    p.text(STICKER_MAIN, 40f, textTop, if (ink) WbShare.StickerInkText.toArgb() else WbShare.StickerText.toArgb())
    if (real) {
        p.font(12f, 500)
        p.text(STICKER_SUB, 40f, textTop + 20f, if (ink) WbShare.StickerInkText.toArgb() else WbShare.StickerSubText.toArgb())
    }
    c.restore()
    // 贴纸外角的小星星（不压文字）。
    if (!ink) p.star(left + w + 2f, top - 2f, 4f, Palette.PINK_400)
}

// ---------- 工具 ----------

private fun seconds(ms: Long): String = "${max(1L, (ms + 500) / 1000)}″"

internal fun isPicture(content: ReceivedMessageContent): Boolean =
    content is ReceivedMessageContentImage || content is ReceivedMessageContentSticker

private fun pictureSize(
    item: ShareRenderItem,
    longSide: Float,
): Pair<Float, Float> {
    val content = item.content
    if (content is ReceivedMessageContentSticker) return 80f to 80f
    val width = ((content as? ReceivedMessageContentImage)?.width ?: item.image?.width?.toLong() ?: 4L).coerceAtLeast(1L).toFloat()
    val height = ((content as? ReceivedMessageContentImage)?.height ?: item.image?.height?.toLong() ?: 3L).coerceAtLeast(1L).toFloat()
    val scale = longSide / max(width, height)
    return (width * scale).roundToInt().toFloat() to (height * scale).roundToInt().toFloat()
}

private val zone: ZoneId get() = ZoneId.systemDefault()
private val dateFormat = DateTimeFormatter.ofPattern("yyyy.MM.dd")
private val timeFormat = DateTimeFormatter.ofPattern("HH:mm")
private val dayTimeFormat = DateTimeFormatter.ofPattern("M月d日 HH:mm")

private fun instant(iso: String): Instant = runCatching { Instant.parse(iso) }.getOrElse { Instant.now() }

private fun dateText(iso: String): String = dateFormat.format(instant(iso).atZone(zone))

private fun timeText(
    iso: String,
    previous: String? = null,
): String {
    val at = instant(iso).atZone(zone)
    if (previous != null && instant(previous).atZone(zone).toLocalDate() == at.toLocalDate()) return timeFormat.format(at)
    return dayTimeFormat.format(at)
}

private fun needsTime(
    item: ShareRenderItem,
    previous: ShareRenderItem?,
): Boolean = previous == null || instant(item.createdAt).toEpochMilli() - instant(previous.createdAt).toEpochMilli() > 5 * 60_000

private fun personOf(
    input: ShareRenderInput,
    item: ShareRenderItem,
): SharePerson = if (item.mine) input.me else input.people[item.characterId.orEmpty()] ?: input.me

// ---------- 气泡类模板（粉色滤镜、聊天原样） ----------

@Suppress("LongMethod", "CyclomaticComplexMethod", "NestedBlockDepth") // Same layout pass as the web renderer.
private fun bubbleTemplate(
    p: Painter,
    input: ShareRenderInput,
    height: Float,
    original: Boolean,
): Float {
    val w = SHARE_WIDTH
    val pink = WbColorSets.PinkLight
    val stickerHeight = stickerSize(p, input.label).second
    if (!p.dry) {
        if (original) {
            p.rect(0f, 0f, w, height, 0f, pink.bgChat.toArgb())
        } else {
            val gradient =
                LinearGradient(
                    0f,
                    0f,
                    0f,
                    height,
                    intArrayOf(Palette.PINK_50, Palette.PINK_100, Palette.LILAC_100),
                    floatArrayOf(0f, 0.5f, 1f),
                    Shader.TileMode.CLAMP,
                )
            p.rect(0f, 0f, w, height, floatArrayOf(0f, 0f, 0f, 0f), null, shader = gradient)
            // 稀疏小星星（最多 8 个，只在左右留白里）。
            for (i in 0 until 8) {
                val y = 110f + ((height - 200f) / 8f) * i + (i % 3) * 9f
                if (y > height - stickerHeight - 40f) break
                p.star(if (i % 2 == 1) w - 7f else 7f, y, 3f + (i % 2), Palette.PINK_400)
            }
        }
    }
    var y: Float
    val first = input.items.firstOrNull()
    if (original) {
        p.font(17f, 600)
        p.text(input.title, w / 2, 13f, Palette.INK, Paint.Align.CENTER)
        y = 56f
    } else {
        p.rect(16f, 16f, w - 32f, 72f, 16f, Palette.WHITE_85)
        val head = if (first != null) personOf(input, input.items.find { !it.mine } ?: first) else input.me
        p.avatar(head, 28f, 32f, 40f)
        p.font(17f, 600)
        p.text(input.title, 80f, 33f, Palette.INK)
        p.font(11f)
        val date = dateText(input.items.lastOrNull()?.createdAt ?: Instant.now().toString())
        p.text(input.daysKnown?.let { "认识第 $it 天 · $date" } ?: date, 80f, 58f, Palette.NEUTRAL_600)
        y = 104f
    }
    val avatar = if (original) 40f else 32f
    val radius = if (original) 6f else 14f
    val textMax = if (original) (w * 0.7f).roundToInt() - 24f else 224f
    input.items.forEachIndexed { index, item ->
        val previous = input.items.getOrNull(index - 1)
        if (input.showTime && needsTime(item, previous)) {
            p.font(11f)
            p.text(timeText(item.createdAt, previous?.createdAt), w / 2, y + 4f, Palette.NEUTRAL_600, Paint.Align.CENTER)
            y += 26f
        }
        val person = personOf(input, item)
        val avatarX = if (item.mine) w - 16f - avatar else 16f
        p.avatar(person, avatarX, y, avatar)
        var top = y
        if (input.group && !item.mine) {
            p.font(11f)
            p.text(person.name, avatarX + avatar + 8f, y, Palette.NEUTRAL_600)
            top += 16f
        }
        val edge = if (item.mine) avatarX - 8f else avatarX + avatar + 8f
        var blockHeight: Float
        if (isPicture(item.content)) {
            val (pw, ph) = pictureSize(item, 140f)
            val x = if (item.mine) edge - pw else edge
            val bitmap = item.image
            if (bitmap != null) {
                p.image(bitmap, x, top, pw, ph, if (original) 4f else 14f)
                if (!original && item.content is ReceivedMessageContentImage) p.rect(x, top, pw, ph, 14f, Palette.PINK_200_30)
            } else {
                p.placeholder(x, top, pw, ph, 4f)
            }
            blockHeight = ph
        } else {
            val voice = item.content as? ReceivedMessageContentVoice
            val body = if (voice != null) "▶ ${seconds(voice.durationMs)}" else contentText(item.content)
            p.font(15f)
            val lines = p.wrap(body, textMax)
            val lineHeight = (15f * WbLineHeight.Normal).roundToInt().toFloat()
            val bw = (lines.maxOfOrNull { p.width(it) } ?: 0f) + 24f
            val bh = lines.size * lineHeight + 20f
            val x = if (item.mine) edge - bw else edge
            val selfBg = if (original) pink.bubbleSelfBg.toArgb() else Palette.PINK_200
            val otherBg = if (original) pink.bubbleOtherBg.toArgb() else Palette.NEUTRAL_0
            val near = if (original) radius else 4f
            // 圆角顺序：左上、右上、右下、左下；靠头像的上角更小。
            val corners = if (item.mine) floatArrayOf(radius, near, radius, radius) else floatArrayOf(near, radius, radius, radius)
            p.rect(x, top, bw, bh, corners, if (item.mine) selfBg else otherBg, if (item.mine || original) null else Palette.PINK_200)
            if (original) drawTail(p, if (item.mine) x + bw else x, top, item.mine, if (item.mine) selfBg else otherBg)
            p.font(15f)
            lines.forEachIndexed { i, line -> p.text(line, x + 12f, top + 10f + i * lineHeight + (lineHeight - 15f) / 2, Palette.INK) }
            blockHeight = bh
            val transcript = voice?.transcript
            if (transcript != null) {
                p.font(13f)
                val tl = p.wrap(transcript, textMax)
                tl.forEachIndexed { i, line ->
                    p.text(line, edge, top + bh + 4f + i * 18f, Palette.NEUTRAL_600, if (item.mine) Paint.Align.RIGHT else Paint.Align.LEFT)
                }
                blockHeight += 4f + tl.size * 18f
            }
        }
        y = max(y + avatar, top + blockHeight) + 12f
    }
    return y + stickerHeight + 32f
}

/** 小尖角（components.md 4.1）。 */
private fun drawTail(
    p: Painter,
    tx: Float,
    top: Float,
    mine: Boolean,
    color: Int,
) {
    val c = p.canvas ?: return
    val tail = 6f
    val dir = if (mine) 1f else -1f
    val path =
        Path().apply {
            moveTo(tx, top + 12f)
            lineTo(tx + dir * tail, top + 12f + tail)
            lineTo(tx, top + 12f + tail * 2)
            close()
        }
    p.paint.style = Paint.Style.FILL
    p.paint.color = color
    c.drawPath(path, p.paint)
}

// ---------- 简洁白底 ----------

@Suppress("LongMethod", "CyclomaticComplexMethod") // Same layout pass as the web renderer.
private fun simpleTemplate(
    p: Painter,
    input: ShareRenderInput,
    height: Float,
): Float {
    val w = SHARE_WIDTH
    val stickerHeight = stickerSize(p, input.label).second
    p.rect(0f, 0f, w, height, 0f, Palette.NEUTRAL_0)
    p.star(24f, 24f, 8f, Palette.PINK_500)
    p.font(20f, 600)
    p.text("和 ${input.title} 的聊天", 16f, 40f, Palette.INK)
    p.font(11f)
    val from = input.items.firstOrNull()?.createdAt
    val to = input.items.lastOrNull()?.createdAt
    if (from != null && to != null) {
        val a = dateText(from)
        val b = dateText(to)
        p.text(if (a == b) a else "$a – $b", 16f, 70f, Palette.NEUTRAL_600)
    }
    p.rect(16f, 88f, w - 32f, 0.5f, 0f, Palette.GRAY_200)
    var y = 104f
    val lineHeight = (15f * WbLineHeight.Relaxed).roundToInt().toFloat()
    input.items.forEachIndexed { index, item ->
        val previous = input.items.getOrNull(index - 1)
        val sameSpeaker = previous != null && previous.mine == item.mine && previous.characterId == item.characterId
        if (!sameSpeaker) {
            if (index > 0) y += 14f
            val person = personOf(input, item)
            p.avatar(person, 16f, y, 20f)
            p.font(13f, 600)
            p.text(person.name, 44f, y + 2f, if (item.mine) Palette.PINK_700 else Palette.INK)
            if (input.showTime) {
                val nameWidth = p.width(person.name)
                p.font(11f)
                p.text(timeText(item.createdAt), 44f + nameWidth + 8f, y + 4f, Palette.NEUTRAL_600)
            }
            y += 26f
        } else if (input.showTime && needsTime(item, previous)) {
            p.font(11f)
            p.text(timeText(item.createdAt, previous?.createdAt), 44f, y, Palette.NEUTRAL_600)
            y += 18f
        }
        if (isPicture(item.content)) {
            val (pw, ph) = pictureSize(item, 120f)
            val bitmap = item.image
            if (bitmap != null) p.image(bitmap, 44f, y, pw, ph, 4f) else p.placeholder(44f, y, pw, ph, 4f)
            y += ph
        } else {
            p.font(15f)
            val lines = p.wrap(contentText(item.content), w - 44f - 16f)
            lines.forEachIndexed { i, line -> p.text(line, 44f, y + i * lineHeight + (lineHeight - 15f) / 2, Palette.INK) }
            y += lines.size * lineHeight
        }
        y += 6f
    }
    return y + stickerHeight + 32f
}

// ---------- 卡片风（固定 360×480） ----------

private fun cardColor(kind: String): Int {
    val mode = WbColorSets.ModeLight
    return when (kind) {
        "anniversary" -> mode.cardMemorial
        "familiarity" -> mode.cardFamiliarity
        "holiday" -> mode.cardFestival
        else -> mode.cardMoment
    }.toArgb()
}

@Suppress("LongMethod") // Same layout pass as the web renderer.
private fun cardTemplate(
    p: Painter,
    input: ShareRenderInput,
): Float {
    val w = SHARE_WIDTH
    p.rect(0f, 0f, w, MIN_HEIGHT, 0f, Palette.PINK_100)
    val paperX = 20f
    val paperY = 28f
    val paperW = 320f
    val paperH = 424f
    p.canvas?.let { c ->
        // 静态阴影（shadow.md 近似）。
        p.paint.setShadowLayer(12f, 0f, 4f, Palette.SHADOW)
        p.paint.style = Paint.Style.FILL
        p.paint.color = Palette.NEUTRAL_25
        c.drawRoundRect(RectF(paperX, paperY, paperX + paperW, paperY + paperH), 12f, 12f, p.paint)
        p.paint.clearShadowLayer()
    }
    val characterId = input.card?.characterId ?: input.items.find { !it.mine }?.characterId
    val person = characterId?.let { input.people[it] } ?: input.me
    // 邮票：头像 56 + 齿孔边框（素材到位前用虚线圆角框代替，7.5 节）。
    val stampX = paperX + paperW - 16f - 56f
    val stampY = paperY + 16f
    p.rect(stampX - 4f, stampY - 4f, 64f, 64f, 6f, Palette.NEUTRAL_0, Palette.PINK_300, 2f, dashed = true)
    p.avatar(person, stampX, stampY, 56f, 0.06f)
    // 邮戳：日期 + 认识第 N 天。
    val markR = 38f
    val markX = stampX - 12f - markR
    val markY = stampY + 28f
    p.canvas?.let { c ->
        p.paint.style = Paint.Style.STROKE
        p.paint.color = Palette.PINK_400
        p.paint.strokeWidth = 1.5f
        c.drawCircle(markX, markY, markR, p.paint)
        p.paint.style = Paint.Style.FILL
    }
    val markDate = input.card?.obtainedOn?.replace('-', '.') ?: dateText(input.items.lastOrNull()?.createdAt ?: Instant.now().toString())
    p.font(11f, 600)
    p.text(markDate, markX, markY - if (input.daysKnown != null) 14f else 6f, Palette.PINK_600, Paint.Align.CENTER)
    input.daysKnown?.let {
        p.font(11f)
        p.text("认识第${it}天", markX, markY + 2f, Palette.PINK_600, Paint.Align.CENTER)
    }
    val innerX = paperX + 16f
    val innerW = paperW - 32f
    val card = input.card
    if (card != null) {
        val faceY = paperY + 100f
        val faceH = (innerW * 2f / 3f).roundToInt().toFloat()
        val face = card.face
        if (face != null) {
            p.image(face, innerX, faceY, innerW, faceH, 8f)
        } else {
            p.rect(innerX, faceY, innerW, faceH, 8f, cardColor(card.kind))
            p.star(innerX + innerW / 2, faceY + faceH / 2, 18f, Palette.NEUTRAL_0)
        }
        p.font(17f, 400, serif = true)
        val lines = p.wrap(card.line.ifBlank { card.title }, innerW).take(2)
        lines.forEachIndexed { i, line -> p.text(line, w / 2, faceY + faceH + 16f + i * 30f, Palette.INK, Paint.Align.CENTER) }
        p.font(13f)
        p.text(
            "${serialText(card.serialNo)} · ${card.title}",
            w / 2,
            faceY + faceH + 16f + lines.size * 30f + 6f,
            Palette.NEUTRAL_600,
            Paint.Align.CENTER,
        )
    } else {
        val text =
            input.items
                .take(3)
                .joinToString("\n") { contentText(it.content) }
                .take(120)
        p.font(20f, 400, serif = true)
        val lineHeight = 36f
        val lines = p.wrap(text, innerW).take(7)
        val top = paperY + 100f + max(0f, (260f - lines.size * lineHeight) / 2)
        lines.forEachIndexed { i, line ->
            p.text(line, w / 2, top + i * lineHeight + (lineHeight - 20f) / 2, Palette.INK, Paint.Align.CENTER)
        }
        p.font(15f)
        p.text("— ${person.name}", paperX + paperW - 16f, paperY + 364f, Palette.INK, Paint.Align.RIGHT)
    }
    drawSticker(p, input.label, innerX, paperY + paperH - 16f, fromRight = false, ink = false, pill = true, angle = 0f)
    return MIN_HEIGHT
}

// ---------- 入口 ----------

private fun layout(
    p: Painter,
    input: ShareRenderInput,
    height: Float,
): Float =
    when (input.template) {
        "card_style" -> cardTemplate(p, input)
        "simple_white" -> simpleTemplate(p, input, height)
        "chat_original" -> bubbleTemplate(p, input, height, original = true)
        else -> bubbleTemplate(p, input, height, original = false)
    }

/** 卡片风内容上限（4.4）：最多 3 条、合计 120 字。 */
internal fun cardStyleOverflow(items: List<ShareRenderItem>): Boolean =
    items.size > 3 || items.sumOf { contentText(it.content).length } > 120

/** 绘制分享图（1080 宽）。调用方在后台线程调用；内存不足由调用方捕获。 */
internal fun renderShareImage(input: ShareRenderInput): Bitmap {
    val height = max(MIN_HEIGHT, layout(Painter(null), input, 0f)).coerceAtMost(MAX_HEIGHT)
    val bitmap = Bitmap.createBitmap((SHARE_WIDTH * SHARE_SCALE).toInt(), (height * SHARE_SCALE).toInt(), Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.scale(SHARE_SCALE, SHARE_SCALE)
    val painter = Painter(canvas)
    layout(painter, input, height)
    if (input.template != "card_style") {
        // 贴纸在右下角内容区下方的留白里，距右、距底 16（3.2）。
        val simple = input.template == "simple_white"
        drawSticker(painter, input.label, SHARE_WIDTH - 16f, height - 16f, fromRight = true, ink = simple, pill = !simple, angle = -4f)
    }
    return bitmap
}

/** 导出：PNG；超过 4MB 改 JPEG（质量 92）。返回字节与 MIME。 */
internal fun exportShareImage(bitmap: Bitmap): Pair<ByteArray, String> {
    val png = ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
    if (png.size <= PNG_LIMIT) return png to "image/png"
    val jpeg = ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.JPEG, 92, it) }.toByteArray()
    return jpeg to "image/jpeg"
}
