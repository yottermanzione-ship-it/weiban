# T-048 L2 网页：排行榜、用量页、微伴服务页、自定义角色编辑器与账号设置

| 项 | 内容 |
|---|---|
| 负责人 | web-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-08 |
| 状态 | 待开始 |

## 目标

补齐 L2 网页侧缺口（D-L2-08）与 T-045 留下的账号设置（PRD 第 1 章），让用户能在网页上看到模型排行榜与花费、在「我 → 服务」找到微伴服务入口、自己创建角色，并完成账号安全 / 隐私 / 通用 / 主动消息四块设置界面。

## 背景

- 网页已有：`chat.tsx`、`chat-settings.tsx`、`memories.tsx`（记忆页）、`me.tsx`（已含「服务」入口雏形）、`models.tsx`、`settings.tsx`、`wallet.tsx`、`contacts.tsx`、`push-settings.tsx`。
- **缺**：模型排行榜页面（`GET /billing/prices` + 目录已提供价格与排行名次，见 `packages/contracts/src/http/model-access.ts` 的 `listModels` 与 `billing.ts` 的 `getPrices`）、用量页（`GET /billing/usage`，契约 `getUsageSummary` 第 192 行「按天 / 角色 / 用途 / 模型汇总的花费」）、微伴服务页聚合入口、自定义角色编辑器。
- T-045 交接（`docs/handoffs/2026-10-08-codex-T-045.md` 第 25 行）明确：「当前不是完整账号设置模块，账号安全 / 隐私 / 通用 / 主动消息等仍待后续按设计补齐」。

## 输入文档

开工前必须读：
- `docs/product/prd-v1/01-account-settings.md`（账号设置四块，本任务的主要需求来源）
- `docs/product/prd-v1/02-model-billing.md` MDL-01～MDL-06（排行榜与用量页）
- `docs/product/prd-v1/04-chat.md` CHAT-13 第二组（「和 TA 的相处」设置项）
- `docs/product/prd-v1/14-services.md`（微伴服务页）
- `docs/product/prd-v1/03-characters.md` CHR-07（自定义角色创建）
- `docs/design/`（设计体系与页面设计说明；微伴粉主题见 CHR/设计文档）
- `packages/contracts/src/http/`（identity、billing、model-access、characters、companion）
- `docs/team/dev-environment-notes.md`（本机环境，必读）

## 范围

- **可以改**：`apps/web/**`。
- **不可以改**：`apps/server/**`（后端由 T-046/T-047/T-049 负责）、`apps/admin/**`（T-049）、`packages/contracts/**`（如缺接口，在交接里写契约变更申请，**不要自己改**）、`apps/android/**`、`docs/quality/**`。
- 界面必须复用现有设计令牌与组件（`docs/design/`），不要自造样式体系；主题要同时支持默认微信绿与微伴粉（跨设备同步由后端字段 `identity` 的界面偏好承载）。

## 验收标准

逐条可检查，质量负责人照此验收：
- [ ] 模型排行榜页：列出已上架模型，按契约返回的价格与排行名次展示；每行「用这个模型」直接设为聊天模型并显示轻提示（MDL-05 第 5 条，不弹确认框）
- [ ] 换模型提醒按 MDL-06：若有角色单独设置了模型，提示文案正确说明这些角色不受影响
- [ ] 用量页：按天 / 角色 / 用途 / 模型四种维度汇总展示花费，数据来自 `getUsageSummary`，不前端重复计算
- [ ] 微伴服务页：作为「我 → 服务」入口聚合页，含聊天偏好、记忆、钱包 / 用量等入口，链接可达
- [ ] 聊天设置第二组完整：贴合度滑杆（5 档，默认第 3 档）、情景模式、关系类型、称呼、模型，改动后从下一次回复起生效
- [ ] 自定义角色编辑器：能按 CHR-07 填写并提交，用 T-047 交付的接口；分类变更时按单向规则给出提示
- [ ] 账号安全：改密码 / 退出其他设备等按 PRD 第 1 章实现
- [ ] 隐私设置：按 PRD 第 1 章实现（含成人模式相关可见性开关，若有）
- [ ] 通用设置：主题（微信绿 / 微伴粉）、字号或无障碍项等按 PRD 第 1 章实现
- [ ] 主动消息设置：开关、频率、主动来电、TA 的日常四项能读写，并在界面上明确说明「设置已保存，实际主动能力随 L3 上线」（不得暗示已生效）
- [ ] 所有页面在窄屏（手机浏览器）下可用，无横向滚动
- [ ] 真实浏览器端到端测试通过，且**不修改后端**为前提
- [ ] 没有为让检查通过而放宽断言、跳过测试或改门禁

## 交付物

- 代码 / 文档路径：`apps/web/**`、`docs/web/**`（实现说明）
- 交接说明：`docs/handoffs/2026-10-08-web-lead-T-048.md`
- 分支：`T-048-l2-web-pages`（已建好，worktree 在 `C:\wb-dev\wb-t048`）
- **给安卓负责人的交接**：列出本任务所有页面的路由与所用接口，T-051（安卓）照此对齐。
