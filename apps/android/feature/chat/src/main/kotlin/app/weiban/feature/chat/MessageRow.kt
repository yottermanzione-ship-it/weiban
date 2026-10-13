package app.weiban.feature.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.weiban.contracts.*
import app.weiban.core.designsystem.R as DsR
import app.weiban.designsystem.CheckCircle
import app.weiban.designsystem.InlineButton
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.pressMenu
import app.weiban.designsystem.wbText
import kotlinx.coroutines.launch

/**
 * 一条消息（规格 4.4.3）：上下各 6；头像 40 圆角 4、与气泡间距 6；他人在左、我在右；每条都带头像；
 * 群聊他人气泡上方显示名字 12 #888。系统提示、撤回、拍一拍居中灰字。长按 → 气泡深色菜单（3.8）。
 */
@Composable
internal fun MessageRow(
    ui: ConversationUi,
    avatars: MessageAvatars,
    message: Message,
) {
    val content = message.content
    when {
        message.status == "recalled" -> {
            val who = if (message.senderKind == "user") "你" else "\"${avatars.roles[message.senderParticipantId]?.name ?: "对方"}\""
            SystemLine("${who}撤回了一条消息")
            return
        }
        message.status != "normal" -> return
        message.senderKind == "system" || content is ReceivedMessageContentSystem -> {
            SystemMessage(ui, message)
            return
        }
        content is ReceivedMessageContentNudge -> {
            val who = if (message.senderKind == "user") "你" else "\"${avatars.roles[message.senderParticipantId]?.name ?: "对方"}\""
            val target =
                when {
                    content.targetParticipantId == message.senderParticipantId -> "自己"
                    avatars.roles[content.targetParticipantId] != null -> "\"${avatars.roles[content.targetParticipantId]?.name}\""
                    else -> "你"
                }
            SystemLine("$who 拍了拍 $target")
            return
        }
    }
    MessageLine(ui, avatars, message)
}

