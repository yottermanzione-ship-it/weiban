// GENERATED from packages/contracts JSON Schema. DO NOT EDIT.
// Contract 2.5. Regenerate: pnpm android:generate
@file:OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
package app.weiban.contracts

import kotlinx.serialization.*
import kotlinx.serialization.descriptors.*
import kotlinx.serialization.encoding.*
import kotlinx.serialization.json.*

const val CONTRACT_VERSION: String = "2.5"

@Serializable
data class AccountDeletionModuleProgress(
    @SerialName("module") val `module`: String,
    @SerialName("purged") val `purged`: Boolean,
    @SerialName("deletedRows") val `deletedRows`: Long?,
    @SerialName("purgedAt") val `purgedAt`: Timestamp?,
)

@Serializable
data class AddContactRequest(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("greeting") val `greeting`: String? = null,
    @SerialName("restoreMode") val `restoreMode`: String? = null,
    @SerialName("referrerCharacterId") val `referrerCharacterId`: Id? = null,
)

@Serializable
data class AddContactRequestInput(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("greeting") val `greeting`: String? = null,
    @SerialName("restoreMode") val `restoreMode`: String? = null,
    @SerialName("referrerCharacterId") val `referrerCharacterId`: Id? = null,
)

@Serializable
data class AdminAccountSummary(
    @SerialName("userId") val `userId`: Id,
    @SerialName("username") val `username`: String,
    @SerialName("balanceMicros") val `balanceMicros`: MoneyMicros,
    @SerialName("heldMicros") val `heldMicros`: Long,
    @SerialName("spentLast30DaysMicros") val `spentLast30DaysMicros`: Long,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
)

@Serializable
data class AdminAdjustmentRequest(
    @SerialName("direction") val `direction`: String,
    @SerialName("amountMicros") val `amountMicros`: PositiveMoneyMicros,
    @SerialName("reason") val `reason`: String,
    @SerialName("idempotencyKey") val `idempotencyKey`: String,
)

@Serializable
data class AdminAdjustmentRequestInput(
    @SerialName("direction") val `direction`: String,
    @SerialName("amountMicros") val `amountMicros`: PositiveMoneyMicros,
    @SerialName("reason") val `reason`: String,
    @SerialName("idempotencyKey") val `idempotencyKey`: String,
)

@Serializable
data class AdminAlert(
    @SerialName("kind") val `kind`: String,
    @SerialName("severity") val `severity`: String,
    @SerialName("dedupeKey") val `dedupeKey`: String,
    @SerialName("summary") val `summary`: String,
    @SerialName("refs") val `refs`: AdminAlertRefs? = null,
    @SerialName("alertId") val `alertId`: Id,
    @SerialName("occurrences") val `occurrences`: Long,
    @SerialName("firstRaisedAt") val `firstRaisedAt`: Timestamp,
    @SerialName("lastRaisedAt") val `lastRaisedAt`: Timestamp,
    @SerialName("acknowledgedAt") val `acknowledgedAt`: Timestamp?,
    @SerialName("acknowledgedByUserId") val `acknowledgedByUserId`: Id?,
)

@Serializable
data class AdminAlertFacts(
    @SerialName("kind") val `kind`: AdminAlertKind,
    @SerialName("severity") val `severity`: AdminAlertSeverity,
    @SerialName("dedupeKey") val `dedupeKey`: String,
    @SerialName("summary") val `summary`: String,
    @SerialName("refs") val `refs`: AdminAlertFactsRefs? = null,
)

typealias AdminAlertKind = String

typealias AdminAlertSeverity = String

@Serializable
data class AdminCatalogEntry(
    @SerialName("modelKey") val `modelKey`: ModelKey,
    @SerialName("displayName") val `displayName`: String,
    @SerialName("vendorName") val `vendorName`: String,
    @SerialName("upstreamId") val `upstreamId`: Id,
    @SerialName("upstreamModelId") val `upstreamModelId`: String,
    @SerialName("capabilities") val `capabilities`: List<ModelCapability>,
    @SerialName("tags") val `tags`: List<String>,
    @SerialName("leaderboardRank") val `leaderboardRank`: Long?,
    @SerialName("sortOrder") val `sortOrder`: Long,
    @SerialName("defaultFor") val `defaultFor`: List<String>,
    @SerialName("enabled") val `enabled`: Boolean,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
)

@Serializable
data class AdminCatalogEntryWrite(
    @SerialName("modelKey") val `modelKey`: ModelKey,
    @SerialName("displayName") val `displayName`: String,
    @SerialName("vendorName") val `vendorName`: String,
    @SerialName("upstreamId") val `upstreamId`: Id,
    @SerialName("upstreamModelId") val `upstreamModelId`: String,
    @SerialName("capabilities") val `capabilities`: List<ModelCapability>,
    @SerialName("tags") val `tags`: List<String>,
    @SerialName("leaderboardRank") val `leaderboardRank`: Long?,
    @SerialName("sortOrder") val `sortOrder`: Long,
    @SerialName("defaultFor") val `defaultFor`: List<String>,
    @SerialName("enabled") val `enabled`: Boolean,
)

@Serializable
data class AdminCatalogEntryWriteInput(
    @SerialName("modelKey") val `modelKey`: ModelKey,
    @SerialName("displayName") val `displayName`: String,
    @SerialName("vendorName") val `vendorName`: String,
    @SerialName("upstreamId") val `upstreamId`: Id,
    @SerialName("upstreamModelId") val `upstreamModelId`: String,
    @SerialName("capabilities") val `capabilities`: List<ModelCapability>,
    @SerialName("tags") val `tags`: List<String>,
    @SerialName("leaderboardRank") val `leaderboardRank`: Long?,
    @SerialName("sortOrder") val `sortOrder`: Long,
    @SerialName("defaultFor") val `defaultFor`: List<String>,
    @SerialName("enabled") val `enabled`: Boolean,
)

@Serializable
data class AdminCharacter(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("status") val `status`: CharacterPublishStatus,
    @SerialName("name") val `name`: String,
    @SerialName("aliases") val `aliases`: List<String>,
    @SerialName("works") val `works`: List<String>,
    @SerialName("tagline") val `tagline`: String,
    @SerialName("intro") val `intro`: String,
    @SerialName("tags") val `tags`: List<String>,
    @SerialName("categoryId") val `categoryId`: String?,
    @SerialName("avatar") val `avatar`: CharacterAvatar,
    @SerialName("birthday") val `birthday`: LocalDate?,
    @SerialName("fanName") val `fanName`: String?,
    @SerialName("classification") val `classification`: CharacterClassification,
    @SerialName("fallbackGreetings") val `fallbackGreetings`: List<String>,
    @SerialName("card") val `card`: DraftCharacterCard,
    @SerialName("personaVersion") val `personaVersion`: Long,
    @SerialName("publishChecks") val `publishChecks`: AdminCharacterPublishChecks,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
)

@Serializable
data class AdminCharacterUpdate(
    @SerialName("name") val `name`: String? = null,
    @SerialName("aliases") val `aliases`: List<String>? = null,
    @SerialName("works") val `works`: List<String>? = null,
    @SerialName("tagline") val `tagline`: String? = null,
    @SerialName("intro") val `intro`: String? = null,
    @SerialName("tags") val `tags`: List<String>? = null,
    @SerialName("categoryId") val `categoryId`: String? = null,
    @SerialName("avatar") val `avatar`: CharacterAvatarWrite? = null,
    @SerialName("birthday") val `birthday`: LocalDate? = null,
    @SerialName("fanName") val `fanName`: String? = null,
    @SerialName("classification") val `classification`: CharacterClassificationInput? = null,
    @SerialName("fallbackGreetings") val `fallbackGreetings`: List<String>? = null,
    @SerialName("card") val `card`: DraftCharacterCard? = null,
)

@Serializable
data class AdminCharacterUpdateInput(
    @SerialName("name") val `name`: String? = null,
    @SerialName("aliases") val `aliases`: List<String>? = null,
    @SerialName("works") val `works`: List<String>? = null,
    @SerialName("tagline") val `tagline`: String? = null,
    @SerialName("intro") val `intro`: String? = null,
    @SerialName("tags") val `tags`: List<String>? = null,
    @SerialName("categoryId") val `categoryId`: String? = null,
    @SerialName("avatar") val `avatar`: CharacterAvatarWriteInput? = null,
    @SerialName("birthday") val `birthday`: LocalDate? = null,
    @SerialName("fanName") val `fanName`: String? = null,
    @SerialName("classification") val `classification`: CharacterClassificationInputInput? = null,
    @SerialName("fallbackGreetings") val `fallbackGreetings`: List<String>? = null,
    @SerialName("card") val `card`: DraftCharacterCard? = null,
)

@Serializable
data class AdminCharacterWrite(
    @SerialName("name") val `name`: String,
    @SerialName("aliases") val `aliases`: List<String>,
    @SerialName("works") val `works`: List<String>,
    @SerialName("tagline") val `tagline`: String,
    @SerialName("intro") val `intro`: String,
    @SerialName("tags") val `tags`: List<String>,
    @SerialName("categoryId") val `categoryId`: String?,
    @SerialName("avatar") val `avatar`: CharacterAvatarWrite,
    @SerialName("birthday") val `birthday`: LocalDate?,
    @SerialName("fanName") val `fanName`: String?,
    @SerialName("classification") val `classification`: CharacterClassificationInput,
    @SerialName("fallbackGreetings") val `fallbackGreetings`: List<String>,
    @SerialName("card") val `card`: DraftCharacterCard,
)

@Serializable
data class AdminCharacterWriteInput(
    @SerialName("name") val `name`: String,
    @SerialName("aliases") val `aliases`: List<String>? = null,
    @SerialName("works") val `works`: List<String>? = null,
    @SerialName("tagline") val `tagline`: String,
    @SerialName("intro") val `intro`: String,
    @SerialName("tags") val `tags`: List<String>? = null,
    @SerialName("categoryId") val `categoryId`: String?,
    @SerialName("avatar") val `avatar`: CharacterAvatarWriteInput,
    @SerialName("birthday") val `birthday`: LocalDate?,
    @SerialName("fanName") val `fanName`: String?,
    @SerialName("classification") val `classification`: CharacterClassificationInputInput,
    @SerialName("fallbackGreetings") val `fallbackGreetings`: List<String>? = null,
    @SerialName("card") val `card`: DraftCharacterCard,
)

@Serializable
data class AdminLedgerEntry(
    @SerialName("entryId") val `entryId`: Id,
    @SerialName("type") val `type`: LedgerEntryType,
    @SerialName("amountMicros") val `amountMicros`: MoneyMicros,
    @SerialName("balanceAfterMicros") val `balanceAfterMicros`: MoneyMicros,
    @SerialName("category") val `category`: String?,
    @SerialName("modelKey") val `modelKey`: ModelKey?,
    @SerialName("characterId") val `characterId`: Id?,
    @SerialName("note") val `note`: String?,
    @SerialName("createdAt") val `createdAt`: Timestamp,
    @SerialName("costMicros") val `costMicros`: Long?,
    @SerialName("usageRecordId") val `usageRecordId`: Id?,
    @SerialName("priceVersionId") val `priceVersionId`: Id?,
    @SerialName("operatorUserId") val `operatorUserId`: Id?,
    @SerialName("absorbed") val `absorbed`: Boolean,
    @SerialName("safetyOverdraft") val `safetyOverdraft`: Boolean,
)

@Serializable
data class AdminPriceItem(
    @SerialName("modelKey") val `modelKey`: ModelKey,
    @SerialName("unit") val `unit`: PriceUnit,
    @SerialName("priceMicros") val `priceMicros`: Long,
    @SerialName("band") val `band`: PriceTimeBand?,
    @SerialName("costMicros") val `costMicros`: Long,
)

@Serializable
data class AdminPriceItemInput(
    @SerialName("modelKey") val `modelKey`: ModelKey,
    @SerialName("unit") val `unit`: PriceUnit,
    @SerialName("priceMicros") val `priceMicros`: Long,
    @SerialName("band") val `band`: PriceTimeBandInput?,
    @SerialName("costMicros") val `costMicros`: Long,
)

@Serializable
data class AdminPriceVersion(
    @SerialName("priceVersionId") val `priceVersionId`: Id,
    @SerialName("versionLabel") val `versionLabel`: String,
    @SerialName("status") val `status`: PriceVersionStatus,
    @SerialName("effectiveFrom") val `effectiveFrom`: Timestamp?,
    @SerialName("note") val `note`: String?,
    @SerialName("items") val `items`: List<AdminPriceItem>,
    @SerialName("createdAt") val `createdAt`: Timestamp,
)

@Serializable
data class AdminScenarioMode(
    @SerialName("id") val `id`: String,
    @SerialName("name") val `name`: String,
    @SerialName("description") val `description`: String,
    @SerialName("presetPrompt") val `presetPrompt`: String?,
    @SerialName("appliesTo") val `appliesTo`: ScenarioModeAppliesTo,
    @SerialName("hasRomanceContent") val `hasRomanceContent`: Boolean,
    @SerialName("hasAdultContent") val `hasAdultContent`: Boolean,
    @SerialName("isBuiltin") val `isBuiltin`: Boolean,
    @SerialName("enabled") val `enabled`: Boolean,
    @SerialName("sortOrder") val `sortOrder`: Long,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
)

@Serializable
data class AdminScenarioModeCreate(
    @SerialName("id") val `id`: String,
    @SerialName("name") val `name`: String,
    @SerialName("description") val `description`: String,
    @SerialName("presetPrompt") val `presetPrompt`: String?,
    @SerialName("appliesTo") val `appliesTo`: ScenarioModeAppliesTo,
    @SerialName("hasRomanceContent") val `hasRomanceContent`: Boolean,
    @SerialName("hasAdultContent") val `hasAdultContent`: Boolean,
    @SerialName("enabled") val `enabled`: Boolean,
    @SerialName("sortOrder") val `sortOrder`: Long,
)

@Serializable
data class AdminScenarioModeCreateInput(
    @SerialName("id") val `id`: String,
    @SerialName("name") val `name`: String,
    @SerialName("description") val `description`: String? = null,
    @SerialName("presetPrompt") val `presetPrompt`: String? = null,
    @SerialName("appliesTo") val `appliesTo`: ScenarioModeAppliesTo? = null,
    @SerialName("hasRomanceContent") val `hasRomanceContent`: Boolean? = null,
    @SerialName("hasAdultContent") val `hasAdultContent`: Boolean? = null,
    @SerialName("enabled") val `enabled`: Boolean? = null,
    @SerialName("sortOrder") val `sortOrder`: Long? = null,
)

@Serializable
data class AdminScenarioModeUpdate(
    @SerialName("name") val `name`: String? = null,
    @SerialName("description") val `description`: String? = null,
    @SerialName("presetPrompt") val `presetPrompt`: String? = null,
    @SerialName("appliesTo") val `appliesTo`: ScenarioModeAppliesTo? = null,
    @SerialName("hasRomanceContent") val `hasRomanceContent`: Boolean? = null,
    @SerialName("hasAdultContent") val `hasAdultContent`: Boolean? = null,
    @SerialName("enabled") val `enabled`: Boolean? = null,
    @SerialName("sortOrder") val `sortOrder`: Long? = null,
)

@Serializable
data class AdminScenarioModeUpdateInput(
    @SerialName("name") val `name`: String? = null,
    @SerialName("description") val `description`: String? = null,
    @SerialName("presetPrompt") val `presetPrompt`: String? = null,
    @SerialName("appliesTo") val `appliesTo`: ScenarioModeAppliesTo? = null,
    @SerialName("hasRomanceContent") val `hasRomanceContent`: Boolean? = null,
    @SerialName("hasAdultContent") val `hasAdultContent`: Boolean? = null,
    @SerialName("enabled") val `enabled`: Boolean? = null,
    @SerialName("sortOrder") val `sortOrder`: Long? = null,
)

typealias AdminUsageCallStatus = String

typealias AdminUsageDimension = String

@Serializable
data class AdminUsageFilter(
    @SerialName("from") val `from`: Timestamp,
    @SerialName("to") val `to`: Timestamp,
    @SerialName("userIds") val `userIds`: List<Id>? = null,
    @SerialName("characterIds") val `characterIds`: List<Id>? = null,
    @SerialName("modelKeys") val `modelKeys`: List<ModelKey>? = null,
    @SerialName("purposes") val `purposes`: List<ModelPurpose>? = null,
    @SerialName("billingOwner") val `billingOwner`: BillingOwner? = null,
    @SerialName("status") val `status`: AdminUsageCallStatus? = null,
    @SerialName("upstreamIds") val `upstreamIds`: List<Id>? = null,
)

@Serializable
data class AdminUsageFilterInput(
    @SerialName("from") val `from`: Timestamp,
    @SerialName("to") val `to`: Timestamp,
    @SerialName("userIds") val `userIds`: List<Id>? = null,
    @SerialName("characterIds") val `characterIds`: List<Id>? = null,
    @SerialName("modelKeys") val `modelKeys`: List<ModelKey>? = null,
    @SerialName("purposes") val `purposes`: List<ModelPurpose>? = null,
    @SerialName("billingOwner") val `billingOwner`: BillingOwner? = null,
    @SerialName("status") val `status`: AdminUsageCallStatus? = null,
    @SerialName("upstreamIds") val `upstreamIds`: List<Id>? = null,
)

@Serializable
data class AdminUsageRecord(
    @SerialName("usageRecordId") val `usageRecordId`: Id,
    @SerialName("createdAt") val `createdAt`: Timestamp,
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id?,
    @SerialName("conversationKind") val `conversationKind`: String?,
    @SerialName("purpose") val `purpose`: String,
    @SerialName("billingOwner") val `billingOwner`: BillingOwner,
    @SerialName("modelKey") val `modelKey`: ModelKey,
    @SerialName("upstreamId") val `upstreamId`: Id,
    @SerialName("inputTokens") val `inputTokens`: Long,
    @SerialName("cachedInputTokens") val `cachedInputTokens`: Long,
    @SerialName("outputTokens") val `outputTokens`: Long,
    @SerialName("estimated") val `estimated`: Boolean,
    @SerialName("latencyMs") val `latencyMs`: Long,
    @SerialName("ttftMs") val `ttftMs`: Long?,
    @SerialName("status") val `status`: AdminUsageCallStatus,
    @SerialName("errorCode") val `errorCode`: String?,
    @SerialName("retryCount") val `retryCount`: Long,
    @SerialName("chargedMicros") val `chargedMicros`: Long,
    @SerialName("costMicros") val `costMicros`: Long,
    @SerialName("absorbedCostMicros") val `absorbedCostMicros`: Long,
    @SerialName("priceVersionId") val `priceVersionId`: Id?,
    @SerialName("safetyOverdraft") val `safetyOverdraft`: Boolean,
)

@Serializable
data class AdminUsageSummary(
    @SerialName("rows") val `rows`: List<AdminUsageSummaryRow>,
    @SerialName("totals") val `totals`: AdminUsageTotals,
    @SerialName("truncated") val `truncated`: Boolean,
)

@Serializable
data class AdminUsageSummaryRequest(
    @SerialName("filter") val `filter`: AdminUsageFilter,
    @SerialName("groupBy") val `groupBy`: List<AdminUsageDimension>,
    @SerialName("sort") val `sort`: String,
    @SerialName("limit") val `limit`: Long,
)

@Serializable
data class AdminUsageSummaryRequestInput(
    @SerialName("filter") val `filter`: AdminUsageFilterInput,
    @SerialName("groupBy") val `groupBy`: List<AdminUsageDimension>,
    @SerialName("sort") val `sort`: String? = null,
    @SerialName("limit") val `limit`: Long? = null,
)

@Serializable
data class AdminUsageSummaryRow(
    @SerialName("calls") val `calls`: Long,
    @SerialName("failedCalls") val `failedCalls`: Long,
    @SerialName("inputTokens") val `inputTokens`: Long,
    @SerialName("cachedInputTokens") val `cachedInputTokens`: Long,
    @SerialName("outputTokens") val `outputTokens`: Long,
    @SerialName("totalTokens") val `totalTokens`: Long,
    @SerialName("estimatedTokens") val `estimatedTokens`: Long,
    @SerialName("chargedMicros") val `chargedMicros`: Long,
    @SerialName("costMicros") val `costMicros`: Long,
    @SerialName("absorbedCostMicros") val `absorbedCostMicros`: Long,
    @SerialName("keys") val `keys`: List<String>,
)

@Serializable
data class AdminUsageTotals(
    @SerialName("calls") val `calls`: Long,
    @SerialName("failedCalls") val `failedCalls`: Long,
    @SerialName("inputTokens") val `inputTokens`: Long,
    @SerialName("cachedInputTokens") val `cachedInputTokens`: Long,
    @SerialName("outputTokens") val `outputTokens`: Long,
    @SerialName("totalTokens") val `totalTokens`: Long,
    @SerialName("estimatedTokens") val `estimatedTokens`: Long,
    @SerialName("chargedMicros") val `chargedMicros`: Long,
    @SerialName("costMicros") val `costMicros`: Long,
    @SerialName("absorbedCostMicros") val `absorbedCostMicros`: Long,
)

typealias AgeSetting = String

typealias AndroidPushProvider = String

@Serializable
data class ApiError(
    @SerialName("error") val `error`: ApiErrorError,
)

typealias AppTheme = String

@Serializable
data class AuthResponse(
    @SerialName("session") val `session`: AuthenticatedSession,
    @SerialName("user") val `user`: CurrentUser,
)

@Serializable
data class AuthenticatedSession(
    @SerialName("sessionId") val `sessionId`: Id,
    @SerialName("token") val `token`: String,
    @SerialName("kind") val `kind`: SessionKind,
    @SerialName("expiresAt") val `expiresAt`: Timestamp,
)

@Serializable
data class AuthorizationResponse(
    @SerialName("authorizedCharacterIds") val `authorizedCharacterIds`: List<Id>,
)

typealias AvatarPattern = String

@Serializable
data class BillingAdminEndpointsActivatePriceVersionBody(
    @SerialName("effectiveFrom") val `effectiveFrom`: Timestamp?,
)

@Serializable
data class BillingAdminEndpointsActivatePriceVersionParams(
    @SerialName("priceVersionId") val `priceVersionId`: Id,
)

@Serializable
data class BillingAdminEndpointsAdjustBalanceParams(
    @SerialName("userId") val `userId`: Id,
)

@Serializable
data class BillingAdminEndpointsCreatePriceVersionBody(
    @SerialName("versionLabel") val `versionLabel`: String,
    @SerialName("note") val `note`: String?,
    @SerialName("items") val `items`: List<AdminPriceItemInput>,
)

@Serializable
data class BillingAdminEndpointsCreateUpstreamBillBody(
    @SerialName("upstreamId") val `upstreamId`: Id,
    @SerialName("periodStart") val `periodStart`: LocalDate,
    @SerialName("periodEnd") val `periodEnd`: LocalDate,
    @SerialName("amountMicros") val `amountMicros`: Long,
    @SerialName("note") val `note`: String?,
)

@Serializable
data class BillingAdminEndpointsGetPlatformSummaryResponse(
    @SerialName("todayCostMicros") val `todayCostMicros`: Long,
    @SerialName("dailyCapMicros") val `dailyCapMicros`: Long,
    @SerialName("platformAccountBalanceMicros") val `platformAccountBalanceMicros`: MoneyMicros,
    @SerialName("last30DaysCostByUpstream") val `last30DaysCostByUpstream`: List<BillingAdminEndpointsGetPlatformSummaryResponseLast30DaysCostByUpstreamItem>,
)

@Serializable
data class BillingAdminEndpointsListAccountLedgerParams(
    @SerialName("userId") val `userId`: Id,
)

@Serializable
data class BillingAdminEndpointsListAccountLedgerQuery(
    @SerialName("cursor") val `cursor`: String? = null,
    @SerialName("limit") val `limit`: Long? = null,
)

@Serializable
data class BillingAdminEndpointsListAccountLedgerResponse(
    @SerialName("items") val `items`: List<AdminLedgerEntry>,
    @SerialName("nextCursor") val `nextCursor`: String?,
)

@Serializable
data class BillingAdminEndpointsListAccountsResponse(
    @SerialName("items") val `items`: List<AdminAccountSummary>,
)

@Serializable
data class BillingAdminEndpointsListPriceVersionsResponse(
    @SerialName("items") val `items`: List<AdminPriceVersion>,
)

@Serializable
data class BillingAdminEndpointsListReconciliationQuery(
    @SerialName("from") val `from`: LocalDate,
    @SerialName("to") val `to`: LocalDate,
)

@Serializable
data class BillingAdminEndpointsListReconciliationResponse(
    @SerialName("items") val `items`: List<ReconciliationRun>,
)

@Serializable
data class BillingAdminEndpointsUpdatePriceDraftBody(
    @SerialName("note") val `note`: String? = null,
    @SerialName("items") val `items`: List<AdminPriceItemInput>? = null,
)

@Serializable
data class BillingAdminEndpointsUpdatePriceDraftParams(
    @SerialName("priceVersionId") val `priceVersionId`: Id,
)

