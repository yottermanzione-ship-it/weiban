# 微伴安卓原生客户端

独立 Kotlin + Jetpack Compose 工程，SDK36/min24、构建JDK21、Gradle8.13。用 Android Studio 打开本目录；零基础安装/USB调试/APK说明见 [Windows 开发说明](../../docs/ops/android-development.md)，模块、数据与限制见 [安卓底座](../../docs/android/foundation.md)。

在仓库根安装 pnpm 依赖，然后运行 `pnpm android:generate:check`；改契约或令牌后运行 `pnpm android:generate`。生成源码进仓库，不手改。本目录不属于 pnpm 工作区，Kotlin 使用 ktlint/detekt：

```bash
./gradlew --no-daemon ktlintCheck detekt testDebugUnitTest :core:contracts-generated:test assembleDebug
```

Windows 使用 `gradlew.bat`。默认 debug 服务是模拟器宿主 `http://10.0.2.2:3000`；需先启动真实服务/数据库。正式构建须设置 `WEIBAN_API_BASE_URL` 为 HTTPS。构建产物、SDK路径、秘密与签名文件不提交；依赖目录版本和 Gradle 锁文件提交。debug APK 在 app/build/outputs/apk/debug；CI 附件保留14天。

L0 提供认证、资料、头像、模型、余额流水与主题；聊天、通讯录和发现按后续任务接续，产品尚未完成。

## 旧版覆盖升级（签名材料不进入仓库）

公开应用身份与证书指纹由 legacy-upgrade.properties 管理：release 接续 com.weiban.weiban，构建号必须高于已知旧包 123；debug 使用独立 .debug 包名，不覆盖旧正式包。Android 7 的时间 API 使用 core-library desugaring，通知渠道仅在 Android 8 以上创建。

正式打包设置 WEIBAN_API_BASE_URL（HTTPS）、WEIBAN_ANDROID_SIGNING_PROPERTIES_FILE（仓库外受保护的原签名配置文件）与 WEIBAN_ANDROID_KEYSTORE_FILE（仓库外原签名库），再运行 gradlew.bat :app:assembleRelease（Linux 使用 ./gradlew）。可通过 WEIBAN_ANDROID_VERSION_CODE 指定更高构建号。构建会核验签名库完整性、旧证书指纹及私钥签名能力；缺凭据、错误签名或旧版本号均停止，不回退 debug。云端 Agent 只操作源码，签名材料由受保护发布环境提供，不把私钥或密码写入命令、聊天、日志、仓库或构建产物。

构建后运行 node tools/verify-legacy-upgrade.mjs <候选APK> [旧APK]，检查实际 APK 包名、公开证书、构建号与最低系统版本。此检查不能替代设备上不卸载覆盖安装或用户数据迁移验收。当前改造不删除旧 Flutter 本地文件，也不自动导入旧站账号、令牌、聊天或外部渠道凭据；新原生客户端不会因此自动读取旧登录/缓存。候选包仅用于升级验证，不能据此宣称旧用户已无感迁移。
