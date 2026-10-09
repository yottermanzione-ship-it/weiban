# health 模块（经期日记）实现说明

> 负责人：后端负责人 · 来源任务：T-059 · 需求 PLAY-01（`docs/product/prd-v1/16-interactive-play.md`）· 设计 `docs/architecture/health-data.md`（本文不重复设计，只记实现取舍）

## 代码位置

- `apps/server/src/modules/health/`：`domain/prediction.ts`（P-37 预测纯函数）、`application/store.ts`（加解密读写）、`application/health.service.ts`（HTTP 用例 + `HealthReadPort` 实现）、`application/lifecycle.ts`（删除清单、角色删除撤销授权）、`http/health.controller.ts`。
- 迁移：`apps/server/drizzle/0020_health.sql` / `.down.sql`（schema `health` 三张表 + `chat.messages.labels text[]`）。
- lint：`packages/eslint-config/rules/health-port-exit.js`（`HealthReadPort` / `HEALTH_READ_PORT` 只允许 health、ai-runtime、装配入口）；`architecture.js` 登记 `health` 为中层、schema `health`。

## 存储

- `period_entries` 一行一条：`kind=cycle` 存 `{startDate,endDate}`；`kind=day_log` 存 `{cycleId,date,flow,pain,symptoms,notes}`。整行用用户 DEK 加密，AAD = `health:{entryId}:{userId}`。
- 所有计算「全部取出 → 解密 → 内存计算」，不按日期查库。
- `period_settings` 表已建（P-37 用户自填默认值），契约 2.5 没有设置接口，当前不写入，预测一律用 P-37 默认值（28 / 5 天）。
- `grants` 明文（授权关系不是健康数据）。授权变更写审计 `health.authorization_updated`，只记角色 ID 增减。

## 规则取舍

- 新建经期：开始日不能晚于用户当地今天；与已有经期重叠返回 409 `conflict`。
- 未填结束日的经期，按「进行中」算到今天，但最多 15 天（`P37.staleOpenDays`）——超过视为用户忘记补记，不再算在经期，也不会触发「超过 10 天建议就医」。
- 补结束日后，落在结束日之后的日记一并删除。日记日期必须在 [开始日, 结束日或今天] 内；同一天再次提交为覆盖。
- 预测（P-37）：最近 6 个周期（7 次开始日之间的间隔）平均；间隔数 < 2 时用默认 28 天并标 `insufficient_data`；经期天数取最近 6 次有结束日的经期平均，不足 2 次用默认 5 天；周期最大差 > 7 天标 `irregular`。预测日已过而没有新记录时按周期顺延到不早于今天。`disclaimer` 固定「预测仅供参考，不能用于避孕或医疗判断」。
- 「今天」按 identity 资料里的用户时区计算（取不到用 Asia/Shanghai）。
- 列表分页游标是偏移量字符串（只给用户本人，按开始日倒序）。
- 授权只能勾选通讯录中 `active` 的角色；全量覆盖。角色 `contact_removed` / `contact_purged` 时撤销授权，恢复不自动恢复。

## HealthReadPort

- `getPeriodContext`：scene 不在 `direct_reply / proactive_direct / planning` 返回 null；每次实时查 `grants`；无记录返回 null。不返回流量、备注、历史。
- `cycleKey`：`sha256("weiban.health.cycle:{userId}:{锚点经期ID}")` 截 22 字符。锚点 = 正在经期时取「上一次经期」，不在经期时取「最近一次经期」——这样「经期前提醒」和随后那次经期里的关心落在同一个 key，合计受 P-36 约束。补记中间的历史经期可能使 key 变化（可接受）。
- `longPeriodHint` = 在经期且第几天 > 10。

## 「健康」标记

- chat：`messages.labels`（`text[]`，可空）。只从 `PostMessageInput.labels` 写入；用户 HTTP / WebSocket 发送路径（`user.ts`）构造输入时不带 labels，所以客户端传了也被忽略。标签规范化：小写字母开头、≤32 字符、去重排序、最多 8 个。下发时有标签才带 `labels` 字段。
- push：chat 的 `getNotificationContext` 对带 `health` 标签的消息返回 `content: null`，推送因此只显示「XX 发来一条消息」；`messageNotification` 也接受可选 `labels` 做二次防护。

## 注销

`HealthLifecycle` 向 `USER_DATA_REGISTRY` 登记 `purgeUser` / `countUserData`（三张表）。identity 先删 DEK，删除清单再物理删除。
