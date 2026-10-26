# 2026-10-22 统一整合与服务器发布

> 已完成：运行代码 `7a913c84ba9dba65d282b60c6d792999f741e31b` 于 2026-10-22 16:27:39（北京时间）正式部署。主线已统一，DeepSeek 预填项可在后台配置；具体证据、未通过项目与本人配置边界见本页末尾。前文保留整合与首次发布过程，不表示现在仍未部署。

总经理本轮明确授权把本地新增改动整合、合并并部署到香港服务器，覆盖此前「不 push / 不合并 / 不部署」限制；同时确认 P3 推荐 B：图片当轮检索，允许额外一次用户付费的文本生成。本轮仍串行执行；自查属于开发自测，独立验收需另一审查者。

## 整合边界

活动副本 `C:/wb-dev/wb-client-logs`，统一分支 `codex/release-20261022`。H3 → S → J → H4 → M → L 原本已在同一祖先链；本次再加入 P3，契约 3.34，迁移累计到 0135。质量历史分支按普通合并保留原报告；没有修改报告的既有验收结论。

通过遍历全部工作副本和本地分支确认：未合并的 T-056 / T-057 / T-059、backup/main-before-trunk-sync 和 oldui-android 均为旧阶段历史。它们的有效实现已由后来的 timeline / health / UI 实现替代；T-056 还误含嵌套工作副本 `wb-devwb-t054`，oldui-android 标记为暂停且未编译。以保留最新实现的历史合并记录统一祖先，未把旧版工作代码盖回当前版本；整合后所有本地分支头均为本次版本祖先。旧工作副本中的未提交 proactive / health 草稿已有正式后续模块；其余未跟踪项是预览、编译生成 JS、工具目录或既存质量报告，未作为新业务功能覆盖服务器。

共享桌面副本仍保留 main 和原有未提交文件，不重置、不切分支、不覆盖质量工作文件。统一分支和正式发布清单是这次部署源；后续修复从此版本继续，不能再从旧任务分支直接发布。

## 图片当轮检索

私聊、群聊用户触发回复、用户要求的朋友圈评论均接入同一公开作品搜索器。第一轮附图，解析并沿用 H3 加密描述；只从可见作品标题匹配已发布预设角色的公开作品索引，或「书名号标题 + 索引中已有且图上可见的出版方」构造查询。不会用人脸、头像相似度、people 数组推断身份；自定义私人角色、自拍、合照、健康 / 证件 / 私密范围不搜索。

可用的规划模型只收到公开候选数和是否需要新事实两个固定特征，平台付费；两个问题均 yes 且置信度至少 0.55 才执行。尚未配置合适规划模型时，明确的公开标题匹配走确定性规则；已配置模型出错或低置信度则保守退回。没有自动切 Jev，也没有降低全局阈值。

公开查询由平台承担，最多一次、最多三条摘要、四秒额外查询预算、该路径不重试且本期不额外 fetch。第二轮只携描述和公开引用，不重传原图；两次生成按原用户计价分别记录、回复费用合并显示。查询和第二次生成前后重查账号、来源、scope、联系人 / 记忆版本（私聊）或群 / 帖子可见性；失败保留普通看图回复。作品索引未维护、图片没有可验证标题时不能承诺联网识别，不靠放宽私人照片出境补触发率。

服务开关 `IMAGE_PUBLIC_SEARCH_ENABLED` 默认 0，部署本次按授权设 1；切回 0 仅关闭附加搜索，不影响 H3 看图与描述存档。DeepSeek 密钥仍需总经理在后台填入，并完成模型、计费上限、有效价目和平台「联网搜索」选择。

## 发布证据与检查

服务器 `/srv/weiban/src` 已先完整归档，原运行镜像另打 `before-20261022` 标签。下载源码逐 Git blob 比对，业务文件与本地 main 完全一致；五个差异都是 Windows 脚本换行，另有两个历史截图文件名编码差异。旧 deployment-version.txt 停留 10-14，不能用它代表实际运行代码。

发布采用从原服务器源码复制到新的版本目录，再应用 main 到整合版本的完整二进制差异；`git apply --check` 先拒绝冲突，随后对 1346 个业务 / 配套源码文件逐一核对 Git blob 摘要，避免覆盖服务器独有内容。第一次全量源码传输慢且未结束就启动解包，解包因 EOF 失败；未触碰正式目录或服务。已改为完整差异包和逐文件摘要校验，不能把失败尝试当作发布成功。

