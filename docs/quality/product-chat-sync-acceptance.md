# 聊天、同步与账号切换专项审查（2026-10-20）

结论：**不通过；端到端验收未完成。** 发现已知更新类型消费后未持久保存的确定性缺陷。未确认跨账号聊天展示或消息正文丢失的新缺陷，不据此声明全链路安全或可靠性通过。

| 项       | 范围                                                                                                                        |
| -------- | --------------------------------------------------------------------------------------------------------------------------- |
| 审查人   | Codex 客户端并行审查代理，第二轮                                                                                            |
| 目标 SHA | `65bb669821909ac62239c5b140410d569a078411`                                                                                  |
| 比较基线 | `9b647d6228553cf8d1cec13557e310dc896179c5`                                                                                  |
| 工作副本 | `C:/wb-qa/review-20261020`                                                                                                  |
| 读写边界 | 业务 / 契约只读；仅新增本质量报告；未修改测试、生产、数据库或共享预览                                                       |
| 依据     | message-reliability.md、ADR-0005 对应规则、T-031 / T-035、正式 chat / sync / client-sync 契约、现有协议向量与客户端测试源码 |

## CHAT-001 / P2：message.updated 推进游标，但未更新持久消息

- 位置：`packages/client-core/src/sync-engine.ts:478` 的 applyUpdate 缺少 `message.updated`；`:471`–`:472` 无论该分支是否处理均推进游标。Web 用 `apps/web/src/features/chat.tsx:543` 的组件内 overrides 临时补显示，`:556` 监听广播、`:607` 覆盖消息。
- 触发：角色发出带按钮卡片，例如心愿提议；用户选择按钮成功。服务器 `apps/server/src/modules/chat/application/actions.ts:71` 写入完整 `message.updated`。当前页面显示选择结果；离开该聊天页再返回，或关闭后离线重新打开。
- 结果：组件的 overrides 销毁，持久状态中的卡片仍然 `actionChoice:null`；按钮重新表现为未选。更新游标已经越过该更新，普通增量重连不会再次获取它。打开会话的 seq 缺口检查只看消息数量 / 序号，不会发现同一 seq 的 actionChoice 已变；近期消息已缓存的情况下它也不会重新抓该消息。直到显式全量重建或其他历史刷新覆盖消息才可能恢复。
- 影响：用户看不到已作出的选择，多设备或不在当前聊天页时收到更新也不能保存结果。服务器对动作有幂等和 `action_already_chosen` 保护，因此本报告**不声称**重复执行动作或重复扣费。
- 证据：下述输入通过实际 ClientSyncOperation / Message 契约解析，实际引擎消费更新并 JSON 往返模拟持久化 / 重开，输出 `lastUpdateSeq:1` 而 `actionChoice:null`。
- 相对基线：engine 在比较基线至目标 SHA 无改动；基线聊天页已有相同 overrides 逻辑。**既存缺陷，不计为 v5 新回归。** 现有 quality/issues.md 未见登记。
- 建议交开发方：同步核心按契约应用完整 message.updated 并持久保存，保持撤回单向性与已删除消息保护；UI 应消费同一持久消息状态。修复后覆盖不在聊天页、离开再返回、离线重启、多端已选择场景。

可重跑的同输入脚本：[2026-10-20-chat-sync-probe.mjs](reproductions/2026-10-20-chat-sync-probe.mjs)，实际执行记录：[2026-10-20-chat-sync-probe.txt](reproductions/2026-10-20-chat-sync-probe.txt)。脚本核对六个源文件 / 向量的 Git blob 与固定被审 SHA 一致，允许仅提交质量文档后的 HEAD 变化；已重跑退出 0，输出与下方相同。

实际执行命令（独立纯输入探针，没有新增业务测试）：

```powershell
pnpm --filter @weiban/contracts exec tsx --eval 'import {readFileSync} from "node:fs"; import {SyncEngine} from "../client-core/src/sync-engine.ts"; const v=JSON.parse(readFileSync("test-vectors/recall-before-history.json","utf8")); const source=v.steps[2].operation.update.data.message; const card={...source,content:{type:"action_card",cardKind:"wishlist_proposal",text:"一起去看海",actions:[{actionId:"add",label:"好",style:"primary"}],ref:null},actionChoice:null}; const e=new SyncEngine({...v.initialState,messages:[card]}); e.apply({type:"update",update:{updateSeq:1,occurredAt:"2026-10-20T00:00:00.000Z",type:"message.updated",data:{message:{...card,actionChoice:{actionId:"add",chosenAt:"2026-10-20T00:00:00.000Z"}}}}}); const persisted=JSON.parse(JSON.stringify(e.state)); const reopened=new SyncEngine(persisted); console.log(JSON.stringify({lastUpdateSeq:reopened.state.lastUpdateSeq,actionChoice:reopened.state.messages[0].actionChoice,messageType:reopened.state.messages[0].content.type}));'
```

