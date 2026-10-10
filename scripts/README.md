# scripts · 开发辅助脚本

放跨子项目的开发辅助脚本，例如：生成契约文档、由契约 JSON Schema 生成 Kotlin 代码、由 `docs/design/tokens.json` 生成令牌常量、造测试数据。

规则：

- 脚本用 TypeScript 或 Node.js 编写（开发机已装 Node），不写只能在某一种系统上运行的 shell 脚本。
- 每个脚本开头注释写清：做什么、谁维护、怎么运行。

## 现有脚本

| 脚本                     | 做什么                                                                                                 | 怎么运行                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `build-tokens.mjs`       | 从 `docs/design/tokens.json` 生成网页 `tokens.css` 和安卓 `WbTokens.kt`；`--check` 检查生成物是否最新  | `pnpm tokens`、`pnpm tokens --check`（参数说明见脚本开头注释） |
| `verify-user-purged.mjs` | 注销核验：删除清单、全库 uuid 列扫描、审计 / 事件、对象存储孤儿文件，确认某用户数据已全部删除（T-080） | `pnpm verify-user-purged <用户ID>`                             |
