package app.weiban.shell

import android.content.Context
import android.system.OsConstants
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File
import java.security.MessageDigest

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 31])
class ShellLegacyFavoriteMediaTest {
    private lateinit var context: Context
    private lateinit var root: File
    private lateinit var reader: ShellLegacyFavoriteMedia
    private val created = mutableListOf<File>()
    private val user = "019b0000-0000-7000-8000-000000000001"
    private val owner = "$user:019b0000-0000-7000-8000-000000000002"
    private var serial = 0

    @Before fun setup() {
        context = RuntimeEnvironment.getApplication()
        root = File(context.applicationInfo.dataDir)
        reader = ShellLegacyFavoriteMedia(root, listOf(context.cacheDir, context.codeCacheDir), LegacyMediaTestFiles())
    }

    @After fun cleanup() {
        reader.reset()
        for (file in created) {
            check(file.absolutePath.startsWith(root.absolutePath + File.separator))
            file.delete()
        }
    }

    private fun png(size: Int = 300000): ByteArray {
        val original =
            Base64.decode(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
                Base64.DEFAULT,
            )
        return original + ByteArray(size - original.size) { (it % 251).toByte() }
    }

    private fun source(
        bytes: ByteArray = png(),
        bucket: String = "chat_images",
        suffix: String = "png",
    ): File {
        val file = File(root, "app_flutter/weiban_resources/$bucket/1794182400000_${(++serial).toString(16).padStart(8, '0')}.$suffix")
        file.parentFile!!.mkdirs()
        file.writeBytes(bytes)
        created.add(file)
        return file
    }

    private fun snapshot(
        reference: String,
        type: String = "image",
    ): LegacyFavoriteSnapshot {
        val message =
            JSONObject()
                .put("type", type)
                .put("timestamp", 1000)
                .put("content", "合成媒体快照")
                .put(if (type == "voice") "audioPath" else "imageUrl", reference)
        val favorite =
            JSONObject()
                .put("chatKey", "合成会话")
                .put("chatTitle", "合成会话")
                .put("savedAt", 2000)
                .put("message", message)
        val raw = JSONArray().put(favorite).toString()
        val preferences = context.getSharedPreferences("FlutterSharedPreferences", Context.MODE_PRIVATE)
        preferences.edit().putString("flutter.favorite_messages_fixture1", raw).commit()
        return ShellLegacyFavoritesStore(context).snapshot(user, listOf("fixture1"))
    }

    private fun request(
        snapshot: LegacyFavoriteSnapshot,
        offset: Int = 0,
        sha: String? = null,
        limit: Int = 131072,
    ): JSONObject =
        JSONObject()
            .put("v", 1)
            .put("id", "media-test")
            .put("type", "media")
            .put("owner", owner)
            .put("accountKey", "fixture1")
            .put("itemKey", snapshot.items.single().getString("itemKey"))
            .put("snapshotDigest", snapshot.digest)
            .put("offset", offset)
            .put("limit", limit)
            .put("sha256", sha ?: JSONObject.NULL)

    private fun hash(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") {
            "%02x".format(it.toInt() and 255)
        }

    private fun failure(
        expected: String,
        block: () -> Unit,
    ) {
        assertEquals(expected, assertThrows(LegacyFavoritesFailure::class.java, block).reason)
    }

    @Test fun exactFavoriteReferenceTransfersBoundedChunksWithOneStableWholeFileHash() {
        val bytes = png()
        val file = source(bytes)
        val snapshot = snapshot(file.path)
        val first = reader.read(snapshot, request(snapshot).put("path", File(root, "shared_prefs/FlutterSharedPreferences.xml").path))
        assertEquals("image/png", first.getString("mimeType"))
        assertEquals(bytes.size, first.getInt("bytes"))
        assertEquals(hash(bytes), first.getString("sha256"))
        assertEquals(131072, first.getInt("nextOffset"))
        val restored = mutableListOf<Byte>()
        var page = first
        while (true) {
            val block = Base64.decode(page.getString("base64"), Base64.NO_WRAP)
            assertTrue(block.size <= ShellLegacyFavoriteMedia.CHUNK_BYTES)
            restored.addAll(block.toList())
            if (page.isNull("nextOffset")) break
            page = reader.read(snapshot, request(snapshot, page.getInt("nextOffset"), first.getString("sha256")))
        }
        assertArrayEquals(bytes, restored.toByteArray())
        assertArrayEquals(bytes, file.readBytes())
    }

    @Test fun unknownAccountOrItemAndWrongSnapshotNeverAuthorizeAFile() {
        val snapshot = snapshot(source().path)
        failure("media_unavailable") { reader.read(snapshot, request(snapshot).put("accountKey", "other9")) }
        failure("media_unavailable") { reader.read(snapshot, request(snapshot).put("itemKey", "0".repeat(64))) }
        failure("snapshot_changed") { reader.read(snapshot, request(snapshot).put("snapshotDigest", "0".repeat(64))) }
        val duplicate = snapshot.copy(items = snapshot.items + snapshot.items)
        failure("item_ambiguous") { reader.read(duplicate, request(snapshot)) }
    }

    @Test fun remoteAndMissingReferencesReturnExplicitNonContentResults() {
        val remote = snapshot("https://old.example/private-media.png")
        failure("remote_reference") { reader.read(remote, request(remote)) }
        val missing = source()
        assertTrue(missing.delete())
        val snapshot = snapshot(missing.path)
        failure("file_missing") { reader.read(snapshot, request(snapshot)) }
        val none = snapshot("", "voice")
        failure("media_unavailable") { reader.read(none, request(none)) }
    }

