package app.weiban.feature.chat

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import app.weiban.contracts.*
import app.weiban.data.*
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.tokens.WbSpace
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.*

/** 单张分享图最多消息数（P-24）。 */
internal const val SHARE_MAX_ITEMS = 30

/** 成人模式 / 「健康」标记消息不能进分享图时的统一提示（EXP-01 第 6 条）。 */
internal const val SHARE_REJECT_TEXT = "成人模式 / 健康相关的消息不能生成分享图"

/** 搜索结果 / 收藏点开后定位到某条消息（CHAT-12）：聊天页消费后清空。 */
data class LocateTarget(
    val conversationId: String,
    val seq: Long,
    val nonce: Long = System.nanoTime(),
)

object MessageLocator {
    private val flow = MutableStateFlow<LocateTarget?>(null)
    val target: StateFlow<LocateTarget?> = flow

    fun request(
        conversationId: String,
        seq: Long,
    ) {
        flow.value = LocateTarget(conversationId, seq)
    }

    fun consume(target: LocateTarget) {
        flow.compareAndSet(target, null)
    }
}

/** 分享图编辑页的入口参数（四个入口：聊天多选、收藏、朋友圈、卡片）。source 为契约 ShareSource。 */
internal data class ShareRequest(
    val source: JsonObject,
    val origin: String,
    val conversationId: String? = null,
)

/** 全局浮层（分享图编辑页、卡片详情）：任何页面都可以打开，盖在所有页面上。 */
internal object L6Overlays {
    val share = MutableStateFlow<ShareRequest?>(null)
    val card = MutableStateFlow<CardOpen?>(null)

    fun shareMessages(
        conversationId: String,
        messageIds: List<String>,
    ) {
        share.value =
            ShareRequest(
                buildJsonObject {
                    put("kind", "messages")
                    put("conversationId", conversationId)
                    put("messageIds", JsonArray(messageIds.map(::JsonPrimitive)))
                },
                "messages",
                conversationId,
            )
    }

    fun shareFavorites(ids: List<String>) {
        share.value =
            ShareRequest(
                buildJsonObject {
                    put("kind", "favorites")
                    put("favoriteIds", JsonArray(ids.map(::JsonPrimitive)))
                },
                "favorites",
            )
    }

    fun shareMoment(postId: String) {
        share.value =
            ShareRequest(
                buildJsonObject {
                    put("kind", "moments_post")
                    put("postId", postId)
                },
                "moments",
            )
    }

    fun shareCard(cardId: String) {
        share.value =
            ShareRequest(
                buildJsonObject {
                    put("kind", "card")
                    put("cardId", cardId)
                },
                "card",
            )
    }

    fun openCard(
        characterId: String,
        cardId: String,
    ) {
        card.value = CardOpen(characterId, cardId)
    }
}

internal data class CardOpen(
    val characterId: String,
    val cardId: String,
)

/** 聊天多选时「分享图」不可用的原因；可用时返回 null。 */
internal fun shareBlockReason(messages: List<Message>): String? =
    when {
        messages.isEmpty() -> "请选择消息"
        messages.size > SHARE_MAX_ITEMS -> "一张分享图最多 $SHARE_MAX_ITEMS 条消息"
        messages.any { it.scope == "adult" || it.labels.orEmpty().contains("health") } -> SHARE_REJECT_TEXT
        else -> null
    }

/** 消息内容的一行文字（收藏列表、分享图、搜索）。 */
internal fun contentText(content: ReceivedMessageContent?): String =
    when (content) {
        is ReceivedMessageContentText -> content.text
        is ReceivedMessageContentLink -> "[链接] ${content.title}"
        is ReceivedMessageContentVoice ->
            "[语音 ${((content.durationMs + 500) / 1000).coerceIn(1, 60)}″]" + (content.transcript?.let { " $it" } ?: "")
        is ReceivedMessageContentLetter -> content.body
        is ReceivedMessageContentDailyQuestion -> "问：${content.question}\n答：${content.answer}"
        is ReceivedMessageContentContactCard -> "[名片] ${content.name}"
        is ReceivedMessageContentNudge -> "拍了拍"
        is ReceivedMessageContentActionCard -> content.text
        is ReceivedMessageContentImage -> "[图片]"
        is ReceivedMessageContentSticker -> "[表情]"
        is ReceivedMessageContentCallRecord -> "[语音通话] ${callRecordText(content)}"
        else -> "[消息]"
    }

