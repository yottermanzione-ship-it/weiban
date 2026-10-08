# T-044 T041服务端整链路

2026-10-08，Codex临时开发接管；分支 `dev/t041-server-flow`。接续总经理DSH任务#2，以GitHub任务/需求为准，Windows未提交原文尚未取得。继承PR #4与#5，独立真实PG `weiban_test_t041`，日志 `/workspace/logs/wb-t041-*`。

范围：新账号通过真实HTTP邀请码注册并获余额→角色申请返回pending/无会话→不拨钟、不手调接受，实际3～30秒延迟工作者通过→真实conversationId与同步更新→用户首消息→实际回复工作者调用真实网关/目录/计费并经HTTP假上游返回，消息落库、WS/补拉可见；同clientMsgId重试不重复消息/扣费。仅供应商HTTP是假实现，其余组件使用生产装配、系统时钟和真实PG/pg-boss/事件分发器。角色上架评测也经真实网关与假上游，不能替换evaluator/gateway。

检查：一条全链路集成回归及相关完整门禁，全部零跳过；新测试时间预算由真实好友延迟、回复期限和轮询决定，不放宽已有测试/产品参数。提交推送、读取源码GitHub CI后写正式交接。本轮是开发自测，不能充当独立验收或供应商质量结果。不改contracts，不合main。


开发自测：首轮lint通过，类型检查发现错误使用AdminCharacter内部checks字段，改为契约publishChecks；第二轮类型与一条真实装配专项通过，41.17秒/零跳过。补回复完成后的同ID重试与两个终态计划断言后，完整pnpm check退出0：54文件468条全通过/零跳过，280.96秒；格式/lint/模块边界/全仓类型/tokens通过。日志wb-t041-flow-check2.log、wb-t041-check1.log及.exit。尚未读取本轮源码GitHub CI，正式交接在CI后登记。
