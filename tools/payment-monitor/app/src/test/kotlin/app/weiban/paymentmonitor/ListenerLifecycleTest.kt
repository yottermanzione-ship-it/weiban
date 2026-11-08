package app.weiban.paymentmonitor

import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28, 35])
class ListenerLifecycleTest {
    @Test fun oldListenerCallbacksCannotDisconnectNewInstance() {
        val first = Robolectric.buildService(ReceiptListener::class.java).create()
        val second = Robolectric.buildService(ReceiptListener::class.java).create()
        try {
            first.get().onListenerConnected()
            second.get().onListenerConnected()
            first.get().onListenerDisconnected()
            assertTrue(ReceiptListener.connected)
            first.destroy()
            assertTrue(ReceiptListener.connected)
            second.get().onListenerDisconnected()
            assertFalse(ReceiptListener.connected)
        } finally { second.destroy() }
    }
    @Test fun disconnectThenManualScanDoesNotPretendToBeConnected() {
        val controller = Robolectric.buildService(ReceiptListener::class.java).create()
        try {
            controller.get().onListenerConnected()
            assertTrue(ReceiptListener.connected)
            controller.get().onListenerDisconnected()
            assertFalse(ReceiptListener.connected)
            ReceiptListener.scan(controller.get())
            assertFalse(ReceiptListener.connected)
            controller.get().onListenerConnected()
            assertTrue(ReceiptListener.connected)
        } finally { controller.destroy() }
        assertFalse(ReceiptListener.connected)
    }
}
