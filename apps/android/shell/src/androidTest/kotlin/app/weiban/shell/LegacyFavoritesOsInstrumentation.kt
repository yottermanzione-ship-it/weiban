package app.weiban.shell

import android.app.Activity
import android.app.Instrumentation
import android.os.Build
import android.os.Bundle
import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/** Explicit synthetic-emulator runner: no activity, WebView, preferences, credential, network or real account. */
class LegacyFavoritesOsInstrumentation : Instrumentation() {
    private var synthetic = false
    private var seededHardlink = false
    private var passed = 0
    private val failed = mutableListOf<String>()
    private val platformBlocked = mutableListOf<String>()
    private val diagnostics = JSONObject()
    private var hardlinkCreation = "not_attempted"
    private var hardlinkTargetAbsent = false
    private var hardlinkTargetProbeErrno = 0
    private var hardlinkSourceLinks = 0L
    private var hardlinkTargetLinks = 0L
    private lateinit var fixture: File
    private lateinit var reader: ShellLegacyFavoriteMedia
    private var fixtureCreated = false

    override fun onCreate(arguments: Bundle?) {
        super.onCreate(arguments)
        synthetic = arguments?.getString("synthetic") == "true"
        seededHardlink = arguments?.getString("seededHardlink") == "true"
        start()
    }

    override fun onStart() {
        if (!synthetic || !targetContext.packageName.endsWith(".debug") || Build.HARDWARE !in setOf("ranchu", "goldfish")) {
            finish(Activity.RESULT_CANCELED, Bundle().apply { putString("failure", "SYNTHETIC_EMULATOR_REQUIRED") })
            return
        }
        try {
            createFixture()
            runChecks()
        } catch (_: Exception) {
            failed.add("fixture_execution")
        } finally {
            runCatching { cleanup() }.onFailure { failed.add("fixture_cleanup") }
        }
        finish(
            if (failed.isEmpty()) Activity.RESULT_OK else Activity.RESULT_CANCELED,
            Bundle().apply {
                putBoolean("ok", failed.isEmpty())
                putBoolean("complete", failed.isEmpty() && platformBlocked.isEmpty())
                putInt("passed", passed)
                putInt("failed", failed.size)
                putInt("platformBlocked", platformBlocked.size)
                putString("failedCategories", failed.joinToString(","))
                putString("platformBlockedCategories", platformBlocked.joinToString(","))
                putString("hardlinkCreation", hardlinkCreation)
                putBoolean("hardlinkTargetAbsent", hardlinkTargetAbsent)
                putInt("hardlinkTargetProbeErrno", hardlinkTargetProbeErrno)
                putLong("hardlinkSourceLinks", hardlinkSourceLinks)
                putLong("hardlinkTargetLinks", hardlinkTargetLinks)
                putString("diagnostics", diagnostics.toString())
                putString("stream", "Synthetic Os checks: passed=$passed failed=${failed.size} platformBlocked=${platformBlocked.size}\n")
            },
        )
    }

    private fun createFixture() {
        fixture = File(targetContext.cacheDir, "legacy-favorites-os-${System.nanoTime()}")
        check(fixture.mkdir())
        fixtureCreated = true
        reader = ShellLegacyFavoriteMedia(fixture, listOf(File(fixture, "cache"), File(fixture, "code_cache")))
    }

    private fun runChecks() {
        val bytes = png()
        val image = File(fixture, "app_flutter/weiban_resources/chat_images/1794182400000_12345678.png")
        check(image.parentFile!!.mkdirs())
        image.writeBytes(bytes)
        val snapshot = snapshot(image.path)
        checkCase("real_os_chunk_roundtrip") { transfer(snapshot, bytes) }
        if (seededHardlink) {
            checkCase("preexisting_hardlink_rejected") { preexistingHardlink() }
        } else {
            checkCase("hardlink_rejected") { hardlink(image) }
        }
        checkCase("symlink_rejected") { symlink(image) }
        checkCase("outside_root_rejected") {
            val outside = snapshot(File(fixture, "shared_prefs/private.png").path)
            rejected("path_rejected") { reader.read(outside, request(outside)) }
        }
        checkCase("file_changes_rejected") { changed(image, snapshot) }
        checkCase("voice_bucket_reads") { voice() }
        checkCase("remote_reference_not_downloaded") {
            val remote = snapshot("https://invalid.example/never-requested.png")
            rejected("remote_reference") { reader.read(remote, request(remote)) }
        }
        checkCase("missing_file_reported") {
            val missing = snapshot(File(image.parentFile, "missing.png").path)
            rejected("file_missing") { reader.read(missing, request(missing)) }
        }
    }

