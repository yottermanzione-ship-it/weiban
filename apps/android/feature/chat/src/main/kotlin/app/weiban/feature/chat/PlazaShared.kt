@file:Suppress("TooGenericExceptionCaught", "SwallowedException", "ReturnCount")

package app.weiban.feature.chat

import android.content.Context
import android.graphics.BitmapFactory
import android.util.LruCache
import android.widget.Toast
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.weiban.contracts.*
import app.weiban.data.*
import app.weiban.designsystem.DefaultAvatar
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.defaultAvatarStyle
import app.weiban.designsystem.tokens.WbRadius
import app.weiban.designsystem.tokens.WbSpace
import app.weiban.network.ApiFailure
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import okhttp3.OkHttpClient
import okhttp3.Request
import java.time.Instant
import java.time.ZoneId

/*
 * 人设广场（PLZ-01～PLZ-07；设计 persona-plaza.md；契约 PlazaEndpoints）。
 * 规则：没有私信、关注入口（PLZ-03 第 6 条）；红点不推送；「添加为我的角色」服务器已自动加进通讯录（T-088），
 * 客户端不再调用 POST /contacts。分类、遮盖、永不发布由服务器保证，界面只说明。
 */

/** P-35：评论长度上限。 */
internal const val PLAZA_COMMENT_MAX = 200
internal const val PLAZA_NICKNAME_MAX = 12
internal const val PLAZA_TAGLINE_MAX = 30
internal const val PLAZA_NOTE_MAX = 300
internal const val PLAZA_CHANGE_NOTE_MAX = 100
internal const val PLAZA_REPORT_NOTE_MAX = 200

/** 广场内的页面（全屏浮层，有自己的返回栈）。 */
internal sealed interface PlazaPage {
    data object MyWorks : PlazaPage

    data object Profile : PlazaPage

    data class Work(
        val workId: String,
    ) : PlazaPage

    data class Author(
        val authorId: String,
    ) : PlazaPage

    data class Report(
        val workId: String?,
        val commentId: String?,
    ) : PlazaPage

    data class Publish(
        val characterId: String?,
        val presetId: String?,
    ) : PlazaPage
}

/** 广场浮层的返回栈：任何页面（聊天信息、补充设定、资料页、角色广场分页）都可以推入。 */
internal object PlazaNav {
    val stack = MutableStateFlow<List<PlazaPage>>(emptyList())

    fun open(page: PlazaPage) {
        stack.value = stack.value + page
    }

    fun back() {
        stack.value = stack.value.dropLast(1)
    }

    fun replace(page: PlazaPage) {
        stack.value = stack.value.dropLast(1) + page
    }

    fun close() {
        stack.value = emptyList()
    }
}

/** 本次打开期间已举报过的对象（PLZ-07 第 2 条：菜单变「已举报」）。键为 work:ID / comment:ID。 */
internal object PlazaReported {
    val targets = mutableStateListOf<String>()

    fun add(key: String) {
        if (key !in targets) targets.add(key)
    }
}

/** 作品卡片与作品详情共有的显示字段。 */
internal data class WorkSummary(
    val workId: String,
    val kind: String,
    val name: String,
    val tagline: String,
    val basis: String?,
    val basedOnPresetId: String?,
    val basedOnPresetName: String?,
    val avatarUrl: String?,
    val author: PlazaAuthor,
    val likeCount: Long,
    val adoptCount: Long,
    val adoptedByMe: Boolean,
    val currentVersion: Long,
)

internal fun PlazaWorkCard.summary() =
    WorkSummary(
        workId,
        kind,
        name,
        tagline,
        basis,
        basedOnPresetId,
        basedOnPresetName,
        avatarUrl,
        author,
        likeCount,
        adoptCount,
        adoptedByMe,
        currentVersion,
    )

