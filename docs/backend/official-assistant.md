# 小V同学官方身份（方向 B）

> 2026-10-31 晓楠批准动手（方向 B：新增官方身份类型）。方案全文见
> `~/workspace/weiban/ops-log/2026-10-31-xiaov-customer-service-investigation.md`
> 第七节；知识库草稿见
> `~/workspace/weiban/ops-log/2026-10-31-xiaov-knowledge-base-draft.md`。
> 本页只记实现现状与运维口径，口径冲突时以方案文档和晓楠最新决定为准。

## 一句话

小V同学表面是一个普通联系人（按名称排序、不置顶），里子是官方服务身份——
**不是角色库里的角色**：没有 `characters` 行，不进广场、不占通讯录名额、
不参与好感度/生态/记忆/朋友圈/群聊。它只调用客服需要的只读能力。

## 身份模型

- 固定键 `OFFICIAL_IDENTITY_KEY = 'official:xiaov'`（`conversations.official_identity_key`
  的唯一取值，迁移 0152）；固定合成 refId
  `OFFICIAL_REF_ID = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'`（参与者认身份用）。
  两者永不更换，换键即丢历史会话关联。
- 会话：`type='direct'`、`character_id=NULL`、参与者为 `user` + `official`；
  每用户最多一个（部分唯一索引）。建会话只走
  `ChatAdminPort.ensureOfficialConversation`（幂等；已归档只恢复、**永不删重建**、
  保留全部历史）。
- 参与者种类：契约 `ParticipantKind` 加 `'official'`。消息 `senderKind` 同样可为
  `'official'`；`'system'` 仍是系统提示标记，**不得挪用**来充当官方参与者。
- 联系人：**不写 `contacts` 行**。服务端只提供合成展示对象
  （`GET /official-assistant/contact`，含 `conversationId`）与资料对象
  （`GET /official-assistant/profile`：名字/签名/头像路径/官方标记），客户端在
  展示层合并排序。默认添加/自动补由客户端在登录/同步/注册后调
  `POST /official-assistant/conversation` 补齐（服务端 ensure 幂等，老用户走同一口兜底）。
- 头像：代码库中无 `official-assets` 资产，`avatarPath` 暂为 null，客户端用内置
  官方头像占位。签名沿用旧版“微伴官方小客服，使用上有任何问题都可以问我～”。
  （Q1 头像/签名沿用与否待总控确认，当前按旧版。）

## 回答引擎（新写，不复用角色聊天路）

模块 `apps/server/src/modules/official-assistant/`（上层模块，无自有 schema，
会话数据经 chat 端口写 `chat` schema；依赖全部经端口注入，不直接读别模块的表）。

- 触发：事件 `chat.message_created`（consumer `official.on_user_message`）→
  pg-boss 任务 `official.reply`（singletonKey 按消息、重试 2 次）。只处理
  direct + 用户发送 + `normal` 范围 + 官方会话确认后的消息；触发内容类型为
  text/image/voice/link/forwarded_record，其中非文字只发固定提示、不调模型；
  拍一拍、表情包等其余类型静默不回（Q5 发图/跳转/语音/表情包待确认后另加）。
- 历史：只取本会话最近 10 条文字消息（“近期历史”具体范围待 Q7 确认），
  不摘要、不长期记忆、不读角色私聊与记忆/脑。
- 知识库：仓库内版本化数据文件 `data/knowledge-base.json`（version 1，
  2026-10-31，逐条转写草稿；维护方式已定：暂时找 Muse 改，不做后台入口，
  改完须跑知识库单测）。匹配取最长命中关键词计分、同分确定性优先；
  确定性条目按简报事实渲染模板（占位符白名单 8 个，缺值降级走模型），
  未知条目直接按未知口径答、不调模型。
- 提示词 = 身份自述 + 只读简报行 + 匹配条目事实/指引 + 硬红线：
  只说前台公开内容，不透露成本价/上游价/内部编号/报错堆栈，不解释平台付费
  内部规则；敏感事项（退款、付款核对、封禁、账号纠纷）只给微信 `xingliubuji`；
  未知先说没核实到、再给微信；不能改头像/改人设/代操作/进群/发圈；
  单条气泡、无括号动作、无思考过程。
- 模型调用：`generatePlatformText`，purpose `small_v`、modelRole `background`、
  maxOutputTokens 800，**不传 temperature、不传 characterId**；思考预算由网关
  对 small_v 置 0（引擎断言 `reasoningTokens` 非零时记 warn）。限频由网关
  `BillingBoundsService.consumePurpose` 执行（small_v：10/分钟、100/天），
  超限回占位文案（Q4 超限文案待定稿，当前占位在 `domain/identity.ts` 一处）。
  平台付费、不扣用户积分（写消息不带 charge）。失败回固定失败文案，不编答案。
- 欢迎语：定稿全文，只在官方会话首次创建时发一条，幂等键
  `official:welcome:<userId>` 去重：
  “你好呀，我是小V同学。微伴使用上有任何问题都可以直接问我，需要帮忙的时候
  也可以把情况告诉我，我来帮你看看～”
- 撤回：官方回复不可经 `recall` 路撤回（仅 `character` 可撤回，属预期行为）。

## 只读用户状态简报（Q3 清单）

`BriefService` 经端口并行读取，单项失败只让该项变未知：

| 项 | 来源端口 | 备注 |
| --- | --- | --- |
| 会员档位与到期日 | `IdentityMembershipReadPort` | — |
| 积分余额（微元÷10000 取整） | `BillingReadPort` | 只报余额数字 |
| 联系人当前数与上限 50 | `ContactsReadPort.listActiveContacts` + `P26_CONTACT_LIMIT` | 官方联系人不计入 |
| 账号状态是否可用 | `IdentityAccountStatusPort` | 封禁状态以该端口为准 |
| 会员/充值配置（价格渲染） | `BillingCustomerConfigReadPort`（新增） | 读 `billing.settings` / `recharge_options`，数值以数据库现行值为准，上线前须再核对 |
| 模型价格 | `BillingModelRatePort` 现行生效价目表 | 绝不逐条硬编码 |