internal fun cardKindName(kind: String): String =
    when (kind) {
        "anniversary" -> "纪念卡"
        "familiarity" -> "熟悉度卡"
        "holiday" -> "节日卡"
        else -> "瞬间卡"
    }

internal fun serialText(serialNo: Long): String = "No." + serialNo.toString().padStart(3, '0')

/** 关键词高亮（全局搜索、会话内搜索、收藏搜索）。 */
@Composable internal fun highlighted(
    text: String,
    keyword: String,
): AnnotatedString {
    val color = LocalWeibanColors.current.brandPrimary
    return buildAnnotatedString {
        val key = keyword.trim()
        if (key.isEmpty()) {
            append(text)
            return@buildAnnotatedString
        }
        var index = 0
        while (index < text.length) {
            val found = text.indexOf(key, index, ignoreCase = true)
            if (found < 0) {
                append(text.substring(index))
                break
            }
            append(text.substring(index, found))
            withStyle(SpanStyle(color = color, fontWeight = FontWeight.SemiBold)) { append(text.substring(found, found + key.length)) }
            index = found + key.length
        }
    }
}

/**
 * 全局浮层：分享图编辑页、卡片详情、获得成就轻提示（GRW-06 第 4 条：顶部 3 秒，最多连续 3 枚）。
 * 由宿主放在所有页面之上（与通话浮层同级）。
 */
@Composable fun GrowthShareOverlay(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
) {
    val share by L6Overlays.share.collectAsState()
    val card by L6Overlays.card.collectAsState()
    card?.let { open -> CardDetailOverlay(repository, owner, open) { L6Overlays.card.value = null } }
    share?.let { request -> key(request) { ShareEditor(repository, runtime, owner, request) { L6Overlays.share.value = null } } }
    AchievementToasts(repository, owner)
}

@Composable private fun AchievementToasts(
    repository: SessionRepository,
    owner: OwnerRecord,
) {
    val queue = remember(owner) { mutableStateListOf<String>() }
    LaunchedEffect(owner) {
        var known: Map<String, String?>? = null
        userAction({}) { known = loadAchievements(repository, owner).associate { it.key to it.unlockedAt } }
        AppUpdates.updates.collect { update ->
            if (update !is UserUpdateDataChanged || update.data.section != "achievements") return@collect
            userAction({}) {
                val items = loadAchievements(repository, owner)
                val before = known
                known = items.associate { it.key to it.unlockedAt }
                if (before != null) {
                    // 契约里的事件不带成就键：按 unlockedAt 比较找出新获得的（T-076 交接）。
                    val fresh = items.filter { it.unlockedAt != null && before[it.key] == null }
                    if (fresh.isNotEmpty()) {
                        val previous = repository.flags.get(owner, ACHIEVEMENT_NEW_FLAG).orEmpty().split(',').filter(String::isNotBlank)
                        repository.flags.set(owner, ACHIEVEMENT_NEW_FLAG, (previous + fresh.map { it.key }).distinct().joinToString(","))
                        queue.addAll(fresh.take(3).map { it.name })
                    }
                }
            }
        }
    }
    val current = queue.firstOrNull() ?: return
    LaunchedEffect(current, queue.size) {
        delay(3_000)
        if (queue.isNotEmpty()) queue.removeAt(0)
    }
    Box(Modifier.fillMaxWidth().statusBarsPadding().padding(WbSpace.S5), contentAlignment = Alignment.TopCenter) {
        Surface(shape = MaterialTheme.shapes.large, tonalElevation = WbSpace.S2, shadowElevation = WbSpace.S2) {
            Text("获得成就「$current」", Modifier.padding(horizontal = WbSpace.S5, vertical = WbSpace.S3))
        }
    }
}

internal const val ACHIEVEMENT_NEW_FLAG = "achievements:new"

internal suspend fun loadAchievements(
    repository: SessionRepository,
    owner: OwnerRecord,
): List<Achievement> =
    repository
        .call(
            Endpoints.growthCardEndpointsListAchievements,
            options = SessionCallOptions(owner = owner, networkOnly = true),
        ).items
