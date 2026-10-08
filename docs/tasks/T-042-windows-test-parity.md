# T-042 Windows 与云端测试行为一致性

| 项 | 内容 |
|---|---|
| 负责人 | Codex（临时开发者，非独立验收者） |
| 日期 | 2026-10-08 |
| 分支 | dev/fix-windows-test-parity |
| 基线 | main be8c6b5825e675a8d834e16400f22a30124b6d13 |
| 状态 | 云端开发自测通过，源码 CI 待读取 |

来源：总经理转交 DSH 中断任务 #1，随后明确以 GitHub 为准在云端继续。Windows 的 task-fix-windows-test-parity.md 和未提交 reply-rules.test.ts 未上传，因此没有将它们当成已读取或已合并的成果；范围以总经理说明、GitHub 状态页和现有回归为准。

## 范围与修复

1. reply-rules.test.ts 的递归文件相对路径在比较唯一白名单前统一分隔符；仍仅允许 application/safety-care.ts，不能扩大到同名副本、其他生产文件或其他嵌套路径。
2. SocketServer 的 error 监听不再无条件 terminate：ws 已因协议错误进入 CLOSING 时保留其关闭帧；仅仍 OPEN 的异常用 1011 优雅关闭。帧大小上限 65536、鉴权与其他错误规则不变；连接清理由已有 close 回调完成。
3. 新增两种分隔符的违规源码夹具，使用与真实扫描同一检测函数，证明额外文件仍被拒绝。未向生产文件注入危险字段。真实 WS 增强原有测试，核对普通/分片超大帧均为 1009、无效 UTF-8 为 1007，并保留原有二进制 1003、未知 JSON 1008 等断言。

## 检查与限制

云端独立副本 /workspace/wb-fix，真实 PostgreSQL 18 测试库 weiban_test_fix（端口 55432），未使用原共享测试库。日志 /workspace/logs/wb-fix-*，不写 /tmp。Node 24.19.0、pnpm 11.28.4。

交付检查使用 `pnpm --package=pnpm@11.28.4 dlx pnpm check`，必须汇总实际通过数量和零跳过。Windows 11 本机运行尚未验证；跨平台路径夹具与云端真实 TCP/PG 回归不能冒充本机 Windows 验收。结果和源码 CI 在交接说明补录。无契约/依赖/生产数据库迁移变更。


2026-10-08 云端检查退出 0：50 个测试文件、454 条测试全部通过、零跳过；格式/lint/模块边界/完整类型/设计令牌均通过（/workspace/logs/wb-fix-check1.log 与 .exit）。生产字面量检索仍只有 application/safety-care.ts 一个命中，未留下生产注入。初次离线安装因缺少 @node-rs/argon2 离线元数据失败，后续按正常网络安装完成且供应链政策检查通过；未关闭检查或修改锁文件。源码提交与 CI 结果稍后登记交接。
