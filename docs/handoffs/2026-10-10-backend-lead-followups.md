# 交接说明：后端补齐——health 3.0 三项、主动消息单角色上限按频率档位

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 日期 | 2026-10-10 |
| 分支 | `T-059c-health-proactive-followups`（已合入 `local/trunk`） |
| 测试 | **未测试**（按总经理要求只保证 typecheck 通过） |

## 做了什么

1. health（契约 3.0，补 T-059 交接缺口）：
   - 用户默认周期 / 经期天数：`GET/PUT /api/v1/me/health/settings`，加密存 `health.period_settings`；预测（用户接口和给 AI 的 `getPeriodContext`）在记录不足时改用用户设置，未填仍是 28 / 5。
   - 一键清空：`POST /api/v1/me/health/clear`（`{confirm:"CLEAR"}`），物理删除经期、日记、设置、授权。
   - 症状标签：新表 `health.symptom_tags`（迁移 0027，带 10 个初始标签）；用户 `GET /api/v1/health/symptom-tags`；管理员 `GET/PUT /api/v1/admin/health/symptom-tags`。记日记时校验标签在启用列表里（日记原有的已停用标签允许保留）。
2. proactive：`canSendProactive` 上限范围从 1–3 放宽到 1–5；`recordSent` 新增可选参数 `perCharacterLimit`（默认 3），不再写死 3；合计 8 不变。调度器（`proactive-scheduler.ts`）和经期关怀（`health-care.ts`）按用户频率档位（少 1 / 适中 3 / 多 5）传值，去掉了调度器里「最多 3」的临时截断。

## 改了哪些文件

- packages/contracts/src/ports/proactive.ts（`recordSent` 加可选尾参数、注释改上限范围；兼容改动）
- apps/server/drizzle/0027_health_settings_tags.sql、.down.sql、meta/_journal.json
- apps/server/src/modules/health/{domain/prediction.ts, application/store.ts, application/health.service.ts, application/symptom-tags.ts（新）, http/health.controller.ts, health.module.ts, infra/db/schema.ts}
- apps/server/src/modules/proactive/application/proactive-message.service.ts
- apps/server/src/modules/ai-runtime/application/{proactive-scheduler.ts, health-care.ts}
- docs/backend/health.md、docs/backend/proactive.md

## 遗留问题

- 未写 / 未跑测试，未跑迁移。
- 端口 `ProactiveMessagePort.recordSent` 增加了一个可选参数，属契约次版本兼容改动，由总负责人指示直接做，未单独走变更申请；请架构负责人补登记。
- 清空经期日记不会清 ai-runtime 的经期关怀名额账本（`health_care_ledger`，只有不透明周期键，无日期和内容）；如需一并清，由 AI 负责人订阅或另加端口。
- 症状标签管理员整体保存时，删除的标签在旧日记里仍按名字显示（契约要求），新记录不能再选。

## 需要总经理决定的事

无

## 给其他负责人的交接

- 给 web-lead / android-lead：经期页可接设置、清空、症状标签三个接口；管理后台可接症状标签维护（ADM-04 第 5 条）。记日记时传入不在列表里的标签会返回 400。
- 给 ai-lead：调度器与经期关怀已按频率档位传单角色上限，「多」档现在实际可发 5 次。
- 给 architect：补登记 `recordSent` 的可选参数 `perCharacterLimit`。
