# 交接说明：T-059 L3 health 后端模块（经期日记）

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 日期 | 2026-10-09 |

## 做了什么

按契约 2.5 实现经期日记后端（PLAY-01）：经期记录增删改查（整行用户 DEK 加密）、P-37 预测、授权角色管理、`HealthReadPort` 实现与注册、chat 消息 `labels` 存储与下发、推送对「健康」消息不显示内容、注销删除清单、角色删除自动撤销授权，并在 lint 中登记「只有 ai-runtime 能用 HealthReadPort」。实现说明见 `docs/backend/health.md`。

按总经理 2026-10-09 要求：**未写测试、未跑测试，只保证 typecheck 通过**（另对改动目录跑过一次 eslint，无报错）。PR 描述已注明「未测试，开发阶段合并」。

分支：`T-059b-health-backend`（worktree `C:\wb-dev\wb2-t059`，基于最新 origin/main 变基）。

## 改了哪些文件

- 新增 `apps/server/src/modules/health/**`（module、controller、service、store、lifecycle、prediction、schema、tokens、index）
- 新增迁移 `apps/server/drizzle/0020_health.sql` / `0020_health.down.sql`，`meta/_journal.json` 登记 idx 20
- `apps/server/src/app.module.ts`：装配 HealthModule
- `apps/server/src/modules/chat/`：`messages.labels` 列；写入时规范化 labels；下发 `Message.labels`；`getNotificationContext` 对 health 消息不给正文
- `apps/server/src/modules/push/domain/notification-rules.ts`：可选 `labels`，含 health 不显示内容
- `packages/eslint-config/`：`architecture.js` 登记 health（中层）、新规则 `rules/health-port-exit.js` 并启用
- 新增 `docs/backend/health.md`

## 遗留问题

- 验收标准里的各项测试（密文验证、push 不显示内容、注销清除等）按总经理指示未写，需 Codex 验收时补测或另派任务。
- 契约 2.5 没有「用户填写默认周期/经期天数」接口，`period_settings` 表已建但未使用，预测用 P-37 默认值 28 / 5 天。
- 契约没有「清空全部经期日记」接口（PLAY-01 第 8 条），目前只能逐条删除；如需要应由架构负责人补契约。
- 症状标签的管理员列表（ADM-04）尚不存在，目前接受契约范围内任意标签。
- `packages/eslint-config` 归运维维护，本次按 T-058 交接由后端代为登记，请运维事后过目。
- library（分享图拒绝 health 消息）和名场面卡排除不在本任务范围，模块尚未实现时需由对应负责人处理。

## 需要总经理决定的事

无。

## 给其他负责人的交接

- 给 ai-lead（T-060）：在 `AiRuntimeModule` 的 imports 加 `HealthModule`（`../health/index.js`），注入 `@Inject(HEALTH_READ_PORT) health: HealthReadPort`。`getPeriodContext({ userId, characterId, scene })` 每次生成前现取、不缓存；返回 null 表示未授权/无记录/场景不允许。用了摘要的消息在 `ChatParticipantPort.postMessage` 的 `labels` 里带 `'health'`。`cycleKey` 已让「经期前提醒」与随后那次经期里的关心共用一个 key，可直接作 P-36 配额计数键。`getAuthorizedCharacters(userId)` 按授权时间升序返回。P-37 的「提前 2 天」「超过 10 天」常量在 `modules/health/domain/prediction.ts` 的 `P37`（ai-runtime 不能 import 该文件，需要时请自定常量或经端口返回值判断：`predictedNextStart` 与用户当地今天相差 2 天即提醒时机）。
- 给 web-lead / android-lead：接口全部在 `/api/v1/me/health/*`；删除返回 204；新建经期与已有记录重叠返回 409 `conflict`；列表 `nextCursor` 是不透明字符串。预测响应的 `disclaimer` 必须展示。
- 给 devops-lead：新增 lint 规则 `weiban/health-port-exit`，请过目；迁移 0020 与 main 上的 0021 不冲突（按 tag 记录，已插在 journal 正确位置）。
- 给 Codex（总经理转交）：本任务未测试，请按 `docs/architecture/health-data.md` 第 7 节金丝雀方法验收。
