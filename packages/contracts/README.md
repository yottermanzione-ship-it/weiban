# 接口与事件契约（@weiban/contracts）

所有模块之间、前后端之间、网页与安卓壳之间的接口，以这里为唯一准绳。

- 最终修改权：架构负责人。
- 其他负责人要改接口：先在 `docs/tasks/` 或交接说明中提出**契约变更申请**（改什么、为什么、影响谁），架构负责人评估影响后批准并修改本目录，实现方再改代码。
- 格式决策见 `docs/decisions/ADR-0003-tech-stack.md` 第 10 项。

## 格式

**Zod 4 schema 是唯一源头**（Zod 是 TypeScript 的数据校验库）。同一份定义同时是：

1. TypeScript 类型（`z.infer<typeof X>`），服务器和网页直接 import；
2. 运行时校验（服务器校验请求、网页校验响应、所有模块校验事件载荷）；
3. JSON Schema（`pnpm --filter @weiban/contracts generate` 导出到 `generated/`，给安卓 Kotlin 端和文档用）。

HTTP 接口用 `defineEndpoint({ method, path, auth, params, query, body, response, summary })` 描述，服务器据此注册路由校验，网页据此生成类型安全的调用函数。

## 目录

| 文件 | 内容 | 使用方 |
|---|---|---|
| `src/version.ts` | 契约版本号 | 全部 |
| `src/common.ts` | ID、时间、错误码与错误格式、分页、`defineEndpoint` | 全部 |
| `src/http/identity.ts` | 注册登录、会话、我的资料、年龄确认、通知设置、注销、邀请码（管理） | web、admin、server |
| `src/http/model-access.ts` | 供应商、密钥（只有掩码）、模型目录、模型选择、角色模型覆盖、模型状态 | web、server |
| `src/http/characters.ts` | 角色分类（硬性边界依据）、角色广场、资料页、管理后台角色库 | web、admin、server |
| `src/http/contacts.ts` | 添加角色、通讯录、备注、专属称呼、删除恢复 | web、server |
| `src/http/chat.ts` | 会话、参与者、消息内容、消息、已读、撤回、会话状态 | web、server |
| `src/http/sync.ts` | 每用户更新日志与补拉（多端同步） | web、server |
| `src/http/push.ts` | 推送设备登记、通知载荷格式 | web、android、server |
| `src/http/companion.ts` | 陪伴设置（秒回、拆条），数据归 ai-runtime | web、server |
| `src/http/media.ts` | 图片上传（头像） | web、server |
| `src/ws.ts` | WebSocket 帧协议 | web、server |
| `src/events.ts` | 领域事件（以 `Events` 命名空间导出） | server 各模块 |
| `src/ports/` | 模块之间的同步接口（端口） | server 各模块 |
| `src/bridge.ts` | 网页 ↔ 安卓原生桥 | web、android |
| `src/character-card.ts` | 角色卡（**预留位置**，T-005 交付后并入） | server、admin |

## 当前范围

v0.1 覆盖 L0、L1 所需：账号、密钥与模型配置、角色基础信息、通讯录、会话与消息、同步、推送、陪伴设置（秒回 / 拆条）、媒体（头像）、领域事件、端口、原生桥。后续层由架构负责人按 `docs/architecture/dev-plan.md` 扩展。

## 版本规则

- `CONTRACT_VERSION` 形如 `主.次`。新增接口、事件、可选字段、错误码、消息类型 → 次版本加一；删除字段、改含义、改必填 → 主版本加一。
- 客户端必须容忍未知的消息类型和更新类型（显示「当前版本不支持」或跳过），这样次版本升级不会让旧 APK 崩溃。

## 已知事项

- 本版本编写时仓库还没有构建工具，**尚未经过编译验证**（技术债 TD-011）。仓库骨架任务（`dev-plan.md` D-L0-04）必须让 `pnpm --filter @weiban/contracts typecheck` 通过，发现的问题由架构负责人修正。
- `generated/` 为构建产物，不进仓库。