本机全仓类型检查通过；统一自查发现并修复 L 路由 schema 漏掉 `v1`、耗尽时卡片生成前置闸门缺失，以及旧 M 通话 / 大脑测试夹具未随持久队列和共同经历注入升级。密码测试按总经理既定取消「至少五种字符」的规则修正。六文件 39 条专项通过；P3 另有三条服务测试覆盖两轮费用、外发净化、无重复图片、低置信度、来源过期和供应商失败。

数据库验证改在服务器 dry-run 网络运行完整测试容器，不经过高延迟 SSH 隧道；与生产 PostgreSQL、媒体卷及密钥完全隔离。迁移 / 整套检查 / 备份 / 正式切换及入口检查的最终结果如下。

## 最终运行版本与防覆盖

- 运行源码完整提交：`7a913c84ba9dba65d282b60c6d792999f741e31b`；首次切换版本 `b16ffdd9fc18a29733f9a879b05f0c309e188145` 后，再补齐图片来源已隐藏 / 清空 / 带健康标签时停止检索的硬闸门、安卓日志结构整理与通知头像导出尺寸修正。
- 最终 app 镜像 `sha256:2b09e030686553e2decb395eaa6447264c71fec96ab31a4d23192e08b5fd9d0c`；网页 / 后台镜像 `sha256:d0c587534d3252671c2aae644ce9bee9f1de4b11d6a6fe507a866aee1cf8eade`。源码目录 `/srv/weiban/releases/7a913c84ba9dba65d282b60c6d792999f741e31b-patch`，`/srv/weiban/src` 只指向此完整版本。最终 **2653** 个源文件按 Git blob 摘要核对；历史 Windows 脚本换行及需求截图不作为运行源码校验项。
- 后端、网页和管理端一起切换，固定 `weiban-prod` 项目、原数据库 / 媒体卷 / 密钥不变；124 项已执行迁移，最新 `0135_client_logs`。当前 app healthy，两个入口健康检查均为 `ok / 3.34 / crypto.configured=true`。
- 备份 `/srv/weiban/backups/weiban-20261022T074359Z-nIQOBQ` 的 `database.dump.age` 与 `media.tar.age` 均通过 SHA256 校验。保留原始源码归档、第一次发布前镜像，以及最终切换前 `weiban-app:before-final-20261022` / `weiban-edge:before-final-20261022` 和 `/srv/weiban/src.before-final-20261022`，没有在生产执行 down 或恢复覆盖。
- 共享 main、`local/trunk`、远端 main 已统一到整合链；全部本地分支和已抓取远端分支均已被整合提交包含。原有 QA 文件先逐字节备份到 `C:/wb-dev/shared-quality-before-release-20261022` 并暂存，再快进共享 main，随后恢复原字节；26 份原未跟踪 QA 文件与已合入质量分支内容一致，旧工作副本与工具目录没有删除。
- 新增只读发布闸门 `deploy/hk/Assert-ReleaseSource.ps1`：拉取 main，拒绝未提交业务源码，且目标提交必须同时包含远端 main 和服务器发布清单中的完整提交。闸门不自动发布或授予发布权限；后续禁止从旧任务节点直接覆盖服务器。普通后续开发仍用独立分支。

## 统一开发自查结果及限制