@Serializable
data class BillingEndpointsGetUsageSummaryResponse(
    @SerialName("rows") val `rows`: List<UsageSummaryRow>,
    @SerialName("totalMicros") val `totalMicros`: Long,
)

@Serializable
data class BillingEndpointsListLedgerQuery(
    @SerialName("type") val `type`: String? = null,
    @SerialName("cursor") val `cursor`: String? = null,
    @SerialName("limit") val `limit`: Long? = null,
)

@Serializable
data class BillingEndpointsListLedgerResponse(
    @SerialName("items") val `items`: List<LedgerEntry>,
    @SerialName("nextCursor") val `nextCursor`: String?,
)

typealias BillingOwner = String

@Serializable
data class CardAdmin(
    @SerialName("creatorNotes") val `creatorNotes`: String? = null,
    @SerialName("sourceList") val `sourceList`: List<CardAdminSourceListItem>? = null,
    @SerialName("creationMethod") val `creationMethod`: String,
    @SerialName("importSource") val `importSource`: CardAdminImportSource? = null,
    @SerialName("extensions") val `extensions`: Map<String, SharedSchema0>? = null,
)

@Serializable
data class CardExample(
    @SerialName("id") val `id`: String,
    @SerialName("scene") val `scene`: String,
    @SerialName("turns") val `turns`: List<CardExampleTurnsItem>,
)

@Serializable
data class CardKnowledge(
    @SerialName("entries") val `entries`: List<CardKnowledgeEntry>,
    @SerialName("unknownPolicy") val `unknownPolicy`: String,
)

@Serializable
data class CardKnowledgeEntry(
    @SerialName("id") val `id`: String,
    @SerialName("title") val `title`: String,
    @SerialName("category") val `category`: String,
    @SerialName("keys") val `keys`: List<String>,
    @SerialName("secondaryKeys") val `secondaryKeys`: List<String>? = null,
    @SerialName("selective") val `selective`: Boolean? = null,
    @SerialName("content") val `content`: String,
    @SerialName("constant") val `constant`: Boolean? = null,
    @SerialName("priority") val `priority`: Long? = null,
    @SerialName("validFrom") val `validFrom`: LocalDate? = null,
    @SerialName("validTo") val `validTo`: LocalDate? = null,
    @SerialName("sources") val `sources`: List<CardSource>? = null,
    @SerialName("confidence") val `confidence`: String,
)

@Serializable
data class CardModes(
    @SerialName("adminAllowlist") val `adminAllowlist`: List<String>,
    @SerialName("modeOverrides") val `modeOverrides`: Map<String, String>? = null,
)

@Serializable
data class CardOpening(
    @SerialName("firstMessageGuidance") val `firstMessageGuidance`: String? = null,
    @SerialName("referralGreetingGuidance") val `referralGreetingGuidance`: String? = null,
)

@Serializable
data class CardPersona(
    @SerialName("summary") val `summary`: String,
    @SerialName("background") val `background`: String? = null,
    @SerialName("personality") val `personality`: String,
    @SerialName("values") val `values`: String? = null,
    @SerialName("likes") val `likes`: List<String>? = null,
    @SerialName("dislikes") val `dislikes`: List<String>? = null,
    @SerialName("personaTags") val `personaTags`: List<PersonaTag>,
    @SerialName("personaTagsCustom") val `personaTagsCustom`: List<String>? = null,
    @SerialName("defaultAttitudeToUser") val `defaultAttitudeToUser`: String? = null,
    @SerialName("growthByFamiliarity") val `growthByFamiliarity`: CardPersonaGrowthByFamiliarity? = null,
    @SerialName("worldNote") val `worldNote`: String? = null,
)

@Serializable
data class CardProfileExtra(
    @SerialName("occupation") val `occupation`: String,
    @SerialName("gender") val `gender`: String? = null,
    @SerialName("ageDisplay") val `ageDisplay`: String? = null,
    @SerialName("workSource") val `workSource`: String? = null,
    @SerialName("fanNameUsage") val `fanNameUsage`: String? = null,
    @SerialName("worksDetail") val `worksDetail`: List<CardProfileExtraWorksDetailItem>? = null,
    @SerialName("searchKeywords") val `searchKeywords`: List<String>? = null,
)

@Serializable
data class CardRecognition(
    @SerialName("selfEnabled") val `selfEnabled`: Boolean,
    @SerialName("selfPublicImages") val `selfPublicImages`: List<CardRecognitionSelfPublicImagesItem>? = null,
    @SerialName("selfReferenceMediaIds") val `selfReferenceMediaIds`: List<Id>? = null,
    @SerialName("appearanceCues") val `appearanceCues`: String? = null,
)

@Serializable
data class CardSafetyStyle(
    @SerialName("deflectStyle") val `deflectStyle`: String? = null,
    @SerialName("refuseSelfieStyle") val `refuseSelfieStyle`: String? = null,
    @SerialName("careVoice") val `careVoice`: String,
    @SerialName("careFallbackText") val `careFallbackText`: String,
)

@Serializable
data class CardSimulation(
    @SerialName("dailyActivities") val `dailyActivities`: List<String>,
    @SerialName("placeTypes") val `placeTypes`: List<String>,
    @SerialName("hobbies") val `hobbies`: List<String>,
    @SerialName("workRhythm") val `workRhythm`: String? = null,
    @SerialName("storylineSeeds") val `storylineSeeds`: List<String>? = null,
    @SerialName("forbiddenEventTopics") val `forbiddenEventTopics`: List<String>? = null,
    @SerialName("moodBaseline") val `moodBaseline`: String? = null,
    @SerialName("sharePreference") val `sharePreference`: String? = null,
)

@Serializable
data class CardSocial(
    @SerialName("talkativeness") val `talkativeness`: Long,
    @SerialName("groupStyle") val `groupStyle`: String? = null,
    @SerialName("moments") val `moments`: CardSocialMoments,
    @SerialName("stickerPacks") val `stickerPacks`: List<String>? = null,
    @SerialName("stickerRate") val `stickerRate`: String? = null,
    @SerialName("voiceId") val `voiceId`: String? = null,
    @SerialName("proactiveStyle") val `proactiveStyle`: String? = null,
    @SerialName("callStyle") val `callStyle`: String? = null,
)

@Serializable
data class CardSource(
    @SerialName("url") val `url`: String,
    @SerialName("title") val `title`: String,
    @SerialName("accessedAt") val `accessedAt`: String,
)

@Serializable
data class CardSpeech(
    @SerialName("selfReference") val `selfReference`: List<String>,
    @SerialName("addressUserDefault") val `addressUserDefault`: String? = null,
    @SerialName("tone") val `tone`: String,
    @SerialName("sentenceLength") val `sentenceLength`: String,
    @SerialName("catchphrases") val `catchphrases`: List<String>? = null,
    @SerialName("catchphraseFrequency") val `catchphraseFrequency`: String? = null,
    @SerialName("emojiHabit") val `emojiHabit`: CardSpeechEmojiHabit,
    @SerialName("punctuationHabit") val `punctuationHabit`: String? = null,
    @SerialName("dialect") val `dialect`: String? = null,
    @SerialName("typoStyle") val `typoStyle`: String? = null,
    @SerialName("forbiddenWords") val `forbiddenWords`: List<String>? = null,
    @SerialName("languageNotes") val `languageNotes`: String? = null,
)

@Serializable
data class CharacterAdminEndpointsListQuery(
    @SerialName("status") val `status`: CharacterPublishStatus? = null,
    @SerialName("q") val `q`: String? = null,
)

@Serializable
data class CharacterAdminEndpointsListResponse(
    @SerialName("items") val `items`: List<AdminCharacter>,
)

@Serializable
data class CharacterAdminEndpointsPublishParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class CharacterAdminEndpointsUnpublishParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class CharacterAdminEndpointsUpdateParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class CharacterAuthEntry(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("authorized") val `authorized`: Boolean,
)

@Serializable
data class CharacterAvatar(
    @SerialName("image") val `image`: CharacterAvatarImage?,
    @SerialName("display") val `display`: CharacterDisplay,
)

@Serializable
data class CharacterAvatarWrite(
    @SerialName("imageMediaId") val `imageMediaId`: Id?,
    @SerialName("display") val `display`: CharacterDisplay,
)

@Serializable
data class CharacterAvatarWriteInput(
    @SerialName("imageMediaId") val `imageMediaId`: Id?,
    @SerialName("display") val `display`: CharacterDisplayInput,
)

typealias CharacterBasis = String

@Serializable
data class CharacterCard(
    @EncodeDefault
    @SerialName("cardSchemaVersion") val `cardSchemaVersion`: Long = 1,
    @SerialName("data") val `data`: WeibanCardData,
)

@Serializable
data class CharacterCategory(
    @SerialName("categoryId") val `categoryId`: String,
    @SerialName("name") val `name`: String,
    @SerialName("order") val `order`: Long,
)

@Serializable
data class CharacterClassification(
    @SerialName("basis") val `basis`: CharacterBasis,
    @SerialName("realPersonKind") val `realPersonKind`: RealPersonKind?,
    @SerialName("ageSetting") val `ageSetting`: AgeSetting,
    @SerialName("childAppearance") val `childAppearance`: Boolean,
    @SerialName("childFeaturesDetected") val `childFeaturesDetected`: Boolean,
    @SerialName("derived") val `derived`: CharacterClassificationDerived,
)

@Serializable
data class CharacterClassificationInput(
    @SerialName("basis") val `basis`: CharacterBasis,
    @SerialName("realPersonKind") val `realPersonKind`: RealPersonKind?,
    @SerialName("ageSetting") val `ageSetting`: AgeSetting,
    @SerialName("childAppearance") val `childAppearance`: Boolean,
)

@Serializable
data class CharacterClassificationInputInput(
    @SerialName("basis") val `basis`: CharacterBasis,
    @SerialName("realPersonKind") val `realPersonKind`: RealPersonKind?,
    @SerialName("ageSetting") val `ageSetting`: AgeSetting,
    @SerialName("childAppearance") val `childAppearance`: Boolean,
)

@Serializable
data class CharacterDisplay(
    @SerialName("supportColors") val `supportColors`: List<HexColor>,
    @SerialName("avatarText") val `avatarText`: String?,
    @SerialName("avatarPattern") val `avatarPattern`: AvatarPattern,
    @SerialName("themeColor") val `themeColor`: HexColor?,
)

@Serializable
data class CharacterDisplayInput(
    @SerialName("supportColors") val `supportColors`: List<HexColor>,
    @SerialName("avatarText") val `avatarText`: String?,
    @SerialName("avatarPattern") val `avatarPattern`: AvatarPattern,
    @SerialName("themeColor") val `themeColor`: HexColor?,
)

@Serializable
data class CharacterEndpointsGetProfileParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class CharacterEndpointsListCategoriesResponse(
    @SerialName("items") val `items`: List<CharacterCategory>,
)

@Serializable
data class CharacterEndpointsSearchPlazaQuery(
    @SerialName("q") val `q`: String? = null,
    @SerialName("categoryId") val `categoryId`: String? = null,
    @SerialName("cursor") val `cursor`: String? = null,
    @SerialName("limit") val `limit`: Long? = null,
)

@Serializable
data class CharacterEndpointsSearchPlazaResponse(
    @SerialName("items") val `items`: List<CharacterSummary>,
    @SerialName("nextCursor") val `nextCursor`: String?,
)

typealias CharacterKind = String

@Serializable
data class CharacterModelOverride(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("chat") val `chat`: ModelRefState?,
)

@Serializable
data class CharacterProfile(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("kind") val `kind`: CharacterKind,
    @SerialName("name") val `name`: String,
    @SerialName("avatar") val `avatar`: CharacterAvatar,
    @SerialName("tagline") val `tagline`: String,
    @SerialName("tags") val `tags`: List<String>,
    @SerialName("categoryId") val `categoryId`: String?,
    @SerialName("basis") val `basis`: CharacterBasis,
    @SerialName("added") val `added`: Boolean,
    @SerialName("aliases") val `aliases`: List<String>,
    @SerialName("works") val `works`: List<String>,
    @SerialName("intro") val `intro`: String,
    @SerialName("birthday") val `birthday`: LocalDate?,
    @SerialName("fanName") val `fanName`: String?,
    @SerialName("classification") val `classification`: CharacterClassification,
    @SerialName("showPublicSourceNotice") val `showPublicSourceNotice`: Boolean,
    @SerialName("personaVersion") val `personaVersion`: Long,
    @SerialName("personaUpdatedUnseen") val `personaUpdatedUnseen`: Boolean,
)

typealias CharacterPublishStatus = String

@Serializable
data class CharacterSummary(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("kind") val `kind`: CharacterKind,
    @SerialName("name") val `name`: String,
    @SerialName("avatar") val `avatar`: CharacterAvatar,
    @SerialName("tagline") val `tagline`: String,
    @SerialName("tags") val `tags`: List<String>,
    @SerialName("categoryId") val `categoryId`: String?,
    @SerialName("basis") val `basis`: CharacterBasis,
    @SerialName("added") val `added`: Boolean,
)

@Serializable
data class ChatEndpointsListConversationsResponse(
    @SerialName("items") val `items`: List<Conversation>,
)

@Serializable
data class ChatEndpointsMarkReadBody(
    @SerialName("readSeq") val `readSeq`: Seq,
)

@Serializable
data class ClientAuthFrame(
    @EncodeDefault
    @SerialName("v") val `v`: Long = 1,
    @EncodeDefault
    @SerialName("type") val `type`: String = "auth",
    @SerialName("ref") val `ref`: String? = null,
    @SerialName("data") val `data`: ClientAuthFrameData,
)

@Serializable(with = ClientFrameSerializer::class)
sealed interface ClientFrame {
    val `v`: Long
    val `type`: String
    val `ref`: String?
}

@Serializable
data class ClientFrameAuth(
    @EncodeDefault
    @SerialName("v") override val `v`: Long = 1,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "auth",
    @SerialName("ref") override val `ref`: String? = null,
    @SerialName("data") val `data`: ClientFrameAuthData,
) : ClientFrame

@Serializable
data class ClientFramePing(
    @EncodeDefault
    @SerialName("v") override val `v`: Long = 1,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "ping",
    @SerialName("ref") override val `ref`: String? = null,
    @SerialName("data") val `data`: ClientFramePingData,
) : ClientFrame

@Serializable
data class ClientFrameMessageSend(
    @EncodeDefault
    @SerialName("v") override val `v`: Long = 1,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "message.send",
    @SerialName("ref") override val `ref`: String? = null,
    @SerialName("data") val `data`: ClientFrameMessageSendData,
) : ClientFrame

@Serializable
data class ClientFramePresenceFocus(
    @EncodeDefault
    @SerialName("v") override val `v`: Long = 1,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "presence.focus",
    @SerialName("ref") override val `ref`: String? = null,
    @SerialName("data") val `data`: ClientFramePresenceFocusData,
) : ClientFrame

object ClientFrameSerializer : KSerializer<ClientFrame> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("ClientFrame")
    override fun deserialize(decoder: Decoder): ClientFrame {
        val input = decoder as JsonDecoder
        var value = input.decodeJsonElement().jsonObject
        val tag = value["type"]?.jsonPrimitive?.content
        return when (tag) {
            "auth" -> input.json.decodeFromJsonElement(ClientFrameAuth.serializer(), value)
            "ping" -> input.json.decodeFromJsonElement(ClientFramePing.serializer(), value)
            "message.send" -> input.json.decodeFromJsonElement(ClientFrameMessageSend.serializer(), value)
            "presence.focus" -> input.json.decodeFromJsonElement(ClientFramePresenceFocus.serializer(), value)
            else -> throw SerializationException("Unknown discriminator")
        }
    }
    override fun serialize(encoder: Encoder, value: ClientFrame) {
        val output = encoder as JsonEncoder
        val element = when (value) {
            is ClientFrameAuth -> output.json.encodeToJsonElement(ClientFrameAuth.serializer(), value)
            is ClientFramePing -> output.json.encodeToJsonElement(ClientFramePing.serializer(), value)
            is ClientFrameMessageSend -> output.json.encodeToJsonElement(ClientFrameMessageSend.serializer(), value)
            is ClientFramePresenceFocus -> output.json.encodeToJsonElement(ClientFramePresenceFocus.serializer(), value)
        }
        output.encodeJsonElement(element)
    }
}

@Serializable
data class ClientFullSyncSnapshot(
    @SerialName("conversations") val `conversations`: List<Conversation>,
    @SerialName("messages") val `messages`: List<Message>,
    @SerialName("contacts") val `contacts`: List<Contact>,
    @SerialName("settings") val `settings`: Map<String, SharedSchema1>,
    @SerialName("coverages") val `coverages`: List<ClientFullSyncSnapshotCoveragesItem>,
)

typealias ClientMsgId = String

@Serializable
data class ClientPendingSend(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("body") val `body`: SendMessageRequest,
    @SerialName("state") val `state`: String,
    @SerialName("failures") val `failures`: Long,
    @SerialName("retryAt") val `retryAt`: Long,
)

@Serializable
data class ClientPingFrame(
    @EncodeDefault
    @SerialName("v") val `v`: Long = 1,
    @EncodeDefault
    @SerialName("type") val `type`: String = "ping",
    @SerialName("ref") val `ref`: String? = null,
    @SerialName("data") val `data`: ClientPingFrameData,
)

typealias ClientPlatform = String

@Serializable
data class ClientPresenceFrame(
    @EncodeDefault
    @SerialName("v") val `v`: Long = 1,
    @EncodeDefault
    @SerialName("type") val `type`: String = "presence.focus",
    @SerialName("ref") val `ref`: String? = null,
    @SerialName("data") val `data`: ClientPresenceFrameData,
)

@Serializable
data class ClientSendMessageFrame(
    @EncodeDefault
    @SerialName("v") val `v`: Long = 1,
    @EncodeDefault
    @SerialName("type") val `type`: String = "message.send",
    @SerialName("ref") val `ref`: String? = null,
    @SerialName("data") val `data`: ClientSendMessageFrameData,
)

@Serializable(with = ClientSyncEffectSerializer::class)
sealed interface ClientSyncEffect {
    val `type`: String
}

@Serializable
data class ClientSyncEffectSend(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "send",
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("body") val `body`: SendMessageRequest,
) : ClientSyncEffect

@Serializable
data class ClientSyncEffectUpdates(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "updates",
    @SerialName("since") val `since`: Long,
    @EncodeDefault
    @SerialName("limit") val `limit`: Long = 500,
) : ClientSyncEffect

@Serializable
data class ClientSyncEffectState(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "state",
) : ClientSyncEffect

@Serializable
data class ClientSyncEffectSnapshot(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "snapshot",
    @SerialName("startSeq") val `startSeq`: Long,
) : ClientSyncEffect

@Serializable
data class ClientSyncEffectMessages(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "messages",
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("afterSeq") val `afterSeq`: Long,
    @EncodeDefault
    @SerialName("limit") val `limit`: Long = 200,
) : ClientSyncEffect

@Serializable
data class ClientSyncEffectSettings(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "settings",
    @SerialName("section") val `section`: String,
    @SerialName("characterId") val `characterId`: Id?,
) : ClientSyncEffect

@Serializable
data class ClientSyncEffectModelStatus(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "model-status",
    @SerialName("status") val `status`: ModelStatus,
) : ClientSyncEffect

object ClientSyncEffectSerializer : KSerializer<ClientSyncEffect> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("ClientSyncEffect")
    override fun deserialize(decoder: Decoder): ClientSyncEffect {
        val input = decoder as JsonDecoder
        var value = input.decodeJsonElement().jsonObject
        val tag = value["type"]?.jsonPrimitive?.content
        return when (tag) {
            "send" -> input.json.decodeFromJsonElement(ClientSyncEffectSend.serializer(), value)
            "updates" -> input.json.decodeFromJsonElement(ClientSyncEffectUpdates.serializer(), value)
            "state" -> input.json.decodeFromJsonElement(ClientSyncEffectState.serializer(), value)
            "snapshot" -> input.json.decodeFromJsonElement(ClientSyncEffectSnapshot.serializer(), value)
            "messages" -> input.json.decodeFromJsonElement(ClientSyncEffectMessages.serializer(), value)
            "settings" -> input.json.decodeFromJsonElement(ClientSyncEffectSettings.serializer(), value)
            "model-status" -> input.json.decodeFromJsonElement(ClientSyncEffectModelStatus.serializer(), value)
            else -> throw SerializationException("Unknown discriminator")
        }
    }
    override fun serialize(encoder: Encoder, value: ClientSyncEffect) {
        val output = encoder as JsonEncoder
        val element = when (value) {
            is ClientSyncEffectSend -> output.json.encodeToJsonElement(ClientSyncEffectSend.serializer(), value)
            is ClientSyncEffectUpdates -> output.json.encodeToJsonElement(ClientSyncEffectUpdates.serializer(), value)
            is ClientSyncEffectState -> output.json.encodeToJsonElement(ClientSyncEffectState.serializer(), value)
            is ClientSyncEffectSnapshot -> output.json.encodeToJsonElement(ClientSyncEffectSnapshot.serializer(), value)
            is ClientSyncEffectMessages -> output.json.encodeToJsonElement(ClientSyncEffectMessages.serializer(), value)
            is ClientSyncEffectSettings -> output.json.encodeToJsonElement(ClientSyncEffectSettings.serializer(), value)
            is ClientSyncEffectModelStatus -> output.json.encodeToJsonElement(ClientSyncEffectModelStatus.serializer(), value)
        }
        output.encodeJsonElement(element)
    }
}

@Serializable(with = ClientSyncOperationSerializer::class)
sealed interface ClientSyncOperation {
    val `type`: String
}

@Serializable
data class ClientSyncOperationOffline(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "offline",
) : ClientSyncOperation

@Serializable
data class ClientSyncOperationReconnect(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "reconnect",
    @SerialName("latestUpdateSeq") val `latestUpdateSeq`: Long,
    @SerialName("now") val `now`: Long,
) : ClientSyncOperation

@Serializable
data class ClientSyncOperationEnqueue(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "enqueue",
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("body") val `body`: SendMessageRequest,
    @SerialName("now") val `now`: Long,
) : ClientSyncOperation

@Serializable
data class ClientSyncOperationAck(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "ack",
    @SerialName("ack") val `ack`: MessageAck,
    @SerialName("now") val `now`: Long,
) : ClientSyncOperation

@Serializable
data class ClientSyncOperationSendFailed(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "send.failed",
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("clientMsgId") val `clientMsgId`: Id,
    @SerialName("httpStatus") val `httpStatus`: Long?,
    @SerialName("now") val `now`: Long,
) : ClientSyncOperation

@Serializable
data class ClientSyncOperationRetry(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "retry",
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("clientMsgId") val `clientMsgId`: Id,
    @SerialName("now") val `now`: Long,
) : ClientSyncOperation

@Serializable
data class ClientSyncOperationTick(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "tick",
    @SerialName("now") val `now`: Long,
) : ClientSyncOperation

@Serializable
data class ClientSyncOperationUpdate(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "update",
    @SerialName("update") val `update`: UserUpdate,
) : ClientSyncOperation

@Serializable
data class ClientSyncOperationUpdatesPage(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "updates.page",
    @SerialName("page") val `page`: SyncEndpointsGetUpdatesResponse,
    @SerialName("now") val `now`: Long,
) : ClientSyncOperation

@Serializable
data class ClientSyncOperationCursorExpired(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "cursor.expired",
) : ClientSyncOperation

@Serializable
data class ClientSyncOperationRebuildState(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "rebuild.state",
    @SerialName("latestUpdateSeq") val `latestUpdateSeq`: Long,
) : ClientSyncOperation

@Serializable
data class ClientSyncOperationSnapshot(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "snapshot",
    @SerialName("startSeq") val `startSeq`: Long,
    @SerialName("snapshot") val `snapshot`: ClientFullSyncSnapshot,
) : ClientSyncOperation

@Serializable
data class ClientSyncOperationInspect(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "inspect",
    @SerialName("conversationId") val `conversationId`: Id,
) : ClientSyncOperation

@Serializable
data class ClientSyncOperationMessagesPage(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "messages.page",
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("page") val `page`: MessagePage,
) : ClientSyncOperation

@Serializable
data class ClientSyncOperationAccountReset(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "account.reset",
) : ClientSyncOperation

@Serializable
data class ClientSyncOperationRestart(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "restart",
) : ClientSyncOperation

