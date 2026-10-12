package app.weiban.designsystem

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import java.io.File
import java.io.IOException

/**
 * 把一张本地生成的图片交给系统分享面板（T-085 分享图）。
 * 文件写到缓存目录 share-images/，经 FileProvider 只授权接收方读取；旧文件每次分享前清掉。
 */
fun shareImage(
    context: Context,
    bytes: ByteArray,
    mimeType: String,
    title: String = "分享图片",
) {
    val directory = File(context.cacheDir, "share-images")
    if (!directory.isDirectory && !directory.mkdirs()) throw IOException("Unable to create share cache")
    directory.listFiles()?.forEach { it.delete() }
    val extension = if (mimeType == "image/jpeg") "jpg" else "png"
    val file = File(directory, "weiban-${System.currentTimeMillis()}.$extension")
    file.writeBytes(bytes)
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.avatar.camera", file)
    val send =
        Intent(Intent.ACTION_SEND).apply {
            type = mimeType
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    val chooser = Intent.createChooser(send, title)
    if (context !is android.app.Activity) chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(chooser)
}
