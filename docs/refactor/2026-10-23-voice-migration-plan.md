# 旧模型上游与语音配置安全迁移准备（2026-10-23）

## 1. 结论与本次执行边界

**可以设计成无需用户再次手填 API Key，但不能把“已准备方案”说成“账号已迁移/语音已可用”。** 旧服务器能在本机使用既有密钥解密、账号归属及用途获授权、目标服务可安全接收时，可由机器直接加密交接；长期 Key 不经过聊天、浏览器表单、本地工作站或日志。账号本身不转移所有权，不复制登录密码、会话 cookie、充值/账单私人记录。

本轮只新增本报告；旧源码只读，不执行旧模块、不读取秘密值、不连接服务器、不复制 SQLite、不调用供应商（包括所谓免费试用）、不改生产库、不部署、不构建 APK。已有线上数据事实引用 [10-22 研究](./2026-10-22-voice-provider-integration.md#3-旧服务器配置实况)，不是本轮重新查询结果。迁移导出器、导入器、账号权限及新 KEK 可用性尚未实测；下文执行步骤均为后续受控运维方案，**本轮不执行**。

- 工作树核验：`codex/stickers-voice-20261023`，HEAD `d4ea97ee4393803b22e94ca6a0458e5270b2a23e`；开始时已有未跟踪任务卡，未改动该文件。
- 遵循 [任务卡](../tasks/2026-10-23-stickers-voice-ecology.md)；不改另一 Agent 负责的 admin、model、model-access 或契约。
- 可迁对象：已授权平台供应商连接配置、本人所有/明确授权的凭据、公开系统音色配置；先停用导入，验证后逐项开通。
- 不可自动迁对象：旧 753 条克隆绑定、私人用户数据、明星/真人声音样本、旧角色私有图库及历史聊天。`ready` 不是授权，也不是跨模型兼容证明。

## 2. 已实读证据与关键发现

| 源码证据 | 对迁移的影响 |
|---|---|
| [旧端点存储:144–238](<C:/wb-ref/old-weiban/server/lib/model/endpoint_store.js#L144-L238>) | 构造 store 即调用秘密迁移函数；绑定 provider 时取 provider 的 vendor/base_url/api_key，而非端点行。**不能在只读审计/导出里直接实例化 store。** |
| [旧供应商存储:31–78](<C:/wb-ref/old-weiban/server/lib/model/provider_store.js#L31-L78>) | 构造函数会迁移/重封装，后台列表也先解密再抹除字段；不能靠“后台列表会脱敏”保证内部过程无泄漏。 |
| [旧密钥封装:100–239](<C:/wb-ref/old-weiban/server/lib/secret_vault.js#L100-L239>) | `wbenc:v1`、AES-256-GCM；旧 keyring 可来自环境或外部文件，AAD 分别绑定 `env:{name}`、`ai_provider:{id}:api_key`、`ai_endpoint:{id}:api_key`，另加固定前缀。不得导出旧主密钥。 |
| [旧建表:1124–1238](<C:/wb-ref/old-weiban/server/lib/migrations_registry.js#L1124-L1238>)、[场景路由:2870–2885](<C:/wb-ref/old-weiban/server/lib/migrations_registry.js#L2870-L2885>) | 供应商、端点、逻辑路由为不同层；路由只允许五个文本/视觉逻辑场景，故“voice/call 路由没有行”不证明没有语音配置。 |
| [旧模型路由:58–165](<C:/wb-ref/old-weiban/server/lib/model/model_router.js#L58-L165>) | 数据库之外仍有 env 主备与专用→通用 Key 回退；不能只迁端点表，也不能把通用 Key 拓展为所有新用途。 |
| [新上游/目录/路由:61–213](../../apps/server/src/modules/model-access/infra/db/schema.ts#L61-L213) | 新平台分 upstream、model_catalog、model_routes；一条 route 的启用不等于模型与账号都启用，主路由镜像也须同步。 |
| [新信封加密:1–15](../../apps/server/src/platform/crypto/envelope.ts#L1-L15)、[seal/open:99–116](../../apps/server/src/platform/crypto/envelope.ts#L99-L116) | 新平台 DEK 由新 KEK 包装；业务密文使用 `PLATFORM_KEY_OWNER` 与 `upstream:{新UUID}`，不能复制旧密文/旧 kid/旧 AAD。 |
| [新媒体适配器:70–83](../../apps/server/src/modules/model-access/infra/media-adapter.ts#L70-L83)、[音色读取:53–60](../../packages/contracts/src/ports/media.ts#L53-L60) | 当前媒体接口没有真实分模态 token usage；音色接口没有账号/区域/目标模型/授权生命周期。保存 Key 不会补齐这些能力。 |

本机参考副本不证明远端源码/库版本逐字一致。后续远端只读预检须比较表结构和能力，不从旧源码注释猜当前生产行数。

## 3. 字段映射及白名单

### 3.1 非秘密元数据：可用于审批清单，不输出原始对象

迁移清单使用 `batchId`、来源对象引用、目标映射、用途、协议、区域、审批依据、状态和原因码。标签/备注/URL 均可能夹带秘密，先校验再生成安全别名；不把旧 label、name、note、异常原文原样写日志。

| 来源字段/语义 | 目标字段/处理 | 安全或兼容门禁 |
|---|---|---|
| `ai_providers.id/name/vendor/base_url/enabled/sort_order` | 新 `upstreams.id/name/provider/kind/baseUrl/enabled/priority` | 新 UUID；映射表独立保存。vendor 是协议线索，不直接当 kind 枚举；默认 `enabled=false`。sort_order 仅保留相对顺序，经语义转换，不原值硬塞 priority。 |
| 有效 `provider_id` 的端点 | 复用对应新上游，再建目录及路由 | 严格复制有效连接来源；provider 禁用则下游不得启用。孤立非空 provider_id 进入待核清单，不静默回退到端点遗留 Key。 |
| 无 `provider_id` 的独立端点 | 建独立 upstream | 同账号多协议/URL可分上游；只在内存按账号+区域+协议+端点判断合并，不仅按厂商名合并。 |
| `ai_endpoints.id/scene/model/label/models_json` | `model_catalog.modelKey/upstreamModelId/scenarios/displayName` 与 `model_routes` | modelKey 独立生成；模型原名保留，模型池逐个校验、展开；scene 逐项映射，不能把旧 voice_clone 直接当新已有契约。 |
| `capabilities_json/vision_direct` | 审核后的 capabilities、systemMessageMode、billingBounds | 只接收结构化子字段；旧声明不是供应商证明。supports_system 的 false 不足以唯一决定新系统消息模式，未知待核。 |
| 端点 enabled、场景内排序 | 候选模型/route 的停用状态和优先级 | 旧启用不自动新启用。维护源→目标路由顺序；不导入旧故障计数、cooldown、last_error、健康/测试时间。 |
| `ai_scene_routes.scene/route_entries_json/enabled/revision` | 经批准的新场景默认/路由候选 | 不复制用户选择和角色 override；五类旧逻辑场景不必与新枚举一一对应，不自动成为默认模型。 |
| 公开系统音色标识、语言、格式、速率 | 新系统音色条目/适配器受支持参数 | 必须从该账号区域、目标模型的公开系统音色白名单确认；不能把任意旧 `voice_id` 字符串归为系统音色。 |
| 旧价格、套餐、促销、额度 | 独立核价记录后生成 billingBounds/售价配置 | 不复制旧免费状态作为长期成本，不迁私人余额/历史账单，不把供应商成本当用户售价。 |

URL 必须无 userinfo、无密钥/签名 query，限制公开 HTTPS 及批准的供应商域名/端口/路径，保留 DNS/SSRF 检查。workspace 专属域名只在服务器私有配置中传递，不写公开报告；URL 含秘密或未识别租户配置时拒绝，不做字符串“脱敏后继续用”。

新 schema 账号 status 没有 pending 状态：导入至少 `enabled=false`、`lastTestedAt=null`，状态依现有模块规则生成，审计另记 `validation=pending`，不能把 `active` 解读为供应商已验证。目录/route 同时停用；不覆盖已有同名模型、默认路由和现有账号。

### 3.2 秘密：仅后续服务器内部处理

| 来源 | 旧解密上下文 | 目标 |
|---|---|---|
| 选中供应商的 `ai_providers.api_key` | `providerSecretContext(源id)` | 新 upstream 行的 `secret_ciphertext`，由新平台 DEK seal |
| 无 provider 的选中端点 `ai_endpoints.api_key` | `endpointSecretContext(源id)` | 同上 |
| 确认实际生效的 env API Key | `envSecretContext(变量名)`；只读现有加密值 | 同上；记录变量名来源，不记录值、前后缀、哈希 |

**当前审计不查询这些列、不读取 env 内容。** 后续执行器选取秘密列仅限批准 ID、仅在旧服务器内部解密并立即加密传送，禁止通过 SQL CLI/stdout 输出；这不是允许执行 `SELECT *`。

env 第一批候选白名单仅限源码证实的模型凭据变量名：

- `MIMO_API_KEY`、`MIMO_BACKUP_API_KEY`；`MIMO_VISION_API_KEY`、`MIMO_VISION_BACKUP_API_KEY`；`MIMO_ASR_API_KEY`、`MIMO_ASR_BACKUP_API_KEY`；`MIMO_TTS_API_KEY`、`MIMO_TTS_BACKUP_API_KEY`；`MIMO_VOICECLONE_API_KEY`、`MIMO_VOICECLONE_BACKUP_API_KEY`；`DASHSCOPE_API_KEY`、`QWEN_TTS_API_KEY`、`DEEPSEEK_API_KEY`。
- 上述是候选名称，不证明已配置/当前生效。只传批准且实际需要的最小集合；克隆用途凭据即使保存也不启用克隆功能。
- 安全配置元数据再按变量名逐项准入：对应 BASE_URL/MODEL、已确认系统音色、语言/音频格式。不得以 `MIMO_*` / `QWEN_*` 等通配符收集全部环境变量。
- 不读取/导出管理员 token、JWT、支付密钥、webhook 密钥、用户 BYOK、SSH 私钥、旧数据库加密主密钥、LiveKit/桥接服务令牌或完整配置文件。旧 `SECRET_ENV_KEYS` 是全系统秘密目录，**不是迁移白名单**。

env 回退核实要在服务器内逐场景解析，而非调用会一次解密整份 env 的 [readEnvMap](<C:/wb-ref/old-weiban/server/lib/ai_config_store.js#L33-L39>)：ASR 专用→MiMo通用；TTS 专用→通用；clone 专用→TTS→通用；各 backup 的 URL 和 Key 回退链分别按 [路由源码](<C:/wb-ref/old-weiban/server/lib/model/model_router.js#L94-L165>)处理。Qwen TTS 还有适配器自身 env 回退，不能只看主路由。

## 4. 可迁级别与模型兼容矩阵

“可直接迁”仅指配置/凭据可安全保存，不是免适配、免核价、免验收上线。以下旧启用状态/型号来自 [既有线上盘点](./2026-10-22-voice-provider-integration.md#31-端点数据库实查)，未重新访问供应商。

| 对象 | 可迁配置 | 不能直接复用/开通的部分 | 建议状态 |
|---|---|---|---|
| SiliconFlow `FunAudioLLM/SenseVoiceSmall`、`TeleAI/TeleSpeechASR` | 已授权账号 Key、公开 URL、模型名、顺序 | multipart `/audio/transcriptions` 最接近新媒体适配；仍核文件类型、限额、时长/免费政策、错误处理；不是持久流式 ASR | 优先候选，停用导入 |
| MiMo `mimo-v2.5-asr` | 账号及模型元数据；保留旧禁用意图 | `/chat/completions` + input_audio/asr_options，不能套 multipart；原状态禁用不擅启用 | 需专用适配 |
| MiMo `mimo-v2.5-tts` + 公开系统音色 | 已授权 Key、模型、经白名单确认的系统 voice | chat JSON/base64 音频返回，不是 `/audio/speech`；重采样/安全解码与促销核价另验 | 需适配后启用 |
| Qwen `qwen-audio-3.0-tts-plus` + 系统音色 | 百炼连接、原模型名及可验证的公开音色 | HTTP 返回音频 URL 需受控下载；Plus 按字符核价；不从旧角色字段取默认音色 | 可做兼容候选 |
| 旧 `qwen-audio-3.0-tts-flash` | 原禁用配置及账号引用 | 旧适配器显式规避 Flash/Plus 混用；不能顺手改成3.1再复用旧音色 | 保持禁用待核 |
| Qwen 3.0 Streaming ASR + 级联 | 账号、已知模型/参数思路 | 真流式WS、打断、LLM/TTS三项分账、供应商未下线验证；新网关当前伪流式不等于旧流式恢复 | 需协议适配 |
| `qwen-audio-3.1-asr-flash` / `-message` / `-streaming` | 同账号可申请权限，型号独立建候选 | 三种用途/协议不同；token usage/价格版本需实收字段，不沿用3.0秒计费 | 全部待适配/核价 |
| `qwen-audio-3.1-tts-flash` | 同账号候选及系统音色清单 | 输入/输出token计费、HTTP/WS事件需独立适配；不按字价代替音频token | 待适配/核价 |
| `qwen-audio-3.0-realtime-plus` / `qwen-audio-3.1-realtime-plus` | 已授权百炼Key/区域/workspace配置 | 独立端到端会话、分模态usage、工具/记忆/安全/余额；不再叠加同轮角色LLM+TTS | 独立实验，停用 |
| 旧 `qwen3.5-omni-plus-realtime` / `qwen3-omni-flash-realtime` | 仅存禁用兼容资料 | 不能自动替换成3.8或重用绑定；旧版本输出文字计费规则不能套新版 | 保持禁用 |
| `qwen3.8-omni-flash` / `qwen3.8-omni-flash-realtime` | 独立候选项，共用Key仍核权限 | 普通HTTP与真realtime不是同一模型；需完整价格行及各模态usage，默认关闭视频/多通道/外部工具 | 待核价/适配 |
| MiMo `mimo-v2.5-tts-voiceclone` | 只迁已授权账号配置，不迁样本 | [旧实现](<C:/wb-ref/old-weiban/server/lib/voice/mimo_voiceclone_adapter.js#L1-L3>)每次请求附参考音频，不是持久voice_id；样本私有存储及本人授权另审批 | 不启用克隆 |
| Qwen enrollment / realtime / Omni克隆 | 只迁账号配置 | target_model、账号、区域、接口系列、授权和撤销机制必须全匹配；改模型可能须重新创建且产生费用 | 不导入旧绑定 |
| 其他文本/视觉上游 | 已授权的供应商/独立端点配置及模型列表可进入干跑 | 每个协议/系统消息/视觉/思考模式/用量/价格单独核验；未盘点到的实际行不声称已迁 | 单项批准后候选 |

### 4.1 音色与真人授权

[旧音色存储](<C:/wb-ref/old-weiban/server/lib/voice/voice_binding_store.js#L16-L26>)只有角色、端点、provider/model/voice_id/status，没有授权凭据。既有聚合 351 + 228 + 174 = 753 条，均**排除本次导出白名单**；不复制 voice_id、角色关联、样本 URL、本地音频或 error 内容。

- 可直接准备：官方公开系统音色参数；本人管理的供应商账号连接。须注意 [旧音色选择](<C:/wb-ref/old-weiban/server/lib/voice/qwen_tts_adapter.js#L94-L118>)会优先取角色显式 voice_id，故不能把该函数输出直接作为“系统音色”。
- 若确有本人/书面授权原创角色，另建最小化批准清单，包含本人/权利主体核验、用途/期限/允许迁移的账号与区域、目标模型、样本来源、撤销/删除安排；此清单不能靠 `ready`、明星公开录音或“能迁都迁”替代。
- 同账号同区域同 target_model 仍须核有效性；跨账号、跨区、跨目标模型没有通用可移植承诺。重注册会涉及样本处理、费用与新voice_id，不在本轮执行。

## 5. 不出秘密的迁移通道（设计，未执行）

### 阶段0：只读预检与干跑

1. 复用已知 `ubuntu` 身份及既有SSH私钥路径（本报告不猜路径、不读私钥）；校验已记录主机指纹。只读旧服务器 `152.136.111.51`、`/opt/weiban-server/weiban.db` 的结构和批准元数据。SSH失败不改root、不更换身份、不关闭HostKey检查。
2. SQLite 必须只读打开并设置 query_only，使用一致只读事务；不得复制整个库/WAL，也不能对活动WAL库用 immutable 模式忽略WAL。先检查 schema，再生成明确列名/ID过滤的查询；缺列/新未知字段中止而非降级 `SELECT *`。
3. 干跑不取秘密列、不解密，只输出数量、协议/型号分类、映射和原因码。秘密存在性/封装可用性如需查询，在服务器内部聚合为布尔/计数，不回传值或密文。生产服务 active 不等于账号可解密/有额度。
4. 新服务器预检仅验证独立新KEK/平台加密能力、导入事务/审计、出站白名单、日志脱敏、备份/回退条件；本轮不写新服务器。备份范围只限新目标受影响配置，使用加密备份，不复制旧私人库作“迁移备份”。

### 阶段1：旧机内部白名单导出 → 加密

5. 经审核的独立只读导出进程直接打开SQLite/按名读取必要配置，**不得 require 旧 db/store/router 启动应用**。构造旧store会触发秘密迁移；仅复用经确认无副作用的解密原语。禁止修改旧库、env、secret vault、服务和权限；旧机不得为本次写入脚本/临时文件，执行方式须另行审定并保持只读边界。
6. 从批准ID及env名取值，使用各自原AAD在旧机内存解密；只读已有主机密钥材料，不把旧主密钥/完整环境传走。旧明文遗留值若发现，报告类型/数量，按批准策略只在内存处理，不在旧库“顺便加密修复”。
7. 以已审计的标准公钥加密工具/库（如age，具体可用性待预检）将最小白名单数据流在**输出前**加密给新服务器专用接收公钥；新机私钥留在受控秘密设施，不上本地、不进Git、不生成明文临时私钥。不要自制RSA/AES拼装协议。
8. 包内包含格式版本、batchId、源/目标身份、创建/过期时间、批准清单摘要、条数及单项映射；认证源端并防重放。仅公钥加密不证明发送者身份，必须同时用固定SSH来源/受控签名等建立发送者绑定，接收器核验批准清单，不因“能解密”就信任内容。

### 阶段2：加密传输 → 新机内存解密

9. 服务器间专用受限传输/机器通道，固定主机身份、最小权限，传送的始终是已加密包；不经DSH工具结果/聊天粘贴/剪贴板。严禁 `tee`、shell `set -x`、命令行Key参数、env dump、调试代理、HTTP body/SQL参数日志。
10. 公共stdout只允许固定状态码/计数，不允许将明文流连到交互终端。机器传输的stdout如承载数据也只能是密文，并与会话日志彻底分离；新机解密结果只进入导入进程内存，绝不输出JSON。
11. 暂存如确有需要，仅允许有访问控制及短期TTL的密文包；禁止任何明文临时文件、swap/core dump、调试堆快照或明文重试队列。优先流式传输、禁用core、限制进程权限并核验内存保护；无法控制泄漏面则不执行，不能宣称Node字符串可保证全部擦零。能控制的Buffer用后清零、进程及时退出，只是风险降低措施。

### 阶段3：新KEK保存与审计

12. 新服务器导入器先验证来源、有效期、批次未用、最大条数/大小、完整性、所有字段/URL/模型映射及批准范围；严格拒绝额外字段、账号区域冲突、孤立provider和模型冲突，不接受包内SQL/脚本/任意文件路径。
13. 调用model-access拥有的服务器内部受控导入服务（**待实现并审查**），通过新平台 `EnvelopeCrypto.seal(PLATFORM_KEY_OWNER, upstream:{新UUID}, secret, tx)` 保存。新平台DEK由新KEK包装；不用旧密文、不把旧KEK带过来，也不在迁移器另写业务加密。
14. `display_prefix/display_suffix` 使用不含真实Key片段的空值/固定遮罩（由模块兼容验证），不输出前后缀。鉴别重复仅在内存或服务器私有受控映射中处理，不把Key哈希或指纹写公开报告。未来确需持久比对也须专门安全设计，不能裸SHA当脱敏。
15. 原子事务写上游/目录/route/批次审计；默认全停用，无探测、无拉模型、无自动试合成。审计仅批次ID、操作者、批准引用、安全化源引用→目标ID、数量、动作、结果码/时间及配置版本；不存密钥/密文/原始报错/SQL参数/包含租户标识的完整URL。
16. 幂等以批次+源对象+批准版本映射，不靠名称覆盖；重放拒绝，断点重试不创建重复账号、不重置现网开关。同一源账号变更多用途时人工审核映射，不自动扩大权限。
17. 回滚只针对该批次新建且未引用的停用对象；已有对象一律不覆盖。已发生引用/使用则走模块既有停用/软删/引用检查和审计，不硬删历史记录，不删除平台共享DEK。旧服务器始终不变。

### 阶段4：启用另设闸门

先离线假上游测试协议/计费/失败与回滚，再经批准执行供应商验证。当前授权明确禁止付费调用，**即便迁入Key也不探测服务或试音**；未来每条需得到允许的最小验证范围，核账号区域/模型权限/有效期/价格/真实usage，再单独启用。

生产写入、受控执行器安装和真实迁移由主负责人另行安排实施任务；本报告不能当作已经越过本轮“不要写任何服务器/生产库”的边界。

## 6. 官方型号与价格证据等级

### 本轮网络结果

- **索引级**：官方 [3.1 TTS Flash](https://help.aliyun.com/en/model-studio/qwen-audio-3-1-tts-flash) 搜索摘要确认型号；官方控制台文档索引 [同型号页](https://docs.bailian.console.aliyun.com/en/model-studio/qwen-audio-3-1-tts-flash) 展示输入1.5/输出12每百万token，但本轮摘要未充分确认币种/地域，不升级为正式入库报价。
- **索引级**：官方 [Omni选型](https://help.aliyun.com/en/model-studio/omni/) 区分3.8普通Chat Completions/Responses与Realtime WS/WebRTC/AOQ；不使用第三方项目说明作为官方账单规则。
- **索引级**：小米官方 [按量价格](https://mimo.mi.com/docs/en-US/price/pay-as-you-go) 摘要仍写三个v2.5语音生成模型限时免费；不是永久价格承诺。
- **完整官方正文：本轮未取得。** 对阿里官方TTS页 `web_fetch` 被工具以解析到non-public IP拒绝；未通过IP、代理、改域等方式绕过，也未继续抓取其镜像来规避。
- **实际回执：无。** 未调用供应商，无实际usage/账户授权/价格账单样本。旧研究列的3.1/3.0价格继续仅为索引参考，详见 [计费矩阵](./2026-10-22-voice-provider-integration.md#6-计费矩阵供应商成本与平台售价必须分开)，本报告不复制成第二份价格正本。

没有核实到 `qwen-audio-3.1-tts-plus`，**不得造出该型号或批量改名**；Plus兼容候选仍是旧 `qwen-audio-3.0-tts-plus`，是否现行可用也须后续供应商确认。

## 7. 验收清单与交接

本轮完成的是字段/边界和方案准备，不是迁移验收。主负责人需分派以下门禁；本报告不改既有ADR/契约：

- [ ] 生成纯元数据干跑清单；明确每个账号的管理权、用途、区域与实际凭据来源，禁用/缺失provider不误激活。
- [ ] 安全审查只读导出器/受控导入器；无旧模块初始化写入、无用户数据、无密钥片段/密文输出。
- [ ] 用合成测试凭据离线测：错误AAD/旧Key不可解/篡改包/错误接收者/过期/重放/未知字段/URL含秘密均拒绝；日志及失败路径不泄漏；不以真实Key做测试夹具。
- [ ] 用一次离线集成自测覆盖中断重试、幂等、事务失败回滚、全停用导入、新KEK重封装可解密、回滚不动现有账号；测试报告只输出断言/计数。
- [ ] 由另一审查者独立验收；开发自测不冒称独立通过。
- [ ] 媒体真实token/分模态用量、克隆授权生命周期、真realtime接口/安全及计费需契约申请和ADR补充；由负责Agent实施，不与本批文档抢写。
- [ ] 完整官方地域/币种价格、目标账号权限、模型实际可用性、供应商usage回执仍待核实；在当前禁止付费调用下不解除该门禁。

**不用再手填Key的条件**：旧机既有服务身份可读取并解密批准凭据、供应商允许在新服务器使用（IP白名单等由授权管理者处理）、新机有安全接收与新KEK、审计及批准清单完备。否则记录为 `needs-owner-action`，由账号持有人在供应商控制台轮换或通过受控秘密设施注入；绝不让用户在聊天中发Key，也不以缺Key为由复制整份env/旧库。本人声音授权缺失不是Key输入问题，必须留待授权，不自动迁移。
