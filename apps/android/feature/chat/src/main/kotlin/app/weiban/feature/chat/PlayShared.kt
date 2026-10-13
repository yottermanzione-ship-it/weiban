@file:Suppress("TooManyFunctions", "TooGenericExceptionCaught", "LongParameterList")

package app.weiban.feature.chat

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.weiban.contracts.*
import app.weiban.data.*
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.tokens.WbSpace
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/*
 * 五个玩法（PLAY-03～PLAY-07；设计 play.md；契约 play.ts）：每日一问、心愿清单、慢信、陪你专注、TA 的提醒。
 * 共同原则：没有连续天数、完成率、累计时长、排行、「失败」状态（SAFE-08）。数据变化靠 data.changed 重新拉。
 */

/** P-40～P-44 与字数上限（契约 PLAY_LIMITS）。 */
internal const val DAILY_ANSWER_MAX = 200
internal const val WISH_TEXT_MAX = 50
internal const val LETTER_MAX = 2000
internal const val FOCUS_MIN = 5
internal const val FOCUS_MAX = 120
internal const val FOCUS_NOTE_MAX = 30
internal const val REMINDER_TEXT_MAX = 20

internal sealed interface PlayPage {
    data class Daily(
        val characterId: String? = null,
    ) : PlayPage

    data class DailyHistory(
        val answerId: String? = null,
    ) : PlayPage

    data object Wishlists : PlayPage

    data class Wishlist(
        val characterId: String,
    ) : PlayPage

    data object Letters : PlayPage

    data class LetterWrite(
        val characterId: String?,
    ) : PlayPage

    data class LetterRead(
        val letterId: String,
    ) : PlayPage

    data class Focus(
        val characterId: String? = null,
    ) : PlayPage

    data object Reminders : PlayPage

    data class ReminderEdit(
        val reminderId: String?,
        val characterId: String? = null,
    ) : PlayPage
}

internal object PlayNav {
    val stack = MutableStateFlow<List<PlayPage>>(emptyList())

    fun open(page: PlayPage) {
        stack.value = stack.value + page
    }

    fun back() {
        stack.value = stack.value.dropLast(1)
    }

    fun replace(page: PlayPage) {
        stack.value = stack.value.dropLast(1) + page
    }

    fun close() {
        stack.value = emptyList()
    }
}

/** 宿主（服务页宫格、通知点击）打开玩法页。 */
object PlayNavigation {
    /** 支持：daily / wishlists / letters / focus / reminders，以及推送链接 /play/letters/{letterId}。 */
    fun openRoute(route: String): Boolean {
        val path = route.removePrefix("/play/").removePrefix("/")
        val page =
            when {
                path == "daily" -> PlayPage.Daily()
                path == "wishlists" -> PlayPage.Wishlists
                path == "letters" -> PlayPage.Letters
                path == "focus" -> PlayPage.Focus()
                path == "reminders" -> PlayPage.Reminders
                path.startsWith("letters/") -> PlayPage.LetterRead(path.removePrefix("letters/"))
                else -> null
            } ?: return false
        PlayNav.stack.value = listOf(page)
        return true
    }
}

/** 带错误码的远程读取，收到对应 data.changed 时重拉。error 为错误码（网络失败为 network）。 */
internal class PlayRemote<T> {
    var data by mutableStateOf<T?>(null)
    var error by mutableStateOf<String?>(null)
    var loading by mutableStateOf(true)
    var revision by mutableIntStateOf(0)

    fun refresh() {
        revision++
    }
}

@Composable internal fun <T> playRemote(
    key: String,
    section: String?,
    request: suspend () -> T,
): PlayRemote<T> {
    val state = remember(key) { PlayRemote<T>() }
    val action by rememberUpdatedState(request)
    LaunchedEffect(state, state.revision) {
        state.loading = true
        try {
            state.data = action()
            state.error = null
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            state.error = plazaCode(error).ifEmpty { "network" }
        } finally {
            state.loading = false
        }
    }
    if (section != null) {
        LaunchedEffect(state) {
            AppUpdates.updates.collect { update ->
                if (update is UserUpdateDataChanged && update.data.section == section) state.refresh()
            }
        }
    }
    return state
}

internal fun newRequestId(): String = UUID.randomUUID().toString()

internal fun todayText(): String = LocalDate.now().toString()

internal fun epochOf(iso: String): Long? =
    try {
        Instant.parse(iso).toEpochMilli()
    } catch (_: Exception) {
        null
    }

/** 「X 月 X 日」（LocalDate 字符串）。 */
internal fun monthDay(date: String): String =
    try {
        val value = LocalDate.parse(date)
        "${value.monthValue} 月 ${value.dayOfMonth} 日"
    } catch (_: Exception) {
        date
    }

/** 通讯录里已通过的角色（玩法只对已添加的角色）。 */
@Composable internal fun playContacts(
    runtime: ChatRuntime,
    owner: OwnerRecord,
): List<Contact> {
    val snapshot by runtime.snapshot.collectAsState()
    val state = if (snapshot.owner == owner) snapshot.state else SyncEngine.freshState()
    return state.contacts.filter { it.status != "pending" }
}

@Composable internal fun rememberPlayNames(
    repository: SessionRepository,
    contacts: List<Contact>,
    extra: List<String> = emptyList(),
): Map<String, CharacterProfile> = characterProfiles(repository, contacts.map { it.characterId } + extra)

internal fun playName(
    contacts: List<Contact>,
    profiles: Map<String, CharacterProfile>,
    id: String?,
): String {
    if (id == null) return "TA"
    return contacts.find { it.characterId == id }?.remark ?: profiles[id]?.name ?: "TA"
}

