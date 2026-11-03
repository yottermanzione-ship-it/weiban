# 交接：聊天里按素材发图片、群聊也能发表情包（T-20261103g）

> 负责人：AI 系统负责人 · 2026-11-03 · 任务卡 `docs/tasks/T-20261103g-chat-photo-group-sticker.md`
> 分支 `feat/chat-photo-group-sticker-20261103`，PR base main。不改契约字段、没有数据库迁移。

## 1. 结论

- **私聊分享照片**做完了，私聊回复和生态主动消息都能用。照片只取角色已入库、已审核的微博素材图。模型自己决定发不发，想发就写 `[照片]`，服务端剥掉标记后把那张图跟在文字后面发出。这个用户收到过的图不再发。
- **群聊表情包**复用了 #47 的做法。同一轮最多 1 个角色带表情；每个角色每 10 条最多 3 个，不连发；群聊一次发言最多 3 条（含表情）。
- **清理**：生态里按关键词取情绪的「发表情包」「发照片」旧分支已经走不到，已删除。
- 新增约束「**同一轮最多一种媒体附加**」：作品链接 > 照片 > 表情包，语音不算附加。总条数仍封顶 4 条。

## 2. 做法

### 2.1 私聊分享照片

| 环节 | 做法 | 代码 |
|---|---|---|
| 素材 | 角色最近 30 天内仍生效的最多 5 条微博公开动态（`public_updates.status='effective'`），只取已转存进 `weibo_item_media` 的图。聊天时不抓页面、不生图、不找网图。素材文字太短（不足 4 字）、涉及健康隐私或过不了日常输出检查的不用 | `WeiboMaterialService.shareable`、`domain/photo-marker.ts photoMaterialAllowed` |
| 选图 | 从最新那条起，排除「收到过」的图，再按「用户 + 素材」稳定挑一张（`weiboPickImage`，与 #44 删掉的 `weiboPhotoForEcology` 同一公式）。「收到过」有两个来源：一是聊天记录里角色发过的图；二是图片描述存档 `image_captions` 里这个用户已有记录的图。第二个来源跨越聊天窗口 | `application/chat-photo.ts ChatPhotoService.offer` |
| 提示词 | 规则允许且有图时，在动态结尾加「分享照片」一节（原文见第 3 节） | `reply-context.ts`、`proactive-scheduler.ts` |
| 剥标记 | 拆条前剥掉 `[照片]` 类标记，所有输出路径都剥，包括私聊、名字重写重试、主动消息和群聊（群聊只剥不发）。能剥的写法包括全角括号、`[图片]`、`[分享照片]`、`[照片:说明]`、`[photo]`，以及照聊天记录学写的「[你发了一张图片：…]」。正文只剩标记时补一句「给你看看这张」 | `domain/photo-marker.ts takePhotoMarker`、`reply-engine.ts` |
| 发送 | 模型写了标记，才发提示里给的那张（存在 ReplySnapshot 的 `photoOffer`，内部格式不是契约）。发之前复核两件事：这张图仍在可分享素材里；媒体还在而且是图片。发出后存进图片描述存档，之后聊天记录显示「[你发了一张图片：微博配图（10月30日的微博：「…」）]」 | `media-ai.ts planExtras`、`ChatPhotoService.content / remember` |
| 硬规则 | 用户说过不要图片就不发（`suppressedForms` 新增 `photo`，明确说「发张照片给我」等就恢复；「我给你发张照片」不算）。以下场景不发：私密 / 成人、涉及健康、树洞、关怀、严肃。每 20 条角色消息软上限 2 张，不连发。提示词阶段和发送阶段各查一遍 | `domain/reply-media-rules.ts photoRoom`、`chat-form-suppression.ts` |
| 条数 | P-02 封顶 4 条：先合并文字；合并不下时，从后往前去掉表情包、照片、链接 | `domain/reply-delivery.ts fitReplyContents` |

### 2.2 群聊表情包