    @Test fun traversalPreferencesAndOtherBucketsAreNeverReadEvenWhenInsideAFavorite() {
        val prefs = File(root, "shared_prefs/FlutterSharedPreferences.xml")
        for (reference in listOf(
            prefs.path,
            File(root, "app_flutter/weiban_resources/avatars/secret.png").path,
            File(root, "app_flutter/weiban_resources/chat_images/../secret.png").path,
            "content://private/secret",
        )) {
            val snapshot = snapshot(reference)
            failure("path_rejected") { reader.read(snapshot, request(snapshot)) }
        }
    }

    @Test fun incorrectMimeOversizedFilesAndInvalidByteRangesAreRejected() {
        val wrong = snapshot(source(ByteArray(500) { 6 }).path)
        failure("unsupported_media") { reader.read(wrong, request(wrong)) }
        val oversized = source()
        java.io.RandomAccessFile(oversized, "rw").use { it.setLength(ShellLegacyFavoriteMedia.MAX_BYTES.toLong() + 1) }
        val large = snapshot(oversized.path)
        failure("media_too_large") { reader.read(large, request(large)) }
        val good = snapshot(source().path)
        failure("cursor_invalid") { reader.read(good, request(good, limit = 131073)) }
        failure("invalid_request") { reader.read(good, request(good, offset = 1)) }
        failure("cursor_invalid") { reader.read(good, request(good, offset = -1)) }
    }

    @Test fun fileMutationCannotMixNewBytesIntoAPreviousStream() {
        val file = source()
        val snapshot = snapshot(file.path)
        val first = reader.read(snapshot, request(snapshot))
        val bytes = file.readBytes()
        bytes[150000] = (bytes[150000].toInt() xor 255).toByte()
        file.writeBytes(bytes)
        failure("file_changed") { reader.read(snapshot, request(snapshot, 131072, first.getString("sha256"))) }
        val restarted = reader.read(snapshot, request(snapshot))
        assertNotEquals(first.getString("sha256"), restarted.getString("sha256"))
    }

    @Test fun chunkHashesDetectMutationEvenWhenAllReportedMetadataStaysConstant() {
        val target = source()
        val snapshot = snapshot(target.path)
        val actual = LegacyMediaTestFiles()
        val frozen = actual.identity(target)
        var replaced = false

        fun pinned() = if (replaced) frozen.copy(inode = frozen.inode + 1) else frozen
        val frozenFiles =
            object : LegacyMediaFiles by actual {
                override fun identity(file: File): LegacyMediaIdentity = if (file == target) pinned() else actual.identity(file)

                override fun open(file: File): LegacyMediaHandle {
                    val handle = actual.open(file)
                    return object : LegacyMediaHandle by handle {
                        override fun identity(): LegacyMediaIdentity = pinned()
                    }
                }
            }
        val guarded = ShellLegacyFavoriteMedia(root, listOf(context.cacheDir, context.codeCacheDir), frozenFiles)
        val first = guarded.read(snapshot, request(snapshot))
        replaced = true
        failure("file_changed") { guarded.read(snapshot, request(snapshot, 131072, first.getString("sha256"))) }
        replaced = false
        val bytes = target.readBytes()
        bytes[150000] = (bytes[150000].toInt() xor 255).toByte()
        target.writeBytes(bytes)
        failure("file_changed") { guarded.read(snapshot, request(snapshot, 131072, first.getString("sha256"))) }
    }

    @Test fun symlinkOrHardlinkMetadataIsRefusedBeforeOpeningMedia() {
        val file = source()
        val snapshot = snapshot(file.path)
        val actual = LegacyMediaTestFiles()
        val linkedFile = file
        for (symbolic in listOf(true, false)) {
            val files =
                object : LegacyMediaFiles by actual {
                    override fun identity(file: File): LegacyMediaIdentity {
                        val real = actual.identity(file)
                        return if (file ==
                            linkedFile
                        ) {
                            real.copy(mode = if (symbolic) OsConstants.S_IFLNK else real.mode, links = if (symbolic) 1L else 2L)
                        } else {
                            real
                        }
                    }

                    override fun open(file: File): LegacyMediaHandle = error("LINKED_FILE_MUST_NOT_BE_OPENED")
                }
            val guarded = ShellLegacyFavoriteMedia(root, listOf(context.cacheDir, context.codeCacheDir), files)
            failure("path_rejected") { guarded.read(snapshot, request(snapshot)) }
        }
    }

    @Test fun voiceReadsOnlyExplicitRecordingFilesOrTheVoiceBucket() {
        val bytes = ByteArray(256)
        "RIFF".toByteArray().copyInto(bytes)
        "WAVE".toByteArray().copyInto(bytes, 8)
        val persistent = source(bytes, "voice_messages", "wav")
        val saved = snapshot(persistent.path, "voice")
        assertEquals("audio/wav", reader.read(saved, request(saved)).getString("mimeType"))
        val recording = File(context.cacheDir, "weiban_voice_1794182400000.wav")
        recording.parentFile!!.mkdirs()
        recording.writeBytes(bytes)
        created.add(recording)
        val temporary = snapshot(recording.path, "voice")
        assertEquals("audio/wav", reader.read(temporary, request(temporary)).getString("mimeType"))
        val rejected = File(context.cacheDir, "auth_token.wav")
        rejected.writeBytes(bytes)
        created.add(rejected)
        val forbidden = snapshot(rejected.path, "voice")
        failure("path_rejected") { reader.read(forbidden, request(forbidden)) }
    }
}