**诚实缺口**：积分变动/明细列表、活动/邀请进度、角色申请配额均无读取端口，
简报不含这两项数据，问到时按未知口径答，不得编。

## 公告群发（单独做）

`OfficialBroadcastService` + `POST /admin/official-assistant/broadcast`。
开关 `OFFICIAL_ASSISTANT_BROADCAST_ENABLED` 默认关；受众只接受显式 `user_ids`
（去重、逐用户独立事务、账号非 active 跳过、幂等键
`official:broadcast:<broadcastId>:<userId>`），`all_users` 服务端拒绝
（受众规则待定，不擅自定）。审计写 `official.broadcast`（含 delivered/skipped，
不含正文）。

## 开关

环境变量（只在 `platform/config` 读取）：

- `OFFICIAL_ASSISTANT_ENABLED`：未设/非 0/false 即开启，默认开，显式关为
  opt-out。关掉则入口消失（lifecycle 不订阅不跑任务、用户端接口 404），
  已有数据不删。
- `OFFICIAL_ASSISTANT_BROADCAST_ENABLED`：默认关。

## 角色边界守卫（1.5 节拦截清单核对）

官方会话天然被排除的（无 `character` 参与者 / 无 `character_id`）：

- ai-runtime 出站消费（lifecycle、conversation-memory、ecology、shared-episodes、
  channels 桥接）：均以会话内有 `character` 参与者或 `senderKind='character'`
  为前提；channels 桥接参数类型已扩展、守卫仍只放行 `character`。
- 记忆/脑读取、生态唤醒计数、统计报表（`recap-stats` 按 `sender_kind='character'`
  计数）、数据清理（`purgeCharacter` 按 `character_id`，官方会话 `NULL` 不受影响；
  `purgeUser` 按 owner，官方会话随用户注销一并清理）。
- 群聊：建群经联系人校验，官方固定 refId 无联系人行，无法被拉进群；
  群聊 PRO+ 门禁只影响群聊发言。
- 搜索/动作卡片/年度回忆：语音 transcript、action_card、回忆计数均只认
  `character` 发送者，官方自动排除。
- 朋友圈：moments `authorKind` 枚举**不得**扩展，官方永不发朋友圈。
- 显式改动：`ChatStore.conversation` 的 `peerReadSeq` 找 `character` 或 `official`
  参与者；推送名对 `official` 传 senderRefId（显示“小V同学”）；转发快照对
  official 取 `OFFICIAL_NAME`；`read_cursor_moved` 的 `participantKind` 认
  `official`；`listActiveContacts` **不得**塞入合成官方联系人（会被当成角色计数）。

## 端点契约

`packages/contracts/src/http/official-assistant.ts`：

- `GET /official-assistant/profile`、`GET /official-assistant/contact`、
  `POST /official-assistant/conversation`（用户态）。
- `POST /admin/official-assistant/broadcast`（管理态）。
- 改契约后须跑 `pnpm android:generate` 同步 Kotlin 产物并一并提交
  （PR #27 教训：未同步生成产物会挂 CI 契约校验）。

## 迁移 0152（`0152_official_identity`）

内容：`conversations` 加 `official_identity_key` 列 + check（只认
`'official:xiaov'`）+ check（official 会话必为 direct 且 `character_id` 为空）
+ 部分唯一索引；`participants` / `messages` 的 kind check 加 `'official'`。
头部注释写明可逆与执行要求；`.down.sql` 先断言无 official 残留（有残留即
拒绝回退），再恢复旧 check 并删列删索引。

**发布前**：停 worker → 迁移前全量快照 → 执行迁移 → 冒烟（ensure/发消息/
读列表）→ 开关控制上线。回退须代码与迁移配套（先回代码、再跑 down 迁移，
且须无 official 残留）；开关关掉只关入口、不删数据。
不实际演练生产迁移。

## 测试

- 单元（`src/modules/official-assistant/**/*.test.ts`，vitest）：知识库匹配/
  渲染/加载校验、提示词红线与截断、引擎（确定性/模型/限频/失败/非文字/
  幂等/欢迎语）、简报（单项失败隔离）、广播（开关/受众/幂等/跳过）。
- 集成（`test/official-assistant.test.ts`，`describeDb`，只连
  `TEST_DATABASE_URL`）：迁移往返、约束断言、真实 `ChatAdminService` 的
  ensure 幂等与归档恢复不删历史。
- 整应用启动回归：`test/server-flow.test.ts`（含本模块装配）。

## 待确认（不得擅自定）

Q1 删除/拉黑/隐藏规则与 Web/Android 一致性、头像/签名沿用与否；
Q4 超限文案定稿与排队机制；Q5 发图/跳转/语音/表情包；
Q7 “近期历史”具体范围（当前 10 条）；公告受众规则；反馈入口与截图报障路径；
举报/投诉与注销账号是否同给微信口径；客户端工作（合并排序、资料渲染、
ensure 调用时机、头像占位、发版）。
上线前须按知识库草稿要求再核对一次数据库现行值（会员/充值配置、价目表）。

## 不做的事

人工工单（`support/tickets` 不接线、不启用）、会话内人工接管、客服长期记忆/
摘要提取、每日一问、角色能力（改头像/改人设、进广场、好感度、生态动作、
朋友圈发帖、群聊发言）、余 5 张占位卡的任何处理、已发布 677 张卡的任何改动、
small_v 模型配置本身的改动（只调调用参数）。
