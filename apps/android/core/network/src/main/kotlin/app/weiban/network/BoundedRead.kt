package app.weiban.network

import java.io.ByteArrayOutputStream
import java.io.InputStream

/** Uses API26 methods; Java9 readNBytes is unavailable on older Android devices. */
internal fun InputStream.readBounded(limit: Int): ByteArray {
    val output = ByteArrayOutputStream()
    val buffer = ByteArray(8192)
    var left = limit
    while (left > 0) {
        val count = read(buffer, 0, minOf(left, buffer.size))
        if (count < 0) break
        if (count > 0) {
            output.write(buffer, 0, count)
            left -= count
        }
    }
    return output.toByteArray()
}
