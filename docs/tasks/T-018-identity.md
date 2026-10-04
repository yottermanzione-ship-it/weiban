# T-018 账号模块 identity（D-L0-06）

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-05 |
| 状态 | 进行中 |
| 分支 | `T-018-identity` |

## 目标

用户能用邀请码注册、登录、退出，管理自己的资料和设置；管理员有独立的权限和会话。后续所有需要登录的功能都建立在它之上。

## 输入文档（必读）

- `docs/architecture/dev-plan.md` D-L0-06 行
- `docs/backend/kernel.md`（内核用法，必读）
- `docs/architecture/security-and-privacy.md`、`docs/decisions/ADR-0006-auth-and-secrets.md`
- `packages/contracts/src/http/identity.ts` 及相关事件、端口
- PRD：`docs/product/prd-v1/01-account-settings.md`、`13-admin.md`（权限部分）
- `docs/handoffs/2026-10-05-backend-lead-T-016.md`（identity 必须提供 `SESSION_VERIFIER`；注销时调用 `destroyKey`）

## 工作内容

按 dev-plan D-L0-06 实现：
- 邀请码注册、登录、会话、退出、登录设备列表
- 我的资料、时区、全局通知设置、界面偏好（主题 green / pink，多设备同步，改动发同步更新）
- 管理员角色与管理会话
- 创建管理员、重置密码的命令行脚本
- 删除清单接口（先实现框架）

严格按契约实现，修改请求不补默认值（Q-001 已在契约修复）。

## 范围

- 可以改：`apps/server/`（新增 `src/modules/identity/` 及其迁移）、`docs/backend/`
- 新增模块目录如需在 `packages/eslint-config/architecture.js` 登记：先查是否已登记；未登记就写进交接说明，由总负责人转运维处理，自己不改
- 不可以改：`packages/contracts/`（如需改契约，在交接说明中提出变更申请）、`docs/quality/`、`.github/`
- 在任务分支上提交，不合并 main

## 验收标准

- [ ] `pnpm check` 通过（本机带数据库运行，集成测试不跳过）
- [ ] 每个接口都有测试：正常路径、未登录、无权限、参数错误、重复请求
- [ ] 密码用慢哈希存储（算法按 ADR-0006）；登录失败有限流或锁定；会话可吊销
- [ ] 无效、已用、过期的邀请码都被拒绝；邀请码只能用一次（并发注册测试）
- [ ] 改主题后，同一用户的其他会话能收到同步更新（有测试）
- [ ] 日志里不出现密码、会话令牌（复用内核的脱敏测试方法）
- [ ] 命令行脚本可用，`docs/backend/identity.md` 写清用法
- [ ] 本机启动服务器后，用 curl 走通「注册 → 登录 → 读资料 → 改主题 → 退出」，结果记入交接说明
- [ ] 提交格式 `T-018 类型: 说明`

## 交付物

- 分支 `T-018-identity`
- 交接说明：`docs/handoffs/2026-10-05-backend-lead-T-018.md`（提交在分支上）
