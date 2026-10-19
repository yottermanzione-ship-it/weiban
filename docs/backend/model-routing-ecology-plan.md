# 模型档位与角色生态：源码核查与逐场景矩阵

> 状态：**待 PM 核准后实施**。本文件只做事实核查与方案，不改业务代码、不改契约。
> 范围：2026-10-17 总经理裁定后，**只做与会员档位无关的部分**；会员权益、价格、免费池、迁移补偿全部暂缓。
> 基线：`077849a`（共享 main `69f18e9`），专用副本 `C:\wb-dev\wb-model-ecology`，分支 `codex/model-routing-ecology`。

## 0. 结论摘要

1. 模型解析目前只有四个角色：`chat / background / adult / adult_check`，**没有“生态模型”这一维**；生态任务全部借用 `background`。
2. 用户没选后台模型时，`background` 会**静默借用聊天模型**（含角色覆盖），按聊天模型收费——这是当前最该修的偏差。
3. 行为规划有两个不一致的口径：实际执行用硬编码 `qwen/qwen3.8-flash` 覆盖，报价却按平台 `planner` 默认模型算。
4. 图片走“聊天模型没有 vision 能力就静默换成平台识图模型”，换模型标记 `usedVisionDefault` 产出了但**下游没有任何地方消费**。
5. **没有全局生态总开关**；`ecologyTask` 标记目前只影响“积分不足”的一次性提示，不影响是否执行、不影响计费分类。
6. `P33_BALANCE_FLOOR_MICROS`（1 元保留线）只剩两处导出定义，**没有任何读取点**，是死代码。

## 1. 现状：模型是怎么选出来的

| 角色 | 解析顺序 | 位置 |
|---|---|---|
| `chat` | 角色覆盖 → 用户全局聊天 → 平台 `defaultFor=chat` | `model-access/application/resolver.ts:89-111` |
| `background` | 用户全局后台 → **用户聊天模型（角色覆盖 → 全局聊天）** → 平台 `defaultFor=background` → 平台 `defaultFor=chat` | 同上 `:101-111` |
| `adult` | 只读用户全局成人模型；无角色覆盖、无平台回退，未设置即 `not_configured` | 同上 `:96-107` |
| `adult_check` | 只取平台 `defaultFor=adult_check`，且上游必须是 `https://openrouter.ai` | 同上 `:85-88`、`:160-173` |

旁路规则：

- `platformTask`：只用平台默认（background → chat），仅允许 `safety_check / safety_followup / small_v / search_candidates`（`resolver.ts:134-142`）。
- `modelKeyOverride`：仅允许 `behavior_planning`（`resolver.ts:143-148`）。
- `fallbackModelKey`：仅 `background`，用于空输出降级（`resolver.ts:143-145`）。
- 语音/图片/搜索等媒体模型**不走 `pick`**，按服务取平台默认 `speech_synthesis / speech_recognition / image_generation / web_search`（`media-gateway.ts:457-467`）。

## 2. 逐场景矩阵

“生态”一列按 12 号文档第 4/5/6/7/14/16/17 条的口径判定；“开关”指本次要新增的全局生态总开关。

