# 接口与事件契约（@weiban/contracts）

所有模块之间、前后端之间（网页、安卓原生客户端、管理后台）的接口，以这里为唯一准绳。

- 最终修改权：架构负责人。
- 其他负责人要改接口：先在 `docs/tasks/` 或交接说明中提出**契约变更申请**（改什么、为什么、影响谁），架构负责人评估影响后批准并修改本目录，实现方再改代码。
- 格式决策见 `docs/decisions/ADR-0003-tech-stack.md` 第 10 项。

## 格式

**Zod 4 schema 是唯一源头**（Zod 是 TypeScript 的数据校验库）。同一份定义同时是：

1. TypeScript 类型（`z.infer<typeof X>`），服务器和网页直接 import；
2. 运行时校验（服务器校验请求、网页校验响应、所有模块校验事件载荷）；
3. JSON Schema（`pnpm --filter @weiban/contracts generate` 导出到 `generated/`）。**安卓原生客户端（Kotlin）的数据类由这份 JSON Schema 自动生成**，不手写（ADR-0011 第 2 条）。

HTTP 接口用 `defineEndpoint({ method, path, auth, params, query, body, response, summary })` 描述，服务器据此注册路由校验，网页据此生成类型安全的调用函数。

## 目录

| 文件 | 内容 | 使用方 |
|---|---|---|
| `src/version.ts` | 契约版本号 | 全部 |
| `src/common.ts` | ID、时间、错误码与错误格式、分页、`defineEndpoint` | 全部 |
| `src/http/identity.ts` | 注册登录、会话、我的资料、年龄确认、通知设置、注销、邀请码（管理） | web、android、admin、server |
| `src/http/model-access.ts` | 模型目录、模型选择、角色模型覆盖、模型状态；管理：上游（平台密钥，只有掩码）、模型目录维护 | web、android、admin、server |
| `src/http/billing.ts` | 钱包、流水、价目表、用量汇总；管理：加扣余额、价目表版本、上游账单、对账 | web、android、admin、server |
| `src/http/characters.ts` | 角色分类（硬性边界依据）、展示字段与头像、角色广场、资料页、管理后台角色库 | web、android、admin、server |
| `src/http/contacts.ts` | 添加角色、通讯录、备注、自定义头像、专属称呼、删除恢复 | web、android、server |
| `src/http/chat.ts` | 会话、参与者、消息内容、消息、已读、撤回、会话状态 | web、android、server |
| `src/http/sync.ts` | 每用户更新日志与补拉（多端同步） | web、android、server |
| `src/http/push.ts` | 推送设备登记、通知载荷格式 | web、android、server |
| `src/http/companion.ts` | 陪伴设置（秒回、拆条），数据归 ai-runtime | web、android、server |
| `src/http/media.ts` | 图片上传（我的头像、通讯录头像；管理员上传角色头像） | web、android、admin、server |
| `src/ws.ts` | WebSocket 帧协议 | web、android、server |
| `src/events.ts` | 领域事件（以 `Events` 命名空间导出） | server 各模块 |
| `src/ports/` | 模块之间的同步接口（端口），含 `billing.ts` 计费端口 | server 各模块 |
| `src/character-card.ts` | 角色卡（**预留位置**，D-L0-10 并入） | server、admin |
| `test-vectors/`（待建，D-L0-17） | 同步协议一致性测试用例（JSON），网页与安卓都必须通过（ADR-0011、ADR-0013） | web、android |

## 当前范围

v0.2 覆盖 L0、L1 所需：账号、模型选择与计费、角色基础信息与展示字段、通讯录、会话与消息、同步、推送、陪伴设置（秒回 / 拆条）、媒体（头像）、领域事件、端口。后续层由架构负责人按 `docs/architecture/dev-plan.md` 扩展。

## 版本规则

- `CONTRACT_VERSION` 形如 `主.次`。1.0 起：新增接口、事件、可选字段、错误码、消息类型 → 次版本加一；删除字段、改含义、改必填 → 主版本加一。
- **1.0 之前（0.x，尚无实现代码）**：允许不兼容改动，只升次版本，并在下方「变更记录」写明。D-L0-04 完成、首个模块开始实现时升为 1.0。
- 客户端必须容忍未知的消息类型和更新类型（显示「当前版本不支持」或跳过），这样次版本升级不会让旧版安卓客户端崩溃。

## 变更记录

| 版本 | 日期 | 改动 | 依据 |
|---|---|---|---|
| 0.1 | 2026-10-04 | 首版 | T-004 |
| 0.2 | 2026-10-04 | **删除** BYOK：`Credential*`、`Provider`、`/model/credentials*`、`/model/providers`、`credential_exists` / `credential_test_failed` 错误码、`credential_status_changed` / `credential_deleted` 事件、`ModelGatewayPort.probeCredential`、更新类型 section `model_credentials`。**删除** `bridge.ts`（ADR-0011）。**新增** `http/billing.ts`、`ports/billing.ts`、`billing.*` 事件、`model_access.model_status_changed`、管理后台上游与模型目录接口、错误码 `model_not_allowed` / `insufficient_balance` / `upstream_test_failed` / `price_version_immutable`。**修改** `ModelRef` 改用 `modelKey`；`ModelCapability` 增加 `image_generation`；`ModelStatus.reason`；`ModelPurpose`（去掉 `connectivity_test`，增加 `admin_eval`、`admin_upstream_test`）；`BACKGROUND_PURPOSES` 去掉 `import_analysis`（与 cost-estimate 一致）；`GenerateTextInput.meta`。**policy**：去掉年龄 / 群聊 / 成人模型原因码，新增 `checkModelForCharacter`、`adultContentModelAllowed`；`PortraitPolicy` 简化为 `forbidden` / `allowed`；`shareImageLabel` 只对真人。**characters**：头像改为 `{ image, display }`，新增 `CharacterDisplay`（应援色、头像字、头像图案、主题色）。**media**：新增 `character_avatar` 用途与管理员上传接口 | ADR-0010、ADR-0011、ADR-0012、ADR-0007 修订、T-006 设计申请、T-009 |

## 已知事项

- 本版本仍**未经过编译验证**（技术债 TD-011）。D-L0-04 必须让 `pnpm --filter @weiban/contracts typecheck` 通过，发现的问题由架构负责人修正。
- `generated/` 为构建产物，不进仓库。
