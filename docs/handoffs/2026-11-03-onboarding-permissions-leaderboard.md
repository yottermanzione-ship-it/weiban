# 交接说明：T-20261103 权限逐个申请、新手引导触发条件、热门榜排序

| 项 | 内容 |
|---|---|
| 负责人 | web-lead（含少量后端与契约） |
| 日期 | 2026-11-03 |
| 分支 | `feat/onboarding-permissions-leaderboard-20261103` |
| 任务卡 | `docs/tasks/T-20261103-onboarding-permissions-leaderboard.md` |

## 做了什么

### 1. 网页首次权限：一个一个申请

- 原来点一次「开始设置」就连着申请通知和麦克风；现在拆成两步，每步各有一个说明框：
  1. 「开启消息通知」说明框 → 用户点「开启通知」才发通知的系统申请，等结果回来（同意、拒绝、关掉都算有结果）；
  2. 再显示「开启麦克风」说明框 → 用户再点一次「开启麦克风」才发麦克风申请。
- 一次点击只发一个系统申请（Safari 的要求）；每个说明框有「暂不开启」可以跳过这一步。
- 某一步被拒绝、关掉、出错或浏览器不支持，照常进入下一步；已授权的跳过对应那一步（浏览器里已被拒绝、系统框不会再出现的也跳过）。两步都不需要时不弹任何框，直接记为完成。
- 两步都要时说明框上写「第 N 步，共 2 步」。Esc / 点蒙层仍是「这次没决定」，下次点进时从还没有结果的那一步继续。
- 新手引导正在高亮时，权限说明框不开始（避免把引导打断），引导结束后的下一次点击再开始。
- 逐步逻辑抽成纯函数 `permission-steps.ts`（`plannedSteps` + `PermissionFlow`），iPhone 未加主屏幕 / 系统过旧的处理、denial 标记、`permissions-onboarded` 标记都沿用原来的做法。

### 2. 新手引导触发条件

先读清楚的现状：三个引导（情景预设、小程序、角色生态）原来都只能在「设置 › 新手引导」目录里手动开始，没有自动弹出；进度记在本机 `localStorage` 的 `weiban:guided-tour:v1:<用户ID>`（按账号区分）。`ecology.tsx` 里的 intro 是「第一次打开生态开关时的花费确认框」，记在服务端 `introSeen`，它是开关的确认，不是引导，本次没动。

现在的自动弹出（每个引导一生只自动弹一次）：

| 引导 | 什么时候弹 | 从哪一步开始 |
|---|---|---|
| 情景预设 | 第一次进入私聊页（有「＋」的聊天） | 「＋」那一步（完整 4 步） |
| 角色生态 (a) 新会员 | 这台设备上先看到「免费」、之后看到「PRO+」= 第一次开通成功，马上弹「PRO+ 已开通」说明框；点「带我看看」从「我」开始走完整一节 | 「我 → 服务 → 角色生态 → 开关 → 花费」 |
| 角色生态 (b) 老会员 | 这台设备上从没看到过「免费」、一看到就是 PRO+（本次更新前就开通的），第一次进「服务」页时弹 | 「找到角色生态」那一步（3 步） |
| 小程序 | 第一次下拉打开小程序面板 | 新增的「面板版」3 步：认识宫格 → 打开卡册 → 用圆形按钮退回聊天列表 |

- **「已看过」记在哪里**：沿用现有方式，记在同一条本机记录 `weiban:guided-tour:v1:<用户ID>` 里，新增两个字段：`shown`（已经弹过的章节）和 `tier`（这台设备上最近看到的会员档位，用来区分新老会员）。旧记录照常读出。项目里**没有现成的「服务端按用户存引导状态」机制**（服务端的 `introSeen` 含义是开关确认框，挪用会让开启生态时跳过花费确认，所以没用），因此按任务卡用了按用户 ID 区分的本地存储，局限见「遗留问题」。
- 任何一条路径弹过一次（或在目录里手动开始过、学完过）就记为已看过，之后都不再自动弹。例：更新后才开通的新会员，开通时弹过，再进服务不会再弹；老会员在服务页弹过后，到期再续费也不会再弹。
- 自动弹出要等页面上没有别的弹窗（例如权限说明框、模型配置提示）、目标按钮出现且位置稳定后才开始；真正弹出那一刻才记「已看过」。被挡住时离开页面不算看过，下次进入再弹。
- 首次填资料 / 选第一个角色的新手流程里不自动弹。
- 会员档位用实时接口判断（不拿本机缓存的旧档位），余额 / 设置变化通知到达时自动重新拉取，所以后台开通会员（同时送积分）后在线的用户会马上看到。
- 「重新学习全部教程」只清目录的学习进度，不清「已自动弹过」。
- 规则抽成纯函数 `guide-triggers.ts`；自动弹出的请求入口 `onboarding-auto.ts`（`useAutoGuide`），聊天页、服务页、下拉面板各加一行调用。

