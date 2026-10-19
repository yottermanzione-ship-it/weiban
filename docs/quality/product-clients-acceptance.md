# 产品客户端专项审查（2026-10-20）

> **总经理指令（2026-10-20）：仅留档，全部问题暂存冻结。任何人或代理（包括 Codex、Claude、开发负责人及子代理）均不得依据本报告启动、安排或执行修复，也不得自动派发修复任务。须等总经理后续明确授权，才能启动对应修复。文中的修复建议、给开发方的交接及复核说明仅供未来参考，不构成当前行动指令；本条优先于文中相关表述。**

审查人：Codex 客户端并行审查代理。结论：**不通过；实际浏览器、Android 真机及真实接口端到端验收未完成。** 本报告仅记录只读源码审查和独立契约输入探针，没有修复业务代码、契约或数据库。

| 项目     | 固定范围                                                                      |
| -------- | ----------------------------------------------------------------------------- |
| 目标     | `local/trunk` 提供的独立 QA 副本 `C:/wb-qa/review-20261020`                   |
| 完整 SHA | `65bb669821909ac62239c5b140410d569a078411`                                    |
| 比较基线 | `9b647d6228553cf8d1cec13557e310dc896179c5`                                    |
| 范围     | Web、管理后台、Android 的会员 / 记忆 v5 契约联动、账号隔离、主要交互真实性    |
| 方法     | 任务及交接核对、源码路径追踪、契约 `safeParse` 输入探针、基线 `git show/diff` |

阅读依据：`docs/README.md`、`docs/quality/README.md`、`docs/quality/issues.md`；T-031、T-032、T-035；`2026-10-19-v5-batches.md`；会员、记忆、web-misc、admin-ui-redesign 最新交接与 Android UI 换壳交接；PRD 记忆 / 管理后台；`security-and-privacy.md`；会员、记忆、情景模式契约。旧 PRD 的邀请等已被后续拍板取消事项不作为本次缺陷。

## 确证问题

### CLI-001 / P1：会员后台更换查询对象时仍可向旧用户开通并发放积分

- 位置：`apps/admin/src/features/membership.tsx:49`、`:77`、`:108`、`:129`、`:199`。
- 触发：先查询用户 A；把输入框改为 B，点查询后在 B 的查询尚未完成时点击开通并确认。即使不点查询，输入框改成 B 后也仍能操作旧记录。加载期间只给查询按钮设置 loading，开通按钮仅 `disabled={!plan}`；手动改到期 / 撤销也未检查 `loading` 或输入 ID 是否仍匹配已载入 ID。
- 证据：`load()` 开始没有清理 `loaded`；输入 `onChange` 只更新 `userId`；订单 POST 明确使用 `loaded.userId`。因此 B 的请求未完成时，写请求目标确定仍为 A。当前卡片仅展示档位 / 到期 / 首次价，不展示 `loaded.userId`；确认弹窗仅写「给这个用户开通…」，管理员无法从确认信息识别错人。
- 影响：订单、赠送积分、会员期限可能记入 A，而管理员正在处理 B 的付款。此为受权管理员误操作风险，不是服务器越权。
- 基线归属：基线已有输入状态与 loaded 分离的设计，但旧卡片用 `desc={用户 loaded.userId}` 明示操作对象。v5 新增订单及赠送积分写操作，并移除了该目标显示，属于本批扩大影响与目标确认退化；不将整个旧状态设计冒称新引入。
- 建议交开发方：查询目标变动或重载时使旧表单失效；操作前要求已载入 ID 与当前输入一致；确认界面显示用户标识；避免晚到的旧查询覆盖新查询。
- 证据等级：静态完整调用路径确认；未向真实账号提交订单，未执行浏览器点按。

### CLI-002 / P2：后台新增情景模式必然缺失契约要求的 id

- 位置：`apps/admin/src/features/scenario-modes.tsx:255`（构造 data）、`:70`（POST）；`packages/contracts/src/http/admin-content.ts:39`；`apps/server/src/modules/characters/http/scenario-modes.controller.ts:49`。
- 触发：后台「情景模式」→「新增情景模式」，填入名称等可见字段后保存。
- 证据：表单没有 id 输入，save 的 data 没有 id，`saveMode(null, data)` 原样 POST；契约 `AdminScenarioModeCreate.id` 是必填小写英文标识。真实控制器已挂载该契约 ContractPipe，故请求在进入 service 前拒绝为 `bad_request`。页面注释「接口尚未进契约」也已过时。
- 独立探针：下方实际执行输出 `success:false`，唯一缺失字段为 `id`。这是实际源契约解析，不是照抄实现写断言；不代表已调用真实 HTTP 服务。
- 影响：新增功能不可用；列表 / 更新已有记录与此项无关。
- 基线归属：`git diff <baseline> HEAD -- apps/admin/src/features/scenario-modes.tsx` 无差异，基线 `git show` 也有相同缺失；**既存缺陷，不算 v5 新回归**。未见 quality/issues.md 既有登记。
- 建议交开发方：按唯一契约提供 / 生成合法 id，并通过契约化客户端调用覆盖真实新增流程。

