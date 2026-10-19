# 接口与事件契约（@weiban/contracts）

所有模块之间、前后端之间（网页、安卓原生客户端、管理后台）的接口，以这里为唯一准绳。

- 最终修改权：架构负责人。
- 其他负责人要改接口：先在 `docs/tasks/` 或交接说明中提出**契约变更申请**（改什么、为什么、影响谁），架构负责人评估影响后批准并修改本目录，实现方再改代码。
- 格式决策见 `docs/decisions/ADR-0003-tech-stack.md` 第 10 项；包的构建与使用方式见 `docs/decisions/ADR-0014-contracts-packaging.md`。

## 格式

**Zod 4 schema 是唯一源头**（Zod 是 TypeScript 的数据校验库）。同一份定义同时是：

1. TypeScript 类型（`z.infer<typeof X>`），服务器和网页直接 import；
2. 运行时校验（服务器校验请求、网页校验响应、所有模块校验事件载荷）；
3. JSON Schema 与 OpenAPI 文档（`generate` 导出到 `generated/`）。**安卓原生客户端（Kotlin）的数据类由这份 JSON Schema 自动生成**，不手写（ADR-0011 第 2 条）。

HTTP 接口用 `defineEndpoint({ method, path, auth, params, query, body, response, summary })` 描述，服务器据此注册路由校验，网页据此生成类型安全的调用函数。

## 命令

