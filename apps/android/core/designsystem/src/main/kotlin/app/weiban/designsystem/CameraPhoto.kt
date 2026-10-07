package app.weiban.designsystem

import android.content.Context
import android.net.Uri
import androidx.core.content.FileProvider
import java.io.File
import java.io.IOException

internal class CameraPhoto private constructor(
    val file: File,
    val uri: Uri,
) {
    fun discard() {
        file.delete()
    }

    companion object {
        fun create(context: Context): CameraPhoto {
            val directory = File(context.cacheDir, "avatar-camera")
            if (!directory.isDirectory && !directory.mkdirs()) throw IOException("Unable to create camera cache")
            val file = File.createTempFile("avatar-", ".jpg", directory)
            return try {
                CameraPhoto(file, FileProvider.getUriForFile(context, "${context.packageName}.avatar.camera", file))
            } catch (error: IllegalArgumentException) {
                file.delete()
                throw error
            }
        }
    }
}
