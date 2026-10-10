@file:Suppress("TooGenericExceptionCaught", "LongMethod", "CyclomaticComplexMethod", "LongParameterList")

package app.weiban.feature.chat

import android.app.DatePickerDialog
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import app.weiban.contracts.*
import app.weiban.data.*
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.tokens.WbSpace
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import java.time.LocalDate

// ---------- 每日一问（PLAY-03） ----------

@Composable internal fun ColumnScope.DailyQuestionPage(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    initialCharacterId: String?,
) {
    val context = LocalContext.current
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    val contacts = playContacts(runtime, owner)
    val profiles = rememberPlayNames(repository, contacts)
    var selected by remember { mutableStateOf(initialCharacterId) }
    // 换角色时题目随之变化，已输入的回答保留。
    var answer by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    val today =
        playRemote("${owner.sessionId}:daily:$selected", "daily_question") {
            repository.call(
                Endpoints.dailyQuestionEndpointsGetToday,
                query = buildMap { selected?.let { put("characterId", it) } },
                options = SessionCallOptions(owner = owner, networkOnly = true),
            )
        }
    val data = today.data
    // TA 的答案生成中：除 data.changed 外每 5 秒再看一次。
    LaunchedEffect(data?.answer?.characterAnswerStatus) {
        if (data?.answer?.characterAnswerStatus == "pending") {
            delay(5_000)
            today.refresh()
        }
    }
    PlayHeader("每日一问") { TextButton(onClick = { PlayNav.open(PlayPage.DailyHistory()) }) { Text("历史") } }
    Column(
        Modifier
            .weight(1f)
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(WbSpace.S5),
        verticalArrangement = Arrangement.spacedBy(WbSpace.S4),
    ) {
        val answered = data?.answer
        if (answered == null) {
            RolePickerRow(repository, owner, contacts, profiles, selected ?: data?.characterId) { selected = it }
        }
        when {
            today.loading && data == null -> LinearProgressIndicator(Modifier.fillMaxWidth())
            today.error == "not_found" && data == null ->
                Text("今天没有合适的题目，明天再来吧", color = colors.textSecondary)
            today.error != null && data == null -> {
                Text("加载失败")
                TextButton(onClick = today::refresh) { Text("重试") }
            }
        }
        if (data != null) {
            val name = playName(contacts, profiles, data.characterId)
            Text(monthDay(data.date), color = colors.textTertiary, style = MaterialTheme.typography.bodySmall)
            Text(data.question, style = MaterialTheme.typography.titleLarge)
            if (answered == null) {
                val count = plazaChars(answer)
                OutlinedTextField(
                    answer,
                    { answer = it },
                    Modifier.fillMaxWidth(),
                    minLines = 4,
                    label = { Text("写下你的回答") },
                    supportingText = { CharCount(count, DAILY_ANSWER_MAX) },
                )
                PlazaFootnote("提交后才能看到 TA 的答案；回答不能修改")
                Button(
                    onClick = {
                        sending = true
                        scope.launch {
                            try {
                                today.data =
                                    repository.call(
                                        Endpoints.dailyQuestionEndpointsAnswer,
                                        body =
                                            buildJsonObject {
                                                put("clientRequestId", newRequestId())
                                                put("characterId", data.characterId)
                                                put("questionId", data.questionId)
                                                put("answer", answer.trim())
                                            },
                                        options = SessionCallOptions(owner = owner),
                                    )
                                answer = ""
                            } catch (error: CancellationException) {
                                throw error
                            } catch (error: Exception) {
                                // 今天已经答过（409）：刷新为只读。
                                if (plazaCode(error) == "already_answered" || plazaCode(error) == "conflict") {
                                    today.refresh()
                                } else {
                                    plazaToast(context, "没成功，请重试")
                                }
                            } finally {
                                sending = false
                            }
                        }
                    },
                    enabled = !sending && answer.isNotBlank() && count <= DAILY_ANSWER_MAX,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("提交") }
            } else {
                Text("我", color = colors.textSecondary, style = MaterialTheme.typography.labelMedium)
                Text(answered.userAnswer)
                Text(name, color = colors.textSecondary, style = MaterialTheme.typography.labelMedium)
                when (answered.characterAnswerStatus) {
                    "ready" -> Text(answered.characterAnswer.orEmpty())
                    "waiting_balance" -> {
                        Text("余额不足，TA 暂时没法回答", color = colors.textDanger)
                        PlazaFootnote("可在 我 › 服务 › 余额与账单 查看余额")
                    }
                    else -> Text("TA 正在想…", color = colors.textTertiary)
                }
                TextButton(onClick = { openChatWith(contacts, data.characterId) }) { Text("去和 $name 聊聊 ›") }
            }
        }
    }
}