@Composable private fun MessageLine(
    ui: ConversationUi,
    avatars: MessageAvatars,
    message: Message,
) {
    val conversation = ui.conversation
    val group = conversation.isGroup()
    val context = LocalContext.current
    val mine = message.senderKind == "user"
    val avatar = avatars.sender(message)
    val content = message.content
    var menuAt by remember { mutableStateOf<Offset?>(null) }
    var bounds by remember { mutableStateOf(Rect.Zero) }
    val dial = if (content is ReceivedMessageContentCallRecord && !group) rememberDial() else null
    var redial by remember { mutableStateOf(false) }
    val peer = conversation.participants.find { it.kind == "character" }
    // 点一下的主操作：图片 → 查看器；语音 → 播放；链接 → 唤起 App；通话记录 → 再次拨打确认。
    val primary: () -> Unit =
        when (content) {
            is ReceivedMessageContentImage -> { -> ui.media.viewing = message.messageId }
            is ReceivedMessageContentVoice -> { -> ui.media.player.toggle(message) }
            is ReceivedMessageContentLink -> { -> if (!openLink(context, content.url)) ui.media.toast("无法打开这个链接") }
            is ReceivedMessageContentLetter -> { -> PlayNav.stack.value = listOf(PlayPage.LetterRead(content.letterId)) }
            is ReceivedMessageContentDailyQuestion -> { -> PlayNav.stack.value = listOf(PlayPage.DailyHistory(content.answerId)) }
            is ReceivedMessageContentCallRecord -> { -> if (dial != null && peer != null) redial = true }
            else -> { -> }
        }
    val selectable = message.status == "normal" && message.senderKind != "system"
    val selected = message.messageId in ui.selected
    val press =
        if (ui.selecting) {
            Modifier.clickableNoRipple { if (selectable) ui.toggleSelected(message.messageId) }
        } else {
            Modifier
                .onGloballyPositioned { bounds = it.boundsInWindow() }
                .pressMenu(primary, { at -> menuAt = at }, pressedColor = false)
        }
    val flash = if (ui.highlightSeq == message.seq) Modifier.background(LocalWeibanColors.current.brandSoft) else Modifier
    val userParticipant = conversation.participants.find { it.kind == "user" }?.participantId
    val mention = !mine && (content as? ReceivedMessageContentText)?.mentions?.contains(userParticipant) == true
    val maxWidth = (LocalConfiguration.current.screenWidthDp * 0.68f).dp
    Row(
        flash
            .fillMaxWidth()
            .then(if (ui.selecting) Modifier.clickableNoRipple { if (selectable) ui.toggleSelected(message.messageId) } else Modifier)
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.Top,
    ) {
        if (ui.selecting) {
            Box(Modifier.padding(start = 6.dp, end = 4.dp, top = 8.dp)) { CheckCircle(selected, enabled = selectable) }
        }
        if (mine) Spacer(Modifier.weight(1f))
        if (!mine && avatar != null) {
            SenderAvatar(ui, avatar, message)
            Spacer(Modifier.width(6.dp))
        }
        Column(Modifier.weight(1f, fill = false), horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
            if (group && !mine && avatar != null) {
                Text(
                    avatar.name,
                    Modifier.padding(start = TAIL_WIDTH, bottom = 3.dp).clickableNoRipple { insertMention(ui, message, avatar.name) },
                    style = wbText(12.sp, 400, androidx.compose.ui.graphics.Color(0xFF888888)),
                    maxLines = 1,
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.widthIn(max = maxWidth)) { MessageContent(ui, avatars, message, mine, mention, press) }
            }
            ui.media.transcripts[message.messageId]?.takeIf { it.shown }?.let { TranscriptBlock(it, mine) }
        }
        if (mine && avatar != null) {
            Spacer(Modifier.width(6.dp))
            SenderAvatar(ui, avatar, message)
        }
        if (!mine) Spacer(Modifier.weight(1f).widthIn(min = 40.dp))
    }
    menuAt?.let { at ->
        BubbleMenu(bounds, at.x, bubbleMenuItems(ui, message, context)) { menuAt = null }
    }
    if (redial && dial != null && peer != null) {
        val name = avatars.roles[peer.participantId]?.name.orEmpty().ifEmpty { "角色" }
        app.weiban.designsystem.WbConfirm("和 $name 语音通话？", "拨打", onDismiss = { redial = false }) {
            redial = false
            dial(peer.refId, name)
        }
    }
}

/** 头像：点 → 资料页；双击角色头像 → 拍一拍。 */
@Composable private fun SenderAvatar(
    ui: ConversationUi,
    avatar: RoleAvatarIdentity,
    message: Message,
) {
    val open by rememberUpdatedState { if (!avatar.user) ui.openProfile(ProfileTarget(avatar.id, ui.groupGreeting)) }
    val nudge by rememberUpdatedState {
        if (!avatar.user) {
            ui.scope.launch {
                userAction({ ui.error = it }) {
                    ui.runtime.sendContent(
                        ui.owner,
                        ui.conversation.conversationId,
                        UserSendableContentNudge(targetParticipantId = message.senderParticipantId),
                    )
                }
            }
        }
    }
    Box(
        Modifier.pointerInput(avatar.id) {
            detectTapGestures(onTap = { open() }, onDoubleTap = { nudge() })
        },
    ) {
        RoleAvatar(ui.repository, ui.owner, avatar, 40.dp, 4.dp)
    }
}

private fun insertMention(
    ui: ConversationUi,
    message: Message,
    name: String,
) {
    ui.mention(name, message.senderParticipantId)
}

