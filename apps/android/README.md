# apps/android · 安卓原生客户端（占位）

- 负责人：Android 负责人
- 技术：Kotlin + Jetpack Compose，标准 Android Studio / Gradle 工程（ADR-0011）
- 内部结构：见 `docs/architecture/repo-structure.md` 第 5 节
- 由 D-L0-18（安卓原生骨架）建立 Gradle 工程。

注意：
- 本目录**不属于 pnpm 工作区**（`pnpm-workspace.yaml` 已排除），也不参与 ESLint、Prettier；格式与静态检查由 ktlint + detekt 负责。
- 构建产物（`build/`、`.gradle/`、`.kotlin/`、`*.apk`、`*.aab`、`app/release/`）和签名文件（`*.jks`、`*.keystore`、`local.properties`）已在根 `.gitignore` 中排除，不进仓库。
- 由契约生成的 Kotlin 源码（`core/contracts-generated/`）**要进仓库**，便于评审与 CI 比对。
