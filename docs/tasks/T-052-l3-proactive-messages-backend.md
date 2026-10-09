# T-052 L3 公开动态接口：角色日报、节日事件、主动消息端口

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-09 |
| 状态 | 待开始 |

## 目标

实现公开动态所需的后端接口（D-L3-02）：角色日报记录、节日/纪念日事件存储、主动消息调度所需的后端端口，为 T-053（主动消息调度，ai-lead）和 T-055（管理后台，web-lead）提供数据层。

## 背景

- T-051（推演引擎，ai-lead）在 `wb-t051` worktree 中开发，**开工前先读其 worktree 下的契约变更**，避免端口定义冲突。
- 主动消息调度（T-053）需要本模块提供「允许发主动消息？」「今天已发几条？」等查询端口。
- 管理后台（T-055）需要「节日清单 CRUD」接口。
- PRD SIM-06～SIM-09 是主要需求来源。

## 输入文档

开工前必须读：
- `docs/product/prd-v1/08-simulation.md`（SIM-06～SIM-09，公开动态与节日逻辑）
- `docs/backend/billing.md`（`countAsBackground`，主动消息计费）
- `packages/contracts/src/http/simulation.ts`（如 T-051 已建立，照此扩展；否则新建）
- `docs/team/dev-environment-notes.md`（本机环境，必读）
- `C:\wb-dev\wb-t051\packages\contracts\src\`（读 T-051 在其 worktree 中已写的契约，避免重复定义）

## 范围

- **可以改**：`apps/server/src/modules/proactive/**`（新建）、`packages/contracts/src/http/proactive.ts`（新建或扩展）、`packages/contracts/src/index.ts`（导出）、`packages/contracts/src/version.ts`（升版本）。
- **不可以改**：`apps/server/src/modules/ai-runtime/**`（只读端口）、`docs/quality/**`。
- 改契约必须同步运行 Android Kotlin codegen：`node apps/android/tools/generate-contracts.mjs`。
- 需提供的端口：
  - `ProactiveMessagePort`：`canSendProactive(userId, characterId)`、`recordSent(userId, characterId)`、`getDailyCount(userId, characterId)`
  - `HolidayEventPort`：查询未来 N 天内的节日/纪念日事件

## 验收标准

- [ ] `proactive` 模块有日报记录表（存储推演生成的「今日要闻」）
- [ ] 节日清单表：增删改查，支持固定日期与相对日期（每年几月几日）
- [ ] `ProactiveMessagePort` 实现并导出，至少含每日计数查询与写入
- [ ] `HolidayEventPort` 实现：按用户时区查询未来 N 天事件
- [ ] 契约升版本，Android codegen 同步
- [ ] 没有为让检查通过而放宽断言或跳过测试

## 交付物

- 代码路径：`apps/server/src/modules/proactive/**`、`packages/contracts/src/http/proactive.ts`
- 交接说明：`docs/handoffs/2026-10-09-backend-lead-T-052.md`（含给 T-053/T-055 的端口说明）
- 分支：从 main 新建 `T-052-l3-proactive-backend`，worktree 放 `C:\wb-dev\wb-t052`
- PR 指向 main，描述末尾加：🤖 Generated with [Claude Code](https://claude.com/claude-code)
- **不要合并，不要动 main**