| # | 场景 | 代码入口 | 角色 / purpose | 当前模型来源 | 付费方 | 是否生态 | 本批动作 |
|---|---|---|---|---|---|---|---|
| 1 | 私聊回复 | `reply-engine.ts:402` | chat/adult → chat_reply | 角色覆盖→全局→平台 | 用户 | 否 | 不改 |
| 2 | 群聊发言 | `group-chat.ts:802` | chat/adult → chat_reply\|proactive | 同上 | 用户 | 否（用户在场） | 不改 |
| 3 | 通话对话 | `call-agent.ts:254` | chat → chat_reply | 同上 | 用户 | 否 | 不改 |
| 4 | 通话摘要 | `call-agent.ts:372` | background → memory | 后台→**聊天**→平台 | 用户 | 否 | 修 D1 |
| 5 | 主动消息 | `proactive-scheduler.ts:981` | background\|chat → proactive | 后台→聊天→平台 | 用户 | **是** | 加生态闸门 |
| 6 | 日常推演 | `simulation.ts:283` | background → simulation | 同上 | 用户 | **是** | 加生态闸门 |
| 7 | 共同事件/社交日程 | `social.ts:354` | background → simulation | 同上 | 用户 | **是** | 加生态闸门 |
| 8 | 社交卡片主动消息 | `social.ts:693` | background → proactive | 同上 | 用户 | **是** | 加生态闸门 |
| 9 | 朋友圈正文 | `moments-ai.ts:287` | background → moments | 同上 | 用户 | **是** | 加生态闸门 |
| 10 | 朋友圈互动 | `moments-ai.ts:725` | background → moments | 同上 | 用户 | 是（非必回时） | 加生态闸门；必回不拦 |
| 11 | 朋友圈配图 | `moments-ai.ts:357` | 媒体 image_generation | 平台默认 | 用户 | **是** | 加生态闸门 |
| 12 | 卡面文案/每周名场面 | `moment-cards.ts:106`、`:273` | background → memory | 同上 | 用户 | **是** | 加生态闸门 |
| 13 | 记忆提取/摘要 | `memory.ts:1000` | background → memory | 同上 | 用户 | 否（聊天引发） | 只修 D1，不拦 |
| 14 | 你不在时摘要 | `timeline.ts:160` | background → behavior_planning | 平台 planner → 用户后台 | 用户 | **是** | 修 D2 + 闸门 |
| 15 | 行为规划 | `planner.ts:430` | background → behavior_planning | **硬编码 qwen** | 用户 | 主动路径是 | 修 D2 + 闸门 |
| 16 | 经期关怀 | `health-care.ts:335` | background → proactive | 后台→聊天→平台 | 用户 | **是** | 加生态闸门 |
| 17 | 后台玩法生成 | `play-ai.ts:256` | chat → play | 角色覆盖→全局→平台 | 用户 | **是** | 加生态闸门 |
| 18 | 识图描述 | `media-ai.ts:276`、`:338` | chat → vision | 聊天模型；无能力则平台识图 | 用户 | 否 | 修 D3 |
| 19 | 导入分析 | `import-ai.ts:237` 等 5 处 | chat → import_analysis | 角色覆盖→全局→平台 | 用户 | 否（用户主动） | 不拦 |
| 20 | 广场检查 | `plaza-check.ts:695` | chat → import_analysis | 同上 | 用户 | 否 | 不改 |
| 21 | 用户主动玩法/朋友圈必回 | `play-ai.ts`、`moments-ai.ts` | chat/background | 同上 | 用户 | **否** | 明确不受开关限制 |
| 22 | 平台安全检查/关怀 | `reply-engine.ts:98`、`group-chat.ts:955` | platformTask → safety_* | 平台默认 | **平台承担** | — | 开关不可关闭 |

## 3. 五个已核实的缺陷

**D1｜后台任务静默借用聊天模型**（`resolver.ts:101-105`）

用户没选“后台模型”时，`background` 直接用他的聊天模型（甚至角色覆盖），并按该模型计费。后果：用户以为只在聊天时用贵模型，实际上推演、摘要、朋友圈全在用同一个贵模型烧钱。任务卡第 5 条要求“用户分别选择角色聊天模型与全局生态模型”，现状不满足。

**D2｜行为规划执行与报价口径不一致**（`planner.ts:435`、`resolver.ts:262`）

执行时永远传 `modelKeyOverride = config.modelKey ?? 'qwen/qwen3.8-flash'`；报价时只取平台 `defaultFor=planner`。两边可能不是同一个模型，用户看到的预估与实际扣费对不上。另外 `timeline.ts` 走的是另一条回退链（planner 默认 → 用户后台 → 聊天），三个入口三种口径。

**D3｜识图静默换模型**（`resolver.ts:184-194`）

聊天模型没有 `vision` 能力时，直接换成平台默认识图模型并按它计费，用户无感知。`usedVisionDefault` 只在 resolver 内部赋值，网关、计费、接口都没消费。报价侧更窄：只在 `purpose === 'vision'` 时换，带图聊天的报价不会换（`resolver.ts:269`）。

