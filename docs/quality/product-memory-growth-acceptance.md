# 产品板块验收：记忆 v5 与熟悉度

- 日期：2026-10-20（Asia/Shanghai）；审查人：Codex 并行审查代理。
- 目标：独立副本 `C:/wb-qa/review-20261020`，固定提交 `65bb669821909ac62239c5b140410d569a078411`；分支名由整体报告登记。
- 比较基线：`9b647d6228553cf8d1cec13557e310dc896179c5`。
- 范围：会员记忆档位、新用户体验、回忆原文、长上下文权限、删除屏障、消息熟悉度、迁移 0106–0108。仅审查，不修复；没有修改业务代码、契约、数据库或生产环境。
- 结论：**不通过**。确认 3 项 P2 实现缺陷；数据库、真实模型和界面验收仍未完成，不能以静态检查替代完整验收。

## 依据与验收记录

已读 `docs/README.md`、`docs/quality/README.md`、`docs/quality/issues.md`、`docs/tasks/2026-10-19-v5-batches.md`、记忆/熟悉度两份交接、`docs/refactor/16-membership-v5.md`、`09-chat-pipeline.md` 第 4/6/8 节、ADR-0027 补记、`docs/backend/growth.md` 及相关 chat/media/memory 契约。

| 验收要求                                                    | 结果与证据                                                                                                                                                                                                                                |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 免费常驻 3、最早 30 条参与、话题回想 3；PRO+ 为 16、不限、8 | 静态路径符合默认配置与截取规则；真实数据库与提示词联动未验证。`memory-tier.ts`、`MemoryService.context`、`reply-context.ts:501`。PRO+ 不限与既有 1000 条硬上限的冲突见下文。                                                              |
| 免费摘要只用最近 7 天                                       | **不通过**，MG-01。                                                                                                                                                                                                                       |
| 注册后前 7 天享 PRO+ 记忆，长上下文不随体验放开             | `resolveTier` 按注册时间计算体验截止，`member` 与 `tier` 分开；`longContextLimits` 只认 `member`。静态符合，端到端未验证。                                                                                                                |
| 回忆意图才翻原文；免费 7 天；不越过删除屏障                 | `reply-context.ts:324–339,718–761` 传 `rawFromSeq/barrierSeq`，候选排除 `seq <= barrierSeq`，按日期与回忆词过滤；读取经 chat 内存解密、排除 health/quirk_draft、上限 2000。静态未发现越屏障路径；删除并发、权限变化与真实聊天验证未执行。 |
| 改删记忆后旧提示词/摘要不能恢复该记忆                       | `memory.ts:476–505` 同事务推进 barrier/cursor/window 起点，清摘要及稳定块并使回复计划作废；抽取提交核对 revision/cursor/barrier（1127–1132）。静态防护存在，未实际验证并发。                                                              |
| 长上下文只对 PRO+ 单角色生效，非会员打开返回 403，到期停用  | `settings.ts:207–208` 明确拒绝非会员；`memory-tier.ts:107–114` 在每次使用时重新核验会员。全局设置不启用长上下文。HTTP/到期端到端未验证。                                                                                                  |
| 打开长上下文前提示积分/倍率；记忆页不诱导                   | `apps/web/src/features/chat-settings.tsx:365–405` 有确认弹窗、报价及无法估算说明；`memories.tsx:231–270` 仅陈述范围。静态符合，浏览器未验收。                                                                                             |
| 有效消息免费 +4 / PRO+ +8，每日上限 350 / 700               | 参数、`scaledPoints` 与共用加分路径一致；消息加分存在 MG-02/MG-03。没有实跑数据库上限与跨日。                                                                                                                                             |
| 重试与并发不重复计分                                        | 新消息键按 messageId+characterId；`awardUserMessage/awardPoints` 使用同一 advisory 锁，已计分流水先查重；平台 inbox 与处理处于同事务。静态具备防重保护，真实并发未验证；乱序语义不正确，见 MG-03。                                        |
| 群里只给被 @ 的角色计分                                     | `growth-events.ts:413–423` 将 mentioned participant IDs 映射为角色、去重；无 @ 不计。静态符合，群成员变更并发未验证。                                                                                                                     |
| 0106–0108 可执行、回滚、补跑                                | SQL 与 down 文件齐备，journal 顺序 106/107/108；迁移器按已执行 tag 判断，允许已有 0107/0108 的库补跑 0106。仅静态审查，未执行 up/down，不登记数据库通过。                                                                                 |

