# T-055 L3 管理后台：公开动态录入、审核与节日清单

| 项 | 内容 |
|---|---|
| 负责人 | web-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-09 |
| 状态 | 待开始 |

## 目标

实现 L3 管理后台（D-L3-06）：让管理员能录入与审核角色公开动态（平台统一发布的「今日要闻」）、维护节日/纪念日清单，供推演引擎（T-051）和主动消息调度（T-053）读取。

## 背景

- T-052（公开动态后端）在 `wb-t052`，**必须先读其交接说明**了解接口定义。
- 公开动态由管理员提前录入，推演引擎在合适时机选用；节日清单是推演引擎触发纪念日事件的数据源。
- PRD ADM-03、ADM-04（节日清单）是主要需求来源。

## 输入文档

开工前必须读：
- `docs/product/prd-v1/08-simulation.md`（SIM-07、SIM-08，公开动态管理逻辑）
- `docs/product/prd-v1/14-admin.md`（ADM-03、ADM-04）
- `docs/handoffs/2026-10-09-backend-lead-T-052.md`（T-052 交接，接口说明）
- `packages/contracts/src/http/proactive.ts`（T-052 定义的契约）
- `docs/team/dev-environment-notes.md`（本机环境，必读）

## 范围

- **可以改**：`apps/admin/src/`（管理后台 Web，相关页面）。
- **不可以改**：`apps/server/**`（只调用接口）、`docs/quality/**`。
- 公开动态审核状态：草稿 → 待审核 → 已发布 / 已拒绝。
- 节日清单支持固定年日期（每年同一天）与一次性日期，可按角色分类筛选。

## 验收标准

- [ ] 管理员可新增、编辑、删除节日/纪念日条目
- [ ] 管理员可录入公开动态草稿并提交审核
- [ ] 公开动态列表支持按状态筛选（草稿/待审/已发布）
- [ ] 操作均调用 T-052 提供的接口，无硬编码数据
- [ ] 没有为让检查通过而放宽断言或跳过测试

## 交付物

- 代码路径：`apps/admin/src/`（L3 相关管理页面）
- 交接说明：`docs/handoffs/2026-10-09-web-lead-T-055.md`
- 分支：从 main 新建 `T-055-l3-admin-dynamics`，worktree 放 `C:\wb-dev\wb-t055`
- PR 指向 main，描述末尾加：🤖 Generated with [Claude Code](https://claude.com/claude-code)
- **不要合并，不要动 main**
