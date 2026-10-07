package app.weiban.feature.me

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import app.weiban.contracts.*
import app.weiban.data.SessionRepository
import app.weiban.designsystem.tokens.WbSpace
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

private class MeState(
    val repository: SessionRepository,
    val firstProfile: Boolean,
    val onTheme: (String) -> Unit,
    private val scope: CoroutineScope,
) {
    var page by mutableStateOf(if (firstProfile) "profile" else "me")
    var profile by mutableStateOf<Profile?>(null)
    var wallet by mutableStateOf<Wallet?>(null)
    var ledger by mutableStateOf<List<LedgerEntry>>(emptyList())
    var cursor by mutableStateOf<String?>(null)
    var models by mutableStateOf<List<ModelInfo>>(emptyList())
    var selection by mutableStateOf<ModelSelection?>(null)
    var nickname by mutableStateOf("")
    var city by mutableStateOf("")
    var about by mutableStateOf("")
    var birthday by mutableStateOf("")
    var gender by mutableStateOf("unspecified")
    var threshold by mutableStateOf("")
    var daily by mutableStateOf("")
    var message by mutableStateOf<String?>(null)
    var busy by mutableStateOf(false)

    suspend fun load() {
        val p = repository.call(Endpoints.identityEndpointsGetProfile)
        profile = p
        nickname = p.nickname.orEmpty()
        city = p.city.orEmpty()
        about =
            p.about.orEmpty()
        birthday = p.birthday.orEmpty()
        gender = p.gender
        val w = repository.call(Endpoints.billingEndpointsGetWallet)
        wallet = w
        threshold = yuan(w.lowBalanceThresholdMicros)
        daily =
            yuan(w.backgroundBudget.dailyLimitMicros)
        val prefs = repository.call(Endpoints.identityEndpointsGetPreferences)
        onTheme(prefs.theme)
    }

    @Suppress("TooGenericExceptionCaught") // Present a generic user message for service/storage failures.
    fun perform(work: suspend () -> Unit) {
        busy = true
        message = null
        scope.launch {
            try {
                work()
            } catch (_: IllegalArgumentException) {
                message =
                    "请检查填写的内容"
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                message = "暂时无法完成，请稍后重试"
            } finally {
                busy = false
            }
        }
    }
}

@Composable fun MeScreen(
    repository: SessionRepository,
    firstProfile: Boolean = false,
    onTheme: (String) -> Unit,
    onLogout: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val themeCallback = rememberUpdatedState(onTheme)
    val state = remember(repository) { MeState(repository, firstProfile, { themeCallback.value(it) }, scope) }
    LaunchedEffect(state) { state.perform { state.load() } }
    with(state) {
        Column(
            Modifier
                .fillMaxSize()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(WbSpace.S5),
            verticalArrangement = Arrangement.spacedBy(WbSpace.S5),
        ) {
            if (firstProfile) TextButton(onClick = onLogout) { Text("‹ 返回登录") }
            if (page != "me" && !firstProfile) {
                TextButton(onClick = {
                    page = "me"
                    message = null
                }) { Text("‹ 返回") }
            }
            Text(
                pageTitle(page, firstProfile),
                style = MaterialTheme.typography.headlineSmall,
            )
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            message?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            when (page) {
                "profile" -> ProfilePage(state)
                "wallet" -> {
                    BudgetPage(state)
                    LedgerPage(state)
                }
                "models" -> {
                    ModelChoices(state, "chat", "聊天模型")
                    ModelChoices(state, "background", "后台任务模型")
                    ModelChoices(state, "adult", "成人模式模型")
                    Text("成人模式模型未设置时不能开启成人模式；具体对话仍受角色与账号规则约束。")
                }
                "theme" -> ThemePage(state)
                else -> HomePage(state, onLogout)
            }
        }
    }
}

