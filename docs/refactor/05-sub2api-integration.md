# sub2api 集成方案：上游池 + 每用户 Key 用量看板，钱仍由微伴钱包管

| 项 | 内容 |
|---|---|
| 负责人 | 架构负责人。实施分属运维、后端、AI、网页后台，见第 7 节 |
| 日期 | 2026-10-13 |
| 性质 | 只写方案，不改代码。决策记录见 `docs/decisions/ADR-0031-sub2api-gateway.md`（本文不重复方案对比的理由） |
| 材料 | ① sub2api 源码（浅克隆 `C:\wb-ref\sub2api`，只读）：`README_CN.md`、`deploy/docker-compose.local.yml`、`deploy/config.example.yaml`、`docs/legal/admin-compliance.zh.md`、`backend/internal/server/routes/{admin,gateway,user,auth}.go`、`server/middleware/{admin_auth,api_key_auth,admin_compliance}.go`、`handler/api_key_handler.go`、`handler/admin/user_handler.go`、`service/billing_cache_service.go`、`service/openai_gateway_chat_completions_raw.go`；② 新版 `apps/server/src/modules/model-access`（`application/gateway.ts`、`infra/text-adapter.ts`、`infra/media-adapter.ts`）、`modules/billing`；③ `docs/ai/model-catalog.md`、`docs/backend/{model-access,billing,local-model-setup}.md`、ADR-0008 / 0012；④ `docs/ops/hk-server.md` 与 2026-10-13 服务器实测（`free`、`docker stats`、`ss`） |

术语：

- **sub2api**：一个开源「AI 接口中转站」程序。它手里握着上游的真实密钥，给下游发自己的 Key；下游拿它的 Key 调用，它负责转发、记账、限流、在多个上游账号之间挑一个。
- **上游 / 上游账号**：真正提供模型的供应商（MiMo、DeepSeek、百炼……）以及我们在那里的一把密钥。sub2api 里叫「账号」，若干账号组成一个「分组」。
- **Key**：sub2api 发给下游的通行证，形如 `sk-...`。谁带着它调用，用量就记在谁名下。
- **网关**：微伴后端 `model-access` 里调用模型的唯一出口，负责选模型、冻结余额、调用、重试、结算。
- **冻结 / 结算**：调用前先按估算冻结一笔余额，调用后按实际用量多退少补，失败全额退回（ADR-0012）。

---

## 0. 先看结论

1. **推荐方案 A**：在香港服务器上、微伴旁边部署 sub2api，只让它做三件事——**管上游密钥和多账号切换、给每个用户一把 Key、出用量 / 成本看板**。**扣用户的钱、余额、充值、注册赠送、邀请、透支、后台每日上限全部不变，仍由微伴钱包管**。sub2api 那边给每个用户预置一个永远用不完的余额，Key 不限额，它永远不拦请求。
2. **总经理以后怎么配置**：加上游、换密钥、看哪个上游挂了 → sub2api 后台；上架模型、定价 → 微伴后台一页「添加模型」向导（下拉框直接列出 sub2api 里有的模型，价格在同页填）；看每个用户用了多少 → sub2api 后台「用户 / 使用记录」，或微伴后台现有的用量页。
3. **用户完全无感**：用户不知道 sub2api 存在，Key 不下发到手机或网页，只在服务器内部使用。
4. **语音、百炼生图、联网搜索不经过 sub2api**（它没有标准语音接口），继续直连；聊天、后台任务、识图经过 sub2api。
5. **思考开关、空输出降级等「怎么调模型」的规则留在微伴网关**；sub2api 只决定「这一单交给哪个上游账号」。
6. **只接正规 API Key**，绝不在 sub2api 里接 Claude / ChatGPT 等订阅账号（违反上游条款，被封的是整个平台）。
7. 工作量约 **9～11 人天**，先做 **1 天验证**再动工（第 6、7 节）。
8. 需要总经理：确认方向；在 sub2api 后台**亲自**点一次合规承诺、亲自录入 MiMo 密钥（第 9 节）。

---

## 1. sub2api 能做什么、不能做什么（与本方案相关的部分）