## 确认缺陷

### MG-01 · P2 · 免费 7 天摘要过滤按月份放行，仍带入本月旧事

- 位置：`apps/server/src/modules/ai-runtime/domain/memory-window.ts:143,174–177`；同样的比较位于 `application/memory.ts:603–604,775–779`。
- 标准：16 号 §5.3 与批 B 要求免费只使用最近 7 天摘要。
- 触发：免费期截止对应 `summarySince=2026-10-14`，存有 `period=2026-10`、包含 10 月 1 日旧事的月摘要。`fresh` 将截止日截为 `2026-10`，整月摘要被视为新鲜，输出进入稳定记忆块。
- 实测：直接调用被审源码 `renderStableMemory`，输入月摘要正文 `OLD_2026_10_01`，实际输出：

```text
更早的往事（摘要，不是原话；过去的状态不当作现在）：
2026-10：OLD_2026_10_01
```

- 影响：免费档和体验结束用户仍能通过摘要获取超期旧事，权益边界与页面展示不一致。
- 基线区别：`summarySince/fresh` 与按档位筛选均为本轮新增；基线没有免费 7 天要求的实现，故本项为新档位功能的实现缺陷。日摘要复制累计 `segSummaries.normal` 是基线已有结构，亦会使旧内容被重新贴上新日期；该点作为配套风险，不重复计作新回归。
- 建议：按来源日期生成并筛选摘要；跨越截止日的整月聚合不可原样使用，日摘要也应避免累计旧内容重新获得新日期。

### MG-02 · P2 · 正常用户语音的转写不在消息正文，导致永不获得消息熟悉度

- 位置：`apps/server/src/modules/growth/application/growth-events.ts:427–435`。
- 标准：熟悉度交接与 `docs/backend/growth.md` §4 承诺文字和语音转写均计分。
- 触发：用户发送至少 2 字的普通语音。契约 `packages/contracts/src/http/chat.ts:96–107` 明确用户 voice.transcript 为 null，Web 实际发送亦为 null（`apps/web/src/features/chat.tsx:707`）。识别结果写入 media 对象的 transcriptCiphertext，经 `GET /media/:mediaId/transcript` 和 sync 更新提供。
- 缺陷路径：订阅者只读 `message.content.transcript`，null 被转成空字符串后正常 return。`media-ai.ts:120–149` 将识别结果交给 media，`media.ts:626–653` 仅写 media 和 sync 更新，不修改原消息、也没有补发此 growth 加分事件。因此即使稍后成功识别，消息仍不计分。
- 实测：直接调用实际 `GrowthEvents.onUserMessageForFamiliarity`，mock chat 返回与契约一致的 `voice/transcript:null`，有效联系人存在，记录 `awardUserMessage` 调用次数，结果 `awardCalls=0`。此为边界端口桩验证，没有调用语音供应商。
- 基线区别：本条消息加分订阅者为新增；不是既有 Q-001–Q-012 问题。
- 建议：使用独立 media 转写结果，并在识别完成后以原消息 ID/发送时间触发幂等计分；未识别时不能把该次订阅永久视为完成。

### MG-03 · P2 · 乱序事件回退计分时间，突破 3 秒间隔并使重复判断依赖投递顺序

