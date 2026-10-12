# 本机一键开聊（setup:local-model）

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 日期 | 2026-10-12 |
| 代码 | `apps/server/src/cli/setup-local-model.ts` |

## 1. 做什么

本机部署上让总经理能马上和角色聊天。前提：管理后台已录入名为 `mimo` 的上游（OpenAI 兼容，密钥已加密存储）。可重复执行，已做过的步骤跳过或原样更新。以已有管理员为操作人，全部走服务层（与管理后台同一路径，有审计），不手写 SQL、不创建账号、不打印密钥。

| 步骤 | 走的服务 | 结果 |
|---|---|---|
| 价目表 | `PriceService.createDraft / updateDraft / activate` | 当前生效版本没有 MiMo 价格时：复制其全部价格并加上 MiMo 暂定价，发布为新版本 `local-mimo-v1`（旧版本自动停用）；已有则跳过 |
| 模型目录 | `CatalogService.upsert` | 登记或更新 `xiaomi/mimo-v2.6-flash`：上游模型名 `mimo-v2.6-flash`，显示名「MiMo V2.6 Flash」，厂商「小米」，能力 `vision`（文字聊天无需单独能力），启用，默认用途 `chat`、`background`、`vision`、`planner` |
| 余额 | `BillingAdminService.adjust` | 每个正常状态的普通用户（非管理员）加 50 元，原因「本机部署开聊：初始体验余额 50 元」，固定幂等键 `local-setup-grant-50-v1`，重复执行只加一次 |
| 真实调用（`--probe`） | 模型网关 `generateText` | 以第一个普通用户、用途 `chat_reply` 发一句测试消息（最多 200 输出 token，从该用户余额扣，极少）；失败时用已存的密钥直连上游 `/chat/completions` 打印原始错误（不含密钥） |

默认用途没有填 `speech_synthesis`、`speech_recognition`、`image_generation`、`web_search`：这几项是语音、生图、联网搜索服务，网关会按对应接口调用，文字模型接不了，标上反而会让这些功能报错；`adult_check` 按要求不填，模型也不标 `adult_content`。

## 2. 暂定价

售价 = 成本，取 `docs/ai/model-catalog.md` 4.1 便宜档 `deepseek/deepseek-flash` 高峰价：输入 2.00、缓存输入 2.00（不假设缓存折扣）、输出 8.00 元 / 百万 token。**未核实**，拿到小米官方价后在管理后台新建价目表版本修改即可。

## 3. 怎么运行

```bash
pnpm setup:local-model -- --probe                      # 开发（读本机 .env）
node dist/setup-local-model.js [--admin 用户名] [--probe] # 生产镜像
```

本机 Docker 部署：

```powershell
docker exec weiban-local-app-1 node dist/setup-local-model.js --probe
```

退出码：0 成功；1 设置失败（如找不到上游 / 管理员）；3 真实调用失败（已打印上游原始响应）。