| 问题 | 答案（源码核实） | 对方案的影响 |
|---|---|---|
| 管理员 API | 有。后台「系统设置」生成管理员 API Key，请求头 `x-api-key` 调 `/api/v1/admin/*`：建用户、改余额、查某用户用量（按月 / 周期）、查余额历史、列某用户的 Key、批量查多用户 / 多 Key 用量、使用明细、仪表盘排行 | 微伴后端用它自动开户、查状态 |
| 管理员能否替用户建 Key | **不能**。只有用户自己的 `POST /api/v1/keys`（要先 `POST /api/v1/auth/login` 拿登录令牌）；支持 `custom_key` 自定义 Key 原文 | 开户三步：管理员建用户 → 以该用户登录 → 建 Key（第 3.1 节） |
| OpenAI 兼容接口 | `/v1/chat/completions`（第三方 OpenAI 兼容上游走「原样直转」，只改模型名，流式原样透传，可带额外字段）、`/v1/models`、`/v1/embeddings`、`/v1/images/generations` | 微伴文本适配器只需把地址换成 sub2api |
| 语音 | 只有 Grok 平台的 `/v1/tts`、`/v1/stt`；**没有** `/v1/audio/speech`、`/v1/audio/transcriptions` | 语音不经过 sub2api |
| 上游类型 | OpenAI、Anthropic、Gemini、DeepSeek、Kimi、智谱、MiniMax 等；OpenAI 类 API Key 账号可填自定义 `base_url`（MiMo、百炼兼容模式、OpenRouter 都按此接） | 覆盖微伴现有和候选上游 |
| 计费模型 | 每个用户一个余额（美元，无币种设置），每次调用按渠道价 × 分组倍率扣；**余额 ≤ 0 直接 403 `INSUFFICIENT_BALANCE`**；没有冻结、没有透支 | 不适合当微伴的计费权威（ADR-0031 方案 B 的问题） |
| 能否「无限额度」 | Key 的 `quota=0` = Key 不限额；但用户余额必须 > 0。另有 `RUN_MODE=simple` 完全跳过计费，但隐藏 SaaS 功能（用户管理等），看板可能缺成本 | 方案用**标准模式 + 每用户预置大额余额**（验证时对比 simple 模式，见第 6 节） |
| 其他可用能力 | 用户级 / 账号级并发、RPM 限制；粘性调度；多账号故障切换；组合分组路由；内置支付、兑换码、邀请码（本方案**不用**） | 并发限制可作为防失控的第二道闸 |
| 合规 | 管理后台首次使用须确认《部署与运营合规承诺》，未确认前管理员 API 返回 423；README 声明「从未授权任何商业化运营」 | 总经理亲自确认一次；对外收费前需重新评估 |
| 安全 | 管理员登录支持 2FA；上游凭据以 JSON 存它自己的数据库，**未见静态加密**（待验证确认） | 不对公网开放；备份加密 |
| 资源 | 一个 Go 程序 + PostgreSQL 15+ + Redis 7+ | 第 4 节 |

---

## 2. 整体数据流

```
手机 / 网页 ──(微伴接口)──> 微伴 app
                              │ model-access 网关：选模型 → 成人闸门 → 冻结钱包 → 调用 → 思考关闭 / 重试 / 空输出降级 → 结算 → 用量记录
                              │
            ┌─────────────────┼──────────────────────────┐
            │ 聊天 / 后台 / 识图 │                          │ 语音合成、语音识别、百炼生图、联网搜索
            ▼                 │                          ▼
   sub2api（容器内网 http://sub2api:8080/v1）          百炼 / 博查（直连，与现在相同）
     认 Key → 记在该用户名下 → 选上游账号 → 转发
            │
            ▼
   MiMo / DeepSeek / 百炼兼容模式 / OpenRouter（正规 API Key）
```

两本账各管一件事：

| 账 | 记什么 | 单位 | 用途 |
|---|---|---|---|
| 微伴钱包（`billing`） | 向用户收的钱（售价） | 人民币微元 | 余额、充值、赠送、扣费、后台上限、透支——**唯一计费权威** |
| sub2api 使用记录 | 向上游花的钱（成本）、token、上游账号、延迟 | 「1 美元单位 = 1 元」录入（第 3.5 节） | 看板、每用户用量、对账第 ③ 层的成本来源 |

---

## 3. 详细设计

### 3.1 注册时自动开通 sub2api 用户与 Key

归属：`model-access`（它拥有上游与密钥，ADR-0012 第 1 条）。不放 `identity`、不放 `billing`。

