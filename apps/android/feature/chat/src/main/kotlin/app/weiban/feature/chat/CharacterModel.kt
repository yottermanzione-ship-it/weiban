package app.weiban.feature.chat

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.weiban.contracts.*
import app.weiban.data.OwnerRecord
import app.weiban.data.SessionCallOptions
import app.weiban.data.SessionRepository
import app.weiban.designsystem.IconTile
import app.weiban.designsystem.LocalWeibanColors
import app.weiban.designsystem.MenuGroup
import app.weiban.designsystem.MenuRow
import app.weiban.designsystem.ShellPage
import app.weiban.designsystem.tokens.WbSpace
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** 聊天信息 ›「聊天模型」组（总经理要求）：TA 用的模型（跟随默认 / 模型名）。 */
@Composable internal fun CharacterModelRow(
    repository: SessionRepository,
    owner: OwnerRecord,
    characterId: String,
    enabled: Boolean,
    onOpen: () -> Unit,
) {
    val override =
        remote("${owner.sessionId}:model-override:$characterId") {
            repository.call(
                Endpoints.modelAccessEndpointsGetCharacterOverride,
                params = mapOf("characterId" to characterId),
                options = SessionCallOptions(owner = owner, networkOnly = true),
            )
        }
    val models =
        remote("${owner.sessionId}:models") {
            repository.call(Endpoints.modelAccessEndpointsListModels, options = SessionCallOptions(owner = owner)).items
        }
    val key = override.data?.chat?.modelKey
    val value = if (key == null) "跟随默认" else models.data?.find { it.modelKey == key }?.displayName ?: key
    Row(
        Modifier.fillMaxWidth().clickable(enabled = enabled, onClick = onOpen).padding(vertical = WbSpace.S3),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("TA 用的模型", Modifier.weight(1f))
        Text(value, color = LocalWeibanColors.current.textSecondary)
        Text(" ›", color = LocalWeibanColors.current.textTertiary)
    }
}

/** 为 TA 选模型（GET/PUT /model/character-overrides/:characterId；chat = null 跟随默认）。 */
@Composable internal fun CharacterModelPage(
    repository: SessionRepository,
    owner: OwnerRecord,
    characterId: String,
    onBack: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val colors = LocalWeibanColors.current
    val override =
        remote("${owner.sessionId}:model-override-page:$characterId") {
            repository.call(
                Endpoints.modelAccessEndpointsGetCharacterOverride,
                params = mapOf("characterId" to characterId),
                options = SessionCallOptions(owner = owner, networkOnly = true),
            )
        }
    val models =
        remote("${owner.sessionId}:models-page") {
            repository.call(Endpoints.modelAccessEndpointsListModels, options = SessionCallOptions(owner = owner, networkOnly = true)).items
        }
    var current by remember(override.data) { mutableStateOf(override.data?.chat?.modelKey) }
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val choose: (String?) -> Unit = { key ->
        if (!pending && key != current) {
            val before = current
            current = key
            pending = true
            error = null
            scope.launch {
                userAction({
                    error = it
                    current = before
                }) {
                    repository.call(
                        Endpoints.modelAccessEndpointsSetCharacterOverride,
                        params = mapOf("characterId" to characterId),
                        body =
                            buildJsonObject {
                                if (key == null) put("chat", JsonNull) else put("chat", buildJsonObject { put("modelKey", key) })
                            },
                        options = SessionCallOptions(owner = owner),
                    )
                }
                pending = false
            }
        }
    }
    ShellPage("为 TA 选模型", onBack) {
        Text(
            "只影响和这个 TA 的私聊；群聊里仍用每个角色各自的模型。",
            Modifier.padding(horizontal = WbSpace.S5, vertical = WbSpace.S3),
            color = colors.textSecondary,
            style = MaterialTheme.typography.bodySmall,
        )
        if ((override.loading && override.data == null) || (models.loading && models.data == null)) {
            LinearProgressIndicator(Modifier.fillMaxWidth())
        }
        (error ?: override.error ?: models.error)?.let {
            Text(it, Modifier.padding(horizontal = WbSpace.S5), color = MaterialTheme.colorScheme.error)
        }
        MenuGroup {
            MenuRow("跟随默认", value = "用「我 › 服务」里选的聊天模型", trailing = {
                RadioButton(selected = current == null, enabled = !pending, onClick = { choose(null) })
            }) { choose(null) }
            models.data.orEmpty().filter { "adult_content" !in it.capabilities }.forEach { model ->
                MenuRow(
                    model.displayName,
                    value = model.vendorName + if (model.available) "" else " · 暂不可用",
                    enabled = model.available && !pending,
                    trailing = {
                        RadioButton(
                            selected = current == model.modelKey,
                            enabled = model.available && !pending,
                            onClick = { choose(model.modelKey) },
                        )
                    },
                ) { choose(model.modelKey) }
            }
        }
    }
}

/** 聊天信息「和 TA 一起用」一行小程序图标（按 TA 的小程序，当前 TA 已选好）。 */
@Composable internal fun TogetherRow(characterId: String) {
    LazyRow(horizontalArrangement = Arrangement.spacedBy(WbSpace.S4)) {
        items(MiniApp.perTaApps, key = { it.id }) { app ->
            Column(
                Modifier.clickable { MiniAppNavigation.open(app.id, characterId) }.padding(vertical = WbSpace.S2),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(WbSpace.S1),
            ) {
                IconTile(app.glyph, app.tint, 44.dp)
                Text(app.title, style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}