### 3. 模型排行榜「热门榜」

- 去掉了每行的「· N 人选用」、顶部提示「按『文本聊天』选用人数排序…」；空状态改成中性的「暂无可显示的模型」。
- 新排序由服务端算好：`ModelAccessEndpoints.getLeaderboardInfo` 的响应新增 `hotOrder`（只含模型键的有序列表），前端按它排，不在列表里的排最后（再按名称）。旧字段 `popular` 保留兼容旧客户端。
- **利润率怎么算**（`apps/server/src/modules/model-access/domain/hot-order.ts`）：取当前生效价目表里该模型的文字输入 / 输出**全天价**（`BillingModelRatePort.getActiveTokenRates`，售价和成本价都在里面），利润率 = 1 −（文字输入成本 + 文字输出成本）÷（文字输入售价 + 文字输出售价）。范围同用户端「文本聊天」模型列表（启用、可用于 chat 场景）。
  1. 第一位是 DeepSeek（模型键或出品方含 deepseek / 深度求索）；多个时取利润率最高的那个，其余照常参与排序；
  2. 其余按利润率从高到低，利润率相同保持目录排序；
  3. 缺价（没有输入或输出价、或售价合计为 0）的排最后。
- 成本价和利润率都不出服务端：响应里只有模型键顺序。
- **契约升到 5.1**：`version.ts`、README 变更记录、`service-unit-pricing.test.ts` 的版本断言、Android 生成产物（`pnpm android:generate`：`Contracts.kt` 版本号与 `hotOrder` 字段、`contracts.json`）已同步。WebSocket 鉴权已放行 5.x，没改。

## 改了哪些文件

契约
- `packages/contracts/src/http/model-access.ts`：`ModelLeaderboardInfo.hotOrder`（可选）
- `packages/contracts/src/version.ts`：5.0 → 5.1
- `packages/contracts/README.md`：5.1 变更记录
- `packages/contracts/test/service-unit-pricing.test.ts`：版本断言
- `apps/android/core/contracts-generated/src/main/kotlin/app/weiban/contracts/Contracts.kt`、`.../resources/contracts.json`：重新生成

服务端
- `apps/server/src/modules/model-access/domain/hot-order.ts`（新）：排序纯函数
- `apps/server/src/modules/model-access/domain/hot-order.test.ts`（新）：DeepSeek 置顶、按利润率、缺价排末尾等单测
- `apps/server/src/modules/model-access/application/catalog.ts`：`hotOrder()`，`leaderboardInfo()` 返回 `hotOrder`
- `apps/server/test/web-feedback-catalog.test.ts`：补 `hotOrder` 断言与 `hotOrder()` 单测（只返回 chat 模型键、DeepSeek 置顶）

网页
- `apps/web/src/features/permission-steps.ts`（新）、`permissions-onboarding.tsx`：权限逐个申请
- `apps/web/src/features/guide-triggers.ts`（新）、`onboarding-auto.ts`（新）、`onboarding-guide.tsx`：自动弹出、面板版小程序步骤、新会员说明框
- `apps/web/src/features/chat.tsx`、`me.tsx`、`pull-panel.tsx`：各加一行 `useAutoGuide`；下拉面板宫格 / 卡册加 `data-guide`
- `apps/web/src/app/app.tsx`：新手流程中关闭自动弹出
- `apps/web/src/features/models.tsx`：热门榜去掉选用人数、按 `hotOrder` 排

