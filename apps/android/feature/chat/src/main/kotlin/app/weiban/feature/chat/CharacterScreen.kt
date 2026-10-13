package app.weiban.feature.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.weiban.core.designsystem.R as DsR
import app.weiban.contracts.*
import app.weiban.data.*
import app.weiban.designsystem.ActionSheet
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.LocalWeibanModeColors
import app.weiban.designsystem.MenuGroup
import app.weiban.designsystem.MenuRow
import app.weiban.designsystem.SheetAction
import app.weiban.designsystem.WbIcon
import app.weiban.designsystem.hairline
import app.weiban.designsystem.pressable
import app.weiban.designsystem.wbText
import app.weiban.network.ApiFailure
import kotlinx.coroutines.*
import kotlinx.serialization.json.encodeToJsonElement

@Suppress("LongParameterList") // 首次本机构建（2026-10-11）：保留既有逻辑，复杂度待重构
private class CharacterUi(
    private val repository: SessionRepository,
    private val runtime: ChatRuntime,
    private val owner: OwnerRecord,
    private val characterId: String,
    private val scope: CoroutineScope,
    initialGreeting: String,
    private val referrerCharacterId: String? = null,
) {
    var dismissed by mutableStateOf(false)

    /** 名片「不感兴趣」（CHR-04 第 4 条）：直接生效，不二次确认。 */
    fun dismiss() {
        if (referrerCharacterId == null || pending) return
        pending = true
        scope.launch {
            try {
                userAction({ error = it }) {
                    repository.call(
                        Endpoints.contactCardEndpointsDismissRecommendation,
                        params = mapOf("characterId" to characterId),
                        options = SessionCallOptions(owner = owner),
                    )
                    dismissed = true
                }
            } finally {
                pending = false
            }
        }
    }

    var greeting by mutableStateOf(initialGreeting)
    var pending by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    var restore by mutableStateOf(false)
    var added by mutableStateOf<Contact?>(null)

    fun add(mode: String? = null) {
        if (pending) return
        pending = true
        error = null
        scope.launch {
            userAction({ error = it }) {
                try {
                    added =
                        repository.call(
                            Endpoints.contactsEndpointsAdd,
                            body =
                                repository.api.json.encodeToJsonElement(
                                    AddContactRequestInput(characterId, greeting.ifBlank { null }, mode, referrerCharacterId),
                                ),
                            options = SessionCallOptions(owner = owner),
                        )
                    restore = false
                    runtime.refresh(owner)
                } catch (failure: ApiFailure) {
                    if (failure.code == "restore_choice_required") restore = true else error = contactError(failure)
                } finally {
                    pending = false
                }
            }
        }
    }
}

/**
 * 角色资料页（规格 4.12）：头卡（头像 64 圆角 8、名字 20/700 + 星标、昵称 / 微伴号 / 签名、认识天数与熟悉度）→
 * 设置备注和头像 ｜ 朋友圈 · TA 的近况 · TA 记得的事 ｜ 卡册 · 关系类型 · 简介与作品 ｜ 动作行（发消息 · 语音通话，link 色）。
 * 未添加：打招呼输入 +「添加到通讯录」，发出后「等待通过…」。
 */
