# 实时同步

T-036；模块 `apps/server/src/modules/realtime`，公开 `SYNC_PORT`（契约 SyncPort）。HTTP `GET /api/v1/sync/state` 与 `GET /api/v1/sync/updates`；WS `/api/v1/ws` 使用原 contracts 帧。规则以 message-reliability.md 为准。

更新序号、按用户 DEK 加密的 payload 与业务共同提交；AAD 是 userId 与 realtime:update:seq，只有 userid/seq/时间明文。事务 `pg_notify` 提交成功才投递，通知仅含 IDs/序号，HTTP和worker通过数据库通信。读取与分配、保留修剪、注销删除共用用户咨询锁；调用方必须由 Database.transaction 提供 Tx。IdentityAccountStatusPort 可接收同一个事务，避免持有池连接时又申请连接；账号共享行锁阻止中途进入 deleting 状态。

日志保留30天；每个用户持久保存最后序号与已修剪边界。低于边界返回410，等于边界可继续；全部删除日志仍不重置序号。分页在用户锁内同时确定 head 和读取密文，检查连续性，损坏/缺口报错，不擅自推进游标。时钟回拨造成老记录出现在内部时，修剪到最大过期序号的整个前缀，保留后面的连续部分。每小时17分任务修剪更新和过期前台状态。注销删除包含日志、游标和所有设备状态；迟到设置/消息活动事件检查 active，不复活数据。

WS 只接受准确路径，无 query、URL令牌或 Cookie 鉴权。最多1024条本进程连接，首帧10秒必须 auth；兼容契约2.x，低版本/其他主版本关闭4426，auth.ok的 minClientVersion 为2.0。每次有效输入与实时投递重新验证会话，作废/过期关闭4401；同一 session 新连接关闭旧连接4409，不同设备会话可同时在线。数据库中的 connectionId 防止旧连接关闭时删掉新连接状态，延迟到达的替换通知会查询当前状态，不根据旧通知误关新连接。

客户端每25秒发送协议 ping；服务端原样返回 ref 和 serverTime，45秒没有有效客户端帧关闭。业务 handler 串行队列最多32项、输入最大64KiB、不接受二进制、不启用压缩、发送缓冲超过1MiB终止连接。浏览器 Origin 必须与请求 Host 相同；非生产允许本机开发 Origin，原生客户端可省略 Origin。部署需让 Caddy 保留请求 Host。

HTTP 实例通过专用 PostgreSQL LISTEN 连接接收持久更新、连接替换与 typing 通知；每秒额外补拉当前 head 并验证连接作为通知遗漏兜底。同一连接的补拉通知合并成一项，每次最多5页/500条，剩余下一轮继续，防止更新洪峰挤满业务输入队列。通知连接出错关闭现有 WS 让客户端重连，重试成功前拒绝升级；数据库暂不可用仍可启动 HTTP 健康页。typing 只在通知中转发，不写更新日志；客户端负责6秒超时隐藏。

前台状态按 session 保存，只有45秒内活动且 foreground=true、会话匹配的设备才抑制推送；心跳/查看会话不会改变 getLastUserActivityAt，它只订阅真实 chat.message_created 的用户发送事件，并以最大 occurredAt 避免乱序倒退。资料、主题、通知、余额、模型选择事件追加 settings.updated，客户端随后重拉相应接口；通知本身不含资料正文。

开发自测含实际PG/WS、真实账号和会话、十事务并发/回滚、分页与410、两会话同用户、重连替换、typing、独立worker应用、前台与超时、未知/二进制/大帧/跨站/URL令牌、会话作废、注销与迟到事件。原纯客户端协议向量另行保留。这里没有独立验收结论。

T-037 尚需装配真正聊天消息发送端口；当前 message.send 返回 service_unavailable，未写消息且不返回 ack。网页与安卓实际 WS/HTTP 状态机驱动、Room/IndexedDB同步提交/发件任务、好友和AI回复、推送随后接续；不能把本模块完成当作可用完整聊天产品。

本机最终全仓349条/零跳过、浏览器5+6组、安卓auth两条回归及生产容器/迁移/备份恢复通过，详见T-036任务卡；远端CI发布后另核验。
