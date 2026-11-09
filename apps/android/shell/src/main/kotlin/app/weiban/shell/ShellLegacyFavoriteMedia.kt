package app.weiban.shell

import android.content.Context
import android.os.Build
import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import android.system.StructStat
import android.util.Base64
import org.json.JSONObject
import java.io.Closeable
import java.io.File
import java.io.FileDescriptor
import java.io.FileInputStream
import java.net.URI
import java.security.MessageDigest
import java.util.Locale

internal data class LegacyMediaIdentity(
    val mode: Int,
    val device: Long,
    val inode: Long,
    val size: Long,
    val modified: Long,
    val changed: Long,
    val links: Long,
    val modifiedMillis: Long,
)

internal interface LegacyMediaHandle : Closeable {
    fun identity(): LegacyMediaIdentity

    fun read(
        position: Long,
        bytes: ByteArray,
    )
}

internal interface LegacyMediaFiles {
    fun identity(file: File): LegacyMediaIdentity

    fun open(file: File): LegacyMediaHandle
}

internal class AndroidLegacyMediaFiles(
    private val openDescriptor: (String, Int, Int) -> FileDescriptor = Os::open,
) : LegacyMediaFiles {
    override fun identity(file: File): LegacyMediaIdentity = identity(Os.lstat(file.path), file)

    override fun open(file: File): LegacyMediaHandle {
        val descriptor = openDescriptor(file.path, readOnlyFlags(), 0)
        val stream = FileInputStream(descriptor)
        return object : LegacyMediaHandle {
            override fun identity(): LegacyMediaIdentity = identity(Os.fstat(descriptor), file)

            override fun read(
                position: Long,
                bytes: ByteArray,
            ) {
                stream.channel.position(position)
                var done = 0
                while (done < bytes.size) {
                    val count = stream.read(bytes, done, bytes.size - done)
                    if (count <= 0) rejectLegacyFavorites("file_changed", retryable = true)
                    done += count
                }
            }

            override fun close() = stream.close()
        }
    }

    private fun identity(
        stat: StructStat,
        file: File,
    ): LegacyMediaIdentity =
        LegacyMediaIdentity(
            stat.st_mode,
            stat.st_dev,
            stat.st_ino,
            stat.st_size,
            stat.st_mtime,
            stat.st_ctime,
            stat.st_nlink,
            file.lastModified(),
        )

    private fun readOnlyFlags(): Int {
        // The public Java field starts at API 27, but Android N's Linux UAPI already defines
        // O_CLOEXEC as octal 02000000. Keep it in open(2), atomically with O_NOFOLLOW;
        // public Os.fcntlInt is API 30 and cannot serve as an API 24 fallback.
        // https://android.googlesource.com/platform/bionic/+/android-7.0.0_r1/libc/kernel/uapi/asm-generic/fcntl.h
        val closeOnExec = if (Build.VERSION.SDK_INT >= 27) OsConstants.O_CLOEXEC else ANDROID_N_CLOSE_ON_EXEC
        return OsConstants.O_RDONLY or OsConstants.O_NOFOLLOW or closeOnExec
    }

    companion object {
        private const val ANDROID_N_CLOSE_ON_EXEC = 0x80000
    }
}

internal data class LegacyMediaRange(
    val offset: Int,
    val limit: Int,
    val expectedHash: String?,
)

internal data class LegacyMediaManifest(
    val file: File,
    val identity: LegacyMediaIdentity,
    val mimeType: String,
    val sha256: String,
    val chunks: List<String>,
)

