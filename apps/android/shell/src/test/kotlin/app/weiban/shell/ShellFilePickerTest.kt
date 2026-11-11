package app.weiban.shell

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.webkit.WebChromeClient
import androidx.activity.ComponentActivity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadows.ShadowToast

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], shadows = [WebViewFileResultShadow::class])
class ShellFilePickerTest {
    private val first = Uri.parse("content://test.gallery/first.jpg")
    private val second = Uri.parse("content://test.gallery/second.png")

    private class ImageRequest(
        private val multiple: Boolean,
    ) : WebChromeClient.FileChooserParams() {
        override fun getMode(): Int = if (multiple) MODE_OPEN_MULTIPLE else MODE_OPEN

        override fun getAcceptTypes(): Array<String> = arrayOf("image/*")

        override fun isCaptureEnabled(): Boolean = false

        override fun getTitle(): CharSequence? = null

        override fun getFilenameHint(): String? = null

        override fun createIntent(): Intent = Intent(Intent.ACTION_GET_CONTENT)
    }

    private fun deliver(
        intent: Intent,
        multiple: Boolean,
        currentPage: String = ShellPolicy.START_URL,
    ): List<Uri>? {
        val controller = Robolectric.buildActivity(ComponentActivity::class.java).create()
        val activity = controller.get()
        var page = ShellPolicy.START_URL
        val picker = ShellFilePicker(activity) { page }
        controller.start().resume()
        val values = mutableListOf<List<Uri>?>()
        try {
            assertTrue(picker.open({ values.add(it?.toList()) }, ImageRequest(multiple)))
            val request = shadowOf(activity).nextStartedActivityForResult
            assertEquals(multiple, request.intent.getBooleanExtra(Intent.EXTRA_ALLOW_MULTIPLE, false))
            page = currentPage
            assertTrue(activity.activityResultRegistry.dispatchResult(request.requestCode, Activity.RESULT_OK, intent))
            return values.single()
        } finally {
            controller.pause().stop().destroy()
        }
    }

    private fun selection(vararg images: Uri): ClipData =
        ClipData.newRawUri("Selected images", images.first()).apply {
            images.drop(1).forEach { addItem(ClipData.Item(it)) }
        }

    @Test
    fun returnsAllSelectedImagesWhenOnlyClipDataIsPresent() {
        assertEquals(listOf(first, second), deliver(Intent().apply { clipData = selection(first, second) }, true))
    }

    @Test
    fun acceptsClipDataForSingleImageSelection() {
        assertEquals(listOf(first), deliver(Intent().apply { clipData = selection(first, second) }, false))
    }

    @Test
    fun retainsSingleUriAndDeduplicatesTheList() {
        assertEquals(listOf(first), deliver(Intent().setData(first), false))
        assertEquals(
            listOf(first, second),
            deliver(Intent().setData(first).apply { clipData = selection(first, second) }, true),
        )
    }

    @Test
    fun explainsWhenNoReadableFileAddressWasReturned() {
        assertNull(deliver(Intent().setData(Uri.parse("file:///unusable.jpg")), false))
        assertEquals("无法读取所选文件，请重新选择", ShadowToast.getTextOfLatestToast())
    }

    @Test
    fun discardsSelectionAfterLeavingTheTrustedPage() {
        assertNull(deliver(Intent().apply { clipData = selection(first) }, false, "https://example.invalid/"))
    }
}

// Robolectric has no Chromium provider. Model its data-only parser for the regression case.
@Suppress("UtilityClassWithPublicConstructor")
@Implements(WebChromeClient.FileChooserParams::class)
class WebViewFileResultShadow {
    companion object {
        @JvmStatic
        @Implementation
        fun parseResult(
            resultCode: Int,
            intent: Intent?,
        ): Array<Uri>? = if (resultCode == Activity.RESULT_OK) intent?.data?.let { arrayOf(it) } else null
    }
}
