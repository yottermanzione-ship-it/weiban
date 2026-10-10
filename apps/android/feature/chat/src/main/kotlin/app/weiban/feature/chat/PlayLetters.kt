@file:Suppress("TooGenericExceptionCaught", "LongMethod", "CyclomaticComplexMethod", "LongParameterList")

package app.weiban.feature.chat

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import app.weiban.contracts.*
import app.weiban.data.*
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.tokens.WbSpace
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

// ---------- 慢信（PLAY-05） ----------

private val letterBoxes = listOf("received" to "收到的", "sent" to "寄出的", "drafts" to "草稿")

@Composable internal fun ColumnScope.LettersPage(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
) {
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    val contacts = playContacts(runtime, owner)
    var box by remember { mutableStateOf("received") }
    var picking by remember { mutableStateOf(false) }
    val items = remember(box) { mutableStateListOf<Letter>() }
    var cursor by remember(box) { mutableStateOf<String?>(null) }
    var loading by remember(box) { mutableStateOf(true) }
    var failed by remember(box) { mutableStateOf(false) }
    var revision by remember { mutableIntStateOf(0) }
    suspend fun load(after: String?) {
        loading = true
        failed = false
        try {
            val page =
                repository.call(
                    Endpoints.letterEndpointsListLetters,
                    query =
                        buildMap {
                            put("box", box)
                            after?.let { put("cursor", it) }
                        },
                    options = SessionCallOptions(owner = owner, networkOnly = true),
                )
            if (after == null) items.clear()
            items.addAll(page.items)
            cursor = page.nextCursor
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            failed = true
        } finally {
            loading = false
        }
    }
    val stack by PlayNav.stack.collectAsState()
    // 换分栏、从读信 / 写信返回、收到 data.changed(letters) 时重拉。
    LaunchedEffect(box, stack.size, revision) { load(null) }
    LaunchedEffect(Unit) {
        AppUpdates.updates.collect { if (it is UserUpdateDataChanged && it.data.section == "letters") revision++ }
    }
    val profiles = rememberPlayNames(repository, contacts, items.map { it.characterId })
    PlayHeader("信箱") { TextButton(onClick = { picking = true }) { Text("写信") } }
    Row(Modifier.fillMaxWidth().padding(horizontal = WbSpace.S5), horizontalArrangement = Arrangement.spacedBy(WbSpace.S2)) {
        letterBoxes.forEach { (id, label) -> FilterChip(selected = box == id, onClick = { box = id }, label = { Text(label) }) }
    }
    Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())) {
        if (loading && items.isEmpty()) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (failed && items.isEmpty()) {
            Text("加载失败", Modifier.padding(WbSpace.S5))
            TextButton(onClick = { scope.launch { load(null) } }) { Text("重试") }
        }
        if (!loading && !failed && items.isEmpty()) {
            Text(
                when (box) {
                    "received" -> "还没有收到信"
                    "sent" -> "还没有寄出过信"
                    else -> "没有草稿"
                },
                Modifier.padding(WbSpace.S5),
                color = colors.textSecondary,
            )
        }
        items.forEach { letter ->
            val name = playName(contacts, profiles, letter.characterId)
            val inTransit = letter.status == "in_transit"
            val unread = box == "received" && !inTransit && letter.readAt == null
            val preview =
                when {
                    inTransit ->
                        "信件在路上" + if (letter.expectedDeliveryDate == todayText()) "，预计今天送到" else ""
                    else -> letter.body.orEmpty().lineSequence().firstOrNull().orEmpty().take(40)
                }
            Row(
                Modifier
                    .fillMaxWidth()
                    .clickable(enabled = !inTransit) {
                        if (box == "drafts") {
                            PlayNav.open(PlayPage.LetterWrite(letter.characterId))
                        } else {
                            PlayNav.open(PlayPage.LetterRead(letter.letterId))
                        }
                    }.padding(horizontal = WbSpace.S5, vertical = WbSpace.S3),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(WbSpace.S3),
            ) {
                if (unread) RedDot() else Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f)) {
                    Text(if (box == "received") "来自 $name" else "写给 $name", style = MaterialTheme.typography.titleSmall)
                    Text(preview, color = colors.textSecondary, maxLines = 1)
                }
                (letter.deliveredAt ?: letter.sentAt ?: letter.updatedAt).let {
                    Text(plazaDate(it), color = colors.textTertiary, style = MaterialTheme.typography.bodySmall)
                }
            }
            HorizontalDivider()
        }
        val next = cursor
        if (next != null) TextButton(onClick = { scope.launch { load(next) } }, enabled = !loading) { Text("加载更多") }
    }
    if (picking) {
        RolePickerDialog(repository, owner, contacts, profiles, "写信给谁", { picking = false }) {
            picking = false
            PlayNav.open(PlayPage.LetterWrite(it))
        }
    }
}