object ClientSyncOperationSerializer : KSerializer<ClientSyncOperation> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("ClientSyncOperation")
    override fun deserialize(decoder: Decoder): ClientSyncOperation {
        val input = decoder as JsonDecoder
        var value = input.decodeJsonElement().jsonObject
        val tag = value["type"]?.jsonPrimitive?.content
        return when (tag) {
            "offline" -> input.json.decodeFromJsonElement(ClientSyncOperationOffline.serializer(), value)
            "reconnect" -> input.json.decodeFromJsonElement(ClientSyncOperationReconnect.serializer(), value)
            "enqueue" -> input.json.decodeFromJsonElement(ClientSyncOperationEnqueue.serializer(), value)
            "ack" -> input.json.decodeFromJsonElement(ClientSyncOperationAck.serializer(), value)
            "send.failed" -> input.json.decodeFromJsonElement(ClientSyncOperationSendFailed.serializer(), value)
            "retry" -> input.json.decodeFromJsonElement(ClientSyncOperationRetry.serializer(), value)
            "tick" -> input.json.decodeFromJsonElement(ClientSyncOperationTick.serializer(), value)
            "update" -> input.json.decodeFromJsonElement(ClientSyncOperationUpdate.serializer(), value)
            "updates.page" -> input.json.decodeFromJsonElement(ClientSyncOperationUpdatesPage.serializer(), value)
            "cursor.expired" -> input.json.decodeFromJsonElement(ClientSyncOperationCursorExpired.serializer(), value)
            "rebuild.state" -> input.json.decodeFromJsonElement(ClientSyncOperationRebuildState.serializer(), value)
            "snapshot" -> input.json.decodeFromJsonElement(ClientSyncOperationSnapshot.serializer(), value)
            "inspect" -> input.json.decodeFromJsonElement(ClientSyncOperationInspect.serializer(), value)
            "messages.page" -> input.json.decodeFromJsonElement(ClientSyncOperationMessagesPage.serializer(), value)
            "account.reset" -> input.json.decodeFromJsonElement(ClientSyncOperationAccountReset.serializer(), value)
            "restart" -> input.json.decodeFromJsonElement(ClientSyncOperationRestart.serializer(), value)
            else -> throw SerializationException("Unknown discriminator")
        }
    }
    override fun serialize(encoder: Encoder, value: ClientSyncOperation) {
        val output = encoder as JsonEncoder
        val element = when (value) {
            is ClientSyncOperationOffline -> output.json.encodeToJsonElement(ClientSyncOperationOffline.serializer(), value)
            is ClientSyncOperationReconnect -> output.json.encodeToJsonElement(ClientSyncOperationReconnect.serializer(), value)
            is ClientSyncOperationEnqueue -> output.json.encodeToJsonElement(ClientSyncOperationEnqueue.serializer(), value)
            is ClientSyncOperationAck -> output.json.encodeToJsonElement(ClientSyncOperationAck.serializer(), value)
            is ClientSyncOperationSendFailed -> output.json.encodeToJsonElement(ClientSyncOperationSendFailed.serializer(), value)
            is ClientSyncOperationRetry -> output.json.encodeToJsonElement(ClientSyncOperationRetry.serializer(), value)
            is ClientSyncOperationTick -> output.json.encodeToJsonElement(ClientSyncOperationTick.serializer(), value)
            is ClientSyncOperationUpdate -> output.json.encodeToJsonElement(ClientSyncOperationUpdate.serializer(), value)
            is ClientSyncOperationUpdatesPage -> output.json.encodeToJsonElement(ClientSyncOperationUpdatesPage.serializer(), value)
            is ClientSyncOperationCursorExpired -> output.json.encodeToJsonElement(ClientSyncOperationCursorExpired.serializer(), value)
            is ClientSyncOperationRebuildState -> output.json.encodeToJsonElement(ClientSyncOperationRebuildState.serializer(), value)
            is ClientSyncOperationSnapshot -> output.json.encodeToJsonElement(ClientSyncOperationSnapshot.serializer(), value)
            is ClientSyncOperationInspect -> output.json.encodeToJsonElement(ClientSyncOperationInspect.serializer(), value)
            is ClientSyncOperationMessagesPage -> output.json.encodeToJsonElement(ClientSyncOperationMessagesPage.serializer(), value)
            is ClientSyncOperationAccountReset -> output.json.encodeToJsonElement(ClientSyncOperationAccountReset.serializer(), value)
            is ClientSyncOperationRestart -> output.json.encodeToJsonElement(ClientSyncOperationRestart.serializer(), value)
        }
        output.encodeJsonElement(element)
    }
}

@Serializable
data class ClientSyncState(
    @SerialName("initialized") val `initialized`: Boolean,
    @SerialName("lastUpdateSeq") val `lastUpdateSeq`: Long,
    @SerialName("messages") val `messages`: List<Message>,
    @SerialName("recalled") val `recalled`: List<ClientSyncStateRecalledItem>,
    @SerialName("conversations") val `conversations`: List<Conversation>,
    @SerialName("contacts") val `contacts`: List<Contact>,
    @SerialName("outbox") val `outbox`: List<ClientPendingSend>,
    @SerialName("excluded") val `excluded`: List<ClientSyncStateExcludedItem>,
    @SerialName("scannedThrough") val `scannedThrough`: Map<String, Long>,
    @SerialName("pendingUpdates") val `pendingUpdates`: List<UserUpdate>,
    @SerialName("settings") val `settings`: Map<String, SharedSchema2>,
)

@Serializable
data class CompanionEndpointsGetForCharacterParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class CompanionEndpointsGetForCharacterResponse(
    @SerialName("instantReply") val `instantReply`: Boolean,
    @SerialName("splitBubbles") val `splitBubbles`: Boolean,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
    @SerialName("inheritsDefaults") val `inheritsDefaults`: Boolean,
    @SerialName("personaFit") val `personaFit`: Long? = null,
    @SerialName("scenarioMode") val `scenarioMode`: ScenarioMode? = null,
    @SerialName("proactiveMessages") val `proactiveMessages`: Boolean? = null,
    @SerialName("proactiveFrequency") val `proactiveFrequency`: ProactiveFrequency? = null,
    @SerialName("proactiveCalls") val `proactiveCalls`: Boolean? = null,
    @SerialName("dailyLife") val `dailyLife`: Boolean? = null,
)

@Serializable
data class CompanionEndpointsListModesParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class CompanionEndpointsListModesResponse(
    @SerialName("items") val `items`: List<CompanionEndpointsListModesResponseItemsItem>,
)

@Serializable
data class CompanionEndpointsUpdateForCharacterParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class CompanionSettings(
    @SerialName("instantReply") val `instantReply`: Boolean,
    @SerialName("splitBubbles") val `splitBubbles`: Boolean,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
    @SerialName("personaFit") val `personaFit`: Long? = null,
    @SerialName("scenarioMode") val `scenarioMode`: ScenarioMode? = null,
    @SerialName("proactiveMessages") val `proactiveMessages`: Boolean? = null,
    @SerialName("proactiveFrequency") val `proactiveFrequency`: ProactiveFrequency? = null,
    @SerialName("proactiveCalls") val `proactiveCalls`: Boolean? = null,
    @SerialName("dailyLife") val `dailyLife`: Boolean? = null,
)

@Serializable
data class Contact(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("status") val `status`: ContactStatus,
    @SerialName("remark") val `remark`: String?,
    @SerialName("customAvatarMediaId") val `customAvatarMediaId`: Id?,
    @SerialName("addressAs") val `addressAs`: String?,
    @SerialName("knownSince") val `knownSince`: LocalDate,
    @SerialName("conversationId") val `conversationId`: Id?,
    @SerialName("addedAt") val `addedAt`: Timestamp,
    @SerialName("relationship") val `relationship`: String? = null,
)

typealias ContactStatus = String

@Serializable
data class ContactsEndpointsListResponse(
    @SerialName("items") val `items`: List<Contact>,
)

@Serializable
data class ContactsEndpointsRemoveParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class ContactsEndpointsRemoveQuery(
    @SerialName("mode") val `mode`: String? = null,
)

@Serializable
data class ContactsEndpointsUpdateParams(
    @SerialName("characterId") val `characterId`: Id,
)

typealias ContentScope = String

@Serializable
data class Conversation(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("type") val `type`: ConversationType,
    @SerialName("title") val `title`: String?,
    @SerialName("participants") val `participants`: List<Participant>,
    @SerialName("contentScope") val `contentScope`: ContentScope,
    @SerialName("lastSeq") val `lastSeq`: Long,
    @SerialName("lastMessage") val `lastMessage`: MessagePreview?,
    @SerialName("state") val `state`: UserConversationState,
    @SerialName("unreadCount") val `unreadCount`: Long,
    @SerialName("peerReadSeq") val `peerReadSeq`: Long?,
    @SerialName("createdAt") val `createdAt`: Timestamp,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
)

@Serializable
data class ConversationParams(
    @SerialName("conversationId") val `conversationId`: Id,
)

@Serializable
data class ConversationParamsInput(
    @SerialName("conversationId") val `conversationId`: Id,
)

typealias ConversationType = String

@Serializable
data class CreateCycleRequest(
    @SerialName("startDate") val `startDate`: LocalDate,
)

@Serializable
data class CreateCycleRequestInput(
    @SerialName("startDate") val `startDate`: LocalDate,
)

@Serializable
data class CreateInviteRequest(
    @SerialName("expiresInDays") val `expiresInDays`: Long?,
    @SerialName("bonusMicros") val `bonusMicros`: Long,
)

@Serializable
data class CreateInviteRequestInput(
    @SerialName("expiresInDays") val `expiresInDays`: Long?,
    @SerialName("bonusMicros") val `bonusMicros`: Long? = null,
)

@Serializable
data class CreateMemoryRequest(
    @SerialName("clientMemoryId") val `clientMemoryId`: Id,
    @SerialName("content") val `content`: String,
    @SerialName("category") val `category`: MemoryCategory,
    @SerialName("importance") val `importance`: Long? = null,
    @SerialName("dueAt") val `dueAt`: Timestamp? = null,
    @SerialName("visibility") val `visibility`: MemoryVisibility? = null,
)

@Serializable
data class CreateUpstreamRequest(
    @SerialName("name") val `name`: String,
    @SerialName("kind") val `kind`: UpstreamKind,
    @SerialName("baseUrl") val `baseUrl`: String,
    @SerialName("apiKey") val `apiKey`: String,
)

@Serializable
data class CreateUpstreamRequestInput(
    @SerialName("name") val `name`: String,
    @SerialName("kind") val `kind`: UpstreamKind,
    @SerialName("baseUrl") val `baseUrl`: String,
    @SerialName("apiKey") val `apiKey`: String,
)

@Serializable
data class CurrentUser(
    @SerialName("userId") val `userId`: Id,
    @SerialName("username") val `username`: Username,
    @SerialName("role") val `role`: UserRole,
    @SerialName("profileCompleted") val `profileCompleted`: Boolean,
    @SerialName("createdAt") val `createdAt`: Timestamp,
)

@Serializable
data class CursorPageQuery(
    @SerialName("cursor") val `cursor`: String? = null,
    @SerialName("limit") val `limit`: Long,
)

@Serializable
data class CycleRecord(
    @SerialName("cycleId") val `cycleId`: Id,
    @SerialName("startDate") val `startDate`: LocalDate,
    @SerialName("endDate") val `endDate`: LocalDate?,
    @SerialName("dayLogs") val `dayLogs`: List<DayLog>,
    @SerialName("createdAt") val `createdAt`: Timestamp,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
)

@Serializable
data class DayLog(
    @SerialName("date") val `date`: LocalDate,
    @SerialName("flow") val `flow`: PeriodFlow?,
    @SerialName("pain") val `pain`: PeriodPain?,
    @SerialName("symptoms") val `symptoms`: List<String>,
    @SerialName("notes") val `notes`: String?,
)

@Serializable
data class DayLogInput(
    @SerialName("date") val `date`: LocalDate,
    @SerialName("flow") val `flow`: PeriodFlow?,
    @SerialName("pain") val `pain`: PeriodPain?,
    @SerialName("symptoms") val `symptoms`: List<String>,
    @SerialName("notes") val `notes`: String?,
)

@Serializable
data class DeviceInfo(
    @SerialName("platform") val `platform`: ClientPlatform,
    @SerialName("name") val `name`: String,
    @SerialName("appVersion") val `appVersion`: String,
    @SerialName("timeZone") val `timeZone`: TimeZone,
)

@Serializable
data class DeviceInfoInput(
    @SerialName("platform") val `platform`: ClientPlatform,
    @SerialName("name") val `name`: String,
    @SerialName("appVersion") val `appVersion`: String,
    @SerialName("timeZone") val `timeZone`: TimeZone,
)

@Serializable
data class DraftCharacterCard(
    @EncodeDefault
    @SerialName("cardSchemaVersion") val `cardSchemaVersion`: Long = 1,
    @SerialName("data") val `data`: DraftCharacterCardData,
)

typealias ErrorCode = String

@Serializable
data class EventsAdminAlertRaised(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "platform.admin_alert_raised",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @SerialName("producer") val `producer`: EventsModuleName,
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: AdminAlertFacts,
)

@Serializable
data class EventsBalanceChanged(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "billing.balance_changed",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "billing",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsBalanceChangedPayload,
)

@Serializable
data class EventsBalanceDepleted(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "billing.balance_depleted",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "billing",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsBalanceDepletedPayload,
)

@Serializable
data class EventsBalanceLow(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "billing.balance_low",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "billing",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsBalanceLowPayload,
)

@Serializable
data class EventsBalanceRestored(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "billing.balance_restored",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "billing",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsBalanceRestoredPayload,
)

@Serializable
data class EventsCharacterClassificationChanged(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "characters.character_classification_changed",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "characters",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsCharacterClassificationChangedPayload,
)

@Serializable
data class EventsCharacterPublished(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "characters.character_published",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "characters",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsCharacterPublishedPayload,
)

@Serializable
data class EventsCharacterUnpublished(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "characters.character_unpublished",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "characters",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsCharacterUnpublishedPayload,
)

@Serializable
data class EventsContactAccepted(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "contacts.contact_accepted",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "contacts",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsContactAcceptedPayload,
)

@Serializable
data class EventsContactPurged(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "contacts.contact_purged",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "contacts",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsContactPurgedPayload,
)

@Serializable
data class EventsContactRemoved(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "contacts.contact_removed",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "contacts",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsContactRemovedPayload,
)

@Serializable
data class EventsContactRequested(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "contacts.contact_requested",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "contacts",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsContactRequestedPayload,
)

@Serializable
data class EventsContactUpdated(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "contacts.contact_updated",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "contacts",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsContactUpdatedPayload,
)

@Serializable
data class EventsContentScopeChanged(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "chat.content_scope_changed",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "chat",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsContentScopeChangedPayload,
)

@Serializable
data class EventsConversationCreated(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "chat.conversation_created",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "chat",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsConversationCreatedPayload,
)

@Serializable(with = EventsDomainEventSerializer::class)
sealed interface EventsDomainEvent {
    val `eventId`: Id
    val `type`: String
    val `version`: Long
    val `occurredAt`: Timestamp
}

