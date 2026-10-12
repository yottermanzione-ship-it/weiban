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

（部署后补记）

## 改了哪些文件

- `apps/server/src/cli/setup-local-model.ts`（新）
- `apps/server/src/modules/identity/application/commands.ts`（新增 `listActiveRegularUsers`）
- `apps/server/src/modules/billing/index.ts`、`apps/server/src/modules/model-access/index.ts`（导出运维脚本要用的服务）
- `apps/server/scripts/build.mjs`、`apps/server/package.json`、`package.json`（构建入口与命令）
- `docs/backend/local-model-setup.md`（新）

## 遗留问题

- MiMo 价格为暂定价，需拿到官方价后在管理后台新建价目表版本。
- 模型未做人设评测，直接设为默认是本机开聊的临时做法。
- 未写测试。

## 需要总经理决定的事

无

## 给其他负责人的交接

- 给项目总负责人：语音、生图、联网搜索的默认用途未指给 MiMo（文字模型接不了这些服务），这些功能在本机仍显示「未开通」。
- 给 ai-lead：行为规划默认（planner）暂指向 MiMo，原定 qwen3.8-flash 配好后可在后台改回。
