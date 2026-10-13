package app.weiban.feature.chat

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.weiban.core.designsystem.R as DsR
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import app.weiban.contracts.*
import app.weiban.data.*
import app.weiban.designsystem.ActionSheet
import app.weiban.designsystem.ComingSoon
import app.weiban.designsystem.GroupHeader
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.MenuGroup
import app.weiban.designsystem.MenuRow
import app.weiban.designsystem.MenuSwitchRow
import app.weiban.designsystem.SheetAction
import app.weiban.designsystem.ToastKind
import app.weiban.designsystem.WbIcon
import app.weiban.designsystem.WbNavBar
import app.weiban.designsystem.WbSheet
import app.weiban.designsystem.WbToast
import app.weiban.designsystem.wbText
import kotlinx.coroutines.*
import kotlinx.serialization.json.*

private class InformationActions(
    val repository: SessionRepository,
    private val runtime: ChatRuntime,
    val owner: OwnerRecord,
    private val scope: CoroutineScope,
) {
    var pending by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    var saved by mutableStateOf(false)
    var notice by mutableStateOf<String?>(null)

    fun change(
        after: () -> Unit = {},
        failed: () -> Unit = {},
        operation: suspend () -> Unit,
    ) {
        if (pending) return
        pending = true
        error = null
        saved = false
        notice = null
        scope.launch {
            try {
                userAction({
                    error = it
                    failed()
                }) {
                    operation()
                    runtime.history.synchronize(owner)
                    saved = true
                    after()
                }
            } finally {
                pending = false
            }
        }
    }

    suspend fun <T> call(
        endpoint: ContractEndpoint<T>,
        id: String,
        body: JsonElement,
    ): T = repository.call(endpoint, params = mapOf("characterId" to id), body = body, options = SessionCallOptions(owner = owner))

    suspend fun updateState(
        id: String,
        body: JsonElement,
    ) {
        repository.call(
            Endpoints.chatEndpointsUpdateState,
            params = mapOf("conversationId" to id),
            body = body,
            options = SessionCallOptions(owner = owner),
        )
    }

    suspend fun clear(id: String) = runtime.history.clear(owner, id)

    suspend fun remove(
        id: String,
        mode: String,
    ) {
        repository.call(
            Endpoints.contactsEndpointsRemove,
            params = mapOf("characterId" to id),
            query = mapOf("mode" to mode),
            options = SessionCallOptions(owner = owner),
        )
    }
}

internal data class InformationNavigation(
    val back: () -> Unit,
    val models: () -> Unit = {},
    val createGroup: () -> Unit = {},
)

