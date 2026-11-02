# 交接说明：T-20261103b 生态开关按 v3 收拢（含私人朋友圈开关）、碎碎念修正

| 项 | 内容 |
|---|---|
| 负责人 | ai-lead |
| 日期 | 2026-11-03 |
| 分支 | `feat/ecology-v3-switches-20261103`（已合入 origin/main `e5bc08a3`，即 #43 契约 5.1 之后） |
| 契约 | 5.1 → **5.2**（次版本：新增枚举值 `private_moments`，不删不改） |
| 迁移 | 无 |

## 做了什么

### 1. 开关只显示 6 个（契约 + 服务端 + 网页 / 后台文案）

- 契约 `ECOLOGY_ACTION_KEYS` 新增 `private_moments`（私人朋友圈），其余旧 key 全部保留在枚举里。旧客户端在 PATCH 里带旧 key 不会报 400，只是不起作用。
- 服务端新增一处定义 `ECOLOGY_SWITCHES`（`domain/ecology.ts`），写明 6 个开关和每个开关管哪些动作：
  - 主动消息 `message`：message、早安晚安、纪念日、久未问候、跟进
  - 私人朋友圈 `private_moments`：微博同步、发私人朋友圈
  - 更新状态、改个性签名、照顾宠物（仍置灰）、群聊主动话题

  `getEcology` 只返回这 6 项，分组沿用原来的（私人朋友圈归 `moments` 组）。
- 私人朋友圈仍按 `weibo_sync`、`moment_post` 两个 key 存进 `disabled_actions`，无需迁移：
  - 关掉 = 两个都写入；打开 = 两个都去掉。
  - 只要不是两个都被关，就显示为开；用户下次切换时统一写成两个都开或两个都关。
- 旧数据里单独关掉的 care_absence、care_follow_up、voice 等不属于 6 个开关的 key：读的时候忽略（跟随主动消息或归基础层），写的时候原样保留，回滚时不会丢。
- 平台级 `disabledActions` 关掉某个开关，或关掉它覆盖的某个具体动作，都仍然生效。
- 「三次没回」计数（`ecology-counters.ts`）没有改：早安晚安、跟进仍不计入主线。
- 网页 `ecology.tsx` 本来就只渲染服务端返回的开关，没有写死旧 key。只改了两处说明文字（「发朋友圈」改为「发私人朋友圈」）。后台 `ACTION_NAMES` 补了 `private_moments` 的中文名。

### 2. 基础层不再受生态闸门控制

- `moments-ai.ts` 去掉了三处 `isActive(..., 'moment_interact' | 'moment_peer' | 'moment_reply')`，改成基础层判断：
  - 账号状态正常且未封禁（`baseLayerAccountOk`）
  - 角色在通讯录里（`contacts.getActiveContact`）
  - 可见范围：沿用原来的 `visibleCharacterIds` 和 `relatedContacts.added`

  不再要求 PRO+、生态总开关、角色生态开关或动作开关。旧版机制保持不变：点赞和评论分开排、延迟 1–15 分钟、各自去重、人数和概率上限。
- **计费入口（任务卡要求写明）**：用网关 `generateText` 的 `billingOwner: 'user'` + `countAsBackground: true`，**不带 `ecologyTask`**。
  - 依据：ADR-0032 和 `docs` 里「后台消耗由用户承担」的现有用法，和聊天里的后台消耗走同一条路。
  - 「你评论角色动态 → 角色必回」（`mustReply`）仍按聊天回复计费，不算后台消耗，和原来一样。
  - 网关返回 `insufficient_balance` 或 `budget_exceeded` 时直接跳过：不写评论、不抛错，必回任务也不重试。其他生成失败仍按原逻辑让必回任务重试。
  - 因为不带 `ecologyTask`，积分不足**不会**触发生态的「积分不足暂停」。
