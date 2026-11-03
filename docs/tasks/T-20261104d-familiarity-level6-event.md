# T-20261104d 熟悉度升到第 6 阶段时事件校验失败，用户卡在第 5 阶段

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-11-04 |
| 状态 | 待验收 |

## 目标

熟悉度从第 5 阶段升到第 6 阶段（六阶段制，3.25 起）能正常完成：发系统提示、发卡、发 `growth.familiarity_leveled_up` 事件、解锁相关行为，不再报错回滚。

## 背景（生产日志，2026-11-03 11:28–11:54 UTC）

- 订阅者 `growth.familiarity_on_user_message` 处理 `chat.message_created` 连续失败 140 次，14 个事件重试 10 次后被放弃（日志「事件多次投递失败，已放弃，需要人工处理」）。
- 错误：`ZodError … path payload.level … Too big: expected number to be <=5`，堆栈 `Outbox.publish` ← `GrowthService.onLevelUp`。
- 原因：`packages/contracts/src/events.ts` 的 `FamiliarityLeveledUp` 负载 `level: z.number().int().min(2).max(5)`，而熟悉度已是六阶段（`apps/server/src/modules/growth/domain/familiarity-rules.ts` `effectiveStage`、`stage-settings.ts`）。升到 6 时发布事件校验失败 → 整个加分事务回滚 → 用户永远停在第 5 阶段，且每条消息都重复报错。
- 生产现状：熟悉度第 5 阶段 5 对、第 6 阶段 1 对（只读统计，未看内容）。

## 输入文档

- `CLAUDE.md`、`AGENTS.md`（你在独立 worktree `C:\wb-dev\wb-lv6`，分支 `fix/familiarity-level6-event-20261104`）
- `packages/contracts/src/events.ts`（`FamiliarityLeveledUp`）及契约版本/变更记录规则（`packages/contracts` 下的 README / CHANGELOG，若有）
- `apps/server/src/modules/growth/application/growth.service.ts`（`addPoints`、`onLevelUp`）、`domain/familiarity-rules.ts`、`application/stage-settings.ts`、`application/cards.service.ts`（`familiarityTitle`、`CARD_LINES.familiarity`、`LEVEL_NAMES`）
- `apps/server/src/modules/ai-runtime/application/lifecycle.ts`（事件消费者：按 level 解锁行为）
- `apps/android/core/contracts-generated/…/Contracts.kt`（生成的安卓契约，按项目既有生成方式同步，不要手改格式）

## 范围

- 可以改：上述契约事件定义（总负责人已批准此项契约变更：level 上限改为与阶段数一致，补丁级版本号按项目规则递增）、growth / ai-runtime 相关服务端代码与测试、安卓生成契约、本任务卡、交接说明。
- 不可以改：其它契约、web/admin 界面、`docs/quality/`、部署脚本、生产服务器。不推 main、不合并、不碰生产。

## 要做的事

1. 契约 `FamiliarityLeveledUp.level` 上限改为 6（若项目里有「最大阶段数」常量，用常量，别再写死）；按规则更新契约版本与变更记录、安卓生成契约。
2. 核对第 6 阶段的名称、卡片标题与台词、成就、ai-runtime 消费者对 level 6 的处理都有值，不会出现空字符串或越界。
3. 核对：其它和熟悉度阶段有关的 schema（API 响应、通知参数、系统消息参数等）有没有同样写死 5 的地方，一并修。
4. 测试：一条从第 5 阶段加分升到第 6 阶段的测试，断言事件发布成功、阶段落库为 6、系统提示和卡片都发出。
5. 本机只运行一次相关检查（contracts 构建/测试、server typecheck、lint 和相关测试）；推分支、开 PR，以 CI 为准。

## 验收标准

- [x] 第 5→6 阶段升级不再报错，有测试。
- [x] 契约版本与变更记录、安卓生成契约已同步，CI 的契约一致性检查通过（本机 `pnpm android:generate:check` 通过，以 CI 为准）。
- [x] 同类写死上限的地方已列出并处理。
- [x] 交接说明写清改动与遗留（例如：被放弃的 14 个事件是否需要补处理——只说明，不要碰生产）。

开发自测见交接说明 `docs/handoffs/2026-11-04-familiarity-level6-event.md`；独立验收待 Codex。

## 交付物

- 代码：`packages/contracts/**`、`apps/server/src/**`、`apps/server/test/**`、`apps/android/core/contracts-generated/**`
- 交接说明：`docs/handoffs/2026-11-04-familiarity-level6-event.md`
- PR 标题：`fix(growth): 熟悉度升到第 6 阶段时事件校验失败（T-20261104d）`
