package app.weiban.feature.chat

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import app.weiban.contracts.*
import app.weiban.data.AppUpdates
import app.weiban.data.OwnerRecord
import app.weiban.data.SessionCallOptions
import app.weiban.data.SessionRepository
import app.weiban.data.uploadMedia
import app.weiban.designsystem.LocalWeibanColors
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private const val THUMB_EDGE = 360
private const val MAX_PIXELS = 40_000_000L
private const val MAX_UPLOAD_BYTES = 20 * 1024 * 1024

/** 朋友圈列表来源：feed（发现 › 朋友圈）、me（我 › 朋友圈）、character:<id>（资料页 › 朋友圈）。 */
internal class MomentsPager(
    private val repository: SessionRepository,
    private val owner: OwnerRecord,
    private val mode: String,
) {
    val items = mutableStateListOf<MomentsPost>()
    var cursor by mutableStateOf<String?>(null)
    var finished by mutableStateOf(false)
    var loading by mutableStateOf(false)
    var failed by mutableStateOf(false)
    var initialized by mutableStateOf(false)

    private val options get() = SessionCallOptions(owner = owner, networkOnly = true)

    @Suppress("TooGenericExceptionCaught") // UI boundary: failures show a retry row.
    suspend fun next() {
        if (loading || finished) return
        loading = true
        failed = false
        try {
            val query = buildMap<String, String> { cursor?.let { put("cursor", it) } }
            val page: Pair<List<MomentsPost>, String?> =
                when {
                    mode == "me" ->
                        repository.call(Endpoints.momentsEndpointsListMyPosts, query = query, options = options).let { it.items to it.nextCursor }
                    mode.startsWith("character:") ->
                        repository
                            .call(
                                Endpoints.momentsEndpointsListCharacterPosts,
                                params = mapOf("characterId" to mode.removePrefix("character:")),
                                query = query,
                                options = options,
                            ).let { it.items to it.nextCursor }
                    else ->
                        repository.call(Endpoints.momentsEndpointsListFeed, query = query, options = options).let { it.items to it.nextCursor }
                }
            items.addAll(page.first.filter { incoming -> items.none { it.postId == incoming.postId } })
            cursor = page.second
            finished = page.second == null
            initialized = true
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            failed = true
        } finally {
            loading = false
        }
    }

    fun replace(post: MomentsPost) {
        val index = items.indexOfFirst { it.postId == post.postId }
        if (index >= 0) items[index] = post else items.add(0, post)
    }

    fun remove(postId: String) {
        items.removeAll { it.postId == postId }
    }

    /** moments.post_changed：重拉该条，deleted 直接移除。 */
    @Suppress("TooGenericExceptionCaught")
    suspend fun changed(
        postId: String,
        deleted: Boolean,
    ) {
        if (deleted) {
            remove(postId)
            return
        }
        if (items.none { it.postId == postId }) return
        try {
            replace(repository.call(Endpoints.momentsEndpointsGetPost, params = mapOf("postId" to postId), options = options))
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            Unit
        }
    }
}

/** 发现页红点（SOC-07 第 7 条：新动态不推送，只亮入口）。 */
@Suppress("TooGenericExceptionCaught")
@Composable fun rememberMomentsBadge(
    repository: SessionRepository,
    owner: OwnerRecord,
): MomentsBadge? {
    var badge by remember(owner) { mutableStateOf<MomentsBadge?>(null) }
    LaunchedEffect(owner) {
        try {
            badge = repository.call(Endpoints.momentsEndpointsGetBadge, options = SessionCallOptions(owner = owner, networkOnly = true))
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            Unit
        }
        AppUpdates.updates.collect { update ->
            if (update is UserUpdateMomentsBadgeUpdated) badge = update.data.badge
        }
    }
    return badge
}

internal fun momentTime(createdAt: String): String =
    try {
        val zone = ZoneId.systemDefault()
        val time = Instant.parse(createdAt).atZone(zone)
        val days = java.time.temporal.ChronoUnit.DAYS
            .between(time.toLocalDate(), LocalDate.now(zone))
        when {
            days == 0L -> time.format(DateTimeFormatter.ofPattern("HH:mm"))
            days == 1L -> "昨天 " + time.format(DateTimeFormatter.ofPattern("HH:mm"))
            else -> time.format(DateTimeFormatter.ofPattern("M月d日 HH:mm"))
        }
    } catch (_: java.time.format.DateTimeParseException) {
        createdAt.take(16).replace('T', ' ')
    }

/** 列表用缩略图：按需下载、按边长降采样。 */
@Composable internal fun MediaThumb(
    repository: SessionRepository,
    owner: OwnerRecord,
    mediaId: String,
    size: Dp,
) {
    val colors = LocalWeibanColors.current
    var bitmap by remember(owner, mediaId) { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(owner, mediaId) { bitmap = mediaPicture(repository, owner, mediaId) }
    Box(Modifier.size(size).background(colors.bgSkeleton)) {
        bitmap?.let { image ->
            Image(image.asImageBitmap(), null, Modifier.size(size), contentScale = ContentScale.Crop)
            DisposableEffect(image) { onDispose { image.recycle() } }
        }
    }
}

@Suppress("TooGenericExceptionCaught") // Missing images keep the placeholder.
private suspend fun mediaPicture(
    repository: SessionRepository,
    owner: OwnerRecord,
    mediaId: String,
): Bitmap? =
    try {
        val media =
            repository.call(Endpoints.mediaEndpointsGetMedia, params = mapOf("mediaId" to mediaId), options = SessionCallOptions(owner = owner))
        val bytes = repository.download(media, owner)
        withContext(Dispatchers.IO) {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            require(bounds.outWidth > 0 && bounds.outHeight > 0 && bounds.outWidth.toLong() * bounds.outHeight <= MAX_PIXELS)
            var sample = 1
            while (maxOf(bounds.outWidth, bounds.outHeight) / sample > THUMB_EDGE) sample *= 2
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
        }
    } catch (error: CancellationException) {
        throw error
    } catch (_: Exception) {
        null
    }

/** 上传一张朋友圈图片（purpose = moments_image），返回 mediaId。 */
internal suspend fun uploadMomentImage(
    context: Context,
    repository: SessionRepository,
    owner: OwnerRecord,
    uri: Uri,
): String {
    val resolver = context.contentResolver
    val mime = resolver.getType(uri) ?: "image/jpeg"
    val bytes =
        withContext(Dispatchers.IO) {
            resolver.openInputStream(uri)?.use { it.readBytes() } ?: error("image unavailable")
        }
    require(bytes.size <= MAX_UPLOAD_BYTES)
    return uploadMedia(repository, owner, bytes, mime, "moments_image").mediaId
}
