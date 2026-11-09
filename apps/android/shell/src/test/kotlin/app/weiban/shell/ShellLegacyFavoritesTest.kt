package app.weiban.shell

import android.content.Context
import android.content.SharedPreferences
import app.weiban.contracts.AuthResponse
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.time.Instant
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 31])
class ShellLegacyFavoritesTest {
    private val user = "019b0000-0000-7000-8000-000000000001"
    private val otherUser = "019b0000-0000-7000-8000-000000000003"
    private val sessionId = "019b0000-0000-7000-8000-000000000002"
    private val owner = "$user:$sessionId"
    private val accountKey = "fixture1"
    private lateinit var preferences: SharedPreferences
    private lateinit var receipts: SharedPreferences
    private lateinit var store: ShellLegacyFavoritesStore
    private lateinit var session: ShellLegacyFavoritesSession
    private var reads = mutableListOf<String>()
    private var calls = 0
    private var time = Instant.parse("2026-11-09T00:00:00Z").toEpochMilli()
    private var source: (AuthResponse) -> LegacyFavoriteSource = { LegacyFavoriteSource(it.user.userId, listOf(accountKey), true) }
    private var afterRead: (() -> Unit)? = null

    @Before
    fun setup() {
        val context = RuntimeEnvironment.getApplication()
        preferences = context.getSharedPreferences("FlutterSharedPreferences", Context.MODE_PRIVATE)
        receipts = context.getSharedPreferences("weiban_legacy_favorite_receipts_v1", Context.MODE_PRIVATE)
        preferences.edit().clear().commit()
        receipts.edit().clear().commit()
        val restricted =
            object : SharedPreferences by preferences {
                override fun getString(
                    key: String?,
                    defValue: String?,
                ): String? {
                    reads.add(checkNotNull(key))
                    return preferences.getString(key, defValue).also { afterRead?.invoke() }
                }

                override fun getAll(): MutableMap<String, *> = error("WHOLE_LEGACY_PREFERENCES_MUST_NOT_BE_READ")
            }
        store = ShellLegacyFavoritesStore(restricted, receipts)
        session =
            ShellLegacyFavoritesSession(store, {
                calls++
                source(it)
            }, { time })
        preferences
            .edit()
            .putString("flutter.auth_token", "old-token-canary-never-export")
            .putString("flutter.password", "old-password-canary-never-export")
            .putString("flutter.local_persona_account_scope_v1", "other9")
            .putString("flutter.last_local_account_v1", "other9")
            .putString("flutter.favorite_messages_other9", JSONArray().put(favorite(content = "other-account-canary")).toString())
            .commit()
    }

    private fun auth(userId: String = user): JSONObject =
        JSONObject()
            .put(
                "session",
                JSONObject()
                    .put("sessionId", sessionId)
                    .put("token", "fixture-current-session-token-only")
                    .put("kind", "app")
                    .put("expiresAt", "2026-11-10T00:00:00.000Z"),
            ).put(
                "user",
                JSONObject()
                    .put("userId", userId)
                    .put("username", "ignored_new_username")
                    .put("role", "user")
                    .put("profileCompleted", true)
                    .put("createdAt", "2026-01-01T00:00:00.000Z"),
            )

    private fun request(
        type: String,
        requestOwner: String = owner,
    ): JSONObject =
        JSONObject()
            .put("v", 1)
            .put("id", "request-1")
            .put("owner", requestOwner)
            .put("type", type)

    private fun prepare(data: JSONObject): LegacyFavoritesCall =
        checkNotNull(session.prepare(data.toString(), ShellPolicy.ORIGIN, true, ShellPolicy.START_URL))

    private fun call(data: JSONObject): JSONObject = session.execute(prepare(data))

    private fun bind(): JSONObject = call(request("bind").put("auth", auth()))

    private fun read(
        offset: Int = 0,
        limit: Int = 25,
        digest: String? = null,
    ): JSONObject = call(request("read").put("offset", offset).put("limit", limit).put("snapshotDigest", digest ?: JSONObject.NULL))