| 检查 | 实际结果 / 证据 |
| --- | --- |
| 全仓类型、lint、格式、token | 全仓类型检查通过；最终后端来源闸门再编译通过；449 模块 / 2051 依赖无违规。格式和 tokens 通过。日志 `C:/wb-dev/logs/release-final-types.txt`、`release-final-source-lint.txt`、`release-final-format.txt`、`release-final-tokens.txt`、`release-visible-source-types.txt`。 |
| 整仓 PostgreSQL / Vitest | 在 `db8fc153bc75ce158fa8925ecda5ebfac431b040` 源码完整运行 749 条：**646 通过、97 失败、6 跳过**。原始结构化结果 `C:/wb-dev/logs/release-server-tests.json`。不是全绿，不以新增专项通过代替此结论。 |
| 失败基线对照 | 用部署前 main 源码在另一独立测试库重跑五个关键文件，**26 条失败与整合版逐个一致，比较文件中没有新增失败**。范围为 ai-runtime-queue / ai-runtime / memory-persona / model-gateway / care-missing-signals。其余失败涉及已停用邀请码、旧冻结 / 计价夹具等，未把未重跑项目一概判为无回归。证据 `release-baseline-tests.json`。 |
| 新增与修复专项 | 六文件 39 条通过；P3 服务及搜索 32 条通过；最终图片来源可见性 / 公开查询 7 条通过。图片源隐藏后虽 status=normal 但 content=null 的情况已显式拒绝，健康标签先于模型分类。`release-fixed-tests.txt`、`release-last-service-tests.txt`、`release-visible-source-tests.txt`。 |
| 新增日志真实数据库 | 新模块单独三条全部通过：并发累计差值去重 / 完整响应契约、分页 / 新版本重开 / 旧版本不倒退、限额 / 工单快照 / 删除登记清理。服务器 `/srv/weiban/client-logs-test.log`，测试文件 `apps/server/test/client-logs.test.ts`。 |
| 新迁移 | 在独立 `weiban_release_20261022` 执行全部 up → 最新 6 项 down → 再 up，exit 0；正式库只执行 up / 验证，无回滚删数据。服务器 `release-migration-test.log`、`release-deploy-closeout-20261022.log`。 |
| 浏览器与线上入口 | 公网用户端、原隧道 `localhost:9081` 管理端的真实 Chromium 登录页均 200、登录入口存在、pageerror=0；公网健康接口另从本机验证。截图 / JSON 在 `C:/wb-dev/logs/release-web-live.png`、`release-admin-live.png` 与对应 JSON。未登录后端的完整配置交互和真实供应商调用不能据此登记通过。 |
| 安卓 | 最终 `detekt`、core:data / core:network / platform 专项与 APK 构建 **exit 0**，`release-android-refactor-validation.txt`。所有实际执行的 JUnit XML 合计 **127 条，118 通过、9 失败、0 跳过**；失败为旧页面文字 / 导航等待与 Windows Robolectric FileProvider 相机路径，其中聊天 7、我的页面 2；没有以最后一组 Gradle 成功冒称整个安卓测试通过。相关编译夹具已改为当前 Profile / Wallet 字段；通知 PNG 恢复独立 96px，不再随页面头像 70dp 变化；暗色头像测试遵循已有令牌。 |
| GitHub CI | `b16ffdd` 的运行 [39744533384](https://github.com/yottermanzione-ship-it/weiban/actions/runs/39744533384) 已实际读取，check 与安卓 job 失败；新增安卓静态问题已修复并在本机 detekt 通过，历史完整测试仍未全绿。`7a913c8` 运行 [39747604271](https://github.com/yottermanzione-ship-it/weiban/actions/runs/39747604271) 发布记录时仍在运行，不登记为成功。 |

本次是受总经理明确授权的开发整合 / 部署，不是另一审查者完成的独立验收。没有删除失败用例、关闭现有 CI 或伪装通过。没有新增真实供应商扣费验证、Jev 正式校准、完整浏览器配置流程或真机验收的通过声明。

## 安卓交付与接续

调试安装包：`C:/wb-dev/artifacts/weiban-20261022-server-debug.apk`，API 地址已经编译为 `http://103.231.58.124`，SHA256 `ABAF80141487D41B24833C0487621A29F8DCBFA68A0C04A84A811403A3208781`。这不是正式签名商店包，也没有代替用户在手机安装 / 验证。

总经理现在只需按 [配置清单](../ops/2026-10-22-gm-configuration.md) 在升级后的后台完成 DeepSeek 密钥、搜索模型、计费上限 / 有效价目及平台内部搜索选择；不要在聊天发送密钥。DeepSeek 预填项已在正式库读到 `deepseek_search / https://api.deepseek.com / awaiting_key=true`。P3 不再需要选择 A / B，P1 仍按已确认范围只交方案，P2 已取消。配置完成后继续真实供应商、实际费用 / 分摊联调和遗留质量问题，不能把本轮部署完成等同于整产品验收完成。
