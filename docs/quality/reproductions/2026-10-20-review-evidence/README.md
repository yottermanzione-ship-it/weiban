# 2026-10-20 公共检查证据

被审 SHA：`65bb669821909ac62239c5b140410d569a078411`。独立副本、Node 24.21.0、pnpm 11.28.4；未复制环境秘密，无测试数据库。下列 `.txt` 是命令原始输出，仅由 `.log` 改扩展名以纳入质量文档版本管理。

| 文件前缀 | 命令 / 方法 | 退出码 |
| --- | --- | --- |
| install | pnpm install --frozen-lockfile | 0 |
| format | pnpm format:check | 1 |
| lint | pnpm lint | 1 |
| deps | pnpm lint:deps | 0 |
| types | pnpm typecheck | 0 |
| tests | pnpm test | 1 |
| focused-tests | pnpm exec vitest run --project contracts --project client-core --project ai-evals --maxWorkers=1 | 0 |
| build-server / build-web / build-admin | pnpm --filter @weiban/server（或 web / admin） build | 各 0 |
| tokens | pnpm tokens --check | 0 |
| migration-manifest | server 包通过 tsx 调用 readMigrations，只读清单，无数据库 | 0 |
| crypto | 上级目录 2026-10-20-crypto-probe.mjs，固定 SHA 模块、随机临时密钥和内存桩 | 0 |

全仓 4 条失败 / 321 条通过 / 368 条跳过。定向 156 条包含在全仓统计中，不叠加。原始格式检查发生在新增本轮 QA 文件之前，41 项失败是被审快照的结果。主审后续只格式化本轮新报告 / 探针，没有改这些被审文件。

质量文档归档分支不包含业务修改。每项缺陷的证据等级、历史归属和未覆盖部分以[汇总报告](../../product-acceptance.md)及板块报告为准。
