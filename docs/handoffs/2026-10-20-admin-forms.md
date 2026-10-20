# 2026-10-20 管理后台表单报错体验 + 模型抽屉 + 一键导入

| 项 | 内容 |
|---|---|
| 负责人 | Web 负责人（管理后台） |
| 分支 | `admin-forms`（worktree `C:\wb-dev\wb-admin-forms`，基线 `local/trunk` c58a955） |
| 范围 | 只改 `apps/admin`；后端、契约、client-core 均未改动 |
| 起因 | 总经理添加模型点「保存并上架」没反应：抽屉顶部红条「请检查必填字段和格式」要上滑才看到，也不知道哪项错；计费上限要手写 JSON |

## 1. 根因

- 旧抽屉「模型键」说明写的是「一般和上游模型名一致，例如 deepseek-chat」，但契约要求 `厂商/模型名`（例 `google/gemini-3.8-flash`）。照说明填就会被 client-core 发请求前的契约校验（ZodError）拦下，`errorText()` 只给笼统提示。
- 上游模型名用的是 `Select showSearch`，下拉里没有的名字其实输不进去。
- 计费上限是手写 JSON 文本框；不填 = 线路不能调用（角色不回消息）。

## 2. 做了什么

### ① 全后台通用报错体验

- 新增 `src/data/issues.ts`：把 ZodError 和服务器 `bad_request.details.issues` 统一成字段问题，翻译成大白话（「模型键：格式应为「厂商/模型名」…例 google/gemini-3.8-flash」「第 1 条线路 · 计费上限 · 最大输出：不能大于 32000；…」）。常见字段有中文名和正确写法；服务器只回英文时按常见句式翻译。
- `errorText()`（`src/data/hooks.ts`）改用上面的翻译，所有页面的错误提示都变具体，不再是「请检查必填字段和格式」。
- 新增 `src/data/form-feedback.ts` 的 `useFormFeedback(form, { mapPath })`：
  - `validate()`：代替 `form.validateFields()`，没通过时滚动并聚焦到第一个错的字段、弹顶部提示，返回 null（不再有未处理的 Promise 拒绝）。
  - `report(e)`：契约 / 服务器字段错误用 `form.setFields` 写到对应字段下方，滚动聚焦到第一个；同时弹顶部提示并返回一句话。`mapPath` 可把接口路径映射到表单字段（例 `rates.input` → `priceInput`）。
  - `reportField(name, text)`：前端自己发现的字段问题（例 JSON 写错）。
- 全后台 26 处 `await form.validateFields()` 已全部换成 `feedback.validate()`，对应的 `setError(errorText(e))` 换成 `setError(feedback.report(e))`（20 个文件）。
- `DrawerActions` 新增 `error` 属性：底部按钮左边显示一句红字（模型抽屉已接上）。

### ② 模型抽屉（`features/model/models.tsx`）

- 模型键：按「出品方」+ 第 1 条线路「上游模型名」自动生成建议（小写、去空格，中文厂商名有映射，例 深度求索 → deepseek）；管理员手改后不再覆盖；字段下写清格式与例子，输入时即时校验（规则直接用契约 `ModelKey`）。
- 上游模型名改成 `AutoComplete`：可以从拉取的列表选，也可以直接输入。
- 计费上限改为每条线路一组结构化表单（`features/model/billing-bounds.tsx`）：上下文长度 / 最大输出 / 输出参数名（下拉，默认 max_tokens）/ 最多图片数（有识图默认 4，否则 0）/ 资料来源链接（按厂商预填价格页）/ 核对日期（默认今天，不能选未来）。自动拼成 `billing-bounds-v1`（`totalOutputIncludesReasoning` 固定 true）。每个字段下一行大白话说明。
  - 已有 JSON 回显到表单；含语音 / 图片 / 搜索等部分的走「高级：直接编辑 JSON」折叠项（开关切换，表单模式下折叠项里显示将提交的 JSON 预览）。
  - 核对日期没改时保留原精确时间和 `pauseReason`；改了日期视为重新核对，暂停标记去掉。被暂停的线路抽屉里有黄色提示怎么恢复。
- 列表「需配置计费上限 ›」标签可点：直接打开编辑并滚动聚焦到第一条缺计费上限的线路。
- `toWrite()` 挪到 `features/model/shared.ts`，供导入复用。

### ③ 一键导入模型配置（`features/model/import.tsx`）

