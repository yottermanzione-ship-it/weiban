package app.weiban.paymentmonitor

import android.os.SystemClock

/** Calibrate against the authenticated production HTTPS Date header, not a replayed receipt. */
object MonitorClock {
    private data class Sample(val offset: Long, val wall: Long, val elapsed: Long)
    @Volatile private var sample: Sample? = null
    fun observe(serverDate: Long, started: Long, finished: Long, wall: Long): Boolean {
        val roundTrip = finished - started
        if (serverDate <= 0 || roundTrip !in 0..4000) return false
        // HTTP Date has one-second precision. Bound RTT so this estimate stays inside 5s tolerance.
        sample = Sample(serverDate + 500 + roundTrip / 2 - wall, wall, finished)
        return true
    }
    fun offset(wall: Long = System.currentTimeMillis(), elapsed: Long = SystemClock.elapsedRealtime()): Long? {
        val s = sample ?: return null
        val age = elapsed - s.elapsed
        if (age !in 0..600_000 || kotlin.math.abs((wall - s.wall) - age) > 2000) return null
        return s.offset
    }
    fun nowMillis(): Long = System.currentTimeMillis() + (offset() ?: 0)
    internal fun reset() { sample = null }
}
