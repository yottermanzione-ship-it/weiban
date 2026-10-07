package app.weiban.feature.me

import java.math.BigDecimal
import java.math.RoundingMode

fun yuan(micros: Long): String = BigDecimal.valueOf(micros, 6).stripTrailingZeros().toPlainString()

fun micros(text: String): Long =
    BigDecimal(text).setScale(6, RoundingMode.UNNECESSARY).movePointRight(6).longValueExact().also {
        require(it >= 0 && it <= 9_007_199_254_740_991L)
    }
