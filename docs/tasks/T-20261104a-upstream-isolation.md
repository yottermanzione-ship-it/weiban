# T-20261104a 用户触发的服务商拦截不影响上游账号判断；用户之间的拦截互不影响

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead（模型网关、上游状态）+ ai-lead（回复引擎处理确认） |
| 派发人 | 项目总负责人 |
| 日期 | 2026-11-04 |
| 分支 | `fix/upstream-isolation-20261104`（worktree `C:\wb-dev\wb-isolation`，基于 origin/main 6256972e） |
| 状态 | 待验收（开发自测完成，PR 已开） |
| 优先级 | 高（线上故障的后续加固） |
| 来源 | 总经理 11-04 两条要求：① 以后用户再触发服务商拦截，绝不能影响后台的上游账号判断；② 用户之间的拦截互不影响 |

## 目标

不管哪家服务商、用什么错误格式拦内容，后台的上游账号都不会被打成不可用；某个用户反复被拦时只限制他自己，保护共用的私密上游账号。

## 背景

- T-20261103j（PR #56）已把已知的安全策略格式（`policy_violation` / `policy_error` 等）归为 `content_rejected`，并登记被拦消息。
- 但名单只覆盖已知格式。换一家服务商、或同一家换了错误格式，401 / 403 普通正文仍会被当成密钥失效，把整个上游标 `invalid`，所有用户的私密回复都停。
- 私密模型的上游账号是所有用户共用的。一个用户反复发会被拦的内容，可能连累整个账号。

## 输入文档

- `docs/handoffs/2026-11-03-private-policy-block.md`、`docs/tasks/T-20261103j-private-policy-block.md`
- `docs/backend/model-access.md`（上游状态、调度与健康）、`docs/ai/runtime-overview.md`（2.2 错误归类、网关返回的处理表）
- `apps/server/src/modules/model-access/application/upstreams.ts`、`scheduler.ts`、`gateway.ts`、`media-gateway.ts`、`infra/upstream-probe.ts`

## 范围

- 可以改：model-access 的上游状态入口、文本 / 媒体网关的结果归类；新的用户限制规则；`product-params.ts` 加参数；相关测试与文档。
- 不可以改：契约（`packages/contracts`）、`minClientVersion`；回复引擎对 `content_rejected` 的已有处理；能不加迁移就不加。

## 要求与验收标准

- [ ] **自检**：真实调用回 `invalid_key`（401 / 403、正文不是已知安全策略格式）时，先用同一把密钥做一次连通测试（与后台「测试」同一个 `UpstreamProbe`）。通过：这次按 `content_rejected` 处理，不改上游状态、不暂停、不累计失败；失败：按原逻辑标 `invalid`。
- [ ] 自检结果按上游在进程内缓存约 60 秒（常量），同一时间的多个请求只发一次测试。
- [ ] 文本网关、媒体网关、语音会因 `invalid_key` 改上游状态的路径都覆盖到；改动集中在上游状态入口附近。
- [ ] 调用方拿到的类别跟着变：自检通过时回复引擎拿到 `content_rejected`（回推托语、登记被拦消息），不进等待、不被巡检反复重试。
- [ ] `quota_exhausted` 与 402 维持原样，不自检。
- [ ] **用户限制**：同一用户 1 小时内被服务商拦截 5 次后，接下来 1 小时内他的私密回复不请求服务商，直接按 `content_rejected` 处理（回推托语、不扣费）；其他用户不受影响。三个参数只在 `product-params.ts` 定义一处，写明「总负责人 2026-11-04 定，总经理可调」。用现有用量记录计数，不新建表。限制生效时打一条只含用户 ID、次数的结构化日志。
- [ ] **隔离确认**（有测试）：被拦记录按会话隔离；上游状态不会因任何用户的内容被拦而改变；线路冷却不会因 `content_rejected` 触发；用户 A 受限时用户 B 的私密回复照常请求服务商。
- [ ] 测试：401 / 403 自检通过 / 失败、自检缓存、A 被限制 B 不受影响、到期恢复、隔离确认；测试数据全部自造。
- [ ] 文档：`docs/backend/model-access.md`、`docs/ai/runtime-overview.md`；交接说明。

## 交付物

- 代码 / 文档：见 PR（base main）
- 交接说明：`docs/handoffs/2026-11-04-upstream-isolation.md`
