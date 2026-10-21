# J：Jev 真实线路小样本实测

日期：2026-10-21（北京时间）。执行者：Codex，开发自测；不是独立质量验收或上线切换评测。

## 结论

线上已配置的两个 Jev 条目可通过 B.AI Decisions 接口真实调用，原先推测的 `/v1/judge` 适配不能使用。`jev-latest` 本次也解析为 `jev-1.13.0`，两个条目不是两代模型对比。少量语音忙闲场景表现明确；公开动态和图片搜索的宽泛「现在该不该做」问题多为低置信度。**不能据此把生态默认切成 Jev，也不能为提高触发率直接降低全局门槛。**

## 授权、目标与执行范围

- 依据：`docs/tasks/2026-10-21-gm-feedback-3.md` G4-5，明确在服务器容器内使用已配置线路实测；第四轮第五轮补充要求先 J 后 H4。该专项授权适用于本次测试，通用批次的「不碰服务器」仍约束部署和其它任务。
- 开发目录 / 分支：`C:\wb-dev\wb-decision-j` / `codex/decision-j`；起点 S `e3ceff2c5534b48196dc030452a50c7e528b2615`。实际调用时源码提交：`96bec71e7a068ceaa85430c59ff920853c84ea89`。
- 运行位置：香港重构版 `weiban-prod-app-1`，通过 SSH 将本地构建的评测命令送进独立 Node 进程的标准输入执行。没有覆盖容器文件、重启服务、部署、迁移、切换分支、修改模型 / 价格 / 决策配置。
- 单独数据库连接设 `default_transaction_read_only=on`；只读取两个指定模型的已有线路与平台密文，复用现有 `EnvelopeCrypto`，密钥只在容器内存里使用并清零可变缓冲区；没有把密钥带回本机或输出。
- 全部输入为仓库中固定的合成场景。未读取用户、角色卡、聊天、记忆或健康记录。调用直接经过模型模块的同一 HTTP 适配器，**没有经过完整用户网关 / 积分结算链**，不会扣用户积分，也没有生成应用用量记录；供应商可能计费。

## 方法和结果

先做 4 次冒烟，再做 28 次完整小样本（每条线路 12 个中英文场景 + 2 次重复）。每次同时问 Choice、Noul、Score 三类独立问题，最多 10 秒，单次尝试、不自动重试。场景为：忙时语音、受邀语音、公开资料过期且有新线索、缓存新鲜、公开作品海报、私人朋友自拍。预期标签由测试代码预先给定，不是模型自评。

| 完整样本 | 固定版本条目 | latest 条目 |
| --- | --- | --- |
| 成功 / 调用数 | 14 / 14 | 14 / 14 |
| Choice 与预期标签一致（含重复） | 13 / 14 | 12 / 14 |
| 延迟中位数 | 465 ms | 489 ms |
| 延迟 P95（最近秩） / 最大 | 607 / 607 ms | 633 / 633 ms |
| 输入 / 输出 token（供应商报告） | 6575 / 876 | 6575 / 877 |
| Choice 置信度低于现有 0.55 门槛 | 6 / 14 | 6 / 14 |
| 实际返回版本 | jev-1.13.0 | jev-1.13.0 |

合计 32 / 32 请求成功。含冒烟共 14960 输入 token、2005 输出 token。按本轮官方标准输入价 $0.042 / 百万 token 估算为 **$0.00062832**，输出免费；这是参考价估算，未查供应商实际扣款、优惠或平台积分，不是资金对账通过。

值得保留的反例：

- 固定版本中文「公开资料过期且有新线索」：选 act，但 p(act)=0.51，confidence=0.02；latest 同题选 defer，confidence=0.06。不能把 0.51 当成「很有把握」。
- 中文海报搜索四次都选 act，confidence 在 0.08～0.34；英文两次都选 defer，confidence 为 0.28 / 0.14。虽然相同中文题重复的标签没变，概率会变，语言变体也改变了标签。
- 按现有保守 defer 与 0.55 门槛，上述想要触发的搜索多数仍会跳过；说明题目分解和评测需要改进，不能通过降低门槛掩盖。

## 可复查证据

- [完整样本 JSONL](2026-10-21-jev-full.jsonl)，SHA256 `91dcfc78c3b67137c6f0af288a53f484ee39bebf43f4e5d2cd998923476b5954`。
- [冒烟 JSONL](2026-10-21-jev-smoke.jsonl)，SHA256 `3bf0d13bd2c4282fa2a02cc3ff95afd7d2c55416ee3906be5b8a1e1301ec41f8`。
- 合成输入 / 预期、固定重复项见 `apps/server/src/modules/model-access/application/decision-evaluation.ts`。证据只含题目 ID、标准化答案 / 概率、耗时、token 和版本，不含凭据或个人记录。为输出白名单结果，没有保存原始 HTTP 正文、供应商 request ID 或传输头。
- 实测之后加严了 token 字段校验、空正文 429 分类，以及网关到达发送阶段时重新检查 deadline；这些防御分支以本地回归验证，没有为此重复产生供应商调用。

## 限制与正式切换闸门

本次只是协议与代表性小样本。`eval-plan.md` 3.15 / 3.16 的 60 道中文题、默认实现对照、100 对盲评、1000 次延迟、7 天稳定性、50 次出境金丝雀、人设稳定性和完整资金 / 并发链均**未完成**。不能以这里的标签一致率称为一般中文准确率，也不能以 14 次的 P95 称为满足正式延迟目标。

本轮未核定 B.AI 与 TypeSafe 的保存期限、训练使用和地区承诺。未向它们发送真实用户资料。正式切换仍需数据政策核验，沿用已有出境净化与健康 / 私密模式排除规则。

## 第一方来源（2026-10-21 核对）

- [B.AI Decisions 协议](https://docs.b.ai/llmservice/api/decisions-api/)：正式路径、问题 map、答案和用量、错误码；不是 Chat Completions。
- [B.AI Jev 模型说明](https://docs.b.ai/llmservice/models/jev-1.13.0/)：版本别名、文本输入、价格与限制。
- [TypeSafe 快速开始](https://docs.typesafe.ai/introduction/quickstart)与 [API](https://docs.typesafe.ai/api/system-one)：原生 System One 协议。
- [TypeSafe 置信度](https://docs.typesafe.ai/confidence)：解释概率与置信度。
- [OpenRouter Jev](https://openrouter.ai/docs/guides/community/jev)：Decisions / System One 两种路径；本轮没有用 OpenRouter 密钥实测。

后续实施方案见 [25 号生态决策方案](../../refactor/25-jev-ecology-decisions.md)。
