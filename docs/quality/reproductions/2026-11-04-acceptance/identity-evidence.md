# 账号板块独立证据（2026-11-04）

目标：`0bf2434cdc080b9920c27a6db40e0d7b371c7fc1`。只在本轮临时容器的专用数据库运行。以下连接无密码，仅监听本机；不得替换为生产或共享 `weiban_test`。原始日志不提交。

```powershell
$env:TEST_DATABASE_URL='postgres://weiban@127.0.0.1:15434/wbqa_test_20261104'
pnpm exec vitest run --project server apps/server/test/identity.test.ts apps/server/test/envelope-crypto.test.ts apps/server/test/http-kernel.test.ts apps/server/test/custom-deletion-race.test.ts apps/server/test/kek-rotation.test.ts apps/server/src/modules/identity apps/server/src/platform/deletion --reporter verbose
# 退出 0：8 文件、74 项通过，118.22 秒。
pnpm exec vitest run --project server apps/server/test/client-logs.test.ts --reporter verbose
# 退出 0：1 文件、3 项通过，21.28 秒。
pnpm exec vitest run --project client-core packages/client-core/test/client.test.ts --project web apps/web/test/permission-steps.test.ts --reporter verbose
# 退出 0：2 文件、22 项通过，3.62 秒。
$env:TEST_DATABASE_URL='postgres://weiban@127.0.0.1:15434/wbqa_browser_20261104'
pnpm exec playwright test --config apps/web/playwright.config.ts apps/web/test/e2e/account.spec.ts apps/web/test/e2e/permissions.spec.ts apps/web/test/e2e/onboarding.spec.ts --grep '服务器失效|实际头像|逐步顺序|被拒绝|已授权|两项都|首次昵称' --trace off --reporter line
# 退出 0：7 项通过，1.2 分钟。只运行列出的筛选项，没有运行新版本接管用例。
$env:TEST_DATABASE_URL='postgres://weiban@127.0.0.1:15434/wbqa_identityprobe_20261104'
pnpm exec vitest run --config docs/quality/reproductions/2026-11-04-acceptance/identity-probe.config.ts --testNamePattern '重置密码' --reporter verbose
# 有效运行退出 1：两个密码类型均复现失败。最终文件增加注销用例后，此命令会主动跳过它。
pnpm exec vitest run --config docs/quality/reproductions/2026-11-04-acceptance/identity-probe.config.ts --testNamePattern '改过' --reporter verbose
# 退出 1：1 失败、2 主动筛选跳过；68.74 秒。
```

脱敏观察（仅布尔值和聚合数量）：

```json
{"probe":"password-reset-race","legacy":false,"oldSessionAccepted":true,"newPasswordAccepted":true,"oldPasswordAccepted":false}
{"probe":"password-reset-race","legacy":true,"oldSessionAccepted":true,"newPasswordAccepted":false,"oldPasswordAccepted":true}
{"probe":"alias-after-deletion","verifierOk":true,"blockingRemnants":0,"auditRowsWithNames":1}
```

前两项期望分别都是 `oldSessionAccepted=false,newPasswordAccepted=true,oldPasswordAccepted=false`；注销期望 `auditRowsWithNames=0`。真实账号服务、数据库、密码算法、事件和队列均执行；没有修改业务源码或用替身返回漏洞结果。调度屏障仅稳定暴露两项真实操作之间允许的交错。
