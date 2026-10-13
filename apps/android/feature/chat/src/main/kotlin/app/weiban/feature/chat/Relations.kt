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
import app.weiban.designsystem.tokens.WbSize
import app.weiban.designsystem.tokens.WbSpace
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

private val relationTypes =
    listOf("friend" to "朋友", "family" to "家人", "groupmate" to "同学", "colleague" to "同事", "costar" to "搭档", "other" to "其他")
private val closenessLevels = listOf("acquaintance" to "点头之交", "familiar" to "熟悉", "close" to "亲密")
private const val RELATION_LABEL_LIMIT = 8

internal fun relationTypeName(type: String): String = relationTypes.find { it.first == type }?.second ?: "其他"

internal fun closenessName(value: String): String = closenessLevels.find { it.first == value }?.second ?: ""

/** 我的全部自定义角色（3.0.1：`GET /characters/custom`）。 */
@Composable private fun customCharacterIds(
    repository: SessionRepository,
    owner: OwnerRecord,
): Pair<List<String>, Map<String, UserCustomCharacter>> {
    val list =
        remote("${owner.sessionId}:custom-characters") {
            repository.call(Endpoints.userCustomEndpointsList, options = SessionCallOptions(owner = owner))
        }
    val items = list.data?.items.orEmpty()
    return items.map { it.characterId } to items.associateBy { it.characterId }
}

/** 资料页「TA 认识的人 N 个 ›」：只有拥有 2 个及以上自定义角色时显示（social-l4.md 第 6 节）。 */
@Composable internal fun CustomRelationsEntry(
    repository: SessionRepository,
    owner: OwnerRecord,
    characterId: String,
    onOpen: () -> Unit,
) {
    val (custom, _) = customCharacterIds(repository, owner)
    if (custom.size < 2) return
    val relations =
        remote("${owner.sessionId}:relations") {
            repository.call(Endpoints.userRelationEndpointsListMyRelations, options = SessionCallOptions(owner = owner))
        }
    val count = relations.data?.items?.count { it.characterAId == characterId || it.characterBId == characterId } ?: 0
    GroupRow("TA 认识的人", "$count 个", onOpen)
}

