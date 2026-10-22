# 2026-10-23 榜单匹配、倍率基准与价格校准

> 已发布：源码 `d4ea97ee4393803b22e94ca6a0458e5270b2a23e`，契约 **3.37**，2026-10-23 05:14（北京时间）切到新镜像。本文只登记开发自测和线上实查，不是另一位审查者的独立验收。

## 这轮改了什么

### 1. 榜单不再要求管理员逐条填「榜单对应名称」

原因：后台填的是上游 ID（`gemini-4-argon-high`、`gpt-6.1-sol-max`），Arena 返回展示名（`Gemini 4 Argon (High)`、`GPT-6.1 Sol (Max)`）。旧规范化只去思考档，没有把连字符 / 下划线 / 斜杠统一成空格，所以生产上 0 个模型匹配。

现在：

- `normalizeArenaName` 去掉明确思考档后，把 `-` `_` `/` 统一成空格；点保留，避免把 4.5 / 4.8 之类的版本号改坏。
- 匹配默认顺序：后台手动指定 → 模型显示名 → 上游模型名。新模型不用再填字段。
- 同名不同思考档仍取最好（最小）原榜名次；带日期 / Pro / Flash 等型号词不合并。
- 模型抽屉里的「榜单对应名称」已移除；例外改在「榜单管理 → 匹配」里手动指定。

### 2. 后台「榜单匹配」纠错

`LeaderboardSnapshotStatus.unmatched` 增加按名称相似度算出的最多 3 条候选（含原榜名次和相似度），不自动套用。后台在未匹配模型旁选择候选或输入原名，保存后写审计并刷新状态；「恢复自动」清空手动值。

新增接口：`PUT /api/v1/admin/model/leaderboard/match/:modelKey`，body `{ arenaModelName: string | null }`。

### 3. 倍率基准与价格

- 基准模型：`openai/gpt-6.1-sol`（GPT 6.1 Sol = ×1.00）。
- 19 个未删除模型的 `display_multiplier` 全部清空，改为按基准自动算。
- 售价统一按 models.dev 官方美元价 × **7.2**（后台美元汇率）重算；成本价原样保留。
- 导入时带的手填倍率不再保留；以后清空手填值并保存，就会立即按基准自动算（模型抽屉新增「改为自动」按钮）。

### 4. 新上架模型的场景 / 能力

2026-10-22 19:44–19:50 新加的 15 个对话模型统一为：能力只有 `vision`（识图），场景只有 `chat`（文本聊天），不再出现在语音通话 / 私密模式。Jev、联网搜索、私密模型未改。

## 线上实查

- 健康：`{"status":"ok","role":"all","contractVersion":"3.37"}`，数据库 / crypto 正常。
- 榜单：15 个模型匹配上（用户端连续名次）：
  1 Gemini 4 Argon，2 Claude Opus 5.5，3 Claude Fable 5，4 Gemini 3.8 Flash，
  5 Claude Opus 5，6 Kimi K3，7 Gemini 3.1 Pro Preview，8 GPT 5.6 Sol，
  9 GPT 6.1 Sol，10 Claude Sonnet 5.5，11 GPT 6 Astra，12 DeepSeek V4.1 Flash，
  13 GPT 5.6 Terra，14 Grok 4.5，15 MiMo V2.6 Flash。
- 仍未匹配：私密模型（Arena 没有）、Jev（不上榜）、联网搜索（不是对话模型）。
- 倍率：GPT 6.1 Sol = 1.000，Gemini 4 Argon = 1.000，Claude Sonnet 5.5 = 1.000，Kimi K3 = 1.500，MiMo = 0.047（显示 0.05）。
- 价目表新版本 `rates-20261022211547` 生效，64 条价格无重复、无分时档；成本列未变。
- 发布前数据库备份：`/srv/weiban/backups/pre-arena-20261023T051417Z.dump`；旧镜像保留 `weiban-app:before-arena-20261023` / `weiban-edge:before-arena-20261023`；旧源码目录 `/srv/weiban/releases/445b009...-web`。

## 检查证据

- `apps/server/test/arena-dataset.test.ts`：26 条通过，覆盖上游 ID ↔ Arena 展示名、日期版本不合并、相似度候选。
- `apps/server/src/modules/model-access/application/models.test.ts`：6 条通过，新增「清空手填倍率会调用 setManual(null)」。
- server / admin / contracts typecheck 通过；admin 契约生成 3.37（1200 个定义、467 个接口）与 Android 生成物已同步。
- 本机测试使用 `--pool=threads` 和测试专用预加载绕过 DSH Windows 沙箱对子进程管道的 EPERM；该预加载没有提交进仓库。

## 限制

- 没有用真实管理员会话点一遍「榜单匹配」按钮；接口路由已由线上日志确认映射，权限仍要求 admin。
- 没有做供应商账单对账；DeepSeek 采用忙时 $0.3/$1.2 × 7.2，models.dev 上只有 $0.15/$0.6 的条目，若要以闲时价计费需再调整。
- 没有重新构建 APK；Android 只同步了生成契约。
- 未做整仓全量测试和另一位审查者的独立验收。
