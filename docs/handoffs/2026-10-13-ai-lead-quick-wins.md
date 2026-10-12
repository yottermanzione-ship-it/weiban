# 交接说明：AI 小改动合集与三个新情景预设

| 项 | 内容 |
|---|---|
| 负责人 | AI 系统负责人（ai-lead） |
| 日期 | 2026-10-13 |

依据：`docs/refactor/03-aiyu-learnings-ai.md` 改进清单 #1、#2、#3、#6、#13 与第 4 节；后端交接 `2026-10-13-backend-lead-ui-refresh.md`。按总经理授权不写测试、不跑测试 / 评测，只保证 typecheck / lint / build 通过。

## 做了什么

1. 网关思考开关：所有文本调用默认关闭思考（DeepSeek / 百炼 Qwen / OpenRouter 各自字段，认不出不发；400 时去掉字段重试）。
2. 空输出 / 截断检测与三步降级：新失败类别 `empty_output` / `truncated`，同模型加额度重试 1 次，后台整理类再换平台默认模型试 1 次，打警告日志，不误报上游故障。
3. 回复上下文：毫秒时间移出第 2 条系统消息，前缀只写日期，精确时间 + 「距上条多久」放末尾。
4. 默认温度：聊天 0.9、推演 / 朋友圈 0.8、记忆 / 导入 0.2、判断类 0（调用方传了以调用方为准）。
5. 剥离混进正文的思考内容。
6. 情景预设：自动（规则判断 + 惯性，永不进入恋爱 / 私密）、树洞分享（倾听风格 + 关小巧思 / 主动语音 / 表情包）、加油打气；三项 `aiReady` 置为 true；「自动」成为新账号默认预设。
7. 迁移 0087：放宽 `companion_settings.scenario_mode` 取值检查（后端 0085 漏改，保存新预设会被数据库拒绝），列默认值改为 `auto`。

详细说明见 `docs/ai/scenario-presets.md`。

## 改了哪些文件

- `apps/server/src/modules/model-access/infra/text-adapter.ts`、`application/gateway.ts`、`application/resolver.ts`
- `apps/server/src/modules/ai-runtime/domain/scenario.ts`（新）、`domain/time-sense.ts`（新）、`domain/persona.ts`
- `apps/server/src/modules/ai-runtime/application/reply-context.ts`、`reply-engine.ts`、`quirk-service.ts`、`media-ai.ts`、`group-chat.ts`、`settings.ts`
- `apps/server/src/modules/ai-runtime/infra/db/schema.ts`
- `apps/server/drizzle/0087_scenario_presets_ai(.down).sql`、`drizzle/meta/_journal.json`
- `docs/ai/scenario-presets.md`（新）、本文件

## 遗留问题

- **改了聊天提示词与默认温度，上线前必须跑评测集前后对比**（人设一致、自然度、边界；树洞 / 打气 / 自动各补几条用例）。
- 各家「关闭思考」字段与默认值未实测；`thinkingControlFor` 按地址 / 模型名推断。
- 空输出重试时输出额度 ×1.5 可能超过冻结额，结算是否允许超出未核对（billing 负责人确认）；第一次空输出的上游费用由平台吸收（按「调用失败」释放）。
- 「现在：偏向倾听」界面提示需接口返回当前判断（需契约变更），本批未做；规划层兜底判断未做。
- 没有设置行的老用户也会按「自动」处理（与「新账号默认」略有扩大），产品如需区分请告知。
- 无测试，交 Codex 验收时重点看：思考字段 400 回退、空输出降级不会递归、自动永不出现恋爱语气、树洞关小巧思。

## 需要总经理决定的事

无。

## 给其他负责人的交接

- 给 Web / Android：情景预设三项 `aiReady` 已为 true；新账号默认显示「自动」。
- 给后端：0085 漏改 `ai_runtime.companion_settings` 的取值检查，已由 0087 补上，请知悉。
- 给 billing / 架构：空输出重试的输出额度可能超冻结额，请确认结算行为；网关新增内部失败类别仅写入用量记录 `errorCode`（字符串），不改契约。
- 给产品：确认「没有设置的老用户也默认自动」是否可接受；树洞内容是否不外传。