1. 订阅 `identity.user_registered`，投递一个可重试任务 `model-access.provision_gateway_key`（注册本身不等它，失败不影响注册）。
2. 任务步骤（全部幂等，可重复执行）：
   1. 生成随机 sub2api 登录邮箱 `wb-{用户ID哈希前 16 位}@users.weiban.invalid` 和 32 字节随机密码；
   2. 管理员 API `POST /api/v1/admin/users`：`balance=1000000`、`concurrency` 与 `rpm_limit` 用保守默认（如 5 / 60）、`allowed_groups=[微伴默认分组]`、`notes=微伴用户 {用户ID}`；已存在则读回；
   3. `POST /api/v1/auth/login` 以该用户登录，拿到登录令牌；
   4. 微伴生成 Key 原文（`sk-wb-` + 32 字节随机），`POST /api/v1/keys`：`name=weiban`、`group_id=默认分组`、`custom_key=该原文`、`quota=0`；
   5. 写入 `model_access.gateway_keys`：用户 ID、sub2api 用户 ID、Key ID、Key 密文（平台数据密钥信封加密，AAD = `gateway-key:{用户ID}`）、显示掩码、状态 `active`、开通时间。登录密码**不保存**（以后要重建 Key 时用管理员 API 重置密码再登录）。
3. 已有用户：上线时跑一次补开通脚本（只有 2 个用户；sub2api 登录接口限 20 次 / 分钟，脚本按每分钟 10 个节流）。
4. 用户注销：加入 `model-access` 删除清单——管理员 API 停用并删除该 sub2api 用户，删除本地密文行。sub2api 的使用记录不含聊天内容，按它自己的清理任务保留。
5. 前置配置：sub2api 关闭公开注册、关闭登录验证码与邮箱验证（它不对公网开放，登录接口只有微伴在用）；**不要开「后端模式」**（该模式会禁止普通用户登录，开户第 3 步会失败）。

安全：Key 只在网关发请求的瞬间解密；任何接口、日志、审计、错误信息都不出现 Key 原文或密文；客户端拿不到。

### 3.2 网关调用时带哪个 Key

上游登记保持「一个上游 = 地址 + 平台 Key」，新增上游类型 `sub2api`（CR-31-1）。网关在 `withApiKey` 处按下表选 Key：

| 调用 | 带的 Key | 说明 |
|---|---|---|
| `billingOwner=user`（聊天、主动消息、推演、朋友圈、记忆整理、安全检查、识图、导入分析……） | 该用户的 Key | 后台任务也算在该用户名下，sub2api 里看到的就是「这个用户一共花了多少」 |
| `billingOwner=platform`（`admin_*` 管理员任务） | 平台 Key（sub2api 里一个名为 `weiban-platform` 的用户） | 与 ADR-0008 一致 |
| 用户 Key 还没开通好 / 已失效 | 「未归属」Key（`weiban-unassigned` 用户）+ 告警日志 + 重新投递开通任务 | 聊天不因开通失败中断；钱仍扣该用户钱包，只是 sub2api 里暂时没算到他名下 |

错误映射（新增）：sub2api 返回 401（Key 无效）→ 标记该用户 Key 失效、改用未归属 Key 重试一次、投递重建任务；返回 403 `INSUFFICIENT_BALANCE` → 视为**平台配置故障**（预置余额用完），按 `provider_unavailable` 处理并通知管理员，不算用户余额不足；其余沿用现有分类（429 → `rate_limited`，5xx → 可重试）。上游状态（`upstream_status`）记的是「sub2api 这个整体」，单个上游账号的健康在 sub2api 后台看。

### 3.3 思考开关、空输出降级、重试放在哪层

**全部留在微伴网关**，sub2api 不做任何业务判断。理由：这些规则依赖「用途」（聊天不换模型、后台可以换），只有微伴知道（`gateway.ts` 中 `FALLBACK_PURPOSES`、MDL-04）。

| 规则 | 位置 | 要改什么 |
|---|---|---|
| 思考关闭字段（`thinking:{type:disabled}` / `enable_thinking:false` / `reasoning:{enabled:false}`） | 微伴文本适配器 | 现在按**上游地址**判断（`thinkingControlFor`），经 sub2api 后地址都是 sub2api，判断失效。改为：目录条目登记 `thinkingControl`（CR-31-2），未登记时退回按上游模型名判断；新增 MiMo 的写法（验证时确认字段名）。sub2api 直转路径会原样带上这些字段 |
| 剥离思考标签 `stripReasoning` | 微伴文本适配器 | 不变 |
| 空输出 / 截断：同模型重试 1 次（输出额度 ×1.5）→ 后台类换平台默认后台模型 | 微伴网关 | 不变 |
| 网络 / 5xx 重试 2/5/15 秒 | 微伴网关 | 不变。sub2api 内部还会在同分组的多个上游账号之间切换，两层叠加不会多扣用户钱（微伴每次调用只结算一次），但上游可能多收：保持每组账号数少、微伴总重试次数不变 |
| 超时、截止时间 | 微伴网关 | 不变；sub2api 的上游超时设得比微伴单次超时（20 秒）略长，避免它先断 |
| 冻结 / 结算 / 解冻、后台每日上限、透支 | 微伴 billing | 不变 |
| 流式输出（语音通话方案 04 要的「流式文字生成」） | 微伴网关 | sub2api 直转路径原样透传 SSE，不影响 04 的设计 |