internal fun PlazaWorkDetail.summary() =
    WorkSummary(
        workId,
        kind,
        name,
        tagline,
        basis,
        basedOnPresetId,
        basedOnPresetName,
        avatarUrl,
        author,
        likeCount,
        adoptCount,
        adoptedByMe,
        currentVersion,
    )

internal val plazaBasisNames = mapOf("original" to "原创", "fictional" to "虚构", "real_person" to "真人")
private val plazaRealKindNames = mapOf("celebrity" to "公众人物", "historical" to "历史人物", "private_person" to "身边真人")

internal val plazaReasonNames =
    listOf(
        "rights" to "侵犯他人权益（肖像、隐私、版权）",
        "hard_boundary" to "违反底线规则（例如儿童角色被标成成年、真人角色被标成原创）",
        "inappropriate" to "不适宜的内容",
        "other" to "其他",
    )

internal val plazaPrivacyNames =
    mapOf(
        "phone" to "手机号",
        "id_number" to "证件号",
        "bank_card" to "银行卡号",
        "email" to "邮箱",
        "address" to "地址",
        "account" to "账号",
        "plate" to "车牌",
        "my_profile" to "我的资料",
        "about_me" to "关于我",
        "my_nickname" to "我的昵称",
        "my_memory" to "记忆中的信息",
        "third_party_name" to "他人姓名",
        "private_event" to "私人经历",
        "other_private" to "私人信息",
    )

/** PLZ-02 第 4 条：永不发布的内容（原文分条）。 */
internal val plazaNeverPublished =
    listOf(
        "聊天记录",
        "记忆（关于我的事、共同经历、约定）",
        "我的资料、「关于我」、专属称呼",
        "关系类型、熟悉度、认识天数、纪念日、卡片、成就",
        "情景模式、人设贴合度、秒回等聊天设置",
        "导入时的原始聊天记录和截图",
        "经期日记等健康数据",
        "宠物",
        "余额与花费",
        "用户为自定义角色之间设定的关系",
    )

internal val plazaStatusNames =
    mapOf(
        "listed" to "展示中",
        "unlisted_by_author" to "已下架",
        "removed_by_admin" to "被管理员下架",
        "author_banned" to "暂不展示",
    )

private const val CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"

internal fun plazaMark(index: Int): String = CIRCLED.getOrNull(index)?.toString() ?: "(${index + 1})"

/** 按字符（码点）计数，与网页 Array.from 一致。 */
internal fun plazaChars(text: String): Int = text.codePointCount(0, text.length)

internal fun classificationText(
    basis: String,
    realPersonKind: String?,
    ageSetting: String,
    childAppearance: Boolean,
): String {
    val head =
        if (basis == "real_person") {
            "真人 · ${plazaRealKindNames[realPersonKind.orEmpty()].orEmpty()}"
        } else {
            "${plazaBasisNames[basis].orEmpty()} · ${if (ageSetting == "minor") "未满 18 岁" else "已满 18 岁"}"
        }
    return if (childAppearance) "$head · 儿童外貌" else head
}

internal fun plazaAuthorName(author: PlazaAuthor): String = if (author.deleted) "已注销用户" else author.nickname

internal fun plazaDate(iso: String): String =
    try {
        val date = Instant.parse(iso).atZone(ZoneId.systemDefault())
        "${date.monthValue} 月 ${date.dayOfMonth} 日"
    } catch (_: Exception) {
        iso.take(10)
    }

internal fun plazaTime(iso: String): String {
    val minutes =
        try {
            (System.currentTimeMillis() - Instant.parse(iso).toEpochMilli()) / 60_000
        } catch (_: Exception) {
            return iso.take(10)
        }
    return when {
        minutes < 1 -> "刚刚"
        minutes < 60 -> "$minutes 分钟前"
        minutes < 1440 -> "${minutes / 60} 小时前"
        else -> plazaDate(iso)
    }
}

internal fun plazaCode(error: Throwable): String = (error as? ApiFailure)?.code.orEmpty()

internal fun plazaToast(
    context: Context,
    text: String,
) {
    Toast.makeText(context, text, Toast.LENGTH_SHORT).show()
}

