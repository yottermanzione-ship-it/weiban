# 交接说明：注册简化（邀请码选填、密码最短 8 位）

| 项 | 内容 |
|---|---|
| 负责人 | 后端负责人 |
| 日期 | 2026-10-12 |

## 做了什么

按总经理网页试用后的意见（2026-10-12 总经理调整），全链路一次改完：

1. **邀请码选填**：不填也能注册，不送余额；填了照旧校验，无效报 `invite_invalid`，有效照旧用掉并发注册赠送。管理后台邀请码功能不变。
   - 重试判断不再依赖邀请码：同一用户名的账号建好不超过 10 分钟、状态正常、密码正确，再次注册视为同一次注册的重试（返回 200 和新会话）；带码时还要求码正是这个账号用掉的。超过 10 分钟一律报 `username_taken`（防止拿注册接口绕过登录锁定）。
   - 客户端没填邀请码时省略字段（契约 `min(6)` 仍在，空字符串会被拒）；服务器对只含空白的码也按「没填」处理。
2. **密码最短 8 位**：契约 `Password` 改为 `min(8)`；去掉「至少 5 个不同字符」，保留「不能包含用户名」「太常见」两条，常见密码表补了一批 8–9 位的（12345678、password、aaaaaaaa 等）。登录、改密码、管理后台登录用的是同一个 `Password`，一起变成 8 位。
3. 网页注册页、改密码表单、管理后台登录页、安卓登录页的提示和前端校验同步为 8 位；邀请码标「选填」、去掉必填校验，「有邀请码？注册」改为「没有账号？注册」。
4. 重生成 Android 契约生成物（`pnpm android:generate`）。
5. 文档：PRD ACC-01、PRD 总表、用户流程、术语表、prd-answers、安全与隐私、架构总览、ADR-0006 结论、`docs/backend/identity.md` 均注明「2026-10-12 总经理调整」。

按总经理要求本次**不写测试、不跑测试**，只跑 typecheck / lint / build；安卓未编译。

## 改了哪些文件

- `packages/contracts/src/http/identity.ts`
- `apps/server/src/modules/identity/application/accounts.ts`
- `apps/server/src/modules/identity/domain/rules.ts`
- `apps/web/src/features/auth-page.tsx`、`apps/web/src/features/account-settings.tsx`
- `apps/admin/src/features/login.tsx`
- `apps/android/feature/auth/src/main/kotlin/app/weiban/feature/auth/AuthScreen.kt`
- `apps/android/core/contracts-generated/...`（生成物）
- 文档：`docs/product/prd-v1/01-account-settings.md`、`docs/product/prd-v1.md`、`docs/product/user-flows.md`、`docs/product/glossary.md`、`docs/architecture/prd-answers.md`、`docs/architecture/security-and-privacy.md`、`docs/architecture/overview.md`、`docs/decisions/ADR-0006-auth-and-secrets.md`、`docs/backend/identity.md`

## 遗留问题

- 现有测试里可能有「没有邀请码 → 400」「密码 9 位被拒」「不同字符少于 5 个被拒」「拿已用码重试」等用例，按本次改动会失败，需要后续更新（本次按要求未跑测试）。涉及 `apps/server/test/identity.test.ts`、`apps/server/src/modules/identity/domain/*.test.ts`、安卓 `AuthScreenTest.kt`、网页 auth 相关测试。
- 契约变更未走变更申请流程（总经理直接指示）；契约版本号未改，如需记录请架构补记。
- 注册不再强制邀请码后，公网上任何人都能注册；新账号余额为零、角色不回复，但仍能占用账号名和存储。如需限流可后续加按 IP 的注册频率限制。

## 需要总经理决定的事

无

## 给其他负责人的交接

- 给 Codex / 质量：按上面「遗留问题」第 1 条更新相关测试。
- 给架构：契约 `RegisterRequest.inviteCode` 变为可选、`Password` 改为 8 位，请在契约变更记录里补登。
- 给 Android：生成物已更新，注册页改动随下次统一打包验证。
