# 交接说明：T-20261103c 广场「微伴角色」详情修复、主动消息接回语音 / 表情包

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead（第 1 项）+ ai-lead（第 2 项），一人顺序完成 |
| 日期 | 2026-11-03 |
| 分支 | `fix/plaza-official-proactive-forms-20261103` |
| 任务卡 | `docs/tasks/T-20261103c-plaza-official-proactive-forms.md` |
| 契约 | 不变（不升版本） |
| 迁移 | 无 |
| 依赖 | 已用 merge 合入 `origin/feat/ecology-v3-switches-20261103`（#44，开工时还没进 main）。#44 合入 main 后，需要在本分支再 merge 一次 origin/main |

## 做了什么

### 1. 广场「微伴角色」详情、点赞、评论（第 1 项，提交 `b482cce9`）

- **根因**（任务卡已查实）：详情、点赞、评论都先调用 `getOfficialProfile` 检查角色。这个函数原来借用了 `presetForCopy`，而 `presetForCopy` 是「复制成自定义角色」用的，碰到旧卡直接返回 null。生产上已上架的 677 个官方角色全是旧卡，所以详情页全部显示「不存在」。
- **服务端**：
  - `CharacterService` 新增 `publishedPresetSource`，判定口径和列表 `listOfficialIds` 一样：preset、已发布、存在即可，新卡旧卡都支持。不存在、未上架、非预设返回 null。
  - `getOfficialProfile` 改用 `publishedPresetSource`，不再借用 `presetForCopy`。「复制」口径不变，旧卡照样不能复制。
  - 公开人设摘要抽成纯函数 `domain/official-persona.ts`：
    - 旧卡：
      - `summary` 取资料页 `intro`，截 300 字；
      - `personality` 取 `soul_personality`，截 300 字；
      - `speechStyle` 取 `speaking_style`，为空时取 `style_chat_style`，截 200 字；
      - `catchphrases` 给空数组。
    - 新卡：和原来一样，取简介、性格、说话语气和前 5 个口头禅。
    - 新旧卡都不返回世界书、示例对话、避免词、开场白。截断按契约的长度口径，不会留下半个 emoji。
  - 顺带受益：后台「申请制作 → 完成」也用 `getOfficialProfile` 检查角色，现在旧卡角色也能关联了。
- **网页**：
  - `useRemote` 多返回一个 `errorCode`，取值为接口错误码，连不上服务器时是 `network_error`。这是只增不改，其他页面不受影响。
  - `OfficialRolePage` 只有 `not_found` 才显示「角色不存在或已下架」；网络错误或其他错误显示「加载失败」和原因，并带「重试」按钮。

### 2. 生态主动消息接回语音、表情包（第 2 项）

- **做法**：生态主动消息（`proactive.sendEcology`，未指定形式，即 `extras.extra = null`）在文字生成并通过输出检查后，调用聊天回复同一个函数 `MediaAiService.planExtras` 决定形式，不另定概率：
  - 语音的占比、间隔和长度上限照旧；
  - 表情包按 #38 的完整标签选图（`selectReplySticker` 用 tags），20 条内不重复，配额和保底照旧；
  - 最后由决策层按场景斟酌。
  - 主动消息没有「用户这一句」，所以 `userText` 传空串。「要语音」「要作品链接」这类点名请求不会触发；用户说过「不要」的形式，仍从最近 30 条用户原话里判断。
- **用户说过不要的形式不发**：`suppressedForms` 在 `planExtras` 里，和聊天回复同一份逻辑。只压制说过的那一种，例如说了「别发语音」，表情包照常斟酌。
- **私密模式**：会话是成人范围时，和聊天回复一样不进入形式判断，只发文字、不发语音。原有规则「私密模式点名发语音 → `voice_private_mode` 拒绝」保留。
- **其他条件**：
  - 树洞场景（`scenarioMode = treehole`）不主动发语音或表情包，和聊天口径一致；
  - 安全关怀跟进不走这条路；
  - 正文涉及经期等健康内容时，不进入自主多媒体判断，对应聊天里的 `sensitive`。
- **计费**：
  - 文字生成的参数没改（`billingOwner: 'user'`、`countAsBackground`、`ecologyTask`）。
  - `planExtras` 新增可选参数 `path`。传 `'proactive'` 时，决策层走 `path: 'proactive'`，语音合成带 `countAsBackground + ecologyTask`，和原来生态「发语音」同一口径。
  - 语音费用经新参数 `onMediaCharged` 报回，并进本次总费用：记在第一条消息的 `charge` 上，也通过 `SendOutcome.chargedMicros` 带回生态运行记录。
  - 聊天回复路径不传这两个参数，行为不变。
- **计数**：「3 次无回复」和早安晚安的单独计数，是按 `ecology_runs` 的动作行算的，不按聊天条数（见 `ecology-counters.ts`）。一次主动消息多带一条语音或表情包，仍只算一次运行，计数不受影响，本次没改计数代码。
- **发送顺序**：语音（替代文字）或文字气泡在前，表情包在后（幂等键 `proactive:{planId}:form:{n}`），然后是原有的链接或图片。
- **重复定义收拢**：「角色自带默认音色」原来写在 `reply-context.ts` 里，现在抽成 `character-view.ts` 的 `roleDefaultVoiceId`，回复和主动消息共用一处，逻辑不变。