    private fun favorite(
        content: String = "合成收藏",
        timestamp: Long = 1000,
        savedAt: Long = 2000,
    ): JSONObject =
        JSONObject()
            .put("chatKey", "合成角色")
            .put("chatTitle", "合成会话")
            .put("savedAt", savedAt)
            .put(
                "message",
                JSONObject()
                    .put("author", "合成角色")
                    .put("avatar", "合")
                    .put("content", content)
                    .put("isMine", false)
                    .put("type", "text")
                    .put("duration", 0)
                    .put("imageUrl", JSONObject.NULL)
                    .put("isLocal", false)
                    .put("mentionMe", false)
                    .put("quotedAuthor", JSONObject.NULL)
                    .put("quotedContent", JSONObject.NULL)
                    .put("timestamp", timestamp)
                    .put("audioPath", JSONObject.NULL)
                    .put("serverJobId", JSONObject.NULL)
                    .put("serverSeq", 37)
                    .put("clientMessageId", "local-synthetic-message")
                    .put("stickerId", JSONObject.NULL)
                    .put("sendState", "sent"),
            )

    private fun save(
        items: JSONArray,
        key: String = accountKey,
    ): String {
        val raw = items.toString()
        assertTrue(preferences.edit().putString("flutter.favorite_messages_$key", raw).commit())
        return raw
    }

    @Test
    fun readsOnlyTheServerAuthorizedAccountAndNeverOldCredentialsOrScope() {
        val item = favorite()
        save(JSONArray().put(item))
        assertTrue(bind().getBoolean("available"))
        val page = read()
        assertEquals(user, page.getString("userId"))
        assertEquals(owner, page.getString("owner"))
        assertEquals(listOf("flutter.favorite_messages_fixture1"), reads)
        assertEquals(2, calls)
        val output = page.toString()
        for (canary in listOf("old-token-canary", "old-password-canary", "other-account-canary")) {
            assertFalse(canary, output.contains(canary))
        }
        val result = page.getJSONArray("items").getJSONObject(0)
        assertEquals(accountKey, result.getString("accountKey"))
        assertEquals(legacyFavoritesDigest("合成角色|1000|text|合成收藏"), result.getString("itemKey"))
        assertTrue(page.isNull("nextOffset"))
    }

    @Test
    fun noServerMappingDoesNotTouchAnyLegacyPreference() {
        store = ShellLegacyFavoritesStore({ error("LEGACY_STORE_MUST_NOT_BE_OPENED") }, { error("RECEIPTS_MUST_NOT_BE_OPENED") })
        session = ShellLegacyFavoritesSession(store, { LegacyFavoriteSource(user, emptyList(), false) }, { time })
        source = { LegacyFavoriteSource(user, emptyList(), false) }
        assertFalse(bind().getBoolean("available"))
        val result = read()
        assertFalse(result.getBoolean("available"))
        assertEquals(0, result.getInt("total"))
        assertEquals(emptyList<String>(), reads)
    }

    @Test
    fun nullOrMissingTimestampUsesDartIdentityAndJsonExtensionsArePreserved() {
        val missing = favorite()
        missing.getJSONObject("message").remove("timestamp")
        missing.getJSONObject("message").put("extension", JSONObject().put("synthetic", JSONArray().put(true).put(5)))
        val nullable = favorite()
        nullable
            .getJSONObject("message")
            .put("timestamp", JSONObject.NULL)
            .put("type", JSONObject.NULL)
            .put("content", JSONObject.NULL)
        save(JSONArray().put(missing).put(nullable))
        bind()
        val items = read().getJSONArray("items")
        assertEquals(legacyFavoritesDigest("合成角色|null|text|合成收藏"), items.getJSONObject(0).getString("itemKey"))
        assertEquals(legacyFavoritesDigest("合成角色|null|text|"), items.getJSONObject(1).getString("itemKey"))
        val raw = items.getJSONObject(0).getJSONObject("favorite").getJSONObject("message")
        assertFalse(raw.has("timestamp"))
        assertEquals(5, raw.getJSONObject("extension").getJSONArray("synthetic").getInt(1))
        assertTrue(
            items
                .getJSONObject(1)
                .getJSONObject("favorite")
                .getJSONObject("message")
                .isNull("content"),
        )
    }

    @Test
    fun unexpectedCredentialFieldsBlockWithoutDiscardingOrExportingTheSource() {
        val item = favorite()
        item.getJSONObject("message").put("extension", JSONObject().put("auth_token", "unexpected-credential-canary"))
        val original = save(JSONArray().put(item))
        bind()
        val result = read()
        assertFalse(result.getBoolean("ok"))
        assertEquals("item_invalid", result.getString("reason"))
        assertFalse(result.toString().contains("unexpected-credential-canary"))
        assertFalse(result.has("items"))
        assertEquals(original, preferences.getString("flutter.favorite_messages_$accountKey", null))
    }

