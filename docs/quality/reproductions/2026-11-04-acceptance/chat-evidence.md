# 私聊板块证据

目标 `0bf2434cdc080b9920c27a6db40e0d7b371c7fc1`。分文件计数：[服务端](chat-server-counts.json)、[客户端](chat-client-counts.json)，只保存文件名和数量，不保存用户内容或登录凭据。全部测试为本地合成数据。

```powershell
$env:TEST_DATABASE_URL='postgres://weiban@127.0.0.1:15434/wbqa_test_20261104'
pnpm exec vitest run --project server apps/server/test/chat.test.ts apps/server/test/ai-runtime.test.ts apps/server/test/ai-runtime-queue.test.ts apps/server/test/memory-persona.test.ts apps/server/test/memory-vector.test.ts apps/server/test/media.test.ts apps/server/test/private-digest-quarantine.test.ts apps/server/test/growth-familiarity-stage6.test.ts apps/server/test/upstream-isolation.test.ts apps/server/test/quirks.test.ts apps/server/test/realtime.test.ts apps/server/test/realtime-sockets.test.ts apps/server/src/modules/ai-runtime apps/server/src/modules/growth apps/server/src/modules/media --reporter verbose
# 退出 0，73 文件 / 655 通过。
pnpm exec vitest run --project client-core packages/client-core/test/sync-vectors.test.ts packages/client-core/test/sync-runner.test.ts --project web apps/web/src/features/chat apps/web/test --exclude 'apps/web/test/e2e/**' --exclude 'apps/web/test/feedback/**' --reporter verbose
# 退出 0，6 文件 / 60 通过。
pnpm exec vitest run --config docs/quality/reproductions/2026-11-04-acceptance/chat-probe.config.ts --reporter verbose
# 退出 1，3 失败 / 1 路径观察通过，无数据库或真实供应商调用。
$env:TEST_DATABASE_URL='postgres://weiban@127.0.0.1:15434/wbqa_browser_20261104'
pnpm exec playwright test --config apps/web/playwright.config.ts apps/web/test/e2e/chat.spec.ts apps/web/test/e2e/chat-avatar.spec.ts --trace off --reporter line
# 首次退出 1：头像 1 通过、聊天 5 停在未完成的昵称引导。
pnpm exec playwright test --config apps/web/playwright.config.ts apps/web/test/e2e/account.spec.ts apps/web/test/e2e/chat.spec.ts --grep '真实API：登录、资料|真实HTTP/WS聊天|关闭WS后HTTP|断网待发消息|HTTP确认清空|真实HTTP记忆' --trace off --reporter line
# 退出 0：前置引导 1 + 原聊天 5 通过，1.6 分钟。没有改业务或原测试来使其通过。
```

当前探针脱敏观察：

```json
{"probe":"voice-growth","awardCalls":0}
{"probe":"legacy-month-cutoff","oldFactIncluded":true}
{"probe":"out-of-order-growth","valid":[true,true,true]}
{"probe":"persisted-message-update","cursor":1,"choiceSaved":false}
```

语音探针只证明当前消息事件无转写就不加分，缺少后续补计是结合 media 写入和 growth 订阅源码确定；不凭此伪造真实供应商识别结果。
