# 3.1 Realtime Flash 上架与实时通话分钟预估修复（2026-11-11）

## 结论（当天两次变更，均已上线）

1. 生产登记并启用了 `qwen/qwen-audio-3.1-realtime-flash`（显示名 `Qwen Audio 3.1 Flash Realtime`）。总经理当天下午追加要求「Flash 也按 1.3 倍加价」，已按官方成本 ×1.3 重定价并发布新价版：
   | 单位 | 售价（元/百万 token） | 成本 |
   |---|---|---|
   | 文字输入 | 1.95 | 1.5 |
   | 文字输出 | 5.85 | 4.5 |
   | 音频输入 | 7.8 | 6 |
   | 音频输出 | 15.6 | 12 |
2. 实时通话「约每分钟积分」整体重做：旧口径按固定每分钟假设（1500 音频输入 token），未计音频上下文每轮累积，低估约 8 倍；新口径按**一通 5 分钟参考通话的平均分钟用量**估算，并对 Omni 3.5/3.8 用官方 7 / 12.5 token 秒。
3. 已发版上线：`10b2ed5d78b5819b06841ea4d83fe3149fc9cb37`，契约 7.10，无迁移；健康检查通过（database/crypto ok）；上一版 `f9550b45f662` 可回滚。

## 生产状态

- 上游：`Alibaba Bailian`（与 3.1 Plus 同一公共百炼账号，`kind=dashscope`，active）；上游型号 `qwen-audio-3.1-realtime-flash`；默认音色 `longanqian_v3.1`
- 标签 `pipeline:rt`、场景 `voice_call`、能力 voice_input/voice_output；实时上限与 Plus 相同（单通 3600 秒 / 单次输出 2048 / 上下文 32768）
- `enabled=t`、`available=true`；审计：`catalog.created`、`price_version.rates_published`、`price_version.service_rates_published`、`realtime_voice.default_set`
- DB 当前价版五项价格：1.95M / 1.95M / 5.85M / 7.8M / 15.6M 微元（input / cached / output / audio_in / audio_out），成本仍为 1.5 / 1.5 / 4.5 / 6 / 12 元
- 线上 `dist/main.js` 含 `realtimeMinuteUsage`（grep 2 处），确认新估算已进镜像

## 新「约每分钟积分」口径与结果

口径（`apps/server/src/modules/model-access/application/realtime-call.ts`）：每分钟 5 轮、用户每轮 20 秒、角色每轮 14 秒、音频 25 token/秒（Omni 3.5/3.8 按 7 / 12.5）、文字输入每轮 1 万 token（按 2026-11 百炼账单反推：3.1 Plus 约 723k 文字 / 约 72 轮）、文字输出每轮 60 token；音频输入每轮累积并封顶 300 秒；5 分钟总量 ÷ 5。

| 模型 | 用户端显示（积分/分钟） | 约合元/分钟 |
|---|---|---|
| Qwen Audio 3.1 Flash | 约 37 | 0.37 |
| Qwen Audio 3.1 Plus | 约 231 | 2.31 |
| Omni 3.5 Plus | 约 191 | 1.91 |
| Omni 3.8 Flash | 约 18 | 0.18 |

旧值 Plus 仅 24.69，实际约 10 元/5 分钟。上表是 5 分钟平均；第 1 分钟更便宜、第 5 分钟更贵。扣费仍按供应商每次回应的实际 token，展示只用于预期。

## 验证

- 单测 23 项通过：`voice-catalog-options.test.ts`（18）+ `voice-call-minute-price.test.ts`（5，含 5 分钟账与 Omni 音频单价）
- 发布闸门 `Assert-ReleaseSource.ps1 -LocalOnly` 通过（本地 main/共享 HEAD/origin-main 引用/线上 f9550b45 全部祖先）
- 服务器：`deployment-version.txt` = 10b2ed5d；`/health` 200，database/crypto ok；镜像 `weiban-app:release-10b2ed5d`
- 生产 DB 价格查询与 `voice-catalog --show` 一致

