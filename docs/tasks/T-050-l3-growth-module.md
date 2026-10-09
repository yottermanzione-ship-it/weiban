# T-050 L3 growth 模块第一部分：熟悉度、认识天数与纪念日

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-09 |
| 状态 | 待开始 |

## 目标

实现 `growth` 模块第一部分（D-L3-04）：熟悉度等级（P-25）、认识天数与纪念日（用户时区），为后续推演引擎（T-051）和主动消息调度（T-052）的熟悉度依赖做好准备。

## 背景

- `contacts` 模块（T-038）已实现好友关系与删除逻辑，但没有熟悉度与认识天数字段。
- T-047 已实现关系类型（`relationshipType`），`growth` 模块是进一步的成长维度。
- 推演引擎（D-L3-01）和主动消息调度（D-L3-03）都会读取熟悉度与认识天数，因此本模块需要先完成。

## 输入文档

开工前必须读：
- `docs/product/prd-v1/09-relationship-growth.md`（GRW-03、GRW-04，P-25）
- `docs/architecture/` 中 contacts 与 growth 的模块职责与数据域
- `packages/contracts/src/http/contacts.ts`（现有好友接口）
- `docs/team/dev-environment-notes.md`（本机环境，必读）

## 范围

- **可以改**：`apps/server/src/modules/growth/**`（新建模块）、新增迁移 `apps/server/drizzle/0018_*`（**编号 0018 已为你保留**）、`packages/contracts/src/http/growth.ts`（新建契约文件）、`packages/contracts/src/index.ts`（导出）、`packages/contracts/src/version.ts`（升版本）。
- **不可以改**：`apps/server/src/modules/ai-runtime/**`、`apps/server/src/modules/contacts/**`（只读通过端口调用）、`apps/web/**`、`apps/android/**`、`docs/quality/**`。
- 改契约必须同步导出、版本号，并运行 `pnpm -r run generate` 和 `node apps/android/tools/generate-contracts.mjs`（否则安卓 CI 会失败，上几个任务都踩过这个坑）。
- 迁移必须同时提供 `.up.sql` 与 `.down.sql`。

## 验收标准

逐条可检查，质量负责人照此验收：
- [ ] 熟悉度等级（1～5 或 P-25 定义的档次）随对话行为自动更新，有集成测试覆盖升级路径
- [ ] 认识天数从好友关系建立时间起算，按用户时区计算（不按 UTC）
- [ ] 纪念日（认识满 X 个月/年）可通过接口查询，有集成测试
- [ ] 接口返回熟悉度等级、认识天数、下一个纪念日及其名称
- [ ] 迁移 0018 有 up 与 down，迁移与回滚都跑通
- [ ] 本机相关测试**跳过 0 条**
- [ ] 没有为让检查通过而放宽断言、跳过测试或改门禁

## 交付物

- 代码路径：`apps/server/src/modules/growth/**`、`apps/server/drizzle/0018_*`、`packages/contracts/src/http/growth.ts`
- 交接说明：`docs/handoffs/2026-10-09-backend-lead-T-050.md`
- 分支：从 main 新建 `T-050-l3-growth-module`，worktree 放 `C:\wb-dev\wb-t050`
- PR 指向 main，描述末尾加：🤖 Generated with [Claude Code](https://claude.com/claude-code)
- **不要合并，不要动 main**