- 位置：`apps/server/src/modules/growth/domain/familiarity-rules.ts:28–29` 与 `application/growth.service.ts:247–252`。
- 标准：16 号 §11 的有效消息需距上一条计分消息至少 3 秒；并发/重试不应改变已存在发送序列的防刷结果。
- 触发：同角色三条不同消息发送时间为 0 秒、1 秒、10 秒，先后处理 0 秒、10 秒、1 秒。最后一条用 `abs(1-10)=9` 通过，并把存储时间从 10 秒回退到 1 秒，但 1 秒消息与已计分 0 秒消息实际只差 1 秒。
- 实测：调用真实 `evaluateUserMessage`，每条按 service 的实际更新逻辑写回 hash/scoredAt；0→10→1 的结果全部 `valid=true`。若按发送顺序 0→1→10，则中间 1 秒消息不通过。相同消息集合因事件到达顺序产生不同积分。
- 影响：事件重试晚到、多个 dispatcher/并行处理下，用户可获得本不符合间隔条件的积分。锁只使写入串行，不保证按发送时间处理。乱序还会覆盖 lastMessageHash，使「与上一条完全相同」比较对象变成投递上一条。
- 基线区别：消息有效性函数与这两列状态均为新增。交接所述「绝对值」实现确实存在，但开发说明不是修改产品防刷标准的依据。
- 建议：明确并按消息发送顺序计算有效性，或采用可处理迟到事件且不回退防刷状态的策略；仅使用绝对差并保存一个时间无法保证该性质。

## 旧结构风险与限制（不计新回归）

- **PRO+ 宣称不限仍有 1000 条硬上限**：`memory.ts:95,444–445,613,1152`。基线即有该限制，新增权益和页面「不限」没有消除它。实际创建第 1001 条会被拒绝，自动抽取也停止 ADD；需产品/开发处理权益落差，不能宣称不限容量已验收。
- 日/月摘要旧汇总日期不是内容来源日期：日汇总用滚动 4000 字摘要，月汇总再合日摘要；MG-01 修复需一并考虑，不能只改月份字符串比较。
- 年度回忆只有渲染入口、没有数据来源，任务卡明确允许后做；不作为本轮新缺陷。
- `active_chat_day` 没有服务端自动触发点、PRD P-25 仍写旧分值，是开发交接已登记的旧/文档事项，不重复报为新缺陷。
- 未验证真实数据库迁移、并发/跨日/会员到期、HTTP 权限拒绝、浏览器与 Android、真实模型生成和语音识别。模型评测集条目存在不代表已经运行且通过。

## 实际检查与复现命令

持久复现材料：[可重跑脚本](reproductions/2026-10-20-memory-growth-probes.mjs)、[实际输出](reproductions/2026-10-20-memory-growth-probes.txt)。在仓库根运行 `node docs/quality/reproductions/2026-10-20-memory-growth-probes.mjs`。脚本先对照固定目标 SHA 校验 server/contracts 源码和 TypeScript 配置的 **482 个 blob**，不依赖当前 HEAD 等于目标（允许质量文档提交）；再用实际源码重跑三个探针，仅写相邻质量输出文件。已重跑，三项仍复现、退出 0。

环境：Windows PowerShell、Node `v24.21.0`；依赖由主审统一安装。执行 `git rev-parse HEAD` 确认目标完整 SHA。仅运行源码纯函数与端口桩探针，无数据库、无网络供应商调用。以下三条在 `C:/wb-qa/review-20261020/apps/server` 执行，均退出 0 且有下述有效输出。

