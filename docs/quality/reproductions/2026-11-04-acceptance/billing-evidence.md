# 积分验收证据与复跑

固定被审代码 `0bf2434cdc080b9920c27a6db40e0d7b371c7fc1`。探针仅位于授权的质量文档目录；业务源码没有修改。

## 安全前提

必须在独立副本、独立临时数据库执行。以下示例使用本轮自建容器的本机无密码回环连接，不是共享库或生产库。测试会重建其目标数据库；不得替换为 `weiban`、`weiban_test` 或生产连接。并行测试必须使用不同数据库。测试、浏览器均使用合成账户和本机上游；运行凭据不记录到此文件。

## 实际命令与结果

在独立副本的 PowerShell 中执行：

```powershell
pnpm install --frozen-lockfile
pnpm --filter @weiban/contracts build
$env:TEST_DATABASE_URL = 'postgres://weiban@127.0.0.1:15434/wbqa_test_20261104'
pnpm exec vitest run --project server --project contracts packages/contracts apps/server/test/billing apps/server/test/model-gateway.test.ts apps/server/test/model-access.test.ts apps/server/src/modules/billing apps/server/src/modules/model-access/application apps/server/src/modules/model-access/domain/rules.test.ts
```

- 安装、契约编译退出 0。
- 原测试首轮退出 1，34 文件、371 项：364 通过 / 7 失败 / 0 跳过；失败只在 legacy-receiver 的 OpenSSL 调用。
- Vitest 过滤按路径片段匹配，因此 `apps/server/test/billing` 实际包含 `billing.test.ts`、`billing-c13.test.ts`、`billing-postpaid.test.ts`。原始文件结果见 [billing-files.json](billing-files.json)，不能把没有运行的文件算进去。
- 本机 `openssl` 不在搜索路径中；使用已经安装的 Git OpenSSL 后仅重跑该文件：

```powershell
$env:OPENSSL_BIN = 'C:/Program Files/Git/usr/bin/openssl.exe'
$env:Path = 'C:/Program Files/Git/usr/bin;' + $env:Path
pnpm exec vitest run --project server apps/server/src/modules/model-access/application/legacy-receiver.test.ts --reporter verbose
```

退出 0，8/8 通过，10.91 秒。没有修改被审代码；371 个不同原有用例在补全环境后的各次运行中均通过，不把重跑的 8 项重复相加。

```powershell
pnpm exec vitest run --config docs/quality/reproductions/2026-11-04-acceptance/billing-probe.config.ts
```

[探针源文件](billing-probe.test.ts)：会员幂等、赠分/服务费两项通过；会员和申请并发返回数据库死锁。增加聚合断言后的第二次同样出现死锁：

```json
{"probe":"MEM-R01","outcomes":[{"status":"fulfilled"},{"status":"rejected","code":"40P01"}],"balanceMicros":10000000,"heldMicros":2000000,"atomicity":{"orders":"0","memberships":"0","requests":"1"}}
```

对账探针初次读取公开结果的 `details` 失败，是探针错误；改为本地数据库聚合查询后，单独运行 `--testNamePattern '获准'`，退出 1，1 项失败、其余 3 项因过滤而跳过。有效证据：

```json
{"probe":"postpaid-reconciliation","ledgerConsistent":false,"balanceMismatchCount":0,"heldMismatchCount":0,"overdrawnCount":1}
```

该失败断言期望合法欠费仍满足账本一致性，实际为 false；不是因数据库断线或缺字段而失败。完整四项探针可用于修复后的验证，保留“正确行为”断言，不修改为接受缺陷。

```powershell
pnpm --filter @weiban/admin build
pnpm --filter @weiban/web build
$env:TEST_DATABASE_URL = 'postgres://weiban@127.0.0.1:15434/wbqa_browser_20261104'
pnpm exec playwright test --config apps/admin/playwright.config.ts --grep '积分提交|价目草稿' --trace off --reporter line
pnpm exec playwright test --config apps/web/playwright.config.ts apps/web/test/e2e/account.spec.ts --grep '积分提醒|断网与账号切换' --trace off --reporter line
```

两次构建退出 0；后台 2/2 通过（55.1 秒），网页 2/2 通过（约 1.1 分钟）。测试使用项目原服务夹具与受控上游，不证明真实供应商可用。已知偶发重试测试本轮通过一次，不能据此宣告偶发消失。

## 生产价格只读核对

2026-11-04 16:38 左右，北京时间。经现有 SSH 钥匙，以只读事务、5 秒限制查询，不读取凭据或用户明细。[可复跑聚合 SQL](production-price-counts.sql)。实际输出摘录：

```text
active_versions|1
enabled_prices|99|models|32|ratio_mismatch_rows|74|ratio_mismatch_models|23
above_models|20|below_models|4|zero_cost_positive_price_rows|0
unit                                    rows  above below
asr_minute                                 2      0     0
audio_input_tokens_per_million             3      0     0
audio_output_tokens_per_million            3      0     0
cached_input_tokens_per_million           25     19     2
cache_write_5m_tokens_per_million           9      9     0
input_tokens_per_million                  25     20     2
output_tokens_per_million                 25     20     1
search_call                               1      0     1
tts_10k_chars                              4      0     0
voice_clone                               2      0     0
```

这只证明已登记成本与已发布售价不符合公式，不证明供应商实际成本或某个用户历史损失。没有写价目、查聊天明细、发布、迁移或重启服务器。
