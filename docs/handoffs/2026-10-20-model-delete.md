# 交接：模型可删除 + 上游账号批量删除（分支 `model-delete`）

| 项 | 内容 |
|---|---|
| 起因 | 总经理想把后台所有模型和上游账号删掉重配；模型只能下架不能删，上游账号又被（已下架）模型的线路挡住删不掉 |
| 基线 | `local/trunk` 6b57415；交付前 `git merge local/trunk` 无新提交 |
| 迁移 | `0117_model_soft_delete`（含 `.down.sql`） |
| 契约 | 3.23（`packages/contracts/README.md` 变更记录；只新增接口 / 可选字段） |
| 状态 | 开发与自查完成；未 push、未合入 `local/trunk`、未碰服务器 |

## 做了什么

### 1. 删除模型（软删，可批量）
- 后台「模型与计费 › 模型管理 › 模型」：每行操作列加红色「删除」；表格可勾选，勾选后出现「批量删除」。
- 点删除先向服务器要预览（`POST /admin/model/models/delete-preview`），确认框写清后果和受影响数量，例如：
  「3 个用户的场景配置（共 6 项）会被清空…」「3 个角色设置会被清空，改为跟随场景配置」「场景推荐：文本聊天、语音通话」「平台内部模型：安全检查、角色生态决策」「展示倍率的基准模型」「1 个限时折扣」「价目表：发布不含它的新版本（历史版本保留）」「1 条上游线路一并删除（不再挡上游账号删除）」，并说明历史记录仍显示模型名、可用同一模型键重新添加。
- 确认后 `POST /admin/model/models/delete`，服务器在一次操作里：
  - model-access（同一事务）：删线路；删用户场景配置、角色逐场景设置（用户回到「未配置」/「跟随」，文本聊天被清空的用户 `needsSetup = true`，进聊天弹首次引导，不报错）；场景推荐 / 平台内部模型里的它改为未指定；展示倍率基准是它时改为未设置；给受影响用户发 `model_access.selection_changed`（客户端刷新）；每个模型写审计 `catalog.deleted`。
  - billing（事务之后，`BillingModelRatePort.removeModels`）：复制当前价目表、去掉这些模型的全部价格行（token、语音、图片所有单位），发布新版本（历史版本保留）；删除它们的限时折扣；写审计 `price_version.models_removed`。
  - 「角色生态决策」模型存在 ai-runtime 的生态配置里（跨模块），由后台在删除成功后一并 PUT 清空（与「场景推荐 · 平台内部模型」卡片保存它的方式一致）。
- 删除后：模型从后台模型表格、用户端模型列表、场景可选列表、推荐 / 内部模型 / 价目表 / 生态 / 行为规划的选择框里消失；调用记录、用量统计、用户详情用量里显示「模型名（已删除）」。

### 2. 同键可以重新添加（选了「删除时给旧键改名」）
- 0117 给 `model_access.model_catalog` 加 `deleted_at`、`original_model_key`。删除时把这一行的 `model_key` 改成 `原键#deleted:<随机8位>`，原键存 `original_model_key`，恒为停用（CHECK 约束保证）。
- 为什么不用部分唯一索引：`model_key` 是主键，又被线路、用量、价目表、选择表按文本引用，改主键结构牵动太大；改名后所有按原键查目录的地方（网关、报价、场景解析、用户端列表）**天然查不到已删除的行**，不用逐处加过滤。
- 后台列表接口仍返回已删除的行（`deletedAt` 非空、`modelKey` = 原键），只为历史记录显示名字；后台按「现存的优先、否则已删除的加（已删除）」取名（`features/model/shared.ts` 的 `modelLabel`）。

### 3. 上游账号
- 删除检查（`deleteUpstream` 的 409）只看未删除的模型；模型删除时线路也删了，所以删完模型就能删账号。
- 「上游账号」表格勾选后新增「批量删除」：还被模型（含已下架的）使用的账号会在确认框里列出并跳过，其余逐个删除，最后汇总成功数；有失败的弹框列出原因。单个删除被挡时的提示加了「或删除这些模型」。

### 4. 契约 3.23
- `AdminCatalogEntry`（及 `AdminModel`）增可选 `deletedAt`；`AdminCatalogEntryWrite` 不含它。
- 新 `DeleteModelsRequest`（1～100 个不重复的键）、`ModelDeletionImpact`；`ModelAccessAdminEndpoints.previewDeleteModels` / `deleteModels`。不存在或已删除的键 → 404 not_found。
- 端口 `BillingModelRatePort` 增 `removeModels`、`modelPriceFootprint`。
- 安卓生成物已更新（`pnpm android:generate`，3.23，1496 个定义）。

## 提交号
见本分支 `git log local/trunk..model-delete`（契约 + 迁移 + 服务端 / 后台 / 安卓生成物 / 本交接）。

