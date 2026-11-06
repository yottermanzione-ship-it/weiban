package app.weiban.shell

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts

internal class ShellFilePicker(
    private val activity: ComponentActivity,
    private val currentUrl: () -> String?,
) {
    private var callback: ValueCallback<Array<Uri>>? = null
    private var multiple = false
    private val launcher =
        activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val pending = callback
            callback = null
            val selected =
                if (result.resultCode == Activity.RESULT_OK && ShellPolicy.trusted(currentUrl())) {
                    WebChromeClient.FileChooserParams
                        .parseResult(result.resultCode, result.data)
                        ?.filter { it.scheme == "content" }
                        ?.take(if (multiple) 10 else 1)
                        ?.toTypedArray()
                } else {
                    null
                }
            pending?.onReceiveValue(selected?.takeIf { it.isNotEmpty() })
        }

    fun open(
        result: ValueCallback<Array<Uri>>,
        params: WebChromeClient.FileChooserParams,
    ): Boolean {
        cancel()
        if (!ShellPolicy.trusted(currentUrl())) {
            result.onReceiveValue(null)
            return true
        }
        callback = result
        multiple = params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE
        val types = params.acceptTypes.filter { it.matches(Regex("[a-zA-Z0-9.+-]+/[a-zA-Z0-9.+*-]+")) }
        val intent =
            Intent(Intent.ACTION_GET_CONTENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = types.singleOrNull() ?: "*/*"
                if (types.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, types.toTypedArray())
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
        try {
            launcher.launch(intent)
        } catch (_: ActivityNotFoundException) {
            cancel()
            Toast.makeText(activity, "手机没有可用的文件选择器", Toast.LENGTH_LONG).show()
        }
        return true
    }

    fun cancel() {
        callback?.onReceiveValue(null)
        callback = null
    }
}
