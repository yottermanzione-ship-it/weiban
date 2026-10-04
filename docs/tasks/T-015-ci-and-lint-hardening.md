# T-015 自动检查流水线（CI）与边界规则加固（D-L0-03 + T-011 验收建议）

| 项 | 内容 |
|---|---|
| 负责人 | devops-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-05 |
| 状态 | 进行中 |
| 分支 | `T-015-ci-and-lint-hardening` |

## 目标

每次推送代码到 GitHub 都自动跑检查；补上 T-011 验收发现的规则漏洞，在后端动工前把边界守牢。

## 输入文档

- `docs/architecture/dev-plan.md`（D-L0-03）
- `docs/quality/T-011-acceptance.md`（建议 1、6、7 及遗留问题 4）
- `docs/handoffs/2026-10-04-devops-lead-T-011.md`
- `docs/ops/git-workflow.md`、`docs/architecture/engineering-standards.md`

## 工作内容

1. **GitHub Actions**：在推送和 PR 时跑 `pnpm install --frozen-lockfile` + lint / typecheck / test / format:check；缓存 pnpm 依赖；Node 24、pnpm 11
   - 安卓 Gradle 构建部分：先留好位置和注释，等 Android 负责人在 D-L0-18 建立安卓工程后再接入
2. **R7 加固**（QA 建议 1）：识别 `globalThis.Date`；对 `apps/server/src` 下除 `platform/` 和测试以外的文件都生效
3. **禁止路径别名**（QA 建议 6）：服务器范围内禁止 `@/*`、`~/*` 这类别名导入，直接报错
4. **同层循环依赖检查**（遗留问题 4）：用 `import-x/no-cycle` 或 dependency-cruiser，附「违规会报错」的测试
5. **文档措辞**（QA 建议 7）：修正 `dev-env-setup.md` 末段
6. **main 保护规则**：写成给总经理的一步一步操作说明（在 GitHub 网页上设置：必须通过 CI 才能合并），放在 `docs/ops/`。不要尝试自己修改 GitHub 仓库设置
7. **设计令牌生成脚本**：把 `docs/design/tools/build-tokens.mjs` 移到 `scripts/`（删除原文件，更新 `docs/design/` 中引用它的路径），根脚本加 `pnpm tokens`，CI 加 `--check`（重新生成后应无差异）
8. R9 加固（不允许其他模块引用 `BillingPort`）：方案由架构在 T-014 中定，本任务**不做**，等 T-014 交接后另开小任务

## 范围

- 可以改：`.github/`、`packages/eslint-config/`、根目录 ESLint 配置与 `package.json` 脚本、`scripts/`、`docs/ops/`；`docs/design/` 中仅限更新脚本路径引用
- 不可以改：`packages/contracts/`、`.prettierignore`（架构 T-014 在改）、其他目录
- 在分支上提交，不合并 main；完成后推送分支到 origin，确认 GitHub Actions 在该分支上实际运行通过

## 验收标准

- [ ] GitHub Actions 在分支上实际运行并通过（交接说明附运行链接或结果）
- [ ] 第 2～4 项每项都有「违规会报错、合规不报错」的测试，`pnpm test` 通过
- [ ] 本地 `pnpm check` 通过
- [ ] main 保护规则操作说明完成
- [ ] 提交格式 `T-015 类型: 说明`

## 交付物

- 分支 `T-015-ci-and-lint-hardening`
- 交接说明：`docs/handoffs/2026-10-05-devops-lead-T-015.md`（提交在分支上）
