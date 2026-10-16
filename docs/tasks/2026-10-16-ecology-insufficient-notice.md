# 生态不足提醒：服务器消费一次

主会话独立副本 C:\wb-dev\wb-ecology-notice / codex/ecology-insufficient-notice，基于已保护WIP 0d8e9ff。使用已分配0102账户不足周期/noticePending字段，不再加迁移。按批准的至多一次消费：鉴权POST按当前userId原子清pending并返回文案；不从客户端指定账户、不改余额。前端仅登录且资料完成时启动/恢复前台/联网消费，校验原会话所有权，不把旧账号回包提示给新账号；失败安静保留服务端pending（响应丢失可能漏提示，已接受）。

本块仅端点/消费服务/web提示hook；生态来源ecologyTask逐调用映射、重新充值开新周期由原积分代理负责。全局生态开关/路由权益不在本块。契约统一计划3.16由积分代理最终生成，不提前合整个WIP到主线。完成typecheck/lint/build与真实浏览器模拟自查，不写跑测试套件；不部署。

开发与自查完成，交接docs/handoffs/2026-10-16-codex-ecology-notice.md；原积分分支合入后仍需完整检查与真实环境验证。