```powershell
pnpm --filter @weiban/contracts exec tsx --eval 'import {AdminScenarioModeCreate} from "./src/index.ts"; const input={name:"测试情景",description:"审查输入",presetPrompt:null,enabled:true,sortOrder:0,appliesTo:"all",hasRomanceContent:false,hasAdultContent:false}; const r=AdminScenarioModeCreate.safeParse(input); console.log(JSON.stringify({success:r.success,issues:r.success?[]:r.error.issues}));'
```

执行：Node.js `v24.21.0`，退出 0；结果：

```json
{
  "success": false,
  "issues": [
    {
      "expected": "string",
      "code": "invalid_type",
      "path": ["id"],
      "message": "Invalid input: expected string, received undefined"
    }
  ]
}
```

首次尝试直接导入 `packages/contracts/dist/index.js` 因未构建产物报 `ERR_MODULE_NOT_FOUND`；随后使用包声明的 tsx 读取实际源码完成探针。首次错误是探针入口选择问题，不登记为产品缺陷。

## 验收逐项记录

| 标准                                      | 结果                           | 依据和边界                                                                                                                                                                                                        |
| ----------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 管理员替指定用户开通并正确确认目标        | 不通过                         | CLI-001；未运行真实开通事务                                                                                                                                                                                       |
| 新增情景模式与正式契约一致                | 不通过                         | CLI-002；实际 schema 解析拒绝                                                                                                                                                                                     |
| 用户会员页读取后台价格、记忆档位参数      | 静态核对符合，端到端未验证     | `membership.tsx` 使用 offer / plans / role config；失败时部分回退默认值，不能据此声称配置实时生效                                                                                                                 |
| 记忆页展示当前范围，不出现开通诱导        | 静态核对符合，浏览器未验证     | `memories.tsx` 的 MemoryRange 使用 status.limits / basis；读取失败时范围块不会显示，未验证错误交互                                                                                                                |
| PRO+ 长上下文开关与打开前价格说明         | 静态核对符合，端到端未验证     | `chat-settings.tsx` 仅 available 时显示，提交 updateForCharacter，确认弹窗读估算；403、到期撤销及计费由服务器板块审查                                                                                             |
| 模型列表显示倍率与约每条积分              | 静态核对符合，数据真实性未验证 | `models.tsx` 复用 wallet 的 perReplyText；7 天均值统计不在本报告验收                                                                                                                                              |
| Web / admin / Android 本机账号隔离        | 未完成动态验收                 | Web 按 userId + sessionId 重挂路由树；ApiClient 校验响应所属 auth，admin 独立 IndexedDB 且关闭响应落库；Android SessionRepository 用 owner / mutex 保护写入。这里只确认保护存在，未跑换号、离线、迟到响应设备用例 |
| 角色生态真实执行                          | 未完成实现，不通过完整产品交付 | 当前 `ecology.tsx` 仍为 localStorage 预览并明确标注不执行、不扣费；批 C 尚不在该 SHA 实现。是明确范围缺口，不冒称隐蔽假成功                                                                                       |
| Android 会员 v5 / 记忆范围 / 长上下文入口 | 未完成实现                     | 新生成契约已存在，feature 层未接 MemoryTier / longContext / 会员 offer；记忆交接已明确此遗留，不算新回归                                                                                                          |

## 已知遗留、产品陈述及限制

1. 用户权益页 `apps/web/src/features/membership.tsx:117` 默认 PRO+ 摘要显示「全部 + 年度回忆」，但记忆 v5 交接明确年度回忆只有 renderer 参数口子、没有生成逻辑。后续交付需收敛用户可见承诺，当前不可登记年度回忆已实现；这是交接已披露的缺口，不重复当作未知后端缺陷。
2. `usedVisionDefault` 在 Web / client-core 无消费代码；自动换识图模型的一次提示仍未实现，会员 v5 交接已披露，保留未验收项。
3. Android 换壳交接披露了宠物素材格式、隐藏会话重建、多个交互与页面差异；本报告没有实机复现，不关闭这些事项，也不将其当作本次新回归。
4. 未使用生产账号，未访问香港数据库、未执行迁移，未操作共享预览，没有安装或启动 Android SDK / 模拟器。构建和全仓检查由主代理统一记录，不能用静态通过替代真实页面 / 真机验收。
5. 本次只读审查不构成完整安全扫描，也不证明所有客户端流程无缺陷。后续独立验证至少覆盖：查询目标切换时的会员确认；真实情景模式新增；会员开通后多设备刷新；记忆档位变更；长上下文价格与实际账单；换号 / 离线 / 迟到响应；Android 真机通知、音频与手势。

给开发方：按 CLI-001 / CLI-002 修复后提供新完整 SHA 与复现证据，由独立审查者复核；本次未执行任何修复。