/** 跳到和某角色的私聊并关闭玩法浮层。 */
internal fun openChatWith(
    contacts: List<Contact>,
    characterId: String?,
) {
    val conversationId = contacts.find { it.characterId == characterId }?.conversationId ?: return
    PlayNav.close()
    GrowthNavigation.openConversation(conversationId)
}

@Composable internal fun PlayHeader(
    title: String,
    onBack: () -> Unit = PlayNav::back,
    trailing: @Composable RowScope.() -> Unit = {},
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        TextButton(onClick = onBack) { Text("‹ 返回") }
        Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
        trailing()
    }
}

/** 头像横排选角色。 */
@Composable internal fun RolePickerRow(
    repository: SessionRepository,
    owner: OwnerRecord,
    contacts: List<Contact>,
    profiles: Map<String, CharacterProfile>,
    selected: String?,
    onSelect: (String) -> Unit,
) {
    val colors = LocalWeibanColors.current
    if (contacts.isEmpty()) {
        Text("先添加一个角色吧", color = colors.textSecondary)
        return
    }
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(WbSpace.S4)) {
        contacts.forEach { contact ->
            val id = contact.characterId
            val chosen = id == selected
            Column(
                Modifier.clickable { onSelect(id) }.padding(WbSpace.S1),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                RoleAvatar(
                    repository,
                    owner,
                    RoleAvatarIdentity(id, profiles[id]?.name.orEmpty(), profiles[id]?.avatar, contact.customAvatarMediaId),
                    48.dp,
                )
                Text(
                    playName(contacts, profiles, id),
                    color = if (chosen) colors.brandPrimary else colors.textSecondary,
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 1,
                )
                if (chosen) HorizontalDivider(Modifier.width(24.dp), thickness = 2.dp, color = colors.brandPrimary)
            }
        }
    }
}

/** 选角色弹窗（写信、新建提醒）。 */
@Composable internal fun RolePickerDialog(
    repository: SessionRepository,
    owner: OwnerRecord,
    contacts: List<Contact>,
    profiles: Map<String, CharacterProfile>,
    title: String,
    onDismiss: () -> Unit,
    onSelect: (String) -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { RolePickerRow(repository, owner, contacts, profiles, null, onSelect) },
        confirmButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

/**
 * 玩法浮层：盖在所有页面上，按 PlayNav 返回栈显示各页。由 GrowthShareOverlay 放置；顶部专注胶囊也在这里。
 */
@Composable internal fun PlayOverlay(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
) {
    val stack by PlayNav.stack.collectAsState()
    DisposableEffect(owner) { onDispose { PlayNav.close() } }
    val page = stack.lastOrNull()
    if (page !is PlayPage.Focus) FocusCapsule(repository, owner)
    if (page == null) return
    val colors = LocalWeibanColors.current
    BackHandler(onBack = PlayNav::back)
    Surface(Modifier.fillMaxSize(), color = colors.bgPage) {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            key(stack.size, page) {
                when (page) {
                    is PlayPage.Daily -> DailyQuestionPage(repository, runtime, owner, page.characterId)
                    is PlayPage.DailyHistory -> DailyHistoryPage(repository, runtime, owner, page.answerId)
                    PlayPage.Wishlists -> WishlistsPage(repository, runtime, owner)
                    is PlayPage.Wishlist -> WishlistPage(repository, runtime, owner, page.characterId)
                    PlayPage.Letters -> LettersPage(repository, runtime, owner)
                    is PlayPage.LetterWrite -> LetterWritePage(repository, runtime, owner, page.characterId)
                    is PlayPage.LetterRead -> LetterReadPage(repository, runtime, owner, page.letterId)
                    is PlayPage.Focus -> FocusPage(repository, runtime, owner, page.characterId)
                    PlayPage.Reminders -> RemindersPage(repository, runtime, owner)
                    is PlayPage.ReminderEdit -> ReminderEditPage(repository, runtime, owner, page.reminderId, page.characterId)
                }
            }
        }
    }
}

/** 收起专注页后顶部显示的专注胶囊（play.md 第 5 节）：倒计时按服务器 endsAt。 */
@Composable private fun FocusCapsule(
    repository: SessionRepository,
    owner: OwnerRecord,
) {
    val active =
        playRemote("${owner.sessionId}:focus-capsule", "focus") {
            repository.call(Endpoints.focusEndpointsGetActive, options = SessionCallOptions(owner = owner, networkOnly = true))
        }
    val session = active.data?.session?.takeIf { it.result == "in_progress" } ?: return
    val end = epochOf(session.endsAt) ?: return
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(session.focusId) {
        while (true) {
            now = System.currentTimeMillis()
            if (now >= end) {
                active.refresh()
                break
            }
            delay(1_000)
        }
    }
    if (now >= end) return
    Box(Modifier.fillMaxWidth().statusBarsPadding().padding(top = WbSpace.S2), contentAlignment = Alignment.TopCenter) {
        Surface(
            Modifier.clickable { PlayNav.open(PlayPage.Focus(session.characterId)) },
            shape = MaterialTheme.shapes.extraLarge,
            tonalElevation = WbSpace.S2,
            shadowElevation = WbSpace.S2,
        ) {
            Text("专注中 · ${clockText(end - now)}", Modifier.padding(horizontal = WbSpace.S5, vertical = WbSpace.S2))
        }
    }
}

/** 剩余时间「mm:ss」。 */
internal fun clockText(millis: Long): String {
    val seconds = (millis.coerceAtLeast(0) + 999) / 1000
    return "%02d:%02d".format(java.util.Locale.ROOT, seconds / 60, seconds % 60)
}