@Composable internal fun ChatInformation(
    repository: SessionRepository,
    runtime: ChatRuntime,
    owner: OwnerRecord,
    state: ClientSyncState,
    conversation: Conversation,
    navigation: InformationNavigation,
    onRemoved: () -> Unit,
) {
    val characterId = conversation.participants.find { it.kind == "character" }?.refId ?: return
    val contact = state.contacts.find { it.characterId == characterId }
    var memoryPage by remember(owner, characterId) { mutableStateOf(false) }
    var timelinePage by remember(owner, characterId) { mutableStateOf(false) }
    var voicePage by remember(owner, characterId) { mutableStateOf(false) }
    var modelPage by remember(owner, characterId) { mutableStateOf(false) }
    if (modelPage) {
        CharacterModelPage(repository, owner, characterId) { modelPage = false }
        return
    }
    if (memoryPage) {
        MemoryManagement(repository, owner, characterId) { memoryPage = false }
        return
    }
    val names = characterNames(repository, listOf(characterId))
    if (timelinePage) {
        CharacterTimeline(repository, owner, characterId, contact?.remark ?: names[characterId].orEmpty()) { timelinePage = false }
        return
    }
    var searchPage by remember(owner, characterId) { mutableStateOf(false) }
    var supplementPage by remember(owner, characterId) { mutableStateOf(false) }
    if (supplementPage) {
        SupplementPage(repository, owner, characterId) { supplementPage = false }
        return
    }
    if (searchPage) {
        ConversationSearchScreen(repository, owner, state, conversation.conversationId) { searchPage = false }
        return
    }
    val scope = rememberCoroutineScope()
    val actions = remember(owner, conversation.conversationId) { InformationActions(repository, runtime, owner, scope) }
    val companion =
        remote("${owner.sessionId}:$characterId") {
            repository.call(
                Endpoints.companionEndpointsGetForCharacter,
                params = mapOf("characterId" to characterId),
                options = SessionCallOptions(owner = owner),
            )
        }
    if (voicePage) {
        VoiceTonePage(repository, owner, characterId, companion.data?.voiceId) {
            voicePage = false
            companion.refresh()
        }
        return
    }
    val colors = LocalWeibanColors.current
    LaunchedEffect(actions.saved, actions.notice) { if (actions.saved && actions.notice != null) WbToast.show(actions.notice.orEmpty()) }
    LaunchedEffect(actions.error) { actions.error?.let { WbToast.show(it, ToastKind.Warning) } }
    var proactiveSheet by remember { mutableStateOf(false) }
    var fitSheet by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxSize().background(colors.bgPage)) {
        WbNavBar("聊天信息", { if (!actions.pending) navigation.back() })
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 32.dp)) {
            // 1 成员区：TA 头像格 + 「添加」格（点 → 选角色建群）。
            MemberStrip(repository, owner, state, conversation, characterId, contact?.remark ?: names[characterId].orEmpty(), !actions.pending) {
                navigation.createGroup()
            }
            MenuGroup { MenuRow("查找聊天记录", enabled = !actions.pending) { searchPage = true } }
            MenuGroup { InformationPreferences(actions, conversation) }
            MenuGroup("聊天模型") { CharacterModelRow(repository, owner, characterId, !actions.pending) { modelPage = true } }
            GroupHeader("和 TA 一起用")
            TogetherRow(characterId)
            MenuGroup("和 TA 的相处") {
                companion.data?.let { settings ->
                    MenuRow("人设贴合度", value = "${settings.personaFit ?: 3}", enabled = !actions.pending) { fitSheet = true }
                    InformationToggle("秒回", settings.instantReply, !actions.pending) { value ->
                        actions.change(after = companion::refresh) {
                            actions.call(Endpoints.companionEndpointsUpdateForCharacter, characterId, buildJsonObject { put("instantReply", value) })
                        }
                    }
                    InformationToggle("拆条", settings.splitBubbles, !actions.pending) { value ->
                        actions.change(after = companion::refresh) {
                            actions.call(Endpoints.companionEndpointsUpdateForCharacter, characterId, buildJsonObject { put("splitBubbles", value) })
                        }
                    }
                    MenuRow(
                        "主动消息",
                        value = if (settings.proactiveMessages == false) "已关闭" else proactiveFrequencies.toMap()[settings.proactiveFrequency ?: "medium"],
                        enabled = !actions.pending,
                    ) { proactiveSheet = true }
                }
                MenuRow("TA 怎么叫我", value = contact?.addressAs ?: "未设置", enabled = !actions.pending) { editing = "addressAs" }
                MenuRow("关系类型", value = contact?.relationship ?: "朋友", enabled = !actions.pending) { editing = "relationship" }
                companion.data?.let { settings -> InformationDaily(actions, companion, characterId, settings) }
                MenuRow("TA 的近况", enabled = !actions.pending) { timelinePage = true }
                MenuRow("TA 记得的事", enabled = !actions.pending) { memoryPage = true }
            }
            MenuGroup("高级") {
                VoiceToneRow(repository, owner, companion.data?.voiceId, !actions.pending) { voicePage = true }
                MenuRow("我的补充设定", enabled = !actions.pending) { supplementPage = true }
                PlazaPublishRow(repository, owner, characterId, !actions.pending)
            }
            MenuGroup { MenuRow("设置当前聊天背景", value = "暂未开放") { ComingSoon.notice("background") } }
            InformationRemoval(actions, conversation.conversationId, characterId, navigation.back, onRemoved)
        }
    }
    if (fitSheet) {
        companion.data?.let { settings -> PersonaFitSheet(actions, companion, characterId, settings) { fitSheet = false } }
    }
    if (proactiveSheet) {
        companion.data?.let { settings ->
            WbSheet("主动消息", { proactiveSheet = false }) {
                MenuGroup { InformationProactive(actions, companion, characterId, settings) }
            }
        }
    }
    editing?.let { field ->
        ContactFieldSheet(field, contact, actions, characterId) { editing = null }
    }
}

