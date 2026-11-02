# 交接说明：T-20261103d 表情包改为聊天模型自己决定

| 项 | 内容 |
|---|---|
| 负责人 | ai-lead |
| 日期 | 2026-11-03 |
| 分支 | `feat/sticker-model-decides-20261103` |
| 任务卡 | `docs/tasks/T-20261103d-sticker-model-decides.md` |
| 契约 | 不变：主标签从 `tags[0]` 读，没有新增字段 |
| 迁移 | 无 |

## 结论

以前一条回复要连过五关才能带上表情包，所以 14 天 0 条。现在改成：

1. 写回复的聊天模型自己决定带不带、带什么情绪。它在正文最后写 `[表情:开心]` 这样的标记。
2. 服务端先剥掉标记（用户看不到），再按情绪从已回填完整标签的图里挑一张。
3. 只保留硬规则当安全阀。

已去掉三样：关键词闸门、28% 抽签、决策层的表情审批。决策层现在只问语音一题。

## 改了什么

| 文件 | 改动 |
|---|---|
| `apps/server/src/modules/ai-runtime/domain/sticker-marker.ts`（新） | 剥标记、取情绪；提示词说明文字 |
| `apps/server/src/modules/ai-runtime/domain/reply-media-candidates.ts` | 10 个情绪常量；`pickStickerForMood` 按情绪挑图；`availableStickerMoods`；删掉 `selectReplySticker`（关键词闸门） |
| `apps/server/src/modules/ai-runtime/application/media-ai.ts` | `stickerRoom` 硬规则（提示阶段和发送阶段共用）；新增 `stickerPrompt`；`planExtras` 加入参 `stickerMood`，删掉表情的抽签、保底和决策层问题；软上限 2→3 |
| `apps/server/src/modules/ai-runtime/application/reply-context.ts` | 动态结尾加「表情包」一节，只在这轮能配时出现 |
| `apps/server/src/modules/ai-runtime/application/reply-engine.ts` | 每次模型输出都剥标记。最终用哪次输出的正文，就用哪次的情绪；换成兜底说法时不带表情。情绪传给 `planExtras` |
| `apps/server/src/modules/ai-runtime/application/proactive-scheduler.ts` | 生态主动消息（未指定形式）：生成前先算能不能配，能配就在提示里告诉模型；所有主动消息拆条前都剥标记；情绪传给 `planExtras` |
| `apps/server/src/modules/ai-runtime/domain/image-caption.ts` | 看图存档提示的一句措辞（见下） |
| `apps/server/src/modules/media/application/sticker-labels.ts` | 只补注释：主标签固定在第一位，ai-runtime 按 `tags[0]` 读 |
| 测试 | 新增 `sticker-marker.test.ts`；改写 `reply-media-candidates.test.ts`、`media-ai-batch.test.ts`、`media-ai-diversity.test.ts`、`proactive-forms.test.ts`、`character-image.test.ts`；`test/ai-runtime.test.ts`（真实 PG）补一例「用户正文不残留标记」 |
| 文档 | `docs/ai/media-understanding.md` 3.3「表情包」、`docs/ai/behavior-planning.md` 2.1 `reply_form` 行 |

### 细节

- **标记写法**：推荐 `[表情:情绪]`，写在正文最后另起一行。下面这些也都认、都剥：
  - 全角括号、中文冒号，如 `【表情：开心】`；
  - 「表情包」写法、`[sticker:happy]`；
  - 没写情绪的 `[表情]`；
  - 模型照聊天记录学写的 `[你发了一个表情包：…]`。
  - 多个标记取最后一个有效的。
  - 清单外的情绪（如「生气」）只剥标记，不发表情，也不报错。
  - 正文只剩标记时补一句很短的话（如「晚安」），绝不发空回复。
- **剥离位置**：先剥图片存档尾标，再取【正文】之后的内容，最后剥表情标记，然后才拆条。私聊每一条输出路径都剥，包括看不到图重答、边界重写、人名重写；所有主动消息也都剥。
- **挑图**：
  - 候选：`listStickersForCharacter` 返回的图（标签排除的已剔除）里，主标签 `tags[0]` 等于该情绪的那些；
  - 评分：回复加用户原话，和图的完整描述、图里文字、字面意思、使用意思、适合场合比较本地相似度（按相邻两个字计算重合，不调用付费模型）；
  - 从最贴切的几张里按 seed 取一张，避免总是同一张。
  - 没有标签的旧图退回 description 关键词判断，带数字的说明一律排除。
  - 该情绪没有图就不发，不换成别的情绪。
- **硬规则**（提示阶段和发送阶段共用 `stickerRoom`）：
  - 用户说过不要表情包就不发（suppressedForms）；
  - 私密 / 成人、涉及健康、树洞、关怀都不发；
  - 严肃场景只允许安慰：提示里只列安慰，发送时再按回复复核；
  - 上一条角色消息是表情包就不发（不连发）；
  - 每 10 条角色气泡软上限 3 个；
  - 20 条内不重复同一张。
- **只列有图的情绪**：提示词只列该角色这轮真能挑出图的情绪，避免模型选了却没有图。
- **保底**：连续 9 条角色消息没带表情、这轮又不严肃时，提示里加一句提醒。服务端不硬塞。
- **主动消息**：#45 的 `planExtras` 复用照旧。生态主动消息（`extra = null`、日常范围、非关怀）在生成前用同一套规则算好提示，生成后把情绪交给 `planExtras`。私密模式、关怀不给提示。