@Composable internal fun ColumnScope.LetterWritePage(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    initialCharacterId: String?,
) {
    val context = LocalContext.current
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    val contacts = playContacts(runtime, owner)
    var characterId by remember { mutableStateOf(initialCharacterId) }
    val profiles = rememberPlayNames(repository, contacts, listOfNotNull(characterId))
    val target = characterId
    if (target == null) {
        PlayHeader("写信")
        Column(Modifier.padding(WbSpace.S5), verticalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
            Text("写信给谁")
            RolePickerRow(repository, owner, contacts, profiles, null) { characterId = it }
        }
        return
    }
    var body by remember(target) { mutableStateOf("") }
    var original by remember(target) { mutableStateOf("") }
    var repliedToday by remember(target) { mutableStateOf(false) }
    var leaving by remember { mutableStateOf(false) }
    var sending by remember { mutableStateOf(false) }
    // 自动带出该角色的草稿；当天已收到过 TA 的回信时说明会晚一些。
    LaunchedEffect(target) {
        userAction({}) {
            val drafts =
                repository.call(
                    Endpoints.letterEndpointsListLetters,
                    query = mapOf("box" to "drafts", "characterId" to target),
                    options = SessionCallOptions(owner = owner, networkOnly = true),
                )
            val draft = drafts.items.firstOrNull()?.body.orEmpty()
            if (body.isEmpty()) body = draft
            original = draft
        }
        userAction({}) {
            val received =
                repository.call(
                    Endpoints.letterEndpointsListLetters,
                    query = mapOf("box" to "received", "characterId" to target),
                    options = SessionCallOptions(owner = owner, networkOnly = true),
                )
            repliedToday = received.items.any { letter -> letter.deliveredAt?.let { plazaDate(it) } == plazaDate(java.time.Instant.now().toString()) }
        }
    }
    val name = playName(contacts, profiles, target)
    val changed = body != original
    val cancel: () -> Unit = {
        if (changed) {
            leaving = true
        } else {
            PlayNav.back()
        }
    }
    BackHandler(onBack = cancel)
    PlayHeader("写给 $name", onBack = cancel)
    Column(
        Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(WbSpace.S5),
        verticalArrangement = Arrangement.spacedBy(WbSpace.S3),
    ) {
        // 信纸样式、衬线字体。
        Box(Modifier.fillMaxWidth().background(colors.bgSurface).padding(WbSpace.S4)) {
            TextField(
                body,
                { body = it },
                Modifier.fillMaxWidth(),
                minLines = 12,
                textStyle = MaterialTheme.typography.bodyLarge.copy(fontFamily = FontFamily.Serif),
                placeholder = { Text("亲爱的 $name：", fontFamily = FontFamily.Serif) },
            )
        }
        CharCount(plazaChars(body), LETTER_MAX)
        PlazaFootnote(if (repliedToday) "TA 今天已经回过一封信了，这封的回信会晚一些到" else "回信会在 6–24 小时后寄到")
    }
    Row(
        Modifier.fillMaxWidth().padding(horizontal = WbSpace.S5, vertical = WbSpace.S2),
        horizontalArrangement = Arrangement.spacedBy(WbSpace.S3),
    ) {
        OutlinedButton(onClick = cancel, modifier = Modifier.weight(1f)) { Text("取消") }
        Button(
            onClick = {
                sending = true
                scope.launch {
                    try {
                        val result =
                            repository.call(
                                Endpoints.letterEndpointsSendLetter,
                                body =
                                    buildJsonObject {
                                        put("clientRequestId", newRequestId())
                                        put("characterId", target)
                                        put("body", body.trim())
                                    },
                                options = SessionCallOptions(owner = owner),
                            )
                        plazaToast(
                            context,
                            if (result.replyDelayed) "信已寄出。TA 今天已经回过一封信了，这封的回信会晚一些到" else "信已寄出，TA 的回信在路上",
                        )
                        if (contacts.any { it.characterId == target && it.conversationId != null }) {
                            openChatWith(contacts, target)
                        } else {
                            PlayNav.back()
                        }
                    } catch (error: CancellationException) {
                        throw error
                    } catch (_: Exception) {
                        plazaToast(context, "没寄出去，请重试")
                    } finally {
                        sending = false
                    }
                }
            },
            enabled = !sending && body.isNotBlank() && plazaChars(body) <= LETTER_MAX,
            modifier = Modifier.weight(1f),
        ) { Text("寄出") }
    }
    if (leaving) {
        AlertDialog(
            onDismissRequest = { leaving = false },
            title = { Text("要保存草稿吗？") },
            text = { Text("下次给 $name 写信时会自动带出") },
            confirmButton = {
                TextButton(onClick = {
                    leaving = false
                    scope.launch {
                        userAction({ plazaToast(context, it) }) {
                            repository.call(
                                Endpoints.letterEndpointsSaveDraft,
                                params = mapOf("characterId" to target),
                                body = buildJsonObject { put("body", codePointSlice(body, 0, LETTER_MAX)) },
                                options = SessionCallOptions(owner = owner),
                            )
                            plazaToast(context, "已保存草稿")
                            PlayNav.back()
                        }
                    }
                }) { Text("保存草稿") }
            },
            dismissButton = {
                Row {
                    TextButton(onClick = {
                        leaving = false
                        PlayNav.back()
                    }) { Text("不保存") }
                    TextButton(onClick = { leaving = false }) { Text("继续写") }
                }
            },
        )
    }
}