- 群聊发言的提示词末尾加群聊版表情说明。模型写 `[表情:情绪]`，服务端按情绪挑图（`MediaAiService.groupStickerPrompt / pickGroupSticker`）。
- 防刷屏：
  - 这轮已有角色带过表情（触发消息之后出现过角色表情）时，别的角色不给提示，写了也只剥不发。
  - 每个角色只数自己的消息：每 10 条最多 3 个，不连发。
  - 20 条内不重复同一张，按全群算。
  - 用户在群里说过不要、树洞时不配；严肃场景只列安慰。
  - 群聊不加保底提醒。
- 条数：带表情时文字最多 2 条，加上表情最多 3 条。表情跟在文字后面发，幂等键是 `…:sticker`。文字没发完（用户插话、群被解散）就不发表情。可靠回复计划重放时，沿用已经挑好的表情。
- 群聊记录里库内表情显示为「[表情] 表情 12」，模型可能照着写，所以剥的时候整段去掉（`sticker-marker.ts LIBRARY_ECHO`）。

### 2.3 清理

- `sendEcology` 只会以 `extra: null` 调用。生态里点名 `sticker` / `photo` 的动作在 #44 后会落到 `not_implemented`，所以主动发送里 `extra === 'sticker' | 'photo'` 的两个分支（按 brief 关键词取情绪、`photoMediaId`）已经走不到，连同 `EcologySendExtras` 的 `scene / photoMediaId` 一起删掉。
- `ecology.ts ACTION_BRIEF` 里的 sticker 文案也已删除。契约枚举和 `ACTION_DEF` 里的 sticker / photo 条目保留，因为契约还在用。
- `media-ai.ts` 删掉了 `pickStickerForEcology / hasStickers` 和私有的 `pickSticker`。

### 2.4 改动文件

- 新增：
  - `domain/photo-marker.ts`
  - `domain/reply-media-rules.ts`（规则从 media-ai 挪出并泛化）
  - `application/chat-photo.ts`
  - 单测：`photo-marker.test.ts`、`reply-media-rules.test.ts`、`chat-photo.test.ts`、`media-ai-photo.test.ts`、`group-chat-sticker.test.ts`
- 修改：
  - `chat-form-suppression.ts`、`sticker-marker.ts`、`reply-delivery.ts`、`reply-media-candidates.ts`（注释）
  - `media-ai.ts`、`reply-context.ts`、`reply-engine.ts`、`proactive-scheduler.ts`、`group-chat.ts`、`weibo-material-service.ts`、`ecology.ts`、`ai-runtime.module.ts`
  - 对应单测：`chat-form-suppression`、`sticker-marker`、`reply-delivery`、`proactive-forms`
  - `test/ai-runtime.test.ts`（真库）
  - `docs/ai/media-understanding.md` 3.3

## 3. 提示词改动原文（系统提示部分）

**私聊回复 / 生态主动消息，新增「分享照片」一节**（规则允许且有图时才出现；私聊放在「表情包」一节后面，主动消息拼在最后一条提示末尾）：

```
这轮可以分享一张你最近的照片，像真人聊天那样偶尔分享，不用每轮都发。
这张照片是你{M月D日|最近}发的微博里的配图，那条微博写的是：「{微博正文摘录，最多 80 字}」。你看不到照片本身，聊到它时只按这条微博说，不编造照片里的细节，也不说是刚拍的。
想分享时，在正文最后另起一行写 [照片]，系统会把这张照片跟在你的文字后面发出；这行标记对方看不到，不算括号动作。正文照常要有文字；和现在聊的话题不搭就不写。
这轮照片和表情包最多选一样，不要两个标记都写。   ← 只在这轮也给了表情说明时出现
```

**群聊发言，新增表情说明**（拼在群聊「【系统提示】」末尾，能配时才出现）：

```
这条群消息可以配一个表情包，像真人在群里聊天那样偶尔用一下，不用每次都配。
想配时，在正文最后另起一行写 [表情:情绪]，情绪只能从这几个里选一个：{该角色这轮挑得出图的情绪}。
系统会按情绪配一张合适的表情图，跟在你的文字后面发出；这行标记群里的人看不到，不算括号动作。正文照常要有文字；语气不合适或没有贴切的情绪就不写。
群里有人心情不好，只能配安慰类的表情，别的情绪都不要配。   ← 只在严肃场景出现
```

