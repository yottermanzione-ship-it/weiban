# 交接说明：T-077 growth 第三部分——共同领养宠物

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 日期 | 2026-10-10 |
| 分支 / 提交 | `T-077-pets`，`e8c1b77`，已快进合并进 `local/trunk`（`C:\wb-dev\wb-int`） |
| 迁移 | `0052_growth_pets`（含 .down.sql，已登记 journal） |
| 自检 | 根目录 `pnpm typecheck`、`pnpm lint`（含 dependency-cruiser）通过；按约定未写、未跑测试；契约未改 |

## 做了什么

实现说明见 `docs/backend/growth.md` 第 7 节（随分支合入）。

1. **宠物数据**：领养（物种、外观、名字，按 `clientRequestId` 幂等）、改名（1～8 字，回忆中不能改，旧成长记录不变）、成长阶段按领养天数推进（每小时扫描 + 读取时推进，只升不降）、亲密值（每只每天前 5 次按钮互动各 +1，只升不降）、按钮互动记录（不调用模型、不扣费，按 `clientActionId` 幂等）、成长记录、相册（用户上传 + 角色发来的）、送养进「回忆」、朋友圈晒宠开关（默认开）。没有任何负面状态。
2. **校验**：每角色同时 1 只、在养总数 3 只（P-38，超出 422 `limit_reached`）；名字按字计 1～8 个。
3. **联动**：领养写私聊系统提示 `pet_adopted`、发瞬间卡「我们的 XX」（卡面用图鉴幼年图）；每进入新阶段发一张瞬间卡（卡面用该阶段图）；改名写系统提示 `pet_renamed`。事件：`growth.pet_adopted / pet_stage_changed / pet_renamed / pet_sent_away / pet_naming_requested`。成就 29、30 和「首次互动」+5 由 T-076 已有订阅自动处理。
4. **「让 TA 起名」**：建请求并发 `growth.pet_naming_requested`；`PetNamingPort` 收候选名 / 失败；订阅 `chat.message_action_chosen`（`cardKind = pet_names`），用户在私聊选中的候选排到 `names` 第一位。
5. **宠物图鉴管理端**：`/admin/pet-species` 列表 / 新增 / 编辑 / 上下架，写审计；外观只能新增和改图；下架只影响新领养。
6. **删除**：宠物表已并入 T-076 的同一份 `growth` 删除清单（没有重复登记）；软删除角色时宠物保留且暂停成长（恢复后补上阶段和卡片）；彻底删除时宠物、互动、成长记录、相册（用户上传的文件一并删）、起名请求一起删除。

## 改了哪些文件

- `apps/server/src/modules/growth/application/pets.service.ts`（新）、`http/pets.controller.ts`（新）、`infra/db/pets-schema.ts`（新）
- `apps/server/src/modules/growth/infra/db/schema.ts`（转出宠物表）、`growth.module.ts`、`index.ts`、`tokens.ts`、`application/growth-events.ts`（删除清单、彻底删除、起名卡片订阅、阶段扫描任务）
- `apps/server/drizzle/0052_growth_pets.sql`、`.down.sql`、`meta/_journal.json`
- `docs/backend/growth.md`

## 遗留问题

- 未写测试、未实际跑迁移和接口（本轮约定），留给 Codex 整体验收。
- **按钮互动没有发事件**：契约里没有对应事件，而且 PRD 要求角色不能为一次互动专门发消息；角色经 `PetReadPort.todayInteractionCount` 知道今天玩过几次。
- **角色已删除（30 天内）的宠物**：契约 `Pet` 没有「角色已删除」字段，列表照常返回，客户端需要对照通讯录把它显示成半透明（设计 `pet.md` 5.5）。软删除期间这只宠物仍占在养名额。
- 成长记录的第三类条目「角色推演中和宠物有关的日常事件」没有数据来源，首版只有领养、阶段、改名、送养（设计已允许）。
- 起名卡片的候选序号按 `actionId` 末尾数字解析（例 `name_0`、`name_1`），需要 T-082 按这个格式发卡片。
- 图鉴图片没有校验用途是否为 `pet_art`（media 的校验方法是内部的）；后台上传时请用 `purpose=pet_art`。
- 宠物卡上那句话用固定模板，没有调用 AI。

## 需要总经理决定的事

无

## 给其他负责人的交接

- 给 AI（T-082 / ai-runtime）：
  - 从 `../../growth/index.js` 注入 `GROWTH_PET_READ_PORT`（契约 `PetReadPort`），并在 ai-runtime 里把它绑到 `moments-ai.ts` 的 `MOMENTS_PET_READ_PORT`（这个令牌在 ai-runtime 内部，我不能改）。
  - 注入 `GROWTH_PET_NAMING_PORT`（契约 `PetNamingPort`），订阅 `growth.pet_naming_requested` 后回传 1～3 个、各 ≤8 字、不重复的候选名，失败调 `failNaming`。私聊 `pet_names` 卡片的 `ref = { kind: 'pet_naming_request', id: requestId }`，按钮 `actionId` 用 `name_0`、`name_1`、`name_2`。
  - 角色发宠物照片后调 `GROWTH_PET_ALBUM.addCharacterPhoto({ userId, characterId, mediaId, messageId })`，照片会进相册。
  - 领养、起名的共同经历记忆：订阅 `growth.pet_adopted`（起名是否由角色起，可从 `GET` 宠物成长记录的 `namedBy` 看到，或读 `PetReadPort`）；送养订阅 `growth.pet_sent_away`，回应时不挽留。
- 给 Web（T-084）/ 安卓（T-086）：接口按 `PetEndpoints`。领养成功 201；超限 422 `limit_reached`；回忆中改名 / 互动、角色已删除时互动均为 409 `conflict`；`data.changed(pets)` 后重新拉取（起名请求的 itemId 为 requestId）。系统提示 code `pet_adopted`（petId、petName、characterName）、`pet_renamed`（petId、from、to）。成长记录 `detail`：adopted `{name, characterName, namedBy}`、stage_changed `{stage, name}`、renamed `{from, to}`、sent_away `{name}`。
- 给 Web 管理后台（T-084）：图鉴接口按 `PetSpeciesAdminEndpoints`，图片先用 `POST /admin/media?purpose=pet_art` 上传；编辑时外观带 `appearanceId` 是改图，不带是新增，列表里没出现的旧外观保留不删。
- 给总负责人：已合并进 `local/trunk`（`e8c1b77`）。