**D4｜没有生态总开关，`ecologyTask` 只是提示标记**（`reservations.ts:192-203`）

`ecologyTask` 传到冻结接口后，只用于“余额不足时记一次提醒”，不改变是否执行、不改变预算分类、不改变模型。全项目搜不到 `ecologyEnabled` 之类的字段。

**D5｜1 元保留线是死代码**（`proactive-scheduler.ts:113`、`social.ts:63`）

`P33_BALANCE_FLOOR_MICROS = 1_000_000` 两处导出，无任何读取点。实际余额判断只看 `getSpendStatus` 是否存在（`:804-820`）。

## 4. 本批实施方案（分三块，均不含会员）

### 块 A｜模型解析收口（不新增用户可见概念）

1. 去掉 `background` 借用聊天模型的回退：未选后台模型时，直接取平台 `defaultFor=background`；平台也没有则任务明确失败并记录原因，**不换模型、不扣费**。
2. 行为规划统一口径：`planner` 默认模型只从平台目录 `defaultFor=planner` 取，删除硬编码 `qwen/qwen3.8-flash`；未配置时回落规则版（不调模型、不扣费），并在后台显示“未配置规划模型”。`timeline` 与 `planner` 走同一条链。
3. 报价与执行共用同一个解析函数，消除 `behavior_planning` / 带图 `vision` 的两套口径。
4. 识图不再静默替换：带图时若聊天模型无 `vision` 能力，优先按平台 `defaultFor=vision` 执行，但**返回实际使用的模型并在界面提示一次**；同时后台限制“无 vision 能力的模型不能被设为聊天默认”。

### 块 B｜全局生态总开关

1. 用户级字段 `ecologyEnabled`，**默认关闭**，首次引导不预选（按任务卡第 3 条）。
2. 生效点两处：任务入队前、执行前各查一次。关闭后：已排队任务丢弃、不产生费用；**已在途的调用无法取消**，如实说明。
3. 多端同步复用既有同步事件，不用 localStorage。
4. 不影响：用户主动聊天、用户主动发起的玩法/朋友圈必回、导入分析、平台安全检查。

### 块 C｜`ecologyTask` 从提示升级为闸门

在冻结之前判断：`ecologyTask === true && ecologyEnabled === false` → 任务跳过，不冻结、不扣费、不写用量；保留现有的“余额不足一次提示”逻辑不变。

### 明确不做

会员档位判断、免费池/日额度、PRO+ 权益、价格与迁移补偿、权益页数字、500 条防刷上限、邀请码/赠分、安卓 UI、声音克隆、外部渠道。

## 5. 契约与迁移预估（待批）

| 项 | 内容 | 影响 |
|---|---|---|
| 契约 | 用户设置增加 `ecologyEnabled`（布尔，默认 false）；同步事件复用现有设置变更类型 | 3.16 → 3.17 |
| 迁移 | `0103_ecology_switch`：`user_settings` 加列，默认 false | 新迁移，需在 DR-001 先演练 |
| 接口 | `GET/PATCH /settings` 增字段；模型选择接口不变（`background_model_key` 继续复用，仅改界面文案为“生态模型”） | 无破坏性变更 |

**为什么不新增“生态模型”这一维**：所有生态任务本来就用 `background` 角色，新增维度会让 `memory`（记忆摘要，非生态）与生态任务无法共用一个选择，收益低、迁移面大。用同一模型 + 一个开关区分，是当前改动最小的做法。

## 6. 需要 PM 拍板

1. **块 A 第 1 条**：去掉“后台借用聊天模型”后，老用户没选过后台模型的，生态任务会直接停下（平台有默认则用默认）。这是符合预期的，但属于行为变化，需要确认。
2. **块 A 第 4 条**：识图换模型时给用户一次提示，还是干脆禁止选择无 vision 能力的聊天模型（更彻底，但会缩小可选模型范围）。
3. **迁移 0103** 是否由本批占用（当前下一空闲 0103）。