```powershell
node --import tsx --input-type=module -e 'import {renderStableMemory} from "./src/modules/ai-runtime/domain/memory-window.ts"; console.log(renderStableMemory({scope:"normal",resident:[],windowStart:100,segments:[],legacySummary:"",daily:[],monthly:[{period:"2026-10",normal:"OLD_2026_10_01",adult:""}],summarySince:"2026-10-14"}));'

node --import tsx --input-type=module -e 'import {GrowthEvents} from "./src/modules/growth/application/growth-events.ts"; let calls=0; const g={awardUserMessage:async()=>{calls++;}};const ctx={contacts:{listActiveContacts:async()=>[{conversationId:"c",characterId:"r"}]}};const chat={getMessage:async()=>({createdAt:"2026-10-20T08:00:00Z",content:{type:"voice",mediaId:"m",transcript:null}})};const x=new GrowthEvents(undefined,undefined,undefined,undefined,undefined,undefined,undefined,g,undefined,undefined,ctx,undefined,chat,undefined); await x.onUserMessageForFamiliarity({payload:{senderKind:"user",senderRefId:"u",contentType:"voice",conversationType:"direct",conversationId:"c",messageId:"msg",scope:"normal"}},{}); console.log(JSON.stringify({awardCalls:calls}));'

node --import tsx --input-type=module -e 'import {evaluateUserMessage} from "./src/modules/growth/domain/familiarity-rules.ts"; let hash=null,at=null; for(const [text,sec] of [["今天好吗",0],["已经好了",10],["今天再说",1]]){const sentAt=new Date(Date.UTC(2026,9,20,0,0,sec)); const r=evaluateUserMessage({text,sentAt,lastMessageHash:hash,lastMessageScoredAt:at});console.log(JSON.stringify({text,sec,valid:r.valid}));hash=r.hash;if(r.valid)at=sentAt;}'
```

第二条输出 `{"awardCalls":0}`；第三条三行 `valid` 均为 `true`。探针未经过 HTTP/数据库，明确不计端到端测试通过。前置尝试 root `pnpm exec tsx` 报找不到命令；server 下 `pnpm exec tsx` 本机无有效输出，未据此声称通过，最终使用以上有输出的 Node loader 命令。

主审负责全仓公共检查，本报告不复制尚未收到的检查结果。所有发现留给开发方修复，修复后需新完整 SHA 并由独立审查者复核；本轮没有修复。

## 追加：注销与角色删除的持久数据清理复查

已只读检查下列链路，**未确认新增的清理遗漏**；这不是实库删除验收通过。

- identity 注销在删除清单均完成后删除 users；`identity/application/deletion.ts:328–369` 的 count 包括 memberships，`identity/infra/db/schema.ts:285–292` 中 memberships.userId 对 users 为 CASCADE，grantedBy 为 SET NULL，注册时间从用户数据读取，无另建体验记录需删除。
- 会员开通订单：`billing/application/lifecycle.ts:108–153` 显式删除 `billing.membership_orders WHERE user_id`，count 同时纳入订单；赠送余额在 accounts、赠送变动在 ledger_entries，继续随原钱包清理函数删除，无另设未登记赠送表。本次未调用该数据库函数，不关闭既有 Q-011。
- 记忆/长上下文：`ai-runtime/application/lifecycle.ts:112–115` 登记清理；`plan-store.ts:324–435` 注销删除并统计 companionSettings、memories、memoryStates 等，long_context 是 companionSettings 行内字段，删除行即删除开关；分档配置 memory_tier_config 为平台单例，不是按用户持有的记忆数据。
- 彻底删除角色：`ai-runtime/application/lifecycle.ts:632–699` 监听 contacts.contact_purged，按 conversation 删除记忆、摘要/屏障状态和回复计划；没有新活动联系人时按 user+character 删除 companionSettings，因此 long_context 一并清除。软删除保留数据以支持恢复，是既有设计。
- 熟悉度：`growth/application/growth-events.ts:128–143` 彻底删除角色时调用 purgeCharacter；`growth.service.ts:583–614` 对 familiarity/familiarityEvents/anniversaries 按角色或用户清理并计数。0106 新增 hash/scoredAt 均在 familiarity 行上，无另建遗漏表；注销仍走 growth 已登记清理。
- 以上结论限源码覆盖与 schema/调用链对应关系；尚未在数据库验证 FK、迁移后真实清零、pg-boss/事件迟到与删除并发下不重建数据，以及对象存储清理。