| 命令                                        | 作用                                                                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @weiban/contracts typecheck` | 类型检查：`src/`（不带 Node 类型，网页也能用）与 `scripts/`、`test/`（带 Node 类型）分两次检查                        |
| `pnpm --filter @weiban/contracts build`     | 编译到 `dist/`（JS + 类型声明），供直接用 Node 运行、不经过 TypeScript 转译的场景（导入条件 `weiban-dist`，ADR-0014） |
| `pnpm --filter @weiban/contracts generate`  | 导出 `generated/json-schema.json`（JSON Schema 2020-12）与 `generated/openapi.json`（OpenAPI 3.1）                    |
| `pnpm test`（仓库根）                       | 运行本包 `test/` 下的单元测试                                                                                         |

`dist/`、`generated/` 是构建产物，不进仓库。

### 导出文件的结构

- `json-schema.json`：`$defs` 是全部具名定义（`src/index.ts` 导出的每个 schema；事件以 `Events.` 开头；WebSocket 帧以 `Client` / `Server` 开头）；`endpoints` 是每个 HTTP 接口的 `method`、`path`、`auth`、`successStatus` 和各部分（`params` / `query` / `body` / `response`）的 `$ref`。接口里没有名字的内联 schema 命名为「分组.接口名.Params / Query / Body / Response」。
- 响应和具名定义按**输出形态**导出（服务器发出的样子，带默认值的字段为必填）；请求部分按**输入形态**导出（带默认值的字段可省略）。同一定义两种形态不同时，输入形态另起名「原名Input」。
- `openapi.json`：同一批定义放在 `components.schemas`；路径参数写成 `{name}`；204 表示无内容；失败统一引用 `ApiError`。

## 目录

| 文件                             | 内容                                                                                       | 使用方                      |
| -------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------- |
| `src/version.ts`                 | 契约版本号                                                                                 | 全部                        |
| `src/common.ts`                  | ID、时间、错误码与错误格式、分页、`defineEndpoint`、接收端容错工具                         | 全部                        |
| `src/http/identity.ts`           | 注册登录、会话、我的资料、通知设置、界面偏好（主题）、注销、邀请码与注销进度（管理）       | web、android、admin、server |
| `src/http/model-access.ts`       | 模型目录、模型选择、角色模型覆盖、模型状态；管理：上游（平台密钥，只有掩码）、模型目录维护 | web、android、admin、server |
| `src/http/billing.ts`            | 钱包、流水、价目表、用量汇总；管理：加扣余额、价目表版本、上游账单、对账                   | web、android、admin、server |
| `src/http/characters.ts`         | 角色分类（硬性边界依据）、展示字段与头像、角色广场、资料页、管理后台角色库                 | web、android、admin、server |
| `src/http/admin-content.ts`      | 管理后台内容维护：情景模式维护、人设版本列表与回滚（T-049，ADM-05 / ADM-06）               | admin、server               |
| `src/http/contacts.ts`           | 添加角色、通讯录、备注、自定义头像、专属称呼、删除恢复                                     | web、android、server        |
| `src/http/chat.ts`               | 会话、参与者、消息内容、消息、已读、撤回、会话状态                                         | web、android、server        |
| `src/http/sync.ts`               | 每用户更新日志与补拉（多端同步）                                                           | web、android、server        |
| `src/http/push.ts`               | 推送设备登记、通知载荷格式；管理员提醒（1.3，管理）                                        | web、android、admin、server |
| `src/http/companion.ts`          | 陪伴设置（秒回、拆条），数据归 ai-runtime                                                  | web、android、server        |
| `src/http/media.ts`              | 图片上传（我的头像、通讯录头像；管理员上传角色头像）                                       | web、android、admin、server |
| `src/ws.ts`                      | WebSocket 帧协议                                                                           | web、android、server        |
| `src/events.ts`                  | 领域事件（以 `Events` 命名空间导出）                                                       | server 各模块               |
| `src/ports/`                     | 模块之间的同步接口（端口），含 `billing.ts` 计费端口                                       | server 各模块               |
| `src/character-card.ts`          | 严格 WB-Card 1.0 完整卡与草稿卡                                                            | server、admin               |
| `scripts/`                       | 导出脚本（`generate.ts` 入口，`contract-documents.ts` 转换逻辑）                           | —                           |
| `test/`                          | 契约单元测试（关键 schema 正反两面、导出脚本）                                             | —                           |
| `test-vectors/`（待建，D-L0-17） | 同步协议一致性测试用例（JSON），网页与安卓都必须通过（ADR-0011、ADR-0013）                 | web、android                |

## 当前范围

v2.0 将 WB-Card 1.0 完整卡、可保存未完成的草稿卡与媒体下载/读取端口并入契约。v1.3 补了计费对账与管理所需的只读端口（批量取用户名、按用量记录 / 日期查扣费、有价格的模型键）、结算 / 解冻的上游 ID、对账第 ② 层结果事件、统一的「管理员提醒」事件与接口。v1.2 补了邀请码注册赠送余额、管理后台「注销未完成」列表与重新触发、账号状态端口。v1.1 在 v1.0 基础上补了计费（安全优先透支、后台计入规则）、管理后台用量查询（ADM-08，L2 使用）、默认识图模型和历史人物形象策略。v1.0 覆盖 L0、L1 所需：账号、界面偏好、模型选择与计费、角色基础信息与展示字段、通讯录、会话与消息、同步、推送、陪伴设置（秒回 / 拆条）、媒体（头像）、领域事件、端口。后续层由架构负责人按 `docs/architecture/dev-plan.md` 扩展。

## 版本规则

1. `CONTRACT_VERSION` 形如 `主.次`，**1.0 起生效**：
   - 次版本加一：新增接口、事件、可选字段、错误码、消息类型、更新类型、WebSocket 帧类型、设置分块、通知种类，以及下面第 3 条列出的「接收端容错字段」的新取值。
   - 主版本加一：删除字段、改字段含义、改必填，以及给**其他**出现在服务器响应里的枚举新增取值（旧客户端会解析失败）。要把这类枚举改成可以平滑扩展，先把它改为 `tolerantEnum`（这本身是次版本变更），之后新增取值就是次版本变更。
2. 0.x 阶段（尚无实现代码）允许不兼容改动，只升次版本；该阶段的记录保留在下方「变更记录」。
   - **1.1 的一次性例外**（架构负责人 T-020 决定）：1.1 给三个**响应枚举**新增了取值（`PortraitPolicy` 加 `classical_art_only`、`SpendCategory` 加 `planning`、`AdminCatalogEntry.defaultFor` 加 `vision`），按第 1 条本应升主版本。理由是此时**还没有任何客户端实现**（网页 D-L0-12、管理后台 D-L0-13、安卓 D-L0-18 均未开工，服务器也还没有用到这三个枚举的模块），不存在会解析失败的旧客户端；同时把前两个改为接收端容错（第 3 条）。**从第一个客户端任务合并起，此例外失效**，严格按第 1 条执行。
3. **接收端容错**（客户端必须容忍新版本服务器发来的、它不认识的东西）。契约里由「接收端 schema」把不认识的值解析为保留字 `unsupported`，不报错：

   | 位置                                                             | 接收端 schema                    | 客户端行为                   |
   | ---------------------------------------------------------------- | -------------------------------- | ---------------------------- |
   | 消息内容 `Message.content`                                       | `ReceivedMessageContent`         | 显示「当前版本不支持此消息」 |
   | 更新日志 `UserUpdate`（补拉接口、`update` 帧）                   | `ReceivedUserUpdatePayload`      | 推进游标，跳过               |
   | 设置分块 `settings.updated.section`                              | `tolerantEnum(SettingsSection)`  | 忽略                         |
   | 服务器 WebSocket 帧 `ServerFrame`                                | 内置                             | 忽略                         |
   | 错误码 `ApiError.error.code`、帧里的 `code`                      | `ReceivedErrorCode`              | 按通用失败提示               |
   | 通知种类 `NotificationPayload.kind`                              | `tolerantEnum(NotificationKind)` | 按普通通知显示               |
   | 模型能力 `ModelInfo.capabilities`                                | `tolerantEnum(ModelCapability)`  | 不显示该能力                 |
   | 主题 `UserPreferences.theme`                                     | `ReceivedAppTheme`               | 按默认主题 green 显示        |
   | 形象策略 `CharacterClassification.derived.portraitPolicy`（1.1） | `tolerantEnum(PortraitPolicy)`   | 按 `forbidden` 对待          |
   | 流水用途分组 `LedgerEntry.category`（1.1）                       | `tolerantEnum(SpendCategory)`    | 归入「其他」显示             |
   | 用量明细用途 `AdminUsageRecord.purpose`（1.1，管理后台）         | `tolerantEnum(ModelPurpose)`     | 显示原始值或「其他」         |

| 注销进度模块名 `AccountDeletionModuleProgress.module`（1.2，管理后台） | `tolerantEnum(ModuleName)` | 显示「其他模块」 |
| 管理员提醒 `AdminAlert.kind` / `severity`（1.3，管理后台） | `tolerantEnum(AdminAlertKind)` 等 | 显示「其他提醒」/ 按 warning |

- 已知类型但内容不合法的，仍然校验失败（不掩盖服务器的错误）。
- 服务器发出数据前用**严格**版本校验：`MessageContent`、`UserUpdatePayload`、`ServerFrameStrict`、`ErrorCode` 等。客户端发给服务器的数据（请求体、`ClientFrame`）一律严格。
- `unsupported` 是保留字，任何真实的类型名、枚举值都不得使用它。
- 安卓端（Kotlin）不运行 Zod，必须在反序列化配置里实现同样的行为（未知多态类型 → 默认分支，未知枚举值 → 兜底值），由 Android 负责人在 D-L0-18 落实并用协议用例验证。

## 变更记录

### 3.19（2026-10-20，角色生态 v1 批 C）

依据 `docs/refactor/17-ecology-settings.md`、16 号 §4。说明见 `docs/ai/ecology-v1.md`、`docs/handoffs/2026-10-19-v5-ecology.md`。（在批 B 的 3.18 之上递增。）

- 新 `http/ecology.ts`：动作清单 `ECOLOGY_ACTION_KEYS`、`EcologyActivityLevel`（四档）、`EcologySettings` / `UpdateEcologySettings`、`EcologyMurmur`、`EcologyCharacterProfile`；用户端 `EcologyEndpoints`（GET/PATCH `/me/ecology`、PUT `/me/ecology/characters/:id`、GET `/characters/:id/murmurs`、GET `/characters/:id/ecology-profile`）；管理端 `EcologyAdminEndpoints`（GET/PUT `/admin/ai/ecology`、GET `/admin/ai/ecology/runs`）。
- 端口：`ModelGatewayPlatformPort.generatePlatformText` 的 purpose 增 `moments`（官方角色公共朋友圈，平台承担）。

### 3.18（2026-10-20，v5 批 B 记忆分档 + 长上下文）

全部向后兼容（只新增可选字段与接口）。说明见 `docs/handoffs/2026-10-19-v5-memory.md`、`docs/refactor/16-membership-v5.md` §5。

- `http/memory.ts`：新增 `MemoryTierLimits`、`ChatWindowLimits`、`MemoryTierConfig`、`MemoryTierStatus` 与 `MemoryTierEndpoints`（用户端 `GET /characters/:characterId/memory-tier`；管理端 `GET/PUT /admin/ai/memory-tiers`）。
- `CompanionSettings.longContext`（可选）：单个角色的长上下文模式，PRO+ 专属；非 PRO+ 打开返回 403 `forbidden`。
- `MemoryTierEndpoints.plans`（用户端 `GET /memory-tiers`）：两档记忆参数，权益页对照用。
- 新端口 `IdentityRegistrationReadPort`（`ports/identity.ts`）：注册时间，调用方 ai-runtime（新用户前 7 天按 PRO+ 记忆）。
- 在批 A 的 3.17 之上递增；长上下文非 PRO+ 打开的错误码见批 B 交接。

### 3.17（2026-10-20，会员 v5 批 A）

依据 `docs/refactor/16-membership-v5.md`。说明见 `docs/backend/membership-v5.md`、`docs/handoffs/2026-10-19-v5-membership.md`。

- 端口：`IdentityMembershipReadPort.isProPlus(userId, tx?)`（**统一「是否 PRO+」**）；新端口 `IdentityMembershipWritePort.extendProPlus`（调用方 billing）。`ModelQuotePort.quote` 增可选 `hasImages`、`modelKeyOverride`（与网关执行同口径）；`GenerateTextOutput` 增可选 `usedVisionDefault`。
- `http/membership.ts`：`MembershipPlan`、`MembershipSettings`、`MembershipOffer`、`MembershipOrder`、`CreateMembershipOrder`；用户端 `MembershipOfferEndpoints.getOffer`，管理端 `MembershipOrderAdminEndpoints`（配置、订单列表、替用户开通）。
- `Wallet` 增可选 `bonusMicros` / `bonusPoints`（赠送积分余额）。
- `ModelInfo` 增可选 `displayMultiplier`、`pointsPerReplyBasis`；`AdminModel` 增 `displayMultiplier`、`displayMultiplierManual`，`AdminModelWrite` 增 `displayMultiplierManual`；新 `DisplayMultiplierSettings` 与两个管理端接口。
- **放宽（需留意）**：`RoleRequestQuota.limit` 由字面量 5 改为整数、`nextPointsCost` 由 0/200 改为整数、`CreateRoleRequest.expectedPointsCost` 改为整数；`RoleRequestConfig` 增 `lifetimeFreeCount`、`proPlusWeeklyFreeCount`（带默认值），`RoleRequestQuota` 增 `lifetime*`、`weekly*`。严格说属于响应取值放宽，旧安卓客户端解析 `limit≠5` 会失败；安卓尚未发布正式版，按次版本处理，由总负责人确认。

### 3.15（2026-10-16，q-features 接续）

旧q分支3.9预留内容适配到主线3.14后统一发布为3.15：用户当前状态、表情商店安装/管理/发送资格、插件三项coming_soon、真实最小会员有效期与管理员授予；角色心情保留A7 TimelineEndpoints.getStatus，不注册旧同URL异响应接口。制作申请配置附真实quota，提交expectedPointsCost确认0/200，免费次数标志与同Tx服务费hold/release/getByKey端口配套。没有完整会员支付权益、赠分、模型档位或角色生态全局开关。JSON Schema/OpenAPI及安卓生成配套；迁移0097~0100未执行、GUI与真实DB/扣费未验，见docs/handoffs/2026-10-16-q-features.md。

### 3.10（2026-10-15，A4 消息转发）

新增源消息 ID 转发接口 `ChatEndpoints.forwardMessages`，服务端生成非递归 `forwarded_record` 加密快照；普通 `UserSendableContent` 不接受该类型。逐目标事务结果与请求幂等、单条强制逐条、50 条 / 10 目标 / 20,000 正文字上限；详见 `docs/backend/chat-forward.md`。JSON Schema、OpenAPI 与安卓契约生成物同步；老客户端保留未知类型容错。本分支跳过 q-features 尚未合入的 3.9 预留版本。

### 3.8（2026-10-14，总对照表 Q5 申请制作扣积分、Q9 帮助与反馈 / 投诉）

全部向后兼容（只新增接口、新增枚举值、新增端口）。说明见 `docs/handoffs/2026-10-14-backend-lead-q-features.md`、`docs/backend/support.md`、`docs/backend/billing.md`「契约 3.8」。

- 新端口 `BillingServiceFeePort`（`ports/billing.ts`，含 `ServiceFeeKind`、`ServiceFeeHoldInput`、`ServiceFeeHold`）：固定金额服务费的冻结 / 扣除 / 退回，调用方 plaza。
- `SpendCategory` 新增 `service`（流水分类，接收端容错）。
- `http/role-requests.ts`：`pointsCost` 默认 200 积分并真实生效——提交冻结（不足 422 `insufficient_balance`）、完成扣除（`pointsCharged = pointsCost`）、被拒或撤回退回。字段不变，只改说明。
- 新文件 `http/support.ts`：`SupportTicket`、`CreateSupportTicket`、`FeedbackCategory`、`ComplaintTargetType`、`ComplaintReason`、`SupportTicketStatus`，用户端 `SupportEndpoints`、管理端 `SupportAdminEndpoints`。
- `MediaPurpose` / `UserMediaPurpose` 新增 `support_image`；`DataSection` 新增 `support`；`Events.ModuleName` 新增 `support`。

### 3.7（2026-10-14，聊天链路第二批：角色卡提示词写法与世界书设置）

全部向后兼容（只新增可选字段）。说明见 `docs/refactor/09-chat-pipeline.md` 第 7 节、`docs/ai/character-card-spec.md` 1.1。

- `character-card.ts`：新增 `CardPrompting`（`systemNote`、`postHistoryInstructions`、`characterNote{text, depth}`、`exampleMode`、`exampleCount`），`WeibanCardData.prompting` 与 `DraftCharacterCard.data.prompting` 可选。
- `CardKnowledge` 新增可选 `scanDepth`、`constantBudget`、`triggeredBudget`、`recursive`；`CardKnowledgeEntry` 新增可选 `preventRecursion`。
- 注意：卡片对象是严格对象（拒绝未知字段），旧版客户端若在本地校验卡片会拒绝带新字段的卡；安卓已重新生成，网页 / 管理后台直接引用本包。

### 3.6（2026-10-14，聊天链路第一批：请求结构与缓存统计）

全部向后兼容（只新增可选字段、端口 meta 新增可选项）。说明见 `docs/refactor/09-chat-pipeline.md`、`docs/handoffs/2026-10-14-ai-lead-chat-pipeline.md`。

- `http/model-access.ts`：新增 `SystemMessageMode`（`multi` / `single_system` / `no_system`）；`AdminCatalogEntry`（及 `AdminCatalogEntryWrite`、`AdminModel`、`AdminModelWrite`）新增可选 `systemMessageMode`，写入时不传 = 保持原值。
- `AdminUsageTotals` 新增可选 `stablePrefixRate`（理论可缓存占比）；`AdminUsageRecord` 新增可选 `stablePrefixTokens`。
- 端口 `GenerateTextInput.meta` 新增可选 `stablePrefixChars`。

### 3.5（2026-10-14，角色广场两个 tab 与申请制作，总经理 10-14 裁定 2.3）

全部向后兼容（只新增接口、新增枚举值、端口新增可选方法）。说明见 `docs/handoffs/2026-10-14-backend-lead-role-request-plaza.md`。

- `http/plaza.ts`：「微伴角色」tab——`PlazaOfficialPersona`、`PlazaOfficialCard`、`PlazaOfficialDetail`、`ListPlazaOfficialQuery`，接口 `PlazaOfficialEndpoints`（列表、详情、点赞 / 取消、评论列表 / 发表）与 `PlazaOfficialAdminEndpoints.listComments`；删除评论复用原有 `PlazaEndpoints.deleteComment` / `PlazaAdminEndpoints.deleteComment`。
- 新文件 `http/role-requests.ts`：申请制作——`RoleRequest`、`RoleRequestStatus`、`RoleRequestConfig`（`pointsCost` 预留，默认 0）、`CreateRoleRequest`，用户端 `RoleRequestEndpoints`、管理端 `RoleRequestAdminEndpoints`。
- `MediaPurpose` / `UserMediaPurpose` 新增 `role_request_image`；`DataSection` 新增 `role_requests`（客户端按容错枚举处理）。
- 端口 `CharacterPlazaPort` 新增可选 `listOfficialIds`、`getOfficialCards`、`getOfficialProfile`。

### 3.4（2026-10-13，上游账号池与用量监控，ADR-0032 第二批）

全部向后兼容（只新增接口、新增可选字段、新增请求枚举值 `AdminUsageDimension.hour`）。说明见 `docs/handoffs/2026-10-13-backend-lead-points-upstream.md`。

- `Upstream` 新增可选：`provider`、`priority`、`weight`、`maxConcurrency`、`rpmLimit`、`enabled`、`note`、`cooldownUntil`、`consecutiveFailures`、`lastError`、`lastUsedAt`、`lastTestedAt`、`inFlight`、`todayCalls`、`todayCostMicros`；`CreateUpstreamRequest` 可带同名调度参数与 `saveOnTestFailure`。
- 新接口：`updateUpstream`（PATCH）、`batchUpstreams`、`listUpstreamModels`、`getGatewayLimits` / `updateGatewayLimits`、`usageOverview`。
- `ModelRoute`；`AdminModel.routes`、`AdminModelWrite.routes`（一个模型多个账号）。
- `AdminUsageTotals` 新增可选 `chargedPoints`、`avgLatencyMs`、`failureRate`、`cacheHitRate`；`AdminUsageRecord` 新增可选 `chargedPoints`、`upstreamModelId`；`AdminUsageOverview`。

### 3.3（2026-10-13，积分制与模型倍率，ADR-0032）

全部向后兼容（只新增接口、新增可选字段；`AdminAdjustmentRequest.amountMicros` 由必填改为与新字段 `points` 二选一，旧调用方照常传 amountMicros 不受影响）。说明见 `docs/handoffs/2026-10-13-backend-lead-points-upstream.md`、`docs/decisions/ADR-0032-points-and-upstream-pool.md`。

- `http/billing.ts`：`MICROS_PER_POINT`（1 积分 = 10,000 微元）、`POINTS_PER_YUAN`、`microsToPoints` / `pointsToMicros`；钱包、流水、用量汇总、价目表、管理端账户概况新增可选 `*Points` 字段；`LedgerEntry.usageRecordId`；`UpdateWalletSettingsRequest` 可按积分设置；`AdminAdjustmentRequest.points`（按积分加扣）；充值档位 `RechargeTier` / `RechargeOptions`，用户端 `getRechargeOptions`、后台 `getRechargeOptions` / `updateRechargeOptions`（第一版 `paymentEnabled = false`）。
- `http/model-access.ts`：`ModelRates`（输入 / 输出 / 缓存倍率 = 元 / 百万 token）、`AdminModel` / `AdminModelWrite`，后台合并接口 `listModels` / `upsertModel`；`ModelInfo.pointsPerReply`。
- `http/chat.ts`：`Message.pointsCost` / `usageRecordId`；`ChargedMessage` 与 `listChargedMessages`（按调用查消息摘要）。
- 端口：`PostMessageInput.charge`（chat）；新端口 `BillingModelRatePort`（billing 提供，只有 model-access 调用）。
- 行为变化（不改字段）：用户钱包付费的调用不再占用平台每日成本上限，平台上限只约束平台账户（管理员侧任务）。

### 3.2（2026-10-13，换壳 UI 批次后端配套）

全部向后兼容（只新增接口、新增可选字段、新增枚举值；安卓枚举是字符串别名，不认识的值按兜底处理）。说明见 `docs/handoffs/2026-10-13-backend-lead-ui-refresh.md`、`docs/backend/announcements.md`。

- 新文件 `http/announcements.ts`：公告（`AnnouncementEndpoints`、`AnnouncementAdminEndpoints`）、更新说明与版本检查（`ReleaseEndpoints`、`ReleaseAdminEndpoints`）。数据归 identity（迁移 0086）。
- `ScenarioMode` 新增 `auto` / `treehole` / `cheer`（AI 未实现前服务器按 daily 回复）；新增 `ScenarioModeOption`（listModes 响应项，可选字段 description / section / recommended / aiReady）。
- 内部端口 `ScenarioModeTraits.allowlistFallback`（可选）：管理员允许列表未列出时按该模式判断。
- 宠物图鉴不改契约：迁移 0084 预置 3 物种 × 3 外观的内置占位插画。

### 3.1（2026-10-11，积压清理第一步：L3～L7 契约一次收口）

依据：ADR-0028；实现清单与迁移号 `docs/architecture/contracts-3.1-map.md`；积压编号见 `docs/handoffs/2026-10-09-pm-dispatch-queue.md`。全部向后兼容：新响应字段一律可选，旧服务器不实现也能通过类型检查，旧客户端忽略。开发期间以「3.0.1」「3.0.2」名义做过的改动一并归入 3.1（版本规则没有补丁号；两次「3.0.1」也撞了号）。

**补登记（已在 3.0 之后实现，此前只写在交接里）**

- 2026-10-11 自定义默认音色：`UserCustomCharacterWrite`、PATCH/保存前试聊和响应，以及导入`editorFields`增加可选可空`voiceId`，只从启用中的音色库新选，null清空。停止使用已停用音色时仍可编辑其他字段；试聊的已有角色快照可保留其旧选择。语音选择优先级为陪伴设置→自定义角色默认→预设默认，合成时再次检查启用状态。旧角色卡中的示例代号不是库UUID，不作为响应ID返回；明确清空不继承旧快照。无数据库迁移。

- 2026-10-11 导入编辑字段补齐：`ImportResult(new_character).editorFields` 增加可选、可空的 `birthday`（有效当地日期）和 `avatarMediaId`。省略兼容旧草稿，null 明确清空；分批合并保留原草稿的用户编辑字段。保存头像时检查归属及头像用途，最终创建角色继续执行既有分类和媒体校验。无数据库迁移。

- 3.0.1 甲（L4 后端收尾 a5fd58f）：`NewFriendsEndpoints`（「新的朋友」列表）、`MomentsEndpoints.listNotifications`（朋友圈消息列表）、`UserCustomEndpoints.list`（自定义角色列表）、`renameGroup` 允许空名恢复默认、更新类型 `conversation.removed`（会话被彻底删除 / 群解散，客户端从本地删掉会话和消息）、`DataSection.new_friends`、通知上下文带 `labels`；`Message.labels` 登记服务器标签 `self_chat`（角色自发群聊话题，push 对「带 self_chat 且没有 @ 用户」的群消息不推送）。
- 3.0.1 乙（T-063）：`Conversation.group.formerParticipants`（已退出 / 被移出的角色参与者，只用于渲染其历史消息的发送者，不是群成员）。
- 3.0.1 丙（T-088，总负责人裁定）：端口 `ContactsWritePort.addForUser`（提供方 contacts，调用方 plaza）：「添加为我的角色」由服务器代用户走 CHR-03 添加流程。服务器内部接口，不影响线上格式。
- 3.0.2（T-076）：`Anniversary.repeatYearly`、`AddAnniversaryRequest.repeatYearly`、`GrowthEndpoints.updateAnniversary`；节日清单 `HolidayDateType.lunar_annual`、`category`、`sendCard`、`cardTemplateId`、`characterCategories`、`upcomingDates` 与筛选参数；`UpcomingHoliday` 的发卡字段。`lunar_annual` 是给非容错响应枚举加取值，只出现在管理后台接口，按 ADR-0028 记为例外。
- 端口参数（后端追加小项 d08a26d，总负责人指示）：`ProactiveMessagePort.canSendProactive / recordSent` 新增可选 `perCharacterLimit`（单角色每日上限按频率档位 1 / 3 / 5，默认 3；合计 P-04 = 8 不变）。

**新增**

- identity：端口 `IdentitySettingsWritePort.enableProactiveCalls`（⑰，ai-runtime 在来电询问点「可以」时打开全局来电开关；只开不关）。
- 消息与聊天：`ImageContent.sizeBytes`（⑲）；`PLAY_SYSTEM_NOTICE_CODES`（㊲：focus_started、letter_sent、wishlist_item_completed 的 code 与参数）；`ChatSearchEndpoints.locateByDate`、`listByType`、会话内搜索 `senderParticipantId`（㉘）。
- characters：`WorkLinkAdminEndpoints.getDefaultVoice`（⑲）；`UserCustomCharacterWrite.catchphrases / speechStyle` 与响应字段（T-098）；资料已更新红点起算点写进说明（㉕）；补充设定保存后冲突项异步写入并发 `data.changed(supplement)`；端口 `CharacterSupplementConflictsWritePort`、`CharacterChildFeaturesWritePort`（原服务器内部令牌转契约）、`PersonaUpdateSummarizerPort`（㉖，可选 AI 接入点）。
- media 素材库：`CardTemplate.classicalStyle`（㉓）；收口补充`CardTemplateKind.daily_photo`（⑱），只出现在与服务器同步部署的管理端模板接口，按ADR-0028的管理枚举例外并入3.1。内部`MediaAssetReadPort.listCardTemplates`增加可选`classicalStyleOnly`，默认不限制风格，历史人物发图时要求古风且无肖像。
- characters（AI 3.1 补记，B7 遗留）：`CharacterPlazaPort.applyVariant` 增加可选 `childFeaturesDetected`（省略为 false），plaza 应用 / 更新预设改版时传快照值；characters 记在独立的用户永久标记上（迁移 0083，只增不减；第一次写入时发带 ownerUserId 的 character_classification_changed），`getForRuntime` 与 policy 事务内的成人 / 恋爱判断按用户视角更严处理。只是内部端口，无 JSON Schema / OpenAPI / Kotlin 变化。
- library：`FavoriteSource(message).seq`（㉘）、`Favorite.characterNameSnapshot / characterAvatarMediaIdSnapshot`（㉔）、`ShareRejectedDetails`（㉘，422 的 details 形状）。
- growth：`PetAppearance.listed`（㉚）、事件 `growth.pet_naming_requested.speciesName`、端口 `CardCopywriterPort`（㉗，可选 AI 接入点）。
- importer：`createJob.mergeIntoJobId`、`ImportJob.mergedIntoJobId`（㉕ 分批合并）、`ImportResult(supplement).conflicts / filteredCount`（㉕㉚）；`getJob` 说明更正为 `data.changed(imports)`。
- Codex 产品收口补充：`ImportResult(new_character).editorFields` 可选保存名字、人设描述、完整口头禅、说话方式、示例和标签；避免把表单值塞入结构化角色卡的无关字段。分批合并保留用户编辑值（包括刻意清空），旧响应未带此字段时按生成草稿初始化。JSON Schema、OpenAPI 和 Kotlin 生成物同步。
- push：`PushRequest.kind` 新增 `import`（㉕）。
- model-access / billing：`ModelStatus.visionAvailable`（㉚）；端口 `ModelQuotePort`（㉖，按用户所选模型报价，model-access 提供）、`BillingQuotePort`（只给 model-access）、`BillingDailySpendReadPort`（㉞，当日按用途花费）。
- plaza：`PlazaPresetVariantSnapshot.childFeaturesDetected`（㉝）；`PlazaWorkDetail.sourceCharacterId / myAdoptedCharacterId / removedReason / unreadCount`（㊱）；`PlazaAdminEndpoints.getWork / listBans`（㊱）。
- ai-runtime：`PlannerConfigEntry.circuitOpenUntil`（㊱）；`updateConfig` 缺评测报告编号的状态码更正为 400。
- play：寄信响应 `replyDelayReason`（㊲）；`PlayAgentPort.deliverLetterReply` 提前调用时的返回语义写明。
- `DataSection` 新增 `supplement`（接收端容错，次版本）。

Android 生成物已用 `pnpm android:generate` 重生成。

### 3.0（2026-10-09，T-062：L4～L7 一次定稿）

依据：ADR-0024～0027；对照表 `docs/architecture/contracts-3.0-map.md`。只新增，不删字段、不改已有含义；升主版本是因为给响应枚举新增了取值（`MediaObject.purpose` 同时改为接收端容错、`AdminCatalogEntry.defaultFor`、`UpstreamKind`）。

- **消息**：新增 image、voice、sticker、link、contact_card、call_record、letter、daily_question、action_card；`TextContent.mentions`；`Message.actionChoice`；`Conversation.group`。用户可发 image / voice / sticker / link。
- **新文件**：`http/chat-groups.ts`（群聊、卡片按钮、搜索）、`character-extras.ts`（关系网、补充设定、人设更新提示、作品链接、默认音色、自定义角色来源）、`assets.ts`（表情包、音色、卡面模板）、`moments.ts`、`calls.ts`（含音频流协议）、`growth-cards.ts`、`pets.ts`、`library.ts`、`importer.ts`、`plaza.ts`、`play.ts`、`ai-runtime-extras.ts`（共享开关、群聊陪伴设置、安静状态、行为规划管理）、`ports/social.ts`。
- **扩展**：media（用途、语音、缩略图、转文字、链接预览）、health（默认值设置、一键清空、症状标签）、timeline（时间线列表）、contacts（名片「不感兴趣」）、companion（`voiceId`）、model-access（`defaultFor`、`UpstreamKind`）、模型网关（图片附件、`modelKeyOverride`、`ModelGatewayMediaPort`）、policy（`PolicyExtensionPort`）、chat 端口（`ChatGroupReadPort`、`ChatGroupAdminPort`、读取排除标签 / 消息）、characters 端口（关系网、作品链接、音色、`CharacterPlazaPort`）、media 端口。
- **事件**：36 个（`events.ts`「3.0」段）；**更新类型**：message.updated、call.updated、media.transcript_ready、moments.badge_updated、moments.post_changed、data.changed；**通知种类**：moments、letter、import；**错误码** 12 个；`ModuleName` 新增 health、calls、plaza、play。

### 2.5（2026-10-09，L3 集成：T-050 / T-051 / T-052 / T-054 / T-058）

各 L3 分支都以 2.5 新增接口，集成后统一为一个 2.5：growth（熟悉度）、simulation（推演）、timeline（你不在时卡片）、proactive（日报/节日/主动消息端口，ADR-0023）、health（经期日记契约）。只新增，不改旧字段。Android 生成物在合并后统一重生成。

### 2.3（2026-10-08，T-043）

契约申请及接管架构影响自审先于实现，见 `docs/tasks/T-043-l2-memory-persona.md`、ADR-0018；沿用已合并T-030的总经理接管授权，不将Claude登记为审批者，独立复核待安排。

新增记忆管理HTTP（受限写入/幂等/分页/服务端来源与scope）、允许情景模式列表；Contact关系和陪伴贴合度/模式/主动行为设置均为可选新增字段，旧2.2调用仍可使用。新增只读AdultModelReadPort，ChatAdminPort.setContentScope及ChatParticipantPort.postMessage增加可选Tx，后者可选expectedScope保证版本与发送同事务。无删字段/改必填/扩已有枚举，因此升次版本。安卓由同一schema重新生成，不手改生成物。

### 2.0（2026-10-05，T-030）

开发接管授权下的契约影响自审，见 `docs/tasks/T-030-character-card-and-policy.md`。独立审查待交付；未把原架构负责人登记为审批者。

- 角色卡从任意JSON占位变成严格WB-Card 1.0；管理接口接受 `DraftCharacterCard`，上架/运行时使用完整 `CharacterCard`。分类、资格、系统提示词和克隆参数不放进卡片。未知规则字段拒绝，原始扩展仅放管理备注且不进入提示词。
- 将媒体读取端口及带凭证的二进制下载路由并入契约；OpenAPI按真实图片类型导出。
- JSON Schema导出支持递归JSON定义，引用统一落在顶层 `$defs`，避免安卓生成器遇到悬空引用。
- 这是收紧旧占位写入范围的不兼容变更，因此升主版本。

### 1.3（2026-10-06，T-026）

依据：后端 T-023 交接说明「给架构」的 6 条申请（`docs/handoffs/2026-10-05-backend-lead-T-023.md`）。设计见 `docs/architecture/billing.md` v1.4（4.1、5.2、8.2、8.4、10.1 节），决策见 `docs/decisions/ADR-0017-billing-contract-requests-t026.md`。全部为次版本变更（只新增、改说明），1.2 的服务器实现不改代码也能通过类型检查。

- **新增**：
  - 端口 `IdentityDirectoryPort`（申请 1）：`getUsernames(userIds)`（批量取用户名，管理后台展示与按用户名搜索用，调用方不得存用户名）、`listAdminUserIds()`（push 给管理员发提醒用）。单独成接口，不并入 `IdentityReadPort`。
  - 端口 `BillingChargeQueryPort`（申请 2、5）：`getChargesByUsageRecordIds`、`listChargesByDay`（北京日期、分页）、`listActivePricedModelKeys`；类型 `UsageCharge`、`UsageChargePage`。只读，单独成接口，不并入 `BillingReadPort`。
  - `SettleInput.upstreamId`、`ReleaseInput.upstreamId`（可选，申请 3）：网关应当传，用于对账第 ③ 层与「各上游近 30 天成本」。
  - 事件 `model_access.usage_reconciled`：对账第 ② 层由 model-access 比对，结果交回 billing 写进当天的对账记录；`ReconciliationRun.usageReconciledAt`、`usageAmountMismatch`（可选）。
  - 管理员提醒（申请 6）：事件 `platform.admin_alert_raised`（任何模块可发）、`AdminAlertKind` / `AdminAlertSeverity` / `AdminAlertFacts` / `AdminAlert`、`PushAdminEndpoints`（`GET /admin/alerts`、`POST /admin/alerts/:alertId/acknowledge`），通知种类 `NotificationKind` 新增 `admin_alert`。数据归 push。
- **改说明（无结构改动）**：
  - `activatePriceVersion`：首版不支持预约生效（`effectiveFrom` 晚于现在 400，技术债 TD-026）；不再在 billing 检查「启用模型缺价」（申请 4、5）。
  - `upsertCatalogEntry`：保存为启用时当前价目表没有该模型价格 → 422 `model_unavailable`（申请 5）。
  - `AdminAccountSummary.username` 来源写明。
- **确认偏差（只改设计文档）**：流水只增不改用触发器实现、而非单靠撤销权限（申请 4），见 `billing.md` 5.2 第 2 条。
- 顺带修正：上方「接收端容错」表格中 1.2 那一行被空行隔开、不在表格里。

### 1.2（2026-10-05，T-024）

依据：后端 T-018 交接说明的两条契约变更申请（`docs/handoffs/2026-10-05-backend-lead-T-018.md`）、PRD ADM-01 第 6 条 / ACC-04（注册赠送余额）、`docs/architecture/security-and-privacy.md` 5.1 第 2 条（注销未完成）。设计见 `docs/architecture/billing.md` 8.3 节。全部为次版本变更（只新增），1.1 的服务器实现不改代码也能通过类型检查。

- **新增**：
  - 邀请码注册赠送余额：`CreateInviteRequest`（`createInvite` 的请求体，新增可选 `bonusMicros`，默认 0，上限 `INVITE_BONUS_MAX_MICROS` = 1,000 元）；`Invite.bonusMicros`（服务器必须返回；schema 写成可选只为兼容 1.1 的实现，客户端缺省按 0）。
  - 事件 `identity.user_registered` 载荷新增可选 `signupBonus: { amountMicros, grantedByUserId }`：billing 订阅后记 `admin_grant` 流水「注册赠送」。**不采用**「billing 提供端口给 identity 调用」：identity（底层）不能调用 billing（中层），ADR-0004 / R2。
  - 端口 `IdentityAccountStatusPort.getAccountStatus`（`AccountStatus` = `active` / `deleting`，不存在为 null）：收到注册事件要新建数据的模块先确认账号仍是 active。单独成接口，不并入 `IdentityReadPort`，免得已有实现编译失败。
  - 管理接口 `IdentityAdminEndpoints.listPendingDeletions`（`GET /admin/account-deletions`）、`retryDeletion`（`POST /admin/account-deletions/:userId/retry`），及 `PendingAccountDeletion`、`AccountDeletionModuleProgress`（模块名接收端容错）。
- **写明（无结构改动）**：注销 `DELETE /me` 密码错误返回 **403 `invalid_credentials`**，不新增错误码；客户端只按 `unauthenticated` 判断登录失效（`engineering-standards.md` 第 4 节第 2 条）。`createInvite` 成功 201、支持 `Idempotency-Key` 写进接口说明。

### 1.1（2026-10-05，T-020）

依据：`docs/product/input/2026-10-04-pm-rulings-2.md`（A1、B4、B5）、PRD v1.3（MDL-05、MDL-10 第 6 条、ADM-08、PLAN-03）、AI 负责人变更申请（`docs/ai/runtime-overview.md` 第 15 节第 5、12、14、15 条）。设计见 `docs/architecture/billing.md` v1.2（6.6、7、10.1 节）、`hard-boundaries.md` v1.2。

- **新增**：
  - 用途 `safety_followup`（安全关怀次日跟进，放入 `BUDGET_EXEMPT_PURPOSES`，不属于后台用途）、`behavior_planning`（行为规划）。
  - 安全优先透支：`SAFETY_OVERDRAFT_PURPOSES`、`GenerateTextInput.safetyPriority`、`ReserveInput.safetyOverdraft`、`ReserveOutput.usedSafetyOverdraft`、`AdminLedgerEntry.safetyOverdraft`。
  - `GenerateTextInput.countAsBackground` / `ReserveInput.countAsBackground`：非后台用途的主动调用按后台计入后台每日上限（只能更严）。
  - `GenerateTextInput.meta.conversationKind`。
  - 管理后台用量与费用（ADM-08）：`ModelAccessAdminUsageEndpoints`（`POST /admin/model/usage/summary`、`/records`、`/export`）及 `AdminUsageFilter`、`AdminUsageTotals`、`AdminUsageSummary*`、`AdminUsageRecord`、`ADMIN_USAGE_EXPORT_MAX_ROWS`。
  - `ReleaseOutput`（平台吸收成本）。
- **修改**：
  - `PortraitPolicy` 恢复 `classical_art_only`（裁定 A1：管理员标注的历史人物只生成古风插画形象）；`CharacterClassification.derived.portraitPolicy` 改为接收端容错；`PolicyPort.checkImageGeneration` 新增可选 `style`。
  - `SpendCategory` 新增 `planning`；`LedgerEntry.category` 改为接收端容错。
  - `AdminCatalogEntry.defaultFor` 新增 `vision`（平台默认识图模型，裁定 B5）。
  - `BillingReservationPort.release` 返回值由 `void` 改为 `ReleaseOutput`（尚无实现，调用方不受影响）。
- 响应枚举新增取值按次版本处理的理由见「版本规则」第 2 条的一次性例外。
- 复核（无改动）：成人模式模型注释已在 1.0 按 B1、B2 修正（`UpdateModelSelectionRequest`、`ModelSelection.adult`）。

### 1.0（2026-10-05，T-014 / D-L0-04）

依据：T-014 任务卡、`docs/product/input/2026-10-04-pm-rulings-2.md`（B1、B2）、PRD v1.2（ACC-02、SOC-03、SVC-01 第 7 条）、质量问题 Q-001～Q-009（Codex 登记）。

- **工程化**：共享 tsconfig（`src` 用 `base.json`，脚本与测试用 `node.json`）；声明 `@types/node`（Q-004）；新增 `build`（`dist/`，导入条件 `weiban-dist`）；导出脚本改为 `scripts/generate.ts`，同时产出 JSON Schema 与 OpenAPI，逐接口导出路由与内联 schema（Q-005）；新增单元测试；纳入 Prettier 格式检查。
- **删除**：`CurrentUser.ageConfirmed`、`IdentityEndpoints.confirmAge`（`POST /me/age-confirmation`）、事件 `identity.age_confirmed`、`IdentityReadPort.isAgeConfirmed`、错误码 `age_not_confirmed` / `group_conversation`、`ChatAdminPort.setContentScope` 的 `group_conversation` 错误（PRD v1.2 取消年龄确认和「群聊只用日常」）。
- **删除并拆分**：`BillingPort` 拆为 `BillingReservationPort`（冻结 / 结算 / 解冻，只有 model-access 可引用）和 `BillingReadPort`（`getSpendStatus`），为 R9 加固（Q-009）。
- **新增**：界面偏好 `UserPreferences`（`theme: green | pink`）、`GET/PATCH /me/preferences`、事件 `identity.preferences_updated`、设置分块 `preferences`（主题所有设备同步）；接收端容错 `UNSUPPORTED`、`tolerantEnum`、`unknownTypeFallback`、`ReceivedMessageContent` / `UnsupportedContent`、`ReceivedUserUpdatePayload` / `UnsupportedUpdate`、`ServerUnsupportedFrame` / `ServerFrameStrict`、`ReceivedErrorCode`、`NotificationKind`、`SettingsSection`（Q-003）；`AdminCharacterUpdate`、`ConversationParams`、`MessageParams` 导出。
- **修改**：
  - `AdminCharacterUpdate` 不再复用带默认值的新建 schema；`Profile.gender` 去掉默认值，`UpdateProfileRequest` 改为独立定义（Q-001）。
  - `CharacterClassificationInput` / `CharacterClassification` 加组合校验：`real_person` 必须有 `realPersonKind`，其他必须为 null（Q-006）。
  - `BalanceRestored` 载荷新增 `availableMicros`、`trigger`（`crossed_zero` / `topped_up_after_rejection`），加余额后不跨零也会发出；`SpendStatus` 新增 `insufficient`（Q-008，`billing.md` 6.3）。
  - `SyncEndpoints.getState` 改为全量重建的**第一步**（固定重建起点），重建后从该点补拉（Q-002，`message-reliability.md` 4.2）。
  - `Message.content`、`UserUpdate`、`ServerFrame`、`ApiError.code`、WebSocket 错误帧的 `code`、`NotificationPayload.kind`、`ModelInfo.capabilities` 改用接收端容错 schema。
  - 注释：成人模式模型可以选任何模型，`adult_content` 只是信息标签（B1）；没设成人模式模型时不能开启成人模式、不自动改用聊天模型（B2）。
  - `estimateAndReserve` 注释：同时原子预留平台每日成本预算（Q-007，`billing.md` 第 7 节）。

### 0.2（2026-10-04，T-009）

依据：ADR-0010、ADR-0011、ADR-0012、ADR-0007 修订、T-006 设计申请。

- **删除** BYOK：`Credential*`、`Provider`、`/model/credentials*`、`/model/providers`、`credential_exists` / `credential_test_failed` 错误码、`credential_status_changed` / `credential_deleted` 事件、`ModelGatewayPort.probeCredential`、更新类型 section `model_credentials`。**删除** `bridge.ts`（ADR-0011）。
- **新增** `http/billing.ts`、`ports/billing.ts`、`billing.*` 事件、`model_access.model_status_changed`、管理后台上游与模型目录接口、错误码 `model_not_allowed` / `insufficient_balance` / `upstream_test_failed` / `price_version_immutable`。
- **修改** `ModelRef` 改用 `modelKey`；`ModelCapability` 增加 `image_generation`；`ModelStatus.reason`；`ModelPurpose`（去掉 `connectivity_test`，增加 `admin_eval`、`admin_upstream_test`）；`BACKGROUND_PURPOSES` 去掉 `import_analysis`；`GenerateTextInput.meta`。
- **policy**：去掉年龄 / 群聊 / 成人模型原因码，新增 `checkModelForCharacter`、`adultContentModelAllowed`；`PortraitPolicy` 简化为 `forbidden` / `allowed`；`shareImageLabel` 只对真人。
- **characters**：头像改为 `{ image, display }`，新增 `CharacterDisplay`。**media**：新增 `character_avatar` 用途与管理员上传接口。

### 0.1（2026-10-04，T-004）

首版。

## 已知事项

### 2.5（T-052 新增接口，2026-10-09）

新增日报发布与分页、管理员节日 CRUD、主动消息事务账本/计数和用户时区节日端口。日报来源 UUID 用于幂等，拒绝任意 raw 原始模型 JSON；发送账本必须与聊天消息共用 Tx，并强制 P03/P04。模块名新增 proactive 以登记账号删除清单。仅扩展已发布 2.4 接口，不修改旧字段；契约申请与实现影响见 `docs/decisions/ADR-0023-proactive-data-ports.md`。其他 L3 分支的 2.5 新接口需要合并源码后统一重生成，不能覆盖彼此的 Kotlin 文件。

- 协议一致性用例 `test-vectors/` 待建（D-L0-17）。

### 2.1（T-034）

消息分页新增可选coverage（扫描seq范围和隐藏/清空负记录），解决新设备无法识别合法空洞的问题；旧响应字段不变。协议一致性向量与接收降级规则同源；后端L1实现必须返回coverage。

### 2.2（T-040）

推送载荷新增可选recipientUserId、recipientSessionId、notificationId；NotificationEnvelope要求这三个归属字段，接收端核对当前账号/会话并去重后展示。载荷仍保留v1的kind/title/body/deepLink等根字段，旧解析器可忽略新增字段；不改既有必填字段或含义。新接收端拒绝缺归属的旧推送载荷展示私密正文，防止退出/换账号后迟到通知。新增PushDevice类型导出，内部只读端口补可选事务与通知专用读取，不改变HTTP操作。推送本身不是消息送达证明。

模型状态事件兼容追加previousDefaultFor，保留下架前默认用途；故障通知可识别未手动设置模型的用户，当前已有新默认或模型恢复时不发送旧故障。