@Composable internal fun ColumnScope.DailyHistoryPage(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    focusAnswerId: String?,
) {
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    val contacts = playContacts(runtime, owner)
    val items = remember { mutableStateListOf<DailyAnswerHistoryItem>() }
    var cursor by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var failed by remember { mutableStateOf(false) }
    var open by remember { mutableStateOf(focusAnswerId) }

    suspend fun load(after: String?) {
        loading = true
        failed = false
        try {
            val page =
                repository.call(
                    Endpoints.dailyQuestionEndpointsListHistory,
                    query = buildMap { after?.let { put("cursor", it) } },
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
    LaunchedEffect(Unit) { load(null) }
    val profiles = rememberPlayNames(repository, contacts, items.map { it.characterId })
    PlayHeader("历史")
    Column(
        Modifier
            .weight(1f)
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(WbSpace.S5),
        verticalArrangement = Arrangement.spacedBy(WbSpace.S3),
    ) {
        if (loading && items.isEmpty()) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (failed && items.isEmpty()) {
            Text("加载失败")
            TextButton(onClick = { scope.launch { load(null) } }) { Text("重试") }
        }
        if (!loading && !failed && items.isEmpty()) Text("还没有答过的题", color = colors.textSecondary)
        items.forEach { item ->
            val name = playName(contacts, profiles, item.characterId)
            Column(Modifier.fillMaxWidth().clickable { open = if (open == item.answerId) null else item.answerId }) {
                Text("${monthDay(item.date)} · $name", color = colors.textTertiary, style = MaterialTheme.typography.bodySmall)
                Text(item.question, style = MaterialTheme.typography.titleSmall)
                if (open == item.answerId) {
                    Text("我：${item.userAnswer}")
                    Text("$name：${item.characterAnswer ?: "TA 还没有回答"}")
                }
            }
            HorizontalDivider()
        }
        val next = cursor
        if (next != null) TextButton(onClick = { scope.launch { load(next) } }, enabled = !loading) { Text("加载更多") }
    }
}

// ---------- 心愿清单（PLAY-04） ----------

@Composable internal fun ColumnScope.WishlistsPage(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
) {
    val colors = LocalWeibanColors.current
    val contacts = playContacts(runtime, owner)
    val summaries =
        playRemote("${owner.sessionId}:wishlists", "wishlist") {
            repository.call(Endpoints.wishlistEndpointsListSummaries, options = SessionCallOptions(owner = owner, networkOnly = true)).items
        }
    val counts = summaries.data.orEmpty().associateBy { it.characterId }
    val ids = (summaries.data.orEmpty().map { it.characterId } + contacts.map { it.characterId }).distinct()
    val profiles = rememberPlayNames(repository, contacts, ids)
    PlayHeader("心愿清单")
    if (summaries.loading && summaries.data == null) LinearProgressIndicator(Modifier.fillMaxWidth())
    if (summaries.error != null && summaries.data == null) {
        Column(Modifier.padding(WbSpace.S5)) {
            Text("加载失败")
            TextButton(onClick = summaries::refresh) { Text("重试") }
        }
    }
    Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())) {
        if (ids.isEmpty() && summaries.data != null) Text("先添加一个角色，再一起写心愿吧", Modifier.padding(WbSpace.S5), color = colors.textSecondary)
        ids.forEach { id ->
            val summary = counts[id]
            ListItem(
                leadingContent = {
                    RoleAvatar(
                        repository,
                        owner,
                        RoleAvatarIdentity(id, profiles[id]?.name.orEmpty(), profiles[id]?.avatar),
                        40.dp,
                    )
                },
                headlineContent = { Text(playName(contacts, profiles, id)) },
                supportingContent = {
                    Text(if (summary == null || summary.total == 0L) "还没有心愿" else "${summary.total} 件心愿 · 完成 ${summary.completed} 件")
                },
                modifier = Modifier.clickable { PlayNav.open(PlayPage.Wishlist(id)) },
            )
            HorizontalDivider()
        }
    }
}

@Composable internal fun ColumnScope.WishlistPage(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    characterId: String,
) {
    val context = LocalContext.current
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    val contacts = playContacts(runtime, owner)
    val profiles = rememberPlayNames(repository, contacts, listOf(characterId))
    val list =
        playRemote("${owner.sessionId}:wishlist:$characterId", "wishlist") {
            repository.call(
                Endpoints.wishlistEndpointsListItems,
                params = mapOf("characterId" to characterId),
                options = SessionCallOptions(owner = owner, networkOnly = true),
            )
        }
    var adding by remember { mutableStateOf("") }
    var pending by remember { mutableStateOf(false) }
    var showDone by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<WishlistItem?>(null) }
    val items = list.data?.items.orEmpty()
    val limit = list.data?.limit ?: 50L
    val full = items.size >= limit
    val open = items.filter { it.completedAt == null }
    val done = items.filter { it.completedAt != null }

    fun update(
        item: WishlistItem,
        body: JsonObject,
        after: (WishlistItem) -> Unit = {},
    ) {
        pending = true
        scope.launch {
            try {
                val result =
                    repository.call(
                        Endpoints.wishlistEndpointsUpdateItem,
                        params = mapOf("itemId" to item.itemId),
                        body = body,
                        options = SessionCallOptions(owner = owner),
                    )
                list.refresh()
                after(result)
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                plazaToast(context, "没成功，请重试")
            } finally {
                pending = false
            }
        }
    }

    fun add() {
        val text = adding.trim()
        if (text.isEmpty() || plazaChars(text) > WISH_TEXT_MAX) return
        pending = true
        scope.launch {
            try {
                repository.call(
                    Endpoints.wishlistEndpointsAddItem,
                    params = mapOf("characterId" to characterId),
                    body =
                        buildJsonObject {
                            put("clientRequestId", newRequestId())
                            put("text", text)
                        },
                    options = SessionCallOptions(owner = owner),
                )
                adding = ""
                list.refresh()
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                plazaToast(context, if (plazaCode(error) == "limit_reached") "最多 50 件心愿" else "没成功，请重试")
            } finally {
                pending = false
            }
        }
    }

    PlayHeader("和 ${playName(contacts, profiles, characterId)} 的心愿清单")
    Column(
        Modifier
            .weight(1f)
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(WbSpace.S5),
        verticalArrangement = Arrangement.spacedBy(WbSpace.S2),
    ) {
        if (list.loading && list.data == null) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (list.error != null && list.data == null) {
            Text("加载失败")
            TextButton(onClick = list::refresh) { Text("重试") }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(WbSpace.S2)) {
            OutlinedTextField(
                adding,
                { adding = it },
                Modifier.weight(1f),
                singleLine = true,
                enabled = !full,
                label = { Text("想和 TA 一起做的事") },
                supportingText = { CharCount(plazaChars(adding), WISH_TEXT_MAX) },
            )
            Button(
                onClick = ::add,
                enabled = !full && !pending && adding.isNotBlank() && plazaChars(adding) <= WISH_TEXT_MAX,
            ) { Text("添加") }
        }
        if (full) Text("最多 50 件心愿", color = colors.textDanger, style = MaterialTheme.typography.bodySmall)
        if (list.data != null && items.isEmpty()) Text("还没有心愿，写下第一件想一起做的事吧", color = colors.textSecondary)
        open.forEach { item ->
            WishRow(item, pending, { editing = item }) {
                update(item, buildJsonObject { put("completed", true) }) { result ->
                    plazaToast(context, if (result.cardIssued) "完成啦，获得一张瞬间卡" else "完成啦")
                }
            }
        }
        if (done.isNotEmpty()) {
            TextButton(onClick = { showDone = !showDone }) { Text((if (showDone) "收起" else "已完成") + " ${done.size} 件") }
            if (showDone) {
                done.forEach { item ->
                    WishRow(item, pending, { editing = item }) { update(item, buildJsonObject { put("completed", false) }) }
                }
            }
        }
    }
    editing?.let { item ->
        WishEditDialog(item, pending, { editing = null }, { body ->
            editing = null
            update(item, body)
        }) {
            editing = null
            pending = true
            scope.launch {
                userAction({ plazaToast(context, it) }) {
                    repository.call(
                        Endpoints.wishlistEndpointsDeleteItem,
                        params = mapOf("itemId" to item.itemId),
                        options = SessionCallOptions(owner = owner),
                    )
                    list.refresh()
                }
                pending = false
            }
        }
    }
}

