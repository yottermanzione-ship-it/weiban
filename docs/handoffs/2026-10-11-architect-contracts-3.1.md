# 交接说明：契约 3.1 一次收口（积压清理第一步）

| 项 | 内容 |
|---|---|
| 负责人 | 架构负责人 |
| 日期 | 2026-10-11 |
| 分支 / 提交 | `contracts-3.1`（worktree `C:\wb-dev\wb-c31`），`9e21ef5`，已快进合入 `local/trunk` |
| 自检 | 全仓 `pnpm typecheck`、`pnpm android:generate:check`、`pnpm format:check` 通过；改动文件 eslint 通过；按要求没写、没跑测试 |

## 做了什么

1. **契约升到 3.1，全部向后兼容**：新的响应字段都是可选的，现有服务器、网页、安卓不改代码也能编译运行（已验证 typecheck）。
2. **补登记已经做了、但只写在交接里的改动**：3.0.1（L4 后端收尾、T-063 的 `formerParticipants`、T-088 的 `ContactsWritePort`）、3.0.2（T-076 纪念日 / 节日字段）、`recordSent` 的可选参数、`conversation.removed`、`self_chat` 标签。两次都叫「3.0.1」撞了号，统一并入 3.1 的变更记录。
3. **新增契约**（积压 ⑰⑲㉓～㉘㉚㉝㉞㊱㊲ 及 T-082 / T-098 / T-093 申请）：明细见 `packages/contracts/README.md`「3.1」。补充设定冲突写入、儿童特征写回两个「服务器内部令牌」改成了正式契约端口。
4. **ADR**：新写 ADR-0028（3.1 收口与「底层模块的可选 AI 接入点」写法）；ADR-0024 补记 ai-runtime → proactive、library → moments 维持注入、characters 订阅 `plaza.work_removed`；ADR-0027 补记裁定「搜索维持方案 A（保留加密、内存解密匹配）」。
5. **文档**：`contracts-3.1-map.md`（按后端 / AI / 网页 / 安卓分组的实现清单、迁移号 0070–0076）；技术债 TD-028～TD-032（含安卓 detekt 评估）；`security-and-privacy.md` 第 6 节改成「全库无孤儿文件」；`engineering-standards.md` R2 写明上层白名单。
6. **P-36 / P-37 挪进统一参数文件** `apps/server/src/platform/config/product-params.ts`，health 和 ai-runtime 改为引用（数字没变）。
7. Android 生成物已重生成。

## 改了哪些文件

- 契约：`packages/contracts/src/version.ts`、`events.ts`、`http/{ai-runtime-extras,assets,character-extras,characters,chat-groups,chat,importer,library,model-access,pets,play,plaza,sync}.ts`、`ports/{billing,characters,identity,model-gateway,push,social}.ts`（`ports/media.ts` 只是格式化）、`packages/contracts/README.md`
- 服务器（只有参数挪动和格式化）：`apps/server/src/platform/config/product-params.ts`、`modules/health/domain/prediction.ts`、`modules/ai-runtime/application/health-care.ts`；`modules/health/application/store.ts`、`modules/media/application/link-preview.ts` 只是 Prettier 格式化（之前就没通过格式检查）
- 安卓生成物：`apps/android/core/contracts-generated/.../Contracts.kt`、`Endpoints.kt`、`contracts.json`
- 文档：`docs/decisions/ADR-0028-contracts-3.1-backlog-closeout.md`（新）、`ADR-0024`、`ADR-0027`、`docs/architecture/contracts-3.1-map.md`（新）、`contracts-3.0-map.md`、`dev-plan.md`、`engineering-standards.md`、`security-and-privacy.md`、`tech-debt.md`

## 遗留问题

- 新契约都还没有实现，按 `contracts-3.1-map.md` 第 3～6 节派发（后端 21 项 → AI 12 项 → 网页 11 项 → 安卓）。
- 本次没纳入的小缺口（不阻塞，按需再申请）：成就变化事件带成就键（T-076）；后台用量页显示 `media_units`（T-071）；每日一问「没有合适的题」专用错误码（T-091，现在用 404）；「日常照片」素材类别（⑱）；通话 55 分钟提醒维持 AI 侧计时（已裁定）。
- `packages/eslint-config/architecture.js` 第 50 行注释仍写「待架构在 ADR-0024 补记」，现已补记，运维下次顺手改注释即可。
- 发现：`product-params.ts` 里大多数 P-xx 常量没有被业务代码引用（TD-032），建议验收后统一收口。

## 需要总经理决定的事

无。

## 给其他负责人的交接

- 给项目总负责人：按 `C:\wb-dev\wb-int\docs\architecture\contracts-3.1-map.md` 依次派后端 → AI → 网页 → 安卓；迁移号 0070–0074 给后端、0075–0076 给 AI，0077–0079 预留。本次 docs 改动在 `local/trunk`，共享文件夹的 docs 待你统一同步。
- 给后端：第 3 节 B1～B21；可选 AI 端口（`CHARACTER_PERSONA_SUMMARIZER`、`GROWTH_CARD_COPYWRITER`）用 `@Optional()` 注入并写好兜底，AI 批再绑定。
- 给 AI：第 4 节 A1～A12；`CardLineService`、`PersonaUpdateSummaryService` 改为实现契约端口（`CardCopywriterPort`、`PersonaUpdateSummarizerPort`）。
- 给网页 / 安卓：第 5、6 节；`ApiFailure` 需要保留服务器返回的 `details`（分享图逐条原因，`ShareRejectedDetails`）。
- 给运维：TD-028 的 42 处 `@Suppress` 以后评审时禁止新增；`architecture.js` 注释更新。
- 给 Codex（总经理转交）：验收时按 `contracts-3.1-map.md` 核对组合根绑定（可选端口漏绑不会报错，只会一直走兜底）。