测试
- `apps/web/vitest.config.ts`（新）：网页纯逻辑单测纳入根目录 `pnpm test`（原来 `apps/web/test/guided-tour-policy.test.ts` 没有被任何配置收进去，这次一并跑起来了）
- `apps/web/test/permission-steps.test.ts`（新）、`apps/web/test/guide-triggers.test.ts`（新）
- `apps/web/test/e2e/permissions.spec.ts`（新）：逐步顺序、第一步拒绝仍进第二步、已授权跳过、两项都已授权不弹
- `apps/web/test/e2e/guides.spec.ts`（新）：情景预设首次进私聊弹 / 不重弹、老会员进服务弹 / 不重弹、新会员开通马上弹 / 进服务不重弹、免费用户进服务不弹、首次下拉弹 / 不重弹
- `apps/web/test/e2e/fixtures.ts`（新）+ 其余 12 个 e2e 用例改为从 `./fixtures.js` 引入 `test`：默认把引导记为已看过，避免自动弹出的遮罩挡住其他用例；`playwright.config.ts` 注释同步
- `apps/web/test/feedback/onboarding-live.spec.ts`、`browser-fixtures/onboarding-live.tsx`：加自动弹出两例（含面板版小程序完整走完）与 `?start=chat` 入口
- `apps/web/test/feedback/web-feedback.spec.ts`、`browser-fixtures/web-feedback.tsx`：热门榜不再出现选用人数、按 `hotOrder` 排

文档
- `docs/tasks/T-20261103-onboarding-permissions-leaderboard.md`（任务卡随分支提交）
- 本交接

## 自测结果（本机各跑一次）

- 类型检查：`@weiban/contracts`、`@weiban/web`、`@weiban/server`、根 `tsconfig.json` 全部通过。
- 改动文件 ESLint、Prettier 检查通过。
- 单元测试：web + contracts 共 11 个文件 107 例通过（web 19 例：新增 15 例 + 原有 `guided-tour-policy` 4 例首次纳入）；server 的 `hot-order.test.ts`、`web-feedback-catalog.test.ts` 共 11 例通过。
- `pnpm android:generate` 已执行，生成产物已提交。
- 无数据库的真实组件浏览器自测（`test/web-feedback.playwright.config.ts`，本机 Chrome）：`onboarding-live.spec.ts` + `web-feedback.spec.ts` 12 例全部通过（含新增的「首次进私聊自动弹情景预设」「首次下拉自动弹面板版小程序并走完」与热门榜排序）。
- 需要数据库的完整 e2e（`pnpm web:e2e`，含新增 `permissions.spec.ts`、`guides.spec.ts`）本机没有运行中的 Docker，未跑，以 CI 为准。

## 遗留问题

- **「已看过」只存在本机**：项目里没有服务端按用户存引导状态的机制，所以换设备、清浏览器数据、用安卓客户端后，网页上会再自动弹一次；新老会员的区分也按「这台设备有没有先看到过免费」判断——在别的设备开通、第一次在这台设备打开时已经是 PRO+ 的新会员，会走老会员那条路径（进服务时弹一次）。要做到跨设备不重弹，需要新增服务端字段（契约 + 迁移），可另开任务。
- 「老会员第一次点进『服务 → 角色生态』」按总负责人转述理解为**第一次进「服务」页**就弹（引导从「找到角色生态」开始，点进去再讲开关和花费）。如果总经理的意思是点进「角色生态」页才弹，改 `me.tsx` / `ecology.tsx` 各一行即可。
- 新会员说明框里点「带我看看」会切到聊天列表，从「我」开始走完整一节（让新会员认识入口）；点「以后再说」也算弹过。
- 小程序引导：目录里手动学的仍是「发现 › 小程序」版；自动弹出的是新增的「下拉面板版」。两版走完都记为「小程序」已学会，手动开始过任一版后也不再自动弹。
- 热门榜：利润率只看价目表全天价，不考虑分时价和限时折扣；DeepSeek 模型全部缺价时仍按「第一位必须是 DeepSeek」放第一（取目录里靠前的那个）。成本价为 0 的模型按利润率 100% 处理。
- 已在浏览器里被拒绝的权限也跳过对应那一步（系统框不会再出现，弹说明框也没用），由用到时的现有提示引导去设置里打开。
- e2e 新用例依赖测试服务器账号 `browser_guide`（已完成资料、有一个会话）；会员档位用网页侧请求替身模拟，没有改服务器数据。

## 需要总经理决定的事

无。

## 给其他负责人的交接

- 给总负责人：PR 合并前看 CI；契约 5.1 只新增可选字段，网页 / 服务端需一起部署（旧网页不读 `hotOrder`，不受影响）。
- 给 android-lead：契约 5.1 新增 `ModelLeaderboardInfo.hotOrder: List<String>?`，生成产物已更新；安卓如果也有热门榜，同样改为按 `hotOrder` 排、不显示选用人数。
- 给 Codex（验收时）：e2e 用例默认经 `test/e2e/fixtures.ts` 把引导记为已看过；专测自动弹出的 `guides.spec.ts` 直接用 `@playwright/test`。