/** No path is accepted from JavaScript: the current authorized favorite supplies the only reference. */
internal class ShellLegacyFavoriteMedia(
    private val dataRoot: File,
    private val cacheRoots: List<File>,
    private val files: LegacyMediaFiles = AndroidLegacyMediaFiles(),
) {
    constructor(context: Context) : this(File(context.applicationInfo.dataDir), listOf(context.cacheDir, context.codeCacheDir))

    private val manifests = LinkedHashMap<String, LegacyMediaManifest>()

    @Volatile private var generation = 0L

    fun reset() {
        synchronized(manifests) {
            generation++
            manifests.clear()
        }
    }

    fun read(
        snapshot: LegacyFavoriteSnapshot,
        request: JSONObject,
    ): JSONObject =
        safeFileRead {
            val epoch = generation
            val item = findItem(snapshot, request)
            val range = range(request)
            val file = sourceFile(item)
            val key =
                request.getString("owner") + ":" + snapshot.digest + ":" + item.getString("accountKey") + ":" + item.getString("itemKey")
            val manifest = manifest(key, file, item, range, epoch)
            if (range.expectedHash != null && manifest.sha256 != range.expectedHash) rejectLegacyFavorites("file_changed", retryable = true)
            chunk(manifest, range.offset, range.limit).also {
                if (generation != epoch) rejectLegacyFavorites("changed", retryable = true)
            }
        }

    private fun range(request: JSONObject): LegacyMediaRange {
        val offset = request.opt("offset") as? Int ?: invalidCursor()
        val limit = request.opt("limit") as? Int ?: invalidCursor()
        if (offset < 0 || limit !in 1..CHUNK_BYTES) invalidCursor()
        val expected = request.opt("sha256").takeUnless { it == JSONObject.NULL }
        if (expected != null) {
            if (expected !is String) rejectLegacyFavorites("invalid_request")
            if (!LegacyFavoritesLimits.digest.matches(expected)) rejectLegacyFavorites("invalid_request")
        }
        if (offset > 0 && expected == null) rejectLegacyFavorites("invalid_request")
        return LegacyMediaRange(offset, limit, expected as? String)
    }

    private fun manifest(
        key: String,
        file: File,
        item: JSONObject,
        range: LegacyMediaRange,
        epoch: Long,
    ): LegacyMediaManifest {
        val pinned = synchronized(manifests) { manifests[key] }.takeUnless { range.offset == 0 && range.expectedHash == null }
        return pinned ?: fingerprint(file, item).also {
            synchronized(manifests) {
                if (generation != epoch) rejectLegacyFavorites("changed", retryable = true)
                if (manifests.size >= 64) manifests.remove(manifests.keys.first())
                manifests[key] = it
            }
        }
    }

    private fun safeFileRead(block: () -> JSONObject): JSONObject =
        try {
            block()
        } catch (error: ErrnoException) {
            // Translate only the errno; the original exception contains a private path.
            rejectLegacyFavorites(if (error.errno == OsConstants.ENOENT) "file_missing" else "path_rejected", blocked = true)
        } catch (_: java.io.IOException) {
            rejectLegacyFavorites("file_missing", blocked = true)
        }

    private fun findItem(
        snapshot: LegacyFavoriteSnapshot,
        request: JSONObject,
    ): JSONObject {
        if (request.optString("snapshotDigest") != snapshot.digest) rejectLegacyFavorites("snapshot_changed", retryable = true)
        val account = request.optString("accountKey")
        val item = request.optString("itemKey")
        if (!LegacyFavoritesLimits.accountKey.matches(account) || !LegacyFavoritesLimits.digest.matches(item)) {
            rejectLegacyFavorites("invalid_request")
        }
        val candidates = snapshot.items.filter { it.getString("accountKey") == account && it.getString("itemKey") == item }
        if (candidates.isEmpty()) rejectLegacyFavorites("media_unavailable", blocked = true)
        if (candidates.size != 1) rejectLegacyFavorites("item_ambiguous", blocked = true)
        return candidates.single()
    }

    private fun sourceFile(item: JSONObject): File {
        val message = item.getJSONObject("favorite").getJSONObject("message")
        val type = message.optString("type")
        val file = localFile(reference(message, type))
        requireAllowedRoot(file, type)
        return checked(file)
    }

    private fun reference(
        message: JSONObject,
        type: String,
    ): String {
        val field =
            when (type) {
                "image", "sticker" -> "imageUrl"
                "voice" -> "audioPath"
                else -> rejectLegacyFavorites("media_unavailable")
            }
        val reference = (message.opt(field) as? String)?.trim().orEmpty()
        if (reference.isEmpty()) rejectLegacyFavorites("media_unavailable", blocked = true)
        val lower = reference.lowercase(Locale.ROOT)
        if (listOf("http://", "https://", "/api/", "/generated/").any(lower::startsWith)) rejectLegacyFavorites("remote_reference")
        return reference
    }

    private fun localFile(reference: String): File {
        val value = if (reference.lowercase(Locale.ROOT).startsWith("file:")) fileUri(reference) else reference
        if (value.any { it.code < 32 } || value.split('/', '\\').any { it == ".." || it == "." }) rejected()
        val file = File(value)
        if (!file.isAbsolute) rejected()
        return file
    }

    private fun requireAllowedRoot(
        file: File,
        type: String,
    ) {
        val bucket = if (type == "voice") "voice_messages" else "chat_images"
        val persistent = File(dataRoot, "app_flutter/weiban_resources/$bucket")
        val recordingName = file.name.matches(Regex("weiban_voice_[0-9]+\\.(wav|m4a)"))
        val recording = type == "voice" && recordingName && cacheRoots.any { it.absoluteFile == file.parentFile?.absoluteFile }
        if (file.parentFile?.absoluteFile != persistent.absoluteFile && !recording) rejected()
    }

    private fun fileUri(reference: String): String {
        val uri = runCatching { URI(reference) }.getOrNull() ?: rejected()
        val hasExtra = uri.rawQuery != null || uri.rawFragment != null
        if (uri.scheme != "file" || !uri.rawAuthority.isNullOrEmpty() || hasExtra) rejected()
        return uri.path ?: rejected()
    }

    private fun checked(file: File): File {
        val root = dataRoot.absoluteFile
        if (!file.absolutePath.startsWith(root.path + File.separator)) rejected()
        val relative = file.absolutePath.removePrefix(root.path + File.separator)
        var current = root
        for (piece in relative.split(File.separatorChar)) {
            current = File(current, piece)
            val state = files.identity(current)
            if (OsConstants.S_ISLNK(state.mode) || (current != file && !OsConstants.S_ISDIR(state.mode))) rejected()
        }
        val realRoot = root.canonicalFile
        val real = file.canonicalFile
        if (!real.path.startsWith(realRoot.path + File.separator) || real != File(realRoot, relative)) rejected()
        val state = files.identity(file)
        if (!OsConstants.S_ISREG(state.mode) || state.links != 1L) rejected()
        return file
    }

    private fun fingerprint(
        file: File,
        item: JSONObject,
    ): LegacyMediaManifest {
        val before = files.identity(checked(file))
        if (before.size <= 0) rejectLegacyFavorites("unsupported_media", blocked = true)
        if (before.size > MAX_BYTES) rejectLegacyFavorites("media_too_large", blocked = true)
        val result =
            files.open(file).use { opened ->
                requireIdentity(before, opened.identity())
                scan(opened, file, item, before).also { requireIdentity(before, opened.identity()) }
            }
        requireIdentity(before, files.identity(checked(file)))
        return result
    }

    private fun scan(
        opened: LegacyMediaHandle,
        file: File,
        item: JSONObject,
        before: LegacyMediaIdentity,
    ): LegacyMediaManifest {
        val hash = MessageDigest.getInstance("SHA-256")
        val chunks = mutableListOf<String>()
        var mimeType = ""
        var offset = 0L
        while (offset < before.size) {
            val bytes = ByteArray(minOf(CHUNK_BYTES.toLong(), before.size - offset).toInt())
            try {
                opened.read(offset, bytes)
                if (offset == 0L) {
                    val voice = item.getJSONObject("favorite").getJSONObject("message").optString("type") == "voice"
                    mimeType = LegacyFavoriteMediaMime.detect(file.extension, voice, bytes)
                }
                hash.update(bytes)
                chunks.add(digest(bytes))
                offset += bytes.size
            } finally {
                bytes.fill(0)
            }
        }
        return LegacyMediaManifest(file, before, mimeType, hash.digest().hex(), chunks)
    }

    private fun chunk(
        manifest: LegacyMediaManifest,
        offset: Int,
        limit: Int,
    ): JSONObject {
        if (offset >= manifest.identity.size) invalidCursor()
        val current = files.identity(checked(manifest.file))
        requireIdentity(manifest.identity, current)
        val index = offset / CHUNK_BYTES
        val start = index.toLong() * CHUNK_BYTES
        val bytes = ByteArray(minOf(CHUNK_BYTES.toLong(), current.size - start).toInt())
        return try {
            files.open(manifest.file).use { opened ->
                requireIdentity(current, opened.identity())
                opened.read(start, bytes)
                requireIdentity(current, opened.identity())
            }
            if (digest(bytes) != manifest.chunks[index]) rejectLegacyFavorites("file_changed", retryable = true)
            requireIdentity(current, files.identity(checked(manifest.file)))
            val localOffset = offset % CHUNK_BYTES
            val length = minOf(limit, bytes.size - localOffset)
            val body = bytes.copyOfRange(localOffset, localOffset + length)
            try {
                JSONObject()
                    .put("mimeType", manifest.mimeType)
                    .put("bytes", current.size)
                    .put("sha256", manifest.sha256)
                    .put("offset", offset)
                    .put("nextOffset", if (offset + length < current.size) offset + length else JSONObject.NULL)
                    .put("base64", Base64.encodeToString(body, Base64.NO_WRAP))
            } finally {
                body.fill(0)
            }
        } finally {
            bytes.fill(0)
        }
    }

    private fun requireIdentity(
        expected: LegacyMediaIdentity,
        actual: LegacyMediaIdentity,
    ) {
        if (expected != actual) rejectLegacyFavorites("file_changed", retryable = true)
    }

    private fun digest(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).hex()

    private fun ByteArray.hex(): String = joinToString("") { "%02x".format(it.toInt() and 0xff) }

    private fun rejected(): Nothing = rejectLegacyFavorites("path_rejected", blocked = true)

    private fun invalidCursor(): Nothing = rejectLegacyFavorites("cursor_invalid")

    companion object {
        const val CHUNK_BYTES = 128 * 1024
        const val MAX_BYTES = 16 * 1024 * 1024
    }
}
