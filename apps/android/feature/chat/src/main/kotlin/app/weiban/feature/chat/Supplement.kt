package app.weiban.feature.chat

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import app.weiban.contracts.*
import app.weiban.data.*
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.LocalWeibanModeColors
import app.weiban.designsystem.tokens.WbSpace
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

private const val SUPPLEMENT_LINE_MAX = 200
private const val SUPPLEMENT_TEXT_MAX = 5_000

/**
 * 我的补充设定（CHR-09；design pages/import.md 补充设定一节）：一行一条，手写（≤ 200 字）/ 编辑 / 删除 / 删除全部，
 * 冲突项显示「与公开资料冲突，不生效」；「导入资料」走导入流程。只对我生效。
 * 自定义角色没有补充设定：导入结果直接合并进人设描述。
 */
@Suppress("LongMethod", "CyclomaticComplexMethod") // List, editor dialog and confirmations.
@Composable
internal fun SupplementPage(
    repository: SessionRepository,
    owner: OwnerRecord,
    characterId: String,
    onBack: () -> Unit,
) {
    BackHandler(onBack = onBack)
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    val profile =
        remote("${owner.sessionId}:supplement-profile:$characterId") {
            repository.call(
                Endpoints.characterEndpointsGetProfile,
                params = mapOf("characterId" to characterId),
                options = SessionCallOptions(owner = owner),
            )
        }
    val supplement =
        remote("${owner.sessionId}:supplement:$characterId") {
            repository.call(
                Endpoints.characterSupplementEndpointsGetSupplement,
                params = mapOf("characterId" to characterId),
                options = SessionCallOptions(owner = owner, networkOnly = true),
            )
        }
    val imports by L6Overlays.imports.collectAsState()
    // 导入浮层关闭后重新拉取（导入结果可能已追加进来）。
    LaunchedEffect(imports) { if (imports == null) supplement.refresh() }
    LaunchedEffect(characterId, owner) {
        AppUpdates.updates.collect { update ->
            if (update is UserUpdateDataChanged && update.data.section == "supplement" &&
                update.data.characterId == characterId
            ) {
                supplement.refresh()
            }
        }
    }
    var editing by remember { mutableStateOf<Int?>(null) }
    var draft by remember { mutableStateOf("") }
    var clearing by remember { mutableStateOf(false) }
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val custom = profile.data?.kind == "custom"
    val lines =
        supplement.data
            ?.text
            ?.split('\n')
            ?.map { it.trim() }
            ?.filter { it.isNotEmpty() }
            .orEmpty()
    val conflicts = supplement.data?.conflicts.orEmpty()

    fun save(next: List<String>) {
        pending = true
        error = null
        scope.launch {
            try {
                userAction({ error = it }) {
                    if (next.isEmpty()) {
                        repository.call(
                            Endpoints.characterSupplementEndpointsDeleteSupplement,
                            params = mapOf("characterId" to characterId),
                            options = SessionCallOptions(owner = owner, networkOnly = true),
                        )
                        supplement.data = null
                    } else {
                        supplement.data =
                            repository.call(
                                Endpoints.characterSupplementEndpointsPutSupplement,
                                params = mapOf("characterId" to characterId),
                                body = buildJsonObject { put("text", next.joinToString("\n").take(SUPPLEMENT_TEXT_MAX)) },
                                options = SessionCallOptions(owner = owner, networkOnly = true),
                            )
                    }
                }
            } finally {
                pending = false
            }
        }
    }
    app.weiban.designsystem.WbNavBar("我的补充设定", onBack) {
    }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(WbSpace.S5),
        verticalArrangement = Arrangement.spacedBy(WbSpace.S3),
    ) {
        Text("补充设定只对你生效，不会改变角色的分类和成人模式资格；和公开资料冲突时以公开资料为准。", color = colors.textSecondary)
        if (supplement.loading && supplement.data == null) LinearProgressIndicator(Modifier.fillMaxWidth())
        (error ?: supplement.error)?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        supplement.data?.plazaSource?.let { SupplementSourceNote(repository, owner, characterId, it, supplement::refresh) }
        if (custom) {
            Text("自定义角色可以直接修改人设；导入的资料会合并进人设描述。", color = colors.textSecondary)
        } else {
            if (supplement.data != null && lines.isEmpty() || supplement.data == null && !supplement.loading) {
                Text("还没有补充设定", color = colors.textSecondary)
            }
            lines.forEachIndexed { index, line ->
                val conflict = conflicts.any { line.contains(it.supplementValue) }
                ListItem(
                    headlineContent = { Text(line) },
                    supportingContent = {
                        if (conflict) Text("与公开资料冲突，不生效", color = LocalWeibanModeColors.current.statusWarningText)
                    },
                    modifier =
                        Modifier.clickable(enabled = !pending) {
                            draft = line
                            editing = index
                        },
                )
            }
            TextButton(enabled = !pending, onClick = {
                draft = ""
                editing = -1
            }) { Text("＋ 写一条") }
        }
        TextButton(enabled = !pending, onClick = { L6Overlays.openImport("supplement", characterId) }) { Text("导入资料") }
        if (!custom && lines.isNotEmpty()) {
            TextButton(enabled = !pending, onClick = { clearing = true }) { Text("删除全部", color = colors.textDanger) }
            // 预设改版入口（persona-plaza.md 4.1）：有补充设定时才显示。
            VariantPublishButton(characterId, !pending)
        }
    }
    editing?.let { index ->
        AlertDialog(
            onDismissRequest = { editing = null },
            title = { Text(if (index < 0) "写一条补充设定" else "编辑") },
            text = {
                OutlinedTextField(
                    draft,
                    { draft = it.replace('\n', ' ').take(SUPPLEMENT_LINE_MAX) },
                    supportingText = { Text("${draft.length} / $SUPPLEMENT_LINE_MAX") },
                )
            },
            confirmButton = {
                TextButton(enabled = draft.isNotBlank() && !pending, onClick = {
                    val next = lines.toMutableList()
                    if (index < 0) next.add(draft.trim()) else next[index] = draft.trim()
                    editing = null
                    save(next)
                }) { Text("保存") }
            },
            dismissButton = {
                if (index >= 0) {
                    TextButton(onClick = {
                        val next = lines.toMutableList().apply { removeAt(index) }
                        editing = null
                        save(next)
                    }) { Text("删除", color = colors.textDanger) }
                } else {
                    TextButton(onClick = { editing = null }) { Text("取消") }
                }
            },
        )
    }
    if (clearing) {
        AlertDialog(
            onDismissRequest = { clearing = false },
            title = { Text("删除全部补充设定？") },
            text = { Text("删除后角色回到基础人设。") },
            confirmButton = {
                TextButton(onClick = {
                    clearing = false
                    save(emptyList())
                }) { Text("删除", color = colors.textDanger) }
            },
            dismissButton = { TextButton(onClick = { clearing = false }) { Text("取消") } },
        )
    }
}

