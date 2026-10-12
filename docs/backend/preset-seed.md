# 预设角色种子

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 日期 | 2026-10-12 |
| 代码 | `apps/server/src/cli/seed-presets.ts`、`apps/server/src/modules/characters/application/preset-seed.ts` |

## 1. 做什么

把一批预设角色导入并上架，让新用户首次引导的「角色广场」有角色可加。可重复执行：同名预设角色已上架（或已被管理员下架、停用）就跳过；存在但还没上架就继续检查和发布。

导入内容：

| 来源 | 角色 |
|---|---|
| `docs/ai/samples/S-01～S-06`（成人模式测试样本卡，分类照卡：原创、成年） | 程澈、温言、沈砚秋、苏乔、顾承野、陆遥川 |
| `apps/server/src/cli/preset-seed/daily.ts`（日常向原创，仅日常模式） | 林小满、周叙、陈书宜 |

样本卡唯一来源仍是 `docs/ai/samples`。生产镜像里没有 docs，所以由 `apps/server/scripts/gen-preset-samples.mjs` 抽出每张卡的 json 代码块生成 `src/cli/preset-seed/samples.generated.ts`（请勿手改）；样本卡变了就在 `apps/server` 下运行 `pnpm seed:presets:gen` 重新生成。

## 2. 怎么运行

需要已有一个管理员账号（种子不创建账号），默认用最早创建的管理员，也可用 `--admin <用户名>` 指定。

```bash
pnpm seed:presets                          # 开发（读本机 .env）
node dist/seed-presets.js [--admin 用户名]   # 生产镜像 / 本机 Docker 部署容器内
```

本机 Docker 部署：

```powershell
docker exec weiban-local-app-1 node dist/seed-presets.js
```

每行输出一个角色：`created`（新建并上架）、`published`（已存在的草稿补上架）、`skipped`（已存在）、`failed`（附原因）。有失败时退出码 2。

## 3. 走的路径与开发放行

与管理后台同一服务层：`CharacterService.create`（平台密钥加密、分类入库、分类不变式）→ `runChecks` → `publish`（发布事件、人设版本、分类事件、审计）。

唯一的开发放行：上架前的「人设稳定 / 硬性边界」检查本应调用真实模型评测，种子改用不调用模型的放行评测器（`SeedApprovalEvaluator`），直接记为通过。儿童特征规则层检测照常执行；分类字段照卡片写，不放宽。每次放行另记审计 `preset.seed_check_bypassed`（details 含 revision、来源、`reason: dev_seed`），方便日后识别并补真实评测。

头像：样本卡的 `avatar.text` 转为默认头像字（`avatarPattern = none`，应援色留空由客户端按 ID 取色）。生日：样本卡只写 `MM-DD` 时，按 `profileExtra.ageDisplay` 推出年份补成完整日期。
