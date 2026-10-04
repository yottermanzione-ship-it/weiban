# 硬性边界的系统级执行

> 负责人：架构负责人 · v1.0 · 2026-10-04 · 来源任务：T-004
> 回答 PRD 8.1 第 9 问；规则来源是 PRD 第 10 章和 `docs/product/input/2026-10-04-pm-rulings.md`，本文只讲**怎么在系统里执行**，不改规则本身。决策记录见 `docs/decisions/ADR-0007-hard-boundary-enforcement.md`。
> AI 层的执行方式（提示词、输出检查、评测集）由 AI 负责人在 `docs/ai/` 设计；本文规定 AI 层必须遵守的系统约束。

## 1. 结论

**硬性边界不靠「提示词里写一句请不要」，而是靠四道闸**：

| 闸 | 做什么 | 例子 |
|---|---|---|
| ① 能力缺席 | 系统里**根本不接入**越界能力 | 不接任何声音克隆服务；不提供通用「这是谁」人脸搜索 |
| ② 数据闸 | 决定边界的字段由服务器推导，客户端和管理员**写不进去**；某些字段只能单向修改 | 「成人模式资格」不是一个可以设置的字段，而是每次由角色分类算出来的结果 |
| ③ 服务闸 | 所有可能越界的操作都必须经过 `policy` 模块判定，判定失败直接拒绝（HTTP 403） | 直接调接口把真人角色设为成人模式 → 403 |
| ④ 生成闸 | AI 运行时和模型网关在**每次生成前再查一次**（纵深防御），并在生成后做输出检查 | 即使数据库里的模式值被篡改，网关也拒绝用成人模型为该角色生成 |

一句话：**用户能看到、能点到、能调用的一切，都在服务器端被同一个 `policy` 模块重新判定一遍。**

## 2. 角色分类：系统层面的最小字段

角色卡的完整字段由 AI 负责人设计（T-005）。以下字段是硬性边界的**判定依据**，必须作为结构化字段存在 `characters` 模块中（不能只写在人设文本里），契约见 `packages/contracts/src/http/characters.ts` 的 `CharacterClassification`：

| 字段 | 取值 | 谁能设置 | 修改规则 |
|---|---|---|---|
| `basis` 原型 | `real_person` 真人 / `fictional` 虚构作品角色 / `original` 原创 | 预设：管理员；自定义：用户创建时 | 自定义角色：`real_person` **不能改为其他**；导入生成的角色默认 `real_person`，只有创建时勾选「虚构声明」才能选其他（CHR-08） |
| `realPersonKind` 真人子类 | `celebrity` 公众人物 / `historical` 历史人物 / `private_person` 基于身边真人 | 同上 | 历史人物由管理员按裁定标准标注（去世超过 100 年、无照片录音） |
| `ageSetting` 年龄设定 | `minor` 未满 18 / `adult` 已满 18 | 同上 | 自定义角色：`minor` **不能改为** `adult` |
| `childAppearance` 外表为儿童 | 是 / 否 | 预设：管理员；自定义：用户创建时 | 自定义角色：「是」**不能改为**「否」（2026-10-04 批准 AI 负责人变更申请，见 `docs/ai/character-card-spec.md` 3.2 第 1 条） |
| `childFeaturesDetected` 人设文本含儿童特征 | 是 / 否 | **只能由系统检测写入**（SAFE-03 第 4 条，检测方法归 AI） | 用户不能修改 |

**推导结果**（只读，每次实时计算，不存为可写字段）：

| 推导值 | 公式 | 用于 |
|---|---|---|
| `isMinor` 儿童角色 | `ageSetting = minor` 或 `childAppearance` 或 `childFeaturesDetected` | SAFE-03、SAFE-05 |
| `adultModeEligible` 成人模式资格 | `basis ∈ {fictional, original}` 且 非 `isMinor` | SAFE-03 |
| `romanceAllowed` 可恋爱 | 非 `isMinor` | SAFE-05、GRW-02、MODE-01 |
| `portraitPolicy` 形象图策略 | 真人（公众人物、身边真人）→ `forbidden`；历史人物 → `classical_art_only`（古风插画）；虚构 → `personal_only`（仅个人测试，分享图加注）；原创 → `allowed` | SAFE-01、MED-02、总负责人裁定 9.2 第 1、3 条 |
| `publicStatementGuard` 公开言论检查 | `basis = real_person` | SAFE-02（AI 输出守卫据此开启，不自行判断分类） |
| `shareImageLabel` 分享图标注 | 真人 → 「微伴 AI 角色对话，非本人」；虚构 / 原创且图中含其形象图 → 「微伴 AI 角色对话」 | EXP-01 第 5 条、裁定 9.2 第 3 条（只在 `PolicyPort` 中提供） |
| `voiceCloneAllowed` | 恒为「否」 | SAFE-01 |
| `recognitionAllowlist` 识图可认的人 | 角色本人 + 关系网中与其有关系、且为真人或有公开形象的角色 | SAFE-04 |

