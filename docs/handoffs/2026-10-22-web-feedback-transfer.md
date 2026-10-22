# 2026-10-22 停止执行与转交：网页版反馈 / Arena

> 总经理最新指令：“不执行了，把当前进度全部整理好，登记好，我要交给其他 AGENT 了”。已停止业务实施、构建、供应商调用与部署；本次只整理交接。**新一轮网页反馈尚未实施**，不能与上一轮已发布功能混淆。下一位 Agent 请先读 [新任务卡](../tasks/2026-10-22-web-feedback-and-arena.md)，等待 / 遵循总经理给自己的恢复指令。

## 当前精确断点

- 独立开发目录：`C:/wb-dev/wb-client-logs`。
- 当前分支：`codex/web-feedback-20261022`，从 `30967451ecec6e028067fd58cb7a02fe4e1700a8` 创建。创建分支后只读代码和公开官方文档，**没有本任务业务补丁或数据库迁移**。
- `30967451ecec6e028067fd58cb7a02fe4e1700a8` 是上一轮最终发布回执的纯文档提交，本次核查远端 main 仍为 `7a913c84ba9dba65d282b60c6d792999f741e31b`，3096745 尚未推送。新交接文档将在本分支另作纯文档提交；不要将其视为新功能实现版本。
- 共享目录 `C:/Users/lomjy3/Desktop/weiban` 仍在 main，HEAD 为 `7a913c84ba9dba65d282b60c6d792999f741e31b`。不切换共享分支、不清理别人文件。交接文件及最新入口同时登记到共享文档，方便从此目录接手；没有在共享目录提交或推送。
- 停止时独立目录业务文件干净。本轮没运行测试 / 网页构建 / APK 构建，也没发布；仅完成下列调查。

## 本轮调查已确认的落点

| 需求 | 已读到的当前实现与接手位置 |
| --- | --- |
| 服务页充值 | `apps/web/src/features/me.tsx` 约 110 行有 `/wallet/recharge` 菜单；积分页充值在 `apps/web/src/features/wallet.tsx`，后者应保留。 |
| 聊天积分明细 | `wallet.tsx` 的 `LedgerPage`（约 306 行起）额外批量调用 `ChatEndpoints.listChargedMessages`，维护 charged / open，点击汇总行打开逐消息页并跳聊天。按新需求精简此路径，不能只删箭头留下后台额外取数。 |
| 模型列表重复 | `apps/web/src/features/models.tsx` 的 `ScenarioModelPage` 先 filter 有 leaderboardRank 的模型作为排行榜，再单独渲染“全部可选模型”。热门榜已读选用人数，但仅列人数大于零的条目；需按任务卡统一排行榜全部模型与暂无排名。另有 `features/leaderboard.tsx` 入口，需一同核查。 |
| 发照片误解 | `models.tsx` 的 SCENARIOS 明确含 `image_generation / 发照片 / 角色发照片、自拍`，角色覆盖页也复用它。后端 `modules/model-access/application/catalog.ts` 的 ALL_SCENARIOS 同样保留 image_generation，不能仅改页面文案。 |
| 实际生图链路 | `apps/server/src/modules/ai-runtime/application/character-image.ts` 的 CharacterImageService.generate 在 image_generation 开启时调用 media.generateImage、按用户计费；素材库为后备。`media-ai.ts` 已有自主贴表情逻辑（约 508 行起），`ecology.ts` 与 `proactive-scheduler.ts` 也有 photo / sticker 分支。网上找图并发送尚未调查完整，不能宣称已有。 |
| 下拉割裂 | `apps/web/src/features/pull-panel.tsx`：THRESHOLD=90，rubberband 常数 0.7；paint 在位移刚大于 0.5 就将 panel 设为 visible，progress=value/full 让小程序提前淡入；release 有速度大于 0.5 且位移大于 24 就打开的捷径。`apps/web/src/app/shell.css` 的 .chat-list-page 背景为深色，.pull-panel 是 fixed inset:0。过早露出深色层解释了截图中的切割；还需实际浏览器验证 safe-area / 标题 / 搜索是否同层，不能只靠静态判断登记已修复。 |
| Arena 现状 | `apps/server/src/modules/model-access/application/leaderboard.ts` 仍通过 defaultLeaderboardFetcher 抓 Arena 网页、parseLeaderboard 提取名字 / 名次，每天 `20 4 * * *` 定时；支持后台刷新、粘贴导入、失败保留旧快照。`catalog.ts` 的 LeaderboardSnapshot 仅有 name/rank，arenaRanks 按 normalizeArenaName 完全匹配。 |
| 思考档位合并 | `modules/model-access/domain/leaderboard.ts` 的 normalizeArenaName 只 trim / 合并空格 / lowercase，尚未剥离思考档位；同名最好名次与 relativeRanks 已有纯函数，可扩展而非重建。注意 Map 当前直接赋值，不能对合并名称采用“最后一个覆盖最好成绩”。 |
| 榜单日期 | `catalog.ts` 的 leaderboardInfo 现在拿抓取日期作 asOf，并非官方 leaderboard_publish_date；新同步要区分。热门统计从 scenarioSelections 按 chat 统计选用人数。 |
| 接口与后台 | `packages/contracts/src/http/model-access.ts` 已有 ModelLeaderboardInfo、LeaderboardSnapshotStatus、getLeaderboardInfo、后台 refresh / import 接口；`apps/admin/src/features/model/leaderboard-source.tsx` 已有刷新 / 导入 UI。优先复用并做契约配套。 |