/** 快照解析（契约里 PlazaSnapshot 为 JSON 联合类型）。 */
internal sealed interface ParsedSnapshot {
    data class Custom(
        val value: PlazaCustomCharacterSnapshot,
    ) : ParsedSnapshot

    data class Variant(
        val value: PlazaPresetVariantSnapshot,
    ) : ParsedSnapshot
}

internal fun parseSnapshot(
    json: Json,
    element: JsonElement,
): ParsedSnapshot? =
    try {
        val kind = element.jsonObject["kind"]?.jsonPrimitive?.contentOrNull
        if (kind == "preset_variant") {
            ParsedSnapshot.Variant(json.decodeFromJsonElement(PlazaPresetVariantSnapshot.serializer(), element))
        } else {
            ParsedSnapshot.Custom(json.decodeFromJsonElement(PlazaCustomCharacterSnapshot.serializer(), element))
        }
    } catch (_: Exception) {
        null
    }

/** 快照里的文字字段（与服务器 fieldKey 一致：name、description、speechStyle、catchphrases.N、exampleDialogue、tags.N、variantText）。 */
internal data class SnapshotField(
    val key: String,
    val label: String,
    val text: String,
)

internal fun snapshotFields(snapshot: ParsedSnapshot): List<SnapshotField> {
    if (snapshot is ParsedSnapshot.Variant) return listOf(SnapshotField("variantText", "改版设定", snapshot.value.variantText))
    val value = (snapshot as ParsedSnapshot.Custom).value
    val rows = mutableListOf(
        SnapshotField("name", "名字", value.name),
        SnapshotField("description", "人设描述", value.description),
        SnapshotField("speechStyle", "说话方式", value.speechStyle),
    )
    value.catchphrases.forEachIndexed { index, text -> rows.add(SnapshotField("catchphrases.$index", if (index == 0) "口头禅" else "", text)) }
    rows.add(SnapshotField("exampleDialogue", "示例对话", value.exampleDialogue))
    value.tags.forEachIndexed { index, text -> rows.add(SnapshotField("tags.$index", if (index == 0) "标签" else "", text)) }
    return rows.filter { it.text.isNotBlank() }
}

internal fun fieldLabel(key: String): String =
    when {
        key.startsWith("catchphrases.") -> "口头禅"
        key.startsWith("tags.") -> "标签"
        key == "name" -> "名字"
        key == "description" -> "人设描述"
        key == "speechStyle" -> "说话方式"
        key == "exampleDialogue" -> "示例对话"
        key == "variantText" -> "改版设定"
        else -> key
    }

/** 按码点切片（片段位置以字符计）。 */
internal fun codePointSlice(
    text: String,
    start: Int,
    end: Int,
): String {
    val count = plazaChars(text)
    val from = start.coerceIn(0, count)
    val to = end.coerceIn(from, count)
    return text.substring(text.offsetByCodePoints(0, from), text.offsetByCodePoints(0, to))
}

// ---------- 头像 ----------

private val plazaHttp by lazy { OkHttpClient() }
private val plazaImages = LruCache<String, ImageBitmap>(64)

private suspend fun loadPlazaImage(url: String): ImageBitmap? =
    withContext(Dispatchers.IO) {
        try {
            plazaHttp.newCall(Request.Builder().url(url).build()).execute().use { response ->
                val bytes = if (response.isSuccessful) response.body?.bytes() else null
                bytes?.let { data ->
                    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    BitmapFactory.decodeByteArray(data, 0, data.size, bounds)
                    var sample = 1
                    while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 256) sample *= 2
                    BitmapFactory
                        .decodeByteArray(data, 0, data.size, BitmapFactory.Options().apply { inSampleSize = sample })
                        ?.asImageBitmap()
                        ?.also { plazaImages.put(url, it) }
                }
            }
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            null
        }
    }