### 3.4 非聊天接口怎么走

| 能力 | 走法 | 理由 |
|---|---|---|
| 识图 | 经 sub2api（就是带图片的聊天请求） | 与聊天相同 |
| 语音合成 / 识别、通话中的流式听写与合成 | `media-gateway` 直连百炼（`dashscope` 类型上游），**不变** | sub2api 无标准语音接口 |
| 百炼生图（万相） | 直连，不变 | 百炼专用接口，不是 OpenAI 格式 |
| 将来若用 OpenAI 格式生图上游 | 可经 sub2api `/v1/images/generations` | 届时再评估 |
| 联网搜索（博查） | 直连，不变 | 不是模型调用 |
| 向量（本地小模型） | 不变 | 不经过任何上游 |

这些直连调用照旧扣微伴钱包、记 `usage_records`；只是不出现在 sub2api 看板里。微伴后台用量页仍是「全部花费」的完整视图，sub2api 看板是「文本模型」的视图。

### 3.5 价格怎么定、两边怎么对账

- **售价**：仍在微伴价目表（唯一定义处：`docs/ai/model-catalog.md` 第 4 节 + 后台价目表版本）。
- **成本价**：在 sub2api「渠道 → 模型定价」录入，**数值按人民币填**（例：MiMo 输入 2.00、输出 8.00 元 / 百万 token，就填 2.00 / 8.00），看板上的「$」一律读作「元」。分组倍率设 1。这样 sub2api 每用户花费与微伴扣费在加价系数 1.00 时应基本一致，一眼能看出偏差。sub2api 自动拉取的官方美元价目只作参考，以我们录入的为准。
- **对账**：保留 ADR-0012 三层。第 ③ 层的「上游实际成本」原来靠管理员手工录入上游账单，现在可以先拿 sub2api 的成本汇总当参考（后续可加「按日拉取 sub2api 成本汇总」的定时任务，不在本期）。逐笔核对时用微伴 `usage_records` 的时间、用户、模型、token 与 sub2api 使用记录匹配（本期不强制逐笔）。
- **预置余额**：每个 sub2api 用户 `1000000`，运维每月看一次「余额最低的用户」，低于 `100000` 时用管理员 API 批量补齐。这个数字没有真实意义。

### 3.6 微伴后台要怎么变简单（回应「模型目录难懂」）

| 现在 | 以后 |
|---|---|
| 「上游」页：录入地址 + 密钥 + 连通测试 | 上游密钥、多账号、分组全部在 sub2api 后台配。微伴「上游」页只剩一条 `sub2api` 记录，平时不用碰 |
| 「模型目录」页：手填模型键、上游、上游模型名、能力、默认用途 | 一页「添加模型」向导：下拉框列出 sub2api `/v1/models` 返回的模型（用平台 Key 拉取）→ 填显示名、厂商（预填）、是否识图、默认给谁用 → **同页填售价**，保存时后端自动生成并发布新价目表版本 |
| 「价目表」页：建草稿、填价、发布 | 保留给高级操作（分时价、历史版本），日常不用进 |
| 看每个用户用量：微伴用量页 | 微伴用量页不变；每个用户行加一个「Key 状态」（已开通 / 未开通 / 失效）和「在 sub2api 中查看」提示（不做跳转链接，因为 sub2api 后台只能经隧道访问） |

---

## 4. 部署（香港服务器 103.231.58.124）

现状（2026-10-13 实测）：4 核、内存 7.9 GB（已用约 1.2 GB，可用约 6.7 GB）、磁盘 50 GB 已用 7.5 GB；微伴三个容器合计约 220 MB；对外只放行 22 / 80；微伴后台 127.0.0.1:8081。