    @Test
    fun trustedTopFrameAndLoggedInVerifiedIdentityAreRequired() {
        val raw = request("bind").put("auth", auth()).toString()
        assertNull(session.prepare(raw, "https://evil.example", true, ShellPolicy.START_URL))
        assertNull(session.prepare(raw, ShellPolicy.ORIGIN, false, ShellPolicy.START_URL))
        assertNull(session.prepare(raw, ShellPolicy.ORIGIN, true, "https://evil.example"))
        assertEquals("not_bound", read().getString("reason"))
        assertEquals(0, calls)
        assertTrue(reads.isEmpty())
        source = { LegacyFavoriteSource(otherUser, listOf("other9"), true) }
        assertEquals("owner_mismatch", bind().getString("reason"))
        assertTrue(reads.isEmpty())
    }

    @Test
    fun wrongOwnerAndExpiredOrRevokedCurrentSessionsNeverReadDisk() {
        bind()
        val wrong = call(request("read", "$otherUser:$sessionId").put("offset", 0).put("limit", 25))
        assertEquals("owner_mismatch", wrong.getString("reason"))
        source = { throw LegacyFavoritesFailure("authentication_failed") }
        assertEquals("authentication_failed", read().getString("reason"))
        time = Instant.parse("2026-11-11T00:00:00Z").toEpochMilli()
        assertEquals("session_expired", read().getString("reason"))
        assertTrue(reads.isEmpty())
    }

    @Test
    fun publicUnscopedFavoritesAreReportedButTheirValueIsNeverExportedOrRemoved() {
        preferences.edit().putString("flutter.favorite_messages", "unscoped-private-canary").commit()
        bind()
        val result = read()
        assertTrue(result.getBoolean("unscopedPresent"))
        assertEquals(0, result.getInt("total"))
        assertFalse(result.toString().contains("unscoped-private-canary"))
        assertEquals(listOf("flutter.favorite_messages_fixture1"), reads)
        assertEquals("unscoped-private-canary", preferences.getString("flutter.favorite_messages", null))
    }

    @Test
    fun paginationIsBoundedAndSnapshotChangesRefuseTheOldOffset() {
        save(JSONArray().also { items -> repeat(26) { items.put(favorite(timestamp = it.toLong())) } })
        bind()
        val first = read()
        assertEquals(25, first.getJSONArray("items").length())
        assertEquals(25, first.getInt("nextOffset"))
        val last = read(25, digest = first.getString("snapshotDigest"))
        assertEquals(1, last.getJSONArray("items").length())
        assertTrue(last.isNull("nextOffset"))
        assertEquals("cursor_invalid", read(limit = 26).getString("reason"))
        assertEquals("cursor_invalid", read(offset = 27).getString("reason"))
        save(JSONArray().put(favorite(content = "合成新收藏")))
        val changed = read(25, digest = first.getString("snapshotDigest"))
        assertEquals("snapshot_changed", changed.getString("reason"))
        assertFalse(changed.has("items"))
    }

    @Test
    fun multibyteBatchesRespectTheWireByteLimitAndOversizedItemsAreBlocked() {
        save(JSONArray().also { items -> repeat(25) { items.put(favorite(content = "中".repeat(10000), timestamp = it.toLong())) } })
        bind()
        val page = read()
        assertTrue(page.getBoolean("ok"))
        assertTrue(page.getJSONArray("items").length() < 25)
        assertTrue(page.toString().toByteArray(Charsets.UTF_8).size <= LegacyFavoritesLimits.MAX_REPLY_BYTES)
        val raw = save(JSONArray().put(favorite(content = "中".repeat(100000))))
        val blocked = read()
        assertFalse(blocked.getBoolean("ok"))
        assertTrue(blocked.getBoolean("blocked"))
        assertEquals("item_too_large", blocked.getString("reason"))
        assertFalse(blocked.has("items"))
        assertEquals(raw, preferences.getString("flutter.favorite_messages_$accountKey", null))
    }

    @Test
    fun malformedAndInvalidItemsBlockRatherThanDisappear() {
        preferences.edit().putString("flutter.favorite_messages_$accountKey", "malformed-private-canary").commit()
        bind()
        val malformed = read()
        assertEquals("snapshot_malformed", malformed.getString("reason"))
        assertFalse(malformed.toString().contains("malformed-private-canary"))
        val item = favorite()
        item.getJSONObject("message").put("content", JSONArray().put("invalid content shape"))
        save(JSONArray().put(favorite()).put(item))
        val invalid = read()
        assertEquals("item_invalid", invalid.getString("reason"))
        assertFalse(invalid.has("items"))
        preferences.edit().putInt("flutter.favorite_messages_$accountKey", 9).commit()
        assertEquals("snapshot_malformed", read().getString("reason"))
    }

