# T-001 git 安装与基础工作流

| 项 | 内容 |
|---|---|
| 负责人 | devops-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-04 |
| 状态 | 已完成（文档类任务，总负责人复核通过，未走质量验收） |

## 目标

总经理能照着一步步装好 git，项目有一套简单够用的分支、提交与合并流程，质量负责人「通过才能合并」有落地方式。

## 背景

总经理的电脑（Windows 11）还没装 git。项目是个人学习项目，一人加多个 AI 负责人开发，流程要简单，不要照搬大团队那一套。

## 输入文档

- `docs/README.md`
- `docs/status.md`
- `CLAUDE.md`（标准工作流一节）
- `docs/decisions/ADR-0001-founding-decisions.md`

## 范围

- 可以改：`docs/ops/` 下新建文档；`.gitignore`
- 不可以改：其他负责人的文档、`CLAUDE.md`、`.claude/agents/`
- 不要替总经理安装任何软件、不要执行 git init（等总经理装好后再做）

## 验收标准

- [ ] `docs/ops/git-setup.md`：面向零基础的 Windows 安装步骤（从哪下载、安装选项怎么选、怎么验证装好了、首次配置用户名邮箱），每一步写清楚
- [ ] `docs/ops/git-workflow.md`：分支命名、提交信息格式、一个任务从开分支到验收合并的完整流程，与 CLAUDE.md 标准工作流一致
- [ ] 说明是否需要远程仓库（如 GitHub/Gitee），给出推荐并说明理由
- [ ] 用通俗语言解释 git、分支、提交、合并是什么

## 交付物

- `docs/ops/git-setup.md`、`docs/ops/git-workflow.md`
- 交接说明：`docs/handoffs/2026-10-04-devops-lead-T-001.md`
