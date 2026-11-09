package app.weiban.shell

import android.system.OsConstants
import java.io.File
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.attribute.BasicFileAttributes
import java.security.MessageDigest

/** Real synthetic host files; Android's Linux stat syscall is not faithfully emulated on Windows. */
internal class LegacyMediaTestFiles : LegacyMediaFiles {
    override fun identity(file: File): LegacyMediaIdentity {
        val attrs = Files.readAttributes(file.toPath(), BasicFileAttributes::class.java, LinkOption.NOFOLLOW_LINKS)
        val mode =
            when {
                attrs.isSymbolicLink -> OsConstants.S_IFLNK
                attrs.isDirectory -> OsConstants.S_IFDIR
                attrs.isRegularFile -> OsConstants.S_IFREG
                else -> 0
            }
        // Windows may omit fileKey. Native inode replacement is covered by explicit metadata injection.
        val identityKey = attrs.fileKey()?.toString() ?: "${file.canonicalPath}:${attrs.creationTime().toMillis()}"
        val fileKey = identityKey.toByteArray()
        val inode = ByteBuffer.wrap(MessageDigest.getInstance("SHA-256").digest(fileKey)).long
        val modified = attrs.lastModifiedTime().toMillis()
        return LegacyMediaIdentity(mode, 1, inode, attrs.size(), modified, attrs.creationTime().toMillis(), 1, modified)
    }

    override fun open(file: File): LegacyMediaHandle {
        val before = identity(file)
        val stream = FileInputStream(file)
        return object : LegacyMediaHandle {
            override fun identity(): LegacyMediaIdentity {
                val after = this@LegacyMediaTestFiles.identity(file)
                return (if (after.inode == before.inode) after else before).copy(size = stream.channel.size())
            }

            override fun read(
                position: Long,
                bytes: ByteArray,
            ) {
                stream.channel.position(position)
                var read = 0
                while (read < bytes.size) {
                    val count = stream.read(bytes, read, bytes.size - read)
                    check(count > 0)
                    read += count
                }
            }

            override fun close() = stream.close()
        }
    }
}