    @Test
    fun acknowledgeRecordsOnlyIndependentDigestAndNeverPreventsRetriesOrDeletesOriginals() {
        val raw = save(JSONArray().put(favorite()))
        bind()
        val first = read()
        val digest = first.getString("snapshotDigest")
        val ack = call(request("ack").put("snapshotDigest", digest))
        assertTrue(ack.getBoolean("acknowledged"))
        val repeated = read()
        assertTrue(repeated.getBoolean("acknowledged"))
        assertEquals(1, repeated.getJSONArray("items").length())
        assertEquals(raw, preferences.getString("flutter.favorite_messages_$accountKey", null))
        save(JSONArray().put(favorite(content = "合成后来收藏")))
        assertEquals("snapshot_changed", call(request("ack").put("snapshotDigest", digest)).getString("reason"))
        assertFalse(read().getBoolean("acknowledged"))
    }

    @Test
    fun authorizedKeysAreReadInStableOrderWithoutUsingAWebpageSuppliedUsername() {
        source = { LegacyFavoriteSource(user, listOf("fixture2", accountKey), true) }
        save(JSONArray().put(favorite(content = "合成第一分区")))
        save(JSONArray().put(favorite(content = "合成第二分区")), "fixture2")
        call(request("bind").put("auth", auth()).put("username", "other9"))
        val page = read()
        assertEquals(listOf("flutter.favorite_messages_fixture1", "flutter.favorite_messages_fixture2"), reads)
        assertEquals(2, page.getJSONArray("items").length())
        val originalKey = page.getJSONArray("items").getJSONObject(0).getString("itemKey")
        save(JSONArray().put(favorite(content = "合成第一分区", savedAt = 9000)))
        assertEquals(originalKey, read().getJSONArray("items").getJSONObject(0).getString("itemKey"))
        source = { LegacyFavoriteSource(user, listOf("fixture2"), true) }
        assertEquals("source_changed", read().getString("reason"))
    }

    @Test
    fun groupIdentityAndMediaSnapshotFieldsRemainSnapshotsRatherThanInventedMessageIds() {
        val item = favorite().put("chatKey", "group:42")
        item
            .getJSONObject("message")
            .put("type", "voice")
            .put("duration", 7)
            .put("serverSeq", 975)
            .put("serverJobId", "old-group-message-stable-id")
            .put("audioPath", "/synthetic/private-voice.wav")
            .put("quotedAuthor", "合成引用者")
            .put("quotedContent", "合成被引用文字")
        save(JSONArray().put(item))
        bind()
        val message =
            read()
                .getJSONArray("items")
                .getJSONObject(0)
                .getJSONObject("favorite")
                .getJSONObject("message")
        assertEquals(975, message.getInt("serverSeq"))
        assertEquals("old-group-message-stable-id", message.getString("serverJobId"))
        assertEquals("/synthetic/private-voice.wav", message.getString("audioPath"))
        assertEquals("合成被引用文字", message.getString("quotedContent"))
    }

    @Test
    fun logoutInvalidatesAnInflightBindBeforeItCanRestoreAnAccount() {
        val entered = CountDownLatch(1)
        val resume = CountDownLatch(1)
        source = {
            entered.countDown()
            check(resume.await(5, TimeUnit.SECONDS))
            LegacyFavoriteSource(user, listOf(accountKey), true)
        }
        val call = prepare(request("bind").put("auth", auth()))
        val executor = Executors.newSingleThreadExecutor()
        try {
            val result = executor.submit<JSONObject> { session.execute(call) }
            assertTrue(entered.await(5, TimeUnit.SECONDS))
            assertTrue(this.call(request("clear")).getBoolean("cleared"))
            resume.countDown()
            assertEquals("changed", result.get(5, TimeUnit.SECONDS).getString("reason"))
            assertFalse(session.current(call))
            assertEquals("not_bound", read().getString("reason"))
            assertTrue(reads.isEmpty())
        } finally {
            resume.countDown()
            executor.shutdownNow()
        }
    }

    @Test
    fun navigationOrAccountSwitchDropsAReadThatWasAlreadyInProgress() {
        save(JSONArray().put(favorite(content = "late-response-canary")))
        bind()
        afterRead = { session.reset() }
        val response = read()
        assertEquals("changed", response.getString("reason"))
        assertFalse(response.has("items"))
        assertFalse(response.toString().contains("late-response-canary"))
        afterRead = null
        bind()
        call(request("bind", "$otherUser:$sessionId").put("auth", auth(otherUser)))
        assertEquals("owner_mismatch", read().getString("reason"))
    }
}
