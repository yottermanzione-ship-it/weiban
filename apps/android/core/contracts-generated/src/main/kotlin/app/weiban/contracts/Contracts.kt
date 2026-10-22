// GENERATED from packages/contracts JSON Schema. DO NOT EDIT.
// Contract 3.37. Regenerate: pnpm android:generate
@file:OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
package app.weiban.contracts

import kotlinx.serialization.*
import kotlinx.serialization.descriptors.*
import kotlinx.serialization.encoding.*
import kotlinx.serialization.json.*

const val CONTRACT_VERSION: String = "3.37"

@Serializable
data class AccountAlias(
    @SerialName("username") val `username`: Username,
    @SerialName("nextChangeAt") val `nextChangeAt`: Timestamp?,
)

@Serializable
data class AccountDeletionModuleProgress(
    @SerialName("module") val `module`: String,
    @SerialName("purged") val `purged`: Boolean,
    @SerialName("deletedRows") val `deletedRows`: Long?,
    @SerialName("purgedAt") val `purgedAt`: Timestamp?,
)

@Serializable
data class Achievement(
    @SerialName("no") val `no`: Long,
    @SerialName("key") val `key`: String,
    @SerialName("name") val `name`: String,
    @SerialName("condition") val `condition`: String,
    @SerialName("group") val `group`: String,
    @SerialName("type") val `type`: String,
    @SerialName("unlockedAt") val `unlockedAt`: Timestamp?,
    @SerialName("progress") val `progress`: AchievementProgress?,
)

typealias AchievementGroup = String

typealias AchievementKey = String

@Serializable
data class ActionCardContent(
    @EncodeDefault
    @SerialName("type") val `type`: String = "action_card",
    @SerialName("cardKind") val `cardKind`: String,
    @SerialName("text") val `text`: String,
    @SerialName("actions") val `actions`: List<ActionCardContentActionsItem>,
    @SerialName("ref") val `ref`: ActionCardContentRef?,
)

typealias ActionCardKind = String

@Serializable
data class AddAnniversaryRequest(
    @SerialName("label") val `label`: String,
    @SerialName("date") val `date`: LocalDate,
    @SerialName("repeatYearly") val `repeatYearly`: Boolean? = null,
)

@Serializable
data class AddAnniversaryRequestInput(
    @SerialName("label") val `label`: String,
    @SerialName("date") val `date`: LocalDate,
    @SerialName("repeatYearly") val `repeatYearly`: Boolean? = null,
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
data class AddFamiliarityPointsRequest(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("eventType") val `eventType`: FamiliarityEventType,
    @SerialName("idempotencyKey") val `idempotencyKey`: String,
    @SerialName("occurredAt") val `occurredAt`: Timestamp? = null,
)

@Serializable
data class AddFamiliarityPointsRequestInput(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("eventType") val `eventType`: FamiliarityEventType,
    @SerialName("idempotencyKey") val `idempotencyKey`: String,
    @SerialName("occurredAt") val `occurredAt`: Timestamp? = null,
)

@Serializable
data class AddFamiliarityPointsResponse(
    @SerialName("familiarity") val `familiarity`: FamiliarityInfo,
    @SerialName("pointsAdded") val `pointsAdded`: Long,
    @SerialName("leveledUp") val `leveledUp`: Boolean,
)

@Serializable
data class AddFavoritesRequest(
    @SerialName("items") val `items`: List<AddFavoritesRequestItemsItem>,
)

@Serializable
data class AddFavoritesRequestInput(
    @SerialName("items") val `items`: List<AddFavoritesRequestInputItemsItem>,
)

@Serializable
data class AdminAccountSummary(
    @SerialName("userId") val `userId`: Id,
    @SerialName("username") val `username`: String,
    @SerialName("balanceMicros") val `balanceMicros`: MoneyMicros,
    @SerialName("heldMicros") val `heldMicros`: Long,
    @SerialName("spentLast30DaysMicros") val `spentLast30DaysMicros`: Long,
    @SerialName("balancePoints") val `balancePoints`: Points? = null,
    @SerialName("spentLast30DaysPoints") val `spentLast30DaysPoints`: NonNegativePoints? = null,
    @SerialName("bonusBalanceMicros") val `bonusBalanceMicros`: Long? = null,
    @SerialName("bonusBalancePoints") val `bonusBalancePoints`: NonNegativePoints? = null,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
)

@Serializable
data class AdminAdjustmentRequest(
    @SerialName("direction") val `direction`: String,
    @SerialName("amountMicros") val `amountMicros`: PositiveMoneyMicros? = null,
    @SerialName("points") val `points`: Double? = null,
    @SerialName("reason") val `reason`: String,
    @SerialName("idempotencyKey") val `idempotencyKey`: String,
)

@Serializable
data class AdminAdjustmentRequestInput(
    @SerialName("direction") val `direction`: String,
    @SerialName("amountMicros") val `amountMicros`: PositiveMoneyMicros? = null,
    @SerialName("points") val `points`: Double? = null,
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
data class AdminAnnouncement(
    @SerialName("title") val `title`: String,
    @SerialName("body") val `body`: String,
    @SerialName("platforms") val `platforms`: List<ReleasePlatform>,
    @SerialName("startsAt") val `startsAt`: Timestamp?,
    @SerialName("endsAt") val `endsAt`: Timestamp?,
    @SerialName("popup") val `popup`: Boolean,
    @SerialName("pinned") val `pinned`: Boolean,
    @SerialName("announcementId") val `announcementId`: Id,
    @SerialName("status") val `status`: String,
    @SerialName("publishedAt") val `publishedAt`: Timestamp?,
    @SerialName("withdrawnAt") val `withdrawnAt`: Timestamp?,
    @SerialName("createdAt") val `createdAt`: Timestamp,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
    @SerialName("readCount") val `readCount`: Long,
)

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
    @SerialName("arenaModelName") val `arenaModelName`: String? = null,
    @SerialName("sortOrder") val `sortOrder`: Long,
    @SerialName("defaultFor") val `defaultFor`: List<String>,
    @SerialName("enabled") val `enabled`: Boolean,
    @SerialName("scenarios") val `scenarios`: List<ModelScenario>? = null,
    @SerialName("systemMessageMode") val `systemMessageMode`: SystemMessageMode? = null,
    @SerialName("billingBounds") val `billingBounds`: RouteBillingBounds? = null,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
    @SerialName("deletedAt") val `deletedAt`: Timestamp? = null,
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
    @SerialName("arenaModelName") val `arenaModelName`: String? = null,
    @SerialName("sortOrder") val `sortOrder`: Long,
    @SerialName("defaultFor") val `defaultFor`: List<String>,
    @SerialName("enabled") val `enabled`: Boolean,
    @SerialName("scenarios") val `scenarios`: List<ModelScenario>? = null,
    @SerialName("systemMessageMode") val `systemMessageMode`: SystemMessageMode? = null,
    @SerialName("billingBounds") val `billingBounds`: RouteBillingBounds? = null,
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
    @SerialName("arenaModelName") val `arenaModelName`: String? = null,
    @SerialName("sortOrder") val `sortOrder`: Long,
    @SerialName("defaultFor") val `defaultFor`: List<String>,
    @SerialName("enabled") val `enabled`: Boolean,
    @SerialName("scenarios") val `scenarios`: List<ModelScenario>? = null,
    @SerialName("systemMessageMode") val `systemMessageMode`: SystemMessageMode? = null,
    @SerialName("billingBounds") val `billingBounds`: RouteBillingBoundsInput? = null,
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
data class AdminCharacterEligibility(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("name") val `name`: String,
    @SerialName("kind") val `kind`: CharacterKind,
    @SerialName("auto") val `auto`: CharacterEligibilityFacts,
    @SerialName("override") val `override`: CharacterEligibilityFacts?,
    @SerialName("effective") val `effective`: CharacterClassification,
    @SerialName("history") val `history`: List<CharacterEligibilityChange>,
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
data class AdminDailyQuestion(
    @SerialName("questionId") val `questionId`: Id,
    @SerialName("text") val `text`: String,
    @SerialName("tags") val `tags`: List<DailyQuestionTag>,
    @SerialName("listed") val `listed`: Boolean,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
)

@Serializable
data class AdminDeleteUserRequest(
    @SerialName("confirmUsername") val `confirmUsername`: String,
    @SerialName("reason") val `reason`: String,
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
    @SerialName("points") val `points`: Points? = null,
    @SerialName("balanceAfterPoints") val `balanceAfterPoints`: Points? = null,
    @SerialName("usageRecordId") val `usageRecordId`: Id?,
    @SerialName("costMicros") val `costMicros`: Long?,
    @SerialName("priceVersionId") val `priceVersionId`: Id?,
    @SerialName("operatorUserId") val `operatorUserId`: Id?,
    @SerialName("absorbed") val `absorbed`: Boolean,
    @SerialName("safetyOverdraft") val `safetyOverdraft`: Boolean,
)

typealias AdminMediaPurpose = String

@Serializable
data class AdminModel(
    @SerialName("modelKey") val `modelKey`: ModelKey,
    @SerialName("displayName") val `displayName`: String,
    @SerialName("vendorName") val `vendorName`: String,
    @SerialName("upstreamId") val `upstreamId`: Id,
    @SerialName("upstreamModelId") val `upstreamModelId`: String,
    @SerialName("capabilities") val `capabilities`: List<ModelCapability>,
    @SerialName("tags") val `tags`: List<String>,
    @SerialName("leaderboardRank") val `leaderboardRank`: Long?,
    @SerialName("arenaModelName") val `arenaModelName`: String? = null,
    @SerialName("sortOrder") val `sortOrder`: Long,
    @SerialName("defaultFor") val `defaultFor`: List<String>,
    @SerialName("enabled") val `enabled`: Boolean,
    @SerialName("scenarios") val `scenarios`: List<ModelScenario>? = null,
    @SerialName("systemMessageMode") val `systemMessageMode`: SystemMessageMode? = null,
    @SerialName("billingBounds") val `billingBounds`: RouteBillingBounds? = null,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
    @SerialName("deletedAt") val `deletedAt`: Timestamp? = null,
    @SerialName("serviceRates") val `serviceRates`: List<ModelServiceRate>? = null,
    @SerialName("rates") val `rates`: ModelRates?,
    @SerialName("costRates") val `costRates`: ModelRates?,
    @SerialName("hasTimeBands") val `hasTimeBands`: Boolean,
    @SerialName("pointsPerReply") val `pointsPerReply`: Double?,
    @SerialName("routes") val `routes`: List<ModelRoute>? = null,
    @SerialName("displayMultiplierManual") val `displayMultiplierManual`: Double? = null,
    @SerialName("displayMultiplier") val `displayMultiplier`: Double? = null,
    @SerialName("discount") val `discount`: ModelDiscount? = null,
    @SerialName("discountActive") val `discountActive`: Boolean? = null,
    @SerialName("arenaRank") val `arenaRank`: Long? = null,
    @SerialName("availability") val `availability`: AdminModelAvailability? = null,
    @SerialName("usageMissing") val `usageMissing`: List<AdminModelUsageMissingItem>? = null,
)

@Serializable
data class AdminModelWrite(
    @SerialName("modelKey") val `modelKey`: ModelKey,
    @SerialName("displayName") val `displayName`: String,
    @SerialName("vendorName") val `vendorName`: String,
    @SerialName("upstreamId") val `upstreamId`: Id,
    @SerialName("upstreamModelId") val `upstreamModelId`: String,
    @SerialName("capabilities") val `capabilities`: List<ModelCapability>,
    @SerialName("tags") val `tags`: List<String>,
    @SerialName("leaderboardRank") val `leaderboardRank`: Long?,
    @SerialName("arenaModelName") val `arenaModelName`: String? = null,
    @SerialName("sortOrder") val `sortOrder`: Long,
    @SerialName("defaultFor") val `defaultFor`: List<String>,
    @SerialName("enabled") val `enabled`: Boolean,
    @SerialName("scenarios") val `scenarios`: List<ModelScenario>? = null,
    @SerialName("systemMessageMode") val `systemMessageMode`: SystemMessageMode? = null,
    @SerialName("billingBounds") val `billingBounds`: RouteBillingBounds? = null,
    @SerialName("serviceRates") val `serviceRates`: List<ModelServiceRateWrite>? = null,
    @SerialName("rates") val `rates`: ModelRates?,
    @SerialName("costRates") val `costRates`: ModelRates? = null,
    @SerialName("routes") val `routes`: List<ModelRoute>? = null,
    @SerialName("displayMultiplierManual") val `displayMultiplierManual`: Double? = null,
    @SerialName("discount") val `discount`: ModelDiscount? = null,
)

@Serializable
data class AdminModelWriteInput(
    @SerialName("modelKey") val `modelKey`: ModelKey,
    @SerialName("displayName") val `displayName`: String,
    @SerialName("vendorName") val `vendorName`: String,
    @SerialName("upstreamId") val `upstreamId`: Id,
    @SerialName("upstreamModelId") val `upstreamModelId`: String,
    @SerialName("capabilities") val `capabilities`: List<ModelCapability>,
    @SerialName("tags") val `tags`: List<String>,
    @SerialName("leaderboardRank") val `leaderboardRank`: Long?,
    @SerialName("arenaModelName") val `arenaModelName`: String? = null,
    @SerialName("sortOrder") val `sortOrder`: Long,
    @SerialName("defaultFor") val `defaultFor`: List<String>,
    @SerialName("enabled") val `enabled`: Boolean,
    @SerialName("scenarios") val `scenarios`: List<ModelScenario>? = null,
    @SerialName("systemMessageMode") val `systemMessageMode`: SystemMessageMode? = null,
    @SerialName("billingBounds") val `billingBounds`: RouteBillingBoundsInput? = null,
    @SerialName("serviceRates") val `serviceRates`: List<ModelServiceRateWrite>? = null,
    @SerialName("rates") val `rates`: ModelRatesInput?,
    @SerialName("costRates") val `costRates`: ModelRatesInput? = null,
    @SerialName("routes") val `routes`: List<ModelRouteInput>? = null,
    @SerialName("displayMultiplierManual") val `displayMultiplierManual`: Double? = null,
    @SerialName("discount") val `discount`: ModelDiscountInput? = null,
)

@Serializable
data class AdminPlazaOfficialComment(
    @SerialName("commentId") val `commentId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("authorUserId") val `authorUserId`: Id,
    @SerialName("authorNickname") val `authorNickname`: String?,
    @SerialName("text") val `text`: String,
    @SerialName("createdAt") val `createdAt`: Timestamp,
)

@Serializable
data class AdminPlazaReport(
    @SerialName("reportId") val `reportId`: Id,
    @SerialName("reporterUserId") val `reporterUserId`: Id,
    @SerialName("target") val `target`: AdminPlazaReportTarget,
    @SerialName("reason") val `reason`: String,
    @SerialName("note") val `note`: String?,
    @SerialName("status") val `status`: String,
    @SerialName("createdAt") val `createdAt`: Timestamp,
    @SerialName("resolvedAt") val `resolvedAt`: Timestamp?,
)

@Serializable
data class AdminPlazaWork(
    @SerialName("workId") val `workId`: Id,
    @SerialName("kind") val `kind`: String,
    @SerialName("name") val `name`: String,
    @SerialName("tagline") val `tagline`: String,
    @SerialName("basis") val `basis`: String?,
    @SerialName("basedOnPresetId") val `basedOnPresetId`: Id?,
    @SerialName("basedOnPresetName") val `basedOnPresetName`: String?,
    @SerialName("avatarUrl") val `avatarUrl`: String?,
    @SerialName("author") val `author`: PlazaAuthor,
    @SerialName("likeCount") val `likeCount`: Long,
    @SerialName("adoptCount") val `adoptCount`: Long,
    @SerialName("commentCount") val `commentCount`: Long,
    @SerialName("adoptedByMe") val `adoptedByMe`: Boolean,
    @SerialName("likedByMe") val `likedByMe`: Boolean,
    @SerialName("currentVersion") val `currentVersion`: Long,
    @SerialName("publishedAt") val `publishedAt`: Timestamp,
    @SerialName("status") val `status`: String,
    @SerialName("settings") val `settings`: PlazaPublishSettings,
    @SerialName("snapshot") val `snapshot`: PlazaSnapshot,
    @SerialName("versions") val `versions`: List<PlazaVersionNote>,
    @SerialName("remixOf") val `remixOf`: AdminPlazaWorkRemixOf?,
    @SerialName("isMine") val `isMine`: Boolean,
    @SerialName("sourceCharacterId") val `sourceCharacterId`: Id? = null,
    @SerialName("myAdoptedCharacterId") val `myAdoptedCharacterId`: Id? = null,
    @SerialName("removedReason") val `removedReason`: String?,
    @SerialName("unreadCount") val `unreadCount`: Long? = null,
    @SerialName("authorUserId") val `authorUserId`: Id,
    @SerialName("reportCount") val `reportCount`: Long,
)

@Serializable
data class AdminPriceItem(
    @SerialName("modelKey") val `modelKey`: ModelKey,
    @SerialName("unit") val `unit`: PriceUnit,
    @SerialName("priceMicros") val `priceMicros`: Long,
    @SerialName("band") val `band`: PriceTimeBand?,
    @SerialName("points") val `points`: NonNegativePoints? = null,
    @SerialName("costMicros") val `costMicros`: Long,
)

@Serializable
data class AdminPriceItemInput(
    @SerialName("modelKey") val `modelKey`: ModelKey,
    @SerialName("unit") val `unit`: PriceUnit,
    @SerialName("priceMicros") val `priceMicros`: Long,
    @SerialName("band") val `band`: PriceTimeBandInput?,
    @SerialName("points") val `points`: NonNegativePoints? = null,
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
data class AdminRelationWrite(
    @SerialName("characterAId") val `characterAId`: Id,
    @SerialName("characterBId") val `characterBId`: Id,
    @SerialName("type") val `type`: RelationType,
    @SerialName("label") val `label`: String?,
    @SerialName("closeness") val `closeness`: RelationCloseness,
    @SerialName("evidence") val `evidence`: String,
)

@Serializable
data class AdminRelationWriteInput(
    @SerialName("characterAId") val `characterAId`: Id,
    @SerialName("characterBId") val `characterBId`: Id,
    @SerialName("type") val `type`: RelationType,
    @SerialName("label") val `label`: String? = null,
    @SerialName("closeness") val `closeness`: RelationCloseness,
    @SerialName("evidence") val `evidence`: String,
)

@Serializable
data class AdminReleaseNote(
    @SerialName("platform") val `platform`: ReleasePlatform,
    @SerialName("version") val `version`: String,
    @SerialName("versionCode") val `versionCode`: VersionCode,
    @SerialName("title") val `title`: String,
    @SerialName("body") val `body`: String,
    @SerialName("releaseNoteId") val `releaseNoteId`: Id,
    @SerialName("published") val `published`: Boolean,
    @SerialName("publishedAt") val `publishedAt`: Timestamp?,
    @SerialName("createdAt") val `createdAt`: Timestamp,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
)

@Serializable
data class AdminRoleRequest(
    @SerialName("requestId") val `requestId`: Id,
    @SerialName("roleName") val `roleName`: String,
    @SerialName("basis") val `basis`: String?,
    @SerialName("categoryId") val `categoryId`: String?,
    @SerialName("sourceWork") val `sourceWork`: String,
    @SerialName("referenceText") val `referenceText`: String,
    @SerialName("referenceImages") val `referenceImages`: List<RoleRequestImage>,
    @SerialName("note") val `note`: String,
    @SerialName("status") val `status`: String,
    @SerialName("adminMessage") val `adminMessage`: String?,
    @SerialName("characterId") val `characterId`: Id?,
    @SerialName("addedToContacts") val `addedToContacts`: Boolean,
    @SerialName("pointsCost") val `pointsCost`: Long,
    @SerialName("freeQuotaApplied") val `freeQuotaApplied`: Boolean? = null,
    @SerialName("pointsCharged") val `pointsCharged`: Long,
    @SerialName("unseen") val `unseen`: Boolean,
    @SerialName("createdAt") val `createdAt`: Timestamp,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
    @SerialName("userId") val `userId`: Id,
    @SerialName("username") val `username`: String?,
    @SerialName("handledBy") val `handledBy`: Id?,
    @SerialName("history") val `history`: List<AdminRoleRequestHistoryItem>,
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

@Serializable
data class AdminSupportTicket(
    @SerialName("ticketId") val `ticketId`: Id,
    @SerialName("kind") val `kind`: String,
    @SerialName("category") val `category`: String?,
    @SerialName("target") val `target`: AdminSupportTicketTarget?,
    @SerialName("reason") val `reason`: String?,
    @SerialName("text") val `text`: String,
    @SerialName("images") val `images`: List<SupportImage>,
    @SerialName("conversationId") val `conversationId`: Id?,
    @SerialName("characterId") val `characterId`: Id?,
    @SerialName("status") val `status`: String,
    @SerialName("replies") val `replies`: List<SupportReply>,
    @SerialName("unseen") val `unseen`: Boolean,
    @SerialName("createdAt") val `createdAt`: Timestamp,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
    @SerialName("resolvedAt") val `resolvedAt`: Timestamp?,
    @SerialName("userId") val `userId`: Id,
    @SerialName("username") val `username`: String?,
    @SerialName("handledBy") val `handledBy`: Id?,
)

@Serializable
data class AdminTopupEntry(
    @SerialName("entryId") val `entryId`: Id,
    @SerialName("type") val `type`: LedgerEntryType,
    @SerialName("amountMicros") val `amountMicros`: MoneyMicros,
    @SerialName("balanceAfterMicros") val `balanceAfterMicros`: MoneyMicros,
    @SerialName("category") val `category`: String?,
    @SerialName("modelKey") val `modelKey`: ModelKey?,
    @SerialName("characterId") val `characterId`: Id?,
    @SerialName("note") val `note`: String?,
    @SerialName("createdAt") val `createdAt`: Timestamp,
    @SerialName("points") val `points`: Points? = null,
    @SerialName("balanceAfterPoints") val `balanceAfterPoints`: Points? = null,
    @SerialName("usageRecordId") val `usageRecordId`: Id?,
    @SerialName("costMicros") val `costMicros`: Long?,
    @SerialName("priceVersionId") val `priceVersionId`: Id?,
    @SerialName("operatorUserId") val `operatorUserId`: Id?,
    @SerialName("absorbed") val `absorbed`: Boolean,
    @SerialName("safetyOverdraft") val `safetyOverdraft`: Boolean,
    @SerialName("userId") val `userId`: Id,
    @SerialName("username") val `username`: String,
    @SerialName("kind") val `kind`: AdminTopupKind,
)

typealias AdminTopupKind = String

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
data class AdminUsageOverview(
    @SerialName("totals") val `totals`: AdminUsageTotals,
    @SerialName("previousTotals") val `previousTotals`: AdminUsageTotals,
    @SerialName("accounts") val `accounts`: AdminUsageOverviewAccounts,
    @SerialName("recentErrors") val `recentErrors`: List<AdminUsageOverviewRecentErrorsItem>,
)

@Serializable
data class AdminUsageRecord(
    @SerialName("costKnown") val `costKnown`: Boolean? = null,
    @SerialName("uncertainCostMicros") val `uncertainCostMicros`: Long? = null,
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
    @SerialName("cacheWrite5mTokens") val `cacheWrite5mTokens`: Long? = null,
    @SerialName("cacheWrite1hTokens") val `cacheWrite1hTokens`: Long? = null,
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
    @SerialName("chargedPoints") val `chargedPoints`: Double? = null,
    @SerialName("upstreamModelId") val `upstreamModelId`: String? = null,
    @SerialName("stablePrefixTokens") val `stablePrefixTokens`: Long? = null,
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
    @SerialName("unknownCostCalls") val `unknownCostCalls`: Long? = null,
    @SerialName("uncertainCostMicros") val `uncertainCostMicros`: Long? = null,
    @SerialName("calls") val `calls`: Long,
    @SerialName("failedCalls") val `failedCalls`: Long,
    @SerialName("inputTokens") val `inputTokens`: Long,
    @SerialName("cachedInputTokens") val `cachedInputTokens`: Long,
    @SerialName("outputTokens") val `outputTokens`: Long,
    @SerialName("cacheWriteTokens") val `cacheWriteTokens`: Long? = null,
    @SerialName("totalTokens") val `totalTokens`: Long,
    @SerialName("estimatedTokens") val `estimatedTokens`: Long,
    @SerialName("chargedMicros") val `chargedMicros`: Long,
    @SerialName("costMicros") val `costMicros`: Long,
    @SerialName("absorbedCostMicros") val `absorbedCostMicros`: Long,
    @SerialName("chargedPoints") val `chargedPoints`: Double? = null,
    @SerialName("avgLatencyMs") val `avgLatencyMs`: Double? = null,
    @SerialName("failureRate") val `failureRate`: Double? = null,
    @SerialName("cacheHitRate") val `cacheHitRate`: Double? = null,
    @SerialName("stablePrefixRate") val `stablePrefixRate`: Double? = null,
    @SerialName("keys") val `keys`: List<String>,
)

@Serializable
data class AdminUsageTotals(
    @SerialName("unknownCostCalls") val `unknownCostCalls`: Long? = null,
    @SerialName("uncertainCostMicros") val `uncertainCostMicros`: Long? = null,
    @SerialName("calls") val `calls`: Long,
    @SerialName("failedCalls") val `failedCalls`: Long,
    @SerialName("inputTokens") val `inputTokens`: Long,
    @SerialName("cachedInputTokens") val `cachedInputTokens`: Long,
    @SerialName("outputTokens") val `outputTokens`: Long,
    @SerialName("cacheWriteTokens") val `cacheWriteTokens`: Long? = null,
    @SerialName("totalTokens") val `totalTokens`: Long,
    @SerialName("estimatedTokens") val `estimatedTokens`: Long,
    @SerialName("chargedMicros") val `chargedMicros`: Long,
    @SerialName("costMicros") val `costMicros`: Long,
    @SerialName("absorbedCostMicros") val `absorbedCostMicros`: Long,
    @SerialName("chargedPoints") val `chargedPoints`: Double? = null,
    @SerialName("avgLatencyMs") val `avgLatencyMs`: Double? = null,
    @SerialName("failureRate") val `failureRate`: Double? = null,
    @SerialName("cacheHitRate") val `cacheHitRate`: Double? = null,
    @SerialName("stablePrefixRate") val `stablePrefixRate`: Double? = null,
)

@Serializable
data class AdminUserBan(
    @SerialName("bannedAt") val `bannedAt`: Timestamp,
    @SerialName("reason") val `reason`: String,
    @SerialName("operatorUserId") val `operatorUserId`: Id?,
)

@Serializable
data class AdminUserOverview(
    @SerialName("totalUsers") val `totalUsers`: Long,
    @SerialName("proPlusUsers") val `proPlusUsers`: Long,
    @SerialName("expiringSoon") val `expiringSoon`: List<AdminUserOverviewExpiringSoonItem>,
)

@Serializable
data class AdminUserSummary(
    @SerialName("userId") val `userId`: Id,
    @SerialName("username") val `username`: String,
    @SerialName("nickname") val `nickname`: String?,
    @SerialName("role") val `role`: String,
    @SerialName("status") val `status`: String,
    @SerialName("createdAt") val `createdAt`: Timestamp,
    @SerialName("lastActiveAt") val `lastActiveAt`: Timestamp?,
    @SerialName("ban") val `ban`: AdminUserBan?,
    @SerialName("membership") val `membership`: AdminUserSummaryMembership,
)

@Serializable
data class AdminUsersEndpointsBanUserParams(
    @SerialName("userId") val `userId`: Id,
)

@Serializable
data class AdminUsersEndpointsDeleteUserParams(
    @SerialName("userId") val `userId`: Id,
)

@Serializable
data class AdminUsersEndpointsDeleteUserResponse(
    @EncodeDefault
    @SerialName("status") val `status`: String = "deleting",
)

@Serializable
data class AdminUsersEndpointsListUsersResponse(
    @SerialName("items") val `items`: List<AdminUserSummary>,
)

@Serializable
data class AdminUsersEndpointsUnbanUserParams(
    @SerialName("userId") val `userId`: Id,
)

@Serializable
data class AdminVoice(
    @SerialName("voiceId") val `voiceId`: Id,
    @SerialName("name") val `name`: String,
    @SerialName("tags") val `tags`: List<String>,
    @SerialName("sampleMediaId") val `sampleMediaId`: Id?,
    @SerialName("sampleUrl") val `sampleUrl`: String?,
    @SerialName("enabled") val `enabled`: Boolean,
    @SerialName("providerVoiceKey") val `providerVoiceKey`: String,
    @SerialName("modelKey") val `modelKey`: String,
    @SerialName("careFallbackMediaId") val `careFallbackMediaId`: Id?,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
)

@Serializable
data class AdminVoiceWrite(
    @SerialName("name") val `name`: String,
    @SerialName("tags") val `tags`: List<String>,
    @SerialName("sampleMediaId") val `sampleMediaId`: Id?,
    @SerialName("enabled") val `enabled`: Boolean,
    @SerialName("providerVoiceKey") val `providerVoiceKey`: String,
    @SerialName("modelKey") val `modelKey`: String,
    @SerialName("careFallbackMediaId") val `careFallbackMediaId`: Id?,
)

@Serializable
data class AdminVoiceWriteInput(
    @SerialName("name") val `name`: String,
    @SerialName("tags") val `tags`: List<String>,
    @SerialName("sampleMediaId") val `sampleMediaId`: Id?,
    @SerialName("enabled") val `enabled`: Boolean,
    @SerialName("providerVoiceKey") val `providerVoiceKey`: String,
    @SerialName("modelKey") val `modelKey`: String,
    @SerialName("careFallbackMediaId") val `careFallbackMediaId`: Id?,
)

typealias AgeSetting = String

typealias AndroidPushProvider = String

@Serializable
data class Anniversary(
    @SerialName("id") val `id`: Id,
    @SerialName("kind") val `kind`: String,
    @SerialName("label") val `label`: String,
    @SerialName("date") val `date`: LocalDate,
    @SerialName("nextOccurrence") val `nextOccurrence`: LocalDate?,
    @SerialName("repeatYearly") val `repeatYearly`: Boolean,
)

@Serializable
data class Announcement(
    @SerialName("title") val `title`: String,
    @SerialName("body") val `body`: String,
    @SerialName("platforms") val `platforms`: List<ReleasePlatform>,
    @SerialName("startsAt") val `startsAt`: Timestamp?,
    @SerialName("endsAt") val `endsAt`: Timestamp?,
    @SerialName("popup") val `popup`: Boolean,
    @SerialName("pinned") val `pinned`: Boolean,
    @SerialName("announcementId") val `announcementId`: Id,
    @SerialName("publishedAt") val `publishedAt`: Timestamp,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
    @SerialName("readAt") val `readAt`: Timestamp?,
)

@Serializable
data class AnnouncementAdminEndpointsCreateAnnouncementBody(
    @SerialName("title") val `title`: String,
    @SerialName("body") val `body`: String,
    @SerialName("platforms") val `platforms`: List<ReleasePlatform>? = null,
    @SerialName("startsAt") val `startsAt`: Timestamp? = null,
    @SerialName("endsAt") val `endsAt`: Timestamp? = null,
    @SerialName("popup") val `popup`: Boolean? = null,
    @SerialName("pinned") val `pinned`: Boolean? = null,
    @SerialName("publish") val `publish`: Boolean? = null,
)

@Serializable
data class AnnouncementAdminEndpointsDeleteAnnouncementParams(
    @SerialName("announcementId") val `announcementId`: Id,
)

@Serializable
data class AnnouncementAdminEndpointsListAnnouncementsResponse(
    @SerialName("items") val `items`: List<AdminAnnouncement>,
)

@Serializable
data class AnnouncementAdminEndpointsPublishAnnouncementParams(
    @SerialName("announcementId") val `announcementId`: Id,
)

@Serializable
data class AnnouncementAdminEndpointsUpdateAnnouncementBody(
    @SerialName("title") val `title`: String? = null,
    @SerialName("body") val `body`: String? = null,
    @SerialName("platforms") val `platforms`: List<ReleasePlatform>? = null,
    @SerialName("startsAt") val `startsAt`: Timestamp? = null,
    @SerialName("endsAt") val `endsAt`: Timestamp? = null,
    @SerialName("popup") val `popup`: Boolean? = null,
    @SerialName("pinned") val `pinned`: Boolean? = null,
    @SerialName("resetReads") val `resetReads`: Boolean? = null,
)

@Serializable
data class AnnouncementAdminEndpointsUpdateAnnouncementParams(
    @SerialName("announcementId") val `announcementId`: Id,
)

@Serializable
data class AnnouncementAdminEndpointsWithdrawAnnouncementParams(
    @SerialName("announcementId") val `announcementId`: Id,
)

@Serializable
data class AnnouncementEndpointsListAnnouncementsQuery(
    @SerialName("platform") val `platform`: ReleasePlatform,
)

@Serializable
data class AnnouncementEndpointsListAnnouncementsResponse(
    @SerialName("items") val `items`: List<Announcement>,
    @SerialName("unreadCount") val `unreadCount`: Long,
)

@Serializable
data class AnnouncementEndpointsMarkAnnouncementsReadBody(
    @SerialName("announcementIds") val `announcementIds`: List<Id>,
)

typealias AnnouncementStatus = String

@Serializable
data class AnnouncementWrite(
    @SerialName("title") val `title`: String,
    @SerialName("body") val `body`: String,
    @SerialName("platforms") val `platforms`: List<ReleasePlatform>,
    @SerialName("startsAt") val `startsAt`: Timestamp?,
    @SerialName("endsAt") val `endsAt`: Timestamp?,
    @SerialName("popup") val `popup`: Boolean,
    @SerialName("pinned") val `pinned`: Boolean,
)

@Serializable
data class ApiError(
    @SerialName("error") val `error`: ApiErrorError,
)

typealias AppTheme = String

@Serializable
data class AppVersionPolicy(
    @SerialName("platform") val `platform`: ReleasePlatform,
    @SerialName("latestVersion") val `latestVersion`: String?,
    @SerialName("latestVersionCode") val `latestVersionCode`: Long?,
    @SerialName("downloadUrl") val `downloadUrl`: String?,
    @SerialName("minSupportedVersionCode") val `minSupportedVersionCode`: Long?,
    @SerialName("forceUpdateMessage") val `forceUpdateMessage`: String?,
    @SerialName("updatedAt") val `updatedAt`: Timestamp?,
)

@Serializable
data class ApprovePublicUpdateRequest(
    @SerialName("kind") val `kind`: PublicUpdateKind? = null,
    @SerialName("content") val `content`: String? = null,
    @SerialName("startDate") val `startDate`: LocalDate? = null,
    @SerialName("endDate") val `endDate`: LocalDate? = null,
    @SerialName("effectiveDate") val `effectiveDate`: LocalDate? = null,
    @SerialName("sourceUrl") val `sourceUrl`: String? = null,
)

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
data class BanUserRequest(
    @SerialName("reason") val `reason`: String,
)

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
data class BillingAdminEndpointsListTopupsQuery(
    @SerialName("userId") val `userId`: Id? = null,
    @SerialName("kind") val `kind`: AdminTopupKind? = null,
    @SerialName("from") val `from`: Timestamp? = null,
    @SerialName("to") val `to`: Timestamp? = null,
    @SerialName("cursor") val `cursor`: String? = null,
    @SerialName("limit") val `limit`: Long? = null,
)

@Serializable
data class BillingAdminEndpointsListTopupsResponse(
    @SerialName("items") val `items`: List<AdminTopupEntry>,
    @SerialName("nextCursor") val `nextCursor`: String?,
)

@Serializable
data class BillingAdminEndpointsResolveUnknownCostBody(
    @SerialName("costMicros") val `costMicros`: Long,
    @SerialName("evidenceUrl") val `evidenceUrl`: String,
    @SerialName("reason") val `reason`: String,
)

@Serializable
data class BillingAdminEndpointsResolveUnknownCostParams(
    @SerialName("holdId") val `holdId`: Id,
)

@Serializable
data class BillingAdminEndpointsResolveUnknownCostResponse(
    @SerialName("holdId") val `holdId`: Id,
    @SerialName("costMicros") val `costMicros`: Long,
    @SerialName("resolvedAt") val `resolvedAt`: Timestamp,
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
data class BillingDebtSummary(
    @SerialName("count") val `count`: Long,
    @SerialName("totalDebtMicros") val `totalDebtMicros`: Long,
    @SerialName("totalDebtPoints") val `totalDebtPoints`: NonNegativePoints,
    @SerialName("items") val `items`: List<BillingDebtor>,
)

@Serializable
data class BillingDebtor(
    @SerialName("userId") val `userId`: Id,
    @SerialName("username") val `username`: String,
    @SerialName("balanceMicros") val `balanceMicros`: MoneyMicros,
    @SerialName("balancePoints") val `balancePoints`: Points,
    @SerialName("debtMicros") val `debtMicros`: PositiveMoneyMicros,
    @SerialName("debtPoints") val `debtPoints`: NonNegativePoints,
    @SerialName("lastChargeAt") val `lastChargeAt`: Timestamp?,
)

@Serializable
data class BillingEndpointsConsumeEcologyInsufficientNoticeResponse(
    @SerialName("notice") val `notice`: BillingEndpointsConsumeEcologyInsufficientNoticeResponseNotice?,
)

@Serializable
data class BillingEndpointsGetUsageSummaryResponse(
    @SerialName("rows") val `rows`: List<UsageSummaryRow>,
    @SerialName("totalMicros") val `totalMicros`: Long,
    @SerialName("totalPoints") val `totalPoints`: NonNegativePoints? = null,
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
data class CallAvailability(
    @SerialName("available") val `available`: Boolean,
    @SerialName("reason") val `reason`: String?,
)

typealias CallDirection = String

@Serializable
data class CallEndpointsAnswerCallParams(
    @SerialName("callId") val `callId`: Id,
)

@Serializable
data class CallEndpointsGetActiveCallResponse(
    @SerialName("call") val `call`: CallSession?,
)

@Serializable
data class CallEndpointsGetAvailabilityQuery(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class CallEndpointsStartCallBody(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("clientRequestId") val `clientRequestId`: Id,
)

typealias CallOutcome = String

@Serializable
data class CallRecordContent(
    @EncodeDefault
    @SerialName("type") val `type`: String = "call_record",
    @SerialName("callId") val `callId`: Id,
    @SerialName("direction") val `direction`: CallDirection,
    @SerialName("outcome") val `outcome`: String,
    @SerialName("durationSec") val `durationSec`: Long,
)

@Serializable
data class CallSession(
    @SerialName("callId") val `callId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("direction") val `direction`: CallDirection,
    @SerialName("state") val `state`: String,
    @SerialName("outcome") val `outcome`: String?,
    @SerialName("createdAt") val `createdAt`: Timestamp,
    @SerialName("answeredAt") val `answeredAt`: Timestamp?,
    @SerialName("endedAt") val `endedAt`: Timestamp?,
    @SerialName("durationSec") val `durationSec`: Long,
    @SerialName("stream") val `stream`: CallStreamTicket?,
)

typealias CallState = String

@Serializable(with = CallStreamClientFrameSerializer::class)
sealed interface CallStreamClientFrame {
    val `type`: String
}

@Serializable
data class CallStreamClientFrameHello(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "hello",
    @SerialName("data") val `data`: CallStreamClientFrameHelloData,
) : CallStreamClientFrame

@Serializable
data class CallStreamClientFrameBargeIn(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "barge_in",
    @SerialName("data") val `data`: CallStreamClientFrameBargeInData,
) : CallStreamClientFrame

@Serializable
data class CallStreamClientFrameMute(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "mute",
    @SerialName("data") val `data`: CallStreamClientFrameMuteData,
) : CallStreamClientFrame

@Serializable
data class CallStreamClientFramePing(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "ping",
    @SerialName("data") val `data`: CallStreamClientFramePingData,
) : CallStreamClientFrame

object CallStreamClientFrameSerializer : KSerializer<CallStreamClientFrame> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("CallStreamClientFrame")
    override fun deserialize(decoder: Decoder): CallStreamClientFrame {
        val input = decoder as JsonDecoder
        var value = input.decodeJsonElement().jsonObject
        val tag = value["type"]?.jsonPrimitive?.content
        return when (tag) {
            "hello" -> input.json.decodeFromJsonElement(CallStreamClientFrameHello.serializer(), value)
            "barge_in" -> input.json.decodeFromJsonElement(CallStreamClientFrameBargeIn.serializer(), value)
            "mute" -> input.json.decodeFromJsonElement(CallStreamClientFrameMute.serializer(), value)
            "ping" -> input.json.decodeFromJsonElement(CallStreamClientFramePing.serializer(), value)
            else -> throw SerializationException("Unknown discriminator")
        }
    }
    override fun serialize(encoder: Encoder, value: CallStreamClientFrame) {
        val output = encoder as JsonEncoder
        val element = when (value) {
            is CallStreamClientFrameHello -> output.json.encodeToJsonElement(CallStreamClientFrameHello.serializer(), value)
            is CallStreamClientFrameBargeIn -> output.json.encodeToJsonElement(CallStreamClientFrameBargeIn.serializer(), value)
            is CallStreamClientFrameMute -> output.json.encodeToJsonElement(CallStreamClientFrameMute.serializer(), value)
            is CallStreamClientFramePing -> output.json.encodeToJsonElement(CallStreamClientFramePing.serializer(), value)
        }
        output.encodeJsonElement(element)
    }
}

@Serializable(with = CallStreamServerFrameSerializer::class)
sealed interface CallStreamServerFrame {
    val `type`: String
}

@Serializable
data class CallStreamServerFrameCallReady(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "call.ready",
    @SerialName("data") val `data`: CallStreamServerFrameCallReadyData,
) : CallStreamServerFrame

@Serializable
data class CallStreamServerFrameCallState(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "call.state",
    @SerialName("data") val `data`: CallStreamServerFrameCallStateData,
) : CallStreamServerFrame

@Serializable
data class CallStreamServerFrameCallAgentSpeaking(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "call.agent_speaking",
    @SerialName("data") val `data`: CallStreamServerFrameCallAgentSpeakingData,
) : CallStreamServerFrame

@Serializable
data class CallStreamServerFrameCallEnding(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "call.ending",
    @SerialName("data") val `data`: CallStreamServerFrameCallEndingData,
) : CallStreamServerFrame

@Serializable
data class CallStreamServerFrameCallError(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "call.error",
    @SerialName("data") val `data`: CallStreamServerFrameCallErrorData,
) : CallStreamServerFrame

@Serializable
data class CallStreamServerFramePong(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "pong",
    @SerialName("data") val `data`: CallStreamServerFramePongData,
) : CallStreamServerFrame

object CallStreamServerFrameSerializer : KSerializer<CallStreamServerFrame> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("CallStreamServerFrame")
    override fun deserialize(decoder: Decoder): CallStreamServerFrame {
        val input = decoder as JsonDecoder
        var value = input.decodeJsonElement().jsonObject
        val tag = value["type"]?.jsonPrimitive?.content
        return when (tag) {
            "call.ready" -> input.json.decodeFromJsonElement(CallStreamServerFrameCallReady.serializer(), value)
            "call.state" -> input.json.decodeFromJsonElement(CallStreamServerFrameCallState.serializer(), value)
            "call.agent_speaking" -> input.json.decodeFromJsonElement(CallStreamServerFrameCallAgentSpeaking.serializer(), value)
            "call.ending" -> input.json.decodeFromJsonElement(CallStreamServerFrameCallEnding.serializer(), value)
            "call.error" -> input.json.decodeFromJsonElement(CallStreamServerFrameCallError.serializer(), value)
            "pong" -> input.json.decodeFromJsonElement(CallStreamServerFramePong.serializer(), value)
            else -> throw SerializationException("Unknown discriminator")
        }
    }
    override fun serialize(encoder: Encoder, value: CallStreamServerFrame) {
        val output = encoder as JsonEncoder
        val element = when (value) {
            is CallStreamServerFrameCallReady -> output.json.encodeToJsonElement(CallStreamServerFrameCallReady.serializer(), value)
            is CallStreamServerFrameCallState -> output.json.encodeToJsonElement(CallStreamServerFrameCallState.serializer(), value)
            is CallStreamServerFrameCallAgentSpeaking -> output.json.encodeToJsonElement(CallStreamServerFrameCallAgentSpeaking.serializer(), value)
            is CallStreamServerFrameCallEnding -> output.json.encodeToJsonElement(CallStreamServerFrameCallEnding.serializer(), value)
            is CallStreamServerFrameCallError -> output.json.encodeToJsonElement(CallStreamServerFrameCallError.serializer(), value)
            is CallStreamServerFramePong -> output.json.encodeToJsonElement(CallStreamServerFramePong.serializer(), value)
        }
        output.encodeJsonElement(element)
    }
}

@Serializable
data class CallStreamTicket(
    @SerialName("path") val `path`: String,
    @SerialName("token") val `token`: String,
    @SerialName("expiresAt") val `expiresAt`: Timestamp,
)

typealias CallUnavailableReason = String

@Serializable
data class CardAdmin(
    @SerialName("creatorNotes") val `creatorNotes`: String? = null,
    @SerialName("sourceList") val `sourceList`: List<CardAdminSourceListItem>? = null,
    @SerialName("creationMethod") val `creationMethod`: String,
    @SerialName("importSource") val `importSource`: CardAdminImportSource? = null,
    @SerialName("extensions") val `extensions`: Map<String, SharedSchema0>? = null,
)

@Serializable
data class CardAlbum(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("obtained") val `obtained`: List<GrowthCard>,
    @SerialName("locked") val `locked`: List<LockedCard>,
)

@Serializable
data class CardAlbumSummary(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("obtainedCount") val `obtainedCount`: Long,
    @SerialName("latestObtainedOn") val `latestObtainedOn`: LocalDate?,
)

@Serializable
data class CardExample(
    @SerialName("id") val `id`: String,
    @SerialName("scene") val `scene`: String,
    @SerialName("turns") val `turns`: List<CardExampleTurnsItem>,
)

typealias CardKind = String

@Serializable
data class CardKnowledge(
    @SerialName("entries") val `entries`: List<CardKnowledgeEntry>,
    @SerialName("unknownPolicy") val `unknownPolicy`: String,
    @SerialName("scanDepth") val `scanDepth`: Long? = null,
    @SerialName("constantBudget") val `constantBudget`: Long? = null,
    @SerialName("triggeredBudget") val `triggeredBudget`: Long? = null,
    @SerialName("recursive") val `recursive`: Boolean? = null,
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
    @SerialName("preventRecursion") val `preventRecursion`: Boolean? = null,
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
    @SerialName("weibo") val `weibo`: CardProfileExtraWeibo? = null,
    @SerialName("occupation") val `occupation`: String,
    @SerialName("gender") val `gender`: String? = null,
    @SerialName("ageDisplay") val `ageDisplay`: String? = null,
    @SerialName("workSource") val `workSource`: String? = null,
    @SerialName("fanNameUsage") val `fanNameUsage`: String? = null,
    @SerialName("worksDetail") val `worksDetail`: List<CardProfileExtraWorksDetailItem>? = null,
    @SerialName("searchKeywords") val `searchKeywords`: List<String>? = null,
)

@Serializable
data class CardPrompting(
    @SerialName("systemNote") val `systemNote`: String? = null,
    @SerialName("postHistoryInstructions") val `postHistoryInstructions`: String? = null,
    @SerialName("characterNote") val `characterNote`: CardPromptingCharacterNote? = null,
    @SerialName("exampleMode") val `exampleMode`: String? = null,
    @SerialName("exampleCount") val `exampleCount`: Long? = null,
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
data class CardTemplate(
    @SerialName("templateId") val `templateId`: Id,
    @SerialName("name") val `name`: String,
    @SerialName("kinds") val `kinds`: List<CardTemplateKind>,
    @SerialName("mediaId") val `mediaId`: Id,
    @SerialName("url") val `url`: String,
    @SerialName("portraitFree") val `portraitFree`: Boolean,
    @SerialName("classicalStyle") val `classicalStyle`: Boolean? = null,
    @SerialName("enabled") val `enabled`: Boolean,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
)

@Serializable
data class CardTemplateAdminEndpointsListTemplatesResponse(
    @SerialName("items") val `items`: List<CardTemplate>,
)

@Serializable
data class CardTemplateAdminEndpointsUpdateTemplateBody(
    @SerialName("name") val `name`: String? = null,
    @SerialName("kinds") val `kinds`: List<CardTemplateKind>? = null,
    @SerialName("mediaId") val `mediaId`: Id? = null,
    @SerialName("portraitFree") val `portraitFree`: Boolean? = null,
    @SerialName("classicalStyle") val `classicalStyle`: Boolean? = null,
    @SerialName("enabled") val `enabled`: Boolean? = null,
)

@Serializable
data class CardTemplateAdminEndpointsUpdateTemplateParams(
    @SerialName("templateId") val `templateId`: Id,
)

typealias CardTemplateKind = String

@Serializable
data class CardTemplateWrite(
    @SerialName("name") val `name`: String,
    @SerialName("kinds") val `kinds`: List<CardTemplateKind>,
    @SerialName("mediaId") val `mediaId`: Id,
    @SerialName("portraitFree") val `portraitFree`: Boolean,
    @SerialName("classicalStyle") val `classicalStyle`: Boolean? = null,
    @SerialName("enabled") val `enabled`: Boolean,
)

@Serializable
data class CardTemplateWriteInput(
    @SerialName("name") val `name`: String,
    @SerialName("kinds") val `kinds`: List<CardTemplateKind>,
    @SerialName("mediaId") val `mediaId`: Id,
    @SerialName("portraitFree") val `portraitFree`: Boolean,
    @SerialName("classicalStyle") val `classicalStyle`: Boolean? = null,
    @SerialName("enabled") val `enabled`: Boolean,
)

@Serializable
data class CharacterAdminEndpointsGetEligibilityParams(
    @SerialName("characterId") val `characterId`: Id,
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
data class CharacterAdminEndpointsSetEligibilityParams(
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
data class CharacterEligibilityChange(
    @SerialName("at") val `at`: Timestamp,
    @SerialName("operatorUserId") val `operatorUserId`: Id?,
    @SerialName("operatorName") val `operatorName`: String,
    @SerialName("reason") val `reason`: String,
    @SerialName("before") val `before`: CharacterEligibilityFacts?,
    @SerialName("after") val `after`: CharacterEligibilityFacts?,
)

@Serializable
data class CharacterEligibilityFacts(
    @SerialName("basis") val `basis`: CharacterBasis,
    @SerialName("realPersonKind") val `realPersonKind`: RealPersonKind?,
    @SerialName("ageSetting") val `ageSetting`: AgeSetting,
    @SerialName("childAppearance") val `childAppearance`: Boolean,
    @SerialName("childFeaturesDetected") val `childFeaturesDetected`: Boolean,
)

@Serializable
data class CharacterEligibilityFactsInput(
    @SerialName("basis") val `basis`: CharacterBasis,
    @SerialName("realPersonKind") val `realPersonKind`: RealPersonKind?,
    @SerialName("ageSetting") val `ageSetting`: AgeSetting,
    @SerialName("childAppearance") val `childAppearance`: Boolean,
    @SerialName("childFeaturesDetected") val `childFeaturesDetected`: Boolean,
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
data class CharacterRelation(
    @SerialName("relationId") val `relationId`: Id,
    @SerialName("characterAId") val `characterAId`: Id,
    @SerialName("characterBId") val `characterBId`: Id,
    @SerialName("type") val `type`: RelationType,
    @SerialName("label") val `label`: String?,
    @SerialName("closeness") val `closeness`: RelationCloseness,
    @SerialName("evidence") val `evidence`: String?,
    @SerialName("ownerUserId") val `ownerUserId`: Id?,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
)

@Serializable
data class CharacterScenarioConfig(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("scenarios") val `scenarios`: List<CharacterScenarioConfigScenariosItem>,
)

@Serializable
data class CharacterSearchCandidate(
    @SerialName("name") val `name`: String,
    @SerialName("title") val `title`: String,
    @SerialName("description") val `description`: String,
    @SerialName("sourceUrl") val `sourceUrl`: String,
)

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
data class CharacterSupplementEndpointsDeleteSupplementParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class CharacterSupplementEndpointsGetSupplementParams(
    @SerialName("characterId") val `characterId`: Id,
)

typealias CharacterSupplementEndpointsGetSupplementResponse = UserSupplement?

@Serializable
data class CharacterSupplementEndpointsPutSupplementBody(
    @SerialName("text") val `text`: String,
)

@Serializable
data class CharacterSupplementEndpointsPutSupplementParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class ChargedMessage(
    @SerialName("usageRecordId") val `usageRecordId`: Id,
    @SerialName("messageId") val `messageId`: Id,
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("excerpt") val `excerpt`: String,
    @SerialName("pointsCost") val `pointsCost`: Double,
    @SerialName("createdAt") val `createdAt`: Timestamp,
)

@Serializable
data class ChatActionEndpointsChooseMessageActionBody(
    @SerialName("actionId") val `actionId`: String,
)

@Serializable
data class ChatActionEndpointsChooseMessageActionParams(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("messageId") val `messageId`: Id,
)

@Serializable
data class ChatEndpointsListChargedMessagesBody(
    @SerialName("usageRecordIds") val `usageRecordIds`: List<Id>,
)

@Serializable
data class ChatEndpointsListChargedMessagesResponse(
    @SerialName("items") val `items`: List<ChargedMessage>,
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
data class ChatGroupEndpointsAddMembersBody(
    @SerialName("characterIds") val `characterIds`: List<Id>,
)

@Serializable
data class ChatGroupEndpointsRemoveMemberParams(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class ChatGroupEndpointsRenameGroupBody(
    @SerialName("title") val `title`: String?,
)

@Serializable
data class ChatGroupEndpointsUpdateAvatarBody(
    @SerialName("mediaId") val `mediaId`: Id?,
)

@Serializable
data class ChatSearchEndpointsListByTypeParams(
    @SerialName("conversationId") val `conversationId`: Id,
)

@Serializable
data class ChatSearchEndpointsListByTypeQuery(
    @SerialName("contentType") val `contentType`: String? = null,
    @SerialName("senderParticipantId") val `senderParticipantId`: Id? = null,
    @SerialName("beforeSeq") val `beforeSeq`: Long? = null,
    @SerialName("limit") val `limit`: Long? = null,
)

@Serializable
data class ChatSearchEndpointsListByTypeResponse(
    @SerialName("items") val `items`: List<Message>,
    @SerialName("hasMore") val `hasMore`: Boolean,
)

@Serializable
data class ChatSearchEndpointsLocateByDateParams(
    @SerialName("conversationId") val `conversationId`: Id,
)

@Serializable
data class ChatSearchEndpointsLocateByDateQuery(
    @SerialName("date") val `date`: LocalDate,
)

@Serializable
data class ChatSearchEndpointsLocateByDateResponse(
    @SerialName("seq") val `seq`: Seq?,
)

@Serializable
data class ChatSearchEndpointsSearchAllQuery(
    @SerialName("q") val `q`: SearchKeyword,
)

@Serializable
data class ChatSearchEndpointsSearchConversationParams(
    @SerialName("conversationId") val `conversationId`: Id,
)

@Serializable
data class ChatSearchEndpointsSearchConversationQuery(
    @SerialName("q") val `q`: SearchKeyword,
    @SerialName("beforeSeq") val `beforeSeq`: Long? = null,
    @SerialName("senderParticipantId") val `senderParticipantId`: Id? = null,
    @SerialName("limit") val `limit`: Long? = null,
)

@Serializable
data class ChatSearchEndpointsSearchConversationResponse(
    @SerialName("items") val `items`: List<MessageSearchHit>,
    @SerialName("hasMore") val `hasMore`: Boolean,
)

@Serializable
data class ChatWindowLimits(
    @SerialName("keepTurns") val `keepTurns`: Long,
    @SerialName("triggerTurns") val `triggerTurns`: Long,
    @SerialName("maxTurns") val `maxTurns`: Long,
    @SerialName("triggerChars") val `triggerChars`: Long,
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

@Serializable
data class ClientLogAdminEndpointsGetParams(
    @SerialName("fingerprint") val `fingerprint`: String,
)

@Serializable
data class ClientLogAdminEndpointsGetResponse(
    @SerialName("issue") val `issue`: ClientLogIssue,
    @SerialName("samples") val `samples`: List<ClientLogSample>,
    @SerialName("days") val `days`: List<ClientLogAdminEndpointsGetResponseDaysItem>,
    @SerialName("users") val `users`: List<ClientLogAdminEndpointsGetResponseUsersItem>,
)

@Serializable
data class ClientLogAdminEndpointsListResponse(
    @SerialName("items") val `items`: List<ClientLogIssue>,
    @SerialName("nextCursor") val `nextCursor`: String?,
    @SerialName("todayIssues") val `todayIssues`: Long,
    @SerialName("versions") val `versions`: List<ClientLogAdminEndpointsListResponseVersionsItem>,
)

@Serializable
data class ClientLogAdminEndpointsTicketParams(
    @SerialName("ticketId") val `ticketId`: Id,
)

@Serializable
data class ClientLogAdminEndpointsTicketResponse(
    @SerialName("items") val `items`: List<ClientRuntimeEvent>,
)

@Serializable
data class ClientLogAdminEndpointsUpdateBody(
    @SerialName("status") val `status`: ClientLogStatus,
    @SerialName("note") val `note`: String,
)

@Serializable
data class ClientLogAdminEndpointsUserParams(
    @SerialName("userId") val `userId`: Id,
)

@Serializable
data class ClientLogAdminEndpointsUserResponse(
    @SerialName("items") val `items`: List<ClientLogSample>,
)

typealias ClientLogApp = String

@Serializable
data class ClientLogBatch(
    @SerialName("sessionId") val `sessionId`: Id,
    @SerialName("appKind") val `appKind`: ClientLogApp,
    @SerialName("version") val `version`: ClientLogVersion,
    @SerialName("build") val `build`: ClientLogBuild,
    @SerialName("events") val `events`: List<ClientRuntimeEvent>,
)

typealias ClientLogBuild = String

typealias ClientLogCode = String

@Serializable
data class ClientLogEndpointsReportAnonymousResponse(
    @EncodeDefault
    @SerialName("accepted") val `accepted`: Boolean = true,
)

@Serializable
data class ClientLogEnvironment(
    @SerialName("os") val `os`: String,
    @SerialName("browser") val `browser`: String,
    @SerialName("major") val `major`: Long,
    @SerialName("screen") val `screen`: String,
    @SerialName("language") val `language`: String,
    @SerialName("network") val `network`: String,
)

@Serializable
data class ClientLogFrame(
    @SerialName("file") val `file`: String,
    @SerialName("line") val `line`: Long,
    @SerialName("column") val `column`: Long,
    @SerialName("asset") val `asset`: String? = null,
)

@Serializable
data class ClientLogIssue(
    @SerialName("fingerprint") val `fingerprint`: String,
    @SerialName("kind") val `kind`: ClientLogKind,
    @SerialName("appKind") val `appKind`: ClientLogApp,
    @SerialName("title") val `title`: String,
    @SerialName("firstSeenAt") val `firstSeenAt`: Timestamp,
    @SerialName("lastSeenAt") val `lastSeenAt`: Timestamp,
    @SerialName("totalCount") val `totalCount`: Long,
    @SerialName("affectedUsers") val `affectedUsers`: Long,
    @SerialName("firstVersion") val `firstVersion`: ClientLogVersion,
    @SerialName("lastVersion") val `lastVersion`: ClientLogVersion,
    @SerialName("status") val `status`: ClientLogStatus,
    @SerialName("note") val `note`: String,
)

typealias ClientLogKind = String

@Serializable
data class ClientLogListQuery(
    @SerialName("appKind") val `appKind`: ClientLogApp? = null,
    @SerialName("kind") val `kind`: ClientLogKind? = null,
    @SerialName("status") val `status`: ClientLogStatus? = null,
    @SerialName("version") val `version`: ClientLogVersion? = null,
    @SerialName("since") val `since`: Timestamp? = null,
    @SerialName("until") val `until`: Timestamp? = null,
    @SerialName("cursor") val `cursor`: String? = null,
    @SerialName("limit") val `limit`: Long,
)

@Serializable
data class ClientLogListQueryInput(
    @SerialName("appKind") val `appKind`: ClientLogApp? = null,
    @SerialName("kind") val `kind`: ClientLogKind? = null,
    @SerialName("status") val `status`: ClientLogStatus? = null,
    @SerialName("version") val `version`: ClientLogVersion? = null,
    @SerialName("since") val `since`: Timestamp? = null,
    @SerialName("until") val `until`: Timestamp? = null,
    @SerialName("cursor") val `cursor`: String? = null,
    @SerialName("limit") val `limit`: Long? = null,
)

typealias ClientLogRoute = String

@Serializable
data class ClientLogSample(
    @SerialName("id") val `id`: Id,
    @SerialName("userId") val `userId`: Id?,
    @SerialName("receivedAt") val `receivedAt`: Timestamp,
    @SerialName("event") val `event`: ClientRuntimeEvent,
)

typealias ClientLogStatus = String

typealias ClientLogVersion = String

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
data class ClientRuntimeEvent(
    @SerialName("clientEventId") val `clientEventId`: Id,
    @SerialName("sessionId") val `sessionId`: Id,
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("kind") val `kind`: ClientLogKind,
    @SerialName("appKind") val `appKind`: ClientLogApp,
    @SerialName("version") val `version`: ClientLogVersion,
    @SerialName("build") val `build`: ClientLogBuild,
    @SerialName("page") val `page`: ClientLogRoute,
    @SerialName("code") val `code`: ClientLogCode,
    @SerialName("frames") val `frames`: List<ClientLogFrame>,
    @SerialName("environment") val `environment`: ClientLogEnvironment,
    @SerialName("count") val `count`: Long,
    @SerialName("components") val `components`: List<String>? = null,
    @SerialName("api") val `api`: ClientRuntimeEventApi? = null,
    @SerialName("reconnects") val `reconnects`: Long? = null,
    @SerialName("offlineSeconds") val `offlineSeconds`: Long? = null,
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
data class ClientVersionQuery(
    @SerialName("platform") val `platform`: ReleasePlatform,
    @SerialName("versionCode") val `versionCode`: VersionCode,
)

@Serializable
data class ClientVersionQueryInput(
    @SerialName("platform") val `platform`: ReleasePlatform,
    @SerialName("versionCode") val `versionCode`: VersionCode,
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
    @SerialName("voiceId") val `voiceId`: Id? = null,
    @SerialName("longContext") val `longContext`: Boolean? = null,
)

@Serializable
data class CompanionEndpointsListModesParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class CompanionEndpointsListModesResponse(
    @SerialName("items") val `items`: List<ScenarioModeOption>,
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
    @SerialName("voiceId") val `voiceId`: Id? = null,
    @SerialName("longContext") val `longContext`: Boolean? = null,
)

typealias ComplaintReason = String

typealias ComplaintTargetType = String

@Serializable
data class ConfirmPublishRequest(
    @SerialName("draftId") val `draftId`: Id,
    @SerialName("settings") val `settings`: PlazaPublishSettings,
    @SerialName("keptSpanIds") val `keptSpanIds`: List<String>,
    @SerialName("avatarRightsConfirmed") val `avatarRightsConfirmed`: Boolean,
    @SerialName("changeNote") val `changeNote`: String? = null,
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

@Serializable
data class ContactCardContent(
    @EncodeDefault
    @SerialName("type") val `type`: String = "contact_card",
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("name") val `name`: String,
    @SerialName("recommenderCharacterId") val `recommenderCharacterId`: Id,
)

@Serializable
data class ContactCardEndpointsDismissRecommendationParams(
    @SerialName("characterId") val `characterId`: Id,
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
    @SerialName("group") val `group`: ConversationGroup? = null,
)

@Serializable
data class ConversationParams(
    @SerialName("conversationId") val `conversationId`: Id,
)

@Serializable
data class ConversationParamsInput(
    @SerialName("conversationId") val `conversationId`: Id,
)

typealias ConversationRemovedReason = String

@Serializable
data class ConversationSearchGroup(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("matchCount") val `matchCount`: Long,
    @SerialName("latestHit") val `latestHit`: MessageSearchHit,
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
data class CreateDailyEventRequest(
    @SerialName("eventId") val `eventId`: Id,
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("eventDate") val `eventDate`: LocalDate,
    @SerialName("eventTime") val `eventTime`: String? = null,
    @SerialName("summary") val `summary`: String,
    @SerialName("withCharacterId") val `withCharacterId`: Id? = null,
    @SerialName("moodEffect") val `moodEffect`: String? = null,
    @SerialName("source") val `source`: DailyEventSource,
)

@Serializable
data class CreateGroupRequest(
    @SerialName("clientRequestId") val `clientRequestId`: Id,
    @SerialName("characterIds") val `characterIds`: List<Id>,
    @SerialName("title") val `title`: String? = null,
)

@Serializable
data class CreateGroupRequestInput(
    @SerialName("clientRequestId") val `clientRequestId`: Id,
    @SerialName("characterIds") val `characterIds`: List<Id>,
    @SerialName("title") val `title`: String? = null,
)

@Serializable
data class CreateHolidayRequest(
    @SerialName("name") val `name`: String,
    @SerialName("dateType") val `dateType`: HolidayDateType,
    @SerialName("dateValue") val `dateValue`: String,
    @SerialName("romantic") val `romantic`: Boolean,
    @SerialName("category") val `category`: HolidayCategory? = null,
    @SerialName("sendCard") val `sendCard`: Boolean? = null,
    @SerialName("cardTemplateId") val `cardTemplateId`: Id? = null,
    @SerialName("characterCategories") val `characterCategories`: List<HolidayCharacterCategory>? = null,
)

@Serializable
data class CreateHolidayRequestInput(
    @SerialName("name") val `name`: String,
    @SerialName("dateType") val `dateType`: HolidayDateType,
    @SerialName("dateValue") val `dateValue`: String,
    @SerialName("romantic") val `romantic`: Boolean? = null,
    @SerialName("category") val `category`: HolidayCategory? = null,
    @SerialName("sendCard") val `sendCard`: Boolean? = null,
    @SerialName("cardTemplateId") val `cardTemplateId`: Id? = null,
    @SerialName("characterCategories") val `characterCategories`: List<HolidayCharacterCategory>? = null,
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
data class CreateMembershipOrder(
    @SerialName("clientOrderId") val `clientOrderId`: Id,
    @SerialName("userId") val `userId`: Id,
    @SerialName("planId") val `planId`: MembershipPlanId,
    @SerialName("useFirstPrice") val `useFirstPrice`: Boolean? = null,
    @SerialName("note") val `note`: String? = null,
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
data class CreateMomentsPostRequest(
    @SerialName("clientRequestId") val `clientRequestId`: Id,
    @SerialName("text") val `text`: String,
    @SerialName("imageMediaIds") val `imageMediaIds`: List<Id>,
    @SerialName("visibility") val `visibility`: MomentsVisibility,
)

@Serializable
data class CreateMomentsPostRequestInput(
    @SerialName("clientRequestId") val `clientRequestId`: Id,
    @SerialName("text") val `text`: String,
    @SerialName("imageMediaIds") val `imageMediaIds`: List<Id>,
    @SerialName("visibility") val `visibility`: MomentsVisibilityInput,
)

@Serializable
data class CreatePublicUpdateRequest(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("kind") val `kind`: PublicUpdateKind,
    @SerialName("content") val `content`: String,
    @SerialName("startDate") val `startDate`: LocalDate,
    @SerialName("endDate") val `endDate`: LocalDate?,
    @SerialName("effectiveDate") val `effectiveDate`: LocalDate,
    @SerialName("sourceUrl") val `sourceUrl`: String,
    @SerialName("status") val `status`: String,
)

@Serializable
data class CreatePublicUpdateRequestInput(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("kind") val `kind`: PublicUpdateKind? = null,
    @SerialName("content") val `content`: String,
    @SerialName("startDate") val `startDate`: LocalDate,
    @SerialName("endDate") val `endDate`: LocalDate? = null,
    @SerialName("effectiveDate") val `effectiveDate`: LocalDate,
    @SerialName("sourceUrl") val `sourceUrl`: String,
    @SerialName("status") val `status`: String? = null,
)

@Serializable
data class CreateRoleRequest(
    @SerialName("clientRequestId") val `clientRequestId`: Id,
    @SerialName("expectedPointsCost") val `expectedPointsCost`: Long? = null,
    @SerialName("roleName") val `roleName`: String,
    @SerialName("basis") val `basis`: CharacterBasis? = null,
    @SerialName("categoryId") val `categoryId`: String? = null,
    @SerialName("sourceWork") val `sourceWork`: String? = null,
    @SerialName("referenceText") val `referenceText`: String? = null,
    @SerialName("referenceImageIds") val `referenceImageIds`: List<Id>? = null,
    @SerialName("note") val `note`: String? = null,
)

@Serializable
data class CreateRoleRequestInput(
    @SerialName("clientRequestId") val `clientRequestId`: Id,
    @SerialName("expectedPointsCost") val `expectedPointsCost`: Long? = null,
    @SerialName("roleName") val `roleName`: String,
    @SerialName("basis") val `basis`: CharacterBasis? = null,
    @SerialName("categoryId") val `categoryId`: String? = null,
    @SerialName("sourceWork") val `sourceWork`: String? = null,
    @SerialName("referenceText") val `referenceText`: String? = null,
    @SerialName("referenceImageIds") val `referenceImageIds`: List<Id>? = null,
    @SerialName("note") val `note`: String? = null,
)

@Serializable
data class CreateSupportTicket(
    @SerialName("runtimeEvents") val `runtimeEvents`: List<ClientRuntimeEvent>? = null,
    @SerialName("clientRequestId") val `clientRequestId`: Id,
    @SerialName("kind") val `kind`: SupportTicketKind,
    @SerialName("category") val `category`: FeedbackCategory? = null,
    @SerialName("target") val `target`: CreateSupportTicketTarget? = null,
    @SerialName("reason") val `reason`: ComplaintReason? = null,
    @SerialName("text") val `text`: String,
    @SerialName("imageIds") val `imageIds`: List<Id>? = null,
    @SerialName("conversationId") val `conversationId`: Id? = null,
    @SerialName("characterId") val `characterId`: Id? = null,
)

@Serializable
data class CreateSupportTicketInput(
    @SerialName("runtimeEvents") val `runtimeEvents`: List<ClientRuntimeEvent>? = null,
    @SerialName("clientRequestId") val `clientRequestId`: Id,
    @SerialName("kind") val `kind`: SupportTicketKind,
    @SerialName("category") val `category`: FeedbackCategory? = null,
    @SerialName("target") val `target`: CreateSupportTicketInputTarget? = null,
    @SerialName("reason") val `reason`: ComplaintReason? = null,
    @SerialName("text") val `text`: String? = null,
    @SerialName("imageIds") val `imageIds`: List<Id>? = null,
    @SerialName("conversationId") val `conversationId`: Id? = null,
    @SerialName("characterId") val `characterId`: Id? = null,
)

@Serializable
data class CreateUpstreamRequest(
    @SerialName("name") val `name`: String,
    @SerialName("kind") val `kind`: UpstreamKind,
    @SerialName("baseUrl") val `baseUrl`: String,
    @SerialName("apiKey") val `apiKey`: String,
    @SerialName("provider") val `provider`: String? = null,
    @SerialName("priority") val `priority`: Long? = null,
    @SerialName("weight") val `weight`: Long? = null,
    @SerialName("maxConcurrency") val `maxConcurrency`: Long? = null,
    @SerialName("rpmLimit") val `rpmLimit`: Long? = null,
    @SerialName("enabled") val `enabled`: Boolean? = null,
    @SerialName("note") val `note`: String? = null,
    @SerialName("saveOnTestFailure") val `saveOnTestFailure`: Boolean? = null,
)

@Serializable
data class CreateUpstreamRequestInput(
    @SerialName("name") val `name`: String,
    @SerialName("kind") val `kind`: UpstreamKind,
    @SerialName("baseUrl") val `baseUrl`: String,
    @SerialName("apiKey") val `apiKey`: String,
    @SerialName("provider") val `provider`: String? = null,
    @SerialName("priority") val `priority`: Long? = null,
    @SerialName("weight") val `weight`: Long? = null,
    @SerialName("maxConcurrency") val `maxConcurrency`: Long? = null,
    @SerialName("rpmLimit") val `rpmLimit`: Long? = null,
    @SerialName("enabled") val `enabled`: Boolean? = null,
    @SerialName("note") val `note`: String? = null,
    @SerialName("saveOnTestFailure") val `saveOnTestFailure`: Boolean? = null,
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

typealias CustomCharacterOrigin = JsonElement

@Serializable
data class CustomCharacterOriginEndpointsGetOriginParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class CustomCharacterOriginEndpointsGetOriginResponse(
    @SerialName("origin") val `origin`: CustomCharacterOrigin,
    @SerialName("everPrivatePerson") val `everPrivatePerson`: Boolean,
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
data class DailyAnswerHistoryItem(
    @SerialName("answerId") val `answerId`: Id,
    @SerialName("date") val `date`: LocalDate,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("question") val `question`: String,
    @SerialName("userAnswer") val `userAnswer`: String,
    @SerialName("characterAnswer") val `characterAnswer`: String?,
)

@Serializable
data class DailyEvent(
    @SerialName("eventId") val `eventId`: Id,
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("eventDate") val `eventDate`: LocalDate,
    @SerialName("eventTime") val `eventTime`: String?,
    @SerialName("summary") val `summary`: String,
    @SerialName("withCharacterId") val `withCharacterId`: Id?,
    @SerialName("moodEffect") val `moodEffect`: String?,
    @SerialName("source") val `source`: DailyEventSource,
    @SerialName("createdAt") val `createdAt`: Timestamp,
)

@Serializable
data class DailyEventEndpointsCreateBatchBody(
    @SerialName("events") val `events`: List<CreateDailyEventRequest>,
)

@Serializable
data class DailyEventEndpointsCreateBatchResponse(
    @SerialName("created") val `created`: Long,
)

@Serializable
data class DailyEventEndpointsListByCharacterParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class DailyEventEndpointsListByCharacterQuery(
    @SerialName("from") val `from`: LocalDate? = null,
    @SerialName("to") val `to`: LocalDate? = null,
    @SerialName("limit") val `limit`: Long? = null,
    @SerialName("cursor") val `cursor`: String? = null,
)

@Serializable
data class DailyEventEndpointsListByCharacterResponse(
    @SerialName("items") val `items`: List<DailyEvent>,
    @SerialName("nextCursor") val `nextCursor`: String?,
)

@Serializable
data class DailyEventEndpointsRemoveParams(
    @SerialName("eventId") val `eventId`: Id,
)

typealias DailyEventSource = String

@Serializable
data class DailyQuestionAdminEndpointsCreateBody(
    @SerialName("text") val `text`: String,
    @SerialName("tags") val `tags`: List<DailyQuestionTag>,
    @SerialName("listed") val `listed`: Boolean,
)

@Serializable
data class DailyQuestionAdminEndpointsListQuery(
    @SerialName("cursor") val `cursor`: String? = null,
    @SerialName("tag") val `tag`: DailyQuestionTag? = null,
)

@Serializable
data class DailyQuestionAdminEndpointsListResponse(
    @SerialName("items") val `items`: List<AdminDailyQuestion>,
    @SerialName("nextCursor") val `nextCursor`: String?,
)

@Serializable
data class DailyQuestionAdminEndpointsUpdateBody(
    @SerialName("text") val `text`: String? = null,
    @SerialName("tags") val `tags`: List<DailyQuestionTag>? = null,
    @SerialName("listed") val `listed`: Boolean? = null,
)

@Serializable
data class DailyQuestionAdminEndpointsUpdateParams(
    @SerialName("questionId") val `questionId`: Id,
)

@Serializable
data class DailyQuestionContent(
    @EncodeDefault
    @SerialName("type") val `type`: String = "daily_question",
    @SerialName("answerId") val `answerId`: Id,
    @SerialName("questionId") val `questionId`: Id,
    @SerialName("date") val `date`: String,
    @SerialName("question") val `question`: String,
    @SerialName("answer") val `answer`: String,
)

@Serializable
data class DailyQuestionEndpointsAnswerBody(
    @SerialName("clientRequestId") val `clientRequestId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("questionId") val `questionId`: Id,
    @SerialName("answer") val `answer`: String,
)

@Serializable
data class DailyQuestionEndpointsGetTodayQuery(
    @SerialName("characterId") val `characterId`: Id? = null,
)

@Serializable
data class DailyQuestionEndpointsListHistoryQuery(
    @SerialName("cursor") val `cursor`: String? = null,
)

@Serializable
data class DailyQuestionEndpointsListHistoryResponse(
    @SerialName("items") val `items`: List<DailyAnswerHistoryItem>,
    @SerialName("nextCursor") val `nextCursor`: String?,
)

typealias DailyQuestionTag = String

@Serializable
data class DailyQuestionToday(
    @SerialName("date") val `date`: LocalDate,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("questionId") val `questionId`: Id,
    @SerialName("question") val `question`: String,
    @SerialName("answer") val `answer`: DailyQuestionTodayAnswer?,
)

typealias DataSection = String

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
data class DaysKnownInfo(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("daysKnown") val `daysKnown`: Long,
    @SerialName("knownSince") val `knownSince`: LocalDate,
    @SerialName("nextAnniversary") val `nextAnniversary`: Anniversary?,
    @SerialName("anniversaries") val `anniversaries`: List<Anniversary>,
    @SerialName("isRomantic") val `isRomantic`: Boolean,
)

@Serializable
data class DeleteModelsRequest(
    @SerialName("modelKeys") val `modelKeys`: List<ModelKey>,
)

@Serializable
data class DeleteModelsRequestInput(
    @SerialName("modelKeys") val `modelKeys`: List<ModelKey>,
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
data class DisplayMultiplierSettings(
    @SerialName("baseModelKey") val `baseModelKey`: ModelKey?,
)

@Serializable
data class DisplayMultiplierSettingsInput(
    @SerialName("baseModelKey") val `baseModelKey`: ModelKey?,
)

@Serializable
data class DraftCharacterCard(
    @EncodeDefault
    @SerialName("cardSchemaVersion") val `cardSchemaVersion`: Long = 1,
    @SerialName("data") val `data`: DraftCharacterCardData,
)

@Serializable
data class EcologyAction(
    @SerialName("key") val `key`: String,
    @SerialName("group") val `group`: String,
    @SerialName("label") val `label`: String,
    @SerialName("available") val `available`: Boolean,
    @SerialName("unavailableReason") val `unavailableReason`: String?,
    @SerialName("enabled") val `enabled`: Boolean,
)

typealias EcologyActionGroup = String

typealias EcologyActionKey = String

typealias EcologyActivityLevel = String

@Serializable
data class EcologyAdminEndpointsListRunsQuery(
    @SerialName("userId") val `userId`: Id? = null,
    @SerialName("status") val `status`: EcologyRunStatus? = null,
    @SerialName("cursor") val `cursor`: String? = null,
    @SerialName("limit") val `limit`: Long? = null,
)

@Serializable
data class EcologyAdminEndpointsListRunsResponse(
    @SerialName("items") val `items`: List<EcologyRunRecord>,
    @SerialName("nextCursor") val `nextCursor`: String?,
)

@Serializable
data class EcologyAdminOverview(
    @SerialName("config") val `config`: EcologyConfig,
    @SerialName("decisionModelReady") val `decisionModelReady`: Boolean,
    @SerialName("warnings") val `warnings`: List<String>,
    @SerialName("last24h") val `last24h`: EcologyAdminOverviewLast24h,
)

@Serializable
data class EcologyCharacterProfile(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("statusText") val `statusText`: String?,
    @SerialName("statusUpdatedAt") val `statusUpdatedAt`: Timestamp?,
    @SerialName("signature") val `signature`: String?,
    @SerialName("signatureUpdatedAt") val `signatureUpdatedAt`: Timestamp?,
    @SerialName("ecologyEnabled") val `ecologyEnabled`: Boolean,
)

@Serializable
data class EcologyCharacterSwitch(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("enabled") val `enabled`: Boolean,
)

@Serializable
data class EcologyConfig(
    @SerialName("decisionModelKey") val `decisionModelKey`: String?,
    @SerialName("levels") val `levels`: EcologyConfigLevels,
    @SerialName("disabledActions") val `disabledActions`: List<EcologyActionKey>,
    @SerialName("wakeWindow") val `wakeWindow`: EcologyConfigWakeWindow,
    @SerialName("decisionMaxOutputTokens") val `decisionMaxOutputTokens`: Long,
)

@Serializable
data class EcologyConfigInput(
    @SerialName("decisionModelKey") val `decisionModelKey`: String?,
    @SerialName("levels") val `levels`: EcologyConfigInputLevels,
    @SerialName("disabledActions") val `disabledActions`: List<EcologyActionKey>,
    @SerialName("wakeWindow") val `wakeWindow`: EcologyConfigInputWakeWindow,
    @SerialName("decisionMaxOutputTokens") val `decisionMaxOutputTokens`: Long,
)

@Serializable
data class EcologyEndpointsGetCharacterProfileParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class EcologyEndpointsListMurmursParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class EcologyEndpointsListMurmursQuery(
    @SerialName("cursor") val `cursor`: String? = null,
    @SerialName("limit") val `limit`: Long? = null,
)

@Serializable
data class EcologyEndpointsListMurmursResponse(
    @SerialName("items") val `items`: List<EcologyMurmur>,
    @SerialName("nextCursor") val `nextCursor`: String?,
)

@Serializable
data class EcologyEndpointsSetCharacterBody(
    @SerialName("enabled") val `enabled`: Boolean,
)

@Serializable
data class EcologyEndpointsSetCharacterParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class EcologyLevelOption(
    @SerialName("level") val `level`: String,
    @SerialName("label") val `label`: String,
    @SerialName("minPerDay") val `minPerDay`: Long,
    @SerialName("maxPerDay") val `maxPerDay`: Long,
    @SerialName("pointsPerCharacterPerDay") val `pointsPerCharacterPerDay`: Double?,
)

@Serializable
data class EcologyLevelRange(
    @SerialName("min") val `min`: Long,
    @SerialName("max") val `max`: Long,
)

@Serializable
data class EcologyLevelRangeInput(
    @SerialName("min") val `min`: Long,
    @SerialName("max") val `max`: Long,
)

@Serializable
data class EcologyMurmur(
    @SerialName("murmurId") val `murmurId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("text") val `text`: String,
    @SerialName("actionKey") val `actionKey`: String?,
    @SerialName("actionSummary") val `actionSummary`: String,
    @SerialName("points") val `points`: Double,
    @SerialName("origin") val `origin`: String,
    @SerialName("createdAt") val `createdAt`: Timestamp,
)

@Serializable
data class EcologyRunRecord(
    @SerialName("runId") val `runId`: Id,
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("origin") val `origin`: String,
    @SerialName("status") val `status`: String,
    @SerialName("actionKey") val `actionKey`: String?,
    @SerialName("outcome") val `outcome`: String?,
    @SerialName("modelKey") val `modelKey`: String?,
    @SerialName("points") val `points`: Double,
    @SerialName("latencyMs") val `latencyMs`: Long,
    @SerialName("scheduledAt") val `scheduledAt`: Timestamp,
    @SerialName("finishedAt") val `finishedAt`: Timestamp?,
)

typealias EcologyRunStatus = String

@Serializable
data class EcologySettings(
    @SerialName("enabled") val `enabled`: Boolean,
    @SerialName("activityLevel") val `activityLevel`: String,
    @SerialName("actions") val `actions`: List<EcologyAction>,
    @SerialName("levels") val `levels`: List<EcologyLevelOption>,
    @SerialName("characters") val `characters`: List<EcologyCharacterSwitch>,
    @SerialName("eligible") val `eligible`: Boolean,
    @SerialName("runnable") val `runnable`: Boolean,
    @SerialName("pausedReason") val `pausedReason`: String?,
    @SerialName("introSeen") val `introSeen`: Boolean,
    @SerialName("estimatedPointsPerDay") val `estimatedPointsPerDay`: Double?,
    @SerialName("updatedAt") val `updatedAt`: Timestamp?,
)

typealias ErrorCode = String

@Serializable
data class EventsAchievementUnlocked(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "growth.achievement_unlocked",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "growth",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsAchievementUnlockedPayload,
)

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
data class EventsAdultCheckerConfigured(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "model_access.adult_checker_configured",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "model_access",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsAdultCheckerConfiguredPayload,
)

@Serializable
data class EventsAiMilestone(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "ai_runtime.milestone",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "ai_runtime",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsAiMilestonePayload,
)

@Serializable
data class EventsAnniversaryReached(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "growth.anniversary_reached",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "growth",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsAnniversaryReachedPayload,
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
data class EventsCallAnswered(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "calls.call_answered",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "calls",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsCallAnsweredPayload,
)

@Serializable
data class EventsCallCostResolved(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "billing.call_cost_resolved",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "billing",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsCallCostResolvedPayload,
)

@Serializable
data class EventsCallCostUnknown(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "billing.call_cost_unknown",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "billing",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsCallCostUnknownPayload,
)

@Serializable
data class EventsCallEnded(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "calls.call_ended",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "calls",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsCallEndedPayload,
)

@Serializable
data class EventsCallStarted(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "calls.call_started",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "calls",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsCallStartedPayload,
)

@Serializable
data class EventsCardIssued(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "growth.card_issued",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "growth",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsCardIssuedPayload,
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

@Serializable
data class EventsDailyAnswerSubmitted(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "play.daily_answer_submitted",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "play",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDailyAnswerSubmittedPayload,
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
data class EventsDomainEventModelAccessAdultCheckerConfigured(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "model_access.adult_checker_configured",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "model_access",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventModelAccessAdultCheckerConfiguredPayload,
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
data class EventsDomainEventBillingCallCostUnknown(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "billing.call_cost_unknown",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "billing",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventBillingCallCostUnknownPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventBillingCallCostResolved(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "billing.call_cost_resolved",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "billing",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventBillingCallCostResolvedPayload,
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

@Serializable
data class EventsDomainEventCharactersRelationChanged(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "characters.relation_changed",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "characters",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventCharactersRelationChangedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventCharactersSupplementChanged(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "characters.supplement_changed",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "characters",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventCharactersSupplementChangedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventChatGroupMembersChanged(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "chat.group_members_changed",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "chat",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventChatGroupMembersChangedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventChatGroupRenamed(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "chat.group_renamed",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "chat",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventChatGroupRenamedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventChatGroupDissolved(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "chat.group_dissolved",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "chat",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventChatGroupDissolvedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventChatMessageActionChosen(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "chat.message_action_chosen",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "chat",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventChatMessageActionChosenPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventMomentsPostCreated(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "moments.post_created",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "moments",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventMomentsPostCreatedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventMomentsCommentCreated(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "moments.comment_created",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "moments",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventMomentsCommentCreatedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventMomentsPostLiked(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "moments.post_liked",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "moments",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventMomentsPostLikedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventAiRuntimeMilestone(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "ai_runtime.milestone",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "ai_runtime",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventAiRuntimeMilestonePayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventGrowthFamiliarityLeveledUp(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "growth.familiarity_leveled_up",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "growth",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventGrowthFamiliarityLeveledUpPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventGrowthAnniversaryReached(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "growth.anniversary_reached",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "growth",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventGrowthAnniversaryReachedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventGrowthCardIssued(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "growth.card_issued",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "growth",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventGrowthCardIssuedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventGrowthAchievementUnlocked(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "growth.achievement_unlocked",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "growth",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventGrowthAchievementUnlockedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventGrowthPetAdopted(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "growth.pet_adopted",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "growth",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventGrowthPetAdoptedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventGrowthPetStageChanged(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "growth.pet_stage_changed",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "growth",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventGrowthPetStageChangedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventGrowthPetSentAway(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "growth.pet_sent_away",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "growth",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventGrowthPetSentAwayPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventGrowthPetRenamed(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "growth.pet_renamed",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "growth",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventGrowthPetRenamedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventGrowthPetNamingRequested(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "growth.pet_naming_requested",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "growth",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventGrowthPetNamingRequestedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventLibraryFavoriteAdded(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "library.favorite_added",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "library",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventLibraryFavoriteAddedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventLibraryShareImageGenerated(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "library.share_image_generated",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "library",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventLibraryShareImageGeneratedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventCallsCallStarted(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "calls.call_started",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "calls",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventCallsCallStartedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventCallsCallAnswered(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "calls.call_answered",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "calls",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventCallsCallAnsweredPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventCallsCallEnded(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "calls.call_ended",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "calls",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventCallsCallEndedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventImporterJobCompleted(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "importer.job_completed",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "importer",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventImporterJobCompletedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventPlazaWorkPublished(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "plaza.work_published",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "plaza",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventPlazaWorkPublishedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventPlazaWorkVersionPublished(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "plaza.work_version_published",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "plaza",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventPlazaWorkVersionPublishedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventPlazaWorkRemoved(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "plaza.work_removed",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "plaza",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventPlazaWorkRemovedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventPlayDailyAnswerSubmitted(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "play.daily_answer_submitted",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "play",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventPlayDailyAnswerSubmittedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventPlayWishlistItemChanged(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "play.wishlist_item_changed",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "play",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventPlayWishlistItemChangedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventPlayWishlistItemCompleted(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "play.wishlist_item_completed",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "play",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventPlayWishlistItemCompletedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventPlayLetterSent(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "play.letter_sent",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "play",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventPlayLetterSentPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventPlayLetterDelivered(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "play.letter_delivered",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "play",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventPlayLetterDeliveredPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventPlayFocusStarted(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "play.focus_started",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "play",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventPlayFocusStartedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventPlayFocusEnded(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "play.focus_ended",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "play",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventPlayFocusEndedPayload,
) : EventsDomainEvent

@Serializable
data class EventsDomainEventPlayReminderSaved(
    @SerialName("eventId") override val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "play.reminder_saved",
    @EncodeDefault
    @SerialName("version") override val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "play",
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsDomainEventPlayReminderSavedPayload,
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
            "model_access.adult_checker_configured" -> input.json.decodeFromJsonElement(EventsDomainEventModelAccessAdultCheckerConfigured.serializer(), value)
            "model_access.usage_reconciled" -> input.json.decodeFromJsonElement(EventsDomainEventModelAccessUsageReconciled.serializer(), value)
            "billing.balance_changed" -> input.json.decodeFromJsonElement(EventsDomainEventBillingBalanceChanged.serializer(), value)
            "billing.balance_depleted" -> input.json.decodeFromJsonElement(EventsDomainEventBillingBalanceDepleted.serializer(), value)
            "billing.balance_restored" -> input.json.decodeFromJsonElement(EventsDomainEventBillingBalanceRestored.serializer(), value)
            "billing.balance_low" -> input.json.decodeFromJsonElement(EventsDomainEventBillingBalanceLow.serializer(), value)
            "billing.call_cost_unknown" -> input.json.decodeFromJsonElement(EventsDomainEventBillingCallCostUnknown.serializer(), value)
            "billing.call_cost_resolved" -> input.json.decodeFromJsonElement(EventsDomainEventBillingCallCostResolved.serializer(), value)
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
            "characters.relation_changed" -> input.json.decodeFromJsonElement(EventsDomainEventCharactersRelationChanged.serializer(), value)
            "characters.supplement_changed" -> input.json.decodeFromJsonElement(EventsDomainEventCharactersSupplementChanged.serializer(), value)
            "chat.group_members_changed" -> input.json.decodeFromJsonElement(EventsDomainEventChatGroupMembersChanged.serializer(), value)
            "chat.group_renamed" -> input.json.decodeFromJsonElement(EventsDomainEventChatGroupRenamed.serializer(), value)
            "chat.group_dissolved" -> input.json.decodeFromJsonElement(EventsDomainEventChatGroupDissolved.serializer(), value)
            "chat.message_action_chosen" -> input.json.decodeFromJsonElement(EventsDomainEventChatMessageActionChosen.serializer(), value)
            "moments.post_created" -> input.json.decodeFromJsonElement(EventsDomainEventMomentsPostCreated.serializer(), value)
            "moments.comment_created" -> input.json.decodeFromJsonElement(EventsDomainEventMomentsCommentCreated.serializer(), value)
            "moments.post_liked" -> input.json.decodeFromJsonElement(EventsDomainEventMomentsPostLiked.serializer(), value)
            "ai_runtime.milestone" -> input.json.decodeFromJsonElement(EventsDomainEventAiRuntimeMilestone.serializer(), value)
            "growth.familiarity_leveled_up" -> input.json.decodeFromJsonElement(EventsDomainEventGrowthFamiliarityLeveledUp.serializer(), value)
            "growth.anniversary_reached" -> input.json.decodeFromJsonElement(EventsDomainEventGrowthAnniversaryReached.serializer(), value)
            "growth.card_issued" -> input.json.decodeFromJsonElement(EventsDomainEventGrowthCardIssued.serializer(), value)
            "growth.achievement_unlocked" -> input.json.decodeFromJsonElement(EventsDomainEventGrowthAchievementUnlocked.serializer(), value)
            "growth.pet_adopted" -> input.json.decodeFromJsonElement(EventsDomainEventGrowthPetAdopted.serializer(), value)
            "growth.pet_stage_changed" -> input.json.decodeFromJsonElement(EventsDomainEventGrowthPetStageChanged.serializer(), value)
            "growth.pet_sent_away" -> input.json.decodeFromJsonElement(EventsDomainEventGrowthPetSentAway.serializer(), value)
            "growth.pet_renamed" -> input.json.decodeFromJsonElement(EventsDomainEventGrowthPetRenamed.serializer(), value)
            "growth.pet_naming_requested" -> input.json.decodeFromJsonElement(EventsDomainEventGrowthPetNamingRequested.serializer(), value)
            "library.favorite_added" -> input.json.decodeFromJsonElement(EventsDomainEventLibraryFavoriteAdded.serializer(), value)
            "library.share_image_generated" -> input.json.decodeFromJsonElement(EventsDomainEventLibraryShareImageGenerated.serializer(), value)
            "calls.call_started" -> input.json.decodeFromJsonElement(EventsDomainEventCallsCallStarted.serializer(), value)
            "calls.call_answered" -> input.json.decodeFromJsonElement(EventsDomainEventCallsCallAnswered.serializer(), value)
            "calls.call_ended" -> input.json.decodeFromJsonElement(EventsDomainEventCallsCallEnded.serializer(), value)
            "importer.job_completed" -> input.json.decodeFromJsonElement(EventsDomainEventImporterJobCompleted.serializer(), value)
            "plaza.work_published" -> input.json.decodeFromJsonElement(EventsDomainEventPlazaWorkPublished.serializer(), value)
            "plaza.work_version_published" -> input.json.decodeFromJsonElement(EventsDomainEventPlazaWorkVersionPublished.serializer(), value)
            "plaza.work_removed" -> input.json.decodeFromJsonElement(EventsDomainEventPlazaWorkRemoved.serializer(), value)
            "play.daily_answer_submitted" -> input.json.decodeFromJsonElement(EventsDomainEventPlayDailyAnswerSubmitted.serializer(), value)
            "play.wishlist_item_changed" -> input.json.decodeFromJsonElement(EventsDomainEventPlayWishlistItemChanged.serializer(), value)
            "play.wishlist_item_completed" -> input.json.decodeFromJsonElement(EventsDomainEventPlayWishlistItemCompleted.serializer(), value)
            "play.letter_sent" -> input.json.decodeFromJsonElement(EventsDomainEventPlayLetterSent.serializer(), value)
            "play.letter_delivered" -> input.json.decodeFromJsonElement(EventsDomainEventPlayLetterDelivered.serializer(), value)
            "play.focus_started" -> input.json.decodeFromJsonElement(EventsDomainEventPlayFocusStarted.serializer(), value)
            "play.focus_ended" -> input.json.decodeFromJsonElement(EventsDomainEventPlayFocusEnded.serializer(), value)
            "play.reminder_saved" -> input.json.decodeFromJsonElement(EventsDomainEventPlayReminderSaved.serializer(), value)
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
            is EventsDomainEventModelAccessAdultCheckerConfigured -> output.json.encodeToJsonElement(EventsDomainEventModelAccessAdultCheckerConfigured.serializer(), value)
            is EventsDomainEventModelAccessUsageReconciled -> output.json.encodeToJsonElement(EventsDomainEventModelAccessUsageReconciled.serializer(), value)
            is EventsDomainEventBillingBalanceChanged -> output.json.encodeToJsonElement(EventsDomainEventBillingBalanceChanged.serializer(), value)
            is EventsDomainEventBillingBalanceDepleted -> output.json.encodeToJsonElement(EventsDomainEventBillingBalanceDepleted.serializer(), value)
            is EventsDomainEventBillingBalanceRestored -> output.json.encodeToJsonElement(EventsDomainEventBillingBalanceRestored.serializer(), value)
            is EventsDomainEventBillingBalanceLow -> output.json.encodeToJsonElement(EventsDomainEventBillingBalanceLow.serializer(), value)
            is EventsDomainEventBillingCallCostUnknown -> output.json.encodeToJsonElement(EventsDomainEventBillingCallCostUnknown.serializer(), value)
            is EventsDomainEventBillingCallCostResolved -> output.json.encodeToJsonElement(EventsDomainEventBillingCallCostResolved.serializer(), value)
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
            is EventsDomainEventCharactersRelationChanged -> output.json.encodeToJsonElement(EventsDomainEventCharactersRelationChanged.serializer(), value)
            is EventsDomainEventCharactersSupplementChanged -> output.json.encodeToJsonElement(EventsDomainEventCharactersSupplementChanged.serializer(), value)
            is EventsDomainEventChatGroupMembersChanged -> output.json.encodeToJsonElement(EventsDomainEventChatGroupMembersChanged.serializer(), value)
            is EventsDomainEventChatGroupRenamed -> output.json.encodeToJsonElement(EventsDomainEventChatGroupRenamed.serializer(), value)
            is EventsDomainEventChatGroupDissolved -> output.json.encodeToJsonElement(EventsDomainEventChatGroupDissolved.serializer(), value)
            is EventsDomainEventChatMessageActionChosen -> output.json.encodeToJsonElement(EventsDomainEventChatMessageActionChosen.serializer(), value)
            is EventsDomainEventMomentsPostCreated -> output.json.encodeToJsonElement(EventsDomainEventMomentsPostCreated.serializer(), value)
            is EventsDomainEventMomentsCommentCreated -> output.json.encodeToJsonElement(EventsDomainEventMomentsCommentCreated.serializer(), value)
            is EventsDomainEventMomentsPostLiked -> output.json.encodeToJsonElement(EventsDomainEventMomentsPostLiked.serializer(), value)
            is EventsDomainEventAiRuntimeMilestone -> output.json.encodeToJsonElement(EventsDomainEventAiRuntimeMilestone.serializer(), value)
            is EventsDomainEventGrowthFamiliarityLeveledUp -> output.json.encodeToJsonElement(EventsDomainEventGrowthFamiliarityLeveledUp.serializer(), value)
            is EventsDomainEventGrowthAnniversaryReached -> output.json.encodeToJsonElement(EventsDomainEventGrowthAnniversaryReached.serializer(), value)
            is EventsDomainEventGrowthCardIssued -> output.json.encodeToJsonElement(EventsDomainEventGrowthCardIssued.serializer(), value)
            is EventsDomainEventGrowthAchievementUnlocked -> output.json.encodeToJsonElement(EventsDomainEventGrowthAchievementUnlocked.serializer(), value)
            is EventsDomainEventGrowthPetAdopted -> output.json.encodeToJsonElement(EventsDomainEventGrowthPetAdopted.serializer(), value)
            is EventsDomainEventGrowthPetStageChanged -> output.json.encodeToJsonElement(EventsDomainEventGrowthPetStageChanged.serializer(), value)
            is EventsDomainEventGrowthPetSentAway -> output.json.encodeToJsonElement(EventsDomainEventGrowthPetSentAway.serializer(), value)
            is EventsDomainEventGrowthPetRenamed -> output.json.encodeToJsonElement(EventsDomainEventGrowthPetRenamed.serializer(), value)
            is EventsDomainEventGrowthPetNamingRequested -> output.json.encodeToJsonElement(EventsDomainEventGrowthPetNamingRequested.serializer(), value)
            is EventsDomainEventLibraryFavoriteAdded -> output.json.encodeToJsonElement(EventsDomainEventLibraryFavoriteAdded.serializer(), value)
            is EventsDomainEventLibraryShareImageGenerated -> output.json.encodeToJsonElement(EventsDomainEventLibraryShareImageGenerated.serializer(), value)
            is EventsDomainEventCallsCallStarted -> output.json.encodeToJsonElement(EventsDomainEventCallsCallStarted.serializer(), value)
            is EventsDomainEventCallsCallAnswered -> output.json.encodeToJsonElement(EventsDomainEventCallsCallAnswered.serializer(), value)
            is EventsDomainEventCallsCallEnded -> output.json.encodeToJsonElement(EventsDomainEventCallsCallEnded.serializer(), value)
            is EventsDomainEventImporterJobCompleted -> output.json.encodeToJsonElement(EventsDomainEventImporterJobCompleted.serializer(), value)
            is EventsDomainEventPlazaWorkPublished -> output.json.encodeToJsonElement(EventsDomainEventPlazaWorkPublished.serializer(), value)
            is EventsDomainEventPlazaWorkVersionPublished -> output.json.encodeToJsonElement(EventsDomainEventPlazaWorkVersionPublished.serializer(), value)
            is EventsDomainEventPlazaWorkRemoved -> output.json.encodeToJsonElement(EventsDomainEventPlazaWorkRemoved.serializer(), value)
            is EventsDomainEventPlayDailyAnswerSubmitted -> output.json.encodeToJsonElement(EventsDomainEventPlayDailyAnswerSubmitted.serializer(), value)
            is EventsDomainEventPlayWishlistItemChanged -> output.json.encodeToJsonElement(EventsDomainEventPlayWishlistItemChanged.serializer(), value)
            is EventsDomainEventPlayWishlistItemCompleted -> output.json.encodeToJsonElement(EventsDomainEventPlayWishlistItemCompleted.serializer(), value)
            is EventsDomainEventPlayLetterSent -> output.json.encodeToJsonElement(EventsDomainEventPlayLetterSent.serializer(), value)
            is EventsDomainEventPlayLetterDelivered -> output.json.encodeToJsonElement(EventsDomainEventPlayLetterDelivered.serializer(), value)
            is EventsDomainEventPlayFocusStarted -> output.json.encodeToJsonElement(EventsDomainEventPlayFocusStarted.serializer(), value)
            is EventsDomainEventPlayFocusEnded -> output.json.encodeToJsonElement(EventsDomainEventPlayFocusEnded.serializer(), value)
            is EventsDomainEventPlayReminderSaved -> output.json.encodeToJsonElement(EventsDomainEventPlayReminderSaved.serializer(), value)
        }
        output.encodeJsonElement(element)
    }
}

@Serializable
data class EventsFamiliarityLeveledUp(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "growth.familiarity_leveled_up",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "growth",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsFamiliarityLeveledUpPayload,
)

@Serializable
data class EventsFavoriteAdded(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "library.favorite_added",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "library",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsFavoriteAddedPayload,
)

@Serializable
data class EventsFocusEnded(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "play.focus_ended",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "play",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsFocusEndedPayload,
)

@Serializable
data class EventsFocusStarted(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "play.focus_started",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "play",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsFocusStartedPayload,
)

@Serializable
data class EventsGroupDissolved(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "chat.group_dissolved",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "chat",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsGroupDissolvedPayload,
)

@Serializable
data class EventsGroupMembersChanged(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "chat.group_members_changed",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "chat",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsGroupMembersChangedPayload,
)

@Serializable
data class EventsGroupRenamed(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "chat.group_renamed",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "chat",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsGroupRenamedPayload,
)

@Serializable
data class EventsImportJobCompleted(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "importer.job_completed",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "importer",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsImportJobCompletedPayload,
)

@Serializable
data class EventsLetterDelivered(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "play.letter_delivered",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "play",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsLetterDeliveredPayload,
)

@Serializable
data class EventsLetterSent(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "play.letter_sent",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "play",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsLetterSentPayload,
)

@Serializable
data class EventsMessageActionChosen(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "chat.message_action_chosen",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "chat",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsMessageActionChosenPayload,
)

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
data class EventsMomentsCommentCreated(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "moments.comment_created",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "moments",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsMomentsCommentCreatedPayload,
)

@Serializable
data class EventsMomentsPostCreated(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "moments.post_created",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "moments",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsMomentsPostCreatedPayload,
)

@Serializable
data class EventsMomentsPostLiked(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "moments.post_liked",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "moments",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsMomentsPostLikedPayload,
)

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
data class EventsPetAdopted(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "growth.pet_adopted",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "growth",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsPetAdoptedPayload,
)

@Serializable
data class EventsPetNamingRequested(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "growth.pet_naming_requested",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "growth",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsPetNamingRequestedPayload,
)

@Serializable
data class EventsPetRenamed(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "growth.pet_renamed",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "growth",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsPetRenamedPayload,
)

@Serializable
data class EventsPetSentAway(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "growth.pet_sent_away",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "growth",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsPetSentAwayPayload,
)

@Serializable
data class EventsPetStageChanged(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "growth.pet_stage_changed",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "growth",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsPetStageChangedPayload,
)

@Serializable
data class EventsPlazaWorkPublished(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "plaza.work_published",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "plaza",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsPlazaWorkPublishedPayload,
)

@Serializable
data class EventsPlazaWorkRemoved(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "plaza.work_removed",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "plaza",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsPlazaWorkRemovedPayload,
)

@Serializable
data class EventsPlazaWorkVersionPublished(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "plaza.work_version_published",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "plaza",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsPlazaWorkVersionPublishedPayload,
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
data class EventsRelationChanged(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "characters.relation_changed",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "characters",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsRelationChangedPayload,
)

@Serializable
data class EventsReminderSaved(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "play.reminder_saved",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "play",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsReminderSavedPayload,
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
data class EventsShareImageGenerated(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "library.share_image_generated",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "library",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsShareImageGeneratedPayload,
)

@Serializable
data class EventsSupplementChanged(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "characters.supplement_changed",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "characters",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsSupplementChangedPayload,
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

@Serializable
data class EventsWishlistItemChanged(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "play.wishlist_item_changed",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "play",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsWishlistItemChangedPayload,
)

@Serializable
data class EventsWishlistItemCompleted(
    @SerialName("eventId") val `eventId`: Id,
    @EncodeDefault
    @SerialName("type") val `type`: String = "play.wishlist_item_completed",
    @EncodeDefault
    @SerialName("version") val `version`: Long = 1,
    @EncodeDefault
    @SerialName("producer") val `producer`: String = "play",
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("payload") val `payload`: EventsWishlistItemCompletedPayload,
)

typealias FamiliarityCapReason = String

typealias FamiliarityCapReasonValue = String

typealias FamiliarityEventType = String

@Serializable
data class FamiliarityInfo(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("level") val `level`: FamiliarityLevel,
    @SerialName("pointsInLevel") val `pointsInLevel`: Long,
    @SerialName("pointsToNextLevel") val `pointsToNextLevel`: Long?,
    @SerialName("totalPoints") val `totalPoints`: Long,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
    @SerialName("stageName") val `stageName`: String? = null,
    @SerialName("capReason") val `capReason`: FamiliarityCapReason? = null,
    @SerialName("romancePaused") val `romancePaused`: Boolean? = null,
)

typealias FamiliarityLevel = Long

@Serializable
data class FamiliarityStageSettings(
    @SerialName("thresholds") val `thresholds`: FamiliarityStageThresholds,
    @SerialName("stageNames") val `stageNames`: List<String>,
    @SerialName("freeCeilingLevel") val `freeCeilingLevel`: FamiliarityLevel,
    @SerialName("updatedAt") val `updatedAt`: Timestamp?,
)

typealias FamiliarityStageThresholds = List<Long>

@Serializable
data class Favorite(
    @SerialName("favoriteId") val `favoriteId`: Id,
    @SerialName("source") val `source`: FavoriteSource,
    @SerialName("characterId") val `characterId`: Id?,
    @SerialName("content") val `content`: ReceivedMessageContent,
    @SerialName("extraImages") val `extraImages`: List<Id>,
    @SerialName("characterNameSnapshot") val `characterNameSnapshot`: String? = null,
    @SerialName("characterAvatarMediaIdSnapshot") val `characterAvatarMediaIdSnapshot`: Id? = null,
    @SerialName("shareable") val `shareable`: Boolean,
    @SerialName("notShareableReason") val `notShareableReason`: String?,
    @SerialName("sourceCreatedAt") val `sourceCreatedAt`: Timestamp,
    @SerialName("createdAt") val `createdAt`: Timestamp,
)

typealias FavoriteSource = JsonElement

typealias FeedbackCategory = String

@Serializable
data class FocusEndpointsEndParams(
    @SerialName("focusId") val `focusId`: Id,
)

@Serializable
data class FocusEndpointsGetActiveResponse(
    @SerialName("session") val `session`: FocusSession?,
)

@Serializable
data class FocusEndpointsStartBody(
    @SerialName("clientRequestId") val `clientRequestId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("minutes") val `minutes`: Long,
    @SerialName("note") val `note`: String? = null,
)

@Serializable
data class FocusSession(
    @SerialName("focusId") val `focusId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("plannedMinutes") val `plannedMinutes`: Long,
    @SerialName("note") val `note`: String?,
    @SerialName("startedAt") val `startedAt`: Timestamp,
    @SerialName("endsAt") val `endsAt`: Timestamp,
    @SerialName("endedAt") val `endedAt`: Timestamp?,
    @SerialName("result") val `result`: String,
)

@Serializable
data class ForwardMessagesRequest(
    @SerialName("clientRequestId") val `clientRequestId`: ClientMsgId,
    @SerialName("messageIds") val `messageIds`: List<Id>,
    @SerialName("targetConversationIds") val `targetConversationIds`: List<Id>,
    @SerialName("mode") val `mode`: String,
)

@Serializable
data class ForwardMessagesRequestInput(
    @SerialName("clientRequestId") val `clientRequestId`: ClientMsgId,
    @SerialName("messageIds") val `messageIds`: List<Id>,
    @SerialName("targetConversationIds") val `targetConversationIds`: List<Id>,
    @SerialName("mode") val `mode`: String,
)

@Serializable
data class ForwardMessagesResponse(
    @SerialName("results") val `results`: List<ForwardMessagesResponseResultsItem>,
)

@Serializable(with = ForwardSnapshotContentSerializer::class)
sealed interface ForwardSnapshotContent {
    val `type`: String
}

@Serializable
data class ForwardSnapshotContentText(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "text",
    @SerialName("text") val `text`: String,
    @SerialName("mentions") val `mentions`: List<Id>? = null,
) : ForwardSnapshotContent

@Serializable
data class ForwardSnapshotContentImage(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "image",
    @SerialName("mediaId") val `mediaId`: Id,
    @SerialName("width") val `width`: Long?,
    @SerialName("height") val `height`: Long?,
    @SerialName("sizeBytes") val `sizeBytes`: Long? = null,
) : ForwardSnapshotContent

@Serializable
data class ForwardSnapshotContentVoice(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "voice",
    @SerialName("mediaId") val `mediaId`: Id,
    @SerialName("durationMs") val `durationMs`: Long,
    @SerialName("transcript") val `transcript`: String?,
) : ForwardSnapshotContent

@Serializable
data class ForwardSnapshotContentSticker(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "sticker",
    @SerialName("stickerId") val `stickerId`: Id,
    @SerialName("source") val `source`: String,
    @SerialName("mediaId") val `mediaId`: Id,
    @SerialName("description") val `description`: String?,
) : ForwardSnapshotContent

@Serializable
data class ForwardSnapshotContentLink(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "link",
    @SerialName("url") val `url`: String,
    @SerialName("title") val `title`: String,
    @SerialName("source") val `source`: String?,
    @SerialName("description") val `description`: String?,
    @SerialName("coverMediaId") val `coverMediaId`: Id?,
    @SerialName("appHint") val `appHint`: String,
) : ForwardSnapshotContent

@Serializable
data class ForwardSnapshotContentContactCard(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "contact_card",
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("name") val `name`: String,
    @SerialName("recommenderCharacterId") val `recommenderCharacterId`: Id,
) : ForwardSnapshotContent

@Serializable
data class ForwardSnapshotContentLetter(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "letter",
    @SerialName("letterId") val `letterId`: Id,
    @SerialName("direction") val `direction`: String,
    @SerialName("body") val `body`: String,
) : ForwardSnapshotContent

@Serializable
data class ForwardSnapshotContentDailyQuestion(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "daily_question",
    @SerialName("answerId") val `answerId`: Id,
    @SerialName("questionId") val `questionId`: Id,
    @SerialName("date") val `date`: String,
    @SerialName("question") val `question`: String,
    @SerialName("answer") val `answer`: String,
) : ForwardSnapshotContent

object ForwardSnapshotContentSerializer : KSerializer<ForwardSnapshotContent> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("ForwardSnapshotContent")
    override fun deserialize(decoder: Decoder): ForwardSnapshotContent {
        val input = decoder as JsonDecoder
        var value = input.decodeJsonElement().jsonObject
        val tag = value["type"]?.jsonPrimitive?.content
        return when (tag) {
            "text" -> input.json.decodeFromJsonElement(ForwardSnapshotContentText.serializer(), value)
            "image" -> input.json.decodeFromJsonElement(ForwardSnapshotContentImage.serializer(), value)
            "voice" -> input.json.decodeFromJsonElement(ForwardSnapshotContentVoice.serializer(), value)
            "sticker" -> input.json.decodeFromJsonElement(ForwardSnapshotContentSticker.serializer(), value)
            "link" -> input.json.decodeFromJsonElement(ForwardSnapshotContentLink.serializer(), value)
            "contact_card" -> input.json.decodeFromJsonElement(ForwardSnapshotContentContactCard.serializer(), value)
            "letter" -> input.json.decodeFromJsonElement(ForwardSnapshotContentLetter.serializer(), value)
            "daily_question" -> input.json.decodeFromJsonElement(ForwardSnapshotContentDailyQuestion.serializer(), value)
            else -> throw SerializationException("Unknown discriminator")
        }
    }
    override fun serialize(encoder: Encoder, value: ForwardSnapshotContent) {
        val output = encoder as JsonEncoder
        val element = when (value) {
            is ForwardSnapshotContentText -> output.json.encodeToJsonElement(ForwardSnapshotContentText.serializer(), value)
            is ForwardSnapshotContentImage -> output.json.encodeToJsonElement(ForwardSnapshotContentImage.serializer(), value)
            is ForwardSnapshotContentVoice -> output.json.encodeToJsonElement(ForwardSnapshotContentVoice.serializer(), value)
            is ForwardSnapshotContentSticker -> output.json.encodeToJsonElement(ForwardSnapshotContentSticker.serializer(), value)
            is ForwardSnapshotContentLink -> output.json.encodeToJsonElement(ForwardSnapshotContentLink.serializer(), value)
            is ForwardSnapshotContentContactCard -> output.json.encodeToJsonElement(ForwardSnapshotContentContactCard.serializer(), value)
            is ForwardSnapshotContentLetter -> output.json.encodeToJsonElement(ForwardSnapshotContentLetter.serializer(), value)
            is ForwardSnapshotContentDailyQuestion -> output.json.encodeToJsonElement(ForwardSnapshotContentDailyQuestion.serializer(), value)
        }
        output.encodeJsonElement(element)
    }
}

@Serializable
data class ForwardedRecordContent(
    @EncodeDefault
    @SerialName("type") val `type`: String = "forwarded_record",
    @SerialName("title") val `title`: String,
    @SerialName("items") val `items`: List<ForwardedRecordContentItemsItem>,
)

@Serializable
data class GatewayLimits(
    @SerialName("perUserConcurrency") val `perUserConcurrency`: Long?,
    @SerialName("perUserRpm") val `perUserRpm`: Long?,
    @SerialName("failureThreshold") val `failureThreshold`: Long,
    @SerialName("cooldownSeconds") val `cooldownSeconds`: Long,
    @SerialName("searchCandidatesPerUserDay") val `searchCandidatesPerUserDay`: Long? = null,
    @SerialName("searchCandidatesGlobalDay") val `searchCandidatesGlobalDay`: Long? = null,
)

@Serializable
data class GatewayLimitsInput(
    @SerialName("perUserConcurrency") val `perUserConcurrency`: Long?,
    @SerialName("perUserRpm") val `perUserRpm`: Long?,
    @SerialName("failureThreshold") val `failureThreshold`: Long,
    @SerialName("cooldownSeconds") val `cooldownSeconds`: Long,
    @SerialName("searchCandidatesPerUserDay") val `searchCandidatesPerUserDay`: Long? = null,
    @SerialName("searchCandidatesGlobalDay") val `searchCandidatesGlobalDay`: Long? = null,
)

typealias Gender = String

@Serializable
data class GlobalSearchResult(
    @SerialName("characterIds") val `characterIds`: List<Id>,
    @SerialName("groupConversationIds") val `groupConversationIds`: List<Id>,
    @SerialName("messages") val `messages`: List<ConversationSearchGroup>,
)

@Serializable
data class GroupCompanionEndpointsGetSettingsParams(
    @SerialName("conversationId") val `conversationId`: Id,
)

@Serializable
data class GroupCompanionEndpointsListModesResponse(
    @SerialName("items") val `items`: List<ScenarioModeOption>,
)

@Serializable
data class GroupCompanionEndpointsUpdateSettingsBody(
    @SerialName("instantReply") val `instantReply`: Boolean? = null,
    @SerialName("selfChatEnabled") val `selfChatEnabled`: Boolean? = null,
    @SerialName("scenarioMode") val `scenarioMode`: ScenarioMode? = null,
)

@Serializable
data class GroupCompanionSettings(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("instantReply") val `instantReply`: Boolean,
    @SerialName("selfChatEnabled") val `selfChatEnabled`: Boolean,
    @SerialName("scenarioMode") val `scenarioMode`: String,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
)

@Serializable
data class GroupParams(
    @SerialName("conversationId") val `conversationId`: Id,
)

@Serializable
data class GroupParamsInput(
    @SerialName("conversationId") val `conversationId`: Id,
)

@Serializable
data class GrowthCard(
    @SerialName("cardId") val `cardId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("kind") val `kind`: String,
    @SerialName("serialNo") val `serialNo`: Long,
    @SerialName("title") val `title`: String,
    @SerialName("line") val `line`: String,
    @SerialName("obtainedOn") val `obtainedOn`: LocalDate,
    @SerialName("face") val `face`: GrowthCardFace,
    @SerialName("sourceMessageIds") val `sourceMessageIds`: List<Id>,
    @SerialName("createdAt") val `createdAt`: Timestamp,
)

@Serializable
data class GrowthCardEndpointsGetAlbumParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class GrowthCardEndpointsGetCardParams(
    @SerialName("cardId") val `cardId`: Id,
)

@Serializable
data class GrowthCardEndpointsListAchievementsResponse(
    @SerialName("items") val `items`: List<Achievement>,
)

@Serializable
data class GrowthCardEndpointsListAlbumsResponse(
    @SerialName("items") val `items`: List<CardAlbumSummary>,
)

@Serializable
data class GrowthCardEndpointsListFamiliarityResponse(
    @SerialName("items") val `items`: List<FamiliarityInfo>,
)

@Serializable
data class GrowthEndpointsAddAnniversaryParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class GrowthEndpointsAddPointsParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class GrowthEndpointsGetDaysKnownParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class GrowthEndpointsGetFamiliarityParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class GrowthEndpointsRemoveAnniversaryParams(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("anniversaryId") val `anniversaryId`: Id,
)

typealias GrowthEndpointsRemoveAnniversaryResponse = JsonElement?

@Serializable
data class GrowthEndpointsUpdateAnniversaryParams(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("anniversaryId") val `anniversaryId`: Id,
)

@Serializable
data class HealthEndpointsClearAllBody(
    @EncodeDefault
    @SerialName("confirm") val `confirm`: String = "CLEAR",
)

typealias HealthEndpointsClearAllResponse = JsonElement?

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

@Serializable
data class HealthEndpointsUpdateSettingsBody(
    @SerialName("cycleLengthDays") val `cycleLengthDays`: Long,
    @SerialName("periodLengthDays") val `periodLengthDays`: Long,
)

@Serializable
data class HealthSettings(
    @SerialName("cycleLengthDays") val `cycleLengthDays`: Long,
    @SerialName("periodLengthDays") val `periodLengthDays`: Long,
    @SerialName("userProvided") val `userProvided`: Boolean,
)

@Serializable
data class HealthTagAdminEndpointsListSymptomTagsResponse(
    @SerialName("items") val `items`: List<SymptomTag>,
)

@Serializable
data class HealthTagAdminEndpointsPutSymptomTagsBody(
    @SerialName("items") val `items`: List<HealthTagAdminEndpointsPutSymptomTagsBodyItemsItem>,
)

@Serializable
data class HealthTagAdminEndpointsPutSymptomTagsResponse(
    @SerialName("items") val `items`: List<SymptomTag>,
)

@Serializable
data class HealthTagEndpointsListSymptomTagsResponse(
    @SerialName("items") val `items`: List<SymptomTag>,
)

typealias HexColor = String

@Serializable
data class HolidayAdminEndpointsListQuery(
    @SerialName("enabled") val `enabled`: String? = null,
    @SerialName("category") val `category`: HolidayCategory? = null,
    @SerialName("romantic") val `romantic`: String? = null,
    @SerialName("limit") val `limit`: Long? = null,
    @SerialName("cursor") val `cursor`: String? = null,
)

@Serializable
data class HolidayAdminEndpointsListResponse(
    @SerialName("items") val `items`: List<HolidayEvent>,
    @SerialName("nextCursor") val `nextCursor`: String?,
)

@Serializable
data class HolidayAdminEndpointsUpdateParams(
    @SerialName("holidayId") val `holidayId`: Id,
)

typealias HolidayCategory = String

typealias HolidayCharacterCategory = String

typealias HolidayDateType = String

@Serializable
data class HolidayEvent(
    @SerialName("holidayId") val `holidayId`: Id,
    @SerialName("name") val `name`: String,
    @SerialName("dateType") val `dateType`: HolidayDateType,
    @SerialName("dateValue") val `dateValue`: String,
    @SerialName("romantic") val `romantic`: Boolean,
    @SerialName("enabled") val `enabled`: Boolean,
    @SerialName("category") val `category`: String,
    @SerialName("sendCard") val `sendCard`: Boolean,
    @SerialName("cardTemplateId") val `cardTemplateId`: Id?,
    @SerialName("characterCategories") val `characterCategories`: List<String>,
    @SerialName("upcomingDates") val `upcomingDates`: List<LocalDate>,
    @SerialName("createdAt") val `createdAt`: Timestamp,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
)

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
data class IdentityEndpointsUpdateAliasBody(
    @SerialName("username") val `username`: Username,
)

@Serializable
data class ImageContent(
    @EncodeDefault
    @SerialName("type") val `type`: String = "image",
    @SerialName("mediaId") val `mediaId`: Id,
    @SerialName("width") val `width`: Long?,
    @SerialName("height") val `height`: Long?,
    @SerialName("sizeBytes") val `sizeBytes`: Long? = null,
)

@Serializable
data class ImageContentInput(
    @EncodeDefault
    @SerialName("type") val `type`: String = "image",
    @SerialName("mediaId") val `mediaId`: Id,
    @SerialName("width") val `width`: Long?,
    @SerialName("height") val `height`: Long?,
    @SerialName("sizeBytes") val `sizeBytes`: Long? = null,
)

typealias ImportFailure = String

@Serializable
data class ImportJob(
    @SerialName("jobId") val `jobId`: Id,
    @SerialName("kind") val `kind`: ImportKind,
    @SerialName("targetCharacterId") val `targetCharacterId`: Id?,
    @SerialName("sourceKind") val `sourceKind`: ImportSourceKind,
    @SerialName("status") val `status`: String,
    @SerialName("speakers") val `speakers`: List<ImportJobSpeakersItem>,
    @SerialName("selectedSpeaker") val `selectedSpeaker`: String?,
    @SerialName("charCount") val `charCount`: Long,
    @SerialName("truncated") val `truncated`: Boolean,
    @SerialName("estimatedMicros") val `estimatedMicros`: Long?,
    @SerialName("progress") val `progress`: Long,
    @SerialName("keepRaw") val `keepRaw`: Boolean,
    @SerialName("rawDeletedAt") val `rawDeletedAt`: Timestamp?,
    @SerialName("failure") val `failure`: String?,
    @SerialName("mergedIntoJobId") val `mergedIntoJobId`: Id? = null,
    @SerialName("createdAt") val `createdAt`: Timestamp,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
)

typealias ImportJobStatus = String

typealias ImportKind = String

@Serializable
data class ImportLeaderboardRequest(
    @SerialName("text") val `text`: String,
)

@Serializable
data class ImportLeaderboardRequestInput(
    @SerialName("text") val `text`: String,
)

typealias ImportResult = JsonElement

typealias ImportResultInput = JsonElement

typealias ImportSourceKind = String

@Serializable
data class ImporterEndpointsConfirmDialogueBody(
    @SerialName("lines") val `lines`: List<RecognizedDialogueLineInput>? = null,
)

@Serializable
data class ImporterEndpointsCreateJobBody(
    @SerialName("clientRequestId") val `clientRequestId`: Id,
    @SerialName("kind") val `kind`: ImportKind,
    @SerialName("targetCharacterId") val `targetCharacterId`: Id? = null,
    @SerialName("mergeIntoJobId") val `mergeIntoJobId`: Id? = null,
    @SerialName("sourceKind") val `sourceKind`: ImportSourceKind,
    @SerialName("text") val `text`: String? = null,
)

@Serializable
data class ImporterEndpointsGetRecognizedDialogueResponse(
    @SerialName("items") val `items`: List<RecognizedDialogueLine>,
)

@Serializable
data class ImporterEndpointsListJobsResponse(
    @SerialName("items") val `items`: List<ImportJob>,
)

@Serializable
data class ImporterEndpointsSelectSpeakerBody(
    @SerialName("speaker") val `speaker`: String,
)

@Serializable
data class ImporterEndpointsStartBody(
    @SerialName("keepRaw") val `keepRaw`: Boolean? = null,
)

@Serializable
data class ImporterEndpointsUploadFileParams(
    @SerialName("jobId") val `jobId`: Id,
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
data class LeaderboardSnapshotStatus(
    @SerialName("source") val `source`: ModelLeaderboardSource?,
    @SerialName("snapshot") val `snapshot`: LeaderboardSnapshotStatusSnapshot?,
    @SerialName("lastAttemptAt") val `lastAttemptAt`: Timestamp?,
    @SerialName("lastError") val `lastError`: String?,
    @SerialName("matched") val `matched`: List<LeaderboardSnapshotStatusMatchedItem>,
    @SerialName("unmatched") val `unmatched`: List<LeaderboardSnapshotStatusUnmatchedItem>,
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
    @SerialName("points") val `points`: Points? = null,
    @SerialName("balanceAfterPoints") val `balanceAfterPoints`: Points? = null,
    @SerialName("usageRecordId") val `usageRecordId`: Id? = null,
)

typealias LedgerEntryType = String

@Serializable
data class Letter(
    @SerialName("letterId") val `letterId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("direction") val `direction`: String,
    @SerialName("status") val `status`: String,
    @SerialName("body") val `body`: String?,
    @SerialName("inReplyToLetterId") val `inReplyToLetterId`: Id?,
    @SerialName("expectedDeliveryDate") val `expectedDeliveryDate`: LocalDate?,
    @SerialName("sentAt") val `sentAt`: Timestamp?,
    @SerialName("deliveredAt") val `deliveredAt`: Timestamp?,
    @SerialName("readAt") val `readAt`: Timestamp?,
    @SerialName("messageId") val `messageId`: Id?,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
)

@Serializable
data class LetterContent(
    @EncodeDefault
    @SerialName("type") val `type`: String = "letter",
    @SerialName("letterId") val `letterId`: Id,
    @SerialName("direction") val `direction`: String,
    @SerialName("body") val `body`: String,
)

@Serializable
data class LetterEndpointsGetBadgeResponse(
    @SerialName("unreadCount") val `unreadCount`: Long,
)

@Serializable
data class LetterEndpointsGetLetterParams(
    @SerialName("letterId") val `letterId`: Id,
)

@Serializable
data class LetterEndpointsListLettersQuery(
    @SerialName("box") val `box`: String,
    @SerialName("characterId") val `characterId`: Id? = null,
    @SerialName("cursor") val `cursor`: String? = null,
)

@Serializable
data class LetterEndpointsListLettersResponse(
    @SerialName("items") val `items`: List<Letter>,
    @SerialName("nextCursor") val `nextCursor`: String?,
)

@Serializable
data class LetterEndpointsSaveDraftBody(
    @SerialName("body") val `body`: String,
)

@Serializable
data class LetterEndpointsSaveDraftParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class LetterEndpointsSendLetterBody(
    @SerialName("clientRequestId") val `clientRequestId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("body") val `body`: String,
)

@Serializable
data class LetterEndpointsSendLetterResponse(
    @SerialName("letter") val `letter`: Letter,
    @SerialName("replyDelayed") val `replyDelayed`: Boolean,
    @SerialName("replyDelayReason") val `replyDelayReason`: String? = null,
)

typealias LetterStatus = String

@Serializable
data class LibraryEndpointsAddFavoritesResponse(
    @SerialName("items") val `items`: List<Favorite>,
)

@Serializable
data class LibraryEndpointsListFavoritesQuery(
    @SerialName("characterId") val `characterId`: Id? = null,
    @SerialName("q") val `q`: String? = null,
    @SerialName("cursor") val `cursor`: String? = null,
    @SerialName("limit") val `limit`: Long? = null,
)

@Serializable
data class LibraryEndpointsListFavoritesResponse(
    @SerialName("items") val `items`: List<Favorite>,
    @SerialName("nextCursor") val `nextCursor`: String?,
)

@Serializable
data class LibraryEndpointsRemoveFavoriteParams(
    @SerialName("favoriteId") val `favoriteId`: Id,
)

@Serializable
data class LibrarySticker(
    @SerialName("stickerId") val `stickerId`: Id,
    @SerialName("mediaId") val `mediaId`: Id,
    @SerialName("url") val `url`: String,
    @SerialName("description") val `description`: String,
    @SerialName("packId") val `packId`: Id,
)

typealias LinkAppHint = String

@Serializable
data class LinkContent(
    @EncodeDefault
    @SerialName("type") val `type`: String = "link",
    @SerialName("url") val `url`: String,
    @SerialName("title") val `title`: String,
    @SerialName("source") val `source`: String?,
    @SerialName("description") val `description`: String?,
    @SerialName("coverMediaId") val `coverMediaId`: Id?,
    @SerialName("appHint") val `appHint`: String,
)

@Serializable
data class LinkContentInput(
    @EncodeDefault
    @SerialName("type") val `type`: String = "link",
    @SerialName("url") val `url`: String,
    @SerialName("title") val `title`: String,
    @SerialName("source") val `source`: String?,
    @SerialName("description") val `description`: String?,
    @SerialName("coverMediaId") val `coverMediaId`: Id?,
    @SerialName("appHint") val `appHint`: String,
)

@Serializable
data class LinkPreview(
    @SerialName("url") val `url`: String,
    @SerialName("title") val `title`: String,
    @SerialName("source") val `source`: String?,
    @SerialName("description") val `description`: String?,
    @SerialName("coverMediaId") val `coverMediaId`: Id?,
    @SerialName("appHint") val `appHint`: String,
    @SerialName("reachable") val `reachable`: Boolean,
)

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

@Serializable
data class ListPlazaOfficialQuery(
    @SerialName("q") val `q`: String? = null,
    @SerialName("categoryId") val `categoryId`: String? = null,
    @SerialName("sort") val `sort`: PlazaOfficialSort,
    @SerialName("cursor") val `cursor`: String? = null,
    @SerialName("limit") val `limit`: Long,
)

@Serializable
data class ListPlazaOfficialQueryInput(
    @SerialName("q") val `q`: String? = null,
    @SerialName("categoryId") val `categoryId`: String? = null,
    @SerialName("sort") val `sort`: PlazaOfficialSort? = null,
    @SerialName("cursor") val `cursor`: String? = null,
    @SerialName("limit") val `limit`: Long? = null,
)

@Serializable
data class ListPlazaWorksQuery(
    @SerialName("q") val `q`: String? = null,
    @SerialName("sort") val `sort`: PlazaSort,
    @SerialName("kind") val `kind`: PlazaWorkKind? = null,
    @SerialName("basis") val `basis`: CharacterBasis? = null,
    @SerialName("authorId") val `authorId`: Id? = null,
    @SerialName("cursor") val `cursor`: String? = null,
    @SerialName("limit") val `limit`: Long,
)

@Serializable
data class ListPlazaWorksQueryInput(
    @SerialName("q") val `q`: String? = null,
    @SerialName("sort") val `sort`: PlazaSort? = null,
    @SerialName("kind") val `kind`: PlazaWorkKind? = null,
    @SerialName("basis") val `basis`: CharacterBasis? = null,
    @SerialName("authorId") val `authorId`: Id? = null,
    @SerialName("cursor") val `cursor`: String? = null,
    @SerialName("limit") val `limit`: Long? = null,
)

typealias LocalDate = String

typealias LocalTime = String

@Serializable
data class LockedCard(
    @SerialName("kind") val `kind`: String,
    @SerialName("title") val `title`: String,
    @SerialName("condition") val `condition`: String,
)

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
    @SerialName("purpose") val `purpose`: AdminMediaPurpose,
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
data class MediaExtraEndpointsGetTranscriptParams(
    @SerialName("mediaId") val `mediaId`: Id,
)

@Serializable
data class MediaExtraEndpointsPreviewLinkBody(
    @SerialName("url") val `url`: String,
)

@Serializable
data class MediaObject(
    @SerialName("mediaId") val `mediaId`: Id,
    @SerialName("purpose") val `purpose`: String,
    @SerialName("mimeType") val `mimeType`: String,
    @SerialName("sizeBytes") val `sizeBytes`: Long,
    @SerialName("width") val `width`: Long?,
    @SerialName("height") val `height`: Long?,
    @SerialName("url") val `url`: String,
    @SerialName("urlExpiresAt") val `urlExpiresAt`: Timestamp,
    @SerialName("createdAt") val `createdAt`: Timestamp,
    @SerialName("thumbnailUrl") val `thumbnailUrl`: String? = null,
    @SerialName("durationMs") val `durationMs`: Long? = null,
)

typealias MediaPurpose = String

@Serializable
data class MediaTranscript(
    @SerialName("mediaId") val `mediaId`: Id,
    @SerialName("status") val `status`: String,
    @SerialName("text") val `text`: String?,
)

@Serializable
data class Membership(
    @SerialName("checkedAt") val `checkedAt`: Timestamp,
    @SerialName("tier") val `tier`: String,
    @SerialName("expiresAt") val `expiresAt`: Timestamp?,
    @SerialName("updatedAt") val `updatedAt`: Timestamp?,
)

@Serializable
data class MembershipAdminEndpointsGetParams(
    @SerialName("userId") val `userId`: Id,
)

@Serializable
data class MembershipAdminEndpointsSetParams(
    @SerialName("userId") val `userId`: Id,
)

@Serializable
data class MembershipChange(
    @SerialName("changeId") val `changeId`: Id,
    @SerialName("userId") val `userId`: Id,
    @SerialName("previousExpiresAt") val `previousExpiresAt`: Timestamp?,
    @SerialName("expiresAt") val `expiresAt`: Timestamp?,
    @SerialName("operatorUserId") val `operatorUserId`: Id?,
    @SerialName("reason") val `reason`: String?,
    @SerialName("createdAt") val `createdAt`: Timestamp,
)

@Serializable
data class MembershipChangeAdminEndpointsListChangesQuery(
    @SerialName("userId") val `userId`: Id? = null,
    @SerialName("from") val `from`: Timestamp? = null,
    @SerialName("to") val `to`: Timestamp? = null,
    @SerialName("cursor") val `cursor`: String? = null,
    @SerialName("limit") val `limit`: Long? = null,
)

@Serializable
data class MembershipChangeAdminEndpointsListChangesResponse(
    @SerialName("items") val `items`: List<MembershipChange>,
    @SerialName("nextCursor") val `nextCursor`: String?,
)

@Serializable
data class MembershipOffer(
    @SerialName("plans") val `plans`: List<MembershipPlan>,
    @SerialName("firstPurchaseAvailable") val `firstPurchaseAvailable`: Boolean,
    @EncodeDefault
    @SerialName("paymentEnabled") val `paymentEnabled`: Boolean = false,
    @SerialName("contactHint") val `contactHint`: String,
    @SerialName("membership") val `membership`: Membership,
)

@Serializable
data class MembershipOrder(
    @SerialName("orderId") val `orderId`: Id,
    @SerialName("userId") val `userId`: Id,
    @SerialName("planId") val `planId`: MembershipPlanId,
    @SerialName("priceFen") val `priceFen`: Long,
    @SerialName("listPriceFen") val `listPriceFen`: Long,
    @SerialName("firstPurchase") val `firstPurchase`: Boolean,
    @SerialName("bonusPoints") val `bonusPoints`: Long,
    @SerialName("startsAt") val `startsAt`: Timestamp,
    @SerialName("endsAt") val `endsAt`: Timestamp,
    @SerialName("operatorUserId") val `operatorUserId`: Id?,
    @SerialName("note") val `note`: String?,
    @SerialName("createdAt") val `createdAt`: Timestamp,
    @SerialName("renewal") val `renewal`: Boolean? = null,
)

@Serializable
data class MembershipOrderAdminEndpointsCreateOrderResponse(
    @SerialName("order") val `order`: MembershipOrder,
    @SerialName("membership") val `membership`: Membership,
)

@Serializable
data class MembershipOrderAdminEndpointsListOrdersQuery(
    @SerialName("userId") val `userId`: Id? = null,
    @SerialName("from") val `from`: Timestamp? = null,
    @SerialName("to") val `to`: Timestamp? = null,
    @SerialName("planId") val `planId`: MembershipPlanId? = null,
    @SerialName("firstPurchase") val `firstPurchase`: String? = null,
    @SerialName("cursor") val `cursor`: String? = null,
    @SerialName("limit") val `limit`: Long? = null,
)

@Serializable
data class MembershipOrderAdminEndpointsListOrdersResponse(
    @SerialName("items") val `items`: List<MembershipOrder>,
    @SerialName("nextCursor") val `nextCursor`: String?,
)

@Serializable
data class MembershipPlan(
    @SerialName("planId") val `planId`: MembershipPlanId,
    @SerialName("name") val `name`: String,
    @SerialName("months") val `months`: Long,
    @SerialName("priceFen") val `priceFen`: Long,
    @SerialName("firstPriceFen") val `firstPriceFen`: Long,
    @SerialName("bonusPoints") val `bonusPoints`: Long,
)

typealias MembershipPlanId = String

@Serializable
data class MembershipPlanInput(
    @SerialName("planId") val `planId`: MembershipPlanId,
    @SerialName("name") val `name`: String,
    @SerialName("months") val `months`: Long,
    @SerialName("priceFen") val `priceFen`: Long,
    @SerialName("firstPriceFen") val `firstPriceFen`: Long,
    @SerialName("bonusPoints") val `bonusPoints`: Long,
)

@Serializable
data class MembershipSettings(
    @SerialName("plans") val `plans`: List<MembershipPlan>,
    @SerialName("contactHint") val `contactHint`: String,
    @SerialName("signupBonusPoints") val `signupBonusPoints`: Long,
)

@Serializable
data class MembershipSettingsInput(
    @SerialName("plans") val `plans`: List<MembershipPlanInput>,
    @SerialName("contactHint") val `contactHint`: String,
    @SerialName("signupBonusPoints") val `signupBonusPoints`: Long,
)

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
    @SerialName("origin") val `origin`: String? = null,
    @SerialName("knownBy") val `knownBy`: List<Id>,
    @SerialName("createdAt") val `createdAt`: Timestamp,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
)

typealias MemorySharingClass = String

@Serializable
data class MemorySharingEndpointsUpdateBody(
    @SerialName("level") val `level`: MemorySharingLevel,
)

typealias MemorySharingLevel = String

@Serializable
data class MemorySharingSettings(
    @SerialName("level") val `level`: MemorySharingLevel,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
)

typealias MemoryStatus = String

@Serializable
data class MemoryTierConfig(
    @SerialName("free") val `free`: MemoryTierLimits,
    @SerialName("proPlus") val `proPlus`: MemoryTierLimits,
    @SerialName("newUserTrialDays") val `newUserTrialDays`: Long,
    @SerialName("recallTopK") val `recallTopK`: Long,
    @SerialName("groupMemoryMessageThreshold") val `groupMemoryMessageThreshold`: Long? = null,
    @SerialName("groupMemoryIdleMinutes") val `groupMemoryIdleMinutes`: Long? = null,
    @SerialName("longContext") val `longContext`: ChatWindowLimits,
)

@Serializable
data class MemoryTierEndpointsAdminGetResponse(
    @SerialName("free") val `free`: MemoryTierLimits,
    @SerialName("proPlus") val `proPlus`: MemoryTierLimits,
    @SerialName("newUserTrialDays") val `newUserTrialDays`: Long,
    @SerialName("recallTopK") val `recallTopK`: Long,
    @SerialName("groupMemoryMessageThreshold") val `groupMemoryMessageThreshold`: Long? = null,
    @SerialName("groupMemoryIdleMinutes") val `groupMemoryIdleMinutes`: Long? = null,
    @SerialName("longContext") val `longContext`: ChatWindowLimits,
    @SerialName("updatedAt") val `updatedAt`: Timestamp?,
)

@Serializable
data class MemoryTierEndpointsAdminUpdateResponse(
    @SerialName("free") val `free`: MemoryTierLimits,
    @SerialName("proPlus") val `proPlus`: MemoryTierLimits,
    @SerialName("newUserTrialDays") val `newUserTrialDays`: Long,
    @SerialName("recallTopK") val `recallTopK`: Long,
    @SerialName("groupMemoryMessageThreshold") val `groupMemoryMessageThreshold`: Long? = null,
    @SerialName("groupMemoryIdleMinutes") val `groupMemoryIdleMinutes`: Long? = null,
    @SerialName("longContext") val `longContext`: ChatWindowLimits,
    @SerialName("updatedAt") val `updatedAt`: Timestamp?,
)

@Serializable
data class MemoryTierLimits(
    @SerialName("residentLimit") val `residentLimit`: Long,
    @SerialName("libraryLimit") val `libraryLimit`: Long?,
    @SerialName("summaryDays") val `summaryDays`: Long?,
    @SerialName("retrieveLimit") val `retrieveLimit`: Long,
    @SerialName("recallDays") val `recallDays`: Long?,
)

@Serializable
data class MemoryTierStatus(
    @SerialName("tier") val `tier`: String,
    @SerialName("basis") val `basis`: String,
    @SerialName("trialEndsAt") val `trialEndsAt`: Timestamp?,
    @SerialName("limits") val `limits`: MemoryTierLimits,
    @SerialName("libraryCount") val `libraryCount`: Long,
    @SerialName("longContext") val `longContext`: MemoryTierStatusLongContext,
)

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
    @SerialName("actionChoice") val `actionChoice`: MessageActionChoice? = null,
    @SerialName("pointsCost") val `pointsCost`: Double? = null,
    @SerialName("usageRecordId") val `usageRecordId`: Id? = null,
)

@Serializable
data class MessageAck(
    @SerialName("clientMsgId") val `clientMsgId`: ClientMsgId,
    @SerialName("message") val `message`: Message,
)

typealias MessageActionStyle = String

@Serializable(with = MessageContentSerializer::class)
sealed interface MessageContent {
    val `type`: String
}

@Serializable
data class MessageContentText(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "text",
    @SerialName("text") val `text`: String,
    @SerialName("mentions") val `mentions`: List<Id>? = null,
) : MessageContent

@Serializable
data class MessageContentNudge(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "nudge",
    @SerialName("targetParticipantId") val `targetParticipantId`: Id,
    @SerialName("targetKind") val `targetKind`: String? = null,
    @SerialName("suffix") val `suffix`: String? = null,
) : MessageContent

@Serializable
data class MessageContentSystem(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "system",
    @SerialName("code") val `code`: String,
    @SerialName("params") val `params`: Map<String, MessageContentSystemParamsValue>,
) : MessageContent

@Serializable
data class MessageContentImage(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "image",
    @SerialName("mediaId") val `mediaId`: Id,
    @SerialName("width") val `width`: Long?,
    @SerialName("height") val `height`: Long?,
    @SerialName("sizeBytes") val `sizeBytes`: Long? = null,
) : MessageContent

@Serializable
data class MessageContentVoice(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "voice",
    @SerialName("mediaId") val `mediaId`: Id,
    @SerialName("durationMs") val `durationMs`: Long,
    @SerialName("transcript") val `transcript`: String?,
) : MessageContent

@Serializable
data class MessageContentSticker(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "sticker",
    @SerialName("stickerId") val `stickerId`: Id,
    @SerialName("source") val `source`: String,
    @SerialName("mediaId") val `mediaId`: Id,
    @SerialName("description") val `description`: String?,
) : MessageContent

@Serializable
data class MessageContentLink(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "link",
    @SerialName("url") val `url`: String,
    @SerialName("title") val `title`: String,
    @SerialName("source") val `source`: String?,
    @SerialName("description") val `description`: String?,
    @SerialName("coverMediaId") val `coverMediaId`: Id?,
    @SerialName("appHint") val `appHint`: String,
) : MessageContent

@Serializable
data class MessageContentContactCard(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "contact_card",
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("name") val `name`: String,
    @SerialName("recommenderCharacterId") val `recommenderCharacterId`: Id,
) : MessageContent

@Serializable
data class MessageContentCallRecord(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "call_record",
    @SerialName("callId") val `callId`: Id,
    @SerialName("direction") val `direction`: CallDirection,
    @SerialName("outcome") val `outcome`: String,
    @SerialName("durationSec") val `durationSec`: Long,
) : MessageContent

@Serializable
data class MessageContentLetter(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "letter",
    @SerialName("letterId") val `letterId`: Id,
    @SerialName("direction") val `direction`: String,
    @SerialName("body") val `body`: String,
) : MessageContent

@Serializable
data class MessageContentDailyQuestion(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "daily_question",
    @SerialName("answerId") val `answerId`: Id,
    @SerialName("questionId") val `questionId`: Id,
    @SerialName("date") val `date`: String,
    @SerialName("question") val `question`: String,
    @SerialName("answer") val `answer`: String,
) : MessageContent

@Serializable
data class MessageContentActionCard(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "action_card",
    @SerialName("cardKind") val `cardKind`: String,
    @SerialName("text") val `text`: String,
    @SerialName("actions") val `actions`: List<MessageContentActionCardActionsItem>,
    @SerialName("ref") val `ref`: MessageContentActionCardRef?,
) : MessageContent

@Serializable
data class MessageContentForwardedRecord(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "forwarded_record",
    @SerialName("title") val `title`: String,
    @SerialName("items") val `items`: List<MessageContentForwardedRecordItemsItem>,
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
            "image" -> input.json.decodeFromJsonElement(MessageContentImage.serializer(), value)
            "voice" -> input.json.decodeFromJsonElement(MessageContentVoice.serializer(), value)
            "sticker" -> input.json.decodeFromJsonElement(MessageContentSticker.serializer(), value)
            "link" -> input.json.decodeFromJsonElement(MessageContentLink.serializer(), value)
            "contact_card" -> input.json.decodeFromJsonElement(MessageContentContactCard.serializer(), value)
            "call_record" -> input.json.decodeFromJsonElement(MessageContentCallRecord.serializer(), value)
            "letter" -> input.json.decodeFromJsonElement(MessageContentLetter.serializer(), value)
            "daily_question" -> input.json.decodeFromJsonElement(MessageContentDailyQuestion.serializer(), value)
            "action_card" -> input.json.decodeFromJsonElement(MessageContentActionCard.serializer(), value)
            "forwarded_record" -> input.json.decodeFromJsonElement(MessageContentForwardedRecord.serializer(), value)
            else -> throw SerializationException("Unknown discriminator")
        }
    }
    override fun serialize(encoder: Encoder, value: MessageContent) {
        val output = encoder as JsonEncoder
        val element = when (value) {
            is MessageContentText -> output.json.encodeToJsonElement(MessageContentText.serializer(), value)
            is MessageContentNudge -> output.json.encodeToJsonElement(MessageContentNudge.serializer(), value)
            is MessageContentSystem -> output.json.encodeToJsonElement(MessageContentSystem.serializer(), value)
            is MessageContentImage -> output.json.encodeToJsonElement(MessageContentImage.serializer(), value)
            is MessageContentVoice -> output.json.encodeToJsonElement(MessageContentVoice.serializer(), value)
            is MessageContentSticker -> output.json.encodeToJsonElement(MessageContentSticker.serializer(), value)
            is MessageContentLink -> output.json.encodeToJsonElement(MessageContentLink.serializer(), value)
            is MessageContentContactCard -> output.json.encodeToJsonElement(MessageContentContactCard.serializer(), value)
            is MessageContentCallRecord -> output.json.encodeToJsonElement(MessageContentCallRecord.serializer(), value)
            is MessageContentLetter -> output.json.encodeToJsonElement(MessageContentLetter.serializer(), value)
            is MessageContentDailyQuestion -> output.json.encodeToJsonElement(MessageContentDailyQuestion.serializer(), value)
            is MessageContentActionCard -> output.json.encodeToJsonElement(MessageContentActionCard.serializer(), value)
            is MessageContentForwardedRecord -> output.json.encodeToJsonElement(MessageContentForwardedRecord.serializer(), value)
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

@Serializable
data class MessageSearchHit(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("messageId") val `messageId`: Id,
    @SerialName("seq") val `seq`: Seq,
    @SerialName("senderParticipantId") val `senderParticipantId`: Id,
    @SerialName("senderKind") val `senderKind`: String,
    @SerialName("snippet") val `snippet`: String,
    @SerialName("createdAt") val `createdAt`: Timestamp,
)

typealias MessageStatus = String

@Serializable
data class ModelAccessAdminEndpointsBatchUpstreamsResponse(
    @SerialName("items") val `items`: List<Upstream>,
)

@Serializable
data class ModelAccessAdminEndpointsDeleteUpstreamParams(
    @SerialName("upstreamId") val `upstreamId`: Id,
)

typealias ModelAccessAdminEndpointsGetLeaderboardSourceResponse = ModelLeaderboardSource?

@Serializable
data class ModelAccessAdminEndpointsListCatalogResponse(
    @SerialName("items") val `items`: List<AdminCatalogEntry>,
)

@Serializable
data class ModelAccessAdminEndpointsListModelsResponse(
    @SerialName("items") val `items`: List<AdminModel>,
)

@Serializable
data class ModelAccessAdminEndpointsListUpstreamModelsParams(
    @SerialName("upstreamId") val `upstreamId`: Id,
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
data class ModelAccessAdminEndpointsUpdateArenaNameParams(
    @SerialName("modelKey") val `modelKey`: String,
)

@Serializable
data class ModelAccessAdminEndpointsUpdateUpstreamParams(
    @SerialName("upstreamId") val `upstreamId`: Id,
)

@Serializable
data class ModelAccessAdminEndpointsUpsertCatalogEntryParams(
    @SerialName("modelKey") val `modelKey`: String,
)

@Serializable
data class ModelAccessAdminEndpointsUpsertModelParams(
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
data class ModelAccessAdminUsageEndpointsUsageOverviewBody(
    @SerialName("from") val `from`: Timestamp,
    @SerialName("to") val `to`: Timestamp,
    @SerialName("upstreamIds") val `upstreamIds`: List<Id>? = null,
    @SerialName("modelKeys") val `modelKeys`: List<ModelKey>? = null,
)

@Serializable
data class ModelAccessEndpointsApplyRecommendedScenariosBody(
    @SerialName("overwrite") val `overwrite`: Boolean? = null,
)

@Serializable
data class ModelAccessEndpointsGetCharacterOverrideParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class ModelAccessEndpointsGetCharacterScenariosParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class ModelAccessEndpointsGetModelStatusQuery(
    @SerialName("characterId") val `characterId`: Id? = null,
)

@Serializable
data class ModelAccessEndpointsListModelsQuery(
    @SerialName("capability") val `capability`: ModelCapability? = null,
    @SerialName("scenario") val `scenario`: ModelScenario? = null,
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

@Serializable
data class ModelAccessEndpointsUpdateCharacterScenariosParams(
    @SerialName("characterId") val `characterId`: Id,
)

typealias ModelCapability = String

@Serializable
data class ModelDeletionImpact(
    @SerialName("models") val `models`: List<ModelDeletionImpactModelsItem>,
    @SerialName("users") val `users`: Long,
    @SerialName("scenarioSelections") val `scenarioSelections`: Long,
    @SerialName("characters") val `characters`: Long,
    @SerialName("characterOverrides") val `characterOverrides`: Long,
    @SerialName("recommended") val `recommended`: List<ModelScenario>,
    @SerialName("internal") val `internal`: List<PlatformInternalUse>,
    @SerialName("routes") val `routes`: Long,
    @SerialName("discounts") val `discounts`: Long,
    @SerialName("pricedModels") val `pricedModels`: Long,
    @SerialName("displayMultiplierBase") val `displayMultiplierBase`: Boolean,
    @SerialName("priceVersionId") val `priceVersionId`: Id? = null,
)

@Serializable
data class ModelDiscount(
    @SerialName("rate") val `rate`: Double,
    @SerialName("startsAt") val `startsAt`: Timestamp,
    @SerialName("endsAt") val `endsAt`: Timestamp,
)

@Serializable
data class ModelDiscountInfo(
    @SerialName("rate") val `rate`: Double,
    @SerialName("endsAt") val `endsAt`: Timestamp,
)

@Serializable
data class ModelDiscountInput(
    @SerialName("rate") val `rate`: Double,
    @SerialName("startsAt") val `startsAt`: Timestamp,
    @SerialName("endsAt") val `endsAt`: Timestamp,
)

@Serializable
data class ModelInfo(
    @SerialName("modelKey") val `modelKey`: ModelKey,
    @SerialName("displayName") val `displayName`: String,
    @SerialName("vendorName") val `vendorName`: String,
    @SerialName("priceTier") val `priceTier`: PriceTier,
    @SerialName("capabilities") val `capabilities`: List<String>,
    @SerialName("tags") val `tags`: List<String>,
    @SerialName("leaderboardRank") val `leaderboardRank`: Long?,
    @SerialName("leaderboardChange") val `leaderboardChange`: Long? = null,
    @SerialName("available") val `available`: Boolean,
    @SerialName("unavailableDetail") val `unavailableDetail`: String? = null,
    @SerialName("pointsPerReply") val `pointsPerReply`: Double? = null,
    @SerialName("pointsPerReplyBasis") val `pointsPerReplyBasis`: String? = null,
    @SerialName("displayMultiplier") val `displayMultiplier`: Double? = null,
    @SerialName("scenarios") val `scenarios`: List<String>? = null,
    @SerialName("discount") val `discount`: ModelDiscountInfo? = null,
    @SerialName("pointsPerUse") val `pointsPerUse`: ModelInfoPointsPerUse? = null,
)

typealias ModelKey = String

@Serializable
data class ModelLeaderboardInfo(
    @SerialName("source") val `source`: ModelLeaderboardSource?,
    @SerialName("fetchedAt") val `fetchedAt`: Timestamp? = null,
    @SerialName("method") val `method`: String? = null,
    @SerialName("lastError") val `lastError`: String? = null,
    @SerialName("popular") val `popular`: List<ModelLeaderboardInfoPopularItem>,
)

@Serializable
data class ModelLeaderboardSource(
    @SerialName("label") val `label`: String,
    @SerialName("url") val `url`: String,
    @SerialName("asOf") val `asOf`: LocalDate?,
)

@Serializable
data class ModelLeaderboardSourceInput(
    @SerialName("label") val `label`: String,
    @SerialName("url") val `url`: String,
    @SerialName("asOf") val `asOf`: LocalDate?,
)

typealias ModelPurpose = String

@Serializable
data class ModelRates(
    @SerialName("input") val `input`: Double,
    @SerialName("output") val `output`: Double,
    @SerialName("cache") val `cache`: Double,
    @SerialName("cacheWrite5m") val `cacheWrite5m`: Double? = null,
    @SerialName("cacheWrite1h") val `cacheWrite1h`: Double? = null,
)

@Serializable
data class ModelRatesInput(
    @SerialName("input") val `input`: Double,
    @SerialName("output") val `output`: Double,
    @SerialName("cache") val `cache`: Double,
    @SerialName("cacheWrite5m") val `cacheWrite5m`: Double? = null,
    @SerialName("cacheWrite1h") val `cacheWrite1h`: Double? = null,
)

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
    @SerialName("unavailableDetail") val `unavailableDetail`: ModelUnavailableDetail? = null,
)

typealias ModelRole = String

@Serializable
data class ModelRoute(
    @SerialName("upstreamId") val `upstreamId`: Id,
    @SerialName("upstreamModelId") val `upstreamModelId`: String,
    @SerialName("priority") val `priority`: Long,
    @SerialName("weight") val `weight`: Long,
    @SerialName("enabled") val `enabled`: Boolean,
    @SerialName("billingBounds") val `billingBounds`: RouteBillingBounds? = null,
)

@Serializable
data class ModelRouteInput(
    @SerialName("upstreamId") val `upstreamId`: Id,
    @SerialName("upstreamModelId") val `upstreamModelId`: String,
    @SerialName("priority") val `priority`: Long,
    @SerialName("weight") val `weight`: Long,
    @SerialName("enabled") val `enabled`: Boolean,
    @SerialName("billingBounds") val `billingBounds`: RouteBillingBoundsInput? = null,
)

typealias ModelScenario = String

@Serializable
data class ModelScenarioSettings(
    @SerialName("recommended") val `recommended`: ModelScenarioSettingsRecommended,
    @SerialName("internal") val `internal`: ModelScenarioSettingsInternal,
)

@Serializable
data class ModelScenarioSettingsInput(
    @SerialName("recommended") val `recommended`: ModelScenarioSettingsInputRecommended,
    @SerialName("internal") val `internal`: ModelScenarioSettingsInputInternal,
)

@Serializable
data class ModelSelection(
    @SerialName("chat") val `chat`: ModelRefState?,
    @SerialName("background") val `background`: ModelRefState?,
    @SerialName("adult") val `adult`: ModelRefState?,
)

@Serializable
data class ModelServiceRate(
    @SerialName("unit") val `unit`: ServicePriceUnit,
    @SerialName("price") val `price`: Double,
    @SerialName("cost") val `cost`: Double? = null,
    @SerialName("hasTimeBands") val `hasTimeBands`: Boolean? = null,
)

@Serializable
data class ModelServiceRateWrite(
    @SerialName("unit") val `unit`: ServicePriceUnit,
    @SerialName("price") val `price`: Double,
    @SerialName("cost") val `cost`: Double? = null,
)

@Serializable
data class ModelStatus(
    @SerialName("characterId") val `characterId`: Id?,
    @SerialName("available") val `available`: Boolean,
    @SerialName("reason") val `reason`: String?,
    @SerialName("canFallbackToDefault") val `canFallbackToDefault`: Boolean,
    @SerialName("detail") val `detail`: ModelUnavailableDetail? = null,
    @SerialName("visionAvailable") val `visionAvailable`: Boolean? = null,
)

typealias ModelUnavailableDetail = String

typealias ModelUnavailableDetailValue = String

@Serializable
data class ModelsDevLookupRequest(
    @SerialName("items") val `items`: List<ModelsDevLookupRequestItemsItem>,
)

@Serializable
data class ModelsDevLookupRequestInput(
    @SerialName("items") val `items`: List<ModelsDevLookupRequestInputItemsItem>,
)

@Serializable
data class ModelsDevLookupResponse(
    @SerialName("fetchedAt") val `fetchedAt`: Timestamp?,
    @SerialName("usdCnyRate") val `usdCnyRate`: Double,
    @SerialName("items") val `items`: List<ModelsDevLookupResponseItemsItem>,
)

@Serializable
data class ModelsDevMatch(
    @SerialName("providerId") val `providerId`: String,
    @SerialName("providerName") val `providerName`: String,
    @SerialName("modelId") val `modelId`: String,
    @SerialName("name") val `name`: String,
    @SerialName("exact") val `exact`: Boolean,
    @SerialName("alternatives") val `alternatives`: Long,
    @SerialName("priceUsd") val `priceUsd`: ModelsDevPrice,
    @SerialName("priceCny") val `priceCny`: ModelsDevPrice,
    @SerialName("contextTokens") val `contextTokens`: Long?,
    @SerialName("maxOutputTokens") val `maxOutputTokens`: Long?,
    @SerialName("supportsImage") val `supportsImage`: Boolean?,
)

@Serializable
data class ModelsDevPrice(
    @SerialName("input") val `input`: Double?,
    @SerialName("output") val `output`: Double?,
    @SerialName("cacheRead") val `cacheRead`: Double?,
    @SerialName("cacheWrite") val `cacheWrite`: Double?,
)

@Serializable
data class ModelsDevSettings(
    @SerialName("usdCnyRate") val `usdCnyRate`: Double,
)

@Serializable
data class ModelsDevSettingsInput(
    @SerialName("usdCnyRate") val `usdCnyRate`: Double,
)

@Serializable
data class ModelsDevStatus(
    @SerialName("sourceUrl") val `sourceUrl`: String,
    @SerialName("fetchedAt") val `fetchedAt`: Timestamp?,
    @SerialName("modelCount") val `modelCount`: Long,
    @SerialName("providerCount") val `providerCount`: Long,
    @SerialName("lastAttemptAt") val `lastAttemptAt`: Timestamp?,
    @SerialName("lastError") val `lastError`: String?,
    @SerialName("usdCnyRate") val `usdCnyRate`: Double,
)

@Serializable
data class MomentsActor(
    @SerialName("kind") val `kind`: String,
    @SerialName("refId") val `refId`: Id,
)

@Serializable
data class MomentsBadge(
    @SerialName("unseenPostCount") val `unseenPostCount`: Long,
    @SerialName("characterIds") val `characterIds`: List<Id>,
    @SerialName("unseenInteractionCount") val `unseenInteractionCount`: Long,
)

@Serializable
data class MomentsComment(
    @SerialName("commentId") val `commentId`: Id,
    @SerialName("author") val `author`: MomentsActor,
    @SerialName("replyTo") val `replyTo`: MomentsActor?,
    @SerialName("replyToCommentId") val `replyToCommentId`: Id?,
    @SerialName("text") val `text`: String,
    @SerialName("mentionsUser") val `mentionsUser`: Boolean,
    @SerialName("createdAt") val `createdAt`: Timestamp,
)

@Serializable
data class MomentsEndpointsCommentBody(
    @SerialName("clientRequestId") val `clientRequestId`: Id,
    @SerialName("text") val `text`: String,
    @SerialName("replyToCommentId") val `replyToCommentId`: Id? = null,
)

@Serializable
data class MomentsEndpointsDeleteCommentParams(
    @SerialName("postId") val `postId`: Id,
    @SerialName("commentId") val `commentId`: Id,
)

@Serializable
data class MomentsEndpointsGetPostParams(
    @SerialName("postId") val `postId`: Id,
)

@Serializable
data class MomentsEndpointsListCharacterPostsParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class MomentsEndpointsListCharacterPostsQuery(
    @SerialName("cursor") val `cursor`: String? = null,
    @SerialName("limit") val `limit`: Long? = null,
)

@Serializable
data class MomentsEndpointsListCharacterPostsResponse(
    @SerialName("items") val `items`: List<MomentsPost>,
    @SerialName("nextCursor") val `nextCursor`: String?,
)

@Serializable
data class MomentsEndpointsListFeedQuery(
    @SerialName("cursor") val `cursor`: String? = null,
    @SerialName("limit") val `limit`: Long? = null,
)

@Serializable
data class MomentsEndpointsListFeedResponse(
    @SerialName("items") val `items`: List<MomentsPost>,
    @SerialName("nextCursor") val `nextCursor`: String?,
)

@Serializable
data class MomentsEndpointsListMyPostsQuery(
    @SerialName("cursor") val `cursor`: String? = null,
    @SerialName("limit") val `limit`: Long? = null,
)

@Serializable
data class MomentsEndpointsListMyPostsResponse(
    @SerialName("items") val `items`: List<MomentsPost>,
    @SerialName("nextCursor") val `nextCursor`: String?,
)

@Serializable
data class MomentsEndpointsListNotificationsQuery(
    @SerialName("cursor") val `cursor`: String? = null,
    @SerialName("limit") val `limit`: Long? = null,
)

@Serializable
data class MomentsEndpointsListNotificationsResponse(
    @SerialName("items") val `items`: List<MomentsNotification>,
    @SerialName("nextCursor") val `nextCursor`: String?,
)

@Serializable
data class MomentsEndpointsMarkSeenBody(
    @SerialName("scope") val `scope`: String,
)

@Serializable
data class MomentsImage(
    @SerialName("mediaId") val `mediaId`: Id,
    @SerialName("width") val `width`: Long?,
    @SerialName("height") val `height`: Long?,
)

@Serializable
data class MomentsNotification(
    @SerialName("notificationId") val `notificationId`: String,
    @SerialName("kind") val `kind`: String,
    @SerialName("postId") val `postId`: Id,
    @SerialName("commentId") val `commentId`: Id?,
    @SerialName("actor") val `actor`: MomentsActor,
    @SerialName("text") val `text`: String?,
    @SerialName("post") val `post`: MomentsNotificationPost,
    @SerialName("createdAt") val `createdAt`: Timestamp,
)

typealias MomentsNotificationKind = String

@Serializable
data class MomentsPost(
    @SerialName("postId") val `postId`: Id,
    @SerialName("author") val `author`: MomentsActor,
    @SerialName("text") val `text`: String,
    @SerialName("images") val `images`: List<MomentsImage>,
    @SerialName("link") val `link`: MomentsPostLink?,
    @SerialName("visibility") val `visibility`: MomentsVisibility?,
    @SerialName("likes") val `likes`: List<MomentsActor>,
    @SerialName("likedByMe") val `likedByMe`: Boolean,
    @SerialName("comments") val `comments`: List<MomentsComment>,
    @SerialName("createdAt") val `createdAt`: Timestamp,
)

typealias MomentsVisibility = JsonElement

typealias MomentsVisibilityInput = JsonElement

typealias MoneyMicros = Long

@Serializable
data class NewFriendItem(
    @SerialName("itemId") val `itemId`: Id,
    @SerialName("kind") val `kind`: String,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("recommenderCharacterId") val `recommenderCharacterId`: Id?,
    @SerialName("messageId") val `messageId`: Id?,
    @SerialName("status") val `status`: String,
    @SerialName("createdAt") val `createdAt`: Timestamp,
)

typealias NewFriendStatus = String

@Serializable
data class NewFriendsEndpointsListResponse(
    @SerialName("items") val `items`: List<NewFriendItem>,
    @SerialName("unseenCount") val `unseenCount`: Long,
)

@Serializable
data class NewFriendsEndpointsRemoveParams(
    @SerialName("itemId") val `itemId`: Id,
)

typealias NoContent = JsonElement?

typealias NonNegativePoints = Double

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
    @SerialName("targetKind") val `targetKind`: String? = null,
    @SerialName("suffix") val `suffix`: String? = null,
)

@Serializable
data class NudgeContentInput(
    @EncodeDefault
    @SerialName("type") val `type`: String = "nudge",
    @SerialName("targetParticipantId") val `targetParticipantId`: Id,
    @SerialName("targetKind") val `targetKind`: String? = null,
    @SerialName("suffix") val `suffix`: String? = null,
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
data class PersonaUpdateEndpointsListPersonaUpdatesParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class PersonaUpdateEndpointsListPersonaUpdatesResponse(
    @SerialName("items") val `items`: List<PersonaUpdateNote>,
    @SerialName("unseenCount") val `unseenCount`: Long,
)

@Serializable
data class PersonaUpdateEndpointsMarkPersonaUpdatesSeenParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class PersonaUpdateNote(
    @SerialName("personaVersion") val `personaVersion`: Long,
    @SerialName("summary") val `summary`: String,
    @SerialName("publishedAt") val `publishedAt`: Timestamp,
)

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

@Serializable
data class Pet(
    @SerialName("petId") val `petId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("speciesId") val `speciesId`: Id,
    @SerialName("appearanceId") val `appearanceId`: Id,
    @SerialName("name") val `name`: String,
    @SerialName("stage") val `stage`: String,
    @SerialName("adoptedOn") val `adoptedOn`: LocalDate,
    @SerialName("daysAdopted") val `daysAdopted`: Long,
    @SerialName("intimacy") val `intimacy`: Long,
    @SerialName("todayCountedInteractions") val `todayCountedInteractions`: Long,
    @SerialName("allowMomentsShare") val `allowMomentsShare`: Boolean,
    @SerialName("status") val `status`: String,
    @SerialName("sentAwayAt") val `sentAwayAt`: Timestamp?,
    @SerialName("image") val `image`: PetImage,
)

@Serializable
data class PetAlbumPhoto(
    @SerialName("photoId") val `photoId`: Id,
    @SerialName("mediaId") val `mediaId`: Id,
    @SerialName("source") val `source`: String,
    @SerialName("messageId") val `messageId`: Id?,
    @SerialName("createdAt") val `createdAt`: Timestamp,
)

@Serializable
data class PetAppearance(
    @SerialName("appearanceId") val `appearanceId`: Id,
    @SerialName("name") val `name`: String,
    @SerialName("images") val `images`: PetAppearanceImages,
    @SerialName("listed") val `listed`: Boolean? = null,
)

@Serializable
data class PetDetail(
    @SerialName("petId") val `petId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("speciesId") val `speciesId`: Id,
    @SerialName("appearanceId") val `appearanceId`: Id,
    @SerialName("name") val `name`: String,
    @SerialName("stage") val `stage`: String,
    @SerialName("adoptedOn") val `adoptedOn`: LocalDate,
    @SerialName("daysAdopted") val `daysAdopted`: Long,
    @SerialName("intimacy") val `intimacy`: Long,
    @SerialName("todayCountedInteractions") val `todayCountedInteractions`: Long,
    @SerialName("allowMomentsShare") val `allowMomentsShare`: Boolean,
    @SerialName("status") val `status`: String,
    @SerialName("sentAwayAt") val `sentAwayAt`: Timestamp?,
    @SerialName("image") val `image`: PetImage,
    @SerialName("timeline") val `timeline`: List<PetTimelineEntry>,
)

@Serializable
data class PetEndpointsAddAlbumPhotoBody(
    @SerialName("mediaId") val `mediaId`: Id,
)

@Serializable
data class PetEndpointsAddAlbumPhotoParams(
    @SerialName("petId") val `petId`: Id,
)

@Serializable
data class PetEndpointsAdoptBody(
    @SerialName("clientRequestId") val `clientRequestId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("speciesId") val `speciesId`: Id,
    @SerialName("appearanceId") val `appearanceId`: Id,
    @SerialName("name") val `name`: PetName,
    @SerialName("namingRequestId") val `namingRequestId`: Id? = null,
)

@Serializable
data class PetEndpointsDeleteAlbumPhotoParams(
    @SerialName("petId") val `petId`: Id,
    @SerialName("photoId") val `photoId`: Id,
)

@Serializable
data class PetEndpointsGetNamingRequestParams(
    @SerialName("requestId") val `requestId`: Id,
)

@Serializable
data class PetEndpointsGetPetParams(
    @SerialName("petId") val `petId`: Id,
)

@Serializable
data class PetEndpointsInteractBody(
    @SerialName("kind") val `kind`: PetInteractionKind,
    @SerialName("clientActionId") val `clientActionId`: Id,
)

@Serializable
data class PetEndpointsInteractParams(
    @SerialName("petId") val `petId`: Id,
)

@Serializable
data class PetEndpointsInteractResponse(
    @SerialName("pet") val `pet`: Pet,
    @SerialName("intimacyAdded") val `intimacyAdded`: Long,
)

@Serializable
data class PetEndpointsListAlbumParams(
    @SerialName("petId") val `petId`: Id,
)

@Serializable
data class PetEndpointsListAlbumResponse(
    @SerialName("items") val `items`: List<PetAlbumPhoto>,
)

@Serializable
data class PetEndpointsListPetsQuery(
    @SerialName("characterId") val `characterId`: Id? = null,
)

@Serializable
data class PetEndpointsListPetsResponse(
    @SerialName("items") val `items`: List<Pet>,
)

@Serializable
data class PetEndpointsListSpeciesResponse(
    @SerialName("items") val `items`: List<PetSpecies>,
)

@Serializable
data class PetEndpointsRequestNamesBody(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("speciesId") val `speciesId`: Id,
    @SerialName("appearanceId") val `appearanceId`: Id,
)

@Serializable
data class PetEndpointsSendAwayParams(
    @SerialName("petId") val `petId`: Id,
)

@Serializable
data class PetEndpointsUpdatePetBody(
    @SerialName("name") val `name`: PetName? = null,
    @SerialName("allowMomentsShare") val `allowMomentsShare`: Boolean? = null,
)

@Serializable
data class PetEndpointsUpdatePetParams(
    @SerialName("petId") val `petId`: Id,
)

@Serializable
data class PetImage(
    @SerialName("mediaId") val `mediaId`: Id,
    @SerialName("url") val `url`: String,
)

typealias PetInteractionKind = String

typealias PetName = String

@Serializable
data class PetNamingRequest(
    @SerialName("requestId") val `requestId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("status") val `status`: String,
    @SerialName("names") val `names`: List<String>,
)

@Serializable
data class PetSpecies(
    @SerialName("speciesId") val `speciesId`: Id,
    @SerialName("name") val `name`: String,
    @SerialName("intro") val `intro`: String,
    @SerialName("appearances") val `appearances`: List<PetAppearance>,
    @SerialName("presetNames") val `presetNames`: List<String>,
    @SerialName("listed") val `listed`: Boolean,
)

@Serializable
data class PetSpeciesAdminEndpointsListSpeciesResponse(
    @SerialName("items") val `items`: List<PetSpecies>,
)

@Serializable
data class PetSpeciesAdminEndpointsUpdateSpeciesBody(
    @SerialName("name") val `name`: String? = null,
    @SerialName("intro") val `intro`: String? = null,
    @SerialName("presetNames") val `presetNames`: List<String>? = null,
    @SerialName("listed") val `listed`: Boolean? = null,
    @SerialName("appearances") val `appearances`: List<PetSpeciesAdminEndpointsUpdateSpeciesBodyAppearancesItem>? = null,
)

@Serializable
data class PetSpeciesAdminEndpointsUpdateSpeciesParams(
    @SerialName("speciesId") val `speciesId`: Id,
)

@Serializable
data class PetSpeciesWrite(
    @SerialName("name") val `name`: String,
    @SerialName("intro") val `intro`: String,
    @SerialName("presetNames") val `presetNames`: List<String>,
    @SerialName("listed") val `listed`: Boolean,
    @SerialName("appearances") val `appearances`: List<PetSpeciesWriteAppearancesItem>,
)

@Serializable
data class PetSpeciesWriteInput(
    @SerialName("name") val `name`: String,
    @SerialName("intro") val `intro`: String,
    @SerialName("presetNames") val `presetNames`: List<String>,
    @SerialName("listed") val `listed`: Boolean,
    @SerialName("appearances") val `appearances`: List<PetSpeciesWriteInputAppearancesItem>,
)

typealias PetStage = String

@Serializable
data class PetTimelineEntry(
    @SerialName("kind") val `kind`: String,
    @SerialName("at") val `at`: Timestamp,
    @SerialName("detail") val `detail`: Map<String, String>,
)

@Serializable
data class PlannerAdminEndpointsGetConfigResponse(
    @SerialName("items") val `items`: List<PlannerConfigEntry>,
)

@Serializable
data class PlannerAdminEndpointsListDecisionsQuery(
    @SerialName("userId") val `userId`: Id? = null,
    @SerialName("characterId") val `characterId`: Id? = null,
    @SerialName("decisionType") val `decisionType`: PlanningDecisionType? = null,
    @SerialName("fallback") val `fallback`: PlanningFallback? = null,
    @SerialName("from") val `from`: Timestamp? = null,
    @SerialName("to") val `to`: Timestamp? = null,
    @SerialName("cursor") val `cursor`: String? = null,
)

@Serializable
data class PlannerAdminEndpointsListDecisionsResponse(
    @SerialName("items") val `items`: List<PlanningDecisionRecord>,
    @SerialName("nextCursor") val `nextCursor`: String?,
)

@Serializable
data class PlannerAdminEndpointsUpdateConfigBody(
    @SerialName("implementation") val `implementation`: PlannerImplementation,
    @SerialName("modelKey") val `modelKey`: String?,
    @SerialName("confidenceThreshold") val `confidenceThreshold`: Double,
    @SerialName("evalReportId") val `evalReportId`: String?,
)

@Serializable
data class PlannerAdminEndpointsUpdateConfigParams(
    @SerialName("decisionType") val `decisionType`: PlanningDecisionType,
)

@Serializable
data class PlannerConfigEntry(
    @SerialName("decisionType") val `decisionType`: String,
    @SerialName("implementation") val `implementation`: String,
    @SerialName("modelKey") val `modelKey`: String?,
    @SerialName("confidenceThreshold") val `confidenceThreshold`: Double,
    @SerialName("evalReportId") val `evalReportId`: String?,
    @SerialName("updatedBy") val `updatedBy`: Id?,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
    @SerialName("circuitOpenUntil") val `circuitOpenUntil`: Timestamp? = null,
)

typealias PlannerImplementation = String

@Serializable
data class PlanningDecisionRecord(
    @SerialName("decisionId") val `decisionId`: Id,
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id?,
    @SerialName("conversationId") val `conversationId`: Id?,
    @SerialName("decisionType") val `decisionType`: String,
    @SerialName("options") val `options`: List<String>,
    @SerialName("choice") val `choice`: String,
    @SerialName("confidence") val `confidence`: Double,
    @SerialName("reason") val `reason`: String,
    @SerialName("implementation") val `implementation`: String,
    @SerialName("fallback") val `fallback`: String?,
    @SerialName("latencyMs") val `latencyMs`: Long,
    @SerialName("usageRecordId") val `usageRecordId`: Id?,
    @SerialName("createdAt") val `createdAt`: Timestamp,
)

typealias PlanningDecisionType = String

typealias PlanningFallback = String

typealias PlatformInternalUse = String

@Serializable
data class PlazaAdminEndpointsBanAuthorBody(
    @SerialName("until") val `until`: String,
    @SerialName("reason") val `reason`: String,
)

@Serializable
data class PlazaAdminEndpointsBanAuthorParams(
    @SerialName("userId") val `userId`: Id,
)

@Serializable
data class PlazaAdminEndpointsDeleteCommentParams(
    @SerialName("commentId") val `commentId`: Id,
)

@Serializable
data class PlazaAdminEndpointsGetWorkParams(
    @SerialName("workId") val `workId`: Id,
)

@Serializable
data class PlazaAdminEndpointsGetWorkVersionParams(
    @SerialName("workId") val `workId`: Id,
    @SerialName("version") val `version`: Long,
)

@Serializable
data class PlazaAdminEndpointsGetWorkVersionResponse(
    @SerialName("snapshot") val `snapshot`: PlazaSnapshot,
    @SerialName("settings") val `settings`: PlazaPublishSettings,
    @SerialName("createdAt") val `createdAt`: Timestamp,
)

@Serializable
data class PlazaAdminEndpointsListBansQuery(
    @SerialName("cursor") val `cursor`: String? = null,
    @SerialName("limit") val `limit`: Long? = null,
)

@Serializable
data class PlazaAdminEndpointsListBansResponse(
    @SerialName("items") val `items`: List<PlazaAdminEndpointsListBansResponseItemsItem>,
    @SerialName("nextCursor") val `nextCursor`: String?,
)

@Serializable
data class PlazaAdminEndpointsListReportsQuery(
    @SerialName("status") val `status`: String? = null,
    @SerialName("cursor") val `cursor`: String? = null,
)

@Serializable
data class PlazaAdminEndpointsListReportsResponse(
    @SerialName("items") val `items`: List<AdminPlazaReport>,
    @SerialName("nextCursor") val `nextCursor`: String?,
)

@Serializable
data class PlazaAdminEndpointsListWorksQuery(
    @SerialName("authorUserId") val `authorUserId`: Id? = null,
    @SerialName("kind") val `kind`: PlazaWorkKind? = null,
    @SerialName("basis") val `basis`: CharacterBasis? = null,
    @SerialName("status") val `status`: PlazaWorkStatus? = null,
    @SerialName("minReports") val `minReports`: Long? = null,
    @SerialName("cursor") val `cursor`: String? = null,
)

@Serializable
data class PlazaAdminEndpointsListWorksResponse(
    @SerialName("items") val `items`: List<AdminPlazaWork>,
    @SerialName("nextCursor") val `nextCursor`: String?,
)

@Serializable
data class PlazaAdminEndpointsRemoveWorkBody(
    @SerialName("reason") val `reason`: String,
)

@Serializable
data class PlazaAdminEndpointsRemoveWorkParams(
    @SerialName("workId") val `workId`: Id,
)

@Serializable
data class PlazaAdminEndpointsResolveReportBody(
    @SerialName("action") val `action`: String,
    @SerialName("reason") val `reason`: String,
)

@Serializable
data class PlazaAdminEndpointsResolveReportParams(
    @SerialName("reportId") val `reportId`: Id,
)

@Serializable
data class PlazaAdminEndpointsTightenClassificationBody(
    @SerialName("basis") val `basis`: CharacterBasis,
    @SerialName("realPersonKind") val `realPersonKind`: RealPersonKind?,
    @SerialName("ageSetting") val `ageSetting`: AgeSetting,
    @SerialName("childAppearance") val `childAppearance`: Boolean,
    @SerialName("reason") val `reason`: String,
)

@Serializable
data class PlazaAdminEndpointsTightenClassificationResponse(
    @SerialName("work") val `work`: AdminPlazaWork,
    @SerialName("affectedCharacterCount") val `affectedCharacterCount`: Long,
)

@Serializable
data class PlazaAdminEndpointsUnbanAuthorParams(
    @SerialName("userId") val `userId`: Id,
)

@Serializable
data class PlazaAuthor(
    @SerialName("authorId") val `authorId`: Id,
    @SerialName("nickname") val `nickname`: String,
    @SerialName("avatarUrl") val `avatarUrl`: String?,
    @SerialName("deleted") val `deleted`: Boolean,
)

@Serializable
data class PlazaAuthorProfile(
    @SerialName("authorId") val `authorId`: Id,
    @SerialName("nickname") val `nickname`: String,
    @SerialName("avatarMediaId") val `avatarMediaId`: Id?,
    @SerialName("avatarUrl") val `avatarUrl`: String?,
    @SerialName("bannedUntil") val `bannedUntil`: String?,
)

@Serializable
data class PlazaBadge(
    @SerialName("myWorksUnseen") val `myWorksUnseen`: Long,
    @SerialName("reportResultsUnseen") val `reportResultsUnseen`: Long,
    @SerialName("adoptedUpdatesAvailable") val `adoptedUpdatesAvailable`: Long,
)

@Serializable
data class PlazaComment(
    @SerialName("commentId") val `commentId`: Id,
    @SerialName("author") val `author`: PlazaAuthor,
    @SerialName("replyTo") val `replyTo`: PlazaAuthor?,
    @SerialName("replyToCommentId") val `replyToCommentId`: Id?,
    @SerialName("text") val `text`: String,
    @SerialName("createdAt") val `createdAt`: Timestamp,
    @SerialName("deletable") val `deletable`: Boolean,
)

@Serializable
data class PlazaCustomCharacterSnapshot(
    @EncodeDefault
    @SerialName("kind") val `kind`: String = "custom_character",
    @SerialName("name") val `name`: String,
    @SerialName("classification") val `classification`: PlazaSnapshotClassification,
    @SerialName("description") val `description`: String,
    @SerialName("speechStyle") val `speechStyle`: String,
    @SerialName("catchphrases") val `catchphrases`: List<String>,
    @SerialName("exampleDialogue") val `exampleDialogue`: String,
    @SerialName("tags") val `tags`: List<String>,
    @SerialName("birthday") val `birthday`: LocalDate?,
    @SerialName("voiceName") val `voiceName`: String?,
    @SerialName("avatarMediaId") val `avatarMediaId`: Id?,
)

@Serializable
data class PlazaEndpointsAddCommentBody(
    @SerialName("clientRequestId") val `clientRequestId`: Id,
    @SerialName("text") val `text`: String,
    @SerialName("replyToCommentId") val `replyToCommentId`: Id? = null,
)

@Serializable
data class PlazaEndpointsAdoptBody(
    @SerialName("adoptionId") val `adoptionId`: Id,
)

@Serializable
data class PlazaEndpointsAdoptResponse(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("workVersion") val `workVersion`: Long,
)

@Serializable
data class PlazaEndpointsApplyBody(
    @SerialName("adoptionId") val `adoptionId`: Id,
    @SerialName("confirmReplaceSupplement") val `confirmReplaceSupplement`: Boolean,
)

@Serializable
data class PlazaEndpointsApplyResponse(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("workVersion") val `workVersion`: Long,
)

@Serializable
data class PlazaEndpointsConfirmPublishBody(
    @SerialName("settings") val `settings`: PlazaPublishSettings,
    @SerialName("keptSpanIds") val `keptSpanIds`: List<String>,
    @SerialName("avatarRightsConfirmed") val `avatarRightsConfirmed`: Boolean,
    @SerialName("changeNote") val `changeNote`: String? = null,
)

@Serializable
data class PlazaEndpointsConfirmPublishParams(
    @SerialName("draftId") val `draftId`: Id,
)

@Serializable
data class PlazaEndpointsCreatePublishDraftBody(
    @SerialName("source") val `source`: PlazaPublishSourceInput,
)

@Serializable
data class PlazaEndpointsDeleteCommentParams(
    @SerialName("commentId") val `commentId`: Id,
)

@Serializable
data class PlazaEndpointsGetAuthorParams(
    @SerialName("authorId") val `authorId`: Id,
)

typealias PlazaEndpointsGetMyProfileResponse = PlazaAuthorProfile?

@Serializable
data class PlazaEndpointsLikeResponse(
    @SerialName("likeCount") val `likeCount`: Long,
    @SerialName("likedByMe") val `likedByMe`: Boolean,
)

@Serializable
data class PlazaEndpointsListCommentsQuery(
    @SerialName("cursor") val `cursor`: String? = null,
)

@Serializable
data class PlazaEndpointsListCommentsResponse(
    @SerialName("items") val `items`: List<PlazaComment>,
    @SerialName("nextCursor") val `nextCursor`: String?,
)

@Serializable
data class PlazaEndpointsListMyWorksResponse(
    @SerialName("items") val `items`: List<PlazaWorkDetail>,
)

@Serializable
data class PlazaEndpointsListNoticesQuery(
    @SerialName("cursor") val `cursor`: String? = null,
)

@Serializable
data class PlazaEndpointsListNoticesResponse(
    @SerialName("items") val `items`: List<PlazaNotice>,
    @SerialName("nextCursor") val `nextCursor`: String?,
)

@Serializable
data class PlazaEndpointsListWorksResponse(
    @SerialName("items") val `items`: List<PlazaWorkCard>,
    @SerialName("nextCursor") val `nextCursor`: String?,
)

@Serializable
data class PlazaEndpointsPutMyProfileBody(
    @SerialName("nickname") val `nickname`: String,
    @SerialName("avatarMediaId") val `avatarMediaId`: Id?,
)

@Serializable
data class PlazaEndpointsReportBody(
    @SerialName("target") val `target`: PlazaEndpointsReportBodyTarget,
    @SerialName("reason") val `reason`: PlazaReportReason,
    @SerialName("note") val `note`: String? = null,
)

@Serializable
data class PlazaEndpointsUnlikeResponse(
    @SerialName("likeCount") val `likeCount`: Long,
    @SerialName("likedByMe") val `likedByMe`: Boolean,
)

@Serializable
data class PlazaEndpointsUpdateAdoptedBody(
    @SerialName("decision") val `decision`: String,
    @SerialName("confirmOverwrite") val `confirmOverwrite`: Boolean? = null,
)

@Serializable
data class PlazaEndpointsUpdateAdoptedParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class PlazaEndpointsUpdateAdoptedResponse(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("workVersion") val `workVersion`: Long,
)

@Serializable
data class PlazaEndpointsUpdateWorkSettingsBody(
    @SerialName("tagline") val `tagline`: String? = null,
    @SerialName("publishNote") val `publishNote`: String? = null,
    @SerialName("allowRemix") val `allowRemix`: Boolean? = null,
    @SerialName("commentsOpen") val `commentsOpen`: Boolean? = null,
)

@Serializable
data class PlazaNotice(
    @SerialName("noticeId") val `noticeId`: Id,
    @SerialName("kind") val `kind`: String,
    @SerialName("workId") val `workId`: Id?,
    @SerialName("text") val `text`: String,
    @SerialName("seen") val `seen`: Boolean,
    @SerialName("createdAt") val `createdAt`: Timestamp,
)

@Serializable
data class PlazaOfficialAdminEndpointsListCommentsQuery(
    @SerialName("characterId") val `characterId`: Id? = null,
    @SerialName("cursor") val `cursor`: String? = null,
)

@Serializable
data class PlazaOfficialAdminEndpointsListCommentsResponse(
    @SerialName("items") val `items`: List<AdminPlazaOfficialComment>,
    @SerialName("nextCursor") val `nextCursor`: String?,
)

@Serializable
data class PlazaOfficialCard(
    @SerialName("character") val `character`: CharacterSummary,
    @SerialName("likeCount") val `likeCount`: Long,
    @SerialName("commentCount") val `commentCount`: Long,
    @SerialName("likedByMe") val `likedByMe`: Boolean,
)

@Serializable
data class PlazaOfficialDetail(
    @SerialName("character") val `character`: CharacterProfile,
    @SerialName("persona") val `persona`: PlazaOfficialPersona,
    @SerialName("likeCount") val `likeCount`: Long,
    @SerialName("commentCount") val `commentCount`: Long,
    @SerialName("likedByMe") val `likedByMe`: Boolean,
)

@Serializable
data class PlazaOfficialEndpointsAddCommentBody(
    @SerialName("clientRequestId") val `clientRequestId`: Id,
    @SerialName("text") val `text`: String,
    @SerialName("replyToCommentId") val `replyToCommentId`: Id? = null,
)

@Serializable
data class PlazaOfficialEndpointsGetParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class PlazaOfficialEndpointsLikeResponse(
    @SerialName("likeCount") val `likeCount`: Long,
    @SerialName("likedByMe") val `likedByMe`: Boolean,
)

@Serializable
data class PlazaOfficialEndpointsListResponse(
    @SerialName("items") val `items`: List<PlazaOfficialCard>,
    @SerialName("nextCursor") val `nextCursor`: String?,
)

@Serializable
data class PlazaOfficialEndpointsListCommentsQuery(
    @SerialName("cursor") val `cursor`: String? = null,
)

@Serializable
data class PlazaOfficialEndpointsListCommentsResponse(
    @SerialName("items") val `items`: List<PlazaComment>,
    @SerialName("nextCursor") val `nextCursor`: String?,
)

@Serializable
data class PlazaOfficialPersona(
    @SerialName("summary") val `summary`: String,
    @SerialName("personality") val `personality`: String,
    @SerialName("speechStyle") val `speechStyle`: String,
    @SerialName("catchphrases") val `catchphrases`: List<String>,
)

typealias PlazaOfficialSort = String

@Serializable
data class PlazaPresetVariantSnapshot(
    @EncodeDefault
    @SerialName("kind") val `kind`: String = "preset_variant",
    @SerialName("presetCharacterId") val `presetCharacterId`: Id,
    @SerialName("variantText") val `variantText`: String,
    @SerialName("childFeaturesDetected") val `childFeaturesDetected`: Boolean? = null,
)

@Serializable
data class PlazaPublishDraft(
    @SerialName("draftId") val `draftId`: Id,
    @SerialName("workId") val `workId`: Id?,
    @SerialName("snapshot") val `snapshot`: PlazaSnapshot,
    @SerialName("spans") val `spans`: List<PrivacySpan>,
    @SerialName("childFeaturesDetected") val `childFeaturesDetected`: Boolean,
    @SerialName("needsAuthorProfile") val `needsAuthorProfile`: Boolean,
    @SerialName("expiresAt") val `expiresAt`: Timestamp,
)

@Serializable
data class PlazaPublishSettings(
    @SerialName("tagline") val `tagline`: String,
    @SerialName("publishNote") val `publishNote`: String,
    @SerialName("allowRemix") val `allowRemix`: Boolean,
    @SerialName("commentsOpen") val `commentsOpen`: Boolean,
)

typealias PlazaPublishSource = JsonElement

typealias PlazaPublishSourceInput = JsonElement

typealias PlazaReportReason = String

typealias PlazaSnapshot = JsonElement

@Serializable
data class PlazaSnapshotClassification(
    @SerialName("basis") val `basis`: CharacterBasis,
    @SerialName("realPersonKind") val `realPersonKind`: RealPersonKind?,
    @SerialName("ageSetting") val `ageSetting`: AgeSetting,
    @SerialName("childAppearance") val `childAppearance`: Boolean,
    @SerialName("childFeaturesDetected") val `childFeaturesDetected`: Boolean,
    @SerialName("everPrivatePerson") val `everPrivatePerson`: Boolean,
)

typealias PlazaSort = String

@Serializable
data class PlazaVersionNote(
    @SerialName("version") val `version`: Long,
    @SerialName("changeNote") val `changeNote`: String?,
    @SerialName("createdAt") val `createdAt`: Timestamp,
)

@Serializable
data class PlazaWorkCard(
    @SerialName("workId") val `workId`: Id,
    @SerialName("kind") val `kind`: String,
    @SerialName("name") val `name`: String,
    @SerialName("tagline") val `tagline`: String,
    @SerialName("basis") val `basis`: String?,
    @SerialName("basedOnPresetId") val `basedOnPresetId`: Id?,
    @SerialName("basedOnPresetName") val `basedOnPresetName`: String?,
    @SerialName("avatarUrl") val `avatarUrl`: String?,
    @SerialName("author") val `author`: PlazaAuthor,
    @SerialName("likeCount") val `likeCount`: Long,
    @SerialName("adoptCount") val `adoptCount`: Long,
    @SerialName("commentCount") val `commentCount`: Long,
    @SerialName("adoptedByMe") val `adoptedByMe`: Boolean,
    @SerialName("likedByMe") val `likedByMe`: Boolean,
    @SerialName("currentVersion") val `currentVersion`: Long,
    @SerialName("publishedAt") val `publishedAt`: Timestamp,
)

@Serializable
data class PlazaWorkDetail(
    @SerialName("workId") val `workId`: Id,
    @SerialName("kind") val `kind`: String,
    @SerialName("name") val `name`: String,
    @SerialName("tagline") val `tagline`: String,
    @SerialName("basis") val `basis`: String?,
    @SerialName("basedOnPresetId") val `basedOnPresetId`: Id?,
    @SerialName("basedOnPresetName") val `basedOnPresetName`: String?,
    @SerialName("avatarUrl") val `avatarUrl`: String?,
    @SerialName("author") val `author`: PlazaAuthor,
    @SerialName("likeCount") val `likeCount`: Long,
    @SerialName("adoptCount") val `adoptCount`: Long,
    @SerialName("commentCount") val `commentCount`: Long,
    @SerialName("adoptedByMe") val `adoptedByMe`: Boolean,
    @SerialName("likedByMe") val `likedByMe`: Boolean,
    @SerialName("currentVersion") val `currentVersion`: Long,
    @SerialName("publishedAt") val `publishedAt`: Timestamp,
    @SerialName("status") val `status`: String,
    @SerialName("settings") val `settings`: PlazaPublishSettings,
    @SerialName("snapshot") val `snapshot`: PlazaSnapshot,
    @SerialName("versions") val `versions`: List<PlazaVersionNote>,
    @SerialName("remixOf") val `remixOf`: PlazaWorkDetailRemixOf?,
    @SerialName("isMine") val `isMine`: Boolean,
    @SerialName("sourceCharacterId") val `sourceCharacterId`: Id? = null,
    @SerialName("myAdoptedCharacterId") val `myAdoptedCharacterId`: Id? = null,
    @SerialName("removedReason") val `removedReason`: String? = null,
    @SerialName("unreadCount") val `unreadCount`: Long? = null,
)

typealias PlazaWorkKind = String

typealias PlazaWorkStatus = String

@Serializable
data class Plugin(
    @SerialName("pluginId") val `pluginId`: String,
    @SerialName("name") val `name`: String,
    @SerialName("description") val `description`: String,
    @SerialName("status") val `status`: String,
)

@Serializable
data class PluginEndpointsListResponse(
    @SerialName("items") val `items`: List<Plugin>,
)

typealias PluginId = String

typealias PluginStatus = String

typealias Points = Double

typealias PortraitPolicy = String

typealias PositiveMoneyMicros = Long

@Serializable
data class PostpaidSettings(
    @SerialName("maxConcurrentPaidCalls") val `maxConcurrentPaidCalls`: Long,
    @SerialName("concurrencyWaitSeconds") val `concurrencyWaitSeconds`: Long,
    @SerialName("largeRequestLimitPoints") val `largeRequestLimitPoints`: Long,
    @SerialName("updatedAt") val `updatedAt`: Timestamp?,
)

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

typealias PrivacyKind = String

@Serializable
data class PrivacySpan(
    @SerialName("spanId") val `spanId`: String,
    @SerialName("fieldKey") val `fieldKey`: String,
    @SerialName("start") val `start`: Long,
    @SerialName("end") val `end`: Long,
    @SerialName("kinds") val `kinds`: List<String>,
)

typealias ProactiveFrequency = String

@Serializable
data class Profile(
    @SerialName("nickname") val `nickname`: String?,
    @SerialName("avatarMediaId") val `avatarMediaId`: Id?,
    @SerialName("momentsCoverMediaId") val `momentsCoverMediaId`: Id? = null,
    @SerialName("birthday") val `birthday`: LocalDate?,
    @SerialName("gender") val `gender`: Gender,
    @SerialName("city") val `city`: String?,
    @SerialName("about") val `about`: String?,
    @SerialName("nudgeSuffix") val `nudgeSuffix`: String? = null,
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
    @SerialName("points") val `points`: NonNegativePoints? = null,
)

@Serializable
data class PublicUpdate(
    @SerialName("updateId") val `updateId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("characterName") val `characterName`: String,
    @SerialName("kind") val `kind`: PublicUpdateKind,
    @SerialName("content") val `content`: String,
    @SerialName("startDate") val `startDate`: LocalDate,
    @SerialName("endDate") val `endDate`: LocalDate?,
    @SerialName("effectiveDate") val `effectiveDate`: LocalDate,
    @SerialName("sourceUrl") val `sourceUrl`: String,
    @SerialName("source") val `source`: PublicUpdateSource,
    @SerialName("status") val `status`: PublicUpdateStatus,
    @SerialName("reviewNote") val `reviewNote`: String?,
    @SerialName("createdBy") val `createdBy`: Id?,
    @SerialName("reviewedBy") val `reviewedBy`: Id?,
    @SerialName("reviewedAt") val `reviewedAt`: Timestamp?,
    @SerialName("createdAt") val `createdAt`: Timestamp,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
)

@Serializable
data class PublicUpdateAdminEndpointsGetParams(
    @SerialName("updateId") val `updateId`: Id,
)

@Serializable
data class PublicUpdateAdminEndpointsListQuery(
    @SerialName("status") val `status`: PublicUpdateStatus? = null,
    @SerialName("source") val `source`: PublicUpdateSource? = null,
    @SerialName("characterId") val `characterId`: Id? = null,
    @SerialName("limit") val `limit`: Long? = null,
    @SerialName("cursor") val `cursor`: String? = null,
)

@Serializable
data class PublicUpdateAdminEndpointsListResponse(
    @SerialName("items") val `items`: List<PublicUpdate>,
    @SerialName("nextCursor") val `nextCursor`: String?,
)

@Serializable
data class PublicUpdateAdminEndpointsTriggerSearchParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class PublicUpdateAdminEndpointsUpdateSettingsBody(
    @SerialName("autoSearchEnabled") val `autoSearchEnabled`: Boolean,
)

typealias PublicUpdateKind = String

@Serializable
data class PublicUpdateSearchResult(
    @SerialName("outcome") val `outcome`: String,
    @SerialName("created") val `created`: List<PublicUpdate>,
    @SerialName("duplicates") val `duplicates`: Long,
)

@Serializable
data class PublicUpdateSettings(
    @SerialName("autoSearchEnabled") val `autoSearchEnabled`: Boolean,
    @SerialName("lastAutoRunAt") val `lastAutoRunAt`: Timestamp?,
    @SerialName("updatedAt") val `updatedAt`: Timestamp?,
)

typealias PublicUpdateSource = String

typealias PublicUpdateStatus = String

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
data class QuietState(
    @SerialName("inconvenientUntil") val `inconvenientUntil`: Timestamp?,
    @SerialName("focusUntil") val `focusUntil`: Timestamp?,
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
    @SerialName("mentions") val `mentions`: List<Id>? = null,
) : ReceivedMessageContent

@Serializable
data class ReceivedMessageContentNudge(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "nudge",
    @SerialName("targetParticipantId") val `targetParticipantId`: Id,
    @SerialName("targetKind") val `targetKind`: String? = null,
    @SerialName("suffix") val `suffix`: String? = null,
) : ReceivedMessageContent

@Serializable
data class ReceivedMessageContentSystem(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "system",
    @SerialName("code") val `code`: String,
    @SerialName("params") val `params`: Map<String, ReceivedMessageContentSystemParamsValue>,
) : ReceivedMessageContent

@Serializable
data class ReceivedMessageContentImage(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "image",
    @SerialName("mediaId") val `mediaId`: Id,
    @SerialName("width") val `width`: Long?,
    @SerialName("height") val `height`: Long?,
    @SerialName("sizeBytes") val `sizeBytes`: Long? = null,
) : ReceivedMessageContent

@Serializable
data class ReceivedMessageContentVoice(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "voice",
    @SerialName("mediaId") val `mediaId`: Id,
    @SerialName("durationMs") val `durationMs`: Long,
    @SerialName("transcript") val `transcript`: String?,
) : ReceivedMessageContent

@Serializable
data class ReceivedMessageContentSticker(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "sticker",
    @SerialName("stickerId") val `stickerId`: Id,
    @SerialName("source") val `source`: String,
    @SerialName("mediaId") val `mediaId`: Id,
    @SerialName("description") val `description`: String?,
) : ReceivedMessageContent

@Serializable
data class ReceivedMessageContentLink(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "link",
    @SerialName("url") val `url`: String,
    @SerialName("title") val `title`: String,
    @SerialName("source") val `source`: String?,
    @SerialName("description") val `description`: String?,
    @SerialName("coverMediaId") val `coverMediaId`: Id?,
    @SerialName("appHint") val `appHint`: String,
) : ReceivedMessageContent

@Serializable
data class ReceivedMessageContentContactCard(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "contact_card",
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("name") val `name`: String,
    @SerialName("recommenderCharacterId") val `recommenderCharacterId`: Id,
) : ReceivedMessageContent

@Serializable
data class ReceivedMessageContentCallRecord(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "call_record",
    @SerialName("callId") val `callId`: Id,
    @SerialName("direction") val `direction`: CallDirection,
    @SerialName("outcome") val `outcome`: String,
    @SerialName("durationSec") val `durationSec`: Long,
) : ReceivedMessageContent

@Serializable
data class ReceivedMessageContentLetter(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "letter",
    @SerialName("letterId") val `letterId`: Id,
    @SerialName("direction") val `direction`: String,
    @SerialName("body") val `body`: String,
) : ReceivedMessageContent

@Serializable
data class ReceivedMessageContentDailyQuestion(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "daily_question",
    @SerialName("answerId") val `answerId`: Id,
    @SerialName("questionId") val `questionId`: Id,
    @SerialName("date") val `date`: String,
    @SerialName("question") val `question`: String,
    @SerialName("answer") val `answer`: String,
) : ReceivedMessageContent

@Serializable
data class ReceivedMessageContentActionCard(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "action_card",
    @SerialName("cardKind") val `cardKind`: String,
    @SerialName("text") val `text`: String,
    @SerialName("actions") val `actions`: List<ReceivedMessageContentActionCardActionsItem>,
    @SerialName("ref") val `ref`: ReceivedMessageContentActionCardRef?,
) : ReceivedMessageContent

@Serializable
data class ReceivedMessageContentForwardedRecord(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "forwarded_record",
    @SerialName("title") val `title`: String,
    @SerialName("items") val `items`: List<ReceivedMessageContentForwardedRecordItemsItem>,
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
            "image" -> input.json.decodeFromJsonElement(ReceivedMessageContentImage.serializer(), value)
            "voice" -> input.json.decodeFromJsonElement(ReceivedMessageContentVoice.serializer(), value)
            "sticker" -> input.json.decodeFromJsonElement(ReceivedMessageContentSticker.serializer(), value)
            "link" -> input.json.decodeFromJsonElement(ReceivedMessageContentLink.serializer(), value)
            "contact_card" -> input.json.decodeFromJsonElement(ReceivedMessageContentContactCard.serializer(), value)
            "call_record" -> input.json.decodeFromJsonElement(ReceivedMessageContentCallRecord.serializer(), value)
            "letter" -> input.json.decodeFromJsonElement(ReceivedMessageContentLetter.serializer(), value)
            "daily_question" -> input.json.decodeFromJsonElement(ReceivedMessageContentDailyQuestion.serializer(), value)
            "action_card" -> input.json.decodeFromJsonElement(ReceivedMessageContentActionCard.serializer(), value)
            "forwarded_record" -> input.json.decodeFromJsonElement(ReceivedMessageContentForwardedRecord.serializer(), value)
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
            is ReceivedMessageContentImage -> output.json.encodeToJsonElement(ReceivedMessageContentImage.serializer(), value)
            is ReceivedMessageContentVoice -> output.json.encodeToJsonElement(ReceivedMessageContentVoice.serializer(), value)
            is ReceivedMessageContentSticker -> output.json.encodeToJsonElement(ReceivedMessageContentSticker.serializer(), value)
            is ReceivedMessageContentLink -> output.json.encodeToJsonElement(ReceivedMessageContentLink.serializer(), value)
            is ReceivedMessageContentContactCard -> output.json.encodeToJsonElement(ReceivedMessageContentContactCard.serializer(), value)
            is ReceivedMessageContentCallRecord -> output.json.encodeToJsonElement(ReceivedMessageContentCallRecord.serializer(), value)
            is ReceivedMessageContentLetter -> output.json.encodeToJsonElement(ReceivedMessageContentLetter.serializer(), value)
            is ReceivedMessageContentDailyQuestion -> output.json.encodeToJsonElement(ReceivedMessageContentDailyQuestion.serializer(), value)
            is ReceivedMessageContentActionCard -> output.json.encodeToJsonElement(ReceivedMessageContentActionCard.serializer(), value)
            is ReceivedMessageContentForwardedRecord -> output.json.encodeToJsonElement(ReceivedMessageContentForwardedRecord.serializer(), value)
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
data class ReceivedUserUpdatePayloadMessageUpdated(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "message.updated",
    @SerialName("data") val `data`: ReceivedUserUpdatePayloadMessageUpdatedData,
) : ReceivedUserUpdatePayload

@Serializable
data class ReceivedUserUpdatePayloadCallUpdated(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "call.updated",
    @SerialName("data") val `data`: ReceivedUserUpdatePayloadCallUpdatedData,
) : ReceivedUserUpdatePayload

@Serializable
data class ReceivedUserUpdatePayloadMediaTranscriptReady(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "media.transcript_ready",
    @SerialName("data") val `data`: ReceivedUserUpdatePayloadMediaTranscriptReadyData,
) : ReceivedUserUpdatePayload

@Serializable
data class ReceivedUserUpdatePayloadMomentsBadgeUpdated(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "moments.badge_updated",
    @SerialName("data") val `data`: ReceivedUserUpdatePayloadMomentsBadgeUpdatedData,
) : ReceivedUserUpdatePayload

@Serializable
data class ReceivedUserUpdatePayloadMomentsPostChanged(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "moments.post_changed",
    @SerialName("data") val `data`: ReceivedUserUpdatePayloadMomentsPostChangedData,
) : ReceivedUserUpdatePayload

@Serializable
data class ReceivedUserUpdatePayloadDataChanged(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "data.changed",
    @SerialName("data") val `data`: ReceivedUserUpdatePayloadDataChangedData,
) : ReceivedUserUpdatePayload

@Serializable
data class ReceivedUserUpdatePayloadConversationRemoved(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "conversation.removed",
    @SerialName("data") val `data`: ReceivedUserUpdatePayloadConversationRemovedData,
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
            "message.updated" -> input.json.decodeFromJsonElement(ReceivedUserUpdatePayloadMessageUpdated.serializer(), value)
            "call.updated" -> input.json.decodeFromJsonElement(ReceivedUserUpdatePayloadCallUpdated.serializer(), value)
            "media.transcript_ready" -> input.json.decodeFromJsonElement(ReceivedUserUpdatePayloadMediaTranscriptReady.serializer(), value)
            "moments.badge_updated" -> input.json.decodeFromJsonElement(ReceivedUserUpdatePayloadMomentsBadgeUpdated.serializer(), value)
            "moments.post_changed" -> input.json.decodeFromJsonElement(ReceivedUserUpdatePayloadMomentsPostChanged.serializer(), value)
            "data.changed" -> input.json.decodeFromJsonElement(ReceivedUserUpdatePayloadDataChanged.serializer(), value)
            "conversation.removed" -> input.json.decodeFromJsonElement(ReceivedUserUpdatePayloadConversationRemoved.serializer(), value)
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
            is ReceivedUserUpdatePayloadMessageUpdated -> output.json.encodeToJsonElement(ReceivedUserUpdatePayloadMessageUpdated.serializer(), value)
            is ReceivedUserUpdatePayloadCallUpdated -> output.json.encodeToJsonElement(ReceivedUserUpdatePayloadCallUpdated.serializer(), value)
            is ReceivedUserUpdatePayloadMediaTranscriptReady -> output.json.encodeToJsonElement(ReceivedUserUpdatePayloadMediaTranscriptReady.serializer(), value)
            is ReceivedUserUpdatePayloadMomentsBadgeUpdated -> output.json.encodeToJsonElement(ReceivedUserUpdatePayloadMomentsBadgeUpdated.serializer(), value)
            is ReceivedUserUpdatePayloadMomentsPostChanged -> output.json.encodeToJsonElement(ReceivedUserUpdatePayloadMomentsPostChanged.serializer(), value)
            is ReceivedUserUpdatePayloadDataChanged -> output.json.encodeToJsonElement(ReceivedUserUpdatePayloadDataChanged.serializer(), value)
            is ReceivedUserUpdatePayloadConversationRemoved -> output.json.encodeToJsonElement(ReceivedUserUpdatePayloadConversationRemoved.serializer(), value)
            is ReceivedUserUpdatePayloadUnsupported -> output.json.encodeToJsonElement(ReceivedUserUpdatePayloadUnsupported.serializer(), value)
        }
        output.encodeJsonElement(element)
    }
}

@Serializable
data class RechargeOptions(
    @SerialName("paymentEnabled") val `paymentEnabled`: Boolean,
    @SerialName("tiers") val `tiers`: List<RechargeTier>,
    @SerialName("contactHint") val `contactHint`: String,
    @SerialName("pointsPerYuan") val `pointsPerYuan`: Long,
)

@Serializable
data class RechargeQuote(
    @SerialName("priceMicros") val `priceMicros`: PositiveMoneyMicros,
    @SerialName("points") val `points`: NonNegativePoints,
    @EncodeDefault
    @SerialName("paymentEnabled") val `paymentEnabled`: Boolean = false,
    @SerialName("contactHint") val `contactHint`: String,
)

@Serializable
data class RechargeQuoteRequest(
    @SerialName("amountFen") val `amountFen`: Long,
)

@Serializable
data class RechargeTier(
    @SerialName("tierId") val `tierId`: String,
    @SerialName("priceMicros") val `priceMicros`: PositiveMoneyMicros,
    @SerialName("points") val `points`: NonNegativePoints,
    @SerialName("bonusPercent") val `bonusPercent`: Double,
    @SerialName("bonusPoints") val `bonusPoints`: NonNegativePoints,
)

@Serializable
data class RecognizedDialogueLine(
    @SerialName("lineId") val `lineId`: String,
    @SerialName("speaker") val `speaker`: String,
    @SerialName("text") val `text`: String,
    @SerialName("screenshotIndex") val `screenshotIndex`: Long,
)

@Serializable
data class RecognizedDialogueLineInput(
    @SerialName("lineId") val `lineId`: String,
    @SerialName("speaker") val `speaker`: String,
    @SerialName("text") val `text`: String,
    @SerialName("screenshotIndex") val `screenshotIndex`: Long,
)

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
    @SerialName("netAbsorbedMicros") val `netAbsorbedMicros`: MoneyMicros? = null,
    @SerialName("unknownCostCalls") val `unknownCostCalls`: Long? = null,
    @SerialName("uncertainCostMicros") val `uncertainCostMicros`: Long? = null,
    @SerialName("estimatedUsageCalls") val `estimatedUsageCalls`: Long? = null,
    @SerialName("estimatedChargedMicros") val `estimatedChargedMicros`: Long? = null,
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
    @SerialName("inviteCode") val `inviteCode`: String? = null,
    @SerialName("device") val `device`: DeviceInfo,
)

@Serializable
data class RegisterRequestInput(
    @SerialName("username") val `username`: Username,
    @SerialName("password") val `password`: Password,
    @SerialName("inviteCode") val `inviteCode`: String? = null,
    @SerialName("device") val `device`: DeviceInfoInput,
)

@Serializable
data class RelationAdminEndpointsListRelationsQuery(
    @SerialName("characterId") val `characterId`: Id? = null,
)

@Serializable
data class RelationAdminEndpointsListRelationsResponse(
    @SerialName("items") val `items`: List<CharacterRelation>,
)

@Serializable
data class RelationAdminEndpointsUpdateRelationBody(
    @SerialName("type") val `type`: RelationType? = null,
    @SerialName("label") val `label`: String? = null,
    @SerialName("closeness") val `closeness`: RelationCloseness? = null,
    @SerialName("evidence") val `evidence`: String? = null,
)

typealias RelationCloseness = String

@Serializable
data class RelationParams(
    @SerialName("relationId") val `relationId`: Id,
)

@Serializable
data class RelationParamsInput(
    @SerialName("relationId") val `relationId`: Id,
)

typealias RelationType = String

@Serializable
data class ReleaseAdminEndpointsCreateReleaseNoteBody(
    @SerialName("platform") val `platform`: ReleasePlatform,
    @SerialName("version") val `version`: String,
    @SerialName("versionCode") val `versionCode`: VersionCode,
    @SerialName("title") val `title`: String? = null,
    @SerialName("body") val `body`: String,
    @SerialName("published") val `published`: Boolean? = null,
)

@Serializable
data class ReleaseAdminEndpointsDeleteReleaseNoteParams(
    @SerialName("releaseNoteId") val `releaseNoteId`: Id,
)

@Serializable
data class ReleaseAdminEndpointsListReleaseNotesQuery(
    @SerialName("platform") val `platform`: ReleasePlatform? = null,
)

@Serializable
data class ReleaseAdminEndpointsListReleaseNotesResponse(
    @SerialName("items") val `items`: List<AdminReleaseNote>,
)

@Serializable
data class ReleaseAdminEndpointsListVersionPoliciesResponse(
    @SerialName("items") val `items`: List<AppVersionPolicy>,
)

@Serializable
data class ReleaseAdminEndpointsUpdateReleaseNoteBody(
    @SerialName("version") val `version`: String? = null,
    @SerialName("title") val `title`: String? = null,
    @SerialName("body") val `body`: String? = null,
    @SerialName("published") val `published`: Boolean? = null,
)

@Serializable
data class ReleaseAdminEndpointsUpdateReleaseNoteParams(
    @SerialName("releaseNoteId") val `releaseNoteId`: Id,
)

@Serializable
data class ReleaseAdminEndpointsUpdateVersionPolicyBody(
    @SerialName("latestVersion") val `latestVersion`: String?,
    @SerialName("latestVersionCode") val `latestVersionCode`: Long?,
    @SerialName("downloadUrl") val `downloadUrl`: String?,
    @SerialName("minSupportedVersionCode") val `minSupportedVersionCode`: Long?,
    @SerialName("forceUpdateMessage") val `forceUpdateMessage`: String?,
)

@Serializable
data class ReleaseAdminEndpointsUpdateVersionPolicyParams(
    @SerialName("platform") val `platform`: ReleasePlatform,
)

@Serializable
data class ReleaseEndpointsCheckVersionResponse(
    @SerialName("platform") val `platform`: ReleasePlatform,
    @SerialName("latestVersion") val `latestVersion`: String?,
    @SerialName("latestVersionCode") val `latestVersionCode`: Long?,
    @SerialName("downloadUrl") val `downloadUrl`: String?,
    @SerialName("minSupportedVersionCode") val `minSupportedVersionCode`: Long?,
    @SerialName("updateAvailable") val `updateAvailable`: Boolean,
    @SerialName("updateRequired") val `updateRequired`: Boolean,
    @SerialName("forceUpdateMessage") val `forceUpdateMessage`: String?,
    @SerialName("latestNote") val `latestNote`: ReleaseNote?,
)

@Serializable
data class ReleaseEndpointsListReleaseNotesResponse(
    @SerialName("items") val `items`: List<ReleaseNote>,
    @SerialName("whatsNew") val `whatsNew`: List<ReleaseNote>,
    @SerialName("lastSeenVersionCode") val `lastSeenVersionCode`: Long?,
)

@Serializable
data class ReleaseNote(
    @SerialName("platform") val `platform`: ReleasePlatform,
    @SerialName("version") val `version`: String,
    @SerialName("versionCode") val `versionCode`: VersionCode,
    @SerialName("title") val `title`: String,
    @SerialName("body") val `body`: String,
    @SerialName("releaseNoteId") val `releaseNoteId`: Id,
    @SerialName("publishedAt") val `publishedAt`: Timestamp,
)

typealias ReleasePlatform = String

@Serializable
data class Reminder(
    @SerialName("reminderId") val `reminderId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("text") val `text`: String,
    @SerialName("time") val `time`: LocalTime,
    @SerialName("repeat") val `repeat`: ReminderRepeat,
    @SerialName("health") val `health`: Boolean,
    @SerialName("bypassDoNotDisturb") val `bypassDoNotDisturb`: Boolean,
    @SerialName("enabled") val `enabled`: Boolean,
    @SerialName("phrasingsReady") val `phrasingsReady`: Boolean,
    @SerialName("nextFireAt") val `nextFireAt`: Timestamp?,
    @SerialName("pausedByContactRemoval") val `pausedByContactRemoval`: Boolean,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
)

@Serializable
data class ReminderEndpointsCreateReminderBody(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("text") val `text`: String,
    @SerialName("time") val `time`: LocalTime,
    @SerialName("repeat") val `repeat`: ReminderRepeatInput,
    @SerialName("health") val `health`: Boolean,
    @SerialName("bypassDoNotDisturb") val `bypassDoNotDisturb`: Boolean,
    @SerialName("enabled") val `enabled`: Boolean,
    @SerialName("clientRequestId") val `clientRequestId`: Id,
)

@Serializable
data class ReminderEndpointsListRemindersResponse(
    @SerialName("items") val `items`: List<Reminder>,
    @SerialName("limit") val `limit`: Long,
)

@Serializable
data class ReminderEndpointsUpdateReminderBody(
    @SerialName("text") val `text`: String? = null,
    @SerialName("time") val `time`: LocalTime? = null,
    @SerialName("repeat") val `repeat`: ReminderRepeatInput? = null,
    @SerialName("health") val `health`: Boolean? = null,
    @SerialName("bypassDoNotDisturb") val `bypassDoNotDisturb`: Boolean? = null,
    @SerialName("enabled") val `enabled`: Boolean? = null,
)

@Serializable
data class ReminderEndpointsUpdateReminderParams(
    @SerialName("reminderId") val `reminderId`: Id,
)

typealias ReminderRepeat = JsonElement

typealias ReminderRepeatInput = JsonElement

@Serializable
data class ReminderWrite(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("text") val `text`: String,
    @SerialName("time") val `time`: LocalTime,
    @SerialName("repeat") val `repeat`: ReminderRepeat,
    @SerialName("health") val `health`: Boolean,
    @SerialName("bypassDoNotDisturb") val `bypassDoNotDisturb`: Boolean,
    @SerialName("enabled") val `enabled`: Boolean,
)

@Serializable
data class ReviewNoteRequest(
    @SerialName("note") val `note`: String?,
)

@Serializable
data class ReviewNoteRequestInput(
    @SerialName("note") val `note`: String? = null,
)

@Serializable
data class RoleRequest(
    @SerialName("requestId") val `requestId`: Id,
    @SerialName("roleName") val `roleName`: String,
    @SerialName("basis") val `basis`: String?,
    @SerialName("categoryId") val `categoryId`: String?,
    @SerialName("sourceWork") val `sourceWork`: String,
    @SerialName("referenceText") val `referenceText`: String,
    @SerialName("referenceImages") val `referenceImages`: List<RoleRequestImage>,
    @SerialName("note") val `note`: String,
    @SerialName("status") val `status`: String,
    @SerialName("adminMessage") val `adminMessage`: String?,
    @SerialName("characterId") val `characterId`: Id?,
    @SerialName("addedToContacts") val `addedToContacts`: Boolean,
    @SerialName("pointsCost") val `pointsCost`: Long,
    @SerialName("freeQuotaApplied") val `freeQuotaApplied`: Boolean? = null,
    @SerialName("pointsCharged") val `pointsCharged`: Long,
    @SerialName("unseen") val `unseen`: Boolean,
    @SerialName("createdAt") val `createdAt`: Timestamp,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
)

@Serializable
data class RoleRequestAdminEndpointsAcceptBody(
    @SerialName("message") val `message`: String? = null,
)

@Serializable
data class RoleRequestAdminEndpointsCompleteBody(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("message") val `message`: String? = null,
    @SerialName("addToContacts") val `addToContacts`: Boolean? = null,
)

@Serializable
data class RoleRequestAdminEndpointsGetParams(
    @SerialName("requestId") val `requestId`: Id,
)

@Serializable
data class RoleRequestAdminEndpointsListQuery(
    @SerialName("status") val `status`: RoleRequestStatus? = null,
    @SerialName("userId") val `userId`: Id? = null,
    @SerialName("cursor") val `cursor`: String? = null,
    @SerialName("limit") val `limit`: Long? = null,
)

@Serializable
data class RoleRequestAdminEndpointsListResponse(
    @SerialName("items") val `items`: List<AdminRoleRequest>,
    @SerialName("nextCursor") val `nextCursor`: String?,
    @SerialName("pendingCount") val `pendingCount`: Long,
)

@Serializable
data class RoleRequestAdminEndpointsProgressBody(
    @SerialName("message") val `message`: String,
)

@Serializable
data class RoleRequestAdminEndpointsRejectBody(
    @SerialName("message") val `message`: String,
)

@Serializable
data class RoleRequestConfig(
    @SerialName("enabled") val `enabled`: Boolean,
    @SerialName("pointsCost") val `pointsCost`: Long,
    @SerialName("lifetimeFreeCount") val `lifetimeFreeCount`: Long,
    @SerialName("proPlusWeeklyFreeCount") val `proPlusWeeklyFreeCount`: Long,
    @SerialName("maxOpenPerUser") val `maxOpenPerUser`: Long,
)

@Serializable
data class RoleRequestConfigInput(
    @SerialName("enabled") val `enabled`: Boolean,
    @SerialName("pointsCost") val `pointsCost`: Long,
    @SerialName("lifetimeFreeCount") val `lifetimeFreeCount`: Long? = null,
    @SerialName("proPlusWeeklyFreeCount") val `proPlusWeeklyFreeCount`: Long? = null,
    @SerialName("maxOpenPerUser") val `maxOpenPerUser`: Long,
)

@Serializable
data class RoleRequestEndpointsGetConfigResponse(
    @SerialName("enabled") val `enabled`: Boolean,
    @SerialName("pointsCost") val `pointsCost`: Long,
    @SerialName("lifetimeFreeCount") val `lifetimeFreeCount`: Long,
    @SerialName("proPlusWeeklyFreeCount") val `proPlusWeeklyFreeCount`: Long,
    @SerialName("maxOpenPerUser") val `maxOpenPerUser`: Long,
    @SerialName("quota") val `quota`: RoleRequestQuota,
)

@Serializable
data class RoleRequestEndpointsListMineQuery(
    @SerialName("cursor") val `cursor`: String? = null,
    @SerialName("limit") val `limit`: Long? = null,
)

@Serializable
data class RoleRequestEndpointsListMineResponse(
    @SerialName("items") val `items`: List<RoleRequest>,
    @SerialName("nextCursor") val `nextCursor`: String?,
    @SerialName("unseenCount") val `unseenCount`: Long,
)

@Serializable
data class RoleRequestImage(
    @SerialName("mediaId") val `mediaId`: Id,
    @SerialName("url") val `url`: String?,
)

@Serializable
data class RoleRequestQuota(
    @SerialName("quotedAt") val `quotedAt`: Timestamp,
    @SerialName("tier") val `tier`: String,
    @SerialName("limit") val `limit`: Long,
    @SerialName("used") val `used`: Long,
    @SerialName("remaining") val `remaining`: Long,
    @SerialName("nextPointsCost") val `nextPointsCost`: Long,
    @SerialName("lifetimeLimit") val `lifetimeLimit`: Long? = null,
    @SerialName("lifetimeUsed") val `lifetimeUsed`: Long? = null,
    @SerialName("weeklyLimit") val `weeklyLimit`: Long? = null,
    @SerialName("weeklyUsed") val `weeklyUsed`: Long? = null,
    @SerialName("periodStart") val `periodStart`: Timestamp,
    @SerialName("periodEnd") val `periodEnd`: Timestamp,
    @EncodeDefault
    @SerialName("timeZone") val `timeZone`: String = "Asia/Shanghai",
)

typealias RoleRequestStatus = String

@Serializable
data class RouteBillingBounds(
    @EncodeDefault
    @SerialName("format") val `format`: String = "billing-bounds-v1",
    @EncodeDefault
    @SerialName("pauseReason") val `pauseReason`: String? = "usage_unknown",
    @SerialName("sourceUrl") val `sourceUrl`: String? = null,
    @SerialName("checkedAt") val `checkedAt`: Timestamp? = null,
    @SerialName("text") val `text`: RouteBillingBoundsText? = null,
    @SerialName("tts") val `tts`: RouteBillingBoundsTts? = null,
    @SerialName("asr") val `asr`: RouteBillingBoundsAsr? = null,
    @SerialName("image") val `image`: RouteBillingBoundsImage? = null,
    @SerialName("search") val `search`: RouteBillingBoundsSearch? = null,
    @SerialName("decision") val `decision`: RouteBillingBoundsDecision? = null,
)

@Serializable
data class RouteBillingBoundsInput(
    @EncodeDefault
    @SerialName("format") val `format`: String = "billing-bounds-v1",
    @EncodeDefault
    @SerialName("pauseReason") val `pauseReason`: String? = "usage_unknown",
    @SerialName("sourceUrl") val `sourceUrl`: String? = null,
    @SerialName("checkedAt") val `checkedAt`: Timestamp? = null,
    @SerialName("text") val `text`: RouteBillingBoundsInputText? = null,
    @SerialName("tts") val `tts`: RouteBillingBoundsInputTts? = null,
    @SerialName("asr") val `asr`: RouteBillingBoundsInputAsr? = null,
    @SerialName("image") val `image`: RouteBillingBoundsInputImage? = null,
    @SerialName("search") val `search`: RouteBillingBoundsInputSearch? = null,
    @SerialName("decision") val `decision`: RouteBillingBoundsInputDecision? = null,
)

@Serializable
data class ScenarioConfig(
    @SerialName("scenarios") val `scenarios`: List<ScenarioSelection>,
    @SerialName("needsSetup") val `needsSetup`: Boolean,
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
data class ScenarioModeOption(
    @SerialName("id") val `id`: ScenarioMode,
    @SerialName("name") val `name`: String,
    @SerialName("description") val `description`: String? = null,
    @SerialName("section") val `section`: String? = null,
    @SerialName("recommended") val `recommended`: Boolean? = null,
    @SerialName("aiReady") val `aiReady`: Boolean? = null,
)

@Serializable
data class ScenarioRefs(
    @SerialName("chat") val `chat`: ModelRef? = null,
    @SerialName("vision") val `vision`: ModelRef? = null,
    @SerialName("voice_message") val `voice_message`: ModelRef? = null,
    @SerialName("speech_recognition") val `speech_recognition`: ModelRef? = null,
    @SerialName("voice_call") val `voice_call`: ModelRef? = null,
    @SerialName("image_generation") val `image_generation`: ModelRef? = null,
    @SerialName("private") val `private`: ModelRef? = null,
)

@Serializable
data class ScenarioRefsInput(
    @SerialName("chat") val `chat`: ModelRefInput? = null,
    @SerialName("vision") val `vision`: ModelRefInput? = null,
    @SerialName("voice_message") val `voice_message`: ModelRefInput? = null,
    @SerialName("speech_recognition") val `speech_recognition`: ModelRefInput? = null,
    @SerialName("voice_call") val `voice_call`: ModelRefInput? = null,
    @SerialName("image_generation") val `image_generation`: ModelRefInput? = null,
    @SerialName("private") val `private`: ModelRefInput? = null,
)

@Serializable
data class ScenarioSelection(
    @SerialName("scenario") val `scenario`: String,
    @SerialName("selection") val `selection`: ModelRefState?,
    @SerialName("recommendedModelKey") val `recommendedModelKey`: ModelKey?,
)

@Serializable
data class SearchEndpointsCharacterCandidatesBody(
    @SerialName("query") val `query`: String,
)

@Serializable
data class SearchEndpointsCharacterCandidatesResponse(
    @SerialName("items") val `items`: List<CharacterSearchCandidate>,
)

typealias SearchKeyword = String

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

typealias ServicePriceUnit = String

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

@Serializable
data class SetMembership(
    @SerialName("expiresAt") val `expiresAt`: Timestamp?,
    @SerialName("reason") val `reason`: String? = null,
)

@Serializable
data class SetUserStatusRequest(
    @SerialName("preset") val `preset`: UserStatusPreset,
    @SerialName("text") val `text`: String? = null,
    @SerialName("duration") val `duration`: SetUserStatusRequestDuration? = null,
)

@Serializable
data class SetUserStatusRequestInput(
    @SerialName("preset") val `preset`: UserStatusPreset,
    @SerialName("text") val `text`: String? = null,
    @SerialName("duration") val `duration`: SetUserStatusRequestInputDuration? = null,
)

typealias SettingsSection = String

@Serializable
data class ShareEndpointsPrepareBody(
    @SerialName("source") val `source`: ShareSourceInput,
)

@Serializable
data class ShareEndpointsRecordGeneratedBody(
    @SerialName("template") val `template`: ShareTemplate,
)

@Serializable
data class ShareImageData(
    @SerialName("label") val `label`: String,
    @SerialName("items") val `items`: List<ShareItem>,
    @SerialName("cardId") val `cardId`: Id?,
    @SerialName("characterIds") val `characterIds`: List<Id>,
)

@Serializable
data class ShareItem(
    @SerialName("senderKind") val `senderKind`: ParticipantKind,
    @SerialName("characterId") val `characterId`: Id?,
    @SerialName("content") val `content`: ReceivedMessageContent,
    @SerialName("createdAt") val `createdAt`: Timestamp,
)

@Serializable
data class SharePreferences(
    @SerialName("defaultTemplate") val `defaultTemplate`: ShareTemplate,
)

@Serializable
data class SharePreferencesInput(
    @SerialName("defaultTemplate") val `defaultTemplate`: ShareTemplate,
)

typealias ShareRejectReason = String

@Serializable
data class ShareRejectedDetails(
    @SerialName("rejected") val `rejected`: List<ShareRejectedDetailsRejectedItem>,
)

typealias ShareSource = JsonElement

typealias ShareSourceInput = JsonElement

typealias ShareTemplate = String

typealias SpendCategory = String

@Serializable
data class StickerAdminEndpointsAddStickerBody(
    @SerialName("mediaId") val `mediaId`: Id,
    @SerialName("description") val `description`: String,
    @EncodeDefault
    @SerialName("confirmNoRealPersonPortrait") val `confirmNoRealPersonPortrait`: Boolean = true,
)

@Serializable
data class StickerAdminEndpointsAddStickerParams(
    @SerialName("packId") val `packId`: Id,
)

@Serializable
data class StickerAdminEndpointsDeleteStickerParams(
    @SerialName("stickerId") val `stickerId`: Id,
)

@Serializable
data class StickerAdminEndpointsListPacksResponse(
    @SerialName("items") val `items`: List<StickerPack>,
)

@Serializable
data class StickerAdminEndpointsUpdatePackBody(
    @SerialName("name") val `name`: String? = null,
    @SerialName("characterIds") val `characterIds`: List<Id>? = null,
    @SerialName("userVisible") val `userVisible`: Boolean? = null,
    @SerialName("enabled") val `enabled`: Boolean? = null,
    @SerialName("inStore") val `inStore`: Boolean? = null,
    @SerialName("storeOrder") val `storeOrder`: Long? = null,
    @SerialName("intro") val `intro`: String? = null,
    @SerialName("coverStickerId") val `coverStickerId`: Id? = null,
)

@Serializable
data class StickerAdminEndpointsUpdatePackParams(
    @SerialName("packId") val `packId`: Id,
)

@Serializable
data class StickerContent(
    @EncodeDefault
    @SerialName("type") val `type`: String = "sticker",
    @SerialName("stickerId") val `stickerId`: Id,
    @SerialName("source") val `source`: String,
    @SerialName("mediaId") val `mediaId`: Id,
    @SerialName("description") val `description`: String?,
)

@Serializable
data class StickerContentInput(
    @EncodeDefault
    @SerialName("type") val `type`: String = "sticker",
    @SerialName("stickerId") val `stickerId`: Id,
    @SerialName("source") val `source`: String,
    @SerialName("mediaId") val `mediaId`: Id,
    @SerialName("description") val `description`: String?,
)

typealias StickerEndpointsAddMyStickerBody = JsonElement

@Serializable
data class StickerEndpointsDeleteMyStickerParams(
    @SerialName("stickerId") val `stickerId`: Id,
)

@Serializable
data class StickerEndpointsListMyStickersResponse(
    @SerialName("items") val `items`: List<UserSticker>,
)

@Serializable
data class StickerEndpointsListPacksResponse(
    @SerialName("items") val `items`: List<StickerPack>,
)

@Serializable
data class StickerEndpointsReorderMyStickersBody(
    @SerialName("stickerIds") val `stickerIds`: List<Id>,
)

@Serializable
data class StickerPack(
    @SerialName("packId") val `packId`: Id,
    @SerialName("name") val `name`: String,
    @SerialName("characterIds") val `characterIds`: List<Id>,
    @SerialName("userVisible") val `userVisible`: Boolean,
    @SerialName("enabled") val `enabled`: Boolean,
    @SerialName("stickers") val `stickers`: List<LibrarySticker>,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
    @SerialName("inStore") val `inStore`: Boolean? = null,
    @SerialName("storeOrder") val `storeOrder`: Long? = null,
    @SerialName("intro") val `intro`: String? = null,
    @SerialName("coverStickerId") val `coverStickerId`: Id? = null,
    @SerialName("addedFromStore") val `addedFromStore`: Boolean? = null,
)

@Serializable
data class StickerPackWrite(
    @SerialName("name") val `name`: String,
    @SerialName("characterIds") val `characterIds`: List<Id>,
    @SerialName("userVisible") val `userVisible`: Boolean,
    @SerialName("enabled") val `enabled`: Boolean,
    @SerialName("inStore") val `inStore`: Boolean? = null,
    @SerialName("storeOrder") val `storeOrder`: Long? = null,
    @SerialName("intro") val `intro`: String? = null,
    @SerialName("coverStickerId") val `coverStickerId`: Id? = null,
)

@Serializable
data class StickerPackWriteInput(
    @SerialName("name") val `name`: String,
    @SerialName("characterIds") val `characterIds`: List<Id>,
    @SerialName("userVisible") val `userVisible`: Boolean,
    @SerialName("enabled") val `enabled`: Boolean,
    @SerialName("inStore") val `inStore`: Boolean? = null,
    @SerialName("storeOrder") val `storeOrder`: Long? = null,
    @SerialName("intro") val `intro`: String? = null,
    @SerialName("coverStickerId") val `coverStickerId`: Id? = null,
)

@Serializable
data class StickerStoreAdminEndpointsReorderStoreBody(
    @SerialName("packIds") val `packIds`: List<Id>,
)

@Serializable
data class StickerStoreEndpointsGetPackParams(
    @SerialName("packId") val `packId`: Id,
)

@Serializable
data class StickerStoreEndpointsListAddedResponse(
    @SerialName("items") val `items`: List<StickerStorePack>,
)

@Serializable
data class StickerStoreEndpointsListPacksResponse(
    @SerialName("items") val `items`: List<StickerStorePack>,
)

@Serializable
data class StickerStoreEndpointsReorderMyPacksBody(
    @SerialName("packIds") val `packIds`: List<Id>,
)

@Serializable
data class StickerStorePack(
    @SerialName("packId") val `packId`: Id,
    @SerialName("name") val `name`: String,
    @SerialName("intro") val `intro`: String,
    @SerialName("coverUrl") val `coverUrl`: String?,
    @SerialName("stickerCount") val `stickerCount`: Long,
    @SerialName("added") val `added`: Boolean,
    @SerialName("builtIn") val `builtIn`: Boolean,
    @SerialName("enabled") val `enabled`: Boolean,
    @SerialName("inStore") val `inStore`: Boolean,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
)

@Serializable
data class StickerStorePackDetail(
    @SerialName("packId") val `packId`: Id,
    @SerialName("name") val `name`: String,
    @SerialName("intro") val `intro`: String,
    @SerialName("coverUrl") val `coverUrl`: String?,
    @SerialName("stickerCount") val `stickerCount`: Long,
    @SerialName("added") val `added`: Boolean,
    @SerialName("builtIn") val `builtIn`: Boolean,
    @SerialName("enabled") val `enabled`: Boolean,
    @SerialName("inStore") val `inStore`: Boolean,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
    @SerialName("stickers") val `stickers`: List<LibrarySticker>,
)

@Serializable
data class SupplementConflict(
    @SerialName("field") val `field`: String,
    @SerialName("publicValue") val `publicValue`: String,
    @SerialName("supplementValue") val `supplementValue`: String,
)

@Serializable
data class SupplementConflictInput(
    @SerialName("field") val `field`: String,
    @SerialName("publicValue") val `publicValue`: String,
    @SerialName("supplementValue") val `supplementValue`: String,
)

@Serializable
data class SupportAdminEndpointsGetParams(
    @SerialName("ticketId") val `ticketId`: Id,
)

@Serializable
data class SupportAdminEndpointsListQuery(
    @SerialName("kind") val `kind`: SupportTicketKind? = null,
    @SerialName("status") val `status`: SupportTicketStatus? = null,
    @SerialName("userId") val `userId`: Id? = null,
    @SerialName("targetId") val `targetId`: Id? = null,
    @SerialName("cursor") val `cursor`: String? = null,
    @SerialName("limit") val `limit`: Long? = null,
)

@Serializable
data class SupportAdminEndpointsListResponse(
    @SerialName("items") val `items`: List<AdminSupportTicket>,
    @SerialName("nextCursor") val `nextCursor`: String?,
    @SerialName("openCount") val `openCount`: Long,
)

@Serializable
data class SupportAdminEndpointsReplyBody(
    @SerialName("text") val `text`: String,
    @SerialName("resolve") val `resolve`: Boolean? = null,
)

@Serializable
data class SupportEndpointsAddReplyBody(
    @SerialName("text") val `text`: String,
)

@Serializable
data class SupportEndpointsListMineQuery(
    @SerialName("kind") val `kind`: SupportTicketKind? = null,
    @SerialName("cursor") val `cursor`: String? = null,
    @SerialName("limit") val `limit`: Long? = null,
)

@Serializable
data class SupportEndpointsListMineResponse(
    @SerialName("items") val `items`: List<SupportTicket>,
    @SerialName("nextCursor") val `nextCursor`: String?,
    @SerialName("unseenCount") val `unseenCount`: Long,
)

@Serializable
data class SupportImage(
    @SerialName("mediaId") val `mediaId`: Id,
    @SerialName("url") val `url`: String?,
)

@Serializable
data class SupportReply(
    @SerialName("replyId") val `replyId`: Id,
    @SerialName("from") val `from`: String,
    @SerialName("text") val `text`: String,
    @SerialName("createdAt") val `createdAt`: Timestamp,
)

@Serializable
data class SupportTicket(
    @SerialName("ticketId") val `ticketId`: Id,
    @SerialName("kind") val `kind`: String,
    @SerialName("category") val `category`: String?,
    @SerialName("target") val `target`: SupportTicketTarget?,
    @SerialName("reason") val `reason`: String?,
    @SerialName("text") val `text`: String,
    @SerialName("images") val `images`: List<SupportImage>,
    @SerialName("conversationId") val `conversationId`: Id?,
    @SerialName("characterId") val `characterId`: Id?,
    @SerialName("status") val `status`: String,
    @SerialName("replies") val `replies`: List<SupportReply>,
    @SerialName("unseen") val `unseen`: Boolean,
    @SerialName("createdAt") val `createdAt`: Timestamp,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
    @SerialName("resolvedAt") val `resolvedAt`: Timestamp?,
)

typealias SupportTicketKind = String

typealias SupportTicketStatus = String

@Serializable
data class SymptomTag(
    @SerialName("tagId") val `tagId`: Id,
    @SerialName("name") val `name`: String,
    @SerialName("order") val `order`: Long,
    @SerialName("enabled") val `enabled`: Boolean,
)

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

typealias SystemAnniversaryDay = Long

@Serializable
data class SystemContent(
    @EncodeDefault
    @SerialName("type") val `type`: String = "system",
    @SerialName("code") val `code`: String,
    @SerialName("params") val `params`: Map<String, SystemContentParamsValue>,
)

typealias SystemMessageMode = String

@Serializable
data class TextContent(
    @EncodeDefault
    @SerialName("type") val `type`: String = "text",
    @SerialName("text") val `text`: String,
    @SerialName("mentions") val `mentions`: List<Id>? = null,
)

@Serializable
data class TextContentInput(
    @EncodeDefault
    @SerialName("type") val `type`: String = "text",
    @SerialName("text") val `text`: String,
    @SerialName("mentions") val `mentions`: List<Id>? = null,
)

typealias TimeZone = String

@Serializable
data class TimelineEndpointsGetStatusParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class TimelineEndpointsGetStatusResponse(
    @SerialName("mood") val `mood`: TimelineMood?,
    @SerialName("updatedAt") val `updatedAt`: Timestamp?,
)

@Serializable
data class TimelineEndpointsGetSummaryParams(
    @SerialName("conversationId") val `conversationId`: Id,
)

@Serializable
data class TimelineEndpointsGetSummaryQuery(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("lastActiveAt") val `lastActiveAt`: Timestamp,
)

@Serializable
data class TimelineEndpointsListTimelineParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class TimelineEndpointsListTimelineQuery(
    @SerialName("cursor") val `cursor`: String? = null,
    @SerialName("limit") val `limit`: Long? = null,
)

@Serializable
data class TimelineEndpointsListTimelineResponse(
    @SerialName("items") val `items`: List<TimelineEntry>,
    @SerialName("nextCursor") val `nextCursor`: String?,
)

@Serializable
data class TimelineEndpointsRemoveEpisodeParams(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("episodeId") val `episodeId`: Id,
)

@Serializable
data class TimelineEntry(
    @SerialName("entryId") val `entryId`: Id,
    @SerialName("source") val `source`: String,
    @SerialName("occurredAt") val `occurredAt`: Timestamp,
    @SerialName("kind") val `kind`: String?,
    @SerialName("summary") val `summary`: String,
    @SerialName("moodAfter") val `moodAfter`: String?,
    @SerialName("withCharacterIds") val `withCharacterIds`: List<Id>,
    @SerialName("ref") val `ref`: TimelineEntryRef?,
)

typealias TimelineEntrySource = String

@Serializable
data class TimelineEvent(
    @SerialName("id") val `id`: Id,
    @SerialName("seq") val `seq`: Long,
    @SerialName("kind") val `kind`: TimelineEventKind,
    @SerialName("summary") val `summary`: String,
    @SerialName("detail") val `detail`: String? = null,
    @SerialName("moodAfter") val `moodAfter`: TimelineMood? = null,
)

typealias TimelineEventKind = String

typealias TimelineMood = String

@Serializable
data class TimelineSummaryResponse(
    @SerialName("summary") val `summary`: String?,
    @SerialName("events") val `events`: List<TimelineEvent>,
    @SerialName("currentMood") val `currentMood`: TimelineMood,
    @SerialName("offlineSeconds") val `offlineSeconds`: Long,
)

typealias Timestamp = String

typealias TranscriptStatus = String

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
data class UpdateAnniversaryRequest(
    @SerialName("label") val `label`: String? = null,
    @SerialName("date") val `date`: LocalDate? = null,
    @SerialName("repeatYearly") val `repeatYearly`: Boolean? = null,
)

@Serializable
data class UpdateAnniversaryRequestInput(
    @SerialName("label") val `label`: String? = null,
    @SerialName("date") val `date`: LocalDate? = null,
    @SerialName("repeatYearly") val `repeatYearly`: Boolean? = null,
)

@Serializable
data class UpdateArenaNameRequest(
    @SerialName("arenaModelName") val `arenaModelName`: String?,
)

@Serializable
data class UpdateArenaNameRequestInput(
    @SerialName("arenaModelName") val `arenaModelName`: String?,
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
data class UpdateCharacterEligibilityRequest(
    @SerialName("override") val `override`: CharacterEligibilityFacts?,
    @SerialName("reason") val `reason`: String,
)

@Serializable
data class UpdateCharacterEligibilityRequestInput(
    @SerialName("override") val `override`: CharacterEligibilityFactsInput?,
    @SerialName("reason") val `reason`: String,
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
    @SerialName("voiceId") val `voiceId`: Id? = null,
    @SerialName("longContext") val `longContext`: Boolean? = null,
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
    @SerialName("voiceId") val `voiceId`: Id? = null,
    @SerialName("longContext") val `longContext`: Boolean? = null,
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
data class UpdateEcologySettings(
    @SerialName("enabled") val `enabled`: Boolean? = null,
    @SerialName("activityLevel") val `activityLevel`: EcologyActivityLevel? = null,
    @SerialName("actions") val `actions`: List<UpdateEcologySettingsActionsItem>? = null,
    @EncodeDefault
    @SerialName("introSeen") val `introSeen`: Boolean? = true,
)

@Serializable
data class UpdateFamiliarityStageSettingsRequest(
    @SerialName("thresholds") val `thresholds`: FamiliarityStageThresholds,
)

@Serializable
data class UpdateFamiliarityStageSettingsRequestInput(
    @SerialName("thresholds") val `thresholds`: FamiliarityStageThresholds,
)

@Serializable
data class UpdateHolidayRequest(
    @SerialName("name") val `name`: String? = null,
    @SerialName("dateType") val `dateType`: HolidayDateType? = null,
    @SerialName("dateValue") val `dateValue`: String? = null,
    @SerialName("romantic") val `romantic`: Boolean? = null,
    @SerialName("enabled") val `enabled`: Boolean? = null,
    @SerialName("category") val `category`: HolidayCategory? = null,
    @SerialName("sendCard") val `sendCard`: Boolean? = null,
    @SerialName("cardTemplateId") val `cardTemplateId`: Id? = null,
    @SerialName("characterCategories") val `characterCategories`: List<HolidayCharacterCategory>? = null,
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
data class UpdatePostpaidSettingsRequest(
    @SerialName("maxConcurrentPaidCalls") val `maxConcurrentPaidCalls`: Long? = null,
    @SerialName("concurrencyWaitSeconds") val `concurrencyWaitSeconds`: Long? = null,
    @SerialName("largeRequestLimitPoints") val `largeRequestLimitPoints`: Long? = null,
)

@Serializable
data class UpdatePostpaidSettingsRequestInput(
    @SerialName("maxConcurrentPaidCalls") val `maxConcurrentPaidCalls`: Long? = null,
    @SerialName("concurrencyWaitSeconds") val `concurrencyWaitSeconds`: Long? = null,
    @SerialName("largeRequestLimitPoints") val `largeRequestLimitPoints`: Long? = null,
)

@Serializable
data class UpdateProfileRequest(
    @SerialName("nickname") val `nickname`: String? = null,
    @SerialName("avatarMediaId") val `avatarMediaId`: Id? = null,
    @SerialName("momentsCoverMediaId") val `momentsCoverMediaId`: Id? = null,
    @SerialName("birthday") val `birthday`: LocalDate? = null,
    @SerialName("gender") val `gender`: Gender? = null,
    @SerialName("city") val `city`: String? = null,
    @SerialName("about") val `about`: String? = null,
    @SerialName("nudgeSuffix") val `nudgeSuffix`: String? = null,
    @SerialName("timeZone") val `timeZone`: TimeZone? = null,
)

@Serializable
data class UpdateProfileRequestInput(
    @SerialName("nickname") val `nickname`: String? = null,
    @SerialName("avatarMediaId") val `avatarMediaId`: Id? = null,
    @SerialName("momentsCoverMediaId") val `momentsCoverMediaId`: Id? = null,
    @SerialName("birthday") val `birthday`: LocalDate? = null,
    @SerialName("gender") val `gender`: Gender? = null,
    @SerialName("city") val `city`: String? = null,
    @SerialName("about") val `about`: String? = null,
    @SerialName("nudgeSuffix") val `nudgeSuffix`: String? = null,
    @SerialName("timeZone") val `timeZone`: TimeZone? = null,
)

@Serializable
data class UpdateRechargeOptionsRequest(
    @SerialName("tiers") val `tiers`: List<UpdateRechargeOptionsRequestTiersItem>,
    @SerialName("contactHint") val `contactHint`: String,
)

@Serializable
data class UpdateRechargeOptionsRequestInput(
    @SerialName("tiers") val `tiers`: List<UpdateRechargeOptionsRequestInputTiersItem>,
    @SerialName("contactHint") val `contactHint`: String,
)

@Serializable
data class UpdateScenarioConfigRequest(
    @SerialName("selections") val `selections`: ScenarioRefs,
)

@Serializable
data class UpdateScenarioConfigRequestInput(
    @SerialName("selections") val `selections`: ScenarioRefsInput,
)

typealias UpdateSeq = Long

@Serializable
data class UpdateUpstreamRequest(
    @SerialName("name") val `name`: String? = null,
    @SerialName("kind") val `kind`: UpstreamKind? = null,
    @SerialName("baseUrl") val `baseUrl`: String? = null,
    @SerialName("provider") val `provider`: String? = null,
    @SerialName("priority") val `priority`: Long? = null,
    @SerialName("weight") val `weight`: Long? = null,
    @SerialName("maxConcurrency") val `maxConcurrency`: Long? = null,
    @SerialName("rpmLimit") val `rpmLimit`: Long? = null,
    @SerialName("enabled") val `enabled`: Boolean? = null,
    @SerialName("note") val `note`: String? = null,
)

@Serializable
data class UpdateUpstreamRequestInput(
    @SerialName("name") val `name`: String? = null,
    @SerialName("kind") val `kind`: UpstreamKind? = null,
    @SerialName("baseUrl") val `baseUrl`: String? = null,
    @SerialName("provider") val `provider`: String? = null,
    @SerialName("priority") val `priority`: Long? = null,
    @SerialName("weight") val `weight`: Long? = null,
    @SerialName("maxConcurrency") val `maxConcurrency`: Long? = null,
    @SerialName("rpmLimit") val `rpmLimit`: Long? = null,
    @SerialName("enabled") val `enabled`: Boolean? = null,
    @SerialName("note") val `note`: String? = null,
)

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
    @SerialName("lowBalanceThresholdPoints") val `lowBalanceThresholdPoints`: NonNegativePoints? = null,
    @SerialName("backgroundDailyLimitPoints") val `backgroundDailyLimitPoints`: NonNegativePoints? = null,
)

@Serializable
data class UpdateWalletSettingsRequestInput(
    @SerialName("lowBalanceThresholdMicros") val `lowBalanceThresholdMicros`: Long? = null,
    @SerialName("backgroundDailyLimitMicros") val `backgroundDailyLimitMicros`: Long? = null,
    @SerialName("lowBalanceThresholdPoints") val `lowBalanceThresholdPoints`: NonNegativePoints? = null,
    @SerialName("backgroundDailyLimitPoints") val `backgroundDailyLimitPoints`: NonNegativePoints? = null,
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
    @SerialName("provider") val `provider`: String? = null,
    @SerialName("priority") val `priority`: Long? = null,
    @SerialName("weight") val `weight`: Long? = null,
    @SerialName("maxConcurrency") val `maxConcurrency`: Long? = null,
    @SerialName("rpmLimit") val `rpmLimit`: Long? = null,
    @SerialName("enabled") val `enabled`: Boolean? = null,
    @SerialName("note") val `note`: String? = null,
    @SerialName("cooldownUntil") val `cooldownUntil`: Timestamp? = null,
    @SerialName("consecutiveFailures") val `consecutiveFailures`: Long? = null,
    @SerialName("lastError") val `lastError`: String? = null,
    @SerialName("lastUsedAt") val `lastUsedAt`: Timestamp? = null,
    @SerialName("lastTestedAt") val `lastTestedAt`: Timestamp? = null,
    @SerialName("inFlight") val `inFlight`: Long? = null,
    @SerialName("todayCalls") val `todayCalls`: Long? = null,
    @SerialName("todayCostMicros") val `todayCostMicros`: Long? = null,
    @SerialName("deletedAt") val `deletedAt`: Timestamp? = null,
)

@Serializable
data class UpstreamBatchRequest(
    @SerialName("upstreamIds") val `upstreamIds`: List<Id>,
    @SerialName("action") val `action`: String,
)

@Serializable
data class UpstreamBatchRequestInput(
    @SerialName("upstreamIds") val `upstreamIds`: List<Id>,
    @SerialName("action") val `action`: String,
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

@Serializable
data class UpstreamModelList(
    @SerialName("items") val `items`: List<UpstreamModelListItemsItem>,
)

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
    @SerialName("points") val `points`: NonNegativePoints? = null,
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
    @SerialName("catchphrases") val `catchphrases`: List<String>? = null,
    @SerialName("speechStyle") val `speechStyle`: String? = null,
    @SerialName("voiceId") val `voiceId`: Id? = null,
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
    @SerialName("catchphrases") val `catchphrases`: List<String>? = null,
    @SerialName("speechStyle") val `speechStyle`: String? = null,
    @SerialName("exampleDialogue") val `exampleDialogue`: String? = null,
    @SerialName("tags") val `tags`: List<String>? = null,
    @SerialName("avatarMediaId") val `avatarMediaId`: Id? = null,
    @SerialName("voiceId") val `voiceId`: Id? = null,
)

@Serializable
data class UserCustomCharacterPatchInput(
    @SerialName("name") val `name`: String? = null,
    @SerialName("description") val `description`: String? = null,
    @SerialName("classification") val `classification`: CharacterClassificationInputInput? = null,
    @SerialName("birthday") val `birthday`: LocalDate? = null,
    @SerialName("catchphrase") val `catchphrase`: String? = null,
    @SerialName("catchphrases") val `catchphrases`: List<String>? = null,
    @SerialName("speechStyle") val `speechStyle`: String? = null,
    @SerialName("exampleDialogue") val `exampleDialogue`: String? = null,
    @SerialName("tags") val `tags`: List<String>? = null,
    @SerialName("avatarMediaId") val `avatarMediaId`: Id? = null,
    @SerialName("voiceId") val `voiceId`: Id? = null,
)

@Serializable
data class UserCustomCharacterWrite(
    @SerialName("name") val `name`: String,
    @SerialName("description") val `description`: String,
    @SerialName("classification") val `classification`: CharacterClassificationInput,
    @SerialName("birthday") val `birthday`: LocalDate? = null,
    @SerialName("catchphrase") val `catchphrase`: String? = null,
    @SerialName("catchphrases") val `catchphrases`: List<String>? = null,
    @SerialName("speechStyle") val `speechStyle`: String? = null,
    @SerialName("exampleDialogue") val `exampleDialogue`: String? = null,
    @SerialName("tags") val `tags`: List<String>? = null,
    @SerialName("avatarMediaId") val `avatarMediaId`: Id? = null,
    @SerialName("voiceId") val `voiceId`: Id? = null,
)

@Serializable
data class UserCustomCharacterWriteInput(
    @SerialName("name") val `name`: String,
    @SerialName("description") val `description`: String,
    @SerialName("classification") val `classification`: CharacterClassificationInputInput,
    @SerialName("birthday") val `birthday`: LocalDate? = null,
    @SerialName("catchphrase") val `catchphrase`: String? = null,
    @SerialName("catchphrases") val `catchphrases`: List<String>? = null,
    @SerialName("speechStyle") val `speechStyle`: String? = null,
    @SerialName("exampleDialogue") val `exampleDialogue`: String? = null,
    @SerialName("tags") val `tags`: List<String>? = null,
    @SerialName("avatarMediaId") val `avatarMediaId`: Id? = null,
    @SerialName("voiceId") val `voiceId`: Id? = null,
)

@Serializable
data class UserCustomEndpointsDraftTrialResponse(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("expiresAt") val `expiresAt`: Timestamp,
)

@Serializable
data class UserCustomEndpointsEndTrialParams(
    @SerialName("conversationId") val `conversationId`: Id,
)

@Serializable
data class UserCustomEndpointsEndTrialResponse(
    @EncodeDefault
    @SerialName("ended") val `ended`: Boolean = true,
)

@Serializable
data class UserCustomEndpointsListResponse(
    @SerialName("items") val `items`: List<UserCustomCharacter>,
)

@Serializable
data class UserCustomEndpointsStartTrialResponse(
    @SerialName("conversationId") val `conversationId`: Id,
)

@Serializable
data class UserCustomEndpointsUpdateParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class UserCustomTrialWrite(
    @SerialName("name") val `name`: String,
    @SerialName("description") val `description`: String,
    @SerialName("classification") val `classification`: CharacterClassificationInput,
    @SerialName("birthday") val `birthday`: LocalDate? = null,
    @SerialName("catchphrase") val `catchphrase`: String? = null,
    @SerialName("catchphrases") val `catchphrases`: List<String>? = null,
    @SerialName("speechStyle") val `speechStyle`: String? = null,
    @SerialName("exampleDialogue") val `exampleDialogue`: String? = null,
    @SerialName("tags") val `tags`: List<String>? = null,
    @SerialName("avatarMediaId") val `avatarMediaId`: Id? = null,
    @SerialName("voiceId") val `voiceId`: Id? = null,
    @SerialName("sourceCharacterId") val `sourceCharacterId`: Id? = null,
)

@Serializable
data class UserCustomTrialWriteInput(
    @SerialName("name") val `name`: String,
    @SerialName("description") val `description`: String,
    @SerialName("classification") val `classification`: CharacterClassificationInputInput,
    @SerialName("birthday") val `birthday`: LocalDate? = null,
    @SerialName("catchphrase") val `catchphrase`: String? = null,
    @SerialName("catchphrases") val `catchphrases`: List<String>? = null,
    @SerialName("speechStyle") val `speechStyle`: String? = null,
    @SerialName("exampleDialogue") val `exampleDialogue`: String? = null,
    @SerialName("tags") val `tags`: List<String>? = null,
    @SerialName("avatarMediaId") val `avatarMediaId`: Id? = null,
    @SerialName("voiceId") val `voiceId`: Id? = null,
    @SerialName("sourceCharacterId") val `sourceCharacterId`: Id? = null,
)

typealias UserMediaPurpose = String

@Serializable
data class UserPreferences(
    @SerialName("theme") val `theme`: ReceivedAppTheme,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
)

@Serializable
data class UserRelationEndpointsListMyRelationsResponse(
    @SerialName("items") val `items`: List<CharacterRelation>,
)

@Serializable
data class UserRelationEndpointsUpdateMyRelationBody(
    @SerialName("type") val `type`: RelationType? = null,
    @SerialName("label") val `label`: String? = null,
    @SerialName("closeness") val `closeness`: RelationCloseness? = null,
)

@Serializable
data class UserRelationWrite(
    @SerialName("characterAId") val `characterAId`: Id,
    @SerialName("characterBId") val `characterBId`: Id,
    @SerialName("type") val `type`: RelationType,
    @SerialName("label") val `label`: String?,
    @SerialName("closeness") val `closeness`: RelationCloseness,
)

@Serializable
data class UserRelationWriteInput(
    @SerialName("characterAId") val `characterAId`: Id,
    @SerialName("characterBId") val `characterBId`: Id,
    @SerialName("type") val `type`: RelationType,
    @SerialName("label") val `label`: String? = null,
    @SerialName("closeness") val `closeness`: RelationCloseness,
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
    @SerialName("mentions") val `mentions`: List<Id>? = null,
) : UserSendableContent

@Serializable
data class UserSendableContentNudge(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "nudge",
    @SerialName("targetParticipantId") val `targetParticipantId`: Id,
    @SerialName("targetKind") val `targetKind`: String? = null,
    @SerialName("suffix") val `suffix`: String? = null,
) : UserSendableContent

@Serializable
data class UserSendableContentImage(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "image",
    @SerialName("mediaId") val `mediaId`: Id,
    @SerialName("width") val `width`: Long?,
    @SerialName("height") val `height`: Long?,
    @SerialName("sizeBytes") val `sizeBytes`: Long? = null,
) : UserSendableContent

@Serializable
data class UserSendableContentVoice(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "voice",
    @SerialName("mediaId") val `mediaId`: Id,
    @SerialName("durationMs") val `durationMs`: Long,
    @SerialName("transcript") val `transcript`: String?,
) : UserSendableContent

@Serializable
data class UserSendableContentSticker(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "sticker",
    @SerialName("stickerId") val `stickerId`: Id,
    @SerialName("source") val `source`: String,
    @SerialName("mediaId") val `mediaId`: Id,
    @SerialName("description") val `description`: String?,
) : UserSendableContent

@Serializable
data class UserSendableContentLink(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "link",
    @SerialName("url") val `url`: String,
    @SerialName("title") val `title`: String,
    @SerialName("source") val `source`: String?,
    @SerialName("description") val `description`: String?,
    @SerialName("coverMediaId") val `coverMediaId`: Id?,
    @SerialName("appHint") val `appHint`: String,
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
            "image" -> input.json.decodeFromJsonElement(UserSendableContentImage.serializer(), value)
            "voice" -> input.json.decodeFromJsonElement(UserSendableContentVoice.serializer(), value)
            "sticker" -> input.json.decodeFromJsonElement(UserSendableContentSticker.serializer(), value)
            "link" -> input.json.decodeFromJsonElement(UserSendableContentLink.serializer(), value)
            else -> throw SerializationException("Unknown discriminator")
        }
    }
    override fun serialize(encoder: Encoder, value: UserSendableContent) {
        val output = encoder as JsonEncoder
        val element = when (value) {
            is UserSendableContentText -> output.json.encodeToJsonElement(UserSendableContentText.serializer(), value)
            is UserSendableContentNudge -> output.json.encodeToJsonElement(UserSendableContentNudge.serializer(), value)
            is UserSendableContentImage -> output.json.encodeToJsonElement(UserSendableContentImage.serializer(), value)
            is UserSendableContentVoice -> output.json.encodeToJsonElement(UserSendableContentVoice.serializer(), value)
            is UserSendableContentSticker -> output.json.encodeToJsonElement(UserSendableContentSticker.serializer(), value)
            is UserSendableContentLink -> output.json.encodeToJsonElement(UserSendableContentLink.serializer(), value)
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
    @SerialName("mentions") val `mentions`: List<Id>? = null,
) : UserSendableContentInput

@Serializable
data class UserSendableContentInputNudge(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "nudge",
    @SerialName("targetParticipantId") val `targetParticipantId`: Id,
    @SerialName("targetKind") val `targetKind`: String? = null,
    @SerialName("suffix") val `suffix`: String? = null,
) : UserSendableContentInput

@Serializable
data class UserSendableContentInputImage(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "image",
    @SerialName("mediaId") val `mediaId`: Id,
    @SerialName("width") val `width`: Long?,
    @SerialName("height") val `height`: Long?,
    @SerialName("sizeBytes") val `sizeBytes`: Long? = null,
) : UserSendableContentInput

@Serializable
data class UserSendableContentInputVoice(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "voice",
    @SerialName("mediaId") val `mediaId`: Id,
    @SerialName("durationMs") val `durationMs`: Long,
    @SerialName("transcript") val `transcript`: String?,
) : UserSendableContentInput

@Serializable
data class UserSendableContentInputSticker(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "sticker",
    @SerialName("stickerId") val `stickerId`: Id,
    @SerialName("source") val `source`: String,
    @SerialName("mediaId") val `mediaId`: Id,
    @SerialName("description") val `description`: String?,
) : UserSendableContentInput

@Serializable
data class UserSendableContentInputLink(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "link",
    @SerialName("url") val `url`: String,
    @SerialName("title") val `title`: String,
    @SerialName("source") val `source`: String?,
    @SerialName("description") val `description`: String?,
    @SerialName("coverMediaId") val `coverMediaId`: Id?,
    @SerialName("appHint") val `appHint`: String,
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
            "image" -> input.json.decodeFromJsonElement(UserSendableContentInputImage.serializer(), value)
            "voice" -> input.json.decodeFromJsonElement(UserSendableContentInputVoice.serializer(), value)
            "sticker" -> input.json.decodeFromJsonElement(UserSendableContentInputSticker.serializer(), value)
            "link" -> input.json.decodeFromJsonElement(UserSendableContentInputLink.serializer(), value)
            else -> throw SerializationException("Unknown discriminator")
        }
    }
    override fun serialize(encoder: Encoder, value: UserSendableContentInput) {
        val output = encoder as JsonEncoder
        val element = when (value) {
            is UserSendableContentInputText -> output.json.encodeToJsonElement(UserSendableContentInputText.serializer(), value)
            is UserSendableContentInputNudge -> output.json.encodeToJsonElement(UserSendableContentInputNudge.serializer(), value)
            is UserSendableContentInputImage -> output.json.encodeToJsonElement(UserSendableContentInputImage.serializer(), value)
            is UserSendableContentInputVoice -> output.json.encodeToJsonElement(UserSendableContentInputVoice.serializer(), value)
            is UserSendableContentInputSticker -> output.json.encodeToJsonElement(UserSendableContentInputSticker.serializer(), value)
            is UserSendableContentInputLink -> output.json.encodeToJsonElement(UserSendableContentInputLink.serializer(), value)
        }
        output.encodeJsonElement(element)
    }
}

@Serializable
data class UserStatus(
    @SerialName("preset") val `preset`: String,
    @SerialName("text") val `text`: String?,
    @SerialName("label") val `label`: String,
    @SerialName("emoji") val `emoji`: String,
    @SerialName("quiet") val `quiet`: Boolean,
    @SerialName("setAt") val `setAt`: Timestamp,
    @SerialName("expiresAt") val `expiresAt`: Timestamp?,
)

@Serializable
data class UserStatusEndpointsGetResponse(
    @SerialName("status") val `status`: UserStatus?,
)

@Serializable
data class UserStatusEndpointsSetResponse(
    @SerialName("status") val `status`: UserStatus,
)

typealias UserStatusPreset = String

@Serializable
data class UserSticker(
    @SerialName("stickerId") val `stickerId`: Id,
    @SerialName("mediaId") val `mediaId`: Id,
    @SerialName("url") val `url`: String,
    @SerialName("order") val `order`: Long,
    @SerialName("createdAt") val `createdAt`: Timestamp,
)

@Serializable
data class UserSupplement(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("text") val `text`: String,
    @SerialName("conflicts") val `conflicts`: List<SupplementConflict>,
    @SerialName("plazaSource") val `plazaSource`: UserSupplementPlazaSource?,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
)

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
data class UserUpdateMessageUpdated(
    @SerialName("updateSeq") override val `updateSeq`: UpdateSeq,
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "message.updated",
    @SerialName("data") val `data`: UserUpdateMessageUpdatedData,
) : UserUpdate

@Serializable
data class UserUpdateCallUpdated(
    @SerialName("updateSeq") override val `updateSeq`: UpdateSeq,
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "call.updated",
    @SerialName("data") val `data`: UserUpdateCallUpdatedData,
) : UserUpdate

@Serializable
data class UserUpdateMediaTranscriptReady(
    @SerialName("updateSeq") override val `updateSeq`: UpdateSeq,
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "media.transcript_ready",
    @SerialName("data") val `data`: UserUpdateMediaTranscriptReadyData,
) : UserUpdate

@Serializable
data class UserUpdateMomentsBadgeUpdated(
    @SerialName("updateSeq") override val `updateSeq`: UpdateSeq,
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "moments.badge_updated",
    @SerialName("data") val `data`: UserUpdateMomentsBadgeUpdatedData,
) : UserUpdate

@Serializable
data class UserUpdateMomentsPostChanged(
    @SerialName("updateSeq") override val `updateSeq`: UpdateSeq,
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "moments.post_changed",
    @SerialName("data") val `data`: UserUpdateMomentsPostChangedData,
) : UserUpdate

@Serializable
data class UserUpdateDataChanged(
    @SerialName("updateSeq") override val `updateSeq`: UpdateSeq,
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "data.changed",
    @SerialName("data") val `data`: UserUpdateDataChangedData,
) : UserUpdate

@Serializable
data class UserUpdateConversationRemoved(
    @SerialName("updateSeq") override val `updateSeq`: UpdateSeq,
    @SerialName("occurredAt") override val `occurredAt`: Timestamp,
    @EncodeDefault
    @SerialName("type") override val `type`: String = "conversation.removed",
    @SerialName("data") val `data`: UserUpdateConversationRemovedData,
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
            "message.updated" -> input.json.decodeFromJsonElement(UserUpdateMessageUpdated.serializer(), value)
            "call.updated" -> input.json.decodeFromJsonElement(UserUpdateCallUpdated.serializer(), value)
            "media.transcript_ready" -> input.json.decodeFromJsonElement(UserUpdateMediaTranscriptReady.serializer(), value)
            "moments.badge_updated" -> input.json.decodeFromJsonElement(UserUpdateMomentsBadgeUpdated.serializer(), value)
            "moments.post_changed" -> input.json.decodeFromJsonElement(UserUpdateMomentsPostChanged.serializer(), value)
            "data.changed" -> input.json.decodeFromJsonElement(UserUpdateDataChanged.serializer(), value)
            "conversation.removed" -> input.json.decodeFromJsonElement(UserUpdateConversationRemoved.serializer(), value)
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
            is UserUpdateMessageUpdated -> output.json.encodeToJsonElement(UserUpdateMessageUpdated.serializer(), value)
            is UserUpdateCallUpdated -> output.json.encodeToJsonElement(UserUpdateCallUpdated.serializer(), value)
            is UserUpdateMediaTranscriptReady -> output.json.encodeToJsonElement(UserUpdateMediaTranscriptReady.serializer(), value)
            is UserUpdateMomentsBadgeUpdated -> output.json.encodeToJsonElement(UserUpdateMomentsBadgeUpdated.serializer(), value)
            is UserUpdateMomentsPostChanged -> output.json.encodeToJsonElement(UserUpdateMomentsPostChanged.serializer(), value)
            is UserUpdateDataChanged -> output.json.encodeToJsonElement(UserUpdateDataChanged.serializer(), value)
            is UserUpdateConversationRemoved -> output.json.encodeToJsonElement(UserUpdateConversationRemoved.serializer(), value)
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

@Serializable
data class UserUpdatePayloadMessageUpdated(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "message.updated",
    @SerialName("data") val `data`: UserUpdatePayloadMessageUpdatedData,
) : UserUpdatePayload

@Serializable
data class UserUpdatePayloadCallUpdated(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "call.updated",
    @SerialName("data") val `data`: UserUpdatePayloadCallUpdatedData,
) : UserUpdatePayload

@Serializable
data class UserUpdatePayloadMediaTranscriptReady(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "media.transcript_ready",
    @SerialName("data") val `data`: UserUpdatePayloadMediaTranscriptReadyData,
) : UserUpdatePayload

@Serializable
data class UserUpdatePayloadMomentsBadgeUpdated(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "moments.badge_updated",
    @SerialName("data") val `data`: UserUpdatePayloadMomentsBadgeUpdatedData,
) : UserUpdatePayload

@Serializable
data class UserUpdatePayloadMomentsPostChanged(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "moments.post_changed",
    @SerialName("data") val `data`: UserUpdatePayloadMomentsPostChangedData,
) : UserUpdatePayload

@Serializable
data class UserUpdatePayloadDataChanged(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "data.changed",
    @SerialName("data") val `data`: UserUpdatePayloadDataChangedData,
) : UserUpdatePayload

@Serializable
data class UserUpdatePayloadConversationRemoved(
    @EncodeDefault
    @SerialName("type") override val `type`: String = "conversation.removed",
    @SerialName("data") val `data`: UserUpdatePayloadConversationRemovedData,
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
            "message.updated" -> input.json.decodeFromJsonElement(UserUpdatePayloadMessageUpdated.serializer(), value)
            "call.updated" -> input.json.decodeFromJsonElement(UserUpdatePayloadCallUpdated.serializer(), value)
            "media.transcript_ready" -> input.json.decodeFromJsonElement(UserUpdatePayloadMediaTranscriptReady.serializer(), value)
            "moments.badge_updated" -> input.json.decodeFromJsonElement(UserUpdatePayloadMomentsBadgeUpdated.serializer(), value)
            "moments.post_changed" -> input.json.decodeFromJsonElement(UserUpdatePayloadMomentsPostChanged.serializer(), value)
            "data.changed" -> input.json.decodeFromJsonElement(UserUpdatePayloadDataChanged.serializer(), value)
            "conversation.removed" -> input.json.decodeFromJsonElement(UserUpdatePayloadConversationRemoved.serializer(), value)
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
            is UserUpdatePayloadMessageUpdated -> output.json.encodeToJsonElement(UserUpdatePayloadMessageUpdated.serializer(), value)
            is UserUpdatePayloadCallUpdated -> output.json.encodeToJsonElement(UserUpdatePayloadCallUpdated.serializer(), value)
            is UserUpdatePayloadMediaTranscriptReady -> output.json.encodeToJsonElement(UserUpdatePayloadMediaTranscriptReady.serializer(), value)
            is UserUpdatePayloadMomentsBadgeUpdated -> output.json.encodeToJsonElement(UserUpdatePayloadMomentsBadgeUpdated.serializer(), value)
            is UserUpdatePayloadMomentsPostChanged -> output.json.encodeToJsonElement(UserUpdatePayloadMomentsPostChanged.serializer(), value)
            is UserUpdatePayloadDataChanged -> output.json.encodeToJsonElement(UserUpdatePayloadDataChanged.serializer(), value)
            is UserUpdatePayloadConversationRemoved -> output.json.encodeToJsonElement(UserUpdatePayloadConversationRemoved.serializer(), value)
        }
        output.encodeJsonElement(element)
    }
}

typealias Username = String

typealias VersionCode = Long

@Serializable
data class Voice(
    @SerialName("voiceId") val `voiceId`: Id,
    @SerialName("name") val `name`: String,
    @SerialName("tags") val `tags`: List<String>,
    @SerialName("sampleMediaId") val `sampleMediaId`: Id?,
    @SerialName("sampleUrl") val `sampleUrl`: String?,
    @SerialName("enabled") val `enabled`: Boolean,
)

@Serializable
data class VoiceAdminEndpointsListVoicesResponse(
    @SerialName("items") val `items`: List<AdminVoice>,
)

@Serializable
data class VoiceAdminEndpointsUpdateVoiceBody(
    @SerialName("name") val `name`: String? = null,
    @SerialName("tags") val `tags`: List<String>? = null,
    @SerialName("sampleMediaId") val `sampleMediaId`: Id? = null,
    @SerialName("enabled") val `enabled`: Boolean? = null,
    @SerialName("providerVoiceKey") val `providerVoiceKey`: String? = null,
    @SerialName("modelKey") val `modelKey`: String? = null,
    @SerialName("careFallbackMediaId") val `careFallbackMediaId`: Id? = null,
)

@Serializable
data class VoiceAdminEndpointsUpdateVoiceParams(
    @SerialName("voiceId") val `voiceId`: Id,
)

@Serializable
data class VoiceContent(
    @EncodeDefault
    @SerialName("type") val `type`: String = "voice",
    @SerialName("mediaId") val `mediaId`: Id,
    @SerialName("durationMs") val `durationMs`: Long,
    @SerialName("transcript") val `transcript`: String?,
)

@Serializable
data class VoiceContentInput(
    @EncodeDefault
    @SerialName("type") val `type`: String = "voice",
    @SerialName("mediaId") val `mediaId`: Id,
    @SerialName("durationMs") val `durationMs`: Long,
    @SerialName("transcript") val `transcript`: String?,
)

@Serializable
data class VoiceEndpointsListVoicesResponse(
    @SerialName("items") val `items`: List<Voice>,
)

@Serializable
data class Wallet(
    @SerialName("balanceMicros") val `balanceMicros`: MoneyMicros,
    @SerialName("heldMicros") val `heldMicros`: Long,
    @SerialName("availableMicros") val `availableMicros`: MoneyMicros,
    @SerialName("lowBalanceThresholdMicros") val `lowBalanceThresholdMicros`: Long,
    @SerialName("backgroundBudget") val `backgroundBudget`: WalletBackgroundBudget,
    @SerialName("balancePoints") val `balancePoints`: Points? = null,
    @SerialName("heldPoints") val `heldPoints`: NonNegativePoints? = null,
    @SerialName("availablePoints") val `availablePoints`: Points? = null,
    @SerialName("lowBalanceThresholdPoints") val `lowBalanceThresholdPoints`: NonNegativePoints? = null,
    @SerialName("bonusMicros") val `bonusMicros`: Long? = null,
    @SerialName("bonusPoints") val `bonusPoints`: NonNegativePoints? = null,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
)

@Serializable
data class WebPage(
    @SerialName("title") val `title`: String,
    @SerialName("content") val `content`: String,
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
data class WebSearchHit(
    @SerialName("title") val `title`: String,
    @SerialName("url") val `url`: String,
    @SerialName("snippet") val `snippet`: String,
    @SerialName("source") val `source`: String?,
    @SerialName("publishedAt") val `publishedAt`: String?,
    @SerialName("authority") val `authority`: Long? = null,
    @SerialName("relevance") val `relevance`: Double? = null,
    @SerialName("content") val `content`: String? = null,
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
    @SerialName("prompting") val `prompting`: CardPrompting? = null,
)

@Serializable
data class WishlistEndpointsAddItemBody(
    @SerialName("clientRequestId") val `clientRequestId`: Id,
    @SerialName("text") val `text`: String,
    @SerialName("dueDate") val `dueDate`: LocalDate? = null,
)

@Serializable
data class WishlistEndpointsAddItemParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class WishlistEndpointsListItemsParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class WishlistEndpointsListItemsResponse(
    @SerialName("items") val `items`: List<WishlistItem>,
    @SerialName("limit") val `limit`: Long,
)

@Serializable
data class WishlistEndpointsListSummariesResponse(
    @SerialName("items") val `items`: List<WishlistSummary>,
)

@Serializable
data class WishlistEndpointsUpdateItemBody(
    @SerialName("text") val `text`: String? = null,
    @SerialName("dueDate") val `dueDate`: LocalDate? = null,
    @SerialName("completed") val `completed`: Boolean? = null,
)

@Serializable
data class WishlistEndpointsUpdateItemParams(
    @SerialName("itemId") val `itemId`: Id,
)

@Serializable
data class WishlistItem(
    @SerialName("itemId") val `itemId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("text") val `text`: String,
    @SerialName("proposedByCharacter") val `proposedByCharacter`: Boolean,
    @SerialName("dueDate") val `dueDate`: LocalDate?,
    @SerialName("completedAt") val `completedAt`: Timestamp?,
    @SerialName("cardIssued") val `cardIssued`: Boolean,
    @SerialName("createdAt") val `createdAt`: Timestamp,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
)

@Serializable
data class WishlistSummary(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("total") val `total`: Long,
    @SerialName("completed") val `completed`: Long,
)

@Serializable
data class WorkLink(
    @SerialName("workLinkId") val `workLinkId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("title") val `title`: String,
    @SerialName("url") val `url`: String,
    @SerialName("source") val `source`: String?,
    @SerialName("appHint") val `appHint`: LinkAppHint,
    @SerialName("coverMediaId") val `coverMediaId`: Id?,
    @SerialName("lastCheck") val `lastCheck`: WorkLinkLastCheck?,
    @SerialName("enabled") val `enabled`: Boolean,
    @SerialName("updatedAt") val `updatedAt`: Timestamp,
)

@Serializable
data class WorkLinkAdminEndpointsCreateWorkLinkParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class WorkLinkAdminEndpointsDeleteWorkLinkParams(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("workLinkId") val `workLinkId`: Id,
)

@Serializable
data class WorkLinkAdminEndpointsGetDefaultVoiceParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class WorkLinkAdminEndpointsGetDefaultVoiceResponse(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("voiceId") val `voiceId`: Id?,
    @SerialName("voiceName") val `voiceName`: String?,
)

@Serializable
data class WorkLinkAdminEndpointsListWorkLinksParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class WorkLinkAdminEndpointsListWorkLinksResponse(
    @SerialName("items") val `items`: List<WorkLink>,
)

@Serializable
data class WorkLinkAdminEndpointsSetDefaultVoiceBody(
    @SerialName("voiceId") val `voiceId`: Id?,
)

@Serializable
data class WorkLinkAdminEndpointsSetDefaultVoiceParams(
    @SerialName("characterId") val `characterId`: Id,
)

@Serializable
data class WorkLinkAdminEndpointsSetDefaultVoiceResponse(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("voiceId") val `voiceId`: Id?,
)

@Serializable
data class WorkLinkAdminEndpointsUpdateWorkLinkBody(
    @SerialName("title") val `title`: String? = null,
    @SerialName("url") val `url`: String? = null,
    @SerialName("source") val `source`: String? = null,
    @SerialName("appHint") val `appHint`: LinkAppHint? = null,
    @SerialName("coverMediaId") val `coverMediaId`: Id? = null,
    @SerialName("enabled") val `enabled`: Boolean? = null,
)

@Serializable
data class WorkLinkAdminEndpointsUpdateWorkLinkParams(
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("workLinkId") val `workLinkId`: Id,
)

@Serializable
data class WorkLinkWrite(
    @SerialName("title") val `title`: String,
    @SerialName("url") val `url`: String,
    @SerialName("source") val `source`: String?,
    @SerialName("appHint") val `appHint`: LinkAppHint,
    @SerialName("coverMediaId") val `coverMediaId`: Id?,
    @SerialName("enabled") val `enabled`: Boolean,
)

@Serializable
data class WorkLinkWriteInput(
    @SerialName("title") val `title`: String,
    @SerialName("url") val `url`: String,
    @SerialName("source") val `source`: String?,
    @SerialName("appHint") val `appHint`: LinkAppHint,
    @SerialName("coverMediaId") val `coverMediaId`: Id?,
    @SerialName("enabled") val `enabled`: Boolean,
)

typealias SharedSchema0 = JsonElement

typealias SharedSchema1 = JsonElement

typealias SharedSchema2 = JsonElement

@Serializable
data class AchievementProgress(
    @SerialName("current") val `current`: Long,
    @SerialName("target") val `target`: Long,
)

@Serializable
data class ActionCardContentActionsItem(
    @SerialName("actionId") val `actionId`: String,
    @SerialName("label") val `label`: String,
    @SerialName("style") val `style`: MessageActionStyle,
)

@Serializable
data class ActionCardContentRef(
    @SerialName("kind") val `kind`: String,
    @SerialName("id") val `id`: String,
)

typealias AddFavoritesRequestItemsItem = JsonElement

typealias AddFavoritesRequestInputItemsItem = JsonElement

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
data class AdminModelAvailability(
    @SerialName("available") val `available`: Boolean,
    @SerialName("detail") val `detail`: ModelUnavailableDetail?,
)

@Serializable
data class AdminModelUsageMissingItem(
    @SerialName("upstreamId") val `upstreamId`: Id,
    @SerialName("upstreamModelId") val `upstreamModelId`: String,
    @SerialName("streak") val `streak`: Long,
    @SerialName("since") val `since`: Timestamp?,
)

typealias AdminPlazaReportTarget = JsonElement

@Serializable
data class AdminPlazaWorkRemixOf(
    @SerialName("workId") val `workId`: Id,
    @SerialName("name") val `name`: String,
    @SerialName("authorNickname") val `authorNickname`: String,
    @SerialName("available") val `available`: Boolean,
)

@Serializable
data class AdminRoleRequestHistoryItem(
    @SerialName("status") val `status`: String,
    @SerialName("message") val `message`: String?,
    @SerialName("at") val `at`: Timestamp,
)

@Serializable
data class AdminSupportTicketTarget(
    @SerialName("type") val `type`: String,
    @SerialName("id") val `id`: Id,
)

@Serializable
data class AdminUsageOverviewAccounts(
    @SerialName("total") val `total`: Long,
    @SerialName("available") val `available`: Long,
    @SerialName("abnormal") val `abnormal`: Long,
    @SerialName("disabled") val `disabled`: Long,
)

@Serializable
data class AdminUsageOverviewRecentErrorsItem(
    @SerialName("upstreamId") val `upstreamId`: Id,
    @SerialName("modelKey") val `modelKey`: ModelKey,
    @SerialName("errorCode") val `errorCode`: String,
    @SerialName("count") val `count`: Long,
    @SerialName("lastAt") val `lastAt`: Timestamp,
)

@Serializable
data class AdminUserOverviewExpiringSoonItem(
    @SerialName("userId") val `userId`: Id,
    @SerialName("username") val `username`: String,
    @SerialName("nickname") val `nickname`: String?,
    @SerialName("expiresAt") val `expiresAt`: Timestamp,
)

@Serializable
data class AdminUserSummaryMembership(
    @SerialName("tier") val `tier`: String,
    @SerialName("expiresAt") val `expiresAt`: Timestamp?,
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
data class BillingEndpointsConsumeEcologyInsufficientNoticeResponseNotice(
    @SerialName("message") val `message`: String,
    @SerialName("insufficientSince") val `insufficientSince`: Timestamp,
)

@Serializable
data class CallStreamClientFrameHelloData(
    @EncodeDefault
    @SerialName("inputSampleRate") val `inputSampleRate`: Long = 16000,
    @SerialName("clientTime") val `clientTime`: Timestamp,
)

@Serializable
data class CallStreamClientFrameBargeInData(
    @SerialName("at") val `at`: Timestamp,
)

@Serializable
data class CallStreamClientFrameMuteData(
    @SerialName("muted") val `muted`: Boolean,
)

@Serializable
data class CallStreamClientFramePingData(
    @SerialName("clientTime") val `clientTime`: Timestamp,
)

@Serializable
data class CallStreamServerFrameCallReadyData(
    @SerialName("callId") val `callId`: Id,
    @SerialName("outputSampleRate") val `outputSampleRate`: Long,
    @SerialName("serverTime") val `serverTime`: Timestamp,
)

@Serializable
data class CallStreamServerFrameCallStateData(
    @SerialName("state") val `state`: String,
    @SerialName("durationSec") val `durationSec`: Long,
)

@Serializable
data class CallStreamServerFrameCallAgentSpeakingData(
    @SerialName("speaking") val `speaking`: Boolean,
)

@Serializable
data class CallStreamServerFrameCallEndingData(
    @SerialName("outcome") val `outcome`: String,
)

@Serializable
data class CallStreamServerFrameCallErrorData(
    @SerialName("code") val `code`: String,
    @SerialName("message") val `message`: String,
)

@Serializable
data class CallStreamServerFramePongData(
    @SerialName("serverTime") val `serverTime`: Timestamp,
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
data class CardProfileExtraWeibo(
    @SerialName("nickname") val `nickname`: String,
    @SerialName("avatarUrl") val `avatarUrl`: String,
    @SerialName("userId") val `userId`: String? = null,
)

@Serializable
data class CardProfileExtraWorksDetailItem(
    @SerialName("title") val `title`: String,
    @SerialName("type") val `type`: String,
    @SerialName("year") val `year`: CardProfileExtraWorksDetailItemYear,
    @SerialName("role") val `role`: String,
)

@Serializable
data class CardPromptingCharacterNote(
    @SerialName("text") val `text`: String,
    @SerialName("depth") val `depth`: Long? = null,
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
data class CharacterScenarioConfigScenariosItem(
    @SerialName("scenario") val `scenario`: String,
    @SerialName("selection") val `selection`: ModelRefState?,
    @SerialName("effective") val `effective`: ModelRefState?,
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

@Serializable
data class ClientLogAdminEndpointsGetResponseDaysItem(
    @SerialName("day") val `day`: String,
    @SerialName("count") val `count`: Long,
)

@Serializable
data class ClientLogAdminEndpointsGetResponseUsersItem(
    @SerialName("userId") val `userId`: Id,
    @SerialName("lastSeenAt") val `lastSeenAt`: Timestamp,
)

@Serializable
data class ClientLogAdminEndpointsListResponseVersionsItem(
    @SerialName("version") val `version`: ClientLogVersion,
    @SerialName("sessions") val `sessions`: Long,
    @SerialName("affectedSessions") val `affectedSessions`: Long,
)

@Serializable class ClientPingFrameData

@Serializable
data class ClientPresenceFrameData(
    @SerialName("conversationId") val `conversationId`: Id?,
    @SerialName("foreground") val `foreground`: Boolean,
)

@Serializable
data class ClientRuntimeEventApi(
    @SerialName("route") val `route`: ClientLogRoute,
    @SerialName("method") val `method`: String,
    @SerialName("status") val `status`: Long,
    @SerialName("durationMs") val `durationMs`: Long,
    @SerialName("requestId") val `requestId`: Id? = null,
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
data class ConversationGroup(
    @SerialName("createdByCharacterId") val `createdByCharacterId`: Id?,
    @SerialName("titleCustomized") val `titleCustomized`: Boolean,
    @SerialName("avatarMediaId") val `avatarMediaId`: Id? = null,
    @SerialName("memberLimit") val `memberLimit`: Long,
    @SerialName("formerParticipants") val `formerParticipants`: List<Participant>? = null,
)

@Serializable
data class CreateSupportTicketTarget(
    @SerialName("type") val `type`: ComplaintTargetType,
    @SerialName("id") val `id`: Id,
)

@Serializable
data class CreateSupportTicketInputTarget(
    @SerialName("type") val `type`: ComplaintTargetType,
    @SerialName("id") val `id`: Id,
)

@Serializable
data class DailyQuestionTodayAnswer(
    @SerialName("answerId") val `answerId`: Id,
    @SerialName("userAnswer") val `userAnswer`: String,
    @SerialName("characterAnswer") val `characterAnswer`: String?,
    @SerialName("characterAnswerStatus") val `characterAnswerStatus`: String,
    @SerialName("answeredAt") val `answeredAt`: Timestamp,
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
    @SerialName("prompting") val `prompting`: CardPrompting? = null,
)

@Serializable
data class EcologyAdminOverviewLast24h(
    @SerialName("enabledUsers") val `enabledUsers`: Long,
    @SerialName("runs") val `runs`: Long,
    @SerialName("actions") val `actions`: Long,
    @SerialName("points") val `points`: Double,
)

@Serializable
data class EcologyConfigLevels(
    @SerialName("occasional") val `occasional`: EcologyLevelRange,
    @SerialName("often") val `often`: EcologyLevelRange,
    @SerialName("close") val `close`: EcologyLevelRange,
    @SerialName("inseparable") val `inseparable`: EcologyLevelRange,
)

@Serializable
data class EcologyConfigWakeWindow(
    @SerialName("startHour") val `startHour`: Long,
    @SerialName("endHour") val `endHour`: Long,
)

@Serializable
data class EcologyConfigInputLevels(
    @SerialName("occasional") val `occasional`: EcologyLevelRangeInput,
    @SerialName("often") val `often`: EcologyLevelRangeInput,
    @SerialName("close") val `close`: EcologyLevelRangeInput,
    @SerialName("inseparable") val `inseparable`: EcologyLevelRangeInput,
)

@Serializable
data class EcologyConfigInputWakeWindow(
    @SerialName("startHour") val `startHour`: Long,
    @SerialName("endHour") val `endHour`: Long,
)

@Serializable
data class EventsAchievementUnlockedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("achievementKey") val `achievementKey`: String,
    @SerialName("no") val `no`: Long,
)

@Serializable
data class EventsAdultCheckerConfiguredPayload(
    @SerialName("modelKey") val `modelKey`: ModelKey,
)

@Serializable
data class EventsAiMilestonePayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("kind") val `kind`: String,
    @SerialName("refId") val `refId`: String?,
)

@Serializable
data class EventsAnniversaryReachedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("anniversaryId") val `anniversaryId`: Id,
    @SerialName("kind") val `kind`: String,
    @SerialName("daysKnown") val `daysKnown`: Long,
    @SerialName("date") val `date`: LocalDate,
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
data class EventsCallAnsweredPayload(
    @SerialName("callId") val `callId`: Id,
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("direction") val `direction`: String,
)

@Serializable
data class EventsCallCostResolvedPayload(
    @SerialName("holdId") val `holdId`: Id,
    @SerialName("usageRecordId") val `usageRecordId`: Id,
    @SerialName("status") val `status`: String,
    @SerialName("chargedMicros") val `chargedMicros`: Long,
    @SerialName("costMicros") val `costMicros`: Long,
    @SerialName("absorbedCostMicros") val `absorbedCostMicros`: Long,
    @SerialName("ledgerEntryId") val `ledgerEntryId`: Id?,
    @SerialName("resolvedAt") val `resolvedAt`: Timestamp,
)

@Serializable
data class EventsCallCostUnknownPayload(
    @SerialName("holdId") val `holdId`: Id,
    @SerialName("modelKey") val `modelKey`: String,
    @SerialName("upstreamId") val `upstreamId`: Id,
    @SerialName("upstreamModelId") val `upstreamModelId`: String,
    @SerialName("sentAt") val `sentAt`: Timestamp,
    @SerialName("costUpperMicros") val `costUpperMicros`: Long,
    @SerialName("uncertainMicros") val `uncertainMicros`: Long,
)

@Serializable
data class EventsCallEndedPayload(
    @SerialName("callId") val `callId`: Id,
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("direction") val `direction`: String,
    @SerialName("outcome") val `outcome`: String,
    @SerialName("durationSec") val `durationSec`: Long,
)

@Serializable
data class EventsCallStartedPayload(
    @SerialName("callId") val `callId`: Id,
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("direction") val `direction`: String,
)

@Serializable
data class EventsCardIssuedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("cardId") val `cardId`: Id,
    @SerialName("kind") val `kind`: String,
    @SerialName("totalCards") val `totalCards`: Long,
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
data class EventsDailyAnswerSubmittedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("answerId") val `answerId`: Id,
    @SerialName("questionId") val `questionId`: Id,
    @SerialName("messageId") val `messageId`: Id,
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
data class EventsDomainEventModelAccessAdultCheckerConfiguredPayload(
    @SerialName("modelKey") val `modelKey`: ModelKey,
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
data class EventsDomainEventBillingCallCostUnknownPayload(
    @SerialName("holdId") val `holdId`: Id,
    @SerialName("modelKey") val `modelKey`: String,
    @SerialName("upstreamId") val `upstreamId`: Id,
    @SerialName("upstreamModelId") val `upstreamModelId`: String,
    @SerialName("sentAt") val `sentAt`: Timestamp,
    @SerialName("costUpperMicros") val `costUpperMicros`: Long,
    @SerialName("uncertainMicros") val `uncertainMicros`: Long,
)

@Serializable
data class EventsDomainEventBillingCallCostResolvedPayload(
    @SerialName("holdId") val `holdId`: Id,
    @SerialName("usageRecordId") val `usageRecordId`: Id,
    @SerialName("status") val `status`: String,
    @SerialName("chargedMicros") val `chargedMicros`: Long,
    @SerialName("costMicros") val `costMicros`: Long,
    @SerialName("absorbedCostMicros") val `absorbedCostMicros`: Long,
    @SerialName("ledgerEntryId") val `ledgerEntryId`: Id?,
    @SerialName("resolvedAt") val `resolvedAt`: Timestamp,
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
data class EventsDomainEventCharactersRelationChangedPayload(
    @SerialName("relationId") val `relationId`: Id,
    @SerialName("characterAId") val `characterAId`: Id,
    @SerialName("characterBId") val `characterBId`: Id,
    @SerialName("ownerUserId") val `ownerUserId`: Id?,
    @SerialName("action") val `action`: String,
)

@Serializable
data class EventsDomainEventCharactersSupplementChangedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("action") val `action`: String,
)

@Serializable
data class EventsDomainEventChatGroupMembersChangedPayload(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("ownerUserId") val `ownerUserId`: Id,
    @SerialName("addedCharacterIds") val `addedCharacterIds`: List<Id>,
    @SerialName("removedCharacterIds") val `removedCharacterIds`: List<Id>,
    @SerialName("cause") val `cause`: String,
    @SerialName("byCharacterId") val `byCharacterId`: Id?,
)

@Serializable
data class EventsDomainEventChatGroupRenamedPayload(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("ownerUserId") val `ownerUserId`: Id,
    @SerialName("byCharacterId") val `byCharacterId`: Id?,
)

@Serializable
data class EventsDomainEventChatGroupDissolvedPayload(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("ownerUserId") val `ownerUserId`: Id,
    @SerialName("createdByCharacterId") val `createdByCharacterId`: Id?,
    @SerialName("memberCharacterIds") val `memberCharacterIds`: List<Id>,
)

@Serializable
data class EventsDomainEventChatMessageActionChosenPayload(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("messageId") val `messageId`: Id,
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id?,
    @SerialName("cardKind") val `cardKind`: String,
    @SerialName("actionId") val `actionId`: String,
    @SerialName("ref") val `ref`: EventsDomainEventChatMessageActionChosenPayloadRef?,
)

@Serializable
data class EventsDomainEventMomentsPostCreatedPayload(
    @SerialName("postId") val `postId`: Id,
    @SerialName("ownerUserId") val `ownerUserId`: Id,
    @SerialName("authorKind") val `authorKind`: String,
    @SerialName("authorCharacterId") val `authorCharacterId`: Id?,
    @SerialName("hasImages") val `hasImages`: Boolean,
    @SerialName("visibleCharacterIds") val `visibleCharacterIds`: List<Id>,
)

@Serializable
data class EventsDomainEventMomentsCommentCreatedPayload(
    @SerialName("postId") val `postId`: Id,
    @SerialName("commentId") val `commentId`: Id,
    @SerialName("ownerUserId") val `ownerUserId`: Id,
    @SerialName("postAuthorKind") val `postAuthorKind`: String,
    @SerialName("postAuthorCharacterId") val `postAuthorCharacterId`: Id?,
    @SerialName("authorKind") val `authorKind`: String,
    @SerialName("authorCharacterId") val `authorCharacterId`: Id?,
    @SerialName("replyToKind") val `replyToKind`: String?,
    @SerialName("replyToCharacterId") val `replyToCharacterId`: Id?,
    @SerialName("mentionsUser") val `mentionsUser`: Boolean,
)

@Serializable
data class EventsDomainEventMomentsPostLikedPayload(
    @SerialName("postId") val `postId`: Id,
    @SerialName("ownerUserId") val `ownerUserId`: Id,
    @SerialName("postAuthorKind") val `postAuthorKind`: String,
    @SerialName("likerKind") val `likerKind`: String,
    @SerialName("likerCharacterId") val `likerCharacterId`: Id?,
    @SerialName("characterLikeCount") val `characterLikeCount`: Long,
)

@Serializable
data class EventsDomainEventAiRuntimeMilestonePayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("kind") val `kind`: String,
    @SerialName("refId") val `refId`: String?,
)

@Serializable
data class EventsDomainEventGrowthFamiliarityLeveledUpPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("level") val `level`: Long,
)

@Serializable
data class EventsDomainEventGrowthAnniversaryReachedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("anniversaryId") val `anniversaryId`: Id,
    @SerialName("kind") val `kind`: String,
    @SerialName("daysKnown") val `daysKnown`: Long,
    @SerialName("date") val `date`: LocalDate,
)

@Serializable
data class EventsDomainEventGrowthCardIssuedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("cardId") val `cardId`: Id,
    @SerialName("kind") val `kind`: String,
    @SerialName("totalCards") val `totalCards`: Long,
)

@Serializable
data class EventsDomainEventGrowthAchievementUnlockedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("achievementKey") val `achievementKey`: String,
    @SerialName("no") val `no`: Long,
)

@Serializable
data class EventsDomainEventGrowthPetAdoptedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("petId") val `petId`: Id,
    @SerialName("speciesId") val `speciesId`: Id,
)

@Serializable
data class EventsDomainEventGrowthPetStageChangedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("petId") val `petId`: Id,
    @SerialName("stage") val `stage`: String,
)

@Serializable
data class EventsDomainEventGrowthPetSentAwayPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("petId") val `petId`: Id,
)

@Serializable
data class EventsDomainEventGrowthPetRenamedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("petId") val `petId`: Id,
)

@Serializable
data class EventsDomainEventGrowthPetNamingRequestedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("requestId") val `requestId`: Id,
    @SerialName("speciesId") val `speciesId`: Id,
    @SerialName("appearanceId") val `appearanceId`: Id,
    @SerialName("speciesName") val `speciesName`: String? = null,
)

@Serializable
data class EventsDomainEventLibraryFavoriteAddedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("favoriteIds") val `favoriteIds`: List<Id>,
    @SerialName("totalFavorites") val `totalFavorites`: Long,
)

@Serializable
data class EventsDomainEventLibraryShareImageGeneratedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("template") val `template`: String,
)

@Serializable
data class EventsDomainEventCallsCallStartedPayload(
    @SerialName("callId") val `callId`: Id,
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("direction") val `direction`: String,
)

@Serializable
data class EventsDomainEventCallsCallAnsweredPayload(
    @SerialName("callId") val `callId`: Id,
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("direction") val `direction`: String,
)

@Serializable
data class EventsDomainEventCallsCallEndedPayload(
    @SerialName("callId") val `callId`: Id,
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("direction") val `direction`: String,
    @SerialName("outcome") val `outcome`: String,
    @SerialName("durationSec") val `durationSec`: Long,
)

@Serializable
data class EventsDomainEventImporterJobCompletedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("jobId") val `jobId`: Id,
    @SerialName("kind") val `kind`: String,
    @SerialName("ok") val `ok`: Boolean,
)

@Serializable
data class EventsDomainEventPlazaWorkPublishedPayload(
    @SerialName("workId") val `workId`: Id,
    @SerialName("authorUserId") val `authorUserId`: Id,
    @SerialName("kind") val `kind`: String,
)

@Serializable
data class EventsDomainEventPlazaWorkVersionPublishedPayload(
    @SerialName("workId") val `workId`: Id,
    @SerialName("authorUserId") val `authorUserId`: Id,
    @SerialName("version") val `version`: Long,
)

@Serializable
data class EventsDomainEventPlazaWorkRemovedPayload(
    @SerialName("workId") val `workId`: Id,
    @SerialName("authorUserId") val `authorUserId`: Id,
    @SerialName("reason") val `reason`: String,
)

@Serializable
data class EventsDomainEventPlayDailyAnswerSubmittedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("answerId") val `answerId`: Id,
    @SerialName("questionId") val `questionId`: Id,
    @SerialName("messageId") val `messageId`: Id,
)

@Serializable
data class EventsDomainEventPlayWishlistItemChangedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("itemId") val `itemId`: Id,
    @SerialName("action") val `action`: String,
    @SerialName("dueDate") val `dueDate`: LocalDate?,
)

@Serializable
data class EventsDomainEventPlayWishlistItemCompletedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("itemId") val `itemId`: Id,
    @SerialName("firstCompletion") val `firstCompletion`: Boolean,
)

@Serializable
data class EventsDomainEventPlayLetterSentPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("letterId") val `letterId`: Id,
    @SerialName("deliverAt") val `deliverAt`: Timestamp,
)

@Serializable
data class EventsDomainEventPlayLetterDeliveredPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("letterId") val `letterId`: Id,
    @SerialName("firstReplyFromCharacter") val `firstReplyFromCharacter`: Boolean,
)

@Serializable
data class EventsDomainEventPlayFocusStartedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("focusId") val `focusId`: Id,
    @SerialName("endsAt") val `endsAt`: Timestamp,
)

@Serializable
data class EventsDomainEventPlayFocusEndedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("focusId") val `focusId`: Id,
    @SerialName("result") val `result`: String,
    @SerialName("minutes") val `minutes`: Long,
)

@Serializable
data class EventsDomainEventPlayReminderSavedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("reminderId") val `reminderId`: Id,
    @SerialName("textChanged") val `textChanged`: Boolean,
)

@Serializable
data class EventsFamiliarityLeveledUpPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("level") val `level`: Long,
)

@Serializable
data class EventsFavoriteAddedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("favoriteIds") val `favoriteIds`: List<Id>,
    @SerialName("totalFavorites") val `totalFavorites`: Long,
)

@Serializable
data class EventsFocusEndedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("focusId") val `focusId`: Id,
    @SerialName("result") val `result`: String,
    @SerialName("minutes") val `minutes`: Long,
)

@Serializable
data class EventsFocusStartedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("focusId") val `focusId`: Id,
    @SerialName("endsAt") val `endsAt`: Timestamp,
)

@Serializable
data class EventsGroupDissolvedPayload(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("ownerUserId") val `ownerUserId`: Id,
    @SerialName("createdByCharacterId") val `createdByCharacterId`: Id?,
    @SerialName("memberCharacterIds") val `memberCharacterIds`: List<Id>,
)

@Serializable
data class EventsGroupMembersChangedPayload(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("ownerUserId") val `ownerUserId`: Id,
    @SerialName("addedCharacterIds") val `addedCharacterIds`: List<Id>,
    @SerialName("removedCharacterIds") val `removedCharacterIds`: List<Id>,
    @SerialName("cause") val `cause`: String,
    @SerialName("byCharacterId") val `byCharacterId`: Id?,
)

@Serializable
data class EventsGroupRenamedPayload(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("ownerUserId") val `ownerUserId`: Id,
    @SerialName("byCharacterId") val `byCharacterId`: Id?,
)

@Serializable
data class EventsImportJobCompletedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("jobId") val `jobId`: Id,
    @SerialName("kind") val `kind`: String,
    @SerialName("ok") val `ok`: Boolean,
)

@Serializable
data class EventsLetterDeliveredPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("letterId") val `letterId`: Id,
    @SerialName("firstReplyFromCharacter") val `firstReplyFromCharacter`: Boolean,
)

@Serializable
data class EventsLetterSentPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("letterId") val `letterId`: Id,
    @SerialName("deliverAt") val `deliverAt`: Timestamp,
)

@Serializable
data class EventsMessageActionChosenPayload(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("messageId") val `messageId`: Id,
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id?,
    @SerialName("cardKind") val `cardKind`: String,
    @SerialName("actionId") val `actionId`: String,
    @SerialName("ref") val `ref`: EventsMessageActionChosenPayloadRef?,
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
data class EventsMomentsCommentCreatedPayload(
    @SerialName("postId") val `postId`: Id,
    @SerialName("commentId") val `commentId`: Id,
    @SerialName("ownerUserId") val `ownerUserId`: Id,
    @SerialName("postAuthorKind") val `postAuthorKind`: String,
    @SerialName("postAuthorCharacterId") val `postAuthorCharacterId`: Id?,
    @SerialName("authorKind") val `authorKind`: String,
    @SerialName("authorCharacterId") val `authorCharacterId`: Id?,
    @SerialName("replyToKind") val `replyToKind`: String?,
    @SerialName("replyToCharacterId") val `replyToCharacterId`: Id?,
    @SerialName("mentionsUser") val `mentionsUser`: Boolean,
)

@Serializable
data class EventsMomentsPostCreatedPayload(
    @SerialName("postId") val `postId`: Id,
    @SerialName("ownerUserId") val `ownerUserId`: Id,
    @SerialName("authorKind") val `authorKind`: String,
    @SerialName("authorCharacterId") val `authorCharacterId`: Id?,
    @SerialName("hasImages") val `hasImages`: Boolean,
    @SerialName("visibleCharacterIds") val `visibleCharacterIds`: List<Id>,
)

@Serializable
data class EventsMomentsPostLikedPayload(
    @SerialName("postId") val `postId`: Id,
    @SerialName("ownerUserId") val `ownerUserId`: Id,
    @SerialName("postAuthorKind") val `postAuthorKind`: String,
    @SerialName("likerKind") val `likerKind`: String,
    @SerialName("likerCharacterId") val `likerCharacterId`: Id?,
    @SerialName("characterLikeCount") val `characterLikeCount`: Long,
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
data class EventsPetAdoptedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("petId") val `petId`: Id,
    @SerialName("speciesId") val `speciesId`: Id,
)

@Serializable
data class EventsPetNamingRequestedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("requestId") val `requestId`: Id,
    @SerialName("speciesId") val `speciesId`: Id,
    @SerialName("appearanceId") val `appearanceId`: Id,
    @SerialName("speciesName") val `speciesName`: String? = null,
)

@Serializable
data class EventsPetRenamedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("petId") val `petId`: Id,
)

@Serializable
data class EventsPetSentAwayPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("petId") val `petId`: Id,
)

@Serializable
data class EventsPetStageChangedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("petId") val `petId`: Id,
    @SerialName("stage") val `stage`: String,
)

@Serializable
data class EventsPlazaWorkPublishedPayload(
    @SerialName("workId") val `workId`: Id,
    @SerialName("authorUserId") val `authorUserId`: Id,
    @SerialName("kind") val `kind`: String,
)

@Serializable
data class EventsPlazaWorkRemovedPayload(
    @SerialName("workId") val `workId`: Id,
    @SerialName("authorUserId") val `authorUserId`: Id,
    @SerialName("reason") val `reason`: String,
)

@Serializable
data class EventsPlazaWorkVersionPublishedPayload(
    @SerialName("workId") val `workId`: Id,
    @SerialName("authorUserId") val `authorUserId`: Id,
    @SerialName("version") val `version`: Long,
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
data class EventsRelationChangedPayload(
    @SerialName("relationId") val `relationId`: Id,
    @SerialName("characterAId") val `characterAId`: Id,
    @SerialName("characterBId") val `characterBId`: Id,
    @SerialName("ownerUserId") val `ownerUserId`: Id?,
    @SerialName("action") val `action`: String,
)

@Serializable
data class EventsReminderSavedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("reminderId") val `reminderId`: Id,
    @SerialName("textChanged") val `textChanged`: Boolean,
)

@Serializable
data class EventsSessionRevokedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("sessionId") val `sessionId`: Id,
    @SerialName("reason") val `reason`: String,
)

@Serializable
data class EventsShareImageGeneratedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("template") val `template`: String,
)

@Serializable
data class EventsSupplementChangedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("action") val `action`: String,
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

@Serializable
data class EventsWishlistItemChangedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("itemId") val `itemId`: Id,
    @SerialName("action") val `action`: String,
    @SerialName("dueDate") val `dueDate`: LocalDate?,
)

@Serializable
data class EventsWishlistItemCompletedPayload(
    @SerialName("userId") val `userId`: Id,
    @SerialName("characterId") val `characterId`: Id,
    @SerialName("itemId") val `itemId`: Id,
    @SerialName("firstCompletion") val `firstCompletion`: Boolean,
)

typealias ForwardMessagesResponseResultsItem = JsonElement

@Serializable
data class ForwardedRecordContentItemsItem(
    @SerialName("senderName") val `senderName`: String,
    @SerialName("senderKind") val `senderKind`: ParticipantKind,
    @SerialName("createdAt") val `createdAt`: Timestamp,
    @SerialName("content") val `content`: ForwardSnapshotContent,
)

@Serializable
data class GrowthCardFace(
    @SerialName("templateId") val `templateId`: Id?,
    @SerialName("mediaId") val `mediaId`: Id?,
    @SerialName("url") val `url`: String?,
)

@Serializable
data class HealthTagAdminEndpointsPutSymptomTagsBodyItemsItem(
    @SerialName("name") val `name`: String,
    @SerialName("order") val `order`: Long,
    @SerialName("enabled") val `enabled`: Boolean,
    @SerialName("tagId") val `tagId`: Id? = null,
)

@Serializable
data class ImportJobSpeakersItem(
    @SerialName("name") val `name`: String,
    @SerialName("messageCount") val `messageCount`: Long,
)

@Serializable
data class LeaderboardSnapshotStatusSnapshot(
    @SerialName("fetchedAt") val `fetchedAt`: Timestamp,
    @SerialName("method") val `method`: String,
    @SerialName("entries") val `entries`: Long,
    @SerialName("publishedAt") val `publishedAt`: LocalDate? = null,
    @SerialName("sourceUrl") val `sourceUrl`: String? = null,
    @SerialName("totalRows") val `totalRows`: Long? = null,
)

@Serializable
data class LeaderboardSnapshotStatusMatchedItem(
    @SerialName("modelKey") val `modelKey`: ModelKey,
    @SerialName("displayName") val `displayName`: String,
    @SerialName("arenaModelName") val `arenaModelName`: String,
    @SerialName("rank") val `rank`: Long,
    @SerialName("relativeRank") val `relativeRank`: Long,
)

@Serializable
data class LeaderboardSnapshotStatusUnmatchedItem(
    @SerialName("modelKey") val `modelKey`: ModelKey,
    @SerialName("displayName") val `displayName`: String,
    @SerialName("arenaModelName") val `arenaModelName`: String?,
    @SerialName("suggestions") val `suggestions`: List<LeaderboardSnapshotStatusUnmatchedItemSuggestionsItem>? = null,
)

@Serializable
data class MemoryTierStatusLongContext(
    @SerialName("available") val `available`: Boolean,
    @SerialName("enabled") val `enabled`: Boolean,
    @SerialName("pointsPerMessage") val `pointsPerMessage`: Double?,
    @SerialName("normalPointsPerMessage") val `normalPointsPerMessage`: Double?,
)

@Serializable
data class MessageActionChoice(
    @SerialName("actionId") val `actionId`: String,
    @SerialName("chosenAt") val `chosenAt`: Timestamp,
)

typealias MessageContentSystemParamsValue = JsonElement

@Serializable
data class MessageContentActionCardActionsItem(
    @SerialName("actionId") val `actionId`: String,
    @SerialName("label") val `label`: String,
    @SerialName("style") val `style`: MessageActionStyle,
)

@Serializable
data class MessageContentActionCardRef(
    @SerialName("kind") val `kind`: String,
    @SerialName("id") val `id`: String,
)

@Serializable
data class MessageContentForwardedRecordItemsItem(
    @SerialName("senderName") val `senderName`: String,
    @SerialName("senderKind") val `senderKind`: ParticipantKind,
    @SerialName("createdAt") val `createdAt`: Timestamp,
    @SerialName("content") val `content`: ForwardSnapshotContent,
)

@Serializable
data class MessagePageCoverageExcludedRangesItem(
    @SerialName("fromSeq") val `fromSeq`: Seq,
    @SerialName("throughSeq") val `throughSeq`: Seq,
    @SerialName("reason") val `reason`: String,
)

@Serializable
data class ModelDeletionImpactModelsItem(
    @SerialName("modelKey") val `modelKey`: ModelKey,
    @SerialName("displayName") val `displayName`: String,
    @SerialName("enabled") val `enabled`: Boolean,
)

@Serializable
data class ModelInfoPointsPerUse(
    @SerialName("chat") val `chat`: Double? = null,
    @SerialName("vision") val `vision`: Double? = null,
    @SerialName("voice_message") val `voice_message`: Double? = null,
    @SerialName("speech_recognition") val `speech_recognition`: Double? = null,
    @SerialName("voice_call") val `voice_call`: Double? = null,
    @SerialName("image_generation") val `image_generation`: Double? = null,
    @SerialName("private") val `private`: Double? = null,
)

@Serializable
data class ModelLeaderboardInfoPopularItem(
    @SerialName("modelKey") val `modelKey`: String,
    @SerialName("users") val `users`: Long,
)

@Serializable
data class ModelScenarioSettingsRecommended(
    @SerialName("chat") val `chat`: ModelKey? = null,
    @SerialName("vision") val `vision`: ModelKey? = null,
    @SerialName("voice_message") val `voice_message`: ModelKey? = null,
    @SerialName("speech_recognition") val `speech_recognition`: ModelKey? = null,
    @SerialName("voice_call") val `voice_call`: ModelKey? = null,
    @SerialName("image_generation") val `image_generation`: ModelKey? = null,
    @SerialName("private") val `private`: ModelKey? = null,
)

@Serializable
data class ModelScenarioSettingsInternal(
    @SerialName("safety") val `safety`: ModelKey? = null,
    @SerialName("small_v") val `small_v`: ModelKey? = null,
    @SerialName("platform_content") val `platform_content`: ModelKey? = null,
    @SerialName("planner") val `planner`: ModelKey? = null,
    @SerialName("adult_check") val `adult_check`: ModelKey? = null,
    @SerialName("web_search") val `web_search`: ModelKey? = null,
)

@Serializable
data class ModelScenarioSettingsInputRecommended(
    @SerialName("chat") val `chat`: ModelKey? = null,
    @SerialName("vision") val `vision`: ModelKey? = null,
    @SerialName("voice_message") val `voice_message`: ModelKey? = null,
    @SerialName("speech_recognition") val `speech_recognition`: ModelKey? = null,
    @SerialName("voice_call") val `voice_call`: ModelKey? = null,
    @SerialName("image_generation") val `image_generation`: ModelKey? = null,
    @SerialName("private") val `private`: ModelKey? = null,
)

@Serializable
data class ModelScenarioSettingsInputInternal(
    @SerialName("safety") val `safety`: ModelKey? = null,
    @SerialName("small_v") val `small_v`: ModelKey? = null,
    @SerialName("platform_content") val `platform_content`: ModelKey? = null,
    @SerialName("planner") val `planner`: ModelKey? = null,
    @SerialName("adult_check") val `adult_check`: ModelKey? = null,
    @SerialName("web_search") val `web_search`: ModelKey? = null,
)

@Serializable
data class ModelsDevLookupRequestItemsItem(
    @SerialName("name") val `name`: String,
    @SerialName("vendor") val `vendor`: String? = null,
)

@Serializable
data class ModelsDevLookupRequestInputItemsItem(
    @SerialName("name") val `name`: String,
    @SerialName("vendor") val `vendor`: String? = null,
)

@Serializable
data class ModelsDevLookupResponseItemsItem(
    @SerialName("name") val `name`: String,
    @SerialName("match") val `match`: ModelsDevMatch?,
)

@Serializable
data class MomentsNotificationPost(
    @SerialName("author") val `author`: MomentsActor,
    @SerialName("text") val `text`: String,
    @SerialName("imageMediaId") val `imageMediaId`: Id?,
)

@Serializable
data class MomentsPostLink(
    @SerialName("url") val `url`: String,
    @SerialName("title") val `title`: String,
    @SerialName("source") val `source`: String?,
    @SerialName("description") val `description`: String?,
    @SerialName("coverMediaId") val `coverMediaId`: Id?,
    @SerialName("appHint") val `appHint`: String,
)

@Serializable
data class NotificationSettingsDoNotDisturb(
    @SerialName("enabled") val `enabled`: Boolean,
    @SerialName("start") val `start`: LocalTime,
    @SerialName("end") val `end`: LocalTime,
)

@Serializable
data class PetAppearanceImages(
    @SerialName("baby") val `baby`: PetImage,
    @SerialName("junior") val `junior`: PetImage,
    @SerialName("adult") val `adult`: PetImage,
)

@Serializable
data class PetSpeciesAdminEndpointsUpdateSpeciesBodyAppearancesItem(
    @SerialName("appearanceId") val `appearanceId`: Id? = null,
    @SerialName("name") val `name`: String,
    @SerialName("imageMediaIds") val `imageMediaIds`: PetSpeciesAdminEndpointsUpdateSpeciesBodyAppearancesItemImageMediaIds,
    @SerialName("listed") val `listed`: Boolean? = null,
)

@Serializable
data class PetSpeciesWriteAppearancesItem(
    @SerialName("appearanceId") val `appearanceId`: Id? = null,
    @SerialName("name") val `name`: String,
    @SerialName("imageMediaIds") val `imageMediaIds`: PetSpeciesWriteAppearancesItemImageMediaIds,
    @SerialName("listed") val `listed`: Boolean? = null,
)

@Serializable
data class PetSpeciesWriteInputAppearancesItem(
    @SerialName("appearanceId") val `appearanceId`: Id? = null,
    @SerialName("name") val `name`: String,
    @SerialName("imageMediaIds") val `imageMediaIds`: PetSpeciesWriteInputAppearancesItemImageMediaIds,
    @SerialName("listed") val `listed`: Boolean? = null,
)

@Serializable
data class PlazaAdminEndpointsListBansResponseItemsItem(
    @SerialName("userId") val `userId`: Id,
    @SerialName("nickname") val `nickname`: String?,
    @SerialName("until") val `until`: String,
    @SerialName("reason") val `reason`: String,
    @SerialName("bannedAt") val `bannedAt`: Timestamp,
)

typealias PlazaEndpointsReportBodyTarget = JsonElement

@Serializable
data class PlazaWorkDetailRemixOf(
    @SerialName("workId") val `workId`: Id,
    @SerialName("name") val `name`: String,
    @SerialName("authorNickname") val `authorNickname`: String,
    @SerialName("available") val `available`: Boolean,
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
data class ReceivedMessageContentActionCardActionsItem(
    @SerialName("actionId") val `actionId`: String,
    @SerialName("label") val `label`: String,
    @SerialName("style") val `style`: MessageActionStyle,
)

@Serializable
data class ReceivedMessageContentActionCardRef(
    @SerialName("kind") val `kind`: String,
    @SerialName("id") val `id`: String,
)

@Serializable
data class ReceivedMessageContentForwardedRecordItemsItem(
    @SerialName("senderName") val `senderName`: String,
    @SerialName("senderKind") val `senderKind`: ParticipantKind,
    @SerialName("createdAt") val `createdAt`: Timestamp,
    @SerialName("content") val `content`: ForwardSnapshotContent,
)

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
data class ReceivedUserUpdatePayloadMessageUpdatedData(
    @SerialName("message") val `message`: Message,
)

@Serializable
data class ReceivedUserUpdatePayloadCallUpdatedData(
    @SerialName("call") val `call`: CallSession,
)

@Serializable
data class ReceivedUserUpdatePayloadMediaTranscriptReadyData(
    @SerialName("transcript") val `transcript`: MediaTranscript,
)

@Serializable
data class ReceivedUserUpdatePayloadMomentsBadgeUpdatedData(
    @SerialName("badge") val `badge`: MomentsBadge,
)

@Serializable
data class ReceivedUserUpdatePayloadMomentsPostChangedData(
    @SerialName("postId") val `postId`: Id,
    @SerialName("deleted") val `deleted`: Boolean,
)

@Serializable
data class ReceivedUserUpdatePayloadDataChangedData(
    @SerialName("section") val `section`: String,
    @SerialName("characterId") val `characterId`: Id?,
    @SerialName("itemId") val `itemId`: Id?,
)

@Serializable
data class ReceivedUserUpdatePayloadConversationRemovedData(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("reason") val `reason`: String,
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
    @SerialName("netComputedCostMicros") val `netComputedCostMicros`: MoneyMicros? = null,
    @SerialName("unknownCostCalls") val `unknownCostCalls`: Long? = null,
    @SerialName("uncertainCostMicros") val `uncertainCostMicros`: Long? = null,
    @SerialName("estimatedUsageCalls") val `estimatedUsageCalls`: Long? = null,
    @SerialName("diffRatio") val `diffRatio`: Double,
    @SerialName("flagged") val `flagged`: Boolean,
)

@Serializable
data class RouteBillingBoundsText(
    @SerialName("contextTokens") val `contextTokens`: Long,
    @SerialName("maxOutputTokens") val `maxOutputTokens`: Long,
    @EncodeDefault
    @SerialName("totalOutputIncludesReasoning") val `totalOutputIncludesReasoning`: Boolean = true,
    @SerialName("outputParameter") val `outputParameter`: String,
    @SerialName("maxImages") val `maxImages`: Long,
)

@Serializable
data class RouteBillingBoundsTts(
    @SerialName("maxTextBytes") val `maxTextBytes`: Long,
    @SerialName("counting") val `counting`: String,
)

@Serializable
data class RouteBillingBoundsAsr(
    @SerialName("maxSeconds") val `maxSeconds`: Long,
    @SerialName("billingStepSeconds") val `billingStepSeconds`: Long,
)

@Serializable
data class RouteBillingBoundsImage(
    @SerialName("sizes") val `sizes`: List<String>,
    @EncodeDefault
    @SerialName("quality") val `quality`: String = "standard",
    @EncodeDefault
    @SerialName("count") val `count`: Long = 1,
)

@Serializable
data class RouteBillingBoundsSearch(
    @SerialName("maxResults") val `maxResults`: Long,
    @EncodeDefault
    @SerialName("billableCalls") val `billableCalls`: Long = 1,
)

@Serializable
data class RouteBillingBoundsDecision(
    @SerialName("maxInputTokens") val `maxInputTokens`: Long,
)

@Serializable
data class RouteBillingBoundsInputText(
    @SerialName("contextTokens") val `contextTokens`: Long,
    @SerialName("maxOutputTokens") val `maxOutputTokens`: Long,
    @EncodeDefault
    @SerialName("totalOutputIncludesReasoning") val `totalOutputIncludesReasoning`: Boolean = true,
    @SerialName("outputParameter") val `outputParameter`: String,
    @SerialName("maxImages") val `maxImages`: Long,
)

@Serializable
data class RouteBillingBoundsInputTts(
    @SerialName("maxTextBytes") val `maxTextBytes`: Long,
    @SerialName("counting") val `counting`: String,
)

@Serializable
data class RouteBillingBoundsInputAsr(
    @SerialName("maxSeconds") val `maxSeconds`: Long,
    @SerialName("billingStepSeconds") val `billingStepSeconds`: Long,
)

@Serializable
data class RouteBillingBoundsInputImage(
    @SerialName("sizes") val `sizes`: List<String>,
    @EncodeDefault
    @SerialName("quality") val `quality`: String = "standard",
    @EncodeDefault
    @SerialName("count") val `count`: Long = 1,
)

@Serializable
data class RouteBillingBoundsInputSearch(
    @SerialName("maxResults") val `maxResults`: Long,
    @EncodeDefault
    @SerialName("billableCalls") val `billableCalls`: Long = 1,
)

@Serializable
data class RouteBillingBoundsInputDecision(
    @SerialName("maxInputTokens") val `maxInputTokens`: Long,
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

typealias SetUserStatusRequestDuration = JsonElement

typealias SetUserStatusRequestInputDuration = JsonElement

@Serializable
data class ShareRejectedDetailsRejectedItem(
    @SerialName("id") val `id`: Id,
    @SerialName("reason") val `reason`: String,
)

@Serializable
data class SupportTicketTarget(
    @SerialName("type") val `type`: String,
    @SerialName("id") val `id`: Id,
)

typealias SystemContentParamsValue = JsonElement

@Serializable
data class TimelineEntryRef(
    @SerialName("kind") val `kind`: String,
    @SerialName("id") val `id`: String,
)

@Serializable
data class UnsupportedUpdateData(
    @SerialName("originalType") val `originalType`: String,
)

@Serializable
data class UpdateEcologySettingsActionsItem(
    @SerialName("key") val `key`: EcologyActionKey,
    @SerialName("enabled") val `enabled`: Boolean,
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
data class UpdateRechargeOptionsRequestTiersItem(
    @SerialName("tierId") val `tierId`: String,
    @SerialName("priceMicros") val `priceMicros`: PositiveMoneyMicros,
    @SerialName("bonusPercent") val `bonusPercent`: Double,
)

@Serializable
data class UpdateRechargeOptionsRequestInputTiersItem(
    @SerialName("tierId") val `tierId`: String,
    @SerialName("priceMicros") val `priceMicros`: PositiveMoneyMicros,
    @SerialName("bonusPercent") val `bonusPercent`: Double,
)

@Serializable
data class UpstreamModelListItemsItem(
    @SerialName("id") val `id`: String,
)

@Serializable
data class UserSupplementPlazaSource(
    @SerialName("workId") val `workId`: Id,
    @SerialName("version") val `version`: Long,
    @SerialName("authorName") val `authorName`: String,
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
data class UserUpdateMessageUpdatedData(
    @SerialName("message") val `message`: Message,
)

@Serializable
data class UserUpdateCallUpdatedData(
    @SerialName("call") val `call`: CallSession,
)

@Serializable
data class UserUpdateMediaTranscriptReadyData(
    @SerialName("transcript") val `transcript`: MediaTranscript,
)

@Serializable
data class UserUpdateMomentsBadgeUpdatedData(
    @SerialName("badge") val `badge`: MomentsBadge,
)

@Serializable
data class UserUpdateMomentsPostChangedData(
    @SerialName("postId") val `postId`: Id,
    @SerialName("deleted") val `deleted`: Boolean,
)

@Serializable
data class UserUpdateDataChangedData(
    @SerialName("section") val `section`: String,
    @SerialName("characterId") val `characterId`: Id?,
    @SerialName("itemId") val `itemId`: Id?,
)

@Serializable
data class UserUpdateConversationRemovedData(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("reason") val `reason`: String,
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
data class UserUpdatePayloadMessageUpdatedData(
    @SerialName("message") val `message`: Message,
)

@Serializable
data class UserUpdatePayloadCallUpdatedData(
    @SerialName("call") val `call`: CallSession,
)

@Serializable
data class UserUpdatePayloadMediaTranscriptReadyData(
    @SerialName("transcript") val `transcript`: MediaTranscript,
)

@Serializable
data class UserUpdatePayloadMomentsBadgeUpdatedData(
    @SerialName("badge") val `badge`: MomentsBadge,
)

@Serializable
data class UserUpdatePayloadMomentsPostChangedData(
    @SerialName("postId") val `postId`: Id,
    @SerialName("deleted") val `deleted`: Boolean,
)

@Serializable
data class UserUpdatePayloadDataChangedData(
    @SerialName("section") val `section`: String,
    @SerialName("characterId") val `characterId`: Id?,
    @SerialName("itemId") val `itemId`: Id?,
)

@Serializable
data class UserUpdatePayloadConversationRemovedData(
    @SerialName("conversationId") val `conversationId`: Id,
    @SerialName("reason") val `reason`: String,
)

@Serializable
data class WalletBackgroundBudget(
    @SerialName("dailyLimitMicros") val `dailyLimitMicros`: Long,
    @SerialName("spentTodayMicros") val `spentTodayMicros`: Long,
    @SerialName("resetsAt") val `resetsAt`: Timestamp,
    @SerialName("dailyLimitPoints") val `dailyLimitPoints`: NonNegativePoints? = null,
    @SerialName("spentTodayPoints") val `spentTodayPoints`: NonNegativePoints? = null,
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

@Serializable
data class WorkLinkLastCheck(
    @SerialName("ok") val `ok`: Boolean,
    @SerialName("checkedAt") val `checkedAt`: Timestamp,
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
    @SerialName("scanDepth") val `scanDepth`: Long? = null,
    @SerialName("constantBudget") val `constantBudget`: Long? = null,
    @SerialName("triggeredBudget") val `triggeredBudget`: Long? = null,
    @SerialName("recursive") val `recursive`: Boolean? = null,
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
    @SerialName("weibo") val `weibo`: DraftCharacterCardDataProfileExtraWeibo? = null,
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
data class EventsDomainEventChatMessageActionChosenPayloadRef(
    @SerialName("kind") val `kind`: String,
    @SerialName("id") val `id`: String,
)

@Serializable
data class EventsMessageActionChosenPayloadRef(
    @SerialName("kind") val `kind`: String,
    @SerialName("id") val `id`: String,
)

@Serializable
data class EventsUserRegisteredPayloadSignupBonus(
    @SerialName("amountMicros") val `amountMicros`: Long,
    @SerialName("grantedByUserId") val `grantedByUserId`: Id?,
)

@Serializable
data class LeaderboardSnapshotStatusUnmatchedItemSuggestionsItem(
    @SerialName("name") val `name`: String,
    @SerialName("rank") val `rank`: Long,
    @SerialName("score") val `score`: Double,
)

@Serializable
data class PetSpeciesAdminEndpointsUpdateSpeciesBodyAppearancesItemImageMediaIds(
    @SerialName("baby") val `baby`: Id,
    @SerialName("junior") val `junior`: Id,
    @SerialName("adult") val `adult`: Id,
)

@Serializable
data class PetSpeciesWriteAppearancesItemImageMediaIds(
    @SerialName("baby") val `baby`: Id,
    @SerialName("junior") val `junior`: Id,
    @SerialName("adult") val `adult`: Id,
)

@Serializable
data class PetSpeciesWriteInputAppearancesItemImageMediaIds(
    @SerialName("baby") val `baby`: Id,
    @SerialName("junior") val `junior`: Id,
    @SerialName("adult") val `adult`: Id,
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
data class DraftCharacterCardDataProfileExtraWeibo(
    @SerialName("nickname") val `nickname`: String,
    @SerialName("avatarUrl") val `avatarUrl`: String,
    @SerialName("userId") val `userId`: String? = null,
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