@Serializable
data class EventsDomainEventIdentityUserRegistered(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "identity.user_registered",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "identity",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventIdentityUserRegisteredPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventIdentityProfileUpdated(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "identity.profile_updated",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "identity",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventIdentityProfileUpdatedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventIdentityPreferencesUpdated(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "identity.preferences_updated",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "identity",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventIdentityPreferencesUpdatedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventIdentityNotificationSettingsUpdated(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "identity.notification_settings_updated",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "identity",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventIdentityNotificationSettingsUpdatedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventIdentitySessionRevoked(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "identity.session_revoked",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "identity",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventIdentitySessionRevokedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventIdentityUserDeletionRequested(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "identity.user_deletion_requested",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "identity",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventIdentityUserDeletionRequestedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventPlatformUserDataPurged(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "platform.user_data_purged",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @SerialName("producer") val `producer`: EventsModuleName,
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventPlatformUserDataPurgedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventPlatformAdminAlertRaised(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "platform.admin_alert_raised",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @SerialName("producer") val `producer`: EventsModuleName,
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: AdminAlertFacts,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventModelAccessModelStatusChanged(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "model_access.model_status_changed",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "model_access",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventModelAccessModelStatusChangedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventModelAccessSelectionChanged(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "model_access.selection_changed",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "model_access",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventModelAccessSelectionChangedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventModelAccessUsageReconciled(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "model_access.usage_reconciled",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "model_access",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventModelAccessUsageReconciledPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventBillingBalanceChanged(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "billing.balance_changed",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "billing",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventBillingBalanceChangedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventBillingBalanceDepleted(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "billing.balance_depleted",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "billing",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventBillingBalanceDepletedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventBillingBalanceRestored(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "billing.balance_restored",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "billing",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventBillingBalanceRestoredPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventBillingBalanceLow(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "billing.balance_low",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "billing",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventBillingBalanceLowPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventCharactersCharacterPublished(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "characters.character_published",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "characters",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventCharactersCharacterPublishedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventCharactersCharacterUnpublished(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "characters.character_unpublished",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "characters",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventCharactersCharacterUnpublishedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventCharactersCharacterClassificationChanged(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "characters.character_classification_changed",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "characters",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventCharactersCharacterClassificationChangedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventCharactersPersonaVersionPublished(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "characters.persona_version_published",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "characters",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventCharactersPersonaVersionPublishedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventContactsContactRequested(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "contacts.contact_requested",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "contacts",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventContactsContactRequestedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventContactsContactAccepted(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "contacts.contact_accepted",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "contacts",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventContactsContactAcceptedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventContactsContactRemoved(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "contacts.contact_removed",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "contacts",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventContactsContactRemovedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventContactsContactPurged(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "contacts.contact_purged",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "contacts",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventContactsContactPurgedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventContactsContactUpdated(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "contacts.contact_updated",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "contacts",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventContactsContactUpdatedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventChatConversationCreated(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "chat.conversation_created",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "chat",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventChatConversationCreatedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventChatMessageCreated(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "chat.message_created",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "chat",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventChatMessageCreatedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventChatMessageRecalled(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "chat.message_recalled",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "chat",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventChatMessageRecalledPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventChatReadCursorMoved(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "chat.read_cursor_moved",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "chat",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventChatReadCursorMovedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventChatContentScopeChanged(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "chat.content_scope_changed",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "chat",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventChatContentScopeChangedPayload,
) : EventsDomainEvent

object EventsDomainEventSerializer : KSerializer<EventsDomainEvent> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("EventsDomainEvent")
    override fun deserialize(decoder: Decoder): EventsDomainEvent {
        val input = decoder as JsonDecoder
        var value = input.decodeJsonElement().jsonObject
        val tag = value["type"]?.jsonPrimitive?.content
        return when (tag) {
            "identity.user_registered" -> input.json.decodeFromJsonElement(EventsDomainEventIdentityUserRegistered.serializer(), value)
            "identity.profile_updated" -> input.json.decodeFromJsonElement(EventsDomainEventIdentityProfileUpdated.serializer(), value)
            "identity.preferences_updated" -> input.json.decodeFromJsonElement(EventsDomainEventIdentityPreferencesUpdated.serializer(), value)
            "identity.notification_settings_updated" -> input.json.decodeFromJsonElement(EventsDomainEventIdentityNotificationSettingsUpdated.serializer(), value)
            "identity.session_revoked" -> input.json.decodeFromJsonElement(EventsDomainEventIdentitySessionRevoked.serializer(), value)
            "identity.user_deletion_requested" -> input.json.decodeFromJsonElement(EventsDomainEventIdentityUserDeletionRequested.serializer(), value)
            "platform.user_data_purged" -> input.json.decodeFromJsonElement(EventsDomainEventPlatformUserDataPurged.serializer(), value)
            "platform.admin_alert_raised" -> input.json.decodeFromJsonElement(EventsDomainEventPlatformAdminAlertRaised.serializer(), value)
            "model_access.model_status_changed" -> input.json.decodeFromJsonElement(EventsDomainEventModelAccessModelStatusChanged.serializer(), value)
            "model_access.selection_changed" -> input.json.decodeFromJsonElement(EventsDomainEventModelAccessSelectionChanged.serializer(), value)
            "model_access.usage_reconciled" -> input.json.decodeFromJsonElement(EventsDomainEventModelAccessUsageReconciled.serializer(), value)
            "billing.balance_changed" -> input.json.decodeFromJsonElement(EventsDomainEventBillingBalanceChanged.serializer(), value)
            "billing.balance_depleted" -> input.json.decodeFromJsonElement(EventsDomainEventBillingBalanceDepleted.serializer(), value)
            "billing.balance_restored" -> input.json.decodeFromJsonElement(EventsDomainEventBillingBalanceRestored.serializer(), value)
            "billing.balance_low" -> input.json.decodeFromJsonElement(EventsDomainEventBillingBalanceLow.serializer(), value)
            "characters.character_published" -> input.json.decodeFromJsonElement(EventsDomainEventCharactersCharacterPublished.serializer(), value)
            "characters.character_unpublished" -> input.json.decodeFromJsonElement(EventsDomainEventCharactersCharacterUnpublished.serializer(), value)
            "characters.character_classification_changed" -> input.json.decodeFromJsonElement(EventsDomainEventCharactersCharacterClassificationChanged.serializer(), value)
            "characters.persona_version_published" -> input.json.decodeFromJsonElement(EventsDomainEventCharactersPersonaVersionPublished.serializer(), value)
            "contacts.contact_requested" -> input.json.decodeFromJsonElement(EventsDomainEventContactsContactRequested.serializer(), value)
            "contacts.contact_accepted" -> input.json.decodeFromJsonElement(EventsDomainEventContactsContactAccepted.serializer(), value)
            "contacts.contact_removed" -> input.json.decodeFromJsonElement(EventsDomainEventContactsContactRemoved.serializer(), value)
            "contacts.contact_purged" -> input.json.decodeFromJsonElement(EventsDomainEventContactsContactPurged.serializer(), value)
            "contacts.contact_updated" -> input.json.decodeFromJsonElement(EventsDomainEventContactsContactUpdated.serializer(), value)
            "chat.conversation_created" -> input.json.decodeFromJsonElement(EventsDomainEventChatConversationCreated.serializer(), value)
            "chat.message_created" -> input.json.decodeFromJsonElement(EventsDomainEventChatMessageCreated.serializer(), value)
            "chat.message_recalled" -> input.json.decodeFromJsonElement(EventsDomainEventChatMessageRecalled.serializer(), value)
            "chat.read_cursor_moved" -> input.json.decodeFromJsonElement(EventsDomainEventChatReadCursorMoved.serializer(), value)
            "chat.content_scope_changed" -> input.json.decodeFromJsonElement(EventsDomainEventChatContentScopeChanged.serializer(), value)
            else -> throw SerializationException("Unknown discriminator")
        }
    }
    override fun serialize(encoder: Encoder, value: EventsDomainEvent) {
        val output = encoder as JsonEncoder
        val element = when (value) {
            is EventsDomainEventIdentityUserRegistered -> output.json.encodeToJsonElement(EventsDomainEventIdentityUserRegistered.serializer(), value)
            is EventsDomainEventIdentityProfileUpdated -> output.json.encodeToJsonElement(EventsDomainEventIdentityProfileUpdated.serializer(), value)
            is EventsDomainEventIdentityPreferencesUpdated -> output.json.encodeToJsonElement(EventsDomainEventIdentityPreferencesUpdated.serializer(), value)
            is EventsDomainEventIdentityNotificationSettingsUpdated -> output.json.encodeToJsonElement(EventsDomainEventIdentityNotificationSettingsUpdated.serializer(), value)
            is EventsDomainEventIdentitySessionRevoked -> output.json.encodeToJsonElement(EventsDomainEventIdentitySessionRevoked.serializer(), value)
            is EventsDomainEventIdentityUserDeletionRequested -> output.json.encodeToJsonElement(EventsDomainEventIdentityUserDeletionRequested.serializer(), value)
            is EventsDomainEventPlatformUserDataPurged -> output.json.encodeToJsonElement(EventsDomainEventPlatformUserDataPurged.serializer(), value)
            is EventsDomainEventPlatformAdminAlertRaised -> output.json.encodeToJsonElement(EventsDomainEventPlatformAdminAlertRaised.serializer(), value)
            is EventsDomainEventModelAccessModelStatusChanged -> output.json.encodeToJsonElement(EventsDomainEventModelAccessModelStatusChanged.serializer(), value)
            is EventsDomainEventModelAccessSelectionChanged -> output.json.encodeToJsonElement(EventsDomainEventModelAccessSelectionChanged.serializer(), value)
            is EventsDomainEventModelAccessUsageReconciled -> output.json.encodeToJsonElement(EventsDomainEventModelAccessUsageReconciled.serializer(), value)
            is EventsDomainEventBillingBalanceChanged -> output.json.encodeToJsonElement(EventsDomainEventBillingBalanceChanged.serializer(), value)
            is EventsDomainEventBillingBalanceDepleted -> output.json.encodeToJsonElement(EventsDomainEventBillingBalanceDepleted.serializer(), value)
            is EventsDomainEventBillingBalanceRestored -> output.json.encodeToJsonElement(EventsDomainEventBillingBalanceRestored.serializer(), value)
            is EventsDomainEventBillingBalanceLow -> output.json.encodeToJsonElement(EventsDomainEventBillingBalanceLow.serializer(), value)
            is EventsDomainEventCharactersCharacterPublished -> output.json.encodeToJsonElement(EventsDomainEventCharactersCharacterPublished.serializer(), value)
            is EventsDomainEventCharactersCharacterUnpublished -> output.json.encodeToJsonElement(EventsDomainEventCharactersCharacterUnpublished.serializer(), value)
            is EventsDomainEventCharactersCharacterClassificationChanged -> output.json.encodeToJsonElement(EventsDomainEventCharactersCharacterClassificationChanged.serializer(), value)
            is EventsDomainEventCharactersPersonaVersionPublished -> output.json.encodeToJsonElement(EventsDomainEventCharactersPersonaVersionPublished.serializer(), value)
            is EventsDomainEventContactsContactRequested -> output.json.encodeToJsonElement(EventsDomainEventContactsContactRequested.serializer(), value)
            is EventsDomainEventContactsContactAccepted -> output.json.encodeToJsonElement(EventsDomainEventContactsContactAccepted.serializer(), value)
            is EventsDomainEventContactsContactRemoved -> output.json.encodeToJsonElement(EventsDomainEventContactsContactRemoved.serializer(), value)
            is EventsDomainEventContactsContactPurged -> output.json.encodeToJsonElement(EventsDomainEventContactsContactPurged.serializer(), value)
            is EventsDomainEventContactsContactUpdated -> output.json.encodeToJsonElement(EventsDomainEventContactsContactUpdated.serializer(), value)
            is EventsDomainEventChatConversationCreated -> output.json.encodeToJsonElement(EventsDomainEventChatConversationCreated.serializer(), value)
            is EventsDomainEventChatMessageCreated -> output.json.encodeToJsonElement(EventsDomainEventChatMessageCreated.serializer(), value)
            is EventsDomainEventChatMessageRecalled -> output.json.encodeToJsonElement(EventsDomainEventChatMessageRecalled.serializer(), value)
            is EventsDomainEventChatReadCursorMoved -> output.json.encodeToJsonElement(EventsDomainEventChatReadCursorMoved.serializer(), value)
            is EventsDomainEventChatContentScopeChanged -> output.json.encodeToJsonElement(EventsDomainEventChatContentScopeChanged.serializer(), value)
        }
        output.encodeJsonElement(element)
    }
}

@Serializable
data class EventsMessageCreated(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "chat.message_created",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "chat",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsMessageCreatedPayload,
)

@Serializable
data class EventsMessageRecalled(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "chat.message_recalled",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "chat",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsMessageRecalledPayload,
)

@Serializable
data class EventsModelSelectionChanged(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "model_access.selection_changed",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "model_access",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsModelSelectionChangedPayload,
)

@Serializable
data class EventsModelStatusChanged(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "model_access.model_status_changed",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "model_access",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsModelStatusChangedPayload,
)

typealias EventsModuleName = String

@Serializable
data class EventsNotificationSettingsUpdated(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "identity.notification_settings_updated",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "identity",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsNotificationSettingsUpdatedPayload,
)

@Serializable
data class EventsPersonaVersionPublished(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "characters.persona_version_published",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "characters",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsPersonaVersionPublishedPayload,
)

@Serializable
data class EventsPreferencesUpdated(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "identity.preferences_updated",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "identity",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsPreferencesUpdatedPayload,
)

@Serializable
data class EventsProfileUpdated(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "identity.profile_updated",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "identity",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsProfileUpdatedPayload,
)

@Serializable
data class EventsReadCursorMoved(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "chat.read_cursor_moved",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "chat",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsReadCursorMovedPayload,
)

@Serializable
data class EventsSessionRevoked(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "identity.session_revoked",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "identity",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsSessionRevokedPayload,
)

@Serializable
data class EventsUsageReconciled(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "model_access.usage_reconciled",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "model_access",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsUsageReconciledPayload,
)

@Serializable
data class EventsUserDataPurged(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "platform.user_data_purged",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @SerialName("producer") val `producer`: EventsModuleName,
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsUserDataPurgedPayload,
)

@Serializable
data class EventsUserDeletionRequested(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "identity.user_deletion_requested",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "identity",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsUserDeletionRequestedPayload,
)

@Serializable
data class EventsUserRegistered(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "identity.user_registered",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "identity",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsUserRegisteredPayload,
)

typealias Gender = String

typealias HealthEndpointsDeleteCycleResponse = JsonElement?

@Serializable
data class HealthEndpointsListCyclesQuery(
    @SerialName("cursor") val `cursor`: String? = null,
    @SerialName("limit") val `limit`: Long? = null,
)

@Serializable
data class HealthEndpointsListCyclesResponse(
    @SerialName("items") val `items`: List<CycleRecord>,
    @SerialName("nextCursor") val `nextCursor`: String?,
)

@Serializable
data class HealthEndpointsUpdateCycleParams(
    @SerialName("cycleId") val `cycleId`: Id,
)

typealias HexColor = String

typealias Id = String

@Serializable
data class IdentityAdminEndpointsListInvitesResponse(
    @SerialName("items") val `items`: List<Invite>,
)

@Serializable
data class IdentityAdminEndpointsListPendingDeletionsResponse(
    @SerialName("items") val `items`: List<PendingAccountDeletion>,
)

@Serializable
data class IdentityAdminEndpointsRetryDeletionParams(
    @SerialName("userId") val `userId`: Id,
)

@Serializable
data class IdentityEndpointsDeleteAccountBody(
    @SerialName("password") val `password`: Password,
    @EncodeDefault
    @SerialName("confirm") val `confirm`: String = "DELETE",
)

@Serializable
data class IdentityEndpointsDeleteAccountResponse(
    @EncodeDefault
    @SerialName("status") val `status`: String = "deleting",
)

@Serializable
data class IdentityEndpointsListSessionsResponse(
    @SerialName("items") val `items`: List<SessionSummary>,
)

@Serializable
data class IdentityEndpointsRevokeSessionParams(
    @SerialName("sessionId") val `sessionId`: Id,
)

@Serializable
data class Invite(
    @SerialName("code") val `code`: String,
    @SerialName("bonusMicros") val `bonusMicros`: Long? = null,
    @SerialName("createdAt") val `createdAt`: Timestamp,
    @SerialName("expiresAt") val `expiresAt`: Timestamp?,
    @SerialName("usedAt") val `usedAt`: Timestamp?,
)

@Serializable
data class LedgerEntry(
    @SerialName("entryId") val `entryId`: Id,
    @SerialName("type") val `type`: LedgerEntryType,
    @SerialName("amountMicros") val `amountMicros`: MoneyMicros,
    @SerialName("balanceAfterMicros") val `balanceAfterMicros`: MoneyMicros,
    @SerialName("category") val `category`: String?,
    @SerialName("modelKey") val `modelKey`: ModelKey?,
    @SerialName("characterId") val `characterId`: Id?,
    @SerialName("note") val `note`: String?,
    @SerialName("createdAt") val `createdAt`: Timestamp,
)

typealias LedgerEntryType = String

@Serializable
data class ListMessagesQuery(
    @SerialName("afterSeq") val `afterSeq`: Long? = null,
    @SerialName("beforeSeq") val `beforeSeq`: Long? = null,
    @SerialName("limit") val `limit`: Long,
)

@Serializable
data class ListMessagesQueryInput(
    @SerialName("afterSeq") val `afterSeq`: Long? = null,
    @SerialName("beforeSeq") val `beforeSeq`: Long? = null,
    @SerialName("limit") val `limit`: Long? = null,
)

typealias LocalDate = String

typealias LocalTime = String

@Serializable
data class LoginRequest(
    @SerialName("username") val `username`: Username,
    @SerialName("password") val `password`: Password,
    @SerialName("device") val `device`: DeviceInfo,
    @SerialName("kind") val `kind`: SessionKind,
)

@Serializable
data class LoginRequestInput(
    @SerialName("username") val `username`: Username,
    @SerialName("password") val `password`: Password,
    @SerialName("device") val `device`: DeviceInfoInput,
    @SerialName("kind") val `kind`: SessionKind? = null,
)

@Serializable
data class MediaAdminEndpointsAdminUploadQuery(
    @EncodeDefault
    @SerialName("purpose") val `purpose`: String = "character_avatar",
)

@Serializable
data class MediaEndpointsDownloadParams(
    @SerialName("mediaId") val `mediaId`: Id,
)

@Serializable
data class MediaEndpointsDownloadQuery(
    @SerialName("token") val `token`: String,
)

typealias MediaEndpointsDownloadResponse = String

@Serializable
data class MediaEndpointsGetMediaParams(
    @SerialName("mediaId") val `mediaId`: Id,
)

@Serializable
data class MediaEndpointsUploadQuery(
    @SerialName("purpose") val `purpose`: UserMediaPurpose,
)

@Serializable
data class MediaObject(
    @SerialName("mediaId") val `mediaId`: Id,
    @SerialName("purpose") val `purpose`: MediaPurpose,
    @SerialName("mimeType") val `mimeType`: String,
    @SerialName("sizeBytes") val `sizeBytes`: Long,
    @SerialName("width") val `width`: Long?,
    @SerialName("height") val `height`: Long?,
    @SerialName("url") val `url`: String,
    @SerialName("urlExpiresAt") val `urlExpiresAt`: Timestamp,
    @SerialName("createdAt") val `createdAt`: Timestamp,
)

typealias MediaPurpose = String

typealias MemoryCategory = String

@Serializable
data class MemoryEndpointsListParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class MemoryEndpointsListQuery(
    @SerialName("afterId") val `afterId`: Id? = null,
    @SerialName("limit") val `limit`: Long? = null,
)

@Serializable
data class MemoryEndpointsListResponse(
    @SerialName("items") val `items`: List<MemoryEntry>,
    @SerialName("nextCursor") val `nextCursor`: Id?,
)

@Serializable
data class MemoryEndpointsUpdateParams(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("memoryId") val `memoryId`: Id,
)

@Serializable
data class MemoryEntry(
    @SerialName("memoryId") val `memoryId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("category") val `category`: MemoryCategory,
    @SerialName("content") val `content`: String,
    @SerialName("status") val `status`: MemoryStatus,
    @SerialName("importance") val `importance`: Long,
    @SerialName("dueAt") val `dueAt`: Timestamp?,
    @SerialName("visibility") val `visibility`: MemoryVisibility,
    @SerialName("sharingClass") val `sharingClass`: MemorySharingClass,
    @SerialName("scope") val `scope`: String,
    @SerialName("sourceMessageIds") val `sourceMessageIds`: List<Id>,
    @SerialName("createdBy") val `createdBy`: String,
    @SerialName("knownBy") val `knownBy`: List<Id>,
    @SerialName("createdAt") val `createdAt`: Timestamp,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
)

typealias MemorySharingClass = String

typealias MemoryStatus = String

typealias MemoryVisibility = String

@Serializable
data class Message(
    @SerialName("messageId") val `messageId`: Id,
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("seq") val `seq`: Seq,
    @SerialName("senderParticipantId") val `senderParticipantId`: Id,
    @SerialName("senderKind") val `senderKind`: String,
    @SerialName("content") val `content`: ReceivedMessageContent?,
    @SerialName("quote") val `quote`: QuoteRef?,
    @SerialName("status") val `status`: MessageStatus,
    @SerialName("scope") val `scope`: ContentScope,
    @SerialName("labels") val `labels`: List<String>? = null,
    @SerialName("clientMsgId") val `clientMsgId`: ClientMsgId?,
    @SerialName("createdAt") val `createdAt`: Timestamp,
    @SerialName("recalledAt") val `recalledAt`: Timestamp?,
)

@Serializable
data class MessageAck(
    @SerialName("clientMsgId") val `clientMsgId`: ClientMsgId,
    @SerialName("message") val `message`: Message,
)

@Serializable(with = MessageContentSerializer::class)
sealed interface MessageContent {
    val `type`: String
}

@Serializable
data class MessageContentText(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "text",
    @SerialName("text") val `text`: String,
) : MessageContent

@Serializable
data class MessageContentNudge(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "nudge",
    @SerialName("targetParticipantId") val `targetParticipantId`: Id,
) : MessageContent

@Serializable
data class MessageContentSystem(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "system",
    @SerialName("code") val `code`: String,
    @SerialName("params") val `params`: Map<String, MessageContentSystemParamsValue>,
) : MessageContent

object MessageContentSerializer : KSerializer<MessageContent> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("MessageContent")
    override fun deserialize(decoder: Decoder): MessageContent {
        val input = decoder as JsonDecoder
        var value = input.decodeJsonElement().jsonObject
        val tag = value["type"]?.jsonPrimitive?.content
        return when (tag) {
            "text" -> input.json.decodeFromJsonElement(MessageContentText.serializer(), value)
            "nudge" -> input.json.decodeFromJsonElement(MessageContentNudge.serializer(), value)
            "system" -> input.json.decodeFromJsonElement(MessageContentSystem.serializer(), value)
            else -> throw SerializationException("Unknown discriminator")
        }
    }
    override fun serialize(encoder: Encoder, value: MessageContent) {
        val output = encoder as JsonEncoder
        val element = when (value) {
            is MessageContentText -> output.json.encodeToJsonElement(MessageContentText.serializer(), value)
            is MessageContentNudge -> output.json.encodeToJsonElement(MessageContentNudge.serializer(), value)
            is MessageContentSystem -> output.json.encodeToJsonElement(MessageContentSystem.serializer(), value)
        }
        output.encodeJsonElement(element)
    }
}

@Serializable
data class MessagePage(
    @SerialName("items") val `items`: List<Message>,
    @SerialName("hasMore") val `hasMore`: Boolean,
    @SerialName("coverage") val `coverage`: MessagePageCoverage? = null,
)

@Serializable
data class MessagePageCoverage(
    @SerialName("fromSeq") val `fromSeq`: Long,
    @SerialName("throughSeq") val `throughSeq`: Long,
    @SerialName("excludedRanges") val `excludedRanges`: List<MessagePageCoverageExcludedRangesItem>,
)

@Serializable
data class MessageParams(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("messageId") val `messageId`: Id,
)

@Serializable
data class MessageParamsInput(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("messageId") val `messageId`: Id,
)

@Serializable
data class MessagePreview(
    @SerialName("messageId") val `messageId`: Id,
    @SerialName("seq") val `seq`: Seq,
    @SerialName("senderParticipantId") val `senderParticipantId`: Id,
    @SerialName("text") val `text`: String,
    @SerialName("createdAt") val `createdAt`: Timestamp,
)

typealias MessageStatus = String

@Serializable
data class ModelAccessAdminEndpointsDeleteUpstreamParams(
    @SerialName("upstreamId") val `upstreamId`: Id,
)

@Serializable
data class ModelAccessAdminEndpointsListCatalogResponse(
    @SerialName("items") val `items`: List<AdminCatalogEntry>,
)

@Serializable
data class ModelAccessAdminEndpointsListUpstreamsResponse(
    @SerialName("items") val `items`: List<Upstream>,
)

@Serializable
data class ModelAccessAdminEndpointsRotateUpstreamKeyBody(
    @SerialName("apiKey") val `apiKey`: String,
)

@Serializable
data class ModelAccessAdminEndpointsRotateUpstreamKeyParams(
    @SerialName("upstreamId") val `upstreamId`: Id,
)

@Serializable
data class ModelAccessAdminEndpointsTestUpstreamParams(
    @SerialName("upstreamId") val `upstreamId`: Id,
)

@Serializable
data class ModelAccessAdminEndpointsUpsertCatalogEntryParams(
    @SerialName("modelKey") val `modelKey`: String,
)

@Serializable
data class ModelAccessAdminUsageEndpointsExportUsageRecordsBody(
    @SerialName("filter") val `filter`: AdminUsageFilterInput,
)

@Serializable
data class ModelAccessAdminUsageEndpointsExportUsageRecordsResponse(
    @SerialName("items") val `items`: List<AdminUsageRecord>,
    @SerialName("truncated") val `truncated`: Boolean,
)

@Serializable
data class ModelAccessAdminUsageEndpointsListUsageRecordsBody(
    @SerialName("filter") val `filter`: AdminUsageFilterInput,
    @SerialName("cursor") val `cursor`: String? = null,
    @SerialName("limit") val `limit`: Long? = null,
)

@Serializable
data class ModelAccessAdminUsageEndpointsListUsageRecordsResponse(
    @SerialName("items") val `items`: List<AdminUsageRecord>,
    @SerialName("nextCursor") val `nextCursor`: String?,
)

@Serializable
data class ModelAccessEndpointsGetCharacterOverrideParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class ModelAccessEndpointsGetModelStatusQuery(
    @SerialName("characterId") val `characterId`: Id? = null,
)

@Serializable
data class ModelAccessEndpointsListModelsQuery(
    @SerialName("capability") val `capability`: ModelCapability? = null,
)

@Serializable
data class ModelAccessEndpointsListModelsResponse(
    @SerialName("items") val `items`: List<ModelInfo>,
)

@Serializable
data class ModelAccessEndpointsSetCharacterOverrideBody(
    @SerialName("chat") val `chat`: ModelRefInput?,
)

@Serializable
data class ModelAccessEndpointsSetCharacterOverrideParams(
    @SerialName("characterId") val `characterId`: Id,
)

typealias ModelCapability = String

@Serializable
data class ModelInfo(
    @SerialName("modelKey") val `modelKey`: ModelKey,
    @SerialName("displayName") val `displayName`: String,
    @SerialName("vendorName") val `vendorName`: String,
    @SerialName("priceTier") val `priceTier`: PriceTier,
    @SerialName("capabilities") val `capabilities`: List<String>,
    @SerialName("tags") val `tags`: List<String>,
    @SerialName("leaderboardRank") val `leaderboardRank`: Long?,
    @SerialName("available") val `available`: Boolean,
)

typealias ModelKey = String

typealias ModelPurpose = String

@Serializable
data class ModelRef(
    @SerialName("modelKey") val `modelKey`: ModelKey,
)

@Serializable
data class ModelRefInput(
    @SerialName("modelKey") val `modelKey`: ModelKey,
)

@Serializable
data class ModelRefState(
    @SerialName("modelKey") val `modelKey`: ModelKey,
    @SerialName("available") val `available`: Boolean,
    @SerialName("unavailableReason") val `unavailableReason`: String?,
)

typealias ModelRole = String

@Serializable
data class ModelSelection(
    @SerialName("chat") val `chat`: ModelRefState?,
    @SerialName("background") val `background`: ModelRefState?,
    @SerialName("adult") val `adult`: ModelRefState?,
)

@Serializable
data class ModelStatus(
    @SerialName("characterId") val `characterId`: Id?,
    @SerialName("available") val `available`: Boolean,
    @SerialName("reason") val `reason`: String?,
    @SerialName("canFallbackToDefault") val `canFallbackToDefault`: Boolean,
)

typealias MoneyMicros = Long

typealias NoContent = JsonElement?

@Serializable
data class NotificationEnvelope(
    @EncodeDefault
    @SerialName("v") val `v`: Long = 1,
    @SerialName("recipientUserId") val `recipientUserId`: Id,
    @SerialName("recipientSessionId") val `recipientSessionId`: Id,
    @SerialName("notificationId") val `notificationId`: Id,
    @SerialName("kind") val `kind`: String,
    @SerialName("collapseKey") val `collapseKey`: String,
    @SerialName("title") val `title`: String,
    @SerialName("body") val `body`: String,
    @SerialName("count") val `count`: Long,
    @SerialName("deepLink") val `deepLink`: String,
    @SerialName("conversationId") val `conversationId`: Id?,
    @SerialName("sound") val `sound`: Boolean,
    @SerialName("sentAt") val `sentAt`: String,
)

typealias NotificationKind = String

@Serializable
data class NotificationPayload(
    @EncodeDefault
    @SerialName("v") val `v`: Long = 1,
    @SerialName("recipientUserId") val `recipientUserId`: Id? = null,
    @SerialName("recipientSessionId") val `recipientSessionId`: Id? = null,
    @SerialName("notificationId") val `notificationId`: Id? = null,
    @SerialName("kind") val `kind`: String,
    @SerialName("collapseKey") val `collapseKey`: String,
    @SerialName("title") val `title`: String,
    @SerialName("body") val `body`: String,
    @SerialName("count") val `count`: Long,
    @SerialName("deepLink") val `deepLink`: String,
    @SerialName("conversationId") val `conversationId`: Id?,
    @SerialName("sound") val `sound`: Boolean,
    @SerialName("sentAt") val `sentAt`: String,
)

@Serializable
data class NotificationSettings(
    @SerialName("proactiveMessagesEnabled") val `proactiveMessagesEnabled`: Boolean,
    @SerialName("proactiveCallsEnabled") val `proactiveCallsEnabled`: Boolean,
    @SerialName("pushSoundEnabled") val `pushSoundEnabled`: Boolean,
    @SerialName("pushShowContent") val `pushShowContent`: Boolean,
    @SerialName("doNotDisturb") val `doNotDisturb`: NotificationSettingsDoNotDisturb,
    @SerialName("allowCharacterGroupInvites") val `allowCharacterGroupInvites`: Boolean,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
)

@Serializable
data class NudgeContent(
    @EncodeDefault
    @SerialName("type") val `type`: String = "nudge",
    @SerialName("targetParticipantId") val `targetParticipantId`: Id,
)

@Serializable
data class NudgeContentInput(
    @EncodeDefault
    @SerialName("type") val `type`: String = "nudge",
    @SerialName("targetParticipantId") val `targetParticipantId`: Id,
)

@Serializable
data class Participant(
    @SerialName("participantId") val `participantId`: Id,
    @SerialName("kind") val `kind`: ParticipantKind,
    @SerialName("refId") val `refId`: Id,
    @SerialName("joinedAt") val `joinedAt`: Timestamp,
)

typealias ParticipantKind = String

typealias Password = String

@Serializable
data class PendingAccountDeletion(
    @SerialName("userId") val `userId`: Id,
    @SerialName("username") val `username`: String,
    @SerialName("requestedAt") val `requestedAt`: Timestamp,
    @SerialName("lastRetriggeredAt") val `lastRetriggeredAt`: Timestamp?,
    @SerialName("modules") val `modules`: List<AccountDeletionModuleProgress>,
)

typealias PeriodFlow = String

typealias PeriodPain = String

typealias PersonaTag = String

@Serializable
data class PersonaVersionAdminEndpointsListPersonaVersionsParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class PersonaVersionAdminEndpointsListPersonaVersionsResponse(
    @SerialName("items") val `items`: List<PersonaVersionSummary>,
)

@Serializable
data class PersonaVersionAdminEndpointsRollbackPersonaVersionParams(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("version") val `version`: Long,
)

@Serializable
data class PersonaVersionSummary(
    @SerialName("version") val `version`: Long,
    @SerialName("summary") val `summary`: String?,
    @SerialName("modifiedBy") val `modifiedBy`: Id?,
    @SerialName("stabilityPassed") val `stabilityPassed`: Boolean,
    @SerialName("publishedAt") val `publishedAt`: Timestamp,
    @SerialName("isCurrent") val `isCurrent`: Boolean,
)

typealias PortraitPolicy = String

typealias PositiveMoneyMicros = Long

typealias PredictionConfidence = String

@Serializable
data class PredictionResult(
    @SerialName("predictedNextStart") val `predictedNextStart`: LocalDate?,
    @SerialName("predictedDays") val `predictedDays`: Long?,
    @SerialName("confidence") val `confidence`: PredictionConfidence,
    @SerialName("disclaimer") val `disclaimer`: String,
)

@Serializable
data class PriceTable(
    @SerialName("priceVersionId") val `priceVersionId`: Id,
    @SerialName("versionLabel") val `versionLabel`: String,
    @SerialName("effectiveFrom") val `effectiveFrom`: Timestamp,
    @SerialName("items") val `items`: List<PublicPriceItem>,
)

typealias PriceTier = String

@Serializable
data class PriceTimeBand(
    @SerialName("name") val `name`: String,
    @SerialName("weekdays") val `weekdays`: List<Long>,
    @SerialName("start") val `start`: String,
    @SerialName("end") val `end`: String,
)

@Serializable
data class PriceTimeBandInput(
    @SerialName("name") val `name`: String,
    @SerialName("weekdays") val `weekdays`: List<Long>,
    @SerialName("start") val `start`: String,
    @SerialName("end") val `end`: String,
)

typealias PriceUnit = String

typealias PriceVersionStatus = String

typealias ProactiveFrequency = String

@Serializable
data class Profile(
    @SerialName("nickname") val `nickname`: String?,
    @SerialName("avatarMediaId") val `avatarMediaId`: Id?,
    @SerialName("birthday") val `birthday`: LocalDate?,
    @SerialName("gender") val `gender`: Gender,
    @SerialName("city") val `city`: String?,
    @SerialName("about") val `about`: String?,
    @SerialName("timeZone") val `timeZone`: TimeZone,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
)

@Serializable
data class ProtocolVector(
    @EncodeDefault
    @SerialName("formatVersion") val `formatVersion`: Long = 1,
    @SerialName("id") val `id`: String,
    @SerialName("description") val `description`: String,
    @SerialName("initialState") val `initialState`: ClientSyncState,
    @SerialName("steps") val `steps`: List<ProtocolVectorStepsItem>,
    @SerialName("expected") val `expected`: ProtocolVectorExpected,
)

@Serializable
data class PublicPriceItem(
    @SerialName("modelKey") val `modelKey`: ModelKey,
    @SerialName("unit") val `unit`: PriceUnit,
    @SerialName("priceMicros") val `priceMicros`: Long,
    @SerialName("band") val `band`: PriceTimeBand?,
)

@Serializable
data class PushAdminEndpointsAcknowledgeAdminAlertParams(
    @SerialName("alertId") val `alertId`: Id,
)

@Serializable
data class PushAdminEndpointsListAdminAlertsQuery(
    @SerialName("status") val `status`: String? = null,
    @SerialName("cursor") val `cursor`: String? = null,
    @SerialName("limit") val `limit`: Long? = null,
)

@Serializable
data class PushAdminEndpointsListAdminAlertsResponse(
    @SerialName("items") val `items`: List<AdminAlert>,
    @SerialName("nextCursor") val `nextCursor`: String?,
    @SerialName("openCount") val `openCount`: Long,
)

@Serializable
data class PushDevice(
    @SerialName("pushDeviceId") val `pushDeviceId`: Id,
    @SerialName("kind") val `kind`: String,
    @SerialName("sessionId") val `sessionId`: Id,
    @SerialName("createdAt") val `createdAt`: Timestamp,
)

@Serializable
data class PushEndpointsGetVapidPublicKeyResponse(
    @SerialName("publicKey") val `publicKey`: String,
)

@Serializable
data class PushEndpointsUnregisterDeviceParams(
    @SerialName("pushDeviceId") val `pushDeviceId`: Id,
)

@Serializable
data class QuoteRef(
    @SerialName("messageId") val `messageId`: Id,
    @SerialName("seq") val `seq`: Seq,
    @SerialName("preview") val `preview`: String?,
)

typealias RealPersonKind = String

typealias ReceivedAppTheme = String

typealias ReceivedErrorCode = String

@Serializable(with = ReceivedMessageContentSerializer::class)
sealed interface ReceivedMessageContent {
    val `type`: String
}

@Serializable
data class ReceivedMessageContentText(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "text",
    @SerialName("text") val `text`: String,
) : ReceivedMessageContent

@Serializable
data class ReceivedMessageContentNudge(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "nudge",
    @SerialName("targetParticipantId") val `targetParticipantId`: Id,
) : ReceivedMessageContent

@Serializable
data class ReceivedMessageContentSystem(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "system",
    @SerialName("code") val `code`: String,
    @SerialName("params") val `params`: Map<String, ReceivedMessageContentSystemParamsValue>,
) : ReceivedMessageContent

@Serializable
data class ReceivedMessageContentUnsupported(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "unsupported",
    @SerialName("originalType") val `originalType`: String,
) : ReceivedMessageContent

object ReceivedMessageContentSerializer : KSerializer<ReceivedMessageContent> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("ReceivedMessageContent")
    override fun deserialize(decoder: Decoder): ReceivedMessageContent {
        val input = decoder as JsonDecoder
        var value = input.decodeJsonElement().jsonObject
        val tag = value["type"]?.jsonPrimitive?.content
        return when (tag) {
            "text" -> input.json.decodeFromJsonElement(ReceivedMessageContentText.serializer(), value)
            "nudge" -> input.json.decodeFromJsonElement(ReceivedMessageContentNudge.serializer(), value)
            "system" -> input.json.decodeFromJsonElement(ReceivedMessageContentSystem.serializer(), value)
            "unsupported" -> input.json.decodeFromJsonElement(ReceivedMessageContentUnsupported.serializer(), value)
            else -> { require(tag != null) { "Missing discriminator" }; value = JsonObject(value + mapOf("type" to JsonPrimitive("unsupported"), "originalType" to JsonPrimitive(tag))); input.json.decodeFromJsonElement(ReceivedMessageContentUnsupported.serializer(), value) }
        }
    }
    override fun serialize(encoder: Encoder, value: ReceivedMessageContent) {
        val output = encoder as JsonEncoder
        val element = when (value) {
            is ReceivedMessageContentText -> output.json.encodeToJsonElement(ReceivedMessageContentText.serializer(), value)
            is ReceivedMessageContentNudge -> output.json.encodeToJsonElement(ReceivedMessageContentNudge.serializer(), value)
            is ReceivedMessageContentSystem -> output.json.encodeToJsonElement(ReceivedMessageContentSystem.serializer(), value)
            is ReceivedMessageContentUnsupported -> output.json.encodeToJsonElement(ReceivedMessageContentUnsupported.serializer(), value)
        }
        output.encodeJsonElement(element)
    }
}

@Serializable(with = ReceivedUserUpdatePayloadSerializer::class)
sealed interface ReceivedUserUpdatePayload {
    val `type`: String
}

@Serializable
data class ReceivedUserUpdatePayloadMessageCreated(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "message.created",
    @SerialName("data") val `data`: ReceivedUserUpdatePayloadMessageCreatedData,
) : ReceivedUserUpdatePayload

@Serializable
data class ReceivedUserUpdatePayloadMessageRecalled(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "message.recalled",
    @SerialName("data") val `data`: ReceivedUserUpdatePayloadMessageRecalledData,
) : ReceivedUserUpdatePayload

@Serializable
data class ReceivedUserUpdatePayloadMessageHidden(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "message.hidden",
    @SerialName("data") val `data`: ReceivedUserUpdatePayloadMessageHiddenData,
) : ReceivedUserUpdatePayload

@Serializable
data class ReceivedUserUpdatePayloadConversationCreated(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "conversation.created",
    @SerialName("data") val `data`: ReceivedUserUpdatePayloadConversationCreatedData,
) : ReceivedUserUpdatePayload

@Serializable
data class ReceivedUserUpdatePayloadConversationUpdated(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "conversation.updated",
    @SerialName("data") val `data`: ReceivedUserUpdatePayloadConversationUpdatedData,
) : ReceivedUserUpdatePayload

@Serializable
data class ReceivedUserUpdatePayloadConversationStateUpdated(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "conversation.state_updated",
    @SerialName("data") val `data`: ReceivedUserUpdatePayloadConversationStateUpdatedData,
) : ReceivedUserUpdatePayload

@Serializable
data class ReceivedUserUpdatePayloadConversationPeerReadUpdated(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "conversation.peer_read_updated",
    @SerialName("data") val `data`: ReceivedUserUpdatePayloadConversationPeerReadUpdatedData,
) : ReceivedUserUpdatePayload

@Serializable
data class ReceivedUserUpdatePayloadContactUpserted(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "contact.upserted",
    @SerialName("data") val `data`: ReceivedUserUpdatePayloadContactUpsertedData,
) : ReceivedUserUpdatePayload

@Serializable
data class ReceivedUserUpdatePayloadContactRemoved(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "contact.removed",
    @SerialName("data") val `data`: ReceivedUserUpdatePayloadContactRemovedData,
) : ReceivedUserUpdatePayload

@Serializable
data class ReceivedUserUpdatePayloadSettingsUpdated(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "settings.updated",
    @SerialName("data") val `data`: ReceivedUserUpdatePayloadSettingsUpdatedData,
) : ReceivedUserUpdatePayload

@Serializable
data class ReceivedUserUpdatePayloadModelStatusUpdated(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "model.status_updated",
    @SerialName("data") val `data`: ReceivedUserUpdatePayloadModelStatusUpdatedData,
) : ReceivedUserUpdatePayload

@Serializable
data class ReceivedUserUpdatePayloadUnsupported(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "unsupported",
    @SerialName("data") val `data`: ReceivedUserUpdatePayloadUnsupportedData,
) : ReceivedUserUpdatePayload

object ReceivedUserUpdatePayloadSerializer : KSerializer<ReceivedUserUpdatePayload> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("ReceivedUserUpdatePayload")
    override fun deserialize(decoder: Decoder): ReceivedUserUpdatePayload {
        val input = decoder as JsonDecoder
        var value = input.decodeJsonElement().jsonObject
        val tag = value["type"]?.jsonPrimitive?.content
        return when (tag) {
            "message.created" -> input.json.decodeFromJsonElement(ReceivedUserUpdatePayloadMessageCreated.serializer(), value)
            "message.recalled" -> input.json.decodeFromJsonElement(ReceivedUserUpdatePayloadMessageRecalled.serializer(), value)
            "message.hidden" -> input.json.decodeFromJsonElement(ReceivedUserUpdatePayloadMessageHidden.serializer(), value)
            "conversation.created" -> input.json.decodeFromJsonElement(ReceivedUserUpdatePayloadConversationCreated.serializer(), value)
            "conversation.updated" -> input.json.decodeFromJsonElement(ReceivedUserUpdatePayloadConversationUpdated.serializer(), value)
            "conversation.state_updated" -> input.json.decodeFromJsonElement(ReceivedUserUpdatePayloadConversationStateUpdated.serializer(), value)
            "conversation.peer_read_updated" -> input.json.decodeFromJsonElement(ReceivedUserUpdatePayloadConversationPeerReadUpdated.serializer(), value)
            "contact.upserted" -> input.json.decodeFromJsonElement(ReceivedUserUpdatePayloadContactUpserted.serializer(), value)
            "contact.removed" -> input.json.decodeFromJsonElement(ReceivedUserUpdatePayloadContactRemoved.serializer(), value)
            "settings.updated" -> input.json.decodeFromJsonElement(ReceivedUserUpdatePayloadSettingsUpdated.serializer(), value)
            "model.status_updated" -> input.json.decodeFromJsonElement(ReceivedUserUpdatePayloadModelStatusUpdated.serializer(), value)
            "unsupported" -> input.json.decodeFromJsonElement(ReceivedUserUpdatePayloadUnsupported.serializer(), value)
            else -> { require(tag != null) { "Missing discriminator" }; value = JsonObject(value + mapOf("type" to JsonPrimitive("unsupported"), "data" to buildJsonObject { put("originalType", tag) })); input.json.decodeFromJsonElement(ReceivedUserUpdatePayloadUnsupported.serializer(), value) }
        }
    }
    override fun serialize(encoder: Encoder, value: ReceivedUserUpdatePayload) {
        val output = encoder as JsonEncoder
        val element = when (value) {
            is ReceivedUserUpdatePayloadMessageCreated -> output.json.encodeToJsonElement(ReceivedUserUpdatePayloadMessageCreated.serializer(), value)
            is ReceivedUserUpdatePayloadMessageRecalled -> output.json.encodeToJsonElement(ReceivedUserUpdatePayloadMessageRecalled.serializer(), value)
            is ReceivedUserUpdatePayloadMessageHidden -> output.json.encodeToJsonElement(ReceivedUserUpdatePayloadMessageHidden.serializer(), value)
            is ReceivedUserUpdatePayloadConversationCreated -> output.json.encodeToJsonElement(ReceivedUserUpdatePayloadConversationCreated.serializer(), value)
            is ReceivedUserUpdatePayloadConversationUpdated -> output.json.encodeToJsonElement(ReceivedUserUpdatePayloadConversationUpdated.serializer(), value)
            is ReceivedUserUpdatePayloadConversationStateUpdated -> output.json.encodeToJsonElement(ReceivedUserUpdatePayloadConversationStateUpdated.serializer(), value)
            is ReceivedUserUpdatePayloadConversationPeerReadUpdated -> output.json.encodeToJsonElement(ReceivedUserUpdatePayloadConversationPeerReadUpdated.serializer(), value)
            is ReceivedUserUpdatePayloadContactUpserted -> output.json.encodeToJsonElement(ReceivedUserUpdatePayloadContactUpserted.serializer(), value)
            is ReceivedUserUpdatePayloadContactRemoved -> output.json.encodeToJsonElement(ReceivedUserUpdatePayloadContactRemoved.serializer(), value)
            is ReceivedUserUpdatePayloadSettingsUpdated -> output.json.encodeToJsonElement(ReceivedUserUpdatePayloadSettingsUpdated.serializer(), value)
            is ReceivedUserUpdatePayloadModelStatusUpdated -> output.json.encodeToJsonElement(ReceivedUserUpdatePayloadModelStatusUpdated.serializer(), value)
            is ReceivedUserUpdatePayloadUnsupported -> output.json.encodeToJsonElement(ReceivedUserUpdatePayloadUnsupported.serializer(), value)
        }
        output.encodeJsonElement(element)
    }
}

@Serializable
data class ReconciliationRun(
    @SerialName("runId") val `runId`: Id,
    @SerialName("date") val `date`: LocalDate,
    @SerialName("ledgerConsistent") val `ledgerConsistent`: Boolean,
    @SerialName("staleHolds") val `staleHolds`: Long,
    @SerialName("usageWithoutCharge") val `usageWithoutCharge`: Long,
    @SerialName("chargeWithoutUsage") val `chargeWithoutUsage`: Long,
    @SerialName("upstreamDiffs") val `upstreamDiffs`: List<ReconciliationRunUpstreamDiffsItem>,
    @SerialName("absorbedMicros") val `absorbedMicros`: Long,
    @SerialName("usageReconciledAt") val `usageReconciledAt`: Timestamp? = null,
    @SerialName("usageAmountMismatch") val `usageAmountMismatch`: Long? = null,
    @SerialName("createdAt") val `createdAt`: Timestamp,
)

typealias RegisterPushDeviceRequest = JsonElement

typealias RegisterPushDeviceRequestInput = JsonElement

@Serializable
data class RegisterRequest(
    @SerialName("username") val `username`: Username,
    @SerialName("password") val `password`: Password,
    @SerialName("inviteCode") val `inviteCode`: String,
    @SerialName("device") val `device`: DeviceInfo,
)

@Serializable
data class RegisterRequestInput(
    @SerialName("username") val `username`: Username,
    @SerialName("password") val `password`: Password,
    @SerialName("inviteCode") val `inviteCode`: String,
    @SerialName("device") val `device`: DeviceInfoInput,
)

typealias ScenarioMode = String

@Serializable
data class ScenarioModeAdminEndpointsListScenarioModesResponse(
    @SerialName("items") val `items`: List<AdminScenarioMode>,
)

@Serializable
data class ScenarioModeAdminEndpointsUpdateScenarioModeParams(
    @SerialName("id") val `id`: String,
)

typealias ScenarioModeAppliesTo = String

@Serializable
data class SendMessageRequest(
    @SerialName("clientMsgId") val `clientMsgId`: ClientMsgId,
    @SerialName("content") val `content`: UserSendableContent,
    @SerialName("quoteMessageId") val `quoteMessageId`: Id? = null,
)

@Serializable
data class SendMessageRequestInput(
    @SerialName("clientMsgId") val `clientMsgId`: ClientMsgId,
    @SerialName("content") val `content`: UserSendableContentInput,
    @SerialName("quoteMessageId") val `quoteMessageId`: Id? = null,
)

typealias Seq = Long

@Serializable
data class ServerAuthOkFrame(
    @EncodeDefault
    @SerialName("v") val `v`: Long = 1,
    @EncodeDefault
    @SerialName("type") val `type`: String = "auth.ok",
    @SerialName("ref") val `ref`: String? = null,
    @SerialName("data") val `data`: ServerAuthOkFrameData,
)

@Serializable
data class ServerErrorFrame(
    @EncodeDefault
    @SerialName("v") val `v`: Long = 1,
    @EncodeDefault
    @SerialName("type") val `type`: String = "error",
    @SerialName("ref") val `ref`: String? = null,
    @SerialName("data") val `data`: ServerErrorFrameData,
)

@Serializable(with = ServerFrameSerializer::class)
sealed interface ServerFrame {
    val `v`: Long
    val `type`: String
    val `ref`: String?
}

@Serializable
data class ServerFrameAuthOk(
    @EncodeDefault
    @SerialName("v") override val `v`: Long = 1,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "auth.ok",
    @SerialName("ref") override val `ref`: String? = null,
    @SerialName("data") val `data`: ServerFrameAuthOkData,
) : ServerFrame

@Serializable
data class ServerFramePong(
    @EncodeDefault
    @SerialName("v") override val `v`: Long = 1,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "pong",
    @SerialName("ref") override val `ref`: String? = null,
    @SerialName("data") val `data`: ServerFramePongData,
) : ServerFrame

@Serializable
data class ServerFrameMessageAck(
    @EncodeDefault
    @SerialName("v") override val `v`: Long = 1,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "message.ack",
    @SerialName("ref") override val `ref`: String? = null,
    @SerialName("data") val `data`: MessageAck,
) : ServerFrame

@Serializable
data class ServerFrameMessageError(
    @EncodeDefault
    @SerialName("v") override val `v`: Long = 1,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "message.error",
    @SerialName("ref") override val `ref`: String? = null,
    @SerialName("data") val `data`: ServerFrameMessageErrorData,
) : ServerFrame

@Serializable
data class ServerFrameUpdate(
    @EncodeDefault
    @SerialName("v") override val `v`: Long = 1,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "update",
    @SerialName("ref") override val `ref`: String? = null,
    @SerialName("data") val `data`: UserUpdate,
) : ServerFrame

@Serializable
data class ServerFrameTyping(
    @EncodeDefault
    @SerialName("v") override val `v`: Long = 1,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "typing",
    @SerialName("ref") override val `ref`: String? = null,
    @SerialName("data") val `data`: ServerFrameTypingData,
) : ServerFrame

@Serializable
data class ServerFrameError(
    @EncodeDefault
    @SerialName("v") override val `v`: Long = 1,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "error",
    @SerialName("ref") override val `ref`: String? = null,
    @SerialName("data") val `data`: ServerFrameErrorData,
) : ServerFrame

@Serializable
data class ServerFrameUnsupported(
    @EncodeDefault
    @SerialName("v") override val `v`: Long = 1,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "unsupported",
    @SerialName("ref") override val `ref`: String? = null,
    @SerialName("data") val `data`: ServerFrameUnsupportedData,
) : ServerFrame

object ServerFrameSerializer : KSerializer<ServerFrame> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("ServerFrame")
    override fun deserialize(decoder: Decoder): ServerFrame {
        val input = decoder as JsonDecoder
        var value = input.decodeJsonElement().jsonObject
        val tag = value["type"]?.jsonPrimitive?.content
        return when (tag) {
            "auth.ok" -> input.json.decodeFromJsonElement(ServerFrameAuthOk.serializer(), value)
            "pong" -> input.json.decodeFromJsonElement(ServerFramePong.serializer(), value)
            "message.ack" -> input.json.decodeFromJsonElement(ServerFrameMessageAck.serializer(), value)
            "message.error" -> input.json.decodeFromJsonElement(ServerFrameMessageError.serializer(), value)
            "update" -> input.json.decodeFromJsonElement(ServerFrameUpdate.serializer(), value)
            "typing" -> input.json.decodeFromJsonElement(ServerFrameTyping.serializer(), value)
            "error" -> input.json.decodeFromJsonElement(ServerFrameError.serializer(), value)
            "unsupported" -> input.json.decodeFromJsonElement(ServerFrameUnsupported.serializer(), value)
            else -> { require(tag != null) { "Missing discriminator" }; value = JsonObject(value + mapOf("type" to JsonPrimitive("unsupported"), "data" to buildJsonObject { put("originalType", tag) })); input.json.decodeFromJsonElement(ServerFrameUnsupported.serializer(), value) }
        }
    }
    override fun serialize(encoder: Encoder, value: ServerFrame) {
        val output = encoder as JsonEncoder
        val element = when (value) {
            is ServerFrameAuthOk -> output.json.encodeToJsonElement(ServerFrameAuthOk.serializer(), value)
            is ServerFramePong -> output.json.encodeToJsonElement(ServerFramePong.serializer(), value)
            is ServerFrameMessageAck -> output.json.encodeToJsonElement(ServerFrameMessageAck.serializer(), value)
            is ServerFrameMessageError -> output.json.encodeToJsonElement(ServerFrameMessageError.serializer(), value)
            is ServerFrameUpdate -> output.json.encodeToJsonElement(ServerFrameUpdate.serializer(), value)
            is ServerFrameTyping -> output.json.encodeToJsonElement(ServerFrameTyping.serializer(), value)
            is ServerFrameError -> output.json.encodeToJsonElement(ServerFrameError.serializer(), value)
            is ServerFrameUnsupported -> output.json.encodeToJsonElement(ServerFrameUnsupported.serializer(), value)
        }
        output.encodeJsonElement(element)
    }
}

@Serializable(with = ServerFrameStrictSerializer::class)
sealed interface ServerFrameStrict {
    val `v`: Long
    val `type`: String
    val `ref`: String?
}

@Serializable
data class ServerFrameStrictAuthOk(
    @EncodeDefault
    @SerialName("v") override val `v`: Long = 1,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "auth.ok",
    @SerialName("ref") override val `ref`: String? = null,
    @SerialName("data") val `data`: ServerFrameStrictAuthOkData,
) : ServerFrameStrict

@Serializable
data class ServerFrameStrictPong(
    @EncodeDefault
    @SerialName("v") override val `v`: Long = 1,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "pong",
    @SerialName("ref") override val `ref`: String? = null,
    @SerialName("data") val `data`: ServerFrameStrictPongData,
) : ServerFrameStrict

@Serializable
data class ServerFrameStrictMessageAck(
    @EncodeDefault
    @SerialName("v") override val `v`: Long = 1,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "message.ack",
    @SerialName("ref") override val `ref`: String? = null,
    @SerialName("data") val `data`: MessageAck,
) : ServerFrameStrict

@Serializable
data class ServerFrameStrictMessageError(
    @EncodeDefault
    @SerialName("v") override val `v`: Long = 1,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "message.error",
    @SerialName("ref") override val `ref`: String? = null,
    @SerialName("data") val `data`: ServerFrameStrictMessageErrorData,
) : ServerFrameStrict

@Serializable
data class ServerFrameStrictUpdate(
    @EncodeDefault
    @SerialName("v") override val `v`: Long = 1,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "update",
    @SerialName("ref") override val `ref`: String? = null,
    @SerialName("data") val `data`: UserUpdate,
) : ServerFrameStrict

@Serializable
data class ServerFrameStrictTyping(
    @EncodeDefault
    @SerialName("v") override val `v`: Long = 1,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "typing",
    @SerialName("ref") override val `ref`: String? = null,
    @SerialName("data") val `data`: ServerFrameStrictTypingData,
) : ServerFrameStrict

@Serializable
data class ServerFrameStrictError(
    @EncodeDefault
    @SerialName("v") override val `v`: Long = 1,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "error",
    @SerialName("ref") override val `ref`: String? = null,
    @SerialName("data") val `data`: ServerFrameStrictErrorData,
) : ServerFrameStrict

object ServerFrameStrictSerializer : KSerializer<ServerFrameStrict> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("ServerFrameStrict")
    override fun deserialize(decoder: Decoder): ServerFrameStrict {
        val input = decoder as JsonDecoder
        var value = input.decodeJsonElement().jsonObject
        val tag = value["type"]?.jsonPrimitive?.content
        return when (tag) {
            "auth.ok" -> input.json.decodeFromJsonElement(ServerFrameStrictAuthOk.serializer(), value)
            "pong" -> input.json.decodeFromJsonElement(ServerFrameStrictPong.serializer(), value)
            "message.ack" -> input.json.decodeFromJsonElement(ServerFrameStrictMessageAck.serializer(), value)
            "message.error" -> input.json.decodeFromJsonElement(ServerFrameStrictMessageError.serializer(), value)
            "update" -> input.json.decodeFromJsonElement(ServerFrameStrictUpdate.serializer(), value)
            "typing" -> input.json.decodeFromJsonElement(ServerFrameStrictTyping.serializer(), value)
            "error" -> input.json.decodeFromJsonElement(ServerFrameStrictError.serializer(), value)
            else -> throw SerializationException("Unknown discriminator")
        }
    }
    override fun serialize(encoder: Encoder, value: ServerFrameStrict) {
        val output = encoder as JsonEncoder
        val element = when (value) {
            is ServerFrameStrictAuthOk -> output.json.encodeToJsonElement(ServerFrameStrictAuthOk.serializer(), value)
            is ServerFrameStrictPong -> output.json.encodeToJsonElement(ServerFrameStrictPong.serializer(), value)
            is ServerFrameStrictMessageAck -> output.json.encodeToJsonElement(ServerFrameStrictMessageAck.serializer(), value)
            is ServerFrameStrictMessageError -> output.json.encodeToJsonElement(ServerFrameStrictMessageError.serializer(), value)
            is ServerFrameStrictUpdate -> output.json.encodeToJsonElement(ServerFrameStrictUpdate.serializer(), value)
            is ServerFrameStrictTyping -> output.json.encodeToJsonElement(ServerFrameStrictTyping.serializer(), value)
            is ServerFrameStrictError -> output.json.encodeToJsonElement(ServerFrameStrictError.serializer(), value)
        }
        output.encodeJsonElement(element)
    }
}

@Serializable
data class ServerMessageAckFrame(
    @EncodeDefault
    @SerialName("v") val `v`: Long = 1,
    @EncodeDefault
    @SerialName("type") val `type`: String = "message.ack",
    @SerialName("ref") val `ref`: String? = null,
    @SerialName("data") val `data`: MessageAck,
)

@Serializable
data class ServerMessageErrorFrame(
    @EncodeDefault
    @SerialName("v") val `v`: Long = 1,
    @EncodeDefault
    @SerialName("type") val `type`: String = "message.error",
    @SerialName("ref") val `ref`: String? = null,
    @SerialName("data") val `data`: ServerMessageErrorFrameData,
)

@Serializable
data class ServerPongFrame(
    @EncodeDefault
    @SerialName("v") val `v`: Long = 1,
    @EncodeDefault
    @SerialName("type") val `type`: String = "pong",
    @SerialName("ref") val `ref`: String? = null,
    @SerialName("data") val `data`: ServerPongFrameData,
)

@Serializable
data class ServerTypingFrame(
    @EncodeDefault
    @SerialName("v") val `v`: Long = 1,
    @EncodeDefault
    @SerialName("type") val `type`: String = "typing",
    @SerialName("ref") val `ref`: String? = null,
    @SerialName("data") val `data`: ServerTypingFrameData,
)

@Serializable
data class ServerUnsupportedFrame(
    @EncodeDefault
    @SerialName("v") val `v`: Long = 1,
    @EncodeDefault
    @SerialName("type") val `type`: String = "unsupported",
    @SerialName("ref") val `ref`: String? = null,
    @SerialName("data") val `data`: ServerUnsupportedFrameData,
)

@Serializable
data class ServerUpdateFrame(
    @EncodeDefault
    @SerialName("v") val `v`: Long = 1,
    @EncodeDefault
    @SerialName("type") val `type`: String = "update",
    @SerialName("ref") val `ref`: String? = null,
    @SerialName("data") val `data`: UserUpdate,
)

typealias SessionKind = String

@Serializable
data class SessionSummary(
    @SerialName("sessionId") val `sessionId`: Id,
    @SerialName("kind") val `kind`: SessionKind,
    @SerialName("device") val `device`: DeviceInfo,
    @SerialName("createdAt") val `createdAt`: Timestamp,
    @SerialName("lastActiveAt") val `lastActiveAt`: Timestamp,
    @SerialName("current") val `current`: Boolean,
)

typealias SettingsSection = String

typealias SpendCategory = String

@Serializable
data class SyncEndpointsGetStateResponse(
    @SerialName("latestUpdateSeq") val `latestUpdateSeq`: UpdateSeq,
)

@Serializable
data class SyncEndpointsGetUpdatesQuery(
    @SerialName("since") val `since`: Long,
    @SerialName("limit") val `limit`: Long? = null,
)

@Serializable
data class SyncEndpointsGetUpdatesResponse(
    @SerialName("items") val `items`: List<UserUpdate>,
    @SerialName("latestUpdateSeq") val `latestUpdateSeq`: UpdateSeq,
    @SerialName("hasMore") val `hasMore`: Boolean,
)

@Serializable
data class SystemContent(
    @EncodeDefault
    @SerialName("type") val `type`: String = "system",
    @SerialName("code") val `code`: String,
    @SerialName("params") val `params`: Map<String, SystemContentParamsValue>,
)

@Serializable
data class TextContent(
    @EncodeDefault
    @SerialName("type") val `type`: String = "text",
    @SerialName("text") val `text`: String,
)

@Serializable
data class TextContentInput(
    @EncodeDefault
    @SerialName("type") val `type`: String = "text",
    @SerialName("text") val `text`: String,
)

typealias TimeZone = String

typealias Timestamp = String

@Serializable
data class UnsupportedContent(
    @EncodeDefault
    @SerialName("type") val `type`: String = "unsupported",
    @SerialName("originalType") val `originalType`: String,
)

@Serializable
data class UnsupportedUpdate(
    @EncodeDefault
    @SerialName("type") val `type`: String = "unsupported",
    @SerialName("data") val `data`: UnsupportedUpdateData,
)

@Serializable
data class UpdateAuthorizationRequest(
    @SerialName("authorizedCharacterIds") val `authorizedCharacterIds`: List<Id>,
)

@Serializable
data class UpdateAuthorizationRequestInput(
    @SerialName("authorizedCharacterIds") val `authorizedCharacterIds`: List<Id>,
)

@Serializable
data class UpdateCompanionSettingsRequest(
    @SerialName("instantReply") val `instantReply`: Boolean? = null,
    @SerialName("splitBubbles") val `splitBubbles`: Boolean? = null,
    @SerialName("personaFit") val `personaFit`: Long? = null,
    @SerialName("scenarioMode") val `scenarioMode`: ScenarioMode? = null,
    @SerialName("proactiveMessages") val `proactiveMessages`: Boolean? = null,
    @SerialName("proactiveFrequency") val `proactiveFrequency`: ProactiveFrequency? = null,
    @SerialName("proactiveCalls") val `proactiveCalls`: Boolean? = null,
    @SerialName("dailyLife") val `dailyLife`: Boolean? = null,
)

@Serializable
data class UpdateCompanionSettingsRequestInput(
    @SerialName("instantReply") val `instantReply`: Boolean? = null,
    @SerialName("splitBubbles") val `splitBubbles`: Boolean? = null,
    @SerialName("personaFit") val `personaFit`: Long? = null,
    @SerialName("scenarioMode") val `scenarioMode`: ScenarioMode? = null,
    @SerialName("proactiveMessages") val `proactiveMessages`: Boolean? = null,
    @SerialName("proactiveFrequency") val `proactiveFrequency`: ProactiveFrequency? = null,
    @SerialName("proactiveCalls") val `proactiveCalls`: Boolean? = null,
    @SerialName("dailyLife") val `dailyLife`: Boolean? = null,
)

@Serializable
data class UpdateContactRequest(
    @SerialName("remark") val `remark`: String? = null,
    @SerialName("customAvatarMediaId") val `customAvatarMediaId`: Id? = null,
    @SerialName("addressAs") val `addressAs`: String? = null,
    @SerialName("relationship") val `relationship`: String? = null,
)

@Serializable
data class UpdateContactRequestInput(
    @SerialName("remark") val `remark`: String? = null,
    @SerialName("customAvatarMediaId") val `customAvatarMediaId`: Id? = null,
    @SerialName("addressAs") val `addressAs`: String? = null,
    @SerialName("relationship") val `relationship`: String? = null,
)

@Serializable
data class UpdateConversationStateRequest(
    @SerialName("pinned") val `pinned`: Boolean? = null,
    @SerialName("muted") val `muted`: Boolean? = null,
    @SerialName("hidden") val `hidden`: Boolean? = null,
)

@Serializable
data class UpdateConversationStateRequestInput(
    @SerialName("pinned") val `pinned`: Boolean? = null,
    @SerialName("muted") val `muted`: Boolean? = null,
    @SerialName("hidden") val `hidden`: Boolean? = null,
)

@Serializable
data class UpdateCycleRequest(
    @SerialName("endDate") val `endDate`: LocalDate? = null,
    @SerialName("dayLog") val `dayLog`: DayLog? = null,
)

@Serializable
data class UpdateCycleRequestInput(
    @SerialName("endDate") val `endDate`: LocalDate? = null,
    @SerialName("dayLog") val `dayLog`: DayLogInput? = null,
)

@Serializable
data class UpdateMemoryRequest(
    @SerialName("content") val `content`: String? = null,
    @SerialName("category") val `category`: MemoryCategory? = null,
    @SerialName("status") val `status`: MemoryStatus? = null,
    @SerialName("importance") val `importance`: Long? = null,
    @SerialName("dueAt") val `dueAt`: Timestamp? = null,
    @SerialName("visibility") val `visibility`: MemoryVisibility? = null,
    @SerialName("sharingClass") val `sharingClass`: MemorySharingClass? = null,
)

@Serializable
data class UpdateModelSelectionRequest(
    @SerialName("chat") val `chat`: ModelRef? = null,
    @SerialName("background") val `background`: ModelRef? = null,
    @SerialName("adult") val `adult`: ModelRef? = null,
)

@Serializable
data class UpdateModelSelectionRequestInput(
    @SerialName("chat") val `chat`: ModelRefInput? = null,
    @SerialName("background") val `background`: ModelRefInput? = null,
    @SerialName("adult") val `adult`: ModelRefInput? = null,
)

@Serializable
data class UpdateNotificationSettingsRequest(
    @SerialName("proactiveMessagesEnabled") val `proactiveMessagesEnabled`: Boolean? = null,
    @SerialName("proactiveCallsEnabled") val `proactiveCallsEnabled`: Boolean? = null,
    @SerialName("pushSoundEnabled") val `pushSoundEnabled`: Boolean? = null,
    @SerialName("pushShowContent") val `pushShowContent`: Boolean? = null,
    @SerialName("doNotDisturb") val `doNotDisturb`: UpdateNotificationSettingsRequestDoNotDisturb? = null,
    @SerialName("allowCharacterGroupInvites") val `allowCharacterGroupInvites`: Boolean? = null,
)

@Serializable
data class UpdateNotificationSettingsRequestInput(
    @SerialName("proactiveMessagesEnabled") val `proactiveMessagesEnabled`: Boolean? = null,
    @SerialName("proactiveCallsEnabled") val `proactiveCallsEnabled`: Boolean? = null,
    @SerialName("pushSoundEnabled") val `pushSoundEnabled`: Boolean? = null,
    @SerialName("pushShowContent") val `pushShowContent`: Boolean? = null,
    @SerialName("doNotDisturb") val `doNotDisturb`: UpdateNotificationSettingsRequestInputDoNotDisturb? = null,
    @SerialName("allowCharacterGroupInvites") val `allowCharacterGroupInvites`: Boolean? = null,
)

@Serializable
data class UpdateProfileRequest(
    @SerialName("nickname") val `nickname`: String? = null,
    @SerialName("avatarMediaId") val `avatarMediaId`: Id? = null,
    @SerialName("birthday") val `birthday`: LocalDate? = null,
    @SerialName("gender") val `gender`: Gender? = null,
    @SerialName("city") val `city`: String? = null,
    @SerialName("about") val `about`: String? = null,
    @SerialName("timeZone") val `timeZone`: TimeZone? = null,
)

@Serializable
data class UpdateProfileRequestInput(
    @SerialName("nickname") val `nickname`: String? = null,
    @SerialName("avatarMediaId") val `avatarMediaId`: Id? = null,
    @SerialName("birthday") val `birthday`: LocalDate? = null,
    @SerialName("gender") val `gender`: Gender? = null,
    @SerialName("city") val `city`: String? = null,
    @SerialName("about") val `about`: String? = null,
    @SerialName("timeZone") val `timeZone`: TimeZone? = null,
)

typealias UpdateSeq = Long

@Serializable
data class UpdateUserPreferencesRequest(
    @SerialName("theme") val `theme`: AppTheme? = null,
)

@Serializable
data class UpdateUserPreferencesRequestInput(
    @SerialName("theme") val `theme`: AppTheme? = null,
)

@Serializable
data class UpdateWalletSettingsRequest(
    @SerialName("lowBalanceThresholdMicros") val `lowBalanceThresholdMicros`: Long? = null,
    @SerialName("backgroundDailyLimitMicros") val `backgroundDailyLimitMicros`: Long? = null,
)

@Serializable
data class UpdateWalletSettingsRequestInput(
    @SerialName("lowBalanceThresholdMicros") val `lowBalanceThresholdMicros`: Long? = null,
    @SerialName("backgroundDailyLimitMicros") val `backgroundDailyLimitMicros`: Long? = null,
)

@Serializable
data class Upstream(
    @SerialName("upstreamId") val `upstreamId`: Id,
    @SerialName("name") val `name`: String,
    @SerialName("kind") val `kind`: UpstreamKind,
    @SerialName("baseUrl") val `baseUrl`: String,
    @SerialName("maskedKey") val `maskedKey`: String,
    @SerialName("status") val `status`: UpstreamStatus,
    @SerialName("statusChangedAt") val `statusChangedAt`: Timestamp,
    @SerialName("createdAt") val `createdAt`: Timestamp,
)

@Serializable
data class UpstreamBill(
    @SerialName("billId") val `billId`: Id,
    @SerialName("upstreamId") val `upstreamId`: Id,
    @SerialName("periodStart") val `periodStart`: LocalDate,
    @SerialName("periodEnd") val `periodEnd`: LocalDate,
    @SerialName("amountMicros") val `amountMicros`: Long,
    @SerialName("note") val `note`: String?,
    @SerialName("createdAt") val `createdAt`: Timestamp,
)

typealias UpstreamKind = String

typealias UpstreamStatus = String

@Serializable
data class UpstreamTestFailedDetails(
    @SerialName("reason") val `reason`: UpstreamTestFailure,
)

typealias UpstreamTestFailure = String

@Serializable
data class UsageSummaryQuery(
    @SerialName("from") val `from`: LocalDate,
    @SerialName("to") val `to`: LocalDate,
    @SerialName("groupBy") val `groupBy`: String,
)

@Serializable
data class UsageSummaryQueryInput(
    @SerialName("from") val `from`: LocalDate,
    @SerialName("to") val `to`: LocalDate,
    @SerialName("groupBy") val `groupBy`: String,
)

@Serializable
data class UsageSummaryRow(
    @SerialName("key") val `key`: String,
    @SerialName("amountMicros") val `amountMicros`: Long,
    @SerialName("calls") val `calls`: Long,
)

@Serializable
data class UserConversationState(
    @SerialName("pinned") val `pinned`: Boolean,
    @SerialName("muted") val `muted`: Boolean,
    @SerialName("hidden") val `hidden`: Boolean,
    @SerialName("clearedThroughSeq") val `clearedThroughSeq`: Long,
    @SerialName("readSeq") val `readSeq`: Long,
    @SerialName("markedUnread") val `markedUnread`: Boolean,
)

@Serializable
data class UserCustomCharacter(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("kind") val `kind`: CharacterKind,
    @SerialName("name") val `name`: String,
    @SerialName("avatar") val `avatar`: CharacterAvatar,
    @SerialName("tagline") val `tagline`: String,
    @SerialName("tags") val `tags`: List<String>,
    @SerialName("categoryId") val `categoryId`: String?,
    @SerialName("basis") val `basis`: CharacterBasis,
    @SerialName("added") val `added`: Boolean,
    @SerialName("aliases") val `aliases`: List<String>,
    @SerialName("works") val `works`: List<String>,
    @SerialName("intro") val `intro`: String,
    @SerialName("birthday") val `birthday`: LocalDate?,
    @SerialName("fanName") val `fanName`: String?,
    @SerialName("classification") val `classification`: CharacterClassification,
    @SerialName("showPublicSourceNotice") val `showPublicSourceNotice`: Boolean,
    @SerialName("personaVersion") val `personaVersion`: Long,
    @SerialName("personaUpdatedUnseen") val `personaUpdatedUnseen`: Boolean,
    @SerialName("description") val `description`: String,
    @SerialName("catchphrase") val `catchphrase`: String?,
    @SerialName("exampleDialogue") val `exampleDialogue`: String?,
    @SerialName("childFeaturesDetected") val `childFeaturesDetected`: Boolean,
)

@Serializable
data class UserCustomCharacterPatch(
    @SerialName("name") val `name`: String? = null,
    @SerialName("description") val `description`: String? = null,
    @SerialName("classification") val `classification`: CharacterClassificationInput? = null,
    @SerialName("birthday") val `birthday`: LocalDate? = null,
    @SerialName("catchphrase") val `catchphrase`: String? = null,
    @SerialName("exampleDialogue") val `exampleDialogue`: String? = null,
    @SerialName("tags") val `tags`: List<String>? = null,
    @SerialName("avatarMediaId") val `avatarMediaId`: Id? = null,
)

@Serializable
data class UserCustomCharacterPatchInput(
    @SerialName("name") val `name`: String? = null,
    @SerialName("description") val `description`: String? = null,
    @SerialName("classification") val `classification`: CharacterClassificationInputInput? = null,
    @SerialName("birthday") val `birthday`: LocalDate? = null,
    @SerialName("catchphrase") val `catchphrase`: String? = null,
    @SerialName("exampleDialogue") val `exampleDialogue`: String? = null,
    @SerialName("tags") val `tags`: List<String>? = null,
    @SerialName("avatarMediaId") val `avatarMediaId`: Id? = null,
)

@Serializable
data class UserCustomCharacterWrite(
    @SerialName("name") val `name`: String,
    @SerialName("description") val `description`: String,
    @SerialName("classification") val `classification`: CharacterClassificationInput,
    @SerialName("birthday") val `birthday`: LocalDate? = null,
    @SerialName("catchphrase") val `catchphrase`: String? = null,
    @SerialName("exampleDialogue") val `exampleDialogue`: String? = null,
    @SerialName("tags") val `tags`: List<String>? = null,
    @SerialName("avatarMediaId") val `avatarMediaId`: Id? = null,
)

@Serializable
data class UserCustomCharacterWriteInput(
    @SerialName("name") val `name`: String,
    @SerialName("description") val `description`: String,
    @SerialName("classification") val `classification`: CharacterClassificationInputInput,
    @SerialName("birthday") val `birthday`: LocalDate? = null,
    @SerialName("catchphrase") val `catchphrase`: String? = null,
    @SerialName("exampleDialogue") val `exampleDialogue`: String? = null,
    @SerialName("tags") val `tags`: List<String>? = null,
    @SerialName("avatarMediaId") val `avatarMediaId`: Id? = null,
)

@Serializable
data class UserCustomEndpointsStartTrialResponse(
    @SerialName("conversationId") val `conversationId`: Id,
)

@Serializable
data class UserCustomEndpointsUpdateParams(
    @SerialName("characterId") val `characterId`: Id,
)

typealias UserMediaPurpose = String

@Serializable
data class UserPreferences(
    @SerialName("theme") val `theme`: ReceivedAppTheme,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
)

typealias UserRole = String

@Serializable(with = UserSendableContentSerializer::class)
sealed interface UserSendableContent {
    val `type`: String
}

@Serializable
data class UserSendableContentText(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "text",
    @SerialName("text") val `text`: String,
) : UserSendableContent

@Serializable
data class UserSendableContentNudge(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "nudge",
    @SerialName("targetParticipantId") val `targetParticipantId`: Id,
) : UserSendableContent

object UserSendableContentSerializer : KSerializer<UserSendableContent> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("UserSendableContent")
    override fun deserialize(decoder: Decoder): UserSendableContent {
        val input = decoder as JsonDecoder
        var value = input.decodeJsonElement().jsonObject
        val tag = value["type"]?.jsonPrimitive?.content
        return when (tag) {
            "text" -> input.json.decodeFromJsonElement(UserSendableContentText.serializer(), value)
            "nudge" -> input.json.decodeFromJsonElement(UserSendableContentNudge.serializer(), value)
            else -> throw SerializationException("Unknown discriminator")
        }
    }
    override fun serialize(encoder: Encoder, value: UserSendableContent) {
        val output = encoder as JsonEncoder
        val element = when (value) {
            is UserSendableContentText -> output.json.encodeToJsonElement(UserSendableContentText.serializer(), value)
            is UserSendableContentNudge -> output.json.encodeToJsonElement(UserSendableContentNudge.serializer(), value)
        }
        output.encodeJsonElement(element)
    }
}

@Serializable(with = UserSendableContentInputSerializer::class)
sealed interface UserSendableContentInput {
    val `type`: String
}

@Serializable
data class UserSendableContentInputText(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "text",
    @SerialName("text") val `text`: String,
) : UserSendableContentInput

@Serializable
data class UserSendableContentInputNudge(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "nudge",
    @SerialName("targetParticipantId") val `targetParticipantId`: Id,
) : UserSendableContentInput

object UserSendableContentInputSerializer : KSerializer<UserSendableContentInput> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("UserSendableContentInput")
    override fun deserialize(decoder: Decoder): UserSendableContentInput {
        val input = decoder as JsonDecoder
        var value = input.decodeJsonElement().jsonObject
        val tag = value["type"]?.jsonPrimitive?.content
        return when (tag) {
            "text" -> input.json.decodeFromJsonElement(UserSendableContentInputText.serializer(), value)
            "nudge" -> input.json.decodeFromJsonElement(UserSendableContentInputNudge.serializer(), value)
            else -> throw SerializationException("Unknown discriminator")
        }
    }
    override fun serialize(encoder: Encoder, value: UserSendableContentInput) {
        val output = encoder as JsonEncoder
        val element = when (value) {
            is UserSendableContentInputText -> output.json.encodeToJsonElement(UserSendableContentInputText.serializer(), value)
            is UserSendableContentInputNudge -> output.json.encodeToJsonElement(UserSendableContentInputNudge.serializer(), value)
        }
        output.encodeJsonElement(element)
    }
}

@Serializable(with = UserUpdateSerializer::class)
sealed interface UserUpdate {
    val `updateSeq`: UpdateSeq
    val `occurredAt`: Timestamp
    val `type`: String
}

@Serializable
data class UserUpdateMessageCreated(
    @SerialName("updateSeq") override val `updateSeq`: UpdateSeq,
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "message.created",
    @SerialName("data") val `data`: UserUpdateMessageCreatedData,
) : UserUpdate

@Serializable
data class UserUpdateMessageRecalled(
    @SerialName("updateSeq") override val `updateSeq`: UpdateSeq,
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "message.recalled",
    @SerialName("data") val `data`: UserUpdateMessageRecalledData,
) : UserUpdate

@Serializable
data class UserUpdateMessageHidden(
    @SerialName("updateSeq") override val `updateSeq`: UpdateSeq,
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "message.hidden",
    @SerialName("data") val `data`: UserUpdateMessageHiddenData,
) : UserUpdate

@Serializable
data class UserUpdateConversationCreated(
    @SerialName("updateSeq") override val `updateSeq`: UpdateSeq,
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "conversation.created",
    @SerialName("data") val `data`: UserUpdateConversationCreatedData,
) : UserUpdate

@Serializable
data class UserUpdateConversationUpdated(
    @SerialName("updateSeq") override val `updateSeq`: UpdateSeq,
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "conversation.updated",
    @SerialName("data") val `data`: UserUpdateConversationUpdatedData,
) : UserUpdate

@Serializable
data class UserUpdateConversationStateUpdated(
    @SerialName("updateSeq") override val `updateSeq`: UpdateSeq,
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "conversation.state_updated",
    @SerialName("data") val `data`: UserUpdateConversationStateUpdatedData,
) : UserUpdate

@Serializable
data class UserUpdateConversationPeerReadUpdated(
    @SerialName("updateSeq") override val `updateSeq`: UpdateSeq,
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "conversation.peer_read_updated",
    @SerialName("data") val `data`: UserUpdateConversationPeerReadUpdatedData,
) : UserUpdate

@Serializable
data class UserUpdateContactUpserted(
    @SerialName("updateSeq") override val `updateSeq`: UpdateSeq,
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "contact.upserted",
    @SerialName("data") val `data`: UserUpdateContactUpsertedData,
) : UserUpdate

@Serializable
data class UserUpdateContactRemoved(
    @SerialName("updateSeq") override val `updateSeq`: UpdateSeq,
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "contact.removed",
    @SerialName("data") val `data`: UserUpdateContactRemovedData,
) : UserUpdate

@Serializable
data class UserUpdateSettingsUpdated(
    @SerialName("updateSeq") override val `updateSeq`: UpdateSeq,
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "settings.updated",
    @SerialName("data") val `data`: UserUpdateSettingsUpdatedData,
) : UserUpdate

@Serializable
data class UserUpdateModelStatusUpdated(
    @SerialName("updateSeq") override val `updateSeq`: UpdateSeq,
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "model.status_updated",
    @SerialName("data") val `data`: UserUpdateModelStatusUpdatedData,
) : UserUpdate

@Serializable
data class UserUpdateUnsupported(
    @SerialName("updateSeq") override val `updateSeq`: UpdateSeq,
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "unsupported",
    @SerialName("data") val `data`: UserUpdateUnsupportedData,
) : UserUpdate

object UserUpdateSerializer : KSerializer<UserUpdate> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("UserUpdate")
    override fun deserialize(decoder: Decoder): UserUpdate {
        val input = decoder as JsonDecoder
        var value = input.decodeJsonElement().jsonObject
        val tag = value["type"]?.jsonPrimitive?.content
        return when (tag) {
            "message.created" -> input.json.decodeFromJsonElement(UserUpdateMessageCreated.serializer(), value)
            "message.recalled" -> input.json.decodeFromJsonElement(UserUpdateMessageRecalled.serializer(), value)
            "message.hidden" -> input.json.decodeFromJsonElement(UserUpdateMessageHidden.serializer(), value)
            "conversation.created" -> input.json.decodeFromJsonElement(UserUpdateConversationCreated.serializer(), value)
            "conversation.updated" -> input.json.decodeFromJsonElement(UserUpdateConversationUpdated.serializer(), value)
            "conversation.state_updated" -> input.json.decodeFromJsonElement(UserUpdateConversationStateUpdated.serializer(), value)
            "conversation.peer_read_updated" -> input.json.decodeFromJsonElement(UserUpdateConversationPeerReadUpdated.serializer(), value)
            "contact.upserted" -> input.json.decodeFromJsonElement(UserUpdateContactUpserted.serializer(), value)
            "contact.removed" -> input.json.decodeFromJsonElement(UserUpdateContactRemoved.serializer(), value)
            "settings.updated" -> input.json.decodeFromJsonElement(UserUpdateSettingsUpdated.serializer(), value)
            "model.status_updated" -> input.json.decodeFromJsonElement(UserUpdateModelStatusUpdated.serializer(), value)
            "unsupported" -> input.json.decodeFromJsonElement(UserUpdateUnsupported.serializer(), value)
            else -> { require(tag != null) { "Missing discriminator" }; value = JsonObject(value + mapOf("type" to JsonPrimitive("unsupported"), "data" to buildJsonObject { put("originalType", tag) })); input.json.decodeFromJsonElement(UserUpdateUnsupported.serializer(), value) }
        }
    }
    override fun serialize(encoder: Encoder, value: UserUpdate) {
        val output = encoder as JsonEncoder
        val element = when (value) {
            is UserUpdateMessageCreated -> output.json.encodeToJsonElement(UserUpdateMessageCreated.serializer(), value)
            is UserUpdateMessageRecalled -> output.json.encodeToJsonElement(UserUpdateMessageRecalled.serializer(), value)
            is UserUpdateMessageHidden -> output.json.encodeToJsonElement(UserUpdateMessageHidden.serializer(), value)
            is UserUpdateConversationCreated -> output.json.encodeToJsonElement(UserUpdateConversationCreated.serializer(), value)
            is UserUpdateConversationUpdated -> output.json.encodeToJsonElement(UserUpdateConversationUpdated.serializer(), value)
            is UserUpdateConversationStateUpdated -> output.json.encodeToJsonElement(UserUpdateConversationStateUpdated.serializer(), value)
            is UserUpdateConversationPeerReadUpdated -> output.json.encodeToJsonElement(UserUpdateConversationPeerReadUpdated.serializer(), value)
            is UserUpdateContactUpserted -> output.json.encodeToJsonElement(UserUpdateContactUpserted.serializer(), value)
            is UserUpdateContactRemoved -> output.json.encodeToJsonElement(UserUpdateContactRemoved.serializer(), value)
            is UserUpdateSettingsUpdated -> output.json.encodeToJsonElement(UserUpdateSettingsUpdated.serializer(), value)
            is UserUpdateModelStatusUpdated -> output.json.encodeToJsonElement(UserUpdateModelStatusUpdated.serializer(), value)
            is UserUpdateUnsupported -> output.json.encodeToJsonElement(UserUpdateUnsupported.serializer(), value)
        }
        output.encodeJsonElement(element)
    }
}

@Serializable(with = UserUpdatePayloadSerializer::class)
sealed interface UserUpdatePayload {
    val `type`: String
}

@Serializable
data class UserUpdatePayloadMessageCreated(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "message.created",
    @SerialName("data") val `data`: UserUpdatePayloadMessageCreatedData,
) : UserUpdatePayload

@Serializable
data class UserUpdatePayloadMessageRecalled(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "message.recalled",
    @SerialName("data") val `data`: UserUpdatePayloadMessageRecalledData,
) : UserUpdatePayload

@Serializable
data class UserUpdatePayloadMessageHidden(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "message.hidden",
    @SerialName("data") val `data`: UserUpdatePayloadMessageHiddenData,
) : UserUpdatePayload

@Serializable
data class UserUpdatePayloadConversationCreated(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "conversation.created",
    @SerialName("data") val `data`: UserUpdatePayloadConversationCreatedData,
) : UserUpdatePayload

@Serializable
data class UserUpdatePayloadConversationUpdated(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "conversation.updated",
    @SerialName("data") val `data`: UserUpdatePayloadConversationUpdatedData,
) : UserUpdatePayload

@Serializable
data class UserUpdatePayloadConversationStateUpdated(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "conversation.state_updated",
    @SerialName("data") val `data`: UserUpdatePayloadConversationStateUpdatedData,
) : UserUpdatePayload

@Serializable
data class UserUpdatePayloadConversationPeerReadUpdated(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "conversation.peer_read_updated",
    @SerialName("data") val `data`: UserUpdatePayloadConversationPeerReadUpdatedData,
) : UserUpdatePayload

@Serializable
data class UserUpdatePayloadContactUpserted(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "contact.upserted",
    @SerialName("data") val `data`: UserUpdatePayloadContactUpsertedData,
) : UserUpdatePayload

@Serializable
data class UserUpdatePayloadContactRemoved(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "contact.removed",
    @SerialName("data") val `data`: UserUpdatePayloadContactRemovedData,
) : UserUpdatePayload

@Serializable
data class UserUpdatePayloadSettingsUpdated(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "settings.updated",
    @SerialName("data") val `data`: UserUpdatePayloadSettingsUpdatedData,
) : UserUpdatePayload

@Serializable
data class UserUpdatePayloadModelStatusUpdated(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "model.status_updated",
    @SerialName("data") val `data`: UserUpdatePayloadModelStatusUpdatedData,
) : UserUpdatePayload

object UserUpdatePayloadSerializer : KSerializer<UserUpdatePayload> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("UserUpdatePayload")
    override fun deserialize(decoder: Decoder): UserUpdatePayload {
        val input = decoder as JsonDecoder
        var value = input.decodeJsonElement().jsonObject
        val tag = value["type"]?.jsonPrimitive?.content
        return when (tag) {
            "message.created" -> input.json.decodeFromJsonElement(UserUpdatePayloadMessageCreated.serializer(), value)
            "message.recalled" -> input.json.decodeFromJsonElement(UserUpdatePayloadMessageRecalled.serializer(), value)
            "message.hidden" -> input.json.decodeFromJsonElement(UserUpdatePayloadMessageHidden.serializer(), value)
            "conversation.created" -> input.json.decodeFromJsonElement(UserUpdatePayloadConversationCreated.serializer(), value)
            "conversation.updated" -> input.json.decodeFromJsonElement(UserUpdatePayloadConversationUpdated.serializer(), value)
            "conversation.state_updated" -> input.json.decodeFromJsonElement(UserUpdatePayloadConversationStateUpdated.serializer(), value)
            "conversation.peer_read_updated" -> input.json.decodeFromJsonElement(UserUpdatePayloadConversationPeerReadUpdated.serializer(), value)
            "contact.upserted" -> input.json.decodeFromJsonElement(UserUpdatePayloadContactUpserted.serializer(), value)
            "contact.removed" -> input.json.decodeFromJsonElement(UserUpdatePayloadContactRemoved.serializer(), value)
            "settings.updated" -> input.json.decodeFromJsonElement(UserUpdatePayloadSettingsUpdated.serializer(), value)
            "model.status_updated" -> input.json.decodeFromJsonElement(UserUpdatePayloadModelStatusUpdated.serializer(), value)
            else -> throw SerializationException("Unknown discriminator")
        }
    }
    override fun serialize(encoder: Encoder, value: UserUpdatePayload) {
        val output = encoder as JsonEncoder
        val element = when (value) {
            is UserUpdatePayloadMessageCreated -> output.json.encodeToJsonElement(UserUpdatePayloadMessageCreated.serializer(), value)
            is UserUpdatePayloadMessageRecalled -> output.json.encodeToJsonElement(UserUpdatePayloadMessageRecalled.serializer(), value)
            is UserUpdatePayloadMessageHidden -> output.json.encodeToJsonElement(UserUpdatePayloadMessageHidden.serializer(), value)
            is UserUpdatePayloadConversationCreated -> output.json.encodeToJsonElement(UserUpdatePayloadConversationCreated.serializer(), value)
            is UserUpdatePayloadConversationUpdated -> output.json.encodeToJsonElement(UserUpdatePayloadConversationUpdated.serializer(), value)
            is UserUpdatePayloadConversationStateUpdated -> output.json.encodeToJsonElement(UserUpdatePayloadConversationStateUpdated.serializer(), value)
            is UserUpdatePayloadConversationPeerReadUpdated -> output.json.encodeToJsonElement(UserUpdatePayloadConversationPeerReadUpdated.serializer(), value)
            is UserUpdatePayloadContactUpserted -> output.json.encodeToJsonElement(UserUpdatePayloadContactUpserted.serializer(), value)
            is UserUpdatePayloadContactRemoved -> output.json.encodeToJsonElement(UserUpdatePayloadContactRemoved.serializer(), value)
            is UserUpdatePayloadSettingsUpdated -> output.json.encodeToJsonElement(UserUpdatePayloadSettingsUpdated.serializer(), value)
            is UserUpdatePayloadModelStatusUpdated -> output.json.encodeToJsonElement(UserUpdatePayloadModelStatusUpdated.serializer(), value)
        }
        output.encodeJsonElement(element)
    }
}

typealias Username = String

@Serializable
data class Wallet(
    @SerialName("balanceMicros") val `balanceMicros`: MoneyMicros,
    @SerialName("heldMicros") val `heldMicros`: Long,
    @SerialName("availableMicros") val `availableMicros`: MoneyMicros,
    @SerialName("lowBalanceThresholdMicros") val `lowBalanceThresholdMicros`: Long,
    @SerialName("backgroundBudget") val `backgroundBudget`: WalletBackgroundBudget,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
)

@Serializable
data class WebPushSubscription(
    @SerialName("endpoint") val `endpoint`: String,
    @SerialName("keys") val `keys`: WebPushSubscriptionKeys,
)

@Serializable
data class WebPushSubscriptionInput(
    @SerialName("endpoint") val `endpoint`: String,
    @SerialName("keys") val `keys`: WebPushSubscriptionInputKeys,
)

@Serializable
data class WeibanCardData(
    @SerialName("persona") val `persona`: CardPersona,
    @SerialName("speech") val `speech`: CardSpeech,
    @SerialName("examples") val `examples`: List<CardExample>,
    @SerialName("knowledge") val `knowledge`: CardKnowledge,
    @SerialName("simulation") val `simulation`: CardSimulation,
    @SerialName("social") val `social`: CardSocial,
    @SerialName("recognition") val `recognition`: CardRecognition,
    @SerialName("opening") val `opening`: CardOpening,
    @SerialName("modes") val `modes`: CardModes,
    @SerialName("safetyStyle") val `safetyStyle`: CardSafetyStyle,
    @SerialName("profileExtra") val `profileExtra`: CardProfileExtra,
    @SerialName("admin") val `admin`: CardAdmin,
)

typealias SharedSchema0 = JsonElement

typealias SharedSchema1 = JsonElement

typealias SharedSchema2 = JsonElement

@Serializable
data class AdminAlertRefs(
    @SerialName("upstreamId") val `upstreamId`: Id? = null,
    @SerialName("modelKey") val `modelKey`: ModelKey? = null,
    @SerialName("day") val `day`: LocalDate? = null,
)

@Serializable
data class AdminAlertFactsRefs(
    @SerialName("upstreamId") val `upstreamId`: Id? = null,
    @SerialName("modelKey") val `modelKey`: ModelKey? = null,
    @SerialName("day") val `day`: LocalDate? = null,
)

@Serializable
data class AdminCharacterPublishChecks(
    @SerialName("requiredFieldsComplete") val `requiredFieldsComplete`: Boolean,
    @SerialName("personaStabilityPassed") val `personaStabilityPassed`: Boolean,
    @SerialName("hardBoundaryCasesPassed") val `hardBoundaryCasesPassed`: Boolean,
    @SerialName("hasFallbackGreeting") val `hasFallbackGreeting`: Boolean,
)

@Serializable
data class ApiErrorError(
    @SerialName("code") val `code`: ReceivedErrorCode,
    @SerialName("message") val `message`: String,
    @SerialName("requestId") val `requestId`: String,
    @SerialName("details") val `details`: Map<String, JsonElement>? = null,
)

@Serializable
data class BillingAdminEndpointsGetPlatformSummaryResponseLast30DaysCostByUpstreamItem(
    @SerialName("upstreamId") val `upstreamId`: Id,
    @SerialName("costMicros") val `costMicros`: Long,
)

@Serializable
data class CardAdminSourceListItem(
    @SerialName("url") val `url`: String,
    @SerialName("title") val `title`: String,
    @SerialName("accessedAt") val `accessedAt`: String,
    @SerialName("type") val `type`: String,
)

@Serializable
data class CardAdminImportSource(
    @SerialName("author") val `author`: String? = null,
    @SerialName("version") val `version`: String? = null,
    @SerialName("format") val `format`: String? = null,
)

@Serializable
data class CardExampleTurnsItem(
    @SerialName("role") val `role`: String,
    @SerialName("text") val `text`: String,
)

@Serializable
data class CardPersonaGrowthByFamiliarity(
    @SerialName("L1") val `L1`: String? = null,
    @SerialName("L2") val `L2`: String? = null,
    @SerialName("L3") val `L3`: String? = null,
    @SerialName("L4") val `L4`: String? = null,
    @SerialName("L5") val `L5`: String? = null,
)

@Serializable
data class CardProfileExtraWorksDetailItem(
    @SerialName("title") val `title`: String,
    @SerialName("type") val `type`: String,
    @SerialName("year") val `year`: CardProfileExtraWorksDetailItemYear,
    @SerialName("role") val `role`: String,
)

@Serializable
data class CardRecognitionSelfPublicImagesItem(
    @SerialName("title") val `title`: String,
    @SerialName("kind") val `kind`: String,
    @SerialName("date") val `date`: LocalDate,
    @SerialName("publisher") val `publisher`: String,
    @SerialName("visualCues") val `visualCues`: String,
    @SerialName("sourceUrl") val `sourceUrl`: String,
)

@Serializable
data class CardSocialMoments(
    @SerialName("frequencyPerWeek") val `frequencyPerWeek`: List<JsonElement>,
    @SerialName("tone") val `tone`: String,
    @SerialName("imageSubjects") val `imageSubjects`: List<String>? = null,
    @SerialName("commentStyle") val `commentStyle`: String? = null,
)

@Serializable
data class CardSpeechEmojiHabit(
    @SerialName("frequency") val `frequency`: String,
    @SerialName("favorites") val `favorites`: List<String>,
)

@Serializable
data class CharacterAvatarImage(
    @SerialName("mediaId") val `mediaId`: Id,
    @SerialName("url") val `url`: String,
)

@Serializable
data class CharacterClassificationDerived(
    @SerialName("isMinor") val `isMinor`: Boolean,
    @SerialName("adultModeEligible") val `adultModeEligible`: Boolean,
    @SerialName("romanceAllowed") val `romanceAllowed`: Boolean,
    @SerialName("portraitPolicy") val `portraitPolicy`: String,
    @SerialName("publicStatementGuard") val `publicStatementGuard`: Boolean,
)

@Serializable
data class ClientAuthFrameData(
    @SerialName("token") val `token`: String,
    @SerialName("contractVersion") val `contractVersion`: String,
    @SerialName("device") val `device`: DeviceInfo,
    @SerialName("lastUpdateSeq") val `lastUpdateSeq`: UpdateSeq,
)

@Serializable
data class ClientFrameAuthData(
    @SerialName("token") val `token`: String,
    @SerialName("contractVersion") val `contractVersion`: String,
    @SerialName("device") val `device`: DeviceInfo,
    @SerialName("lastUpdateSeq") val `lastUpdateSeq`: UpdateSeq,
)

@Serializable class ClientFramePingData

@Serializable
data class ClientFrameMessageSendData(
    @SerialName("clientMsgId") val `clientMsgId`: ClientMsgId,
    @SerialName("content") val `content`: UserSendableContent,
    @SerialName("quoteMessageId") val `quoteMessageId`: Id? = null,
    @SerialName("conversationId") val `conversationId`: Id,
)

@Serializable
data class ClientFramePresenceFocusData(
    @SerialName("conversationId") val `conversationId`: Id?,
    @SerialName("foreground") val `foreground`: Boolean,
)

@Serializable
data class ClientFullSyncSnapshotCoveragesItem(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("coverage") val `coverage`: MessagePageCoverage,
)

@Serializable class ClientPingFrameData

@Serializable
data class ClientPresenceFrameData(
    @SerialName("conversationId") val `conversationId`: Id?,
    @SerialName("foreground") val `foreground`: Boolean,
)

@Serializable
data class ClientSendMessageFrameData(
    @SerialName("clientMsgId") val `clientMsgId`: ClientMsgId,
    @SerialName("content") val `content`: UserSendableContent,
    @SerialName("quoteMessageId") val `quoteMessageId`: Id? = null,
    @SerialName("conversationId") val `conversationId`: Id,
)

@Serializable
data class ClientSyncStateRecalledItem(
    @SerialName("messageId") val `messageId`: Id,
    @SerialName("recalledAt") val `recalledAt`: Timestamp,
)

@Serializable
data class ClientSyncStateExcludedItem(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("range") val `range`: ClientSyncStateExcludedItemRange,
)

@Serializable
data class CompanionEndpointsListModesResponseItemsItem(
    @SerialName("id") val `id`: ScenarioMode,
    @SerialName("name") val `name`: String,
)

@Serializable
data class DraftCharacterCardData(
    @SerialName("persona") val `persona`: DraftCharacterCardDataPersona? = null,
    @SerialName("speech") val `speech`: DraftCharacterCardDataSpeech? = null,
    @SerialName("examples") val `examples`: List<CardExample>? = null,
    @SerialName("knowledge") val `knowledge`: DraftCharacterCardDataKnowledge? = null,
    @SerialName("simulation") val `simulation`: DraftCharacterCardDataSimulation? = null,
    @SerialName("social") val `social`: DraftCharacterCardDataSocial? = null,
    @SerialName("recognition") val `recognition`: DraftCharacterCardDataRecognition? = null,
    @SerialName("opening") val `opening`: CardOpening? = null,
    @SerialName("modes") val `modes`: DraftCharacterCardDataModes? = null,
    @SerialName("safetyStyle") val `safetyStyle`: DraftCharacterCardDataSafetyStyle? = null,
    @SerialName("profileExtra") val `profileExtra`: DraftCharacterCardDataProfileExtra? = null,
    @SerialName("admin") val `admin`: DraftCharacterCardDataAdmin? = null,
)

@Serializable
data class EventsBalanceChangedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("balanceMicros") val `balanceMicros`: Long,
    @SerialName("availableMicros") val `availableMicros`: Long,
    @SerialName("entryType") val `entryType`: String,
)

@Serializable
data class EventsBalanceDepletedPayload(
    @SerialName("userId") val `userId`: Id,
)

@Serializable
data class EventsBalanceLowPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("availableMicros") val `availableMicros`: Long,
    @SerialName("thresholdMicros") val `thresholdMicros`: Long,
)

@Serializable
data class EventsBalanceRestoredPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("availableMicros") val `availableMicros`: Long,
    @SerialName("trigger") val `trigger`: String,
)

@Serializable
data class EventsCharacterClassificationChangedPayload(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("ownerUserId") val `ownerUserId`: Id?,
    @SerialName("basis") val `basis`: CharacterBasis,
    @SerialName("realPersonKind") val `realPersonKind`: RealPersonKind?,
    @SerialName("isMinor") val `isMinor`: Boolean,
    @SerialName("adultModeEligible") val `adultModeEligible`: Boolean,
    @SerialName("romanceAllowed") val `romanceAllowed`: Boolean,
    @SerialName("portraitPolicy") val `portraitPolicy`: PortraitPolicy,
    @SerialName("publicStatementGuard") val `publicStatementGuard`: Boolean,
)

@Serializable
data class EventsCharacterPublishedPayload(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class EventsCharacterUnpublishedPayload(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class EventsContactAcceptedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("mode") val `mode`: String,
    @SerialName("referrerCharacterId") val `referrerCharacterId`: Id?,
)

@Serializable
data class EventsContactPurgedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("conversationId") val `conversationId`: Id?,
)

@Serializable
data class EventsContactRemovedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("purgeAfter") val `purgeAfter`: Timestamp,
)

@Serializable
data class EventsContactRequestedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("hasGreeting") val `hasGreeting`: Boolean,
)

@Serializable
data class EventsContactUpdatedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("changedFields") val `changedFields`: List<String>,
)

@Serializable
data class EventsContentScopeChangedPayload(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("scope") val `scope`: ContentScope,
)

@Serializable
data class EventsConversationCreatedPayload(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("type") val `type`: ConversationType,
    @SerialName("participants") val `participants`: List<EventsConversationCreatedPayloadParticipantsItem>,
)

@Serializable
data class EventsDomainEventIdentityUserRegisteredPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("signupBonus") val `signupBonus`: EventsDomainEventIdentityUserRegisteredPayloadSignupBonus? = null,
)

@Serializable
data class EventsDomainEventIdentityProfileUpdatedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("changedFields") val `changedFields`: List<String>,
)

@Serializable
data class EventsDomainEventIdentityPreferencesUpdatedPayload(
    @SerialName("userId") val `userId`: Id,
)

@Serializable
data class EventsDomainEventIdentityNotificationSettingsUpdatedPayload(
    @SerialName("userId") val `userId`: Id,
)

@Serializable
data class EventsDomainEventIdentitySessionRevokedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("sessionId") val `sessionId`: Id,
    @SerialName("reason") val `reason`: String,
)

@Serializable
data class EventsDomainEventIdentityUserDeletionRequestedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("requestedAt") val `requestedAt`: Timestamp,
)

@Serializable
data class EventsDomainEventPlatformUserDataPurgedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("module") val `module`: EventsModuleName,
    @SerialName("deletedRows") val `deletedRows`: Long,
)

@Serializable
data class EventsDomainEventModelAccessModelStatusChangedPayload(
    @SerialName("modelKey") val `modelKey`: ModelKey,
    @SerialName("available") val `available`: Boolean,
    @SerialName("reason") val `reason`: String,
    @SerialName("previousDefaultFor") val `previousDefaultFor`: List<String>? = null,
)

@Serializable
data class EventsDomainEventModelAccessSelectionChangedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id?,
)

@Serializable
data class EventsDomainEventModelAccessUsageReconciledPayload(
    @SerialName("day") val `day`: LocalDate,
    @SerialName("usageWithoutCharge") val `usageWithoutCharge`: Long,
    @SerialName("chargeWithoutUsage") val `chargeWithoutUsage`: Long,
    @SerialName("amountMismatch") val `amountMismatch`: Long,
    @SerialName("snapshotsRepaired") val `snapshotsRepaired`: Long,
    @SerialName("checkedAt") val `checkedAt`: Timestamp,
)

@Serializable
data class EventsDomainEventBillingBalanceChangedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("balanceMicros") val `balanceMicros`: Long,
    @SerialName("availableMicros") val `availableMicros`: Long,
    @SerialName("entryType") val `entryType`: String,
)

@Serializable
data class EventsDomainEventBillingBalanceDepletedPayload(
    @SerialName("userId") val `userId`: Id,
)

@Serializable
data class EventsDomainEventBillingBalanceRestoredPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("availableMicros") val `availableMicros`: Long,
    @SerialName("trigger") val `trigger`: String,
)

@Serializable
data class EventsDomainEventBillingBalanceLowPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("availableMicros") val `availableMicros`: Long,
    @SerialName("thresholdMicros") val `thresholdMicros`: Long,
)

@Serializable
data class EventsDomainEventCharactersCharacterPublishedPayload(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class EventsDomainEventCharactersCharacterUnpublishedPayload(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class EventsDomainEventCharactersCharacterClassificationChangedPayload(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("ownerUserId") val `ownerUserId`: Id?,
    @SerialName("basis") val `basis`: CharacterBasis,
    @SerialName("realPersonKind") val `realPersonKind`: RealPersonKind?,
    @SerialName("isMinor") val `isMinor`: Boolean,
    @SerialName("adultModeEligible") val `adultModeEligible`: Boolean,
    @SerialName("romanceAllowed") val `romanceAllowed`: Boolean,
    @SerialName("portraitPolicy") val `portraitPolicy`: PortraitPolicy,
    @SerialName("publicStatementGuard") val `publicStatementGuard`: Boolean,
)

@Serializable
data class EventsDomainEventCharactersPersonaVersionPublishedPayload(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("personaVersion") val `personaVersion`: Long,
)

@Serializable
data class EventsDomainEventContactsContactRequestedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("hasGreeting") val `hasGreeting`: Boolean,
)

@Serializable
data class EventsDomainEventContactsContactAcceptedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("mode") val `mode`: String,
    @SerialName("referrerCharacterId") val `referrerCharacterId`: Id?,
)

@Serializable
data class EventsDomainEventContactsContactRemovedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("purgeAfter") val `purgeAfter`: Timestamp,
)

@Serializable
data class EventsDomainEventContactsContactPurgedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("conversationId") val `conversationId`: Id?,
)

@Serializable
data class EventsDomainEventContactsContactUpdatedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("changedFields") val `changedFields`: List<String>,
)

@Serializable
data class EventsDomainEventChatConversationCreatedPayload(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("type") val `type`: ConversationType,
    @SerialName("participants") val `participants`: List<EventsDomainEventChatConversationCreatedPayloadParticipantsItem>,
)

@Serializable
data class EventsDomainEventChatMessageCreatedPayload(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("conversationType") val `conversationType`: ConversationType,
    @SerialName("messageId") val `messageId`: Id,
    @SerialName("seq") val `seq`: Seq,
    @SerialName("senderParticipantId") val `senderParticipantId`: Id,
    @SerialName("senderKind") val `senderKind`: String,
    @SerialName("senderRefId") val `senderRefId`: Id?,
    @SerialName("contentType") val `contentType`: String,
    @SerialName("scope") val `scope`: ContentScope,
    @SerialName("quoteMessageId") val `quoteMessageId`: Id?,
    @SerialName("mentionedParticipantIds") val `mentionedParticipantIds`: List<Id>,
    @SerialName("userRecipientIds") val `userRecipientIds`: List<Id>,
)

@Serializable
data class EventsDomainEventChatMessageRecalledPayload(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("messageId") val `messageId`: Id,
    @SerialName("seq") val `seq`: Seq,
    @SerialName("recalledByParticipantId") val `recalledByParticipantId`: Id,
)

@Serializable
data class EventsDomainEventChatReadCursorMovedPayload(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("participantId") val `participantId`: Id,
    @SerialName("participantKind") val `participantKind`: ParticipantKind,
    @SerialName("readSeq") val `readSeq`: Seq,
)

@Serializable
data class EventsDomainEventChatContentScopeChangedPayload(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("scope") val `scope`: ContentScope,
)

@Serializable
data class EventsMessageCreatedPayload(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("conversationType") val `conversationType`: ConversationType,
    @SerialName("messageId") val `messageId`: Id,
    @SerialName("seq") val `seq`: Seq,
    @SerialName("senderParticipantId") val `senderParticipantId`: Id,
    @SerialName("senderKind") val `senderKind`: String,
    @SerialName("senderRefId") val `senderRefId`: Id?,
    @SerialName("contentType") val `contentType`: String,
    @SerialName("scope") val `scope`: ContentScope,
    @SerialName("quoteMessageId") val `quoteMessageId`: Id?,
    @SerialName("mentionedParticipantIds") val `mentionedParticipantIds`: List<Id>,
    @SerialName("userRecipientIds") val `userRecipientIds`: List<Id>,
)

@Serializable
data class EventsMessageRecalledPayload(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("messageId") val `messageId`: Id,
    @SerialName("seq") val `seq`: Seq,
    @SerialName("recalledByParticipantId") val `recalledByParticipantId`: Id,
)

@Serializable
data class EventsModelSelectionChangedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id?,
)

@Serializable
data class EventsModelStatusChangedPayload(
    @SerialName("modelKey") val `modelKey`: ModelKey,
    @SerialName("available") val `available`: Boolean,
    @SerialName("reason") val `reason`: String,
    @SerialName("previousDefaultFor") val `previousDefaultFor`: List<String>? = null,
)

@Serializable
data class EventsNotificationSettingsUpdatedPayload(
    @SerialName("userId") val `userId`: Id,
)

@Serializable
data class EventsPersonaVersionPublishedPayload(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("personaVersion") val `personaVersion`: Long,
)

@Serializable
data class EventsPreferencesUpdatedPayload(
    @SerialName("userId") val `userId`: Id,
)

@Serializable
data class EventsProfileUpdatedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("changedFields") val `changedFields`: List<String>,
)

@Serializable
data class EventsReadCursorMovedPayload(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("participantId") val `participantId`: Id,
    @SerialName("participantKind") val `participantKind`: ParticipantKind,
    @SerialName("readSeq") val `readSeq`: Seq,
)

@Serializable
data class EventsSessionRevokedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("sessionId") val `sessionId`: Id,
    @SerialName("reason") val `reason`: String,
)

@Serializable
data class EventsUsageReconciledPayload(
    @SerialName("day") val `day`: LocalDate,
    @SerialName("usageWithoutCharge") val `usageWithoutCharge`: Long,
    @SerialName("chargeWithoutUsage") val `chargeWithoutUsage`: Long,
    @SerialName("amountMismatch") val `amountMismatch`: Long,
    @SerialName("snapshotsRepaired") val `snapshotsRepaired`: Long,
    @SerialName("checkedAt") val `checkedAt`: Timestamp,
)

@Serializable
data class EventsUserDataPurgedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("module") val `module`: EventsModuleName,
    @SerialName("deletedRows") val `deletedRows`: Long,
)

@Serializable
data class EventsUserDeletionRequestedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("requestedAt") val `requestedAt`: Timestamp,
)

@Serializable
data class EventsUserRegisteredPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("signupBonus") val `signupBonus`: EventsUserRegisteredPayloadSignupBonus? = null,
)

typealias MessageContentSystemParamsValue = JsonElement

@Serializable
data class MessagePageCoverageExcludedRangesItem(
    @SerialName("fromSeq") val `fromSeq`: Seq,
    @SerialName("throughSeq") val `throughSeq`: Seq,
    @SerialName("reason") val `reason`: String,
)

@Serializable
data class NotificationSettingsDoNotDisturb(
    @SerialName("enabled") val `enabled`: Boolean,
    @SerialName("start") val `start`: LocalTime,
    @SerialName("end") val `end`: LocalTime,
)

@Serializable
data class ProtocolVectorStepsItem(
    @SerialName("operation") val `operation`: ClientSyncOperation,
    @SerialName("expectError") val `expectError`: Boolean? = null,
    @SerialName("expectState") val `expectState`: ClientSyncState? = null,
)

@Serializable
data class ProtocolVectorExpected(
    @SerialName("state") val `state`: ClientSyncState,
    @SerialName("effects") val `effects`: List<ClientSyncEffect>,
)

typealias ReceivedMessageContentSystemParamsValue = JsonElement

@Serializable
data class ReceivedUserUpdatePayloadMessageCreatedData(
    @SerialName("message") val `message`: Message,
)

@Serializable
data class ReceivedUserUpdatePayloadMessageRecalledData(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("messageId") val `messageId`: Id,
    @SerialName("recalledAt") val `recalledAt`: Timestamp,
)

@Serializable
data class ReceivedUserUpdatePayloadMessageHiddenData(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("messageId") val `messageId`: Id,
)

@Serializable
data class ReceivedUserUpdatePayloadConversationCreatedData(
    @SerialName("conversation") val `conversation`: Conversation,
)

@Serializable
data class ReceivedUserUpdatePayloadConversationUpdatedData(
    @SerialName("conversation") val `conversation`: Conversation,
)

@Serializable
data class ReceivedUserUpdatePayloadConversationStateUpdatedData(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("state") val `state`: UserConversationState,
    @SerialName("unreadCount") val `unreadCount`: Long,
)

@Serializable
data class ReceivedUserUpdatePayloadConversationPeerReadUpdatedData(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("peerReadSeq") val `peerReadSeq`: Long,
)

@Serializable
data class ReceivedUserUpdatePayloadContactUpsertedData(
    @SerialName("contact") val `contact`: Contact,
)

@Serializable
data class ReceivedUserUpdatePayloadContactRemovedData(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class ReceivedUserUpdatePayloadSettingsUpdatedData(
    @SerialName("section") val `section`: String,
    @SerialName("characterId") val `characterId`: Id?,
)

@Serializable
data class ReceivedUserUpdatePayloadModelStatusUpdatedData(
    @SerialName("status") val `status`: ModelStatus,
)

@Serializable
data class ReceivedUserUpdatePayloadUnsupportedData(
    @SerialName("originalType") val `originalType`: String,
)

@Serializable
data class ReconciliationRunUpstreamDiffsItem(
    @SerialName("upstreamId") val `upstreamId`: Id,
    @SerialName("periodStart") val `periodStart`: LocalDate,
    @SerialName("periodEnd") val `periodEnd`: LocalDate,
    @SerialName("billedMicros") val `billedMicros`: Long,
    @SerialName("computedCostMicros") val `computedCostMicros`: Long,
    @SerialName("diffRatio") val `diffRatio`: Double,
    @SerialName("flagged") val `flagged`: Boolean,
)

@Serializable
data class ServerAuthOkFrameData(
    @SerialName("userId") val `userId`: Id,
    @SerialName("sessionId") val `sessionId`: Id,
    @SerialName("latestUpdateSeq") val `latestUpdateSeq`: UpdateSeq,
    @SerialName("minClientVersion") val `minClientVersion`: String,
    @SerialName("serverTime") val `serverTime`: String,
)

@Serializable
data class ServerErrorFrameData(
    @SerialName("code") val `code`: ReceivedErrorCode,
    @SerialName("message") val `message`: String,
)

@Serializable
data class ServerFrameAuthOkData(
    @SerialName("userId") val `userId`: Id,
    @SerialName("sessionId") val `sessionId`: Id,
    @SerialName("latestUpdateSeq") val `latestUpdateSeq`: UpdateSeq,
    @SerialName("minClientVersion") val `minClientVersion`: String,
    @SerialName("serverTime") val `serverTime`: String,
)

@Serializable
data class ServerFramePongData(
    @SerialName("serverTime") val `serverTime`: String,
)

@Serializable
data class ServerFrameMessageErrorData(
    @SerialName("clientMsgId") val `clientMsgId`: ClientMsgId,
    @SerialName("code") val `code`: ReceivedErrorCode,
    @SerialName("message") val `message`: String,
    @SerialName("retryable") val `retryable`: Boolean,
)

@Serializable
data class ServerFrameTypingData(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("participantId") val `participantId`: Id,
    @SerialName("state") val `state`: String,
)

@Serializable
data class ServerFrameErrorData(
    @SerialName("code") val `code`: ReceivedErrorCode,
    @SerialName("message") val `message`: String,
)

@Serializable
data class ServerFrameUnsupportedData(
    @SerialName("originalType") val `originalType`: String,
)

@Serializable
data class ServerFrameStrictAuthOkData(
    @SerialName("userId") val `userId`: Id,
    @SerialName("sessionId") val `sessionId`: Id,
    @SerialName("latestUpdateSeq") val `latestUpdateSeq`: UpdateSeq,
    @SerialName("minClientVersion") val `minClientVersion`: String,
    @SerialName("serverTime") val `serverTime`: String,
)

@Serializable
data class ServerFrameStrictPongData(
    @SerialName("serverTime") val `serverTime`: String,
)

@Serializable
data class ServerFrameStrictMessageErrorData(
    @SerialName("clientMsgId") val `clientMsgId`: ClientMsgId,
    @SerialName("code") val `code`: ReceivedErrorCode,
    @SerialName("message") val `message`: String,
    @SerialName("retryable") val `retryable`: Boolean,
)

@Serializable
data class ServerFrameStrictTypingData(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("participantId") val `participantId`: Id,
    @SerialName("state") val `state`: String,
)

@Serializable
data class ServerFrameStrictErrorData(
    @SerialName("code") val `code`: ReceivedErrorCode,
    @SerialName("message") val `message`: String,
)

@Serializable
data class ServerMessageErrorFrameData(
    @SerialName("clientMsgId") val `clientMsgId`: ClientMsgId,
    @SerialName("code") val `code`: ReceivedErrorCode,
    @SerialName("message") val `message`: String,
    @SerialName("retryable") val `retryable`: Boolean,
)

@Serializable
data class ServerPongFrameData(
    @SerialName("serverTime") val `serverTime`: String,
)

@Serializable
data class ServerTypingFrameData(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("participantId") val `participantId`: Id,
    @SerialName("state") val `state`: String,
)

@Serializable
data class ServerUnsupportedFrameData(
    @SerialName("originalType") val `originalType`: String,
)

typealias SystemContentParamsValue = JsonElement

@Serializable
data class UnsupportedUpdateData(
    @SerialName("originalType") val `originalType`: String,
)

@Serializable
data class UpdateNotificationSettingsRequestDoNotDisturb(
    @SerialName("enabled") val `enabled`: Boolean,
    @SerialName("start") val `start`: LocalTime,
    @SerialName("end") val `end`: LocalTime,
)

@Serializable
data class UpdateNotificationSettingsRequestInputDoNotDisturb(
    @SerialName("enabled") val `enabled`: Boolean,
    @SerialName("start") val `start`: LocalTime,
    @SerialName("end") val `end`: LocalTime,
)

@Serializable
data class UserUpdateMessageCreatedData(
    @SerialName("message") val `message`: Message,
)

@Serializable
data class UserUpdateMessageRecalledData(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("messageId") val `messageId`: Id,
    @SerialName("recalledAt") val `recalledAt`: Timestamp,
)

@Serializable
data class UserUpdateMessageHiddenData(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("messageId") val `messageId`: Id,
)

@Serializable
data class UserUpdateConversationCreatedData(
    @SerialName("conversation") val `conversation`: Conversation,
)

@Serializable
data class UserUpdateConversationUpdatedData(
    @SerialName("conversation") val `conversation`: Conversation,
)

@Serializable
data class UserUpdateConversationStateUpdatedData(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("state") val `state`: UserConversationState,
    @SerialName("unreadCount") val `unreadCount`: Long,
)

@Serializable
data class UserUpdateConversationPeerReadUpdatedData(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("peerReadSeq") val `peerReadSeq`: Long,
)

@Serializable
data class UserUpdateContactUpsertedData(
    @SerialName("contact") val `contact`: Contact,
)

@Serializable
data class UserUpdateContactRemovedData(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class UserUpdateSettingsUpdatedData(
    @SerialName("section") val `section`: String,
    @SerialName("characterId") val `characterId`: Id?,
)

@Serializable
data class UserUpdateModelStatusUpdatedData(
    @SerialName("status") val `status`: ModelStatus,
)

@Serializable
data class UserUpdateUnsupportedData(
    @SerialName("originalType") val `originalType`: String,
)

@Serializable
data class UserUpdatePayloadMessageCreatedData(
    @SerialName("message") val `message`: Message,
)

@Serializable
data class UserUpdatePayloadMessageRecalledData(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("messageId") val `messageId`: Id,
    @SerialName("recalledAt") val `recalledAt`: Timestamp,
)

@Serializable
data class UserUpdatePayloadMessageHiddenData(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("messageId") val `messageId`: Id,
)

@Serializable
data class UserUpdatePayloadConversationCreatedData(
    @SerialName("conversation") val `conversation`: Conversation,
)

@Serializable
data class UserUpdatePayloadConversationUpdatedData(
    @SerialName("conversation") val `conversation`: Conversation,
)

@Serializable
data class UserUpdatePayloadConversationStateUpdatedData(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("state") val `state`: UserConversationState,
    @SerialName("unreadCount") val `unreadCount`: Long,
)

@Serializable
data class UserUpdatePayloadConversationPeerReadUpdatedData(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("peerReadSeq") val `peerReadSeq`: Long,
)

@Serializable
data class UserUpdatePayloadContactUpsertedData(
    @SerialName("contact") val `contact`: Contact,
)

@Serializable
data class UserUpdatePayloadContactRemovedData(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class UserUpdatePayloadSettingsUpdatedData(
    @SerialName("section") val `section`: String,
    @SerialName("characterId") val `characterId`: Id?,
)

@Serializable
data class UserUpdatePayloadModelStatusUpdatedData(
    @SerialName("status") val `status`: ModelStatus,
)

@Serializable
data class WalletBackgroundBudget(
    @SerialName("dailyLimitMicros") val `dailyLimitMicros`: Long,
    @SerialName("spentTodayMicros") val `spentTodayMicros`: Long,
    @SerialName("resetsAt") val `resetsAt`: Timestamp,
)

@Serializable
data class WebPushSubscriptionKeys(
    @SerialName("p256dh") val `p256dh`: String,
    @SerialName("auth") val `auth`: String,
)

@Serializable
data class WebPushSubscriptionInputKeys(
    @SerialName("p256dh") val `p256dh`: String,
    @SerialName("auth") val `auth`: String,
)

typealias CardProfileExtraWorksDetailItemYear = JsonElement

@Serializable
data class ClientSyncStateExcludedItemRange(
    @SerialName("fromSeq") val `fromSeq`: Seq,
    @SerialName("throughSeq") val `throughSeq`: Seq,
    @SerialName("reason") val `reason`: String,
)

@Serializable
data class DraftCharacterCardDataPersona(
    @SerialName("summary") val `summary`: String? = null,
    @SerialName("background") val `background`: String? = null,
    @SerialName("personality") val `personality`: String? = null,
    @SerialName("values") val `values`: String? = null,
    @SerialName("likes") val `likes`: List<String>? = null,
    @SerialName("dislikes") val `dislikes`: List<String>? = null,
    @SerialName("personaTags") val `personaTags`: List<PersonaTag>? = null,
    @SerialName("personaTagsCustom") val `personaTagsCustom`: List<String>? = null,
    @SerialName("defaultAttitudeToUser") val `defaultAttitudeToUser`: String? = null,
    @SerialName("growthByFamiliarity") val `growthByFamiliarity`: DraftCharacterCardDataPersonaGrowthByFamiliarity? = null,
    @SerialName("worldNote") val `worldNote`: String? = null,
)

@Serializable
data class DraftCharacterCardDataSpeech(
    @SerialName("selfReference") val `selfReference`: List<String>? = null,
    @SerialName("addressUserDefault") val `addressUserDefault`: String? = null,
    @SerialName("tone") val `tone`: String? = null,
    @SerialName("sentenceLength") val `sentenceLength`: String? = null,
    @SerialName("catchphrases") val `catchphrases`: List<String>? = null,
    @SerialName("catchphraseFrequency") val `catchphraseFrequency`: String? = null,
    @SerialName("emojiHabit") val `emojiHabit`: DraftCharacterCardDataSpeechEmojiHabit? = null,
    @SerialName("punctuationHabit") val `punctuationHabit`: String? = null,
    @SerialName("dialect") val `dialect`: String? = null,
    @SerialName("typoStyle") val `typoStyle`: String? = null,
    @SerialName("forbiddenWords") val `forbiddenWords`: List<String>? = null,
    @SerialName("languageNotes") val `languageNotes`: String? = null,
)

@Serializable
data class DraftCharacterCardDataKnowledge(
    @SerialName("entries") val `entries`: List<CardKnowledgeEntry>? = null,
    @SerialName("unknownPolicy") val `unknownPolicy`: String? = null,
)

@Serializable
data class DraftCharacterCardDataSimulation(
    @SerialName("dailyActivities") val `dailyActivities`: List<String>? = null,
    @SerialName("placeTypes") val `placeTypes`: List<String>? = null,
    @SerialName("hobbies") val `hobbies`: List<String>? = null,
    @SerialName("workRhythm") val `workRhythm`: String? = null,
    @SerialName("storylineSeeds") val `storylineSeeds`: List<String>? = null,
    @SerialName("forbiddenEventTopics") val `forbiddenEventTopics`: List<String>? = null,
    @SerialName("moodBaseline") val `moodBaseline`: String? = null,
    @SerialName("sharePreference") val `sharePreference`: String? = null,
)

@Serializable
data class DraftCharacterCardDataSocial(
    @SerialName("talkativeness") val `talkativeness`: Long? = null,
    @SerialName("groupStyle") val `groupStyle`: String? = null,
    @SerialName("moments") val `moments`: DraftCharacterCardDataSocialMoments? = null,
    @SerialName("stickerPacks") val `stickerPacks`: List<String>? = null,
    @SerialName("stickerRate") val `stickerRate`: String? = null,
    @SerialName("voiceId") val `voiceId`: String? = null,
    @SerialName("proactiveStyle") val `proactiveStyle`: String? = null,
    @SerialName("callStyle") val `callStyle`: String? = null,
)

@Serializable
data class DraftCharacterCardDataRecognition(
    @SerialName("selfEnabled") val `selfEnabled`: Boolean? = null,
    @SerialName("selfPublicImages") val `selfPublicImages`: List<DraftCharacterCardDataRecognitionSelfPublicImagesItem>? = null,
    @SerialName("selfReferenceMediaIds") val `selfReferenceMediaIds`: List<Id>? = null,
    @SerialName("appearanceCues") val `appearanceCues`: String? = null,
)

@Serializable
data class DraftCharacterCardDataModes(
    @SerialName("adminAllowlist") val `adminAllowlist`: List<String>? = null,
    @SerialName("modeOverrides") val `modeOverrides`: Map<String, String>? = null,
)

@Serializable
data class DraftCharacterCardDataSafetyStyle(
    @SerialName("deflectStyle") val `deflectStyle`: String? = null,
    @SerialName("refuseSelfieStyle") val `refuseSelfieStyle`: String? = null,
    @SerialName("careVoice") val `careVoice`: String? = null,
    @SerialName("careFallbackText") val `careFallbackText`: String? = null,
)

@Serializable
data class DraftCharacterCardDataProfileExtra(
    @SerialName("occupation") val `occupation`: String? = null,
    @SerialName("gender") val `gender`: String? = null,
    @SerialName("ageDisplay") val `ageDisplay`: String? = null,
    @SerialName("workSource") val `workSource`: String? = null,
    @SerialName("fanNameUsage") val `fanNameUsage`: String? = null,
    @SerialName("worksDetail") val `worksDetail`: List<DraftCharacterCardDataProfileExtraWorksDetailItem>? = null,
    @SerialName("searchKeywords") val `searchKeywords`: List<String>? = null,
)

@Serializable
data class DraftCharacterCardDataAdmin(
    @SerialName("creatorNotes") val `creatorNotes`: String? = null,
    @SerialName("sourceList") val `sourceList`: List<DraftCharacterCardDataAdminSourceListItem>? = null,
    @SerialName("creationMethod") val `creationMethod`: String? = null,
    @SerialName("importSource") val `importSource`: DraftCharacterCardDataAdminImportSource? = null,
    @SerialName("extensions") val `extensions`: Map<String, SharedSchema0>? = null,
)

@Serializable
data class EventsConversationCreatedPayloadParticipantsItem(
    @SerialName("participantId") val `participantId`: Id,
    @SerialName("kind") val `kind`: ParticipantKind,
    @SerialName("refId") val `refId`: Id,
)

@Serializable
data class EventsDomainEventIdentityUserRegisteredPayloadSignupBonus(
    @SerialName("amountMicros") val `amountMicros`: Long,
    @SerialName("grantedByUserId") val `grantedByUserId`: Id?,
)

@Serializable
data class EventsDomainEventChatConversationCreatedPayloadParticipantsItem(
    @SerialName("participantId") val `participantId`: Id,
    @SerialName("kind") val `kind`: ParticipantKind,
    @SerialName("refId") val `refId`: Id,
)

@Serializable
data class EventsUserRegisteredPayloadSignupBonus(
    @SerialName("amountMicros") val `amountMicros`: Long,
    @SerialName("grantedByUserId") val `grantedByUserId`: Id?,
)

@Serializable
data class DraftCharacterCardDataPersonaGrowthByFamiliarity(
    @SerialName("L1") val `L1`: String? = null,
    @SerialName("L2") val `L2`: String? = null,
    @SerialName("L3") val `L3`: String? = null,
    @SerialName("L4") val `L4`: String? = null,
    @SerialName("L5") val `L5`: String? = null,
)

@Serializable
data class DraftCharacterCardDataSpeechEmojiHabit(
    @SerialName("frequency") val `frequency`: String,
    @SerialName("favorites") val `favorites`: List<String>,
)

@Serializable
data class DraftCharacterCardDataSocialMoments(
    @SerialName("frequencyPerWeek") val `frequencyPerWeek`: List<JsonElement>,
    @SerialName("tone") val `tone`: String,
    @SerialName("imageSubjects") val `imageSubjects`: List<String>? = null,
    @SerialName("commentStyle") val `commentStyle`: String? = null,
)

@Serializable
data class DraftCharacterCardDataRecognitionSelfPublicImagesItem(
    @SerialName("title") val `title`: String,
    @SerialName("kind") val `kind`: String,
    @SerialName("date") val `date`: LocalDate,
    @SerialName("publisher") val `publisher`: String,
    @SerialName("visualCues") val `visualCues`: String,
    @SerialName("sourceUrl") val `sourceUrl`: String,
)

@Serializable
data class DraftCharacterCardDataProfileExtraWorksDetailItem(
    @SerialName("title") val `title`: String,
    @SerialName("type") val `type`: String,
    @SerialName("year") val `year`: DraftCharacterCardDataProfileExtraWorksDetailItemYear,
    @SerialName("role") val `role`: String,
)

@Serializable
data class DraftCharacterCardDataAdminSourceListItem(
    @SerialName("url") val `url`: String,
    @SerialName("title") val `title`: String,
    @SerialName("accessedAt") val `accessedAt`: String,
    @SerialName("type") val `type`: String,
)

@Serializable
data class DraftCharacterCardDataAdminImportSource(
    @SerialName("author") val `author`: String? = null,
    @SerialName("version") val `version`: String? = null,
    @SerialName("format") val `format`: String? = null,
)

typealias DraftCharacterCardDataProfileExtraWorksDetailItemYear = JsonElement

