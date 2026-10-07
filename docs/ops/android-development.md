# Windows 11 安卓开发与安装（T-035）

1. 从 https://developer.android.com/studio 安装稳定版 Android Studio，首次启动按向导安装 SDK。打开项目时选择仓库的 `apps/android` 文件夹，等待 Gradle 同步。
2. SDK Manager 中安装 Android 16/API36、Build-Tools36.0.0、Platform-Tools。工程构建 JDK21；Android Studio 设置中的 Gradle JDK选21（完整JDK，不能只装运行环境）。工程使用锁定Gradle8.13和依赖版本目录，不随意升级。
3. 本机服务端启动后，Android Studio建立API26或更高的模拟器并点击运行。调试版默认通过 `http://10.0.2.2:3000` 访问宿主3000端口；须先启动真实服务和数据库。不会内置平台模型密钥，登录资料由服务器提供。
4. 真机：手机设置中连点版本号开启开发者选项，开启USB调试，USB连接电脑，手机确认调试授权。终端 `adb reverse tcp:3000 tcp:3000` 后，以 `WEIBAN_API_BASE_URL=http://127.0.0.1:3000` 构建debug版，点运行安装。仅debug网络配置允许上述本机HTTP域；正式版必须配置真实HTTPS地址。
5. GitHub仓库 Actions → 最新成功CI → `weiban-android-debug` 下载附件并解压，将APK传到手机点击安装（个人调试需允许该来源安装）。这是调试签名，不是正式发布包；APK与测试报告保留14天。

修改契约或主题后，在仓库根运行 `pnpm android:generate`；Kotlin生成文件不手改。根 `pnpm android:generate:check` 验证没有差异。在apps/android执行 `./gradlew ktlintCheck detekt testDebugUnitTest :core:contracts-generated:test assembleDebug`（Windows使用`gradlew.bat`）。默认忽略local.properties、构建产物和签名文件；签名秘密不能提交。

正式版构建传入 `WEIBAN_API_BASE_URL=https://你的实际域名`；没配置有效HTTPS时preReleaseBuild拒绝构建。真实域名/节点尚未部署，该工程底座不是产品已完成或已独立验收的声明。厂商推送与后台发件装配按L1执行，真机/输入法/厂商保活验收另登记。