## 改了哪些文件
- 契约：`packages/contracts/src/http/model-access.ts`、`src/ports/billing.ts`、`src/version.ts`、`README.md`；安卓 `apps/android/core/contracts-generated/**`
- 迁移：`apps/server/drizzle/0117_model_soft_delete{,.down}.sql`、`meta/_journal.json`
- 服务端：新 `modules/model-access/application/model-deletion.ts`；改 `catalog.ts`（列表含已删除、对外原键）、`models.ts`（已删除的不查价格 / 线路 / 折扣，免得串到同键新模型）、`upstreams.ts`（删除检查排除已删除模型）、`display-pricing.ts`（导出键名）、`infra/db/schema.ts`、`http/model-access.controller.ts`、`model-access.module.ts`；`billing/application/model-rates.ts`（`removeModels` / `modelPriceFootprint`）；`cli/setup-local-model.ts`（忽略已删除）
- 后台：新 `features/model/delete-models.tsx`；改 `features/model/{models,upstreams,records,shared}.tsx/ts`、`features/model-management.tsx`、`features/{usage,ecology,planner,prices}.tsx`、`features/users/detail.tsx`、`app/styles.css`

## 自查
- 本机各跑一次（日志 `C:\wb-dev\logs\model-delete\check-*.txt`）：`pnpm typecheck` 通过；改动文件 eslint 通过；`lint:deps` 无违规；server / admin / web build 通过；`pnpm android:generate:check` 通过。
- 本批新建的文件和原本已按 prettier 排版的文件已排版；原本就没按 prettier 排的后台文件未整体重排，避免无关改动。
- **本机无数据库**：迁移 0117 未执行；删除逻辑只做了类型检查，没写新测试套件，数据库行为以 CI / 验收为准。
- 浏览器：临时假数据预览页（替换 `api.call`，保留请求体契约校验；已删除、未提交），本机 Edge 无头浏览器实际点击，截图在 `C:\wb-dev\logs\model-delete\`：
  - `01` 模型表格每行「删除」、勾选框（已删除的「Claude 旧版」不在表格里）；
  - `02` 单个删除确认框（GPT-6 Sol：用户场景配置、角色设置、平台内部模型 安全检查 + 角色生态决策、展示倍率基准、价目表、线路）；
  - `03` 删除后顶部卡片「安全检查」「角色生态决策」变未指定、倍率基准变未设置（脚本核对生态配置被 PUT 为 null）；
  - `04` 勾选 2 个 → 批量删除确认框（含场景推荐：文本聊天、语音通话；1 个限时折扣）；`05` 删除后表格；
  - `06` 调用记录显示「Claude 旧版（已删除）」「DeepSeek V4（已删除）」；
  - `07` 上游账号全选 → 批量删除确认框（OpenRouter 仍被 Gemini 3.8 Flash 使用，列出并跳过）；`08` 删除后只剩 OpenRouter。

## 遗留 / 需要注意
1. 删除不能恢复（后台没有「恢复」入口）；同键重新添加是一个全新的模型，价格、线路、场景都要重新填。
2. 同键重新添加后，**删除之前**的历史调用记录会显示新模型的名字（记录里只存模型键）。要严格区分需按调用时间对照删除时间，暂不做。
3. 价目表清理在目录删除之后单独执行：如果这一步失败，模型已删除，接口返回 503 并提示去「价目表版本」检查（旧价格行残留不影响使用，重新添加同键时保存价格会覆盖）。
4. 角色音色绑定了已删除的语音模型时，按 E3 规则回落到用户「语音消息」场景所选的模型；音色本身不会被删除或改绑，媒体库里可能要手动整理。
5. 旧兼容表 `model_access.selections` / `character_overrides`（3.22 起只读不写、只为回滚保留）里的引用没清；回滚 0115 时它们可能指向已删除的键，表现为「模型已下架」，不会崩。
6. 「角色生态决策」由后台前端清空：如果绕过后台直接调接口删除，生态配置里会留着旧键，生态页会显示「决策模型不在目录…角色生态暂停」（E3 已有的降级），手动改掉即可。
7. 回滚 0117（`.down.sql`）会物理删除已软删的模型行，之后历史记录只能显示模型键。

## 给其他负责人
- 给总负责人：迁移 0117、契约 3.23；部署前按流程备份后执行迁移。总经理删完模型再删上游账号即可，顺序不对时后台会提示哪些模型还在用。
- 给 android-lead：契约 3.23 已生成；只有管理端新增，用户端接口无变化。
- 给质量（Codex）：重点看①删除事务里的引用清理口径与预览计数一致；②改名软删后各处按键查询（网关、报价、场景解析、`facts`）都查不到已删除的行；③同键重新添加；④价目表新版本只去掉被删模型的全部单位、其余不变；⑤上游账号删除检查排除已删除模型。
