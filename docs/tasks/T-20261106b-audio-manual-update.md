# 安卓播放后录音与主动网页更新

总经理反馈：安卓体验版播放语音后，检查麦克风和拨打电话均提示暂时不可用；网页版未试。要求网页与套壳都能主动检查更新、点击强制刷新至新版，日常网页更新免重装。

- 基线及原线上：`73c9728dc5fb23efcb765022dd8ab36fdb5f5fbd`，独立分支 `codex/audio-update-20261106`。开发自测，不自签独立验收。
- 安卓补声音路由所需普通权限，保留录音运行时授权及可信来源限制；升级内测包版本并沿用现有签名，覆盖安装保留应用数据。这项安装包权限改动不能由网页更新替代。
- 网页播放结束/失败/切换录音时释放播放器资源；所有录音入口共用处理。不能以此推断所有真实设备已修复。
- “我→设置→关于微伴”加入真实构建检查及用户点击的强制刷新。检测真实部署构建，不用后台公告版本代替；离线或检查失败明确报错，不谎称最新。刷新先等待本机写入，保留登录、消息、草稿和推送订阅；通话/录音中阻止刷新。不做后台强制接管。
- 以现有真实 Service Worker 升级测试扩展按钮流程；保留原有旧页面继续聊天检查。程序/浏览器/安卓/生产分别留证据。
- 仍不切换经理先前要求保留前台的安卓设备，除非得到后续明确许可；不读真实聊天、不打真实付费电话、不修改价格。不需要再次批准普通开发/合并/发布，沿用当前授权及来源门禁。

参考：[Chromium 声音设备所需权限](https://chromium.googlesource.com/chromium/src/media/+/36bf5b81f9a8a6b4be9cb7b1356f4937c417624d/base/android/java/src/org/chromium/media/AudioManagerAndroid.java)、[安卓普通声音设置权限](https://developer.android.com/reference/android/Manifest.permission#MODIFY_AUDIO_SETTINGS)、[Chrome 用户主动更新流程](https://developer.chrome.com/docs/workbox/handling-service-worker-updates)。