/** 资料页名字下「资料已更新 ●」（CHR-10 第 4 条）：点开看更新摘要并标记已看。 */
@Composable internal fun PersonaUpdatedBadge(
    repository: SessionRepository,
    owner: OwnerRecord,
    characterId: String,
    onSeen: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    var notes by remember(characterId) { mutableStateOf<List<PersonaUpdateNote>?>(null) }
    var open by remember(characterId) { mutableStateOf(false) }
    TextButton(onClick = {
        open = true
        scope.launch {
            userAction({ notes = emptyList() }) {
                notes =
                    repository
                        .call(
                            Endpoints.personaUpdateEndpointsListPersonaUpdates,
                            params = mapOf("characterId" to characterId),
                            options = SessionCallOptions(owner = owner, networkOnly = true),
                        ).items
                repository.call(
                    Endpoints.personaUpdateEndpointsMarkPersonaUpdatesSeen,
                    params = mapOf("characterId" to characterId),
                    options = SessionCallOptions(owner = owner, networkOnly = true),
                )
            }
        }
    }) { Text("资料已更新 ●", color = colors.textLink) }
    if (open) {
        AlertDialog(
            onDismissRequest = {
                open = false
                onSeen()
            },
            title = { Text("资料已更新") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
                    val list = notes
                    when {
                        list == null -> LinearProgressIndicator(Modifier.fillMaxWidth())
                        list.isEmpty() -> Text("暂时没有更新说明", color = colors.textSecondary)
                        else ->
                            list.forEach { note ->
                                Text(note.summary)
                                Text(note.publishedAt.take(10), color = colors.textTertiary, style = MaterialTheme.typography.bodySmall)
                            }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    open = false
                    onSeen()
                }) { Text("知道了") }
            },
        )
    }
}
