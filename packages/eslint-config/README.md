# @weiban/eslint-config · 共享代码检查规则

负责人：运维负责人（规则**内容**由架构负责人定，见 `docs/architecture/engineering-standards.md` 第 3 节）。

## 包含什么

1. ESLint 推荐规则 + typescript-eslint 推荐规则；禁止 `any`。
2. 模块边界规则 R1～R9，由本目录的本地插件 `weiban` 实现：

| 规则             | ESLint 规则名              | 检查什么                                                                       |
| ---------------- | -------------------------- | ------------------------------------------------------------------------------ |
| R1 公开出口      | `weiban/module-boundaries` | 其他模块只能 import `modules/<模块>/index.ts`                                  |
| R2 层级方向      | `weiban/module-boundaries` | 下层不 import 上层；平台内核不 import 业务模块                                 |
| R3 聊天不依赖 AI | `weiban/module-boundaries` | `modules/chat` 不 import `modules/ai-runtime`                                  |
| R4 模型出口唯一  | `weiban/exclusive-sdk`     | 供应商 SDK 和接口域名只出现在 `modules/model-access`（检查范围：`apps/` 全部） |
| R5 推送出口唯一  | `weiban/exclusive-sdk`     | 推送 SDK 只出现在 `modules/push`                                               |
| R6 契约来源      | `weiban/contracts-source`  | 只从 `@weiban/contracts` 包出口导入，不引用契约内部文件                        |
| R7 时间          | `weiban/no-raw-time`       | 服务器业务模块不直接 `new Date()` / `Date.now()`（平台内核、测试除外）         |
| R8 数据表        | `weiban/own-schema-only`   | `pgSchema()` 和原生 SQL 只用自己的 schema                                      |
| R9 扣费出口唯一  | `weiban/billing-port-exit` | 只有 `modules/model-access` 调用 `estimateAndReserve / settle / release`       |

模块的层级、schema 名、SDK 与域名名单集中在 `architecture.js`，只在这一处定义。

## 证明规则生效

`test/module-boundaries.test.ts` 对每条规则各有「越界写法必须报错」和「合规写法不报错」的用例，随 `pnpm test` 运行。

## 已知局限

- 服务器内部互相引用须写**相对路径**；以后启用路径别名（如 `@/modules/chat`）时要在 `rules/module-boundaries.js` 补别名解析。
- 同层模块之间的**循环依赖**暂不检查（ADR-0004 要求禁止），可在服务器工程建立后加 `import/no-cycle` 或 dependency-cruiser。
- R6 中「在 web / server 里另写一份接口类型」、R8 中拼接字符串生成的 SQL，lint 无法可靠判断，由质量负责人评审兜底。