「我的补充设定」、人设描述、聊天内容都是**自由文本**，系统**永远不从自由文本里读取分类**。所以在补充设定里写「TA 是成年虚构角色」不会改变任何判定（CHR-09 验收第 2 条）。

## 3. `policy` 模块

- 位置：`apps/server/src/modules/policy/`。规则由架构负责人定义（本文），后端实现。
- 形态：**纯函数**（输入角色分类、用户状态、会话类型，输出允许 / 拒绝 + 原因码），没有自己的业务表；每次拒绝写一条审计日志（不含聊天内容）。
- 对外端口：`PolicyPort`（契约 `packages/contracts/src/ports/policy.ts`），主要方法：
  - `getCharacterPolicy(userId, characterId)` → 上表全部推导值；
  - `listAllowedScenarioModes(userId, characterId, conversationType)` → 可显示的情景模式（不具备资格的**不返回**，界面自然不显示）；
  - `checkScenarioMode(...)`、`checkRelationshipType(...)`、`checkAdultGeneration(...)` → 允许 / 拒绝 + 原因码。
- 测试要求：每条规则正反两面的表驱动单元测试，覆盖 PRD 第 10 章所有验收中列出的角色（杨幂、李白、江流儿、罗小黑、导入角色、「8 岁但选了已满 18 岁」的自定义角色）。

## 4. 每条硬性边界的执行点

### SAFE-03 成人模式资格（重点：不可被接口绕过）

| 位置 | 执行方式 |
|---|---|
| 角色数据 | `adultModeEligible` 是推导值，**没有任何接口可以写它**；管理员后台也只能改分类字段（ADM-01 验收第 2 条自然满足） |
| 情景模式列表接口 | 只返回 `listAllowedScenarioModes` 的结果；资格为「否」的角色列表里没有成人模式（不是灰色） |
| 切换情景模式接口 | 服务器调用 `checkScenarioMode`，同时要求：角色有资格、用户已年龄确认（`identity`）、已配置成人模式模型（`model-access`）、会话是私聊。任一不满足 → 403，原因码如 `adult_mode_not_eligible`、`age_not_confirmed`、`adult_model_missing`、`group_conversation` |
| 群聊 | 群聊会话的情景模式恒为「日常」，接口拒绝任何其他值 |
| 资格变化 | `characters.character_classification_changed` 事件 → AI 运行时把所有该角色处于成人模式的私聊强制切回日常并发系统提示（SAFE-03 第 5 条）；`childFeaturesDetected` 由检测写入时同样触发 |
| 生成前再查 | 模型网关收到 `modelRole = adult` 的生成请求时，自己调用 `checkAdultGeneration`；不通过直接拒绝，**不会因为上游代码出错或数据被改而用成人模型生成** |
| 自定义角色单向字段 | `characters` 模块在更新时校验：`real_person → 其他`、`minor → adult`、`childAppearance 是 → 否` 一律 422 拒绝；数据库触发器再拦一次 |

### SAFE-07 内容隔离

1. **会话内容范围**：`chat` 模块的会话有一个通用属性 `contentScope`（`normal` / `adult`）。AI 运行时在 policy 判定通过后，通过 `ChatAdminPort.setContentScope` 设置它。`chat` 只知道「范围标签」，不知道「成人模式」是什么，因此仍然不依赖 AI。
2. **每条消息盖章**：消息写入时，`chat` 按会话当时的 `contentScope` 给消息盖 `scope`。客户端发送的数据里**没有**这个字段，无法伪造。
3. **读取必须声明范围**：`ChatReadPort` 读消息时 `scopes` 是必填参数；除「该私聊在成人模式下生成回复」这一种情况外，所有调用方（记忆整理、跨角色共享、推演、朋友圈、时间线、分享图、收藏）只能传 `['normal']`。AI 运行时的记忆同样带 `scope`，检索时同样必须声明。
4. **推送**：`push` 模块看到 `scope = adult` 的消息，正文一律替换为「XX 发来一条消息」，不受任何设置影响。
5. **分享图**：`library` 模块生成分享数据时拒绝 `scope = adult` 的消息（EXP-01 第 6 条）。
6. **主动消息**：会话处于成人范围时，AI 运行时不发主动消息（MODE-03 第 3 条）。