/** 广场头像：有公开图用图，否则非肖像默认头像（default-avatar.md 第 3 节，按 ID 取应援色）。 */
@Composable internal fun PlazaAvatar(
    id: String,
    name: String,
    url: String?,
    size: Dp = 48.dp,
) {
    var image by remember(url) { mutableStateOf(url?.let { plazaImages.get(it) }) }
    LaunchedEffect(url) { if (url != null && image == null) image = loadPlazaImage(url) }
    Box(
        Modifier.size(size).clip(RoundedCornerShape(size * WbRadius.AvatarRatio)).clearAndSetSemantics {
            contentDescription = "${name}头像"
        },
    ) {
        DefaultAvatar(defaultAvatarStyle(id, name.ifBlank { "广" }), size)
        image?.let { Image(it, null, Modifier.size(size), contentScale = ContentScale.Crop) }
    }
}

/** 作品头像（2.3 节）：预设改版用预设角色的头像，其余用作品公开头像或默认头像。 */
@Composable internal fun WorkAvatar(
    repository: SessionRepository,
    owner: OwnerRecord,
    work: WorkSummary,
    preset: CharacterProfile?,
    size: Dp = 48.dp,
) {
    val presetId = work.basedOnPresetId
    if (work.kind == "preset_variant" && presetId != null) {
        RoleAvatar(repository, owner, RoleAvatarIdentity(presetId, preset?.name ?: work.basedOnPresetName.orEmpty(), preset?.avatar), size)
    } else {
        PlazaAvatar(work.workId, work.name, work.avatarUrl, size)
    }
}

@Composable internal fun KindTag(
    work: WorkSummary,
    highlight: Boolean = false,
) {
    val colors = LocalWeibanColors.current
    val text =
        if (work.kind == "preset_variant") {
            "预设改版 · 基于 ${work.basedOnPresetName ?: "预设角色"}"
        } else {
            plazaBasisNames[work.basis.orEmpty()] ?: "自定义"
        }
    Text(
        text,
        Modifier
            .clip(RoundedCornerShape(WbRadius.Xs))
            .background(if (highlight) colors.brandSoft else colors.bgPage)
            .padding(horizontal = WbSpace.S2, vertical = WbSpace.S1),
        color = if (highlight) colors.brandOnSoft else colors.textSecondary,
        style = MaterialTheme.typography.labelSmall,
    )
}

@Composable internal fun RedDot() {
    Box(Modifier.size(8.dp).clip(CircleShape).background(LocalWeibanColors.current.textDanger))
}

@Composable internal fun PlazaHeader(
    title: String,
    trailing: @Composable RowScope.() -> Unit = {},
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        TextButton(onClick = PlazaNav::back) { Text("‹ 返回") }
        Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
        trailing()
    }
}

@Composable internal fun PlazaFootnote(text: String) {
    Text(text, color = LocalWeibanColors.current.textSecondary, style = MaterialTheme.typography.bodySmall)
}

@Composable internal fun CharCount(
    count: Int,
    max: Int,
) {
    val colors = LocalWeibanColors.current
    Text("$count/$max", color = if (count > max) colors.textDanger else colors.textTertiary, style = MaterialTheme.typography.bodySmall)
}

/** 广场红点（PLZ-03 第 4 条：只有红点，不推送）。收到 data.changed(plaza_badge) 时重拉。 */
@Composable internal fun rememberPlazaBadge(
    repository: SessionRepository,
    owner: OwnerRecord,
): PlazaBadge? {
    var badge by remember(owner) { mutableStateOf<PlazaBadge?>(null) }
    LaunchedEffect(owner) {
        suspend fun load() {
            userAction({}) {
                badge = repository.call(Endpoints.plazaEndpointsGetBadge, options = SessionCallOptions(owner = owner, networkOnly = true))
            }
        }
        load()
        AppUpdates.updates.collect { update ->
            if (update is UserUpdateDataChanged && update.data.section == "plaza_badge") load()
        }
    }
    return badge
}
