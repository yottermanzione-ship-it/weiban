# 网页底座与本地数据层

用户端位于apps/web，共享客户端位于packages/client-core。执行 `pnpm --filter @weiban/web dev`，本机5173代理API到服务器3000；生产构建 `pnpm --filter @weiban/web build`，浏览器检查 `pnpm web:e2e`（要求TEST_DATABASE_URL独立测试库，启动会重建）。网页使用生产CSP、系统字体与设计tokens，主题从服务器拉取，切回前台时刷新；L1加入实时设置事件后可同步在线设备。

本机库weiban-app存session和按用户ID隔离的响应；写入成功后界面从库里取。GET断网读缓存，服务器错误不偷偷转换为成功。PATCH等失败不自动重发；L1待发消息队列将使用独立outbox仓库。换账号/退出清空session、records、outbox和sync；串行写入与请求发起账号检查拦住迟到响应。缓存不是权限依据，服务器每次仍校验会话和归属。

PWA只预缓存静态壳，API和媒体不由Service Worker缓存。生产禁止内联/第三方脚本，API同源代理，图片访问凭证短期有效且不缓存二进制。图标目前是代码绘制的品牌草稿，正式美术和安卓图标需后续替换。PNG192/512和Apple安装图标由SVG在构建时生成，生成物不提交；Service Worker新版本须用户点击更新后才重载。网页头像裁剪当前输出静态PNG，服务器再次重编码、清元数据并加密。

依赖：React/ReactDOM（MIT）、React Router（MIT）、Vite及React插件（MIT）、vite-plugin-pwa（MIT，生成Service Worker）、Phosphor Icons（MIT）、sharp（Apache-2.0，仅构建PNG图标；动态libvips许可说明同媒体交接）、eslint-plugin-react-hooks（MIT）、fake-indexeddb（Apache-2.0，单元测试）、Playwright（Apache-2.0，真实浏览器验证）。未新增安装脚本许可或包发布时间豁免；React插件锁6.1.1，避开供应链政策拒绝的当天6.1.2版本。

L0完成账户与服务页面；聊天、通讯录和角色交互由L1任务接入。浏览器测试和协议测试分开：协议向量在D-L0-17建设，网页/安卓同步引擎都必须通过。