| 项 | 规划 |
|---|---|
| 形态 | 独立 Compose 项目 `sub2api`，目录 `/srv/sub2api`，用官方 `docker-compose.local.yml`（本地目录存数据，便于备份迁移）；**独立的 PostgreSQL 与 Redis**，不与微伴共用数据库（数据域分开） |
| 镜像 | `weishaw/sub2api` **固定版本号**（不用 `latest`）；`postgres:18-alpine`、`redis:8-alpine` 同样固定；不使用后台「在线升级」按钮，升级走运维流程 |
| 资源上限 | sub2api 512 MB、它的 PostgreSQL 512 MB、Redis 128 MB（`maxmemory 96mb`）；合计预计实际占用 0.4～0.8 GB，CPU 平时 < 5%。剩余内存仍有约 5.5 GB |
| 端口 | 宿主机 `127.0.0.1:8090 → 8080`（`BIND_HOST=127.0.0.1`、`SERVER_PORT=8090`），**不对公网开放**，ufw 不改 |
| 微伴怎么连 | 新建 Docker 网络 `weiban-llm`（internal），微伴 app 与 sub2api 都加入；微伴上游地址 `http://sub2api:8080/v1`。sub2api 另在自己的默认网络出公网访问上游。微伴 app 的 compose 覆盖文件加一个网络 |
| 管理后台访问 | 与微伴后台相同，SSH 隧道：`ssh -i ~/.ssh/weiban_deploy -N -L 9090:127.0.0.1:8090 root@103.231.58.124`，浏览器开 `http://localhost:9090`；管理员开 2FA |
| 配置要点 | `RUN_MODE=standard`；`JWT_SECRET`、`TOTP_ENCRYPTION_KEY`、`POSTGRES_PASSWORD` 用 `openssl rand -hex 32` 生成存服务器 `.env`（权限 600），并按现有密钥管理规则登记；`ADMIN_EMAIL` 不用可猜的值；关闭公开注册、验证码、邮箱验证；不开后端模式；关闭「提示词审计」等会保存请求内容的功能（隐私：sub2api 不应保存聊天内容）；上游 URL 白名单只放行用到的供应商域名 |
| 备份 | 每日备份脚本增加 sub2api 的 `pg_dump`，与微伴备份一起 age 加密（里面有上游密钥）；恢复演练一次 |
| 监控 | 健康检查 `GET /health`（以实际镜像为准）；容器 `restart: unless-stopped`；告警：sub2api 不可用、任一用户预置余额 < 100000、上游账号被禁用 |
| 顺带发现（交运维） | 服务器上宝塔面板 `BT-Panel` 监听 `0.0.0.0:11823`；ufw 只放行 22/80 时外网应访问不到，但建议运维确认并考虑关闭或改为只听 127.0.0.1 |

---

## 5. 契约变更（架构已评估，随实施由架构写入 `packages/contracts`）

| 编号 | 内容 | 影响 |
|---|---|---|
| CR-31-1 | `UpstreamKind` 新增 `sub2api`：语义 = OpenAI 兼容，且按用户选 Key；连通测试同 OpenAI 兼容（`GET /models`） | `model-access` 上游登记、网关；管理后台上游类型下拉 |
| CR-31-2 | `AdminCatalogEntry` 新增可选 `thinkingControl: 'deepseek' \| 'qwen' \| 'openrouter' \| 'mimo' \| 'none'`（不填 = 按上游模型名推断） | 目录读写、文本适配器、后台向导 |
| CR-31-3 | 新增管理端接口：`GET /admin/model/gateway-keys?userId=`（只返回状态、掩码、开通时间、sub2api 用户 ID，**不返回 Key**）、`POST /admin/model/gateway-keys/:userId/reprovision`（重建）；`GET /admin/model/upstreams/:id/models`（代平台 Key 拉取 sub2api 模型列表，供向导下拉） | `model-access` 控制器；管理后台 |

不改：`ModelGatewayPort`、`BillingReservationPort`、钱包与价目表接口、任何客户端接口。新表 `model_access.gateway_keys` 只属于 `model-access`，其他模块不得读写。

---

## 6. 动工前的 1 天验证（运维 + 后端，任何一项不成立就停下汇报）

1. 本机 Docker 起 sub2api（固定版本），确认资源占用与健康检查地址。
2. 添加 MiMo 为 OpenAI 类 API Key 账号（自定义 `base_url`），经 sub2api `/v1/chat/completions` 非流式、流式各调一次，确认走「原样直转」、返回 `usage`、额外字段（思考关闭）被透传、MiMo 识图可用。
3. 用管理员 API Key 跑通开户三步（建用户 → 登录 → `custom_key` 建 Key），确认无验证码 / 邮箱验证拦截；重复执行幂等。
4. 用该 Key 调用后，管理员 API 能按用户查到用量与成本；成本按我们录入的渠道价计算。
5. 标准模式下预置余额扣减正常、不触发 403；对比 `RUN_MODE=simple` 下看板是否仍有成本数据，确认选标准模式。
6. 确认上游凭据是否静态加密；确认提示词审计等内容留存功能默认关闭。
7. 记录 sub2api 一次转发增加的延迟（预期毫秒级）。

