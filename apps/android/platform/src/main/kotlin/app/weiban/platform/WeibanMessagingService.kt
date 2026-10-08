package app.weiban.platform

import android.content.Intent
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking

/** Never allow Firebase's pre-callback notification display to bypass account ownership checks. */
class WeibanMessagingService : FirebaseMessagingService() {
    override fun handleIntent(intent: Intent) {
        val extras = intent.extras
        if (intent.action in listOf("com.google.android.c2dm.intent.RECEIVE", "com.google.firebase.messaging.RECEIVE_DIRECT_BOOT")) {
            if (extras?.getString("weiban").isNullOrEmpty() || (application as? NativePushHost)?.push?.available != true) return
            val safe = Intent(intent)
            for (key in extras!!.keySet()) {
                if (key.startsWith("gcm.n.") || key.startsWith("gcm.notification.")) safe.removeExtra(key)
            }
            super.handleIntent(safe)
        } else {
            super.handleIntent(intent)
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val raw = message.data["weiban"] ?: return
        val host = application as? NativePushHost ?: return
        // Local restore and bounded inbox persistence only; all HTTP work runs in WorkManager.
        runBlocking(Dispatchers.IO) {
            host.prepareNativePush()
            host.push.receive(raw)
        }
    }

    override fun onRegistered(token: String) {
        if (FirebaseRegistrationCallbacks.complete(token)) return
        val host = application as? NativePushHost ?: return
        runBlocking(Dispatchers.IO) {
            host.prepareNativePush()
            // An unsolicited refresh triggers owned registration; no callback token enters persistent job data.
            host.push.rebind()
        }
    }
}