Node.js `v24.21.0`，最终命令退出 0：

```json
{ "lastUpdateSeq": 1, "actionChoice": null, "messageType": "action_card" }
```

首轮构造输入遗漏 occurredAt，被正式契约拒绝，退出 1；补全正式字段后才得到上述结果。输入错误不记为产品缺陷。此探针不等于浏览器、IndexedDB 或真实 HTTP 端到端执行。

## 核对结果与覆盖

| 可靠性标准                                   | 本轮结果             | 依据 / 限制                                                                                                                                                                          |
| -------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 消息先持久保存再执行网络副作用               | 静态核对符合         | SyncRunner.mutate await save 后才 drainEffects / execute；保存失败回滚并停止，Web dispatch 在停止后向调用方抛错                                                                      |
| 同一会话串行，不同会话并行                   | 静态核对符合         | SyncEngine.flush 按 conversationId 阻挡后一条；发送采用 HTTP 契约等价路径，不能将其描述成实际 WS send                                                                                |
| 断网、超时、永久错误与重发保留原 clientMsgId | 静态核对符合         | failed / retry 保留 outbox.body；在线五次失败转 failed，4xx 立即 failed；新建消息 ID 使用 crypto.randomUUID，未验证排序依赖其版本                                                    |
| 重建先取 S，再快照，再补日志                 | 静态核对符合         | cursor.expired → state → snapshot → updates；快照保留 outbox 与 S 之后 pendingUpdates                                                                                                |
| 断线 / 停止后的旧回调不覆盖状态              | 静态核对符合         | SyncRunner lifetime AbortController，旧 effect 返回后检查停止 / signal；ChatDriver 生命周期停止旧 runner                                                                             |
| 历史与撤回 / 隐藏 / 清空负记录               | 静态核对符合         | upsertMessage 保留撤回；history 校验范围；coverage 明确排除后删正文 / 引用；clearHistory 保留单调清空边界                                                                            |
| 已知消息更新完整持久化                       | 不通过               | CHAT-001                                                                                                                                                                             |
| 账号切换时旧聊天状态不展示给新账号           | 保护存在，动态未验证 | ChatProvider ownerKey、路由树 userId + sessionId key、current() owns；IndexedLocalStore.setOwnedValues 在同一事务核对 session；ApiClient 检查响应 auth 对象                          |
| 最近活跃 20 会话的补拉后缺口检查             | 部分未接入           | 查找调用点仅 ChatDriver.focus 派发 inspect；回前台会检查当前 focus。未见补拉完成后统一遍历最近 20 会话。当前未构造正常服务下确实丢消息的场景，登记验收缺口，不凭设计差异断言消息已丢 |
| 两端正常网络 5 秒同步、重启后完整回复        | 未验证               | 需要受控服务器 / 数据库与双端，不以代码与向量替代实测                                                                                                                                |

已阅读现有 `client.test.ts`（迟到响应、错误清会话、owned 事务）、`sync-runner.test.ts`（保存先于发送、保存失败、停止 / 断线旧回调）、`history.test.ts`（撤回与负记录、清空确认）、`sync-vectors.test.ts` 与相关向量；Web `chat.spec.ts` 已有真实 HTTP / WS、丢 ack、离线刷新、清空确认等测试代码。本轮没有重跑它们；公共全仓测试由主代理统一登记，测试代码存在不能等同目标 SHA 本轮执行成功。

## 额外风险与后续独立验证

- `message.updated` 广播发生在同步核心持久提交前，而且 UI overrides 不带 updateSeq。修复 CHAT-001 时应同时检查乱序旧更新、重复更新以及撤回后的显示单向性，避免内存覆盖优先于可靠状态；本轮未进行浏览器时序复现，不另立未经确认的缺陷。
- Web 输入框在异步 enqueue 落库期间仍可编辑，而 submit 成功后直接 setText 空串。建议后续慢存储浏览器用例覆盖点击发送后立即继续输入的草稿保留；本轮没有故意延迟真实 IndexedDB，未将此风险登记为已复现缺陷。
- 多标签页同时登录 / 退出、离线后换账号、持久存储配额不足、Android WorkManager 后台发送，以及真实推送延迟仍需设备和端到端环境验收。
- 本轮没有确认新的跨账号正文泄露，也没有覆盖所有 API、媒体或服务端授权路径；不能据此关闭已有账号与消息可靠性事项。

给开发方：修复 CHAT-001 后提供完整 SHA；由独立审查者确认持久消息与更新游标原子一致，并完成真实浏览器 / 多端复核。本次未做修复。
