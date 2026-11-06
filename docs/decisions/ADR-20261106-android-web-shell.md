# 先交付安卓网页套壳，保留原生复刻

状态：采纳，依据总经理 2026-11-06 本次会话最新指令。负责人：Codex。

新增独立 `apps/android/shell`，系统 WebView 加载 `https://app.weiban.online`。复用现有 Kotlin / Gradle / 安卓检查工具；网页的界面、契约、消息同步和价格来自现行网页，不另复制业务实现。独立包 `com.weiban.webshell`，内测为 `.debug`，不覆盖原 `com.weiban.weiban`，不导入旧本地凭据。原生 `:app` 与原生对齐方案保留，后续重新排期。

选择系统 WebView 的原因：本机测试环境已有系统网页组件，没有支持可信网页活动的独立浏览器；希望安装后即可打开，不要求另装指定浏览器。可信网页活动能复用浏览器推送，但依赖兼容浏览器、正式签名与网站关联。当前不发布调试签名的站点关联文件，不把任何浏览器选项等同普遍可用。

安全边界：只在固定 HTTPS 来源内运行网页和桥接；外部链接显式交给浏览器；禁止文件网址、混合内容、第三方 Cookie、证书忽略和任意 JavaScript 接口。媒体权限只允许当前可信页面申请录音，不一次性授予所有网页权限。选图走系统文件选择，保存走系统“另存为”，不索要整个相册或存储权限。原生下载桥用 WebMessageListener 的精确来源名单，并再次校验主框架、当前页面、请求结构和大小。

通知限制：系统 WebView 不能直接使用现有网页推送。首版明确显示暂未支持后台通知，不作虚假开关、不常驻保活、不伪造网页通知权限；苹果主屏幕网页及普通浏览器实现保持。前台网页语音/电话与后台通话分别验收，首版不承诺锁屏来电。

参考：[官方 WebView 安全说明](https://developer.android.com/privacy-and-security/risks/webview-unsafe-file-inclusion)、[来源受限的网页桥](https://developer.android.com/develop/ui/views/layout/webapps/native-api-access-jsbridge)、[网页权限必须逐项授予](https://developer.android.com/reference/android/webkit/PermissionRequest)、[可信网页活动](https://developer.chrome.com/docs/android/trusted-web-activity)。