## 未验证 / 遗留

- **没有真实拨打通话冒烟**：公共百炼账号是否已开通 `qwen-audio-3.1-realtime-flash`、真实账单与平台记账是否一致，均未验证（同账号 3.1 Plus 可用，风险低）。
- 用户端实际显示需在 App/网页模型列表刷新后确认（服务端接口值已按上表）。
- GitHub 本机不可达，分支/主线只在本机，未推送；共享 main 已 ff 到 10b2ed5d。
- 后台「用量与花费」不显示音频 token 的问题仍在，但总经理已说明他指的是百炼控制台账单，不是平台后台，暂不作为需求。

## 附：旧 Android WebView 打开全异常（2026-11-11 晚，12451fb7 已上线）

用户反馈（OPPO PCAM00，ColorOS 11.1 / Android 11）打开 App 后列表一直骨架、顶部黄条「本机聊天数据无法读取，请重新打开微伴」，检查更新也失败。

根因：该机系统 WebView 是旧 Chromium（< 98），没有 `structuredClone`：

- `packages/client-core/src/sync-engine.ts` 的 `SyncEngine.state` getter 用 `structuredClone`；`ChatDriver.start()` 第一帧读状态即抛 `ReferenceError`，被 `chat.tsx` 的 catch 显示为「本机聊天数据无法读取」。
- `apps/web/src/data/runtime-logs.ts` 的 `persist()` 也用它，导致错误上报本身也崩；后台 `client_logs` 只看到 `reference_error`（build 453015，帧指向 persist），真实错误被掩盖。
- 同一原因影响 `.at()`（Chromium 92）、`Object.hasOwn`（93）、`String.replaceAll`（85），所以多个页面都会异常。

修复：新增 `apps/web/src/app/compat-polyfills.ts`（at / replaceAll / hasOwn / structuredClone），在 `main.tsx` 最先引入；`sync-engine.ts` 改用 JSON 克隆不再依赖 `structuredClone`；`local-store.ts` 的 `Object.hasOwn` 改为 `hasOwnProperty.call`（SW 与旧 WebView 都安全）。验证：client-core 90 项通过、web 类型检查通过、发布 `12451fb7`（14:58:20Z）健康检查正常。未在真实旧 WebView 上复验；若用户清缓存后仍异常，需要取 Android System WebView 版本继续补兼容。

## 附二：模型单独测试与通话计时（契约 7.11，发布 90294f53）

- 新接口 `POST /api/v1/admin/model/models/:modelKey/test`（`AdminModelTestResult`）：对模型当前启用的每条线路（最多 8 条）发一条 `你好`、`max_tokens: 8` 的最小文本请求，逐条返回 HTTP 状态、供应商错误码、耗时、token；不扣用户、不写用量，写审计 `model.tested`。实时语音（`pipeline:rt`）与非 token 计费模型返回 `skipped`。后台「模型」列表每行新增「测试」按钮和结果弹窗。
- 生产脚本实测 `deepseek/deepseek-v4.1-flash`：HTTP 200、4899 ms、5 / 11 token，说明该模型当时已恢复；MiniMax 分组按总经理确认属上游不稳定，Gemini 已由总经理换组。
- 客户端日志新增 `call_timing` / `slow_turn`，网页版通话每轮上报 `stopToAudioMs`（本地最后一次出声 → 第一段角色声音）与 `uploadGapMs`（上行最大间隔），仅超过 1.2 秒才报；后台「客户端日志」筛选「通话延迟」可看。
- 服务端 `rt.timing` 增加 `sinceLastUserAudioMs`（服务器最后一次转发用户语音 → 第一段回应声音），用于区分上行/网络与客户端播放。
- Omni 3.5 日志里 17993 ms 的异常：同一次回应收到两次 `response.done`（第二次没有 responseId），按上一次 `response_started` 算出 17.99 秒，不是真实等待；首声仍为 787 ms。


