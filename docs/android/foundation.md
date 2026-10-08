# 安卓原生底座（T-035）

实现遵循 ADR-0011、repo-structure 第 5 节和 engineering-standards 第 10 节。`apps/android` 是独立 Kotlin/Compose Gradle 工程；服务端、网页和后台依然使用 pnpm。开发自测与独立质量验收分别登记。

## 模块与契约

`app` 装配导航和会话；`feature/auth`、`feature/me` 提供原生登录注册、资料与头像裁剪、模型、余额/预算/流水和账号主题。`core/network` 负责 OkHttp、接口校验及 Keystore；`core/data` 负责 Room、账号隔离和 Kotlin 协议状态机；`core/designsystem` 使用生成令牌与 Phosphor 原生矢量图；`core/testvectors` 在 JVM 上执行共享 JSON 向量。`platform` 集中实现可选厂商推送/后台通知能力；当前原生通知装配与配置见[通知说明](notifications.md)，默认未配置通道，不以测试 transport 代替生产厂商 SDK。

`pnpm android:generate` 先生成契约 JSON Schema，再从实际定义生成 Kotlin 数据类、tagged union 和 85 个类型化接口，复制原 Schema 作为运行时验证资源，并生成主题令牌和底栏图标。`android:generate:check` 逐文件比较。生成 Kotlin 主源码不手改；手写测试不被生成器覆盖。

生成器支持引用、对象、常量、枚举、可空、数组/记录、交集与按 type 区分的联合；递归 JSON 及没有稳定 discriminator 的异构字段使用 JsonElement。整数金额/游标使用 Long。收取未知消息和未知更新按各自 schema 降级，保留 originalType、时间与游标，已降级数据再解析不会丢原类型。发送端拒绝未知内容。非可空必填字段没有默认值；必填可空字段也必须出现在 JSON 中；常量 discriminator 始终输出。

网络层先按随包 Schema 校验/归一化，再反序列化生成类型，已知类型缺字段不能被降级掩盖；限制响应 4 MB 和 JSON 深度 128，未知对象字段剥离。Schema 无法表达的业务关系由协议引擎和服务器再次检查，不把导出 Schema 等同于全部 Zod refinement。协议核心与网页独立实现，运行同一目录下的原始 19 份向量，完整比较状态、动作、检查点、错误回滚及重启 JSON 往返。

## 会话与本地数据

令牌和会话只以 AES-GCM 密文写入 noBackupFilesDir 的 AtomicFile；密钥由 Android Keystore 创建且不可导出，使用随机 IV 和版本化 AAD，密文损坏时清理。关闭系统备份，不写令牌/个人资料日志。实际设备 Keystore 的硬件支持与系统升级行为另验，不由内存假 vault 的 Room 测试代替。

Room 存 owner、接口缓存与协议状态。登录、退出、恢复一致性检查和缓存提交共用互斥锁；切换账号在事务内清空缓存/同步数据再改 owner。每个回复捕获会话对象，迟到旧回复不能展示或写入新账号。网络 GET 先提交 Room，再从提交的数据读取展示；只有传输失败可读取之前校验过的同账号 GET 缓存，HTTP 错误不读取旧缓存。仅有效 unauthenticated 错误清会话，invalid_credentials/未知错误不能误退出。

OkHttp 关闭跳转和自动重试，HTTPS 为默认；仅 debug 对指定本机地址开放 HTTP。媒体访问凭证只能指向配置服务的同源、同 mediaId 下载路径，不附加 bearer；WebP 下载限制 10 MB，头像解码限制 40 MP/最长 2048 像素，考虑 EXIF 旋转/镜像后方形裁剪为 512 像素。公开构建中没有模型密钥。

## 构建与验证

版本集中在 gradle/libs.versions.toml，Gradle wrapper 8.13 附发行包 SHA256，SDK36/min26/JDK21/字节码17。提交各模块 Gradle 依赖锁；更新依赖后用完整检查命令加 --write-locks 显式更新，再正常检查。全部 Kotlin 编译警告视为错误，ktlint 管格式、detekt 管复杂度等；仅对完整协议分派、明确拒绝边界等做带理由的局部豁免，不使用静态检查 baseline 隐藏问题。

2026-10-06本机完整Gradle检查/构建通过：41条JUnit、零跳过，其中19共享协议；原生登录成功/失败与首次资料保存、账号主题均有Compose回归（MockWebServer真实HTTP + Room，并非供应商或真机端到端验证）。根pnpm check含真实PG的31文件334测试及格式/lint/类型/tokens通过，生成无差异与debug签名校验通过。CI发布后读取结果，不以本机测试代替。

CI 校验生成物、ktlint/detekt、JUnit 实际执行与零跳过，并构建 debug APK，保留 APK 与报告 14 天。安装方式与正式 HTTPS 配置见 [Windows 开发说明](../ops/android-development.md)。正式签名、真机/中文输入法/无障碍/厂商推送与保活尚待专项验收。

L1 已装配 Room 持久化协议状态、HTTP/WebSocket 驱动、WorkManager 发件队列及私聊、好友、角色界面，详见[原生聊天](chat.md)和T-041；下述41条为L0历史证据，当前证据以任务卡对应不可变提交为准。纯状态机向量或Robolectric通过不能当作真实设备端到端验收。产品仍未完成。

## 新依赖与许可证

| 依赖 | 用途 | 许可证 |
|---|---|---|
| Kotlin / kotlinx serialization / coroutines | 编译、JSON、协程 | Apache-2.0 |
| Android Gradle Plugin / AndroidX Compose、Activity、Lifecycle、Room、WorkManager、test-core / KSP | 原生构建、界面、数据库、后台与测试生成 | Apache-2.0 |
| Gradle wrapper | 固定构建入口 | Apache-2.0 |
| OkHttp / MockWebServer | HTTP 与真实协议测试服务 | Apache-2.0 |
| Phosphor Icons | 底栏原生矢量图标，源为已锁定网页依赖 | MIT；tools/PHOSPHOR-LICENSE 保留声明 |
| Robolectric | JVM 执行 Android/Room/Compose 与原生图形测试 | MIT |
| JUnit4 | 工程规范第10.7条明确要求的协议/界面测试框架，仅开发测试 | EPL-1.0 |
| ktlint / ktlint Gradle plugin | 格式检查 | MIT |
| detekt | 静态检查 | Apache-2.0 |
| Firebase Messaging（可选运行时通道） | 原生 data-only 推送接收，默认不配置 | Apache-2.0；传递 Google Play Services 组件遵循 Google Android SDK license，接入限制见 `notifications.md` |

所有构建/测试工具都不作为模型或推送供应商客户端，第三方 SDK 不绕过项目模块边界。
