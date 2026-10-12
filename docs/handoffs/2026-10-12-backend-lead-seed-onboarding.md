# 交接说明：预设角色种子 + 首次引导不卡死

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 日期 | 2026-10-12 |

## 做了什么

1. **预设角色种子**：新增可重复执行的 `pnpm seed:presets`（生产镜像 `node dist/seed-presets.js`），导入 9 个已上架预设角色：`docs/ai/samples` 的 6 张样本卡（程澈、温言、沈砚秋、苏乔、顾承野、陆遥川，分类照卡：原创、成年）+ 3 个日常向原创角色（林小满、周叙、陈书宜，仅日常模式）。走 `CharacterService` 的 create → runChecks → publish 正常服务层（加密、分类、事件、审计照常）。说明见 `docs/backend/preset-seed.md`。
2. **开发放行**：上架前「人设稳定 / 硬性边界」检查本需真实模型评测，种子用不调用模型的放行评测器直接记为通过；儿童特征规则层照常检测，分类不放宽；每次放行记审计 `preset.seed_check_bypassed`。
3. **网页首次引导**：「角色广场 · 先加一个你喜欢的 TA 吧」下方新增「自己创建一个角色」（结束引导并进入 `/characters/custom/new`）和「先随便看看」（结束引导进入 `/chat`），附提示「之后也可以在通讯录 → 添加角色里加 TA」。引导完成标记本来就是客户端本机标记（`ui:onboarding`），不需要服务器改动。
4. **安卓首次引导**：`RoleBrowser` 引导页同样加两个按钮；「自己创建一个角色」结束引导后打开已有的自定义角色编辑浮层，「先随便看看」结束引导进入主界面。未编译，等总经理统一打包。
5. 新增 `IdentityCommands.findAdminId`（种子取已有管理员作操作人，不建账号）、`CharacterService.presetRevision`。

本机检查：`pnpm typecheck`、`pnpm lint`、server / web 构建通过。按要求未写测试、未跑测试；安卓未编译。

### 本机 Docker 部署（2026-10-12 23:15）

- 回滚标签：`weiban-app:rollback-f5d899a`、`weiban-edge:rollback-f5d899a`。
- 升级前 age 加密备份：`C:\wb-local\backups\20261012-231155-b85fbe774edf4979b68c6d24665978e4`。（第一次在 PowerShell 里把输出重定向导致脚本中途退出，留下空目录 `20261012-231136-…`，无清单，不是有效备份，可忽略。）
- 用 `deploy/local/Start-Weiban.ps1` 从 `C:\wb-dev\wb-int`（local/trunk 80f2af0）构建并升级；无新迁移。应用镜像 `sha256:bce348f4…`。`C:\wb-local\deployment-version.txt` 已更新，旧记录另存 `deployment-history\pre-seed-presets-80f2af0-20261012.json`。
- 容器内 `node dist/seed-presets.js`：9 个全部 created 并上架；再运行一次全部 skipped（可重复执行确认）。数据库 9 行均为 `preset / published / original / adult`，儿童特征未检出。
- 以已有管理员登录调用角色广场接口 `GET /api/v1/characters`，返回 9 个角色；两端 `/health` 200；网页新脚本已含「先随便看看」。未创建账号、模型或供应商，未调用 AI。浏览器里人工点按引导页未做（总经理可直接刷新页面查看）。

## 改了哪些文件

- `apps/server/src/cli/seed-presets.ts`（新）
- `apps/server/src/cli/preset-seed/daily.ts`（新）
- `apps/server/src/cli/preset-seed/samples.generated.ts`（新，生成文件）
- `apps/server/scripts/gen-preset-samples.mjs`（新）
- `apps/server/src/modules/characters/application/preset-seed.ts`（新）
- `apps/server/src/modules/characters/application/characters.ts`、`apps/server/src/modules/characters/index.ts`
- `apps/server/src/modules/identity/application/commands.ts`
- `apps/server/scripts/build.mjs`、`apps/server/package.json`、`package.json`
- `apps/web/src/features/contacts.tsx`
- `apps/android/feature/chat/src/main/kotlin/app/weiban/feature/chat/RoleBrowser.kt`、`apps/android/app/src/main/kotlin/app/weiban/MainActivity.kt`
- `docs/backend/preset-seed.md`（新）

## 遗留问题

- 9 个角色的上架检查是开发放行，没有真实模型评测；接入模型后应由 ai-lead 对这批角色补跑评测（可按审计 `preset.seed_check_bypassed` 找出）。
- 样本卡原注明「测试样本，不上架」，本次按总经理要求在本机上架；外部正式上线前需产品 / ai-lead 决定是否保留成人测试卡为公开预设角色。
- 没有为新入口写自动化测试（e2e `onboarding.spec.ts` 未更新），交 Codex 验收时一并补。
- 安卓改动未编译。

## 需要总经理决定的事

无。

## 给其他负责人的交接

- 给 ai-lead：日常向 3 个角色卡内容在 `apps/server/src/cli/preset-seed/daily.ts`，可替换；样本卡改动后运行 `pnpm --filter @weiban/server seed:presets:gen` 重新生成。
- 给 web-lead / android-lead：引导页新增两个出口，见上文第 3、4 条；e2e / 单测待补。
- 给 devops-lead：生产镜像多了 `dist/seed-presets.js`；新部署在创建管理员之后执行一次即可。
