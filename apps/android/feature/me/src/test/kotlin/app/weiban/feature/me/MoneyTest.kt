package app.weiban.feature.me

import org.junit.Assert.*
import org.junit.Test

class MoneyTest {
    @Test fun preservesMicrosWithoutFloatingPointRounding() {
        assertEquals("5.000001", yuan(5_000_001))
        assertEquals("0.000001", yuan(1))
        assertEquals(5_000_001L, micros("5.000001"))
        assertEquals(9_007_199_254_740_991L, micros("9007199254.740991"))
    }

    @Test fun rejectsSubMicrosNegativeAndUnsafeValues() {
        for (value in listOf("0.0000001", "-1", "9007199254.740992", "not a price"))assertTrue(runCatching { micros(value) }.isFailure)
    }
}