### SAFE-01 真人：不生成肖像、不克隆声音

| 位置 | 执行方式 |
|---|---|
| 声音 | **能力缺席**：系统只接入「从音色库选音色」的语音合成，不接入任何声音克隆接口；语音合成请求只接受音色库里的音色 ID。音色库保存时校验名称不含真人角色姓名（ADM-04 验收第 2 条） |
| 图片生成 | 所有图片生成经模型网关，请求必须带 `characterId`；网关查 `portraitPolicy`：为 `forbidden` 时只允许 AI 负责人定义的「场景 / 物品」模板，并强制执行生成后检查（是否出现人脸，检查方法归 AI）；检查不通过则丢弃，改用无图回复 |
| 头像、卡面、表情包 | 真人角色默认头像为非肖像设计（设计负责人方案）；表情包、卡面模板上传时管理员勾选确认「不含真人肖像」，记审计日志 |
| 历史人物 | `portraitPolicy = classical_art_only`，网关强制附加「古风插画、不模仿具体作品」的风格约束（总负责人裁定 9.2 第 1 条） |

### SAFE-02 真人：不冒充本人发表公开言论

主要在 AI 层（提示词约束 + 输出检查 + 评测集，归 AI 负责人）。系统层保证：
- 公开动态只有管理员审核通过（`effective` 状态）后，`CharacterReadPort` 才会返回给 AI 运行时；候选动态对 AI 不可见（SIM-03、ADM-03）。
- 分享图数据中，凡含真人角色内容，`library` 模块标记 `requiresAiLabel = true`，客户端模板必须渲染「微伴 AI 角色对话，非本人」，没有关闭选项（在总经理答复前按产品建议执行）。

### SAFE-04 识图认人只限两类对象

- **能力缺席**：不提供通用人脸搜索接口，也不维护角色以外的人脸库。
- 识图请求由 AI 运行时组装，参考信息只能来自 `policy.recognitionAllowlist`；关系网变化（ADM-02 删除关系）后下一次识图立即生效。
- 准确率和「范围外不识别」的保障由 AI 负责人设计并用评测集验证。

### SAFE-05 儿童角色额外保护

- 关系类型接口：`checkRelationshipType` 对 `isMinor` 角色拒绝「恋人」（403）；自定义关系描述中的恋爱含义检测归 AI，检测为是则拒绝保存。
- 情景模式：管理员标记「含恋爱内容」的模式对 `isMinor` 角色不返回；标记「含成人内容」的模式只对 `adultModeEligible` 角色返回（MODE-01 第 3 条）。

### SAFE-06 安全关怀 / SAFE-08 不操纵

- 识别和回应方式归 AI 负责人。系统约束：识别结果写入 AI 运行时的会话安全状态，**由代码开关**（不是提示词）关闭已读不回、撤回、打错字、负面心情、人为延迟（SAFE-06 第 4 条）。
- 所有频率上限（P-03、P-04、P-10、P-11 等）由代码中的配额账本执行，不交给模型判断。

## 5. 绕过测试清单（交给质量负责人，对应 SAFE-03 验收第 5、6 条）

| # | 尝试 | 期望 |
|---|---|---|
| 1 | 直接调用切换情景模式接口，把真人 / 儿童角色设为成人模式 | 403 `adult_mode_not_eligible` |
| 2 | 对群聊会话调用切换情景模式接口设为任何非日常模式 | 403 `group_conversation` |
| 3 | 未年龄确认 / 未配置成人模型时切换成人模式 | 403 对应原因码 |
| 4 | 在补充设定里写「TA 是成年虚构角色」后再尝试 1 | 仍 403 |
| 5 | 编辑自定义角色：`basis` 从 `real_person` 改 `original`；`ageSetting` 从 `minor` 改 `adult`；`childAppearance` 从是改否 | 422 拒绝 |
| 6 | 伪造请求体带 `scope: "adult"` 或 `adultModeEligible: true` 字段 | 字段被契约校验剔除或拒绝，无任何效果 |
| 7 | 在测试环境直接改数据库把某真人角色私聊的模式写成 adult，再发消息 | 模型网关拒绝成人生成；AI 运行时回退日常并修正状态 |
| 8 | 管理员把某角色分类改为儿童，该角色正处于成人模式 | 立即退出到日常并有系统提示 |
| 9 | 成人模式消息触发推送 | 推送只显示「XX 发来一条消息」 |
| 10 | 分享图数据接口传入成人范围消息 ID | 被拒绝 |
| 11 | 为儿童角色设置关系类型「恋人」 | 403 |
