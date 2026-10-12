# 交接说明：本机一键开聊（MiMo 模型登记 + 体验余额）

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 日期 | 2026-10-12 |

## 做了什么

- 新增可重复执行的命令 `pnpm setup:local-model`（镜像内 `node dist/setup-local-model.js`），以已有管理员为操作人走服务层：发布含 MiMo 暂定价的价目表、登记并启用 `xiaomi/mimo-v2.6-flash` 为 chat/background/vision/planner 默认模型、给每个正常状态的普通用户加 50 元（固定幂等键，写审计）、`--probe` 经模型网关做一次真实调用。说明见 `docs/backend/local-model-setup.md`。
- 暂定价：输入 2.00 / 缓存输入 2.00 / 输出 8.00 元每百万 token（售价 = 成本，参考便宜档 deepseek-flash 高峰价，未核实，后台可改）。
- 本机检查：server typecheck、相关文件 eslint / prettier 通过。按要求未写测试、未跑测试。

### 本机 Docker 部署

- 回滚标签：`weiban-app:rollback-81349f5`、`weiban-edge:rollback-81349f5`。
- 升级前 age 加密备份：`C:\wb-local\backups\20261012-233242-a9dd3359330f47d986af18472a938351`（需带 `-AgeExecutable C:\wb-tools\age-v1.3.2\age\age.exe`）。
- 用 `deploy/local/Start-Weiban.ps1` 从 `C:\wb-dev\wb-int`（local/trunk 314ca3e）构建并升级；无新迁移。应用镜像 `sha256:22c7a8aa…`。`C:\wb-local\deployment-version.txt` 已更新，旧记录另存 `deployment-history\pre-local-model-314ca3e-20261012.json`。
- 容器内 `node dist/setup-local-model.js --probe`：价目表 `local-mimo-v1` 发布（原无生效版本，共 3 条价格）；模型 `xiaomi/mimo-v2.6-flash` 登记并启用；普通用户只有 1 个：`lomjy3` +50 元；真实调用成功（约 6 秒，输入 14 / 输出 125 token，扣 1028 微元≈0.001 元），模型回复正常中文自我介绍。再运行一次：价目表跳过、目录原样更新、余额流水 ID 相同（未重复加）。两端 `/health` 200。未创建账号，未打印密钥。

## 改了哪些文件

- `apps/server/src/cli/setup-local-model.ts`（新）
- `apps/server/src/modules/identity/application/commands.ts`（新增 `listActiveRegularUsers`）
- `apps/server/src/modules/billing/index.ts`、`apps/server/src/modules/model-access/index.ts`（导出运维脚本要用的服务）
- `apps/server/scripts/build.mjs`、`apps/server/package.json`、`package.json`（构建入口与命令）
- `docs/backend/local-model-setup.md`（新）

## 遗留问题

- MiMo 价格为暂定价，需拿到官方价后在管理后台新建价目表版本。
- 模型未做人设评测，直接设为默认是本机开聊的临时做法。
- 未写测试；未在浏览器里实际和角色聊一轮（网关链路已真实调用验证，总经理可直接在网页上聊）。

## 需要总经理决定的事

无

## 给其他负责人的交接

- 给项目总负责人：语音、生图、联网搜索的默认用途未指给 MiMo（文字模型接不了这些服务），这些功能在本机仍显示「未开通」。
- 给 ai-lead：行为规划默认（planner）暂指向 MiMo，原定 qwen3.8-flash 配好后可在后台改回。
