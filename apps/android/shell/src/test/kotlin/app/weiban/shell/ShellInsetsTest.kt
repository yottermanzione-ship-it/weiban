package app.weiban.shell

import android.view.ViewGroup
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [31])
class ShellInsetsTest {
    @Test
    fun nativePaddingIsAppliedOnceAndWebContentReceivesZeroesAfterKeyboardChanges() {
        val controller = Robolectric.buildActivity(ShellActivity::class.java).setup()
        try {
            val root = controller.get().findViewById<ViewGroup>(android.R.id.content).getChildAt(0)
            val bars = WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            for (keyboard in listOf(0, 320, 0)) {
                val insets =
                    WindowInsetsCompat
                        .Builder()
                        .setInsets(bars, Insets.of(0, 32, 0, 24))
                        .setInsets(WindowInsetsCompat.Type.ime(), Insets.of(0, 0, 0, keyboard))
                        .build()
                val forwarded = ViewCompat.dispatchApplyWindowInsets(root, insets)
                assertEquals(32, root.paddingTop)
                assertEquals(maxOf(24, keyboard), root.paddingBottom)
                assertEquals(Insets.NONE, forwarded.getInsets(bars or WindowInsetsCompat.Type.ime()))
            }
        } finally {
            controller.pause().stop().destroy()
        }
    }
}