私聊表情说明不变，只是这几句的措辞改成了参数化：「这行标记{对方|群里的人}看不到」。

**聊天记录里的写法**（不是系统提示，但模型会读到）：角色发过的素材照片，原来显示为 `[你发了一张图片]`，有存档时改成 `[你发了一张图片：微博配图（10月30日的微博：「…」）]`。

## 4. 自测结果（本机只跑一次）

- `pnpm typecheck`（apps/server）：通过。
- ESLint（改动文件）：0 问题。Prettier：已按规则格式化。
- 相关单测分三批运行，全部通过：第一批 10 个文件 126 例，第二批 12 个文件 135 例（reply-delivery 重复跑了一次），群聊新测 4 例。涉及的文件：
  - photo-marker、reply-media-rules、chat-form-suppression、sticker-marker、reply-delivery、reply-media-candidates
  - media-ai-batch、media-ai-diversity、media-ai-photo、chat-photo、proactive-forms、group-chat-sticker
  - weibo-material-service、character-image、ecology-gate / jev / settings-cleanup、ecology 领域测试等
- 覆盖任务卡要求的场景：
  - 有素材时剥标记并发出对应的图；没素材时不给提示也不发
  - 收到过的图不再发（聊天记录和存档两个来源）
  - `photo` 压制和恢复、私密、树洞、健康、严肃、20 条 2 张、不连发分别生效
  - 4 条封顶时照片算一条
  - 照片和表情只发照片，链接和照片只发链接
  - 主动消息发照片并写进存档
  - 群聊：剥标记并带上表情；同一轮已有角色带过表情时不配；不连发；带表情时文字最多 2 条；照片标记在群里只剥不发
- `test/ai-runtime.test.ts` 新增一个真库用例（模型写 `[照片]`、没有素材时只剥不发）。它要 PostgreSQL，本机没跑，以 CI 为准。

## 5. 遗留问题

1. **生产上可能很少有图可分享**：聊天时不抓页面，只用已经转存的微博素材图。目前转存只发生在后台素材流程和朋友圈转发时，所以有些角色可能长期没有可分享的图（没有图就安静不发，不报错）。要多一些，需要素材流程定时预先转存图片，属于后端 / 运维范围。
2. **朋友圈转发过的微博图没算「收到过」**：用户可能在朋友圈见过这张图，私聊里又收到一次。要不要互相排除，请产品定。
3. 群聊只读最近 40 条，「这轮已有人带过表情」和「每 10 条 3 个」都在这 40 条里算，够用，但特别热闹的群会略宽松。
4. **行为变化**：一轮最多一种媒体附加后，用户要作品链接时，即使模型写了表情标记，这轮也不再附表情（以前链接和表情可以同时发）。
5. 主动消息中自带图片或链接的路径（宠物照片、日常事件配图、作品分享、生态点名链接）本来就不进形式判断（`formsEligible` 只对生态的 `extra: null` 成立），所以不会和照片、表情叠加，这次没有改动。

## 6. 给其他负责人的交接

- **产品负责人**：
  - PRD MED-02 第 2 条要求「真人角色图片中不得出现本人或任何可识别真人的肖像」，这条是针对生成图写的。这次分享的是角色本人微博里已审核的配图（朋友圈转发已经在用同样的图），可能含本人照片。两者口径不一致，请总负责人或产品裁定（见第 7 节）。
  - 第 5 节第 2、4 条需要确认。
  - PRD MED-01 第 4 条（10 条 3 个）已经同步，#47 遗留的 2→3 冲突已解决。
- **后端 / 运维**：见遗留问题第 1 条（素材图预转存）。
- **Codex 验收**：重点看三处：标记在所有输出路径都剥掉；照片只来自 `weibo_item_media`；「收到过」的两个来源都生效。

## 7. 需要总负责人决定的事

- **真人角色能不能在私聊里分享本人微博配图**（可能含本人肖像，与 PRD MED-02 第 2 条字面冲突）。现在按任务卡口径实现，真人角色也会分享。如果要禁止，只需在 `ChatPhotoService.offer` 里对 `isRealPerson` 直接返回 null，改动很小。