    private fun transfer(
        snapshot: LegacyFavoriteSnapshot,
        expected: ByteArray,
    ) {
        val output = java.io.ByteArrayOutputStream()
        var offset = 0
        var digest: String? = null
        do {
            val result = reader.read(snapshot, request(snapshot, offset, digest))
            digest = result.getString("sha256")
            val bytes = Base64.decode(result.getString("base64"), Base64.NO_WRAP)
            check(bytes.size <= 131072)
            output.write(bytes)
            offset = if (result.isNull("nextOffset")) -1 else result.getInt("nextOffset")
        } while (offset >= 0)
        check(output.toByteArray().contentEquals(expected))
        check(digest == MessageDigest.getInstance("SHA-256").digest(expected).joinToString("") { "%02x".format(it.toInt() and 255) })
    }

    private fun hardlink(image: File) {
        val link = File(image.parentFile, "hard.png")
        try {
            Os.link(image.path, link.path)
            hardlinkCreation = "created"
        } catch (error: ErrnoException) {
            hardlinkCreation = "creation_failed"
            hardlinkTargetAbsent = hardlinkTargetMissing(link)
            if (error.errno in setOf(OsConstants.EPERM, OsConstants.EACCES) && hardlinkTargetAbsent) {
                hardlinkCreation = "blocked_by_platform"
                throw PlatformProbeBlocked(error.errno)
            }
            throw FixtureProbeFailure("hardlink_create", "os_error", error.errno)
        }
        try {
            hardlinkSourceLinks = Os.lstat(image.path).st_nlink
            hardlinkTargetLinks = Os.lstat(link.path).st_nlink
            if (hardlinkSourceLinks < 2 || hardlinkTargetLinks < 2) {
                throw FixtureProbeFailure("hardlink_stat", "unexpected_link_count")
            }
            val linked = snapshot(link.path)
            rejected("path_rejected") { reader.read(linked, request(linked)) }
        } finally {
            if (!link.delete()) throw FixtureProbeFailure("hardlink_cleanup", "fixture_cleanup_failed")
        }
    }

    private fun preexistingHardlink() {
        // A fixed, separately seeded synthetic root only. Never accept a path argument or remove this root.
        val root = File(targetContext.cacheDir, "legacy-favorites-os-seeded")
        val canonical = root.canonicalFile
        check(canonical.parentFile == targetContext.cacheDir.canonicalFile && canonical.name == "legacy-favorites-os-seeded")
        val rootState = Os.lstat(root.path)
        check(OsConstants.S_ISDIR(rootState.st_mode) && !OsConstants.S_ISLNK(rootState.st_mode))
        val file = File(root, "app_flutter/weiban_resources/chat_images/hard.png")
        hardlinkCreation = "preexisting_fixture"
        val state = Os.lstat(file.path)
        hardlinkTargetLinks = state.st_nlink
        check(OsConstants.S_ISREG(state.st_mode) && state.st_nlink == 2L)
        val seededReader = ShellLegacyFavoriteMedia(root, emptyList())
        try {
            val linked = snapshot(file.path)
            rejected("path_rejected") { seededReader.read(linked, request(linked)) }
        } finally {
            seededReader.reset()
        }
    }

    private fun hardlinkTargetMissing(link: File): Boolean =
        try {
            Os.lstat(link.path)
            false
        } catch (error: ErrnoException) {
            hardlinkTargetProbeErrno = error.errno
            error.errno == OsConstants.ENOENT
        }

    private fun symlink(image: File) {
        val link = File(image.parentFile, "symbolic.png")
        Os.symlink(image.path, link.path)
        try {
            val linked = snapshot(link.path)
            rejected("path_rejected") { reader.read(linked, request(linked)) }
        } finally {
            check(link.delete())
        }
    }

    private fun changed(
        image: File,
        snapshot: LegacyFavoriteSnapshot,
    ) {
        val first = reader.read(snapshot, request(snapshot))
        val bytes = image.readBytes()
        bytes[150000] = (bytes[150000].toInt() xor 255).toByte()
        image.writeBytes(bytes)
        rejected("file_changed") { reader.read(snapshot, request(snapshot, 131072, first.getString("sha256"))) }
    }

