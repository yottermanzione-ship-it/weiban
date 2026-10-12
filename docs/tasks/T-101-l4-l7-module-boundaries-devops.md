# T-101 L4～L7 运维：新模块登记与模块边界规则

| 项 | 内容 |
|---|---|
| 负责人 | devops-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-09 |
| 状态 | 待开始 |
| dev-plan | D-L7-02 等各卡中的「lint 部分：运维」，合并为一张 |
| 迁移号 | 无 |

## 目标

做完后：L4～L7 要新建的服务器模块（`moments`、`library`、`importer`、`plaza`，以及契约 3.0 定下的玩法模块和通话模块，如有）都在模块边界配置中登记好层级和允许的依赖，后端开发新建目录时 lint 能正确识别，不会因「未知模块」报错。

## 背景

- 模块边界规则 R1～R10 由 ESLint 配置强制（`docs/architecture/engineering-standards.md` 第 3 节）；L3 的 health 模块登记在 T-059 中由运维完成，做法相同。
- 「全员并行」下后端会同时新建多个模块，先登记可以避免每张后端卡各自改 lint 配置引起冲突。

## 输入文档

- `docs/tasks/L4-L7-index.md` 第 2 节
- `docs/architecture/contracts-3.0-map.md`（新模块清单与端口）
- `docs/architecture/overview.md`（模块表：层级、谁能依赖谁）、`docs/architecture/persona-plaza.md` 第 2 节、`docs/architecture/repo-structure.md`、`docs/architecture/engineering-standards.md` 第 3 节
- `docs/ops/ci.md`

## 范围

- 可以改：`packages/eslint-config/**`（含 `architecture.js` 模块登记）、`docs/ops/ci.md`（如需说明）。
- 不可以改：`apps/**` 业务代码、`packages/contracts/**`、`docs/quality/**`。

## 交付物

1. 在模块边界配置中登记新模块及层级（`moments` 上层、`library` 上层、`importer` 上层、`plaza` 上层，见 `overview.md`；玩法 / 通话模块按契约 3.0）。
2. 按架构文档加专门规则（如 plaza 只能经 `CharacterPlazaPort` 访问 characters；importer 原文表只能由 importer 访问——以架构文档为准，不自行新增限制）。
3. 交接说明列出登记结果，供各后端卡对照。

## 本轮完成标准

本轮不写额外测试、不做评审，只保证可编译（lint 配置能被加载，现有代码 lint 不新增报错）。

## 验收标准（留给 Codex 整体验收）

- [ ] 新模块目录下的文件能被 lint 正确识别所属模块；跨模块直接引用内部实现会报错。

## 交付

分支 `T-101-l4-l7-module-boundaries`，worktree `C:\wb-dev\wb-t101`，交接 `docs/handoffs/2026-10-09-devops-lead-T-101.md`。其余按 index 第 2 节。**建议最先合并**。
