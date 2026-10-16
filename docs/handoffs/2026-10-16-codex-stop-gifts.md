# C8停止邀请码和新增赠分：开发交接

主会话在独立副本 C:\wb-dev\wb-stop-gifts / codex/stop-gifts实施，基线2b9c08d，业务WIP d407d64。仅登记开发自测，不替代独立验收；未部署、未运行数据库迁移或测试套件。

## 最终行为

- 注册不读写邀请码、不发布signupBonus；兼容旧inviteCode（含空串/短串）但忽略。账号别名唯一约束、密码策略、会话与10分钟网络重试保留。
- billing订阅注册事件只幂等建零余额钱包，历史outbox即使带赠分也不再入账。已存在余额/流水不改，不追扣。
- 邀请码服务create拒绝service_unavailable，list为空；CLI在加载配置与应用上下文前拒绝create-invite，内部运维兼容方法同样拒绝。旧表及历史契约保留；后台菜单删入口，默认/未知页到角色库，旧书签显示停用说明。
- 充值旧配置对外bonusPercent/bonusPoints恒0；非零写入报bad_request，0兼容。后台去掉赠送输入与计算；合法人工充值/退款/调整保留。注册页只有账号密码。
- 契约是3.15的兼容放宽/停用说明，生成Android schema同步；后续积分批次统一升3.16。不新增迁移，不改会员权益/价格/模型档位。

## 检查与证据

contracts/server/web/admin typecheck、相关12个源文件eslint、depcruise（386模块/1671依赖）、server/web/admin build通过；网页构建415252，SW16预缓存。已有大chunk和inlineDynamicImports构建提示，不是构建失败。生成检查首次发现Android schema落后，已重新生成后android:generate:check通过。CLI构建产物create-invite返回“邀请码功能已停用，请直接注册”，退出1（预期拒绝），未启动应用上下文。

真实浏览器操作真实AuthPage、AdminApp与AccountsPage，网络/会话替换为本地fixture：注册切换、模拟失败保留账号密码，注册请求无inviteCode（证据密码已隐藏）；后台无邀请码菜单，充值无赠送比例，改20元显示2000积分，失败保留草稿、重试成功，两个写请求bonusPercent均0；旧/invites停用页，根与未知路由均到/characters。5张PNG与2份请求JSON及控制台日志在 `docs/web/stop-gifts-2026-10-16/`。这不是实际注册、充值、数据库持久化、历史事件重放或Safari验收；后端停止赠分路径为源码复核与编译检查。

恢复自查：把同目录两个`.fixture.txt`分别复制到apps/web/gifts-preview.html和apps/web/gifts-preview.tsx，在该副本运行网页Vite的5200端口，访问/gifts-preview.html；?admin=1#/accounts为后台样例。fixture不属于产品入口，也不带真实密钥。原q样例5190不动，临时浏览器页已关闭。新副本仅两个恢复文件留为未跟踪自查入口，不提交进产品包。

## 后续

points-prehold分支网关/可信平台/未知成本风险尚未完成，不因本次赠分停用通过而宣称其完成。合入本批后须让原代理同步，避免再实施一遍。香港仍为原版本，后续部署需先备份与真实环境验证。
