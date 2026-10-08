# Android 开发构建环境

本页记录 2026-10-08 Codex 云端环境。Windows 本机安装状态未在云端验证；历史路径见 `docs/team/dev-environment-notes.md`。开发自测不能替代真机或供应商验收。

## 工具与配置

- Node 24、pnpm 11.28.4，根目录 `pnpm install --frozen-lockfile`。
- Temurin JDK 21（本次实际 21.0.12.1），Android SDK platform 36、build-tools 36.0.0；Gradle wrapper 8.13、AGP 8.13.2、Kotlin 2.2.20。
- 设置 `JAVA_HOME`、`ANDROID_HOME`，使用 SDK manager 安装上述组件并按许可流程接受许可证。可在未跟踪的 `apps/android/local.properties` 写 `sdk.dir`；不要提交个人 SDK 路径。
- 云端实际路径：JDK `/workspace/.jdk-weiban`、SDK `/workspace/.android-sdk`、Gradle `/workspace/.gradle-tools/gradle-8.13/bin/gradle`、缓存 `/workspace/.gradle-weiban`。命令前设置对应环境变量，日志放 `/workspace/logs/wb-android-*`。
- 每个副本测试数据库独立；本任务为 `weiban_test_pm`。在副本根 `.env` 配置真实 PostgreSQL 的 `TEST_DATABASE_URL`，集成测试必须零跳过；不能把测试指向业务库。

## 检查与 APK

从仓库根生成检查，再在 Android 目录执行：

```bash
pnpm android:generate:check
cd apps/android
./gradlew --no-daemon ktlintCheck detekt testDebugUnitTest :core:contracts-generated:test assembleDebug
cd ../..
node .github/scripts/check-android-test-report.mjs
```

Windows 使用 `gradlew.bat`；Node/pnpm 历史绝对路径见环境守则。格式修复用单独一轮 `ktlintFormat`，待完成才运行上述检查，避免修改源码与检查同时执行。新增依赖时先在同一完整检查命令追加 `--write-locks` 更新锁，再去掉该参数以锁定依赖复验；提交所有实际变动的模块锁文件，不关闭锁定校验。网络下载失败应检查网络并重试，不改版本绕过门禁。

APK 为 `apps/android/app/build/outputs/apk/debug/app-debug.apk`。CI 保留 APK 与 JUnit XML；失败时也上传已有报告。JUnit 门禁统计实际测试而非 Gradle 的 NO-SOURCE/SKIPPED 任务。未取得设备时不声称安装、强杀恢复或系统权限真机测试通过。

## 服务端与推送

调试默认 API 地址 `http://10.0.2.2:3000` 适合 Android 模拟器访问宿主；云端没有运行该模拟器，真机需要可达的服务端地址。构建时设置 `WEIBAN_API_BASE_URL`；release 要求合法 HTTPS 地址，不含凭据、查询参数或 fragment。

可选 FCM 的四个公开客户端字段、HTTP 推送网关 data-only 格式、Google 服务限制见 [通知说明](notifications.md)。默认构建缺少配置时显示不可用，仍可构建和执行测试；禁止放入 Firebase 服务账号私钥或服务器推送密钥。国产厂商、真实 FCM 网络投递和后台存活需要独立的设备与供应商配置验证。