## 提示词改动原文（只含系统提示部分）

**新增「表情包」一节。** 私聊放在动态结尾的【私聊场景】之后，标题为【表情包】；生态主动消息接在最后一条「【系统提示，不是用户说的话】…」后面。只在这轮能配时出现，`{情绪}` 只列该角色这轮挑得出图的情绪：

```
这轮可以配一个表情包，像真人聊天那样偶尔穿插，不用每轮都配。
想配时，在正文最后另起一行写 [表情:情绪]，情绪只能从这几个里选一个：{开心、喜欢、安慰、累了、赞同、打招呼、晚安、再见、谢谢、道歉 中可用的}。
系统会按情绪配一张合适的表情图，跟在你的文字后面发出；这行标记对方看不到，不算括号动作。正文照常要有文字；语气不合适或没有贴切的情绪就不写。
```

严肃场景追加一句（同时情绪只列「安慰」）：

```
对方这轮心情不好，只能配安慰类的表情，别的情绪都不要配。
```

保底提醒（连续 9 条没配、不严肃时追加）：

```
你已经连着好几条没配表情了，这轮语气合适的话可以配一个。
```

**看图存档提示改一句**，以免和表情标记冲突，用户第一次发自定义表情时正需要它：

- 原：`回复正文写完后，另起一行输出图片存档（这是平台存档格式，对方看不到，是本轮唯一允许的例外格式）：`
- 新：`回复正文写完后，另起一行输出图片存档（这是平台存档格式，对方看不到，不受「只输出聊天纯文本」的限制）：`

**删掉**决策层的表情问题原文：`是否附带已匹配的表情？stickerMeaning是候选含义……仅在相符且不显得轻浮时选keep_sticker，否则no_sticker`。

## 自测结果（本机各跑一次）

- 服务端类型检查 `pnpm typecheck`：通过。
- 改动文件 ESLint：通过；Prettier 已格式化。
- 相关单测 8 个文件 93 例全过：`sticker-marker`、`reply-media-candidates`、`media-ai-batch`、`media-ai-diversity`、`proactive-forms`、`character-image`、`sticker-labels`、`planner-batch`。另跑 `image-caption`、`reply-rules` 25 例，也全过。
- 任务卡要求的覆盖项：
  - 标记被剥离且挑中对应情绪的图：覆盖；
  - 没有标记就不发：覆盖；
  - suppressedForms、私密、严肃只允许安慰、不连发、软上限（3 个不发、2 个能发）：各自覆盖；
  - 主标签不在清单内的图不选：覆盖；
  - 清单外情绪不发、不报错：覆盖；
  - 主动消息：提示出现、标记剥掉、情绪传入、没标记不发、私密模式无提示：覆盖。
  - 标签排除（review_needed / retry_excluded）在列表阶段剔除，已有 `sticker-labels.test.ts` 覆盖。ai-runtime 拿到的列表本来就不含这些图。
- `test/ai-runtime.test.ts` 新增的真实 PG 用例本机没跑，交给 CI。
- 没有真实模型的效果数据。模型是否按提示写标记，要上线后看生产统计。

## 遗留问题

1. **文档冲突（需上报）**：PRD `docs/product/prd-v1/08-media-call.md` 第 17 行（MED-01 第 4 条）和 `docs/ai/character-card-spec.md` 的 `stickerRate` 都写「每 10 条气泡不超过 2 个」。代码按任务卡放宽为 3 个。PRD 归产品负责人，我没改。
2. **生态「发表情包」动作**（`eco.extra = 'sticker'`，`pickStickerForEcology`）不在本任务范围：仍从那句话里按关键词取情绪，没有关键词就失败（`no_sticker`）。现在只是换用新的按情绪挑图。群聊回复也不带表情包，照旧。
3. **计数口径**：软上限和保底都按角色**消息条数**数，沿用原口径，不是按「回复次数」。一次回复有 1–4 个气泡，所以「连续 9 条」大约是 3–5 次回复，提醒会比「10 次回复」来得早。如果要按回复次数算，需要另定口径。
4. **聊天记录里的表情显示**：角色发过的库表情在上下文里显示为 `[你发了一个表情包：表情 12]`，因为库图 description 多是「表情 N」，模型可能照着学写。现在会剥掉，不会漏给用户。另一种办法是发送时把 description 存成有意义的情绪名，但这会改动客户端看到的说明文字，没做。
5. **效果待验证**：建议上线 3–5 天后，只读统计生产角色表情包条数（不看原文），再决定要不要调提示词措辞或保底条数。

## 给其他负责人的交接

- **产品负责人**：请按总经理口径把 MED-01「10 条不超过 2 个」同步成「软上限 3 个，带不带由角色自己决定」；`character-card-spec.md` 的 `stickerRate` 注释一并改。
- **后端 / 运维**：没有迁移、没有契约变化、没有新配置。上线后表情包会明显变多，媒体读取量随之增加，属于正常现象。
- **Codex 验收**：重点看三件事：用户正文绝不残留标记（私聊各重写路径、主动消息）；硬规则各自生效；提示只在日常范围普通回复和生态主动消息里出现，私密、关怀、树洞、健康时不出现。
