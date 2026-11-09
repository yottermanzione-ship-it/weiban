# 微伴安卓原生客户端

2026-11-07：正式交付改为 `:shell:assembleRelease` 的“微伴”3.0.0，接续旧应用身份及受保护签名，内部继续加载正式网页；`:app` 原生工程保留后置。同样必须提供下文仓库外签名配置和原签名库，不回退调试签名。构建号 125 高于已存旧包 124；覆盖安装与本机数据迁移是不同检查，不能自动继承旧 Flutter 登录。通话适配及证据见[本轮报告](../../docs/quality/2026-11-07-call-android-3.md)。下文此前独立体验包说明保留为历史，云端调试产物仅用于工程检查。

2026-11-06 起另有独立 `:shell` 网页体验版，按总经理最新安排先交付；原生 `:app` 保留。用 `gradlew.bat :shell:assembleDebug` 生成独立安装包，云端附件为 `weiban-webshell-preview`。安装与能力边界见[套壳说明](../../docs/android/web-shell.md)。

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

## 旧安卓本机收藏承接（2026-11-09，待正式覆盖安装）

新增 `weibanLegacyFavorites` v1 桥，仅对 `https://app.weiban.online` 顶层网页开放。它使用网页当前 `AuthResponse` 的应用会话，向固定 `/api/v1/library/legacy-favorites/source` 核实当前用户 ID 与旧账号分区。服务器无映射时不打开旧偏好文件；不按新昵称、旧登录 scope 或网页自报用户名猜账号，不读旧令牌/密码，也不枚举偏好。换号、退出和导航立即使旧异步回包失效。

旧收藏实际来自 `FlutterSharedPreferences` 中 `flutter.favorite_messages_<旧用户名>` 的 JSON 字符串数组；旧用户名是小写 4–20 位字母数字，不能用用户 UUID 替代。无分区公共键仅报告存在，不读取内容。每项 `{chatKey,chatTitle,savedAt,message}` 保留原消息 JSON 和扩展；身份摘要遵循旧 `FavoriteItem.id`，缺失/null 时间戳使用字面 `null`。旧源代码读取基线：`2c5632e2ed66f5144d8f7bbad805a4f9d913a0d5`。

- `bind` 带当前 `auth` 与 `owner=userId:sessionId`；`read` 使用 `offset/limit/snapshotDigest`，每批最多 25 项、256 KiB，单键最多 500 项，总原始 JSON 最多 16 MiB。坏记录或超限明确阻断，不静默丢弃。
- `media` 只接受 `snapshotDigest/accountKey/itemKey/offset/limit/sha256`，不接受文件路径。图片/表情只取条目的 `imageUrl`，语音只取 `audioPath`；`content` 不作为路径，语音转录和通话文字仍保留。
- 仅允许应用私有 `app_flutter/weiban_resources/chat_images`、`voice_messages` 和私有缓存根中明确命名的 `weiban_voice_<数字>.wav|m4a` 文件。校验规范路径、每层链接、普通文件和单链接身份，拒绝其他目录、越界、符号链接、非支持类型及超过 16 MiB 的文件。网络引用返回 `remote_reference`，原生不下载。
- 媒体每块最多 128 KiB 原字节，返回 MIME、总长、整体 SHA-256、base64 和下一字节偏移。每块重新核验当前账号、收藏快照、文件身份和固定分块摘要；源文件变化时要求重试，避免混块。格式头部检查仅用于限制传输，已有上传服务继续执行实际格式/解码校验。
- 所有批次在服务端持久化后才 `ack`；只在单独偏好文件记摘要，原收藏及附件保留，且不会因该标记禁止重读。云端来源去重与删除墓碑由服务端维护。异常凭据形态字段整项保留并阻断，不通过裁剪字段伪称完成。

本轮包括代码、合成偏好/文件测试和独立模拟器验证；不读取真实手机数据、不安装用户手机、不替换桌面包或下载入口。新桥必须通过之后同身份、原签名的正式新版覆盖安装才可使用，网页更新本身不能给旧 APK 增加原生桥。验证入口为 `:shell:testDebugUnitTest`、`:shell:ktlintCheck`、`:shell:detekt`，执行前应移除当前进程的签名环境变量，避免单测加载发布凭据。

主会话补充回执：整壳69项单测通过；独立API35 AOSP ATD模拟器在SELinux Enforcing、外网阻断状态下，使用上述seededHardlink方式完成真实Os八项检查，8通过、0失败，硬链接实际链接数为2。另以现有正式127覆盖到同签名128候选，应用UID、合成Flutter收藏偏好和合成图片摘要均保持。候选仍为3.0.0，仅内部构建号递增；没有发布或安装到用户手机。这不替代旧2.1.3正式包到新服登录、真实数据可见的连续验收。

Windows 的 Robolectric 4.16.1 `ShadowLinux.stat` 将设备号、inode、链接数置零，`fstat(FileDescriptor)` 也不提供真实文件元数据，不能据此放松正式代码的链接/身份门禁。JVM 文件测试使用真实合成临时文件和单独的 NIO 测试适配；符号链接/硬链接及 inode 改变通过明确的测试元数据注入核验。另提供零新增依赖的 `LegacyFavoritesOsInstrumentation`，直接调用正式 Android `Os` 端口，限定 `synthetic=true`、debug 包和 ranchu/goldfish 模拟器，创建及删除它自己新建的私有测试目录，不启动网页、不读偏好、不联网。独立模拟器上可用 `am instrument -w -e synthetic true com.weiban.weiban.debug.test/app.weiban.shell.LegacyFavoritesOsInstrumentation`；是否实际执行及回执由本轮主报告另记，不把仅有 runner 当作设备验收通过。

runner 单独报告 `passed/failed/platformBlocked/complete` 和固定 stage/category/errno，绝不输出异常正文或路径。仅系统在创建硬链接时返回 EPERM/EACCES 且目标经 lstat 确认为不存在，才记 `hardlinkCreation=blocked_by_platform`，这不计 reader 通过且 `complete=false`。若负责人在独立模拟器预先准备 `targetContext.cacheDir/legacy-favorites-os-seeded/app_flutter/weiban_resources/chat_images/hard.png`、链接数恰好为 2 且 app 可读，可加 `-e seededHardlink true` 改测 `preexisting_hardlink_rejected`。该模式不接收路径参数、不修改 SELinux，且不清理负责人预建的固定根；其他七项仍使用 runner 自建并清理的随机合成目录。

存储兼容依据：[Flutter legacy SharedPreferences 前缀](https://raw.githubusercontent.com/flutter/packages/shared_preferences-v2.5.5/packages/shared_preferences/shared_preferences/lib/src/shared_preferences_legacy.dart)、[Android 插件固定偏好文件名](https://raw.githubusercontent.com/flutter/packages/shared_preferences_android-v2.4.27/packages/shared_preferences/shared_preferences_android/android/src/main/kotlin/io/flutter/plugins/sharedpreferences/SharedPreferencesPlugin.kt)、[Flutter Android 文档目录](https://raw.githubusercontent.com/flutter/engine/main/shell/platform/android/io/flutter/util/PathUtils.java)。
