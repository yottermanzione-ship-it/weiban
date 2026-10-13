package app.weiban.feature.me

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import app.weiban.contracts.*
import kotlinx.serialization.json.*

/*
 * 钱包与模型页（第一批先沿用原内容，第二批按旧版改为积分：钱包、充值、积分明细、用量、价目表）。
 */

@Composable internal fun WalletPage(state: MeState) =
    with(state) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            wallet?.let {
                Text("¥ ${yuan(it.availableMicros)}", style = MaterialTheme.typography.headlineLarge)
                Text("当前余额 ¥${yuan(it.balanceMicros)} · 处理中 ¥${yuan(it.heldMicros)}")
            }
            OutlinedTextField(
                threshold,
                { threshold = it },
                label = { Text("余额低于多少元时提醒") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                daily,
                { daily = it },
                label = { Text("每天后台任务最多花费（元）") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.fillMaxWidth(),
            )
            Button(enabled = !busy, onClick = {
                perform {
                    wallet =
                        call(
                            Endpoints.billingEndpointsUpdateWalletSettings,
                            buildJsonObject {
                                put("lowBalanceThresholdMicros", micros(threshold))
                                put("backgroundDailyLimitMicros", micros(daily))
                            },
                        )
                    message = "已保存"
                }
            }) { Text("保存提醒与预算") }
            for (entry in ledger) {
                ListItem(
                    headlineContent = { Text(entry.note ?: "余额变动") },
                    supportingContent = { Text(entry.createdAt.replace('T', ' ').take(16)) },
                    trailingContent = { Text("${if (entry.amountMicros > 0) "+" else ""}${yuan(entry.amountMicros)}") },
                )
            }
        }
    }

@Composable internal fun RechargePage(state: MeState) = WalletPage(state)

@Composable internal fun PointsLedgerPage(state: MeState) = WalletPage(state)

@Composable internal fun UsagePage(state: MeState) = WalletPage(state)

@Composable internal fun PricesPage(state: MeState) = ModelsPage(state)

@Composable internal fun LeaderboardPage(state: MeState) = ModelsPage(state)

@Composable internal fun ModelsPage(state: MeState) =
    with(state) {
        Column(Modifier.padding(16.dp)) {
            for ((kind, title) in listOf("chat" to "聊天模型", "background" to "后台任务模型", "adult" to "成人模式模型")) {
                Text(title, style = MaterialTheme.typography.titleMedium)
                val selected =
                    when (kind) {
                        "chat" -> selection?.chat?.modelKey
                        "adult" -> selection?.adult?.modelKey
                        else -> selection?.background?.modelKey
                    }
                for (model in models.filter { kind == "adult" || "adult_content" !in it.capabilities }) {
                    ListItem(headlineContent = { Text(model.displayName) }, trailingContent = {
                        RadioButton(selected = selected == model.modelKey, enabled = model.available && !busy, onClick = {
                            perform {
                                selection =
                                    call(
                                        Endpoints.modelAccessEndpointsUpdateSelection,
                                        buildJsonObject { put(kind, buildJsonObject { put("modelKey", model.modelKey) }) },
                                    )
                            }
                        })
                    })
                }
            }
        }
    }