    private fun voice() {
        val file = File(fixture, "app_flutter/weiban_resources/voice_messages/1794182400000_12345678.wav")
        check(file.parentFile!!.mkdirs())
        val bytes = ByteArray(2048)
        "RIFF".toByteArray().copyInto(bytes)
        "WAVE".toByteArray().copyInto(bytes, 8)
        file.writeBytes(bytes)
        val voice = snapshot(file.path, "voice")
        check(reader.read(voice, request(voice)).getString("mimeType") == "audio/wav")
    }

    private fun snapshot(
        path: String,
        type: String = "image",
    ): LegacyFavoriteSnapshot {
        val message =
            JSONObject()
                .put("type", type)
                .put("content", "synthetic")
                .put("timestamp", 1000)
                .put(if (type == "voice") "audioPath" else "imageUrl", path)
        val raw =
            JSONArray()
                .put(
                    JSONObject()
                        .put("chatKey", "synthetic")
                        .put("chatTitle", "synthetic")
                        .put("savedAt", 2000)
                        .put("message", message),
                ).toString()
        return LegacyFavoriteSnapshot(legacyFavoritesDigest(raw), LegacyFavoriteParser.parse("fixture1", raw), false)
    }

    private fun request(
        snapshot: LegacyFavoriteSnapshot,
        offset: Int = 0,
        digest: String? = null,
    ): JSONObject =
        JSONObject()
            .put("owner", "synthetic-emulator-only")
            .put("snapshotDigest", snapshot.digest)
            .put("accountKey", "fixture1")
            .put("itemKey", snapshot.items.single().getString("itemKey"))
            .put("offset", offset)
            .put("limit", 131072)
            .put("sha256", digest ?: JSONObject.NULL)

    private fun png(): ByteArray =
        Base64.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", Base64.DEFAULT) +
            ByteArray(300000)

    private fun checkCase(
        name: String,
        block: () -> Unit,
    ) {
        try {
            block()
            passed++
        } catch (error: PlatformProbeBlocked) {
            platformBlocked.add(name)
            diagnostics.put(
                name,
                JSONObject().put("stage", "hardlink_create").put("category", "blocked_by_platform").put("errno", error.errno),
            )
        } catch (error: Exception) {
            failed.add(name)
            diagnostics.put(name, diagnostic(error))
        }
    }

    private fun rejected(
        reason: String,
        block: () -> Unit,
    ) {
        var observed: String? = null
        try {
            block()
        } catch (error: LegacyFavoritesFailure) {
            observed = safeReaderReason(error.reason)
        }
        if (observed != reason) {
            throw FixtureProbeFailure(
                "reader_gate",
                if (observed ==
                    null
                ) {
                    "reader_allowed"
                } else {
                    "reader_wrong_rejection"
                },
                observed = observed,
            )
        }
    }

    private fun diagnostic(error: Exception): JSONObject =
        when (error) {
            is FixtureProbeFailure ->
                JSONObject()
                    .put("stage", error.stage)
                    .put("category", error.category)
                    .put("errno", error.errno)
                    .put("observed", error.observed ?: JSONObject.NULL)
            is ErrnoException -> JSONObject().put("stage", "check_body").put("category", "os_error").put("errno", error.errno)
            is LegacyFavoritesFailure ->
                JSONObject()
                    .put("stage", "check_body")
                    .put("category", "reader_failure")
                    .put("observed", safeReaderReason(error.reason))
            is IllegalStateException -> JSONObject().put("stage", "check_body").put("category", "assertion_failed")
            is java.io.IOException -> JSONObject().put("stage", "check_body").put("category", "io_failure")
            else -> JSONObject().put("stage", "check_body").put("category", "other_failure")
        }

    private fun safeReaderReason(reason: String): String =
        reason.takeIf {
            it in
                setOf(
                    "path_rejected",
                    "file_missing",
                    "file_changed",
                    "remote_reference",
                    "media_unavailable",
                    "item_ambiguous",
                    "unsupported_media",
                    "media_too_large",
                    "cursor_invalid",
                    "snapshot_changed",
                    "invalid_request",
                    "changed",
                )
        }
            ?: "other_reader_failure"

    private fun cleanup() {
        if (::reader.isInitialized) reader.reset()
        if (fixtureCreated) {
            val root = fixture.canonicalFile
            val parent = targetContext.cacheDir.canonicalFile
            check(root.parentFile == parent && root.name.startsWith("legacy-favorites-os-"))
            check(root.deleteRecursively())
        }
    }
}

private class PlatformProbeBlocked(
    val errno: Int,
) : Exception("platform_blocked")

private class FixtureProbeFailure(
    val stage: String,
    val category: String,
    val errno: Int = 0,
    val observed: String? = null,
) : Exception(category)
