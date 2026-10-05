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
| `src/http/contacts.ts`           | 添加角色、通讯录、备注、自定义头像、专属称呼、删除恢复                                     | web、android、server        |
| `src/http/chat.ts`               | 会话、参与者、消息内容、消息、已读、撤回、会话状态                                         | web、android、server        |
| `src/http/sync.ts`               | 每用户更新日志与补拉（多端同步）                                                           | web、android、server        |
| `src/http/push.ts`               | 推送设备登记、通知载荷格式；管理员提醒（1.3，管理）                                        | web、android、admin、server |
| `src/http/companion.ts`          | 陪伴设置（秒回、拆条），数据归 ai-runtime                                                  | web、android、server        |
| `src/http/media.ts`              | 图片上传（我的头像、通讯录头像；管理员上传角色头像）                                       | web、android、admin、server |
| `src/ws.ts`                      | WebSocket 帧协议                                                                           | web、android、server        |
| `src/events.ts`                  | 领域事件（以 `Events` 命名空间导出）                                                       | server 各模块               |
| `src/ports/`                     | 模块之间的同步接口（端口），含 `billing.ts` 计费端口                                       | server 各模块               |
| `src/character-card.ts`          | 角色卡（**预留位置**，D-L0-10 并入）                                                       | server、admin               |
| `scripts/`                       | 导出脚本（`generate.ts` 入口，`contract-documents.ts` 转换逻辑）                           | —                           |
| `test/`                          | 契约单元测试（关键 schema 正反两面、导出脚本）                                             | —                           |
| `test-vectors/`（待建，D-L0-17） | 同步协议一致性测试用例（JSON），网页与安卓都必须通过（ADR-0011、ADR-0013）                 | web、android                |

## 当前范围

v1.3 补了计费对账与管理所需的只读端口（批量取用户名、按用量记录 / 日期查扣费、有价格的模型键）、结算 / 解冻的上游 ID、对账第 ② 层结果事件、统一的「管理员提醒」事件与接口。v1.2 补了邀请码注册赠送余额、管理后台「注销未完成」列表与重新触发、账号状态端口。v1.1 在 v1.0 基础上补了计费（安全优先透支、后台计入规则）、管理后台用量查询（ADM-08，L2 使用）、默认识图模型和历史人物形象策略。v1.0 覆盖 L0、L1 所需：账号、界面偏好、模型选择与计费、角色基础信息与展示字段、通讯录、会话与消息、同步、推送、陪伴设置（秒回 / 拆条）、媒体（头像）、领域事件、端口。后续层由架构负责人按 `docs/architecture/dev-plan.md` 扩展。

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

- 角色卡 `character-card.ts` 仍是占位（D-L0-10）；协议一致性用例 `test-vectors/` 待建（D-L0-17）。
