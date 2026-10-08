package app.weiban.platform

import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class FirebaseRegistrationCallbacksTest {
    @Test fun replacementRejectsTheOldWaiterAndItsCleanupCannotEraseTheNewOne() =
        runBlocking {
            val old = FirebaseRegistrationCallbacks.begin()
            val current = FirebaseRegistrationCallbacks.begin()
            assertTrue(old.isCancelled)
            FirebaseRegistrationCallbacks.finish(old)
            assertTrue(FirebaseRegistrationCallbacks.complete("current-sdk-token"))
            assertEquals("current-sdk-token", current.await())
            FirebaseRegistrationCallbacks.finish(current)
        }

    @Test fun cancellationDoesNotRetainOrConsumeAnUnsolicitedRefresh() {
        val request = FirebaseRegistrationCallbacks.begin()
        FirebaseRegistrationCallbacks.finish(request)
        assertTrue(request.isCancelled)
        assertFalse(FirebaseRegistrationCallbacks.complete("late-sdk-token"))
    }
}