/** 消息内容：图片、表情无气泡；卡片类白卡气泡（我发出的也用白底）；其余带尖角气泡。 */
@Composable private fun MessageContent(
    ui: ConversationUi,
    avatars: MessageAvatars,
    message: Message,
    mine: Boolean,
    mention: Boolean,
    press: Modifier,
) {
    val colors = LocalWeibanColors.current
    when (val content = message.content) {
        is ReceivedMessageContentImage -> ImageMessage(ui, content, press)
        is ReceivedMessageContentSticker -> StickerMessage(ui.repository, ui.owner, content.mediaId, press, 108.dp)
        is ReceivedMessageContentContactCard -> {
            val recommender =
                avatars.roles.values
                    .find { it.id == content.recommenderCharacterId }
                    ?.name
                    .orEmpty()
            val open = {
                ui.openProfile(
                    ProfileTarget(
                        content.characterId,
                        if (recommender.isNotBlank()) "是 $recommender 推荐我来的" else null,
                        content.recommenderCharacterId,
                    ),
                )
            }
            WhiteCard(mine, content.name, "个人名片", "名片", Modifier.clickableNoRipple(open).then(press))
        }
        is ReceivedMessageContentLetter ->
            WhiteCard(
                mine,
                if (content.direction == "from_character") "一封来信" else "一封信",
                content.body,
                "慢信",
                press,
            )
        is ReceivedMessageContentDailyQuestion -> WhiteCard(mine, content.question, content.answer, "每日一问", press)
        is ReceivedMessageContentLink ->
            Bubble(mine, press.width(240.dp), color = colors.bgSurface, padding = androidx.compose.foundation.layout.PaddingValues(12.dp)) {
                LinkCardMessage(ui.repository, ui.owner, content)
            }
        is ReceivedMessageContentVoice -> VoiceMessage(ui, message, content, press)
        is ReceivedMessageContentCallRecord ->
            Bubble(mine, press, padding = androidx.compose.foundation.layout.PaddingValues(horizontal = 14.dp, vertical = 10.dp)) {
                CallRecordMessage(content)
            }
        is ReceivedMessageContentActionCard -> Bubble(mine, press) { ActionCardBody(ui, message, content) }
        is ReceivedMessageContentText ->
            Bubble(mine, press, mention = mention) {
                message.quote?.let { QuoteBlock(ui, avatars, it) }
                LinkifiedText(content.text)
            }
        else -> Bubble(mine, press) { Text(messageText(message)) }
    }
}