/** 读信（推送链接 /play/letters/{id}，打开即已读）：收藏、生成分享图、回信。 */
@Composable internal fun ColumnScope.LetterReadPage(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    letterId: String,
) {
    val context = LocalContext.current
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    val contacts = playContacts(runtime, owner)
    val letter =
        playRemote("${owner.sessionId}:letter:$letterId", null) {
            repository.call(
                Endpoints.letterEndpointsGetLetter,
                params = mapOf("letterId" to letterId),
                options = SessionCallOptions(owner = owner, networkOnly = true),
            )
        }
    val data = letter.data
    val profiles = rememberPlayNames(repository, contacts, listOfNotNull(data?.characterId))
    PlayHeader("信")
    if (data == null) {
        when {
            letter.loading -> LinearProgressIndicator(Modifier.fillMaxWidth())
            letter.error == "not_found" -> Text("这封信已经看不到了", Modifier.padding(WbSpace.S5), color = colors.textSecondary)
            else ->
                Column(Modifier.padding(WbSpace.S5)) {
                    Text("加载失败")
                    TextButton(onClick = letter::refresh) { Text("重试") }
                }
        }
        return
    }
    val name = playName(contacts, profiles, data.characterId)
    val fromCharacter = data.direction == "from_character"
    val conversationId = contacts.find { it.characterId == data.characterId }?.conversationId
    val messageId = data.messageId
    Column(
        Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(WbSpace.S5),
        verticalArrangement = Arrangement.spacedBy(WbSpace.S3),
    ) {
        Text(if (fromCharacter) "来自 $name" else "写给 $name", style = MaterialTheme.typography.titleMedium)
        Box(Modifier.fillMaxWidth().background(colors.bgSurface).padding(WbSpace.S5)) {
            if (data.status == "in_transit" || data.body == null) {
                Text("信件在路上", color = colors.textSecondary, fontFamily = FontFamily.Serif)
            } else {
                Text(data.body.orEmpty(), fontFamily = FontFamily.Serif, style = MaterialTheme.typography.bodyLarge)
            }
        }
        (data.deliveredAt ?: data.sentAt)?.let { Text(plazaDate(it), color = colors.textTertiary, style = MaterialTheme.typography.bodySmall) }
    }
    if (data.body != null) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = WbSpace.S5, vertical = WbSpace.S2),
            horizontalArrangement = Arrangement.spacedBy(WbSpace.S2),
        ) {
            if (conversationId != null && messageId != null) {
                OutlinedButton(onClick = {
                    scope.launch {
                        userAction({ plazaToast(context, "收藏失败，请稍后再试") }) {
                            repository.call(
                                Endpoints.libraryEndpointsAddFavorites,
                                body =
                                    buildJsonObject {
                                        put(
                                            "items",
                                            JsonArray(
                                                listOf(
                                                    buildJsonObject {
                                                        put("kind", "message")
                                                        put("conversationId", conversationId)
                                                        put("messageId", messageId)
                                                    },
                                                ),
                                            ),
                                        )
                                    },
                                options = SessionCallOptions(owner = owner),
                            )
                            plazaToast(context, "已收藏")
                        }
                    }
                }) { Text("收藏") }
                OutlinedButton(onClick = { L6Overlays.shareMessages(conversationId, listOf(messageId)) }) { Text("分享图") }
            }
            if (fromCharacter) {
                Button(onClick = { PlayNav.open(PlayPage.LetterWrite(data.characterId)) }, modifier = Modifier.weight(1f)) { Text("回信") }
            }
        }
    }
}