@Composable internal fun ColumnScope.CharacterScreen(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    state: ClientSyncState,
    characterId: String,
    onOpenConversation: (String) -> Unit,
    progress: OnboardingProgress? = null,
    referral: ProfileTarget? = null,
) {
    var sub by remember(characterId) { mutableStateOf<String?>(null) }
    val profile =
        remote(characterId) {
            repository.call(
                Endpoints.characterEndpointsGetProfile,
                params = mapOf("characterId" to characterId),
                options = SessionCallOptions(owner = owner),
            )
        }
    val back = { sub = null }
    when (sub) {
        "moments" -> {
            CharacterMoments(repository, owner, state, characterId, back)
            return
        }
        "relations" -> {
            CharacterRelations(repository, owner, state, characterId, back)
            return
        }
        "cards" -> {
            CardAlbumPage(repository, runtime, owner, characterId, back)
            return
        }
        "timeline" -> {
            CharacterTimeline(repository, owner, characterId, profile.data?.name.orEmpty(), back)
            return
        }
        "memories" -> {
            androidx.activity.compose.BackHandler(onBack = back)
            MemoryManagement(repository, owner, characterId, back)
            return
        }
    }
    val scope = rememberCoroutineScope()
    val ui =
        remember(characterId, owner) {
            CharacterUi(
                repository,
                runtime,
                owner,
                characterId,
                scope,
                progress?.draft?.greeting ?: referral?.greeting.orEmpty(),
                referral?.referrerCharacterId,
            )
        }
    val customEditor by L6Overlays.customEditor.collectAsState()
    LaunchedEffect(customEditor) { if (customEditor == null) profile.refresh() }
    val contact = state.contacts.find { it.characterId == characterId } ?: ui.added
    val colors = LocalWeibanColors.current
    var intro by remember { mutableStateOf(false) }
    Column(
        Modifier
            .weight(1f)
            .fillMaxWidth()
            .background(colors.bgPage)
            .verticalScroll(rememberScrollState())
            .padding(bottom = 24.dp),
    ) {
        Box(Modifier.fillMaxWidth().height(2.dp)) {
            if (profile.loading) LinearProgressIndicator(Modifier.fillMaxWidth(), color = colors.brandPrimary)
        }
        CharacterHeader(repository, owner, profile.data, contact, characterId)
        (ui.error ?: profile.error)?.let {
            Text(it, Modifier.padding(horizontal = 16.dp, vertical = 8.dp), style = wbText(13.sp, color = colors.textDanger))
        }
        profile.data?.let { role ->
            if (role.personaUpdatedUnseen) PersonaUpdatedBadge(repository, owner, role.characterId) { profile.refresh() }
            if (role.kind == "custom") {
                Column(Modifier.padding(horizontal = 16.dp)) {
                    PlazaOriginNote(repository, owner, role.characterId)
                    CustomCharacterEditEntry(repository, owner, role.characterId)
                }
            }
        }
        val friend = contact?.conversationId != null
        if (contact != null) {
            MenuGroup { ContactAvatarEditor(repository, runtime, owner, contact) }
        }
        if (progress == null) {
            MenuGroup {
                MenuRow("朋友圈", subtitle = "TA 最近的动态") { sub = "moments" }
                if (friend) {
                    MenuRow("TA 的近况", subtitle = "TA 这些天在做什么") { sub = "timeline" }
                    MenuRow("TA 记得的事", subtitle = "你们聊过、TA 记住的事") { sub = "memories" }
                }
            }
            MenuGroup {
                if (friend) MenuRow("卡册", subtitle = "和 TA 的每一个特别时刻") { sub = "cards" }
                if (friend && profile.data?.kind == "custom") {
                    CustomRelationsEntry(repository, owner, characterId) { sub = "relations" }
                }
                MenuRow("简介与作品", subtitle = profile.data?.tagline?.ifBlank { null } ?: "了解 TA") { intro = !intro }
                if (intro) {
                    profile.data?.let { role ->
                        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp)) {
                            if (role.intro.isNotBlank()) Text(role.intro, style = wbText(15.sp, color = colors.textPrimary, lineHeight = 1.5f))
                            if (role.tags.isNotEmpty()) {
                                Text(role.tags.joinToString(" · "), Modifier.padding(top = 6.dp), style = wbText(14.sp, color = colors.textSecondary))
                            }
                            if (role.works.isNotEmpty()) {
                                Text("作品：${role.works.joinToString("、")}", Modifier.padding(top = 6.dp), style = wbText(14.sp, color = colors.textSecondary))
                            }
                            if (role.showPublicSourceNotice) {
                                Text("本角色根据公开资料创作，不代表本人", Modifier.padding(top = 6.dp), style = wbText(13.sp, color = colors.textPlaceholder))
                            }
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        CharacterAction(contact, ui, profile.data, onOpenConversation, progress?.let { it::greet })
        if (referral?.referrerCharacterId != null && contact == null) {
            Text(
                if (ui.dismissed) "好的，不会再推荐 TA" else "不感兴趣",
                Modifier.fillMaxWidth().clickableNoRipple { if (!ui.dismissed) ui.dismiss() }.padding(16.dp),
                style = wbText(15.sp, color = colors.textSecondary),
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
        }
    }
    if (ui.restore) RestoreContact(ui)
}

/** 头卡（4.12）：白底，内距 16 / 12 / 16 / 16；头像 64 圆角 8 → 16 → 名字 20/700 + 星标 22 → 信息行 14 次要色。 */
@Composable private fun CharacterHeader(
    repository: SessionRepository,
    owner: OwnerRecord,
    role: CharacterProfile?,
    contact: Contact?,
    characterId: String,
) {
    val colors = LocalWeibanColors.current
    val mode = LocalWeibanModeColors.current
    val stars = rememberStars(repository, owner)
    val starred = characterId in stars
    Row(
        Modifier.fillMaxWidth().background(colors.bgSurface).padding(start = 16.dp, top = 12.dp, end = 16.dp, bottom = 16.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Box(Modifier.size(64.dp)) {
            if (role != null) {
                val identity = RoleAvatarIdentity(role.characterId, role.name, role.avatar, contact?.customAvatarMediaId)
                RoleAvatar(repository, owner, identity, 64.dp, 8.dp)
            }
        }
        Spacer(Modifier.width(16.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    contact?.remark ?: role?.name.orEmpty(),
                    Modifier.weight(1f, fill = false),
                    style = wbText(20.sp, 700, colors.textPrimary),
                    maxLines = 1,
                    overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                )
                if (contact != null) {
                    Spacer(Modifier.width(8.dp))
                    Box(Modifier.padding(top = 2.dp).clickableNoRipple { StarStore.toggle(characterId) }) {
                        WbIcon(
                            if (starred) DsR.drawable.wb_star_filled else DsR.drawable.wb_star,
                            22.dp,
                            if (starred) mode.uiStar else mode.uiChevron,
                            contentDescription = if (starred) "取消星标" else "设为星标",
                        )
                    }
                }
            }
            Spacer(Modifier.height(4.dp))
            val info = wbText(14.sp, 400, colors.textSecondary, 1.25f)
            if (contact?.remark != null && role != null) Text("昵称：${role.name}", style = info, maxLines = 1)
            Text("微伴号：${characterId.take(12)}", Modifier.padding(top = 2.dp), style = info, maxLines = 1)
            role?.tagline?.takeIf { it.isNotBlank() }?.let {
                Text("签名：$it", Modifier.padding(top = 2.dp), style = info, maxLines = 2)
            }
            if (contact != null) {
                Box(Modifier.padding(top = 2.dp)) {
                    CompositionLocalProvider(LocalTextStyle provides info) {
                        if (contact.conversationId != null) FamiliaritySummary(repository, owner, characterId) else Text("认识于 ${contact.knownSince}", style = info)
                    }
                }
            }
        }
    }
}

/** 动作行（3.17 资料页底部动作）：整行白底高 56，link 图标 20 + 8 + link 字 17/500。 */
@Composable private fun ActionRow(
    icon: Int?,
    label: String,
    color: androidx.compose.ui.graphics.Color = LocalWeibanColors.current.textLink,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    Row(
        Modifier.fillMaxWidth().height(56.dp).background(colors.bgSurface).pressable(enabled, onClick),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        icon?.let {
            WbIcon(it, 20.dp, color)
            Spacer(Modifier.width(8.dp))
        }
        Text(label, style = wbText(17.sp, 500, color))
    }
}

@Composable private fun CharacterAction(
    contact: Contact?,
    ui: CharacterUi,
    role: CharacterProfile?,
    onOpen: (String) -> Unit,
    onGreetingChange: ((String) -> Unit)?,
) {
    val conversationId = contact?.conversationId
    val loaded = role != null
    val colors = LocalWeibanColors.current
    val mode = LocalWeibanModeColors.current
    when {
        conversationId != null -> {
            ActionRow(DsR.drawable.wb_chat, "发消息") { onOpen(conversationId) }
            // 资料页「语音通话」（MED-06 第 1 条）；平台未开通时不显示。
            if (role != null && rememberCallEntry(role.characterId)) {
                val dial = rememberDial()
                Box(Modifier.fillMaxWidth().height(hairline).background(colors.borderHairline))
                ActionRow(DsR.drawable.wb_voice_call, "语音通话") { dial(role.characterId, contact.remark ?: role.name) }
            }
        }
        contact?.status == "pending" -> ActionRow(null, "等待通过…", mode.uiPending, enabled = false) {}
        else -> {
            Column(Modifier.fillMaxWidth().background(colors.bgSurface).padding(16.dp)) {
                Text("打个招呼（选填）", style = wbText(14.sp, color = colors.textSecondary))
                Spacer(Modifier.height(8.dp))
                androidx.compose.foundation.text.BasicTextField(
                    ui.greeting,
                    {
                        ui.greeting = it.take(50)
                        onGreetingChange?.invoke(ui.greeting)
                    },
                    Modifier
                        .fillMaxWidth()
                        .background(colors.bgPage, androidx.compose.foundation.shape.RoundedCornerShape(6.dp))
                        .padding(12.dp),
                    textStyle = wbText(16.sp, color = colors.textPrimary),
                    cursorBrush = androidx.compose.ui.graphics.SolidColor(colors.brandPrimary),
                )
                Text(
                    "${ui.greeting.length}/50",
                    Modifier.fillMaxWidth().padding(top = 4.dp),
                    style = wbText(12.sp, color = colors.textPlaceholder),
                    textAlign = androidx.compose.ui.text.style.TextAlign.End,
                )
            }
            Spacer(Modifier.height(8.dp))
            ActionRow(null, if (ui.pending) "正在发送…" else "添加到通讯录", enabled = loaded && !ui.pending) { ui.add() }
        }
    }
}

@Composable private fun RestoreContact(ui: CharacterUi) {
    ActionSheet(
        listOf(
            SheetAction("恢复旧记录") { ui.add("restore") },
            SheetAction("重新认识") { ui.add("fresh") },
        ),
        "你们以前认识过。选择恢复以前的聊天记录和记忆，或者重新认识。",
    ) { if (!ui.pending) ui.restore = false }
}