- 生态候选里去掉了语音、图片、表情包、拍一拍、熬夜催睡和朋友圈三种互动。这些在执行器里对应的分支，以及 `reactForEcology`、`weiboPhotoForEcology`、`voiceReady`，都已删除。
  - 聊天流程里的形式判断（`media-ai.ts`）本来就不看生态开关，没有改。
  - 用户说过「不要语音 / 图片 / 表情」的 `suppressedForms`（聊天路径 `media-ai.ts`、`chat-form-suppression.ts`）保留。生态这边的那份抑制，是跟着已删的形式候选一起去掉的。
- 官方角色公共朋友圈 `postPublic` 没有改。共同事件 `coordinateDay` 仍只给开着生态的用户安排（`runForUser` 仍调用 `isActive(userId)`）。

### 3. 碎碎念修正（宁静那条像提示词）

- 新文件 `domain/ecology-murmur.ts`，素材单独组装，**不再复用 `jevSummary`**。素材只有这几项：
  - 当前时段（如「现在是周一晚上。」）
  - 角色自己的状态和签名
  - 最近 7 天自己发的朋友圈（最多 2 条）
  - 今天自己的事：共同事件里当天的，加上推演的日常事件，最多 3 条
  - 这次做了什么（「刚才：…」；什么都没做时写「看了看手机，没做什么」）

  任何一条里出现「对方 / 用户 / 角色」或健康隐私，整条丢掉，不出现计数口吻。
- 提示词改成「用你自己的口吻，随手写一两句此刻的心里话或身边的小事……60 个字以内」，不再出现「日记 / 碎碎念 / 人设」这类词。
- `maxOutputTokens` 从 80 提到 200（`MURMUR_MAX_OUTPUT_TOKENS`）。服务端用 `truncateMurmur` 截到 60 字以内，规则如下：
  - 截在最后一个句末标点之后，收尾的引号或括号一并保留。
  - 前 60 字里没有句末标点时，退到最后一个逗号，后面换成「…」。
  - 连逗号都没有就丢弃，不留半句话。
  - 按字符计数，emoji 不会被截成半个。
- 元话语过滤（`murmurLooksMeta`），出现以下任一情况就整条丢弃，**不重试、不写库**；这次调用的费用照记（模型确实调用了）：
  - 词：角色、对方、用户、碎碎念、日记、人设、提示词、以下、好的、作为、第一人称、不超过、素材、输出、字数
  - 开头是「xx：」这类标签
  - 复述素材栏目名（「我现在的状态」「刚才：」等）
  - 「N 字」

  唤醒记录照常写，只是 `murmur` 为空。

### 4. 顺带

- `apps/server/scripts/build.mjs` 的入口补上了 `seed-sticker-labels`。

### 5. 契约版本 5.2

- 开工前已 `git fetch`，确认 origin/main 的 `version.ts` 是 5.1（#43 已合入），然后用 merge 合进本分支，无冲突。
- 升 5.2 时同步了：`version.ts`、README 变更记录、`service-unit-pricing.test.ts` 的版本断言、`pnpm android:generate` 的生成产物（`Contracts.kt`、`contracts.json`）。
- `docs/ai/ecology-v1.md` 文首补了一条 v3 说明，表格里过时的几行已标注。

## 改了哪些文件

- 契约
  - `packages/contracts/src/http/ecology.ts`
  - `packages/contracts/src/version.ts`
  - `packages/contracts/README.md`
  - `packages/contracts/test/ecology-actions.test.ts`
  - `packages/contracts/test/service-unit-pricing.test.ts`
- Android 生成产物
  - `apps/android/core/contracts-generated/src/main/kotlin/app/weiban/contracts/Contracts.kt`
  - `apps/android/core/contracts-generated/src/main/resources/contracts.json`
- 服务端（`apps/server/src/modules/ai-runtime/`）
  - `domain/ecology.ts`
  - `domain/ecology-murmur.ts`（新）
  - `domain/ecology-murmur.test.ts`（新）
  - `domain/ecology-actions-cleanup.test.ts`
  - `application/ecology.ts`
  - `application/ecology-settings.ts`
  - `application/moments-ai.ts`
  - `application/ecology-murmur-service.test.ts`（新）
  - `application/ecology-settings-cleanup.test.ts`
  - `application/moments-reactions-split.test.ts`
  - `application/gap-closure.test.ts`（删了已不存在的生态 photo 用例）
