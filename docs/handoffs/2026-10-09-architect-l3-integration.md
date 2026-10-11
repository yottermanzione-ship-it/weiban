# 交接说明：L3 集成合并（T-048 / T-050 / T-052 / T-054）

| 项 | 内容 |
|---|---|
| 负责人 | architect |
| 日期 | 2026-10-09 |

## 做了什么

- 在 `C:\wb-dev\wb-int`（分支 `integration/l3`）依次合并 T-048 网页、T-050 growth、T-054 时间线、T-052 主动消息后端，解决冲突后推送到 `origin/main`（快进）。
- **main 新 SHA：`ecb604a`**。PR #10 / #13 / #15 / #16 因分支已全部进入 main，GitHub 自动标记为 MERGED。
- 契约统一为 **2.5**（`packages/contracts/README.md` 变更记录新增「2.5 L3 集成」条目），Android 生成物用 `pnpm android:generate` 统一重生成。
- 本机 `pnpm typecheck` 全部通过（按要求未跑测试）。

## 迁移编号表（apps/server/drizzle）

| 编号 | 文件 | 来源 |
|---|---|---|
| 0018 | 0018_growth | T-050 |
| 0019 | 0019_simulation_engine | T-051 |
| 0020 | （保留给 T-059 健康） | — |
| 0021 | 0021_proactive | T-052 |
| 0022–0024 | （保留给 T-053） | — |
| 0025–0029 | （L3 其余预留） | — |

`meta/_journal.json` 按编号排序，`when` 严格递增（迁移执行器按 tag 判断是否已执行，与 `when` 无关）。

## 改了哪些文件

- 合并冲突：`packages/contracts/src/index.ts`、`packages/contracts/src/ports/index.ts`、`apps/server/drizzle/meta/_journal.json`、`apps/server/src/app.module.ts`、`apps/server/src/modules/ai-runtime/ai-runtime.module.ts`
- 重生成：`apps/android/core/contracts-generated/**`
- `packages/contracts/README.md`

## 遗留问题

- 未运行测试（总经理要求）；整体验收交 Codex。

## 需要总经理决定的事

无

## 给其他负责人的交接

- 给全部开发负责人：后续分支请基于 `ecb604a` 或更新的 main；新迁移按 `docs/architecture/contracts-3.0-map.md` 的号段取号。
