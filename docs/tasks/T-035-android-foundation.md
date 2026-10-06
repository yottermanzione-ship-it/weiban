# T-035 安卓原生底座（D-L0-18/19）

来源：总经理持续开发授权；分支 dev/codex-product-continuation。按 ADR-0011、repo-structure 第5节、engineering-standards 第10节实现。2026-10-06：开发实现与本机自测完成，GitHub CI 发布后检查；独立质量验收待另一位审查者执行。

- [x] Gradle 分模块、SDK36/min26/JDK21/字节码17、校验SHA256的wrapper、集中版本目录与提交依赖锁；编译警告视为错误，ktlint/detekt。
- [x] 实际JSON Schema生成Kotlin，513命名定义与85接口；接收端未知类型/必填可空/常量输出/往返校验；令牌与Phosphor矢量图生成无差异。
- [x] OkHttp真实HTTP、禁跳转、响应限制、Schema验证、会话对象隔离；Keystore AES-GCM密文会话存储与Room账号事务/缓存。
- [x] 独立Kotlin同步引擎运行同19份共享JSON向量；完整状态/动作/错误回滚、重启往返，非拷贝期望结果生成。
- [x] 原生登录注册、首次资料、头像裁剪上传与已存头像读取、三类模型/默认选择、精确微元余额/预算/流水、账号主题。
- [x] 原生Compose登录成功/失败及首次资料保存回归；真实Room/MockWebServer、API26原生图形裁剪/PNG与无效图片、金额精度测试。
- [x] Windows 11 Android Studio/USB/模拟器/APK说明；CI生成物检查、静态检查、JUnit零跳过检查、debug APK与报告附件。

本机证据：完整Gradle检查/构建与41条JUnit全通过、零跳过，其中19共享协议；根pnpm check含真实PG，31文件334测试全通过，格式、模块边界lint、完整类型与tokens检查通过。APK app.weiban、min26/target36、debug签名验证通过；本机APK SHA256 346a3dc0f5e114fedf9a89196bcb4b7a1aae3fae3a20795af5df485ea727110d（不同机器的调试签名/产物不要求同哈希）。

代码、依赖/许可证及限制见 [安卓实现说明](../android/foundation.md)，操作见 [Windows开发](../ops/android-development.md)。JUnit4 EPL-1.0仅测试使用，遵循工程规范第10.7条明确选定的JUnit；其他新增库与工具许可证逐项登记。

L1接续：Room同步状态持久化/HTTP与WS驱动、WorkManager发件重试、聊天和角色/好友、推送。当前这部分是入口/存储骨架，不能将纯状态机向量通过视为聊天端到端完成。真机Keystore、IME、厂商推送/保活及独立验收另执行；产品仍未完成。