@Composable internal fun CharacterRelations(
    repository: SessionRepository,
    owner: OwnerRecord,
    state: ClientSyncState,
    characterId: String,
    onBack: () -> Unit,
) {
    val colors = LocalWeibanColors.current
    val (custom, profiles) = customCharacterIds(repository, owner)
    val relations =
        remote("${owner.sessionId}:relations") {
            repository.call(Endpoints.userRelationEndpointsListMyRelations, options = SessionCallOptions(owner = owner))
        }
    var editing by remember { mutableStateOf<CharacterRelation?>(null) }
    var adding by remember { mutableStateOf(false) }
    val mine =
        relations.data
            ?.items
            ?.filter { it.characterAId == characterId || it.characterBId == characterId }
            .orEmpty()

    fun other(relation: CharacterRelation) = if (relation.characterAId == characterId) relation.characterBId else relation.characterAId

    fun nameOf(id: String) = state.contacts.find { it.characterId == id }?.remark ?: profiles[id]?.name ?: "角色"
    val available = custom.filter { id -> id != characterId && mine.none { other(it) == id } }
    if (adding || editing != null) {
        RelationForm(repository, owner, characterId, editing, available.associateWith(::nameOf), {
            adding = false
            editing = null
        }) {
            adding = false
            editing = null
            relations.refresh()
        }
        return
    }
    BackHandler(onBack = onBack)
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
        app.weiban.designsystem.WbNavBar("TA 认识的人", onBack) {
            TextButton(onClick = { adding = true }, enabled = available.isNotEmpty()) { Text("＋") }
        }
        if (relations.loading && relations.data == null) LinearProgressIndicator(Modifier.fillMaxWidth())
        relations.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (relations.data != null && mine.isEmpty()) {
            Text("还没有设置关系", color = colors.textSecondary)
            TextButton(onClick = { adding = true }, enabled = available.isNotEmpty()) { Text("添加") }
        }
        mine.forEach { relation ->
            val id = other(relation)
            ListItem(
                headlineContent = { Text(nameOf(id)) },
                leadingContent = {
                    RoleAvatar(
                        repository,
                        owner,
                        RoleAvatarIdentity(id, nameOf(id), profiles[id]?.avatar),
                        WbSize.AvatarMd,
                    )
                },
                trailingContent = {
                    val type = if (relation.type == "other") relation.label ?: "其他" else relationTypeName(relation.type)
                    Text("$type · ${closenessName(relation.closeness)} ›", color = colors.textSecondary)
                },
                modifier = Modifier.clickable { editing = relation },
            )
        }
        Text(
            "只有你创建的角色之间可以设置关系。设置后 TA 们会在群聊、朋友圈里互相认识。",
            color = colors.textSecondary,
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

@Composable private fun RelationForm(
    repository: SessionRepository,
    owner: OwnerRecord,
    characterId: String,
    editing: CharacterRelation?,
    candidates: Map<String, String>,
    onCancel: () -> Unit,
    onSaved: () -> Unit,
) {
    BackHandler(onBack = onCancel)
    val colors = LocalWeibanColors.current
    val scope = rememberCoroutineScope()
    var target by remember { mutableStateOf<String?>(null) }
    var type by remember { mutableStateOf(editing?.type ?: "friend") }
    var label by remember { mutableStateOf(editing?.label.orEmpty()) }
    var closeness by remember { mutableStateOf(editing?.closeness ?: "familiar") }
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var deleting by remember { mutableStateOf(false) }
    val save: (suspend () -> Unit) -> Unit = { work ->
        pending = true
        error = null
        scope.launch {
            userAction({ error = it }) {
                work()
                onSaved()
            }
            pending = false
        }
    }
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onCancel, enabled = !pending) { Text("取消") }
            Text(if (editing == null) "添加关系" else "编辑关系", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
            Button(enabled = !pending && (editing != null || target != null) && (type != "other" || label.isNotBlank()), onClick = {
                val body =
                    buildJsonObject {
                        put("type", type)
                        put("closeness", closeness)
                        put("label", if (type == "other") JsonPrimitive(label.trim()) else JsonNull)
                    }
                save {
                    if (editing == null) {
                        val ids = listOf(characterId, target!!).sorted()
                        repository.call(
                            Endpoints.userRelationEndpointsCreateMyRelation,
                            body =
                                JsonObject(
                                    body + mapOf("characterAId" to JsonPrimitive(ids[0]), "characterBId" to JsonPrimitive(ids[1])),
                                ),
                            options = SessionCallOptions(owner = owner),
                        )
                    } else {
                        repository.call(
                            Endpoints.userRelationEndpointsUpdateMyRelation,
                            params = mapOf("relationId" to editing.relationId),
                            body = body,
                            options = SessionCallOptions(owner = owner),
                        )
                    }
                }
            }) { Text("完成") }
        }
        if (editing == null) {
            Text("对方", style = MaterialTheme.typography.titleSmall)
            candidates.forEach { (id, name) ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    RadioButton(selected = target == id, onClick = { target = id }, enabled = !pending)
                    Text(name)
                }
            }
        }
        Text("关系类型", style = MaterialTheme.typography.titleSmall)
        Row(horizontalArrangement = Arrangement.spacedBy(WbSpace.S2)) {
            relationTypes.forEach { (id, name) ->
                FilterChip(selected = type == id, onClick = { type = id }, label = { Text(name) }, enabled = !pending)
            }
        }
        if (type == "other") {
            OutlinedTextField(label, { label = it.take(RELATION_LABEL_LIMIT) }, singleLine = true, label = { Text("说明（≤ 8 字）") })
        }
        Text("亲疏", style = MaterialTheme.typography.titleSmall)
        Row(horizontalArrangement = Arrangement.spacedBy(WbSpace.S2)) {
            closenessLevels.forEach { (id, name) ->
                FilterChip(selected = closeness == id, onClick = { closeness = id }, label = { Text(name) }, enabled = !pending)
            }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (editing != null) {
            TextButton(onClick = { deleting = true }, enabled = !pending) { Text("删除关系", color = colors.textDanger) }
        }
    }
    if (deleting && editing != null) {
        AlertDialog(
            onDismissRequest = { deleting = false },
            title = { Text("删除关系？") },
            text = { Text("删除后，TA 们不会再在群聊、朋友圈互动，也不会再互相提起；以前的聊天记录会保留") },
            confirmButton = {
                TextButton(onClick = {
                    deleting = false
                    save {
                        repository.call(
                            Endpoints.userRelationEndpointsDeleteMyRelation,
                            params = mapOf("relationId" to editing.relationId),
                            options = SessionCallOptions(owner = owner),
                        )
                    }
                }) { Text("删除", color = colors.textDanger) }
            },
            dismissButton = { TextButton(onClick = { deleting = false }) { Text("取消") } },
        )
    }
}
