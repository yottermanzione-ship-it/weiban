package app.weiban.shell

import android.os.Build
import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File
import java.io.FileDescriptor
import java.io.FileInputStream

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 31])
class AndroidLegacyMediaFilesTest {
    @Test fun theProductionOpenPortRetainsReadOnlyNoFollowAndAtomicCloseOnExecOnBothApiLevels() {
        val bytes = "synthetic-media-open-fixture".toByteArray()
        val root = RuntimeEnvironment.getApplication().cacheDir
        val file = File.createTempFile("legacy-api-open-", ".bin", root)
        file.writeBytes(bytes)
        var observedFlags: Int? = null
        var observedMode: Int? = null
        var descriptor: FileDescriptor? = null
        var api24Stream: FileInputStream? = null
        val files =
            AndroidLegacyMediaFiles { requestedPath, flags, mode ->
                assertEquals(file.path, requestedPath)
                observedFlags = flags
                observedMode = mode
                // Robolectric's API 24 Os.open stub returns null. Only the syscall result is
                // supplied here; the production API branch and all open flags are still checked.
                val opened =
                    if (Build.VERSION.SDK_INT < 27) {
                        FileInputStream(requestedPath).also { api24Stream = it }.fd
                    } else {
                        Os.open(requestedPath, flags, mode)
                    }
                opened.also { descriptor = it }
            }
        try {
            files.open(file).use { handle ->
                val output = ByteArray(bytes.size - 3)
                handle.read(3, output)
                assertArrayEquals(bytes.copyOfRange(3, bytes.size), output)
                assertTrue(checkNotNull(descriptor).valid())
            }
            assertEquals(OsConstants.O_RDONLY or OsConstants.O_NOFOLLOW or 0x80000, observedFlags)
            assertEquals(0, observedMode)
            assertFalse(checkNotNull(descriptor).valid())
            assertArrayEquals(bytes, file.readBytes())
        } finally {
            api24Stream?.close()
            file.delete()
        }
    }

    @Test fun anOpenFailureIsNotRetriedWithWeakerFlags() {
        var calls = 0
        var observedFlags: Int? = null
        val files =
            AndroidLegacyMediaFiles { _, flags, _ ->
                calls++
                observedFlags = flags
                throw ErrnoException("synthetic-denied", OsConstants.EACCES)
            }
        val error =
            assertThrows(ErrnoException::class.java) {
                files.open(File(RuntimeEnvironment.getApplication().cacheDir, "synthetic-not-opened.bin"))
            }
        assertEquals(OsConstants.EACCES, error.errno)
        assertEquals(1, calls)
        assertNotNull(observedFlags)
        assertEquals(OsConstants.O_RDONLY or OsConstants.O_NOFOLLOW or 0x80000, observedFlags)
    }
}
