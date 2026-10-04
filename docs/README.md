# 微伴项目文档目录

AI 之间没有共同记忆，**文档就是记忆**。每份信息只在一处定义，其他地方引用。

| 位置 | 内容 | 负责人 |
|---|---|---|
| `status.md` | 项目状态：阶段、进度、待办、风险、技术债 | 总负责人 |
| `tasks/` | 任务卡（模板：`tasks/_template.md`） | 总负责人 |
| `handoffs/` | 每次工作结束的交接说明（模板：`handoffs/_template.md`） | 各负责人 |
| `decisions/` | ADR 重大技术决策记录（模板：`decisions/_template.md`） | 架构（最终修改权） |
| `product/` | PRD、功能分期、用户流程、术语表 | 产品 |
| `design/` | 设计体系、设计令牌、页面设计说明 | 设计 |
| `architecture/` | 系统边界、模块职责、数据域、仓库结构、工程规范、技术债登记 | 架构 |
| `backend/` | 后端实现说明 | 后端 |
| `ai/` | AI 运行时、提示词、记忆设计、评测集、成本报告 | AI 系统 |
| `web/` | Web/PWA 实现说明、性能检查记录 | Web |
| `android/` | 安卓壳、桥接说明、厂商适配 | Android |
| `ops/` | 部署、备份、监控、操作手册 | 运维 |
| `quality/` | 测试策略、验收报告、安全检查 | 质量 |
| `team/` | 组织手册原件与团队规则 | 总负责人 |

接口契约不在 docs/，以 `packages/contracts/` 为准。

2026-10-04 起，独立质量验收由 Codex 接替 Claude `qa-lead`；质量职责、报告格式与 GitHub 交接流程见 [`quality/README.md`](quality/README.md)，遗留问题见 [`quality/issues.md`](quality/issues.md)。

## 命名约定

- 任务卡：`tasks/T-001-short-name.md`（简称用英文小写加短横线，因为 git 分支名直接取任务卡文件名）
- 交接说明：`handoffs/YYYY-MM-DD-负责人-T-001.md`
- 验收报告：`quality/T-001-acceptance.md`
- ADR：`decisions/ADR-0001-short-name.md`

git 分支、提交、合并流程见 `ops/git-workflow.md`。