- 模型页「导入配置」按钮 → 选本地 JSON → 预览表格（不弹就是文件格式不对，会有提示）。
- 映射：`model` → 上游模型名；`vendor` → 厂商；`retail_prices_cny_per_mtok` → 售价；`supplier_lowest_prices_cny_per_mtok` → 成本；`public_display_official_multiplier` → 手填展示倍率（四舍五入 2 位，契约要求最多 2 位小数，例 0.375 → 0.38）；`price_source` → 计费上限资料链接；`arena_overall_rank` → 榜单名次和排序。模型键 / 显示名自动生成（可改）。
- 文件没有缓存价时按输入价 10% 预填，格子标黄、悬停说明可改（成本同理）。
- 预览里：选「挂到哪个上游账号」、勾选要导入的行、可改上下文长度（默认 128000）/ 最大输出（默认 8192）/ 识图；`supplier_lowest_model` 与 `model` 不同时灰字提示「供应商里叫 xxx」，点一下可换用；`needs_validation` 标「待核实」。
- 已存在同键模型：标「更新价格」，只改售价 / 成本 / 展示倍率，线路与计费上限不动；有分时价会提醒导入后变全天统一价。
- 确认后逐个调用现有 `upsertModel`；每行显示成功 / 失败原因；全部成功自动关闭并刷新，有失败则保留失败行勾选可重试。

## 3. 自查

- `pnpm --filter @weiban/admin typecheck`、`pnpm exec eslint apps/admin/src`、`pnpm --filter @weiban/admin build` 各跑一次，全部通过（build 只有原有的包体 >500KB 提示）。
- 浏览器自查用临时假数据预览页（替换 `api.call`，保留发请求前的契约校验；已删除，未提交），截图在 `C:\wb-dev\logs\admin-forms\`：
  - `01-model-key-error-autofocus.jpg`：模型键填 `Gemini Pro`，抽屉滚到底点「保存并上架」→ 自动滚回模型键并聚焦，字段下红字说明格式，底部按钮旁和顶部提示都可见。
  - `02-bounds-form-from-tag.jpg`：点列表「需配置计费上限」→ 打开抽屉并聚焦到上下文长度，表单按默认值预填。
  - `03-bounds-json-preview.jpg`：表单生成的 JSON 预览；保存出的计费上限 `RouteBillingBounds.safeParse` = true。
  - `04-json-mode-zod-error-mapped.jpg`：高级 JSON 里最大输出填 99999 → 契约校验错误定位到 JSON 框，写明「第 1 条线路 · 计费上限 · 最大输出：不能大于 32000」。
  - `05-import-preview.jpg`：导入总经理的 15 模型文件，预览正常，已有模型识别为「更新价格」。没选上游账号时提示并标红；选好后 15 个请求全部通过契约校验，每个计费上限 `safeParse` = true；更新的那个保留了原线路和计费上限。
  - `06-server-bad-request-mapped.jpg`：模拟服务器 `bad_request`（`details.issues` 路径 `routes.0.upstreamModelId`）→ 定位到第 1 条线路的上游模型名。
- 未写测试套件（按要求）；未连真实后端。

## 4. 遗留问题 / 交接

1. 导入的上游模型名默认取文件 `model` 字段（按任务要求）。文件里还有 `supplier_lowest_model`（例 `gemini-4-argon-max`、`claude-opus-5-5-low`），中转那边实际可能是这个名字；预览里有提示可一键换用，导入前请总经理核对。
2. 导入的新模型默认不勾「识图」（文件里没有能力字段）、输出参数名一律 `max_tokens`；OpenAI 新模型如果直连官方接口需要改成 `max_completion_tokens`（在模型抽屉里改）。
3. 计费上限默认值（128000 / 8192）只是常见值，不是厂商核实数据；资料链接按厂商价格页预填。是否按厂商文档逐个核对由总经理决定。
4. 其他页面已统一用 `useFormFeedback`，但只有模型抽屉配了 `mapPath`；其他表单的接口字段名和表单字段名不一致时，错误只会出现在顶部提示 / 抽屉顶部，不会落到具体字段（字段名一致的会自动落上去）。
5. 页面打开时控制台有一条 `There may be circular references` 警告，页面刚加载、还没打开抽屉时就出现，推测来自表格组件（未逐一确认），不影响使用。
6. 本分支未 push、未合入 `local/trunk`、未部署。
