# 聊天与 PWA 通知客户端

2026-10-07，T-041 开发中。契约2.2，与T-036至T-040服务端对接。

`ChatDriver`负责首帧WS鉴权、心跳、正在输入与前台会话上报；HTTP始终作为发送和补拉的可靠路径。WS断开不取消正在进行的HTTP发送，浏览器真正离线或驱动停止则取消。服务端响应丢失后复用已持久化的clientMsgId，刷新也不能换一个ID重新发送。

共享`SyncRunner`串行应用操作，先在IndexedDB的同一事务核对userId/sessionId并保存完整状态，再呈现与执行网络副作用。快照和补拉使用networkOnly；重建先读S，再读快照，再从S拉更新。历史页与前向补拉分开，负覆盖、撤回及隐藏记录都保留。退出与换号清空私有缓存；迟到请求、旧会话失效、旧推送清理都不能覆盖新会话。

会话与消息使用虚拟列表，历史向上加载保持滚动锚点；已读仅在可见页面底部推进到已加载消息的seq。角色广场支持搜索和分页，通讯录按备注/角色名称排序。实时设置与模型状态事件触发当前页面重新读取。

PWA使用injectManifest，Service Worker预缓存静态资源，不缓存API。推送在展示和点击前验证当前账号、会话、通知时效，拒绝缺少归属的旧载荷；通知处理串行，notificationId去重，系统展示失败不登记为已展示。退出通过MessageChannel等待当前通知处理结束，再关闭该会话通知。更新确认先暂停HTTP/WS再激活新版本，重新加载后恢复会话。

浏览器开发自测覆盖真实HTTP/WS、IndexedDB、Service Worker及导航。无头环境Notification.permission固定denied，通知系统展示层使用明确的夹具，不能作为真实OS通知弹出或厂商投递证据。真实Web Push供应商、iPhone主屏幕PWA、安卓真机、跨端5秒时延及独立验收仍待执行。

Workbox core/precaching/routing7.4.1为明确运行时依赖，许可证MIT，pnpm锁定。

剩余客户端工作见T-041；L2–L7未据此宣布完成。