/** 成员区（规格 4.5）：白卡，内距 16 / 16 / 16 / 14；格宽 58；成员头像 46 圆角 6 + 名字 12；「添加」格 46 灰底线框 + ＋。 */
@Composable private fun MemberStrip(
    repository: SessionRepository,
    owner: OwnerRecord,
    state: ClientSyncState,
    conversation: Conversation,
    characterId: String,
    name: String,
    enabled: Boolean,
    onAdd: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    val profiles = characterProfiles(repository, listOf(characterId))
    Row(
        Modifier.fillMaxWidth().background(colors.bgSurface).padding(start = 16.dp, top = 16.dp, end = 16.dp, bottom = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Column(Modifier.width(58.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            RoleAvatar(
                repository,
                owner,
                RoleAvatarIdentity(
                    characterId,
                    profiles[characterId]?.name.orEmpty(),
                    profiles[characterId]?.avatar,
                    state.contacts.find { it.characterId == characterId }?.customAvatarMediaId,
                ),
                46.dp,
                6.dp,
            )
            Spacer(Modifier.height(5.dp))
            Text(name.ifEmpty { title(state, conversation) }, style = wbText(12.sp, color = colors.textSecondary), maxLines = 1)
        }
        Column(Modifier.width(58.dp).clickableNoRipple { if (enabled) onAdd() }, horizontalAlignment = Alignment.CenterHorizontally) {
            Box(
                Modifier.size(46.dp).border(1.dp, colors.borderHairline, RoundedCornerShape(6.dp)).background(colors.bgPage, RoundedCornerShape(6.dp)),
                contentAlignment = Alignment.Center,
            ) {
                WbIcon(DsR.drawable.wb_add, 26.dp, colors.textSecondary)
            }
            Spacer(Modifier.height(5.dp))
            Text("添加", style = wbText(12.sp, color = colors.textSecondary))
        }
    }
}

/** 人设贴合度（1 更顺从，5 更贴合人设）：底部弹层里拖动。 */
@Composable private fun PersonaFitSheet(
    actions: InformationActions,
    companion: NativeRemote<CompanionEndpointsGetForCharacterResponse>,
    characterId: String,
    settings: CompanionEndpointsGetForCharacterResponse,
    onDismiss: () -> Unit,
) {
    var fit by remember(settings.personaFit) { mutableFloatStateOf((settings.personaFit ?: 3).toFloat()) }
    val colors = LocalWeibanColors.current
    WbSheet("人设贴合度", onDismiss, action = "完成" to {
        onDismiss()
        actions.change(after = companion::refresh) {
            actions.call(Endpoints.companionEndpointsUpdateForCharacter, characterId, buildJsonObject { put("personaFit", fit.toInt()) })
        }
    }) {
        Column(Modifier.fillMaxWidth().background(colors.bgSurface).padding(16.dp)) {
            Text("当前：${fit.toInt()}", style = wbText(17.sp, color = colors.textPrimary))
            Slider(
                fit,
                { fit = it },
                valueRange = 1f..5f,
                steps = 3,
                colors = SliderDefaults.colors(thumbColor = colors.brandPrimary, activeTrackColor = colors.brandPrimary),
            )
            Text("1 更顺从你，5 更贴合 TA 的人设", style = wbText(13.sp, color = colors.textSecondary))
        }
    }
}

/** TA 怎么叫我 / 关系类型：底部弹层单行输入，「完成」保存。 */
@Composable private fun ContactFieldSheet(
    field: String,
    contact: Contact?,
    actions: InformationActions,
    characterId: String,
    onDismiss: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    val addressAs = field == "addressAs"
    var value by remember(field) { mutableStateOf(if (addressAs) contact?.addressAs.orEmpty() else contact?.relationship ?: "朋友") }
    val max = if (addressAs) 20 else 30
    WbSheet(if (addressAs) "TA 怎么叫我" else "关系类型", onDismiss, action = "完成" to {
        if (addressAs || value.isNotBlank()) {
            onDismiss()
            actions.change {
                actions.call(
                    Endpoints.contactsEndpointsUpdate,
                    characterId,
                    buildJsonObject {
                        put("remark", contact?.remark?.let(::JsonPrimitive) ?: JsonNull)
                        put("relationship", if (addressAs) contact?.relationship ?: "朋友" else value)
                        put("addressAs", (if (addressAs) value else contact?.addressAs)?.takeIf { it.isNotBlank() }?.let(::JsonPrimitive) ?: JsonNull)
                    },
                )
            }
        }
    }) {
        Column(Modifier.fillMaxWidth().background(colors.bgSurface).padding(16.dp)) {
            androidx.compose.foundation.text.BasicTextField(
                value,
                { if (it.length <= max) value = it },
                Modifier.fillMaxWidth().background(colors.bgPage, RoundedCornerShape(6.dp)).padding(12.dp),
                textStyle = wbText(17.sp, color = colors.textPrimary),
                singleLine = true,
                cursorBrush = androidx.compose.ui.graphics.SolidColor(colors.brandPrimary),
            )
            Text(
                if (addressAs) "留空 = 按 TA 的习惯称呼你" else "比如：朋友、恋人、家人",
                Modifier.padding(top = 8.dp),
                style = wbText(13.sp, color = colors.textSecondary),
            )
        }
    }
}

@Composable private fun InformationPreferences(
    actions: InformationActions,
    conversation: Conversation,
) {
    InformationToggle("消息免打扰", conversation.state.muted, !actions.pending) { value ->
        actions.change { actions.updateState(conversation.conversationId, buildJsonObject { put("muted", value) }) }
    }
    InformationToggle("置顶聊天", conversation.state.pinned, !actions.pending) { value ->
        actions.change { actions.updateState(conversation.conversationId, buildJsonObject { put("pinned", value) }) }
    }
}

@Composable private fun InformationRemoval(
    actions: InformationActions,
    conversationId: String,
    characterId: String,
    onBack: () -> Unit,
    onRemoved: () -> Unit,
) {
    var confirmation by remember { mutableStateOf<String?>(null) }
    BackHandler {
        if (!actions.pending) {
            if (confirmation != null) {
                confirmation = null
            } else {
                onBack()
            }
        }
    }
    MenuGroup { MenuRow("清空聊天记录", danger = true, enabled = !actions.pending) { confirmation = "clear" } }
    MenuGroup {
        MenuRow("删除角色", danger = true, enabled = !actions.pending) { confirmation = "soft" }
        MenuRow("永久删除角色和数据", danger = true, enabled = !actions.pending) { confirmation = "purge" }
    }
    confirmation?.let { mode ->
        InformationConfirmation(mode, actions.pending, { confirmation = null }) {
            if (mode == "purge") {
                confirmation = "purgeConfirmed"
            } else {
                actions.change(after = {
                    confirmation = null
                    if (mode != "clear") onRemoved()
                }) {
                    if (mode == "clear") {
                        actions.clear(conversationId)
                    } else {
                        actions.remove(characterId, if (mode == "soft") "soft" else "purge")
                    }
                }
            }
        }
    }
}

@Composable private fun InformationToggle(
    label: String,
    checked: Boolean,
    enabled: Boolean,
    onChange: (Boolean) -> Unit,
) {
    MenuSwitchRow(label, checked, enabled, onChange = onChange)
}

@Composable private fun InformationConfirmation(
    mode: String,
    pending: Boolean,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    val text =
        when (mode) {
            "clear" -> "只清空聊天记录显示，TA的记忆和养成数据会保留"
            "soft" -> "角色和聊天将从列表移除，30天内重新添加可恢复"
            "purge" -> "这会永久删除聊天记录、记忆和养成数据，无法恢复"
            else -> "再次确认永久删除：重新添加也无法恢复这些数据"
        }
    ActionSheet(
        listOf(
            SheetAction(
                when (mode) {
                    "clear" -> "清空聊天记录"
                    "soft" -> "删除角色"
                    else -> "永久删除"
                },
                danger = true,
            ) { if (!pending) onConfirm() },
        ),
        text,
    ) { if (!pending) onDismiss() }
}

private val proactiveFrequencies = listOf("low" to "少", "medium" to "适中", "high" to "多")

/** 主动消息（SIM-10、CHAT-13 第 2 条）：开关 + 三档频率，乐观更新，失败退回；另含「TA 的日常」（SIM-13）。 */
@Composable private fun InformationProactive(
    actions: InformationActions,
    companion: NativeRemote<CompanionEndpointsGetForCharacterResponse>,
    characterId: String,
    settings: CompanionEndpointsGetForCharacterResponse,
) {
    val global =
        remote("${actions.owner.sessionId}:notification-settings") {
            actions.repository.call(
                Endpoints.identityEndpointsGetNotificationSettings,
                options = SessionCallOptions(owner = actions.owner, networkOnly = true),
            )
        }
    val globalOff = global.data?.proactiveMessagesEnabled == false
    var enabled by remember(settings.proactiveMessages) { mutableStateOf(settings.proactiveMessages ?: true) }
    var frequency by remember(settings.proactiveFrequency) { mutableStateOf(settings.proactiveFrequency ?: "medium") }
    InformationToggle("TA 主动找我", enabled && !globalOff, !actions.pending && !globalOff) { value ->
        val before = enabled
        enabled = value
        actions.change(after = companion::refresh, failed = { enabled = before }) {
            actions.call(Endpoints.companionEndpointsUpdateForCharacter, characterId, buildJsonObject { put("proactiveMessages", value) })
        }
    }
    if (globalOff) {
        Text(
            "已在 我 › 服务 › 主动消息与免打扰 中关闭",
            Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            style = wbText(13.sp, color = LocalWeibanColors.current.textSecondary),
        )
    } else if (enabled) {
        GroupHeader("频率")
        Column {
            proactiveFrequencies.forEach { (id, label) ->
                MenuRow(
                    label,
                    enabled = !actions.pending,
                    trailing =
                        if (frequency == id) {
                            { WbIcon(DsR.drawable.wb_check, 22.dp, LocalWeibanColors.current.brandPrimary) }
                        } else {
                            null
                        },
                    onClick = {
                        if (frequency != id) {
                            val before = frequency
                            frequency = id
                            actions.change(after = {
                                actions.notice = "下一次主动消息开始生效"
                                companion.refresh()
                            }, failed = { frequency = before }) {
                                actions.call(
                                    Endpoints.companionEndpointsUpdateForCharacter,
                                    characterId,
                                    buildJsonObject { put("proactiveFrequency", id) },
                                )
                            }
                        }
                    },
                )
            }
        }
    }
    InformationCalls(actions, companion, characterId, settings, global.data?.proactiveCallsEnabled == false)
}

/** TA 的日常（SIM-13）：开关。 */
@Composable private fun InformationDaily(
    actions: InformationActions,
    companion: NativeRemote<CompanionEndpointsGetForCharacterResponse>,
    characterId: String,
    settings: CompanionEndpointsGetForCharacterResponse,
) {
    var daily by remember(settings.dailyLife) { mutableStateOf(settings.dailyLife ?: true) }
    InformationToggle("TA 的日常", daily, !actions.pending) { value ->
        val before = daily
        daily = value
        actions.change(after = companion::refresh, failed = { daily = before }) {
            actions.call(Endpoints.companionEndpointsUpdateForCharacter, characterId, buildJsonObject { put("dailyLife", value) })
        }
    }
}

/**
 * 「TA 给我打电话」（MED-07 第 1 条）：默认关闭；全局开关关闭时置灰。打开时检查通知与全屏通知权限（media-l5.md 7.4），
 * 没有全屏通知权限时开关照常打开，下方说明「锁屏时只会收到通知」+「去设置」。
 */
@Composable private fun InformationCalls(
    actions: InformationActions,
    companion: NativeRemote<CompanionEndpointsGetForCharacterResponse>,
    characterId: String,
    settings: CompanionEndpointsGetForCharacterResponse,
    globalOff: Boolean,
) {
    val context = LocalContext.current
    val permissions = rememberCallPermissionFlow()
    var enabled by remember(settings.proactiveCalls) { mutableStateOf(settings.proactiveCalls ?: false) }
    InformationToggle("TA 给我打电话", enabled && !globalOff, !actions.pending && !globalOff) { value ->
        val before = enabled
        enabled = value
        if (value) permissions()
        actions.change(after = companion::refresh, failed = { enabled = before }) {
            actions.call(Endpoints.companionEndpointsUpdateForCharacter, characterId, buildJsonObject { put("proactiveCalls", value) })
        }
    }
    if (enabled && !globalOff && !canUseFullScreen(context)) {
        MenuRow("未允许全屏通知，锁屏时只会收到通知", value = "去设置") { openFullScreenSettings(context) }
    }
}