/** 引用块（4.4.4）：左 2.5 竖线 brand，引用人 12/500 brand，内容 12 次要色最多 2 行（超 50 字截断）。 */
@Composable private fun QuoteBlock(
    ui: ConversationUi,
    avatars: MessageAvatars,
    quote: QuoteRef,
) {
    val colors = LocalWeibanColors.current
    val quoted =
        ui.runtime.snapshot.value.state.messages
            .find { it.messageId == quote.messageId }
    val who = quoted?.let { if (it.senderKind == "user") "我" else avatars.roles[it.senderParticipantId]?.name }
    val text = (quote.preview ?: "引用的消息已不可见").let { if (it.length > 50) it.take(50) + "..." else it }
    Row(Modifier.padding(bottom = 6.dp).height(IntrinsicSize.Min)) {
        Box(Modifier.width(2.5.dp).fillMaxHeight().background(colors.brandPrimary))
        Column(Modifier.padding(start = 6.dp)) {
            who?.let { Text(it, style = wbText(12.sp, 500, colors.brandPrimary), maxLines = 1) }
            Text(text, style = wbText(12.sp, 400, colors.textSecondary), maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** 白卡气泡（4.4.5 卡片类）：宽 240，标题 16/500 两行 → 摘要 13 两行 → 0.5 线 → 来源 12。 */
@Composable private fun WhiteCard(
    mine: Boolean,
    title: String,
    summary: String,
    source: String,
    modifier: Modifier,
) {
    val colors = LocalWeibanColors.current
    Bubble(mine, modifier.width(240.dp), color = colors.bgSurface, padding = androidx.compose.foundation.layout.PaddingValues(12.dp)) {
        Text(title, style = wbText(16.sp, 500, colors.textPrimary, 1.3f), maxLines = 2, overflow = TextOverflow.Ellipsis)
        Spacer(Modifier.height(4.dp))
        Text(summary, style = wbText(13.sp, 400, colors.textSecondary, 1.35f), maxLines = 2, overflow = TextOverflow.Ellipsis)
        Box(Modifier.padding(vertical = 8.dp).fillMaxWidth().height(0.5.dp).background(colors.borderHairline))
        Text(source, style = wbText(12.sp, 400, colors.textPlaceholder))
    }
}

/** 带按钮的卡片（ADR-0026）：只能点一次。 */
@Composable private fun ActionCardBody(
    ui: ConversationUi,
    message: Message,
    content: ReceivedMessageContentActionCard,
) {
    val chosen = message.actionChoice?.actionId
    // 来电询问点「可以」：顺带检查通知与全屏通知权限（media-l5.md 7.4）。
    val permissions = if (content.cardKind == "call_permission") rememberCallPermissionFlow() else null
    val choose: (String) -> Unit = { id ->
        if (id == "allow") permissions?.invoke()
        // 角色提议一起领养：「去看看」进领养流程，角色已预选（T-082、pet.md 第 2 节）。
        if (content.cardKind == "pet_proposal" && id == "go") {
            val target =
                content.ref?.id ?: ui.conversation.participants
                    .find { it.kind == "character" }
                    ?.refId
            L6Overlays.pets.value = PetsOpen(target, adopt = true)
        }
        ui.choose(message, id)
    }
    Text(content.text)
    Spacer(Modifier.height(8.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        content.actions.forEach { action ->
            val enabled = chosen == null && !ui.choosing
            InlineButton(if (chosen == action.actionId) "✓ ${action.label}" else action.label, enabled = enabled || chosen == action.actionId) {
                if (enabled) choose(action.actionId)
            }
        }
    }
}

/** 系统提示：领养、获得卡片可点（link 色）。 */
@Composable private fun SystemMessage(
    ui: ConversationUi,
    message: Message,
) {
    val colors = LocalWeibanColors.current
    val content = message.content as? ReceivedMessageContentSystem
    val characterId =
        ui.conversation.participants
            .find { it.kind == "character" }
            ?.refId
    when (content?.code) {
        "pet_adopted" ->
            SystemLine(messageText(message), Modifier.clickable { L6Overlays.pets.value = PetsOpen(characterId) }, colors.textLink)
        "card_obtained" -> {
            val cardId = (content.params["cardId"] as? kotlinx.serialization.json.JsonPrimitive)?.content
            SystemLine(
                messageText(message),
                Modifier.clickable(enabled = cardId != null && characterId != null) {
                    if (cardId != null && characterId != null) L6Overlays.openCard(characterId, cardId)
                },
                colors.textLink,
            )
        }
        else -> SystemLine(messageText(message))
    }
}

/** 语音转文字结果：在气泡下方单独一块白卡。 */
@Composable private fun TranscriptBlock(
    view: TranscriptView,
    mine: Boolean,
) {
    val colors = LocalWeibanColors.current
    Column(
        Modifier
            .padding(top = 4.dp, start = if (mine) 0.dp else TAIL_WIDTH, end = if (mine) TAIL_WIDTH else 0.dp)
            .widthIn(max = 240.dp)
            .background(colors.bgSurface, androidx.compose.foundation.shape.RoundedCornerShape(8.dp))
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        when {
            view.text != null -> Text(view.text, style = wbText(15.sp, 400, colors.textPrimary, 1.35f))
            view.status == "pending" ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 1.5.dp)
                    Text(" 转换中…", style = wbText(14.sp, color = colors.textSecondary))
                }
            else -> Text("无法转换", style = wbText(14.sp, color = colors.textPlaceholder))
        }
    }
}

/** 发送队列里还没确认的消息（我发出的，右侧）：发送中 2 秒后转圈，失败红色感叹号点了重发。 */
@Composable internal fun PendingRow(
    ui: ConversationUi,
    avatars: MessageAvatars,
    item: ClientPendingSend,
) {
    val maxWidth = (LocalConfiguration.current.screenWidthDp * 0.68f).dp
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Spacer(Modifier.weight(1f).widthIn(min = 40.dp))
        SendStatus(item.state == "failed") { ui.retry(item.body.clientMsgId) }
        Box(Modifier.widthIn(max = maxWidth)) {
            when (val content = item.body.content) {
                is UserSendableContentImage, is UserSendableContentSticker -> PendingContent(ui, content)
                else -> Bubble(true) { PendingContent(ui, content) }
            }
        }
        Spacer(Modifier.width(6.dp))
        RoleAvatar(ui.repository, ui.owner, avatars.user, 40.dp, 4.dp)
    }
}


/** 气泡菜单项目（4.4.7）：文字 复制·转发·收藏·引用·多选·撤回·删除；图片 保存·转发·收藏·收藏到表情·引用·多选·删除；
 *  语音 转文字·收藏·多选·删除；表情 收藏到表情·多选·删除。撤回只在 2 分钟内、只对我的消息。 */
internal fun bubbleMenuItems(
    ui: ConversationUi,
    message: Message,
    context: android.content.Context,
): List<BubbleItem> {
    val mine = message.senderKind == "user"
    val sentAt = runCatching { java.time.Instant.parse(message.createdAt).toEpochMilli() }.getOrDefault(0L)
    val canRecall = mine && System.currentTimeMillis() - sentAt < RECALL_WINDOW_MS
    val fav = BubbleItem("收藏", DsR.drawable.wb_star) { ui.media.favorite(message) }
    val quote = BubbleItem("引用", DsR.drawable.wb_reply) { ui.quoteId = message.messageId }
    val multi =
        BubbleItem("多选", DsR.drawable.wb_check) {
            ui.selecting = true
            ui.selected.clear()
            ui.selected.add(message.messageId)
        }
    val forward = BubbleItem("转发", DsR.drawable.wb_share) { app.weiban.designsystem.ComingSoon.notice("forward") }
    val recall = if (canRecall) listOf(BubbleItem("撤回", DsR.drawable.wb_undo) { messageCommand(ui, message, recall = true) }) else emptyList()
    val delete = BubbleItem("删除", DsR.drawable.wb_delete) { messageCommand(ui, message, recall = false) }
    val toStickers =
        if (canAddToStickers(message)) listOf(BubbleItem("收藏到表情", DsR.drawable.wb_smile) { ui.media.addToStickers(message) }) else emptyList()
    return when (val content = message.content) {
        is ReceivedMessageContentText ->
            listOf(BubbleItem("复制", DsR.drawable.wb_copy) { copyText(context, ui, content.text) }, forward, fav, quote, multi) + recall + delete
        is ReceivedMessageContentImage ->
            listOf(BubbleItem("保存", DsR.drawable.wb_drawn_save) { ui.media.save(context, content.mediaId) }, forward, fav) +
                toStickers + listOf(quote, multi) + recall + delete
        is ReceivedMessageContentVoice -> {
            val shown = ui.media.transcripts[message.messageId]?.shown == true
            listOf(BubbleItem(if (shown) "隐藏文字" else "转文字", DsR.drawable.wb_drawn_voice_to_text) { ui.media.toggleTranscript(message) }, fav, multi) +
                recall + delete
        }
        is ReceivedMessageContentSticker -> toStickers + multi + recall + delete
        is ReceivedMessageContentLink ->
            listOf(BubbleItem("复制链接", DsR.drawable.wb_link) { copyText(context, ui, content.url) }, fav, quote, multi, delete)
        is ReceivedMessageContentActionCard, is ReceivedMessageContentCallRecord -> listOf(delete)
        else -> listOf(quote, multi, delete)
    }
}

private const val RECALL_WINDOW_MS = 120_000L

private fun copyText(
    context: android.content.Context,
    ui: ConversationUi,
    text: String,
) {
    context.getSystemService(android.content.ClipboardManager::class.java)?.setPrimaryClip(android.content.ClipData.newPlainText("消息", text))
    ui.media.toast("已复制")
}

/** 撤回 / 从我的界面删除。 */
private fun messageCommand(
    ui: ConversationUi,
    message: Message,
    recall: Boolean,
) {
    ui.scope.launch {
        userAction({ ui.error = it }) {
            val params = mapOf("conversationId" to ui.conversation.conversationId, "messageId" to message.messageId)
            val options = app.weiban.data.SessionCallOptions(owner = ui.owner)
            if (recall) {
                ui.repository.call(Endpoints.chatEndpointsRecallMessage, params = params, options = options)
            } else {
                ui.repository.call(Endpoints.chatEndpointsHideMessage, params = params, options = options)
            }
        }
    }
}

