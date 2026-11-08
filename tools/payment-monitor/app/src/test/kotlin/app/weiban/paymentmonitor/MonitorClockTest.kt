package app.weiban.paymentmonitor

import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class MonitorClockTest {
    @Before fun setup() { MonitorClock.reset() }
    @Test fun correctsFastAndSlowPhoneClocksWithinReceiptTolerance() {
        for (skew in listOf(-60_000L, 60_000L)) {
            // Date rounded down from 100.5s; bounded response transit of 100ms.
            assertTrue(MonitorClock.observe(100_000, 1000, 1200, 100_600 + skew))
            assertEquals(-skew, MonitorClock.offset(100_600 + skew, 1200))
            assertEquals(-skew, MonitorClock.offset(101_600 + skew, 2200))
        }
    }
    @Test fun missingDateSlowResponseAndReversedTimeDoNotCalibrate() {
        assertFalse(MonitorClock.observe(0, 0, 200, 100_000))
        assertFalse(MonitorClock.observe(100_000, 0, 4001, 100_000))
        assertFalse(MonitorClock.observe(100_000, 200, 100, 100_000))
        assertNull(MonitorClock.offset(100_000, 200))
    }
    @Test fun oldSampleOrDeviceClockJumpMustBeRecalibrated() {
        assertTrue(MonitorClock.observe(100_000, 1000, 1200, 160_600))
        assertNull(MonitorClock.offset(160_600 + 600_001, 1200 + 600_001))
        assertNull(MonitorClock.offset(165_600, 2200))
        assertNull(MonitorClock.offset(160_600, 1199))
    }
}