@Composable private fun WishRow(
    item: WishlistItem,
    pending: Boolean,
    onOpen: () -> Unit,
    onToggle: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    Row(Modifier.fillMaxWidth().clickable(onClick = onOpen), verticalAlignment = Alignment.CenterVertically) {
        // 只能由用户打勾（PLAY-04）。
        Checkbox(item.completedAt != null, { onToggle() }, enabled = !pending)
        Column(Modifier.weight(1f)) {
            Text(item.text, color = if (item.completedAt != null) colors.textTertiary else colors.textPrimary)
            Row(horizontalArrangement = Arrangement.spacedBy(WbSpace.S2)) {
                if (item.proposedByCharacter) Text("TA 提议", color = colors.brandPrimary, style = MaterialTheme.typography.labelSmall)
                item.dueDate?.let {
                    Text(
                        "${monthDay(it)} · 约定",
                        color = colors.textSecondary,
                        style = MaterialTheme.typography.labelSmall,
                    )
                }
            }
        }
    }
}

@Composable private fun WishEditDialog(
    item: WishlistItem,
    pending: Boolean,
    onDismiss: () -> Unit,
    onSave: (JsonObject) -> Unit,
    onDelete: () -> Unit,
) {
    val context = LocalContext.current
    var text by remember(item.itemId) { mutableStateOf(item.text) }
    var date by remember(item.itemId) { mutableStateOf(item.dueDate) }
    var confirmDelete by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("心愿") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(WbSpace.S2)) {
                OutlinedTextField(
                    text,
                    { text = it },
                    Modifier.fillMaxWidth(),
                    supportingText = { CharCount(plazaChars(text), WISH_TEXT_MAX) },
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(date?.let { "${monthDay(it)} · 约定" } ?: "还没定日期", Modifier.weight(1f))
                    TextButton(onClick = {
                        val base = date?.let { runCatching { LocalDate.parse(it) }.getOrNull() } ?: LocalDate.now()
                        DatePickerDialog(context, { _, year, month, day ->
                            date = LocalDate.of(year, month + 1, day).toString()
                        }, base.year, base.monthValue - 1, base.dayOfMonth).show()
                    }) { Text("定日期") }
                    if (date != null) TextButton(onClick = { date = null }) { Text("取消日期") }
                }
                PlazaFootnote("定了日期，TA 到时会来问你")
                TextButton(onClick = { confirmDelete = true }) { Text("删除", color = LocalWeibanColors.current.textDanger) }
            }
        },
        confirmButton = {
            TextButton(enabled = !pending && text.isNotBlank() && plazaChars(text) <= WISH_TEXT_MAX, onClick = {
                onSave(
                    buildJsonObject {
                        if (text.trim() != item.text) put("text", text.trim())
                        if (date != item.dueDate) put("dueDate", date?.let(::JsonPrimitive) ?: JsonNull)
                    },
                )
            }) { Text("保存") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
    if (confirmDelete) {
        PlazaConfirm("删除这件心愿？", if (item.dueDate != null) "有日期的约定会一并取消" else null, "删除", { confirmDelete = false }) {
            confirmDelete = false
            onDelete()
        }
    }
}