已浏览官方 Arena Text 页面、Hugging Face 数据集 README 和 `/rows` 文档，页面显示发布日期 2026-10-20、417 模型；源码说明仍列出 text_style_control 的 latest/full。本轮**没有重新实际调用 Dataset Viewer 分页 API**。附件中上一位 Agent 的调查曾实际取得 overall 417 个模型、latest 共 11066 行、full 1071011 行，并记录 `/filter` 超时而 `/rows` 正常；这是附件中的调查证据，接手须重新验证，不要冒充本轮实测。

官方链接：

- [Arena Text](https://arena.ai/leaderboard/chat/text)
- [官方数据集结构](https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset/raw/main/README.md)
- [Dataset Viewer 分页](https://huggingface.co/docs/dataset-viewer/rows)

## 需求原件与图片

已在本机保留一份稳定副本，避免微信 / 临时附件清理导致接手缺图（**含用户私人截图，仅本机保存，不纳入 Git、不公开上传**）：

- `C:/wb-dev/handoffs/web-feedback-20261022/arena-user-brief.txt`：原粘贴文档全文，含此前调查对话与总经理最后的榜单口径修正。
- `C:/wb-dev/handoffs/web-feedback-20261022/wechat-pull-reference.png`：微信半下拉参考。
- `C:/wb-dev/handoffs/web-feedback-20261022/weiban-pull-current.png`：微伴错误状态。

需求以 [新任务卡](../tasks/2026-10-22-web-feedback-and-arena.md) 的最终口径为准：只排微伴已有模型、同名不同思考档取最好名次、微伴内部重排、无数据写暂无排名；不得按原稿早期建议搬入完整 Arena 目录。当前只是修既有产品行为，不是另造截图原型；本轮未应用 Product Design 技能流程。

## 上一轮已完成发布：不要丢失或重复做

完整发布与自查证据见 [统一发布交接](2026-10-22-consolidated-release.md)。H3 / S / J / H4 / M / L / P3 已在同一整合链并发布；P1 只交方案、P2 已取消。P3 是用户发图后的公开作品当轮搜索，不等于这次要求的角色主动网上找图。

本次交接通过只读 SSH 重新核对发布清单与 src 链接，两者一致：

- 主机 `103.231.58.124`，生产 sourceCommit `7a913c84ba9dba65d282b60c6d792999f741e31b`；部署时刻 `2026-10-22T08:27:39Z`。
- `/srv/weiban/src` → `/srv/weiban/releases/7a913c84ba9dba65d282b60c6d792999f741e31b-patch`。
- app 镜像 `sha256:2b09e030686553e2decb395eaa6447264c71fec96ab31a4d23192e08b5fd9d0c`；edge 镜像 `sha256:d0c587534d3252671c2aae644ce9bee9f1de4b11d6a6fe507a866aee1cf8eade`。
- 契约 3.34，最新迁移 0135_client_logs，IMAGE_PUBLIC_SEARCH_ENABLED=1。
- 清单备份 `/srv/weiban/backups/weiban-20261022T074359Z-nIQOBQ`，保留 `before-final-20261022` 镜像与 `/srv/weiban/src.before-final-20261022`。本轮没重新创建备份或运行健康 / 登录页验证，勿把上次验证说成本次复验。
- SSH 身份路径 `C:/Users/lomjy3/.ssh/weiban_deploy`。生产 compose 项目固定 `weiban-prod`；配置 `/srv/weiban/runtime.env`、密钥 `/srv/weiban/secrets` 在源码外。不要输出或复制密钥值。
- 后续获准发布时必须先执行 `deploy/hk/Assert-ReleaseSource.ps1`，确认包含远端 main 和线上 sourceCommit；使用完整版本目录、备份与整体切换，不得从旧任务分支覆盖。旧发布脚本在 `C:/wb-dev/logs` 中硬编码旧 SHA / 回滚名，不能原样重跑。

DeepSeek 上一轮已在正式库验证空密钥预置 `DeepSeek 联网搜索 / deepseek_search / https://api.deepseek.com`。仍待本人配置密钥、模型、计费上限 / 有效价目及平台内部搜索选择，详见 [配置清单](../ops/2026-10-22-gm-configuration.md)。本轮没有修改配置或发起真实供应商调用；不要让总经理在聊天发送密钥。

## 质量状态与遗留限制

以下均是上一轮记录，未在本轮重跑：全仓类型 / lint / 格式 / tokens 通过；真实 PostgreSQL 整套 749 条中 646 通过、97 失败、6 跳过，**并非全绿**。五个关键文件 26 条失败与旧主线一致，但不能推及未对照文件。L 新日志真实库 3 条通过、6 项新迁移 up/down/up 通过、P3 与来源闸门专项通过；细节与原始日志路径见统一发布交接。

CI `39744533384` 失败，`39747604271` 上次登记时尚在运行，本轮未查询最终状态。独立验收、真实供应商费用联调、登录后的完整配置、真机验证均没有完整通过结论。之前已有调试 APK，仅作为历史交付保留；**总经理现在明确不要继续构建 APK**。不要为接手先跑旧 Android 打包命令。

共享目录原有 `docs/quality/reproductions/2026-10-20-membership-probes.txt` 修改、`.workbuddy-ai/`、`.workbuddy/`、`wb-devwb-t056/`、`wb-devwb-t058/` 未跟踪目录均须保留；QA 原字节备份 `C:/wb-dev/shared-quality-before-release-20261022` 和旧 stash 不要清除。新交接只登记开发进度，不改写独立 QA 结论。

## 接手建议（尚未执行）

1. 先确认活动副本 / 分支 / HEAD，并读新任务卡和本交接；3096745 的上一轮最终回执还未到远端，须随文档一并保留。
2. 获得恢复指令后，在独立分支实施充值 / 积分 / 模型列表及下拉行为，随后接入官方榜单和角色发表情 / 网上找图；不要误删已上线的用户发图理解链路。
3. 整批完成后统一做开发自测，尤其手机尺寸 + safe-area 下拉临界点前后截图、拖动 / 回弹 / 上滑收起与热门统计、思考档合并 / 不同型号隔离 / 无排名 / 同步失败保旧 / 分页完整性。
4. 如需部署遵守完整祖先保护和既有生产配置保存，最后清楚报告新版本、实际验证结果与未完成限制；不得把本次文档整理登记成需求已实现。
