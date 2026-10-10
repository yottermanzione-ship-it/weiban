# 导入分析设计说明（T-081，CHR-08 / CHR-09 / CHR-10 第 4 条）

代码：`apps/server/src/modules/ai-runtime/application/import-ai.ts`、`supplement-ai.ts`、`supplemented-character-read.ts`。流程依据 `runtime-overview.md` 第 12 节，本文只记实现取舍。

## 1. 对 importer 的接口（契约 ImportAnalyzerPort）

| 方法 | 做法 |
|---|---|
| `estimate` | 价目表端口暂无「按用户所选模型报价」，按 `cost-estimate.md` 第 5 节中档口径估：5 万微元基础 + 每字 14 微元 + 每张截图 2 万微元（宁高勿低） |
| `recognizeScreenshots` | 每张一调（网关每条消息最多 4 张图），4 张并行；右侧气泡 = 「我」，左侧用识别到的昵称或「对方」；相邻截图按「说话方 + 去空白文字」的最长重叠去重。模型不具备识图且平台没有默认识图模型（`capability_missing` / `not_configured`）→ `vision_unavailable` |
| `detectSpeakers` | 只看 importer 给的样本（≤ 4000 字），输出发言列表；不足两人 → `format_unrecognized` |
| `analyze` | 约 1.2 万字一块、最多 4 块并行提取线索 → 一次合并调用整理成卡片字段 → 用 `DraftCharacterCard` 校验，不合格的段落丢弃，保证总能进编辑器 |

- 用途 `import_analysis`，`billingOwner = user`，`modelRole = chat`，不计入后台每日上限。
- 进度：提取阶段 5→80，合并后 92，完成前 99（importer 写 100）。
- 幂等键：importer 给的键 + `:chunk:i` / `:merge` / `:shot:i`；重试时 importer 换键。
- 日志只记 jobId、错误码、块数、耗时，不记原文。

## 2. 草稿内容

- 名字留给用户在编辑器填（发言人名多为真名，进入 `detectedRealNames` 提示替换）。
- 说话方式 → `speech.tone`、`sentenceLength`（模型给不出时按平均句长推断）、口头禅 → `speech.catchphrases`、常用表情 → `speech.emojiHabit.favorites`；性格总结 → `persona.summary/personality/personaTags`；示例对话原文摘取 → `examples`（`import-N`）；重要经历 → `knowledge.entries`（`category = experience`、`confidence = userSource`）；`admin.creationMethod = importedChat`。
- 分类建议固定「真人 · 身边真人」（CHR-08 第 4 条）。
- 儿童特征：规则词表或模型任一命中 → `ageSetting = minor`、`childAppearance = true`（只会更严）；创建自定义角色时 characters 还会再跑一次自己的检测。

## 3. 补充设定（CHR-09）

- `analyze(kind = supplement)`：提取线索后对照该预设角色公开资料摘要写一段补充设定（≤ 5000 字），与公开资料矛盾处不写入。
- **冲突项写入时机**：用户保存补充设定（手写 / 导入确认 / 广场应用改版）→ characters 清空旧冲突并发 `characters.supplement_changed(saved)` → 本模块订阅（消费者 `ai.on_supplement_changed`）投递任务 `ai.supplement_conflicts` → 模型对比公开事实 → `CHARACTER_SUPPLEMENT_CONFLICTS.setConflicts`。写入前再读一次补充设定，内容已变就放弃（防止旧结果覆盖新文本）。费用记用户账户、`modelRole = background`。
- **读入人设**：ai-runtime 内部令牌 `AI_CHARACTER_READ` 包装 `CharacterReadPort`，对预设角色经 `CHARACTER_SUPPLEMENT_PORT` 补上 `userSupplement`；私聊回复、群聊发言、通话、主动消息的人设提示都附「我的补充设定」块，并写明冲突时以公开资料为准、不能改变规则 / 年龄 / 分类。

## 4. 人设更新摘要（CHR-10 第 4 条）

`PersonaUpdateSummaryService.summarize(before, after)`：先按规则比对（新增作品《XX》、新增经历、职业变化、说话方式调整），规则说不出时用平台账户（`admin_persona_check`）调一次模型，失败回「资料已更新」。令牌 `AI_PERSONA_UPDATE_SUMMARIZER`。characters 发布新版本时尚未调用（见交接遗留）。

## 5. 未实测

- 3 分钟内出草稿依赖模型输出速度，未实测；截图识别准确率与费用未实测。
- 估价为固定系数，未接真实价目表。