- 构建：`apps/server/scripts/build.mjs`
- 前端
  - `apps/web/src/features/ecology.tsx`（仅文案）
  - `apps/admin/src/features/ecology.tsx`（仅中文名）
- 文档
  - `docs/ai/ecology-v1.md`
  - 本交接

## 自测结果（本机只跑了一次）

- 类型检查：`apps/server`、`packages/contracts`（两份 tsconfig）均通过。网页和后台只改了文案和一条映射，没有单独跑，交给 CI。
- 单测：相关的 14 个文件、119 个用例全部通过：
  - 碎碎念素材、截断和元话语
  - 碎碎念服务层（请求里不含运营摘要、上限 200、元话语丢弃后 `murmur: null`、费用照记）
  - 6 个开关的分组、标签、映射和合并规则
  - 朋友圈基础层：生态关着照样排、不调用 `isActive`、账号异常或封禁不排、不在通讯录不排
  - 计费：`billingOwner: 'user'` + `countAsBackground`，不带 `ecologyTask`
  - 积分不足跳过；真正的生成失败仍重试
- 合并 origin/main 并升 5.2 后，又跑了一次 `service-unit-pricing` 和 `ecology-actions` 两个契约测试：11 个用例通过。
- eslint 和 prettier：改动文件均通过。
- 其余（全量测试、web / admin 构建、`android:generate:check`）以 CI 为准。

## 遗留问题

1. **任务卡内部不一致**：「显示状态以『两个都没被关』为开」和「旧数据只关了其中一个，显示为开」两句互相矛盾。我按后一句明确的写法实现：只要不是两个都被关，就显示为开；下次切换时两个统一写。产品如果另有口径，只需改 `switchEnabled` 一处。
2. **旧客户端**（5.1 及以前的网页缓存或 Android）读到 `private_moments` 会读成 `unsupported`。如果旧客户端对这一项点切换，会把非法 key 发上来，收到 400。这项本来就不该出现在旧界面上，影响很小。新版网页走同一份契约，没有这个问题。
3. **生态「主动消息」现在只发文字**。任务卡说主动消息「可以继续用」语音、表情这些形式送达，但目前 `sendEcology` 的 `extras.extra` 固定为 `null`，原来的形式是靠独立候选动作挑的，候选删掉后就没有入口了。如果要让主动消息也能带语音、表情，需要另开一项，在 `proactive.sendEcology` 里按聊天的形式判断来选（会受 `suppressedForms` 约束）。
4. 朋友圈私密模式写回复的 `privateConversationId` 参数原来只在生态的 `moment_reply` 里传，现在那条路已删，参数没人用了。基础层回复按日常范围写，和非私密时一致。要不要按私密模式写，留给后续决定。
5. 碎碎念在非私密模式下的那次调用，原来就没带 `countAsBackground` / `ecologyTask`，本次没有改。计费口径如需统一，另开一项。
6. 生态唤醒里「今天已经做过」等快照摘要原样保留，仍只给 Jev 做决策用。

## 需要总经理决定的事

无。以下两点建议由总负责人确认：遗留 1（部分状态的口径），遗留 3（主动消息要不要恢复带语音 / 表情的形式）。

## 给其他负责人的交接

- 给总负责人：PR 合入后，生产需要重新构建服务端镜像，这样 `seed-sticker-labels` 才会进镜像。无迁移。契约 5.2 是次版本，WebSocket 已放行 5.x。
- 给 web-lead：生态页不用改代码，开关列表来自服务端。如果网页有缓存的旧包，用户刷新后就能看到 6 个开关。
- 给 android-lead：生成产物已同步到 5.2。安卓端如果有生态开关界面，按服务端返回的 `actions` 渲染即可；`private_moments` 是新枚举值。
- 给 Codex（整体验收时）：重点看三处：
  - `moments-ai.ts` 的基础层判断与计费参数
  - `ecology-settings.ts` 的 `switchEnabled` / `mergeDisabledActions`
  - `domain/ecology-murmur.ts` 的过滤与截断