@Composable private fun ProfilePage(state: MeState) =
    with(state) {
        OutlinedTextField(
            nickname,
            { nickname = it },
            label = { Text("昵称") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        var details by remember { mutableStateOf(!firstProfile) }
        TextButton(onClick = { details = !details }) { Text("补充更多资料（可选）") }
        if (details) ProfileDetails(state)
        ProfileSave(state)
    }

@Composable private fun ProfileDetails(state: MeState) =
    with(state) {
        SavedAvatar(repository, profile?.avatarMediaId)
        AvatarPicker(repository) { perform { load() } }
        OutlinedTextField(city, { city = it }, label = { Text("城市（可不填）") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(birthday, {
            birthday = it
        }, label = { Text("生日（可不填，如 2000-01-01）") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Row(horizontalArrangement = Arrangement.spacedBy(WbSpace.S3)) {
            for ((id, label) in listOf(
                "unspecified" to "不透露",
                "female" to "女",
                "male" to "男",
                "other" to "其他",
            )) {
                FilterChip(selected = gender == id, onClick = { gender = id }, label = { Text(label) })
            }
        }
        OutlinedTextField(about, { about = it }, label = { Text("个性签名") }, modifier = Modifier.fillMaxWidth())
    }

@Composable private fun ProfileSave(state: MeState) =
    with(state) {
        Button(enabled = !busy, onClick = {
            perform {
                require(nickname.isNotBlank())
                if (birthday.isNotBlank())java.time.LocalDate.parse(birthday)
                repository.call(
                    Endpoints.identityEndpointsUpdateProfile,
                    buildJsonObject {
                        put("nickname", nickname)
                        put("city", if (city.isBlank())JsonNull else JsonPrimitive(city))
                        put("birthday", if (birthday.isBlank())JsonNull else JsonPrimitive(birthday))
                        put("about", if (about.isBlank())JsonNull else JsonPrimitive(about))
                        put("gender", gender)
                    },
                )
                val user = repository.call(Endpoints.identityEndpointsMe)
                repository.updateUser(user)
                load()
                page = "me"
            }
        }) { Text(if (firstProfile) "下一步" else "保存") }
    }

@Composable private fun BudgetPage(state: MeState) =
    with(state) {
        wallet?.let {
            Text("¥ ${yuan(it.availableMicros)}", style = MaterialTheme.typography.headlineLarge)
            Text("当前余额 ¥${yuan(it.balanceMicros)} · 处理中 ¥${yuan(it.heldMicros)}")
        }
        OutlinedTextField(
            threshold,
            {
                threshold = it
            },
            label = {
                Text("余额低于多少元时提醒")
            },
            singleLine = true,
            keyboardOptions =
                KeyboardOptions(
                    keyboardType = KeyboardType.Decimal,
                ),
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            daily,
            {
                daily = it
            },
            label = {
                Text("每天后台任务最多花费（元）")
            },
            singleLine = true,
            keyboardOptions =
                KeyboardOptions(
                    keyboardType = KeyboardType.Decimal,
                ),
            modifier = Modifier.fillMaxWidth(),
        )
        Button(enabled = !busy, onClick = {
            perform {
                wallet =
                    repository.call(
                        Endpoints.billingEndpointsUpdateWalletSettings,
                        buildJsonObject {
                            put("lowBalanceThresholdMicros", micros(threshold))
                            put("backgroundDailyLimitMicros", micros(daily))
                        },
                    )
                ;message =
                    "已保存"
            }
        }) { Text("保存提醒与预算") }
    }

@Composable private fun LedgerPage(state: MeState) =
    with(state) {
        HorizontalDivider()
        Text("余额流水", style = MaterialTheme.typography.titleMedium)
        if (ledger.isEmpty())Text("暂无记录")
        for (entry in ledger) {
            ListItem(headlineContent = {
                Text(
                    entry.note ?: when (entry.type) {
                        "credit" -> "余额增加"
                        "refund" -> "退回"
                        else -> "余额变动"
                    },
                )
            }, supportingContent = {
                Text(entry.createdAt.replace('T', ' ').take(16))
            }, trailingContent = { Text("${if (entry.amountMicros > 0) "+" else ""}${yuan(entry.amountMicros)}") })
        }
        if (cursor !=
            null
        ) {
            TextButton(enabled = !busy, onClick = {
                perform {
                    val result =
                        repository.call(
                            Endpoints.billingEndpointsListLedger,
                            query =
                                mapOf("cursor" to cursor!!),
                        )
                    ;ledger = ledger + result.items
                    cursor = result.nextCursor
                }
            }) { Text("加载更多") }
        }
    }

@Composable private fun HomePage(
    state: MeState,
    onLogout: () -> Unit,
) = with(state) {
    SavedAvatar(repository, profile?.avatarMediaId)
    Text(
        profile?.nickname ?: repository.auth.value
            ?.user
            ?.username
            .orEmpty(),
        style = MaterialTheme.typography.titleLarge,
    )
    Text("账号：${repository.auth.value?.user?.username.orEmpty()}")
    OutlinedButton(onClick = { page = "profile" }) { Text("我的资料") }
    OutlinedButton(onClick = {
        page = "wallet"
        perform {
            val result = repository.call(Endpoints.billingEndpointsListLedger)
            ledger =
                result.items
            cursor = result.nextCursor
        }
    }) { Text("余额与账单") }
    OutlinedButton(onClick = {
        page = "models"
        perform {
            models = repository.call(Endpoints.modelAccessEndpointsListModels).items
            selection =
                repository.call(Endpoints.modelAccessEndpointsGetSelection)
        }
    }) { Text("模型选择") }
    OutlinedButton(onClick = { page = "theme" }) { Text("主题") }
    TextButton(enabled = !busy, onClick = {
        perform {
            load()
            message = "已刷新"
        }
    }) { Text("刷新") }
    TextButton(onClick = onLogout) { Text("退出登录") }
}

@Composable private fun ModelChoices(
    state: MeState,
    kind: String,
    title: String,
) = with(state) {
    Text(title, style = MaterialTheme.typography.titleMedium)
    val candidates = models.filter { kind == "adult" || "adult_content" !in it.capabilities }
    if (candidates.isEmpty()) Text("暂时没有可选模型，请联系管理员")
    val selected =
        when (kind) {
            "chat" -> selection?.chat?.modelKey
            "adult" -> selection?.adult?.modelKey
            else -> selection?.background?.modelKey
        }
    ModelDefault(state, kind, selected)
    for (model in candidates) {
        ListItem(headlineContent = { Text(model.displayName) }, supportingContent = {
            Text(model.vendorName + if (model.available) "" else " · 暂不可用")
        }, trailingContent = {
            RadioButton(selected = selected == model.modelKey, enabled = model.available && !busy, onClick = {
                perform {
                    selection =
                        repository.call(
                            Endpoints.modelAccessEndpointsUpdateSelection,
                            buildJsonObject {
                                put(kind, buildJsonObject { put("modelKey", model.modelKey) })
                            },
                        )
                }
            })
        })
    }
}

@Composable private fun ThemePage(state: MeState) =
    with(state) {
        for ((id, label) in listOf("green" to "默认", "pink" to "微伴粉")) {
            OutlinedButton(enabled = !busy, onClick = {
                perform {
                    val prefs = repository.call(Endpoints.identityEndpointsUpdatePreferences, buildJsonObject { put("theme", id) })
                    onTheme(prefs.theme)
                }
            }) { Text(label) }
        }
    }

private fun pageTitle(
    page: String,
    firstProfile: Boolean,
): String =
    when (page) {
        "profile" -> if (firstProfile) "TA 该怎么称呼你？" else "我的资料"
        "wallet" -> "余额与账单"
        "models" -> "模型选择"
        "theme" -> "主题"
        else -> "我"
    }

@Composable private fun ModelDefault(
    state: MeState,
    kind: String,
    selected: String?,
) = with(state) {
    val title =
        when (kind) {
            "chat" -> "平台默认"
            "background" -> "沿用聊天模型"
            else -> "未设置"
        }
    ListItem(headlineContent = { Text(title) }, trailingContent = {
        RadioButton(selected = selected == null, enabled = !busy, onClick = {
            perform {
                selection = repository.call(Endpoints.modelAccessEndpointsUpdateSelection, buildJsonObject { put(kind, JsonNull) })
            }
        })
    })
}
