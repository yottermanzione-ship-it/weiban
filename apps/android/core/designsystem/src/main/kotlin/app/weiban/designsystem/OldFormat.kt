package app.weiban.designsystem

import java.math.BigDecimal
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.temporal.ChronoUnit
import java.util.Locale

/**
 * 旧版时间格式（规格 4.2、4.4.2；网页 features/time-format.ts）。
 * 时段：凌晨 0–6 / 上午 6–12 / 中午 12–13 / 下午 13–18 / 晚上 18–24；时段与数字之间无空格。
 */
object WbTime {
    private val weekdays = listOf("周一", "周二", "周三", "周四", "周五", "周六", "周日")

    private fun parse(iso: String): ZonedDateTime? = runCatching { Instant.parse(iso).atZone(ZoneId.systemDefault()) }.getOrNull()

    private fun period(date: ZonedDateTime): String {
        val h = date.hour
        val label =
            when {
                h < 6 -> "凌晨"
                h < 12 -> "上午"
                h < 13 -> "中午"
                h < 18 -> "下午"
                else -> "晚上"
            }
        val hour12 = if (h % 12 == 0) 12 else h % 12
        return "$label$hour12:%02d".format(Locale.ROOT, date.minute)
    }

    private fun days(
        date: ZonedDateTime,
        now: ZonedDateTime,
    ): Long = ChronoUnit.DAYS.between(date.toLocalDate(), now.toLocalDate())

    private fun dayText(date: ZonedDateTime): String = "${date.monthValue}月${date.dayOfMonth}日"

    /** 会话列表时间：刚刚 / 上午7:56 / 昨天 / 周一 / 6月1日。服务器时间晚于本机时按其时刻显示。 */
    fun list(
        iso: String,
        nowMillis: Long = System.currentTimeMillis(),
    ): String {
        val date = parse(iso) ?: return ""
        val now = Instant.ofEpochMilli(nowMillis).atZone(ZoneId.systemDefault())
        val diff = nowMillis - date.toInstant().toEpochMilli()
        if (diff in 0 until 60_000) return "刚刚"
        val d = days(date, now)
        return when {
            d <= 0 -> period(date)
            d == 1L -> "昨天"
            d < 7 -> weekdays[date.dayOfWeek.value - 1]
            else -> dayText(date)
        }
    }

    /** 聊天时间条：上午9:25 / 昨天 下午3:46 / 周一 上午9:25 / 6月1日 下午8:07。 */
    fun divider(
        iso: String,
        nowMillis: Long = System.currentTimeMillis(),
    ): String {
        val date = parse(iso) ?: return ""
        val now = Instant.ofEpochMilli(nowMillis).atZone(ZoneId.systemDefault())
        val d = days(date, now)
        return when {
            d <= 0 -> period(date)
            d == 1L -> "昨天 ${period(date)}"
            d < 7 -> "${weekdays[date.dayOfWeek.value - 1]} ${period(date)}"
            else -> "${dayText(date)} ${period(date)}"
        }
    }

    /** 相邻两条消息间隔超过 5 分钟才显示时间条。 */
    fun needsDivider(
        previous: String?,
        current: String,
    ): Boolean {
        if (previous == null) return true
        val a = runCatching { Instant.parse(previous).toEpochMilli() }.getOrNull() ?: return true
        val b = runCatching { Instant.parse(current).toEpochMilli() }.getOrNull() ?: return true
        return b - a > FIVE_MINUTES
    }

    /** 积分明细分组标题：10月4日（今年）/ 2025年10月4日。 */
    fun day(date: LocalDate): String =
        if (date.year == LocalDate.now().year) "${date.monthValue}月${date.dayOfMonth}日" else "${date.year}年${date.monthValue}月${date.dayOfMonth}日"

    /** 时分 08:05。 */
    fun clock(iso: String): String = parse(iso)?.let { "%02d:%02d".format(Locale.ROOT, it.hour, it.minute) }.orEmpty()

    private const val FIVE_MINUTES = 5 * 60_000L
}

/**
 * 积分显示（规格 6.1；网页 features/points.ts）：1 元 = 100 积分；界面只用接口下发的 *Points 字段，不自己换算。
 * 最多 2 位小数并去掉末尾 0；整数部分 ≥ 1,000 加千位逗号；0 < |n| < 0.01 显示「< 0.01」。消耗写「−0.89」（全角减号）。
 */
object WbPoints {
    private const val MINUS = "−"

    private fun formatter() = DecimalFormat("#,##0.##", DecimalFormatSymbols(Locale.US)).apply { roundingMode = RoundingMode.HALF_UP }

    fun format(value: Double?): String {
        if (value == null || value.isNaN()) return "—"
        val abs = kotlin.math.abs(value)
        if (abs > 0 && abs < 0.01) return if (value < 0) "$MINUS< 0.01" else "< 0.01"
        val text = formatter().format(BigDecimal.valueOf(abs))
        return if (value < 0 && text != "0") "$MINUS$text" else text
    }

    /** 带正负号：增加「+1,000」，消耗「−0.89」。 */
    fun signed(value: Double?): String = if (value != null && value > 0) "+${format(value)}" else format(value)

    /** 带单位：「1,234 积分」。 */
    fun text(value: Double?): String = "${format(value)} 积分"

    /** 元价（档位价格）：priceMicros ÷ 1,000,000，最多 2 位小数。 */
    fun yuan(micros: Long): String = "¥" + formatter().format(BigDecimal.valueOf(micros).divide(BigDecimal.valueOf(1_000_000L)))
}
