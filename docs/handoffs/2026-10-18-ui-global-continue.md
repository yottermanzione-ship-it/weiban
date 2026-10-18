# 全站UI续接：我与设置第一组（开发自测）

2026-10-18，分支 codex/ui-global-1018。依据11号A9/C9、10号T4.10与06号4.10/4.14核源码，未改后端与契约。

- 账号安全：修改密码原有表单最终固定抛not_implemented，提前改为“暂未开放”；登录设备补载入/失败重试。
- 收藏：补旧版规范中的空态图标和“聊天长按收藏”提示，统一错误重试。
- 我的表情：统一NavBar/商店列表入口；整理与单格选择忙态锁定；表情商店和单表情预览共用Sheet，关闭按钮/Esc/焦点行为沿用共用组件。商店补载入、失败重试、列表导航与全宽主操作。
- 生态：SwitchRow增加可选ariaLabel；带ReactNode文字的动作开关显式传动作名，避免无名开关。

检查：web typecheck、受影响6个TSX eslint、web build通过。build有原有大包及PWA选项弃用警告；未写/跑测试套件。

浏览器待主负责人点按：/settings/security（修改密码提示、下线确认取消）；/me/favorites（空态）；/me/stickers（整理、选格、预览关闭/Esc）；/sticker-store（整理切换、详情、表情预览、返回）；/services/ecology（开启预览后动作开关可访问名称）。未宣称GUI或独立验收通过。

个人资料、通用、关于、安装引导主要结构已按规范实现，继续核对载入/失败与各子路由。后续朋友圈、小程序仍未完，不能据本组宣称全站完成。主负责人的coverage/routes/screenshots不由本代理修改。

浏览器反馈补修：无to/onClick的MenuRow改静态div，disabled映射aria-disabled；静态行不再按压变色或带无动作箭头。TSX扫描全部13处静态行，唯一可操作right为账号设备下线，内按钮逻辑保持，typecheck/eslint/build通过。表情接口在浏览器报加载失败、重试能进入读取；补显示remote.error友好原因，未改API或数据库。表情数据缺失导致整理/预览未实测，不能宣称通过。Sheet支持现有关闭/Esc，本组未实现焦点圈定。

## 启动恢复链修复（纯Web）

浏览器首次请求偶发“登录状态已改变”不是已证明的服务器登录失败：main的StrictMode双执行AuthProvider启动effect，原cleanup只阻止最后setState，旧链仍可继续me/updateUser/catch restore。ApiClient.restore重新解析生成auth对象，已在途call捕获的auth引用不同便抛session_changed；useRemote将此作为错误展示。

auth.tsx最小修复：每个await边界核active，尤其restore resolve后、me后updateUser前、catch再次restore前后、本地onboarding读取前后；阻断已cleanup链继续恢复/更新。保留ownership校验与StrictMode，不改client-core、令牌生命周期、后台。已开始的底层操作仍服从原ownership检查，本次未承诺解决所有跨会话并发。

检查：web typecheck、auth.tsx eslint、web build通过（原有构建警告）。待主负责人连续reload账号安全/表情请求实际复核。

更正表情环境：第一次失败后重试最终成功显示共0个，不能登记持续API阻塞；无数据限制预览与排序点按。

## 朋友圈组（开发自测，待浏览器）

依据06号4.11（弹条赞/评论、点评论回复、长按自己评论删除）与10号T3.10/4.3.9。moments.tsx移除弹条多出的收藏/分享；保留既有自己的删除入口。评论独立行复用useLongPress，单击回复/自己长按删除；使用现有接口不改语义。

首次相册列表失败原先items.length>0才显示错误，现空列表也能看友好错误并重试；详情增加读取状态，切换加载清旧post避免旧内容挂在新URL。发布中取消/正文/图片操作/可见性锁定；空好友部分可见显示添加入口；补字数、aria-pressed和取消直开fallback。

图片预览原images依赖cleanup会在每次增删时释放仍保留的objectURL；改为删对应URL、卸载统一释放，超过9张的部分不再先建URL再丢弃。未上传图片、发表/删除动态、改DB或后台生态。

检查：web typecheck、moments.tsx eslint、web build通过（原有构建警告）。待浏览器：/moments封面换封面取消/相机菜单，/moments/new输入/清空/选择/取消；/me/moments空/失败；有真实数据后卡片赞评论、自己评论长按、详情；无数据与未执行资金/生态行为不算通过。

Auth恢复链反馈：主负责人安全页两次reload均显示账号且无session_changed；表情进入与reload直接显示共0个；设备嵌套button为0，下线确认可打开并取消。仅这些开发复现路径通过，不推断所有并发或全部登录场景通过。
