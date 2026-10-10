# 宠物与名场面卡设计说明（T-082，GRW-05、PLAY-02）

代码：`ai-runtime/application/pet-ai.ts`、`moment-cards.ts`、`domain/pets.ts`，改动 `proactive-scheduler.ts`、`reply-context.ts`、`simulation.ts`、`moments-ai.ts`、`memory.ts`、`domain/reply-rules.ts`。迁移 `0058_ai_pets_moments`。

## 1. 名场面瞬间卡（GRW-05，runtime-overview 第 13 节）

- 每小时任务 `ai.moment_cards_tick`（每小时第 23 分）：用户当地**周日 20 点后**，对本周还没评估的（用户, 角色）入队 `ai.moment_card`；`moment_card_attempts` 保证每周只评估、只花一次钱。
- 排除：只读 `normal` 范围（成人模式对话不读）；`excludeLabels: ['health']` 且再按 labels 过滤；安全关怀状态（回复计划 `care_until` 覆盖的时间段，从触发前 30 分钟起）；命中高危 / 疑似自伤的消息；经期词与「永不共享」词；模型判 `topic = sensitive` 的片段也不发。
- 模型给出 1–10 分与最高分连续片段（≤ 6 条）、标题（≤ 12 字）、一句话（≤ 40 字）；≥ 8 分才发。卡面用 `CharacterImageService.generate(use = card)`，失败为 null（growth 用模板）。
- 发卡：`GROWTH_CARD_PORT.issueCard(kind = moment, sourceMessageIds, idempotencyKey = moment:{周一日期})`；`weekly_moment_limit` 记录后放弃本周。
- 费用：用途 `memory`、后台模型，计入后台预算。
- `CardLineService.writeLine`：给任意卡片写「角色写给你的一句话」（≤ 40 字），令牌 `AI_CARD_LINE_WRITER`（growth 自己发的卡尚未接入，见交接）。

## 2. 宠物（PLAY-02）

| 条目 | 做法 |
|---|---|
| 第 2 条 提议一次 | 主动调度候选：L2+、和该角色没有任何宠物、`pet_proposals` 没记录；每天约 15% 机会、当天 11–21 点稳定随机时刻；理由 `interactive_play`，走主动消息配额（P-03/P-04）。发出时同一事务发 `pet_proposal` 卡片（按钮 `go`「去看看」，ref = pet_proposal/角色 ID）并写 `pet_proposals`，之后永不再提。用户点按钮只记 `choice` |
| 第 3 条 起名 | 订阅 `growth.pet_naming_requested` → 任务 `ai.pet_naming`：模型按人设出 3 个名（清洗为 1～8 字、不重复、不与已有宠物重名，不足用兜底名补齐）→ `submitNameCandidates` → 私聊 `pet_names` 卡片（`name_0/1/2`，ref = pet_naming_request/requestId）。生成失败也用兜底名；`invalid_names` 时 `failNaming` |
| 第 3、11 条 领养回应与记忆 | 订阅 `growth.pet_adopted` → 任务 `ai.pet_event`：写共同经历记忆（shareable，群里可提），角色按人设回应一次 |
| 第 8 条 送养 | 订阅 `growth.pet_sent_away`：记忆 + 平静祝福一句，不挽留；不过检查用固定说法 |
| 第 6 条 互动进上下文 | 私聊回复与主动消息的人设提示带宠物块：名字、物种、阶段、天数、今天玩过几次，并写明不为一次互动专门找话题 |
| 第 7 条 日常 / 照片 | 推演提示里加宠物（0～1 件，计入总数，不写生病受苦想念）；分享和宠物有关的日常事件时约一半附宠物照片（`use = pet`，真人角色不出现人物；失败用图鉴预设图），发出后 `GROWTH_PET_ALBUM.addCharacterPhoto` 放进相册 |
| 第 7 条 朋友圈 | `MOMENTS_PET_READ_PORT` 绑到 `GROWTH_PET_READ_PORT`；只取 `allowMomentsShare` 的宠物，素材说明要求只说宠物不提用户 |
| 第 13 条 改名 | 所有地方现取名字，无需额外处理 |
| 第 8 条 / SAFE-08 不施压 | `petPressure` 并入 `outputAllowed`：宠物 + 对方缺席 / 宠物受苦 / 挽留送养的表述一律不发（回复、主动、群聊、朋友圈都经过它） |

评测用例：`packages/ai-evals/cases/l6.ts`（`L6_PET_CASES`，4 条）。