## 改了哪些文件

- 第 1 项
  - `apps/server/src/modules/characters/application/characters.ts`（新增 `publishedPresetSource`）
  - `apps/server/src/modules/characters/application/plaza-port.ts`（`getOfficialProfile`）
  - `apps/server/src/modules/characters/domain/official-persona.ts`（新）
  - `apps/server/src/modules/characters/application/plaza-official.test.ts`（新）
  - `apps/server/src/modules/plaza/application/plaza-official.service.test.ts`（新）
  - `apps/web/src/data/use-remote.ts`（新增 `errorCode`）
  - `apps/web/src/features/role-plaza.tsx`（`OfficialRolePage` 区分错误）
- 第 2 项
  - `apps/server/src/modules/ai-runtime/application/proactive-scheduler.ts`（`send()` 接入形式判断）
  - `apps/server/src/modules/ai-runtime/application/media-ai.ts`（`planExtras` 的 `path` / `onMediaCharged`）
  - `apps/server/src/modules/ai-runtime/application/character-view.ts`（`roleDefaultVoiceId`）
  - `apps/server/src/modules/ai-runtime/application/reply-context.ts`（改用 `roleDefaultVoiceId`）
  - `apps/server/src/modules/ai-runtime/application/proactive-forms.test.ts`（新）
- 本交接

## 自测结果（本机各项只跑一次）

- 类型检查：第 1 项后 `apps/server`、`apps/web` 通过；第 2 项后 `apps/server` 通过（第 2 项没动网页）。
- eslint、prettier：改动文件均通过。
- 单测：
  - 第 1 项：2 个新文件，6 个用例通过。覆盖：旧卡已上架能取到详情，人设只摘几项并按长度截断，不含世界书、开场白、避免词；有 `speaking_style` 时优先用它；未上架、草稿、非预设、不存在返回 null；旧卡 `presetForCopy` 仍是 null；plaza 侧详情和点赞成功；端口返回 null 时详情和点赞都是 `not_found`，也不写点赞。
  - 第 2 项：新文件 5 个用例，真实的 `planExtras` 加桩依赖，覆盖：
    - 形式判断确实被调用（`path: 'proactive'`、`userText` 为空），批准后发语音加表情包；
    - 计费：语音合成带 `countAsBackground + ecologyTask`；总费用为文字 100 + 语音 200 = 300，记在第一条消息上并带回结果；
    - 文字生成参数不变；
    - `suppressedForms` 两种都压制时只发文字、不问决策层、不合成语音；只压制语音时表情包照常；
    - 私密模式不调用 `planExtras`、不合成语音；私密模式点名发语音仍被拒绝。
  - 相关旧用例一起回归：`media-ai-batch`、`media-ai-diversity`、`proactive-*`、`ecology-*`、`gap-closure`、`call-agent`、`image-understanding` 等，共 15 个文件、133 个用例全部通过。
- 全量测试、数据库集成测试、构建以 CI 为准。

## 遗留问题

1. **「图片」形式没有接**：任务卡写的是「语音、表情包、图片等形式」。但聊天回复的形式判断（`planExtras`）只管语音、表情包，以及用户点名时的作品链接，没有「自主发图」这一支（`media-ai.ts` 里的 `CharacterImageService` 没有使用）。对照表 v3 第 12 项写的是「聊天里按素材自然出现」，也没有现成规则。按任务卡「不新造概率规则」，这次没给主动消息加图片。主动消息里原有的几处图片发送都没动：日常事件配图 `wantEventPhoto`、宠物照片、`extras.photoMediaId` 微博图片。如果要让聊天回复和主动消息都能自主发图，需要产品先定规则，再另开任务。
2. **#44 还没合入 main**：本分支已 merge #44 的分支。#44 合入后需要在本分支再 merge 一次 origin/main，再看一遍 CI。如果 #44 合入前又有改动，可能会有小冲突，主要在 `proactive-scheduler.ts` 和 `ecology.ts`。
3. **主动消息比原来多一次决策层调用**：只有当语音或表情包确实有候选时才会调用，计入后台消耗，和聊天回复的形式判断同一价格，不额外收费。

## 需要总负责人决定的事

- 遗留 1：主动消息和聊天回复要不要加「自主发图」。这要先定产品规则，建议另开任务，不在本 PR 里做。

## 给其他负责人的交接

- 给总负责人：PR 合并前请确认 #44 已先合入，再让本分支 merge 一次 origin/main。无迁移，契约不变，合入后照常重新构建服务端镜像即可。
- 给 web-lead：`useRemote` 新增了 `errorCode` 字段，其他页面以后要区分「不存在」和「加载失败」时可以直接用。
- 给 Codex（整体验收时）：重点看三处：
  - `characters.ts` 的 `publishedPresetSource` 与列表口径是否一致；
  - `official-persona.ts` 有没有多带非公开字段；
  - `proactive-scheduler.ts` 的形式判断进入条件（私密模式、关怀、树洞）和费用合并。
