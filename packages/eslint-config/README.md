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
| R7 时间          | `weiban/no-raw-time`       | `apps/server/src` 不直接取当前时间（含 `globalThis.Date`）；平台内核、测试除外 |
| R8 数据表        | `weiban/own-schema-only`   | `pgSchema()` 和原生 SQL 只用自己的 schema                                      |
| R9 扣费出口唯一  | `weiban/billing-port-exit` | 只有 `modules/model-access` 调用 `estimateAndReserve / settle / release`       |

另外两项保护边界规则本身的检查（T-015）：

| 检查                 | 实现                                             | 检查什么                                                                                 |
| -------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| 服务器禁止路径别名   | ESLint 规则 `weiban/no-path-alias`               | `apps/server/` 下不能写 `@/…`、`~/…`、`#…`、`src/…` 这类别名，否则 R1～R3 会失效         |
| 服务器模块间禁止循环 | dependency-cruiser，配置 `dependency-cruiser.js` | `modules/A` → … → `modules/B` → … → `modules/A` 这种跨模块的循环引用（含 `import type`） |

循环检查要看整张引用图，ESLint 一次只看一个文件做不到，所以用 dependency-cruiser（纯 JavaScript，无原生二进制）。
根目录 `.dependency-cruiser.js` 引用本包的配置，`pnpm lint` 会接着 ESLint 运行它（单独运行：`pnpm lint:deps`）。

模块的层级、schema 名、SDK 与域名名单集中在 `architecture.js`，只在这一处定义。

## 证明规则生效

`test/module-boundaries.test.ts`（R1～R9、路径别名）和 `test/module-cycles.test.ts`（循环依赖）对每项检查各有「越界写法必须报错」和「合规写法不报错」的用例，随 `pnpm test` 运行。

标记为 `it.skip` 的用例是**登记在案的已知漏检**（例如 Q-009：R9 能被换变量名、方括号写法绕过），描述的是「应该报错」的写法；加固规则时把 `it.skip` 改成 `it`，必须通过。

## 已知局限

- 服务器内部互相引用须写**相对路径**（`weiban/no-path-alias` 强制）。
- R7：先把 `Date` 赋给别的变量再用（`const D = Date; new D()`）识别不了。
- R9：判断靠变量名和方法名，换变量名或用方括号写法可绕过（Q-009，测试中已登记为 skip），加固方案由架构负责人在 T-014 中确定。
- 循环检查只管**跨模块**的循环；同一个模块内部文件之间的循环不检查（ADR-0004 未要求）。
- R6 中「在 web / server 里另写一份接口类型」、R8 中拼接字符串生成的 SQL，lint 无法可靠判断，由质量负责人评审兜底。