---

## 7. 实施步骤与工作量

| 步骤 | 负责人 | 内容 | 人天 |
|---|---|---|---|
| 0 | 运维 + 后端 | 第 6 节验证，写验证结论到交接说明 | 1 |
| 1 | 架构 | CR-31-1～3 写入契约，发版本号 | 0.5 |
| 2 | 运维 | 香港服务器部署 sub2api（第 4 节）、`weiban-llm` 网络、备份与恢复演练、告警、隧道说明写进 `docs/ops/hk-server.md`；本机部署同样加一份 | 1～1.5 |
| 3 | 后端 | sub2api 管理员客户端（建用户、改余额、重置密码、登录、建 Key、删除用户）；`gateway_keys` 表与迁移；开通任务、补开通脚本、删除清单；网关按表 3.2 选 Key 与错误映射；CR-31-3 接口；测试 | 3～4 |
| 4 | AI | 思考开关改按目录 / 模型名（含 MiMo 字段）；复核重试与 sub2api 故障切换叠加；更新 `docs/ai/model-catalog.md` 第 1 节「上游」为「经 sub2api 接入」、补成本价录入说明 | 1～1.5 |
| 5 | 网页后台 | 「添加模型」向导（模型下拉、同页售价、自动发布价目表版本）；上游类型 `sub2api`；用量页「Key 状态」列与重建按钮 | 2 |
| 6 | 运维 + 后端 | 迁移 MiMo（第 8 节），观察一周后下线直连上游 | 0.5 |
| 合计 | | | **9～11** |

顺序：0 → 1 → (2、3、4、5 并行) → 6。

---

## 8. 迁移现有 MiMo 配置

目标：零停机、可一键回退。

1. **总经理**经隧道登录 sub2api 后台：确认合规承诺、开 2FA、生成管理员 API Key（交运维存服务器密钥文件）；新建分组「微伴默认」；添加账号「MiMo」：OpenAI 类型、API Key 方式、`base_url` 按 MiMo 文档、**亲自粘贴 MiMo 密钥**（不从微伴数据库解密导出，避免明文在服务器上流转）；渠道定价录入 `mimo-v2.6-flash` 成本价 2.00 / 2.00 / 8.00（元，见 `docs/backend/local-model-setup.md` 第 2 节暂定价）。
2. 运维在 sub2api 建 `weiban-platform`、`weiban-unassigned` 两个用户与 Key；后端补开通脚本给现有 2 个用户开户。
3. 微伴后台新增上游「sub2api」（类型 `sub2api`、地址 `http://sub2api:8080/v1`、平台 Key），连通测试通过。
4. 修改目录条目 `xiaomi/mimo-v2.6-flash`：上游改为「sub2api」，上游模型名不变，`thinkingControl` 填验证结论；**不改模型键、不改价目表**，用户选择与历史用量不受影响。
5. 聊一句、跑一次 `setup-local-model --probe`，在 sub2api 后台确认这条调用记在对应用户名下、成本正确。
6. 原「mimo」直连上游保留一周不删：出问题时把目录条目的上游改回「mimo」即回退（一次后台操作）。一周无异常后删除直连上游，MiMo 密钥只留在 sub2api。
7. 以后新增 DeepSeek、百炼兼容模式、OpenRouter：都在 sub2api 加账号 → 微伴向导上架，不再在微伴录入上游密钥。百炼的语音 / 生图仍是微伴里的 `dashscope` 上游，不迁。

---

## 9. 需要总经理决定 / 亲自做的事

1. **确认采用方案 A**（sub2api 只管上游和看板，钱仍在微伴钱包）。如更想要 B 或 C，请告知，本文按 ADR-0031 的对比重新安排。
2. 在 sub2api 后台**亲自确认**一次《部署与运营合规承诺》（这是一份承诺协议，必须由您本人阅读后点确认，代理不能代点）。
3. **亲自录入** MiMo 等上游密钥到 sub2api（第 8 节第 1 步）。
4. 认可规则「sub2api 只接正规按量付费的 API Key，不接 Claude / ChatGPT 等订阅账号」。
