# 微伴安卓原生客户端

独立 Kotlin + Jetpack Compose 工程，SDK36/min26、构建JDK21、Gradle8.13。用 Android Studio 打开本目录；零基础安装/USB调试/APK说明见 [Windows 开发说明](../../docs/ops/android-development.md)，模块、数据与限制见 [安卓底座](../../docs/android/foundation.md)。

在仓库根安装 pnpm 依赖，然后运行 `pnpm android:generate:check`；改契约或令牌后运行 `pnpm android:generate`。生成源码进仓库，不手改。本目录不属于 pnpm 工作区，Kotlin 使用 ktlint/detekt：

```bash
./gradlew --no-daemon ktlintCheck detekt testDebugUnitTest :core:contracts-generated:test assembleDebug
```

Windows 使用 `gradlew.bat`。默认 debug 服务是模拟器宿主 `http://10.0.2.2:3000`；需先启动真实服务/数据库。正式构建须设置 `WEIBAN_API_BASE_URL` 为 HTTPS。构建产物、SDK路径、秘密与签名文件不提交；依赖目录版本和 Gradle 锁文件提交。debug APK 在 app/build/outputs/apk/debug；CI 附件保留14天。

L0 提供认证、资料、头像、模型、余额流水与主题；聊天、通讯录和发现按后续任务接续，产品尚未完成。
