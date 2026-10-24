# 旧微伴搬迁执行记录（持续更新）

## 授权与边界

总经理要求连续完成角色头像/音色、聊天记录、朋友圈及关联媒体的正式搬迁，不再逐步确认；新版可直接操作，旧版保持正常使用。不运行本机 Docker，不再用 workflow/子代理。凭据只经加密包搬运，不把 API Key 或旧 KEK 写入本机、日志或 Git。

## 本轮已核对的事实

- 线上来源 `11d5fc16d2c01c603cc8a2dfe7790dfe49fd403b`，迁移到 0137。
- 已有 677 条旧卡、17,177 条世界书、35,030 条示例；旧卡原文直接运行。
- 头像 677 个全部存在，声音参考样本 488 个全部存在。两类文件合计压缩包 187,334,280 字节，SHA256 `cdcda19e9351d67e936c4f5de66c24962a5140f5bcba0fdd47ae7214eeee9f1a`。
- 新站内已用 CMS 接收并重新加密保存旧站百炼公共账号（来源 8eed4824）；目标上游 `2fed2a60-eaaf-5571-9a59-7253830e76bf`。使用相同账号、相同旧克隆音色实测供应商返回 200，无需重新克隆。
- 发现另一种流式 WAV 哨兵：RIFF `0x7fffffbf`，data `0x7fffff9b`。仅在 RIFF 为已知哨兵且 data 精确等于减去头长度时修复；非哨兵损坏长度仍拒绝。
- 新增旧角色音色专用路由：带后台迁移标记 `legacy` 的音色使用其已登记的模型和真实价目，普通音色保持原有场景匹配限制；MiMo 样本通过加密媒体对象在每次合成时读入，不伪造持久 voice_id。

## 聊天/朋友圈副本

旧站继续使用中，因此行数是明确时间点的副本，不代表之后的新写入：

- 时间：2026-10-24T12:02:47.053609Z（北京时间 20:02）。
- 用户 556、好友 3,473、群 87、群成员 364。
- 私聊 296,678、群消息 18,874、朋友圈 4,802、互动 35,496。
- 记忆 13,668、摘要 946、用户角色设定 126、关系状态 2,575。
- 读游标 2,943、音色风格偏好 56。
- 文件副本 26,695,243 字节（gzip），SHA256 `6069e279309d251215649a33384240b0e879d43fc5b1ba0772373782c1a35992`。
- 媒体引用存在 14,681 个 / 3,346,393,530 字节；外链 709；缺失文件引用 298。其余忽略项包括原站 API 形式的 URL，需要从同一消息的实际文件路径解析，不能直接当缺失。
- 旧摘要有损坏 UTF-8。导出器保留原始字节的 base64 及可显示文本，不静默丢弃，不把正文写进日志。

## 执行资料位置

- 旧站只读导出位于 `/tmp/wb-transfer-20261024`；聊天副本为 `content-snapshot-v2`（v1 在摘要编码处中断，不可用）。
- 新站私有搬迁目录 `/srv/weiban/import-staging/20261024-final`；数据、回执、临时接收器分目录。
- 本机一次性执行脚本在 `C:/wb-dev/logs`；源代码脚本不含凭据。大文件经本机的 SSH 传输不稳定，已改为短暂内存密钥代理转发，使新站直接从旧站读取；密钥文件不复制到任何远端，代理退出即销毁。

## 检查记录

- WAV 格式修复单测 2/2 通过。
- 旧角色音色路由、MiMo 参考样本和原有普通音色限制单测 6/6 通过。
- server typecheck 通过。

## 头像与音色正式完成

- 677/677 头像已写入加密媒体库并绑定，失败 0；351/351 千问音色已登记并绑定，失败 0。
- 488 个参考样本全部写入加密媒体库：351 个附在原千问音色，137 个使用 MiMo 每次带参考音频的克隆路线；189 个原本无音色也无样本，明确绑定默认音色，未伪造专属声音。
- 补齐 MiMo 克隆专用型号 `xiaomi/mimo-v2.5-tts-voiceclone`（同原站 `mimo-v2.5-tts-voiceclone`）：普通 `mimo-v2.5-tts` 对参考音频返回 bad_request，专用型号实测 200。137 个绑定已改用专用型号，价格沿用原内部参考成本和加成。
- 完整网关实测：千问 Ogg/Opus 4,969 字节 / 2,080ms（usage `01a16dd8-9533-720d-a5bd-325c608fff2b`）；MiMo 克隆 Ogg/Opus 5,963 字节 / 1,920ms（usage `01a16ddf-69e3-74df-a323-e6f469f027f0`）。都经真实供应商、计费、媒体加密链路；临时生成音频已删除，用量回执保留。
- 线上已发布 `5c9ffb7854cbb74008d1bf2c6c6a2783599c09ec`，来源闸门正常联网核对最新 origin/main 和线上祖先通过；本机无 Docker 操作。
- 新注册 2 个旧站账号已补迁，已有 554 个账号未改动（包括总经理重置的密码）。旧站副本 556 个账号均已在新站，管理员另保留。

## 朋友圈归属补充（旧方案中的估算已被源码事实替代）

实际读取原站 `moments_store.js` 后确认：角色帖子只对该角色的好友可见；互动按 `user_id` 隔离，无归属的用户互动不展示。因此不需要把 4,000 多条角色帖复制给所有用户，更不能只迁有互动帖：按好友关系迁入约 34,234 个用户可见副本，另迁用户自己的帖子。只有本人互动和本人好友的无归属角色互动可进入对应副本，禁止跨用户泄露。

## 未完成（不得写成已搬完）

聊天/朋友圈正式入库和关联媒体重封装；记忆、个性设定、关系状态的补迁。后续需保留源快照时间，不能以导出条数冒充正式入库条数。迁移副本已在新服务器，包含 556 用户、296,678 私聊消息、18,874 群消息、4,802 朋友圈。

## 下一执行轮断点（北京时间 20:35）

- 持续目标 `goal-33debed7-4697-4344-abbe-e50a1c488aca` active（不要结束目标）；人类要求做完再汇报，不必再确认。
- 仍在跑的后台任务：`pwsh-8b79a7096a0f4690`。它先在旧机以 nice 低优先级运行 `scripts/ops/pack-legacy-content-media.py`，再通过仅加载旧机私钥的临时内存代理，让新站直接 scp 旧站 `content-snapshot-v2/content-media.tar.gz` 和 `content-media-package.json`。结束后必须 `job_output` 收回结果。新站目标在 `/srv/weiban/import-staging/20261024-final/data`。**不要重复启动此传输。**
- 其他本轮后台任务均已收回；两次经本机到新机的大文件传输超时已终止，改成服务器间直传后头像包完整且校验通过。
- 新增代码（尚无聊天正式导入器）：`EnvelopeCrypto.sealMany`（逐行 AAD/nonce，批次只读取一次 DEK）、`MediaService.importLegacyObject`（维护专用，确定 ID、同所有者/用途幂等、防越权）、`createImportMediaService.accountStatus` 可传入真实身份状态/锁。6 个对应单测及 server typecheck 通过；不需要重跑。
- 新增 `scripts/ops/export-legacy-content.py` 和 `pack-legacy-content-media.py`；导出无账号密码。补迁的两个用户密码用另一个私有文件搬过来，入库后新站文件已删除，旧站 `/tmp/wb-transfer-20261024/users-final.json` 待清除。不要打印密码或聊天正文。
- 下一步自行编写一次性内容迁入脚本（不使用 workflow/子代理，不运行本机 Docker）。运行在新站 app 维护容器，可以用本机 esbuild 打包并 gzip 后上传，避免 3MB bundle 直传反复超时。通用打包脚本 `C:/wb-dev/logs/build-maintenance-20261024.mjs`。
- 当前源码的内部方法无需为了运行维护脚本再部署一次：打包维护脚本时会带入最新代码；正式 app 读消息/朋友圈格式不变。后续需提交源代码以便恢复。

### 内容迁入必须遵守的事实

1. 快照 JSONL 每行 `{table,row}`，gzip 流；先 `_snapshot`，其后 users/friends/groups/group_members/chat_history/group_messages/moments/interactions/cursors/memories/summaries/customizations/relationships/voice_styles。用户表不含密码。
2. **deleted_at 默认为空字符串**，不能用 IS NOT NULL 当“已删”；只有非空字符串才是真删。已删内容不得复活（可保持隐藏或只记回执），原始加密归档保留。私聊正文最长 4,455，仅 1 条超过新版 4,000 上限，可拆两条保留全文；群聊最长 1,437。朋友圈最长 349，评论最长 160，均能原样装下。
3. 私聊按 `(user_id,persona_name)` 关联角色，按时间+旧 id 排序；确定性 UUID 与 `legacy:` client key 保证重跑不重复，existing 新站消息不覆盖。好友只是 `user_friends`（3,473），仅有历史但已删好友的对话不要主动恢复好友关系。
4. 有 8 个未匹配角色名：困困井（1）、在源地等你🇲🇾（3）、妮妮（2）、嫣然（1）、将奇明（2）、小V同学（3,885）、张艺谋。（8）、紫薇（2）。先查已导角色别名；没有真实对应关系时不要随便合并到别人的角色，可建只对该用户可见的旧会话保留条目。旧 `personas` 表仅林夏/老陈/苏小满，不含小V。
5. 角色朋友圈按当前好友可见关系迁入，每用户一份；互动 `user_id` 非空只归该用户，无归属的角色互动再过滤好友；**无归属的用户互动 64 条不可猜归属**，只保留归档不展示。不得沿用旧方案“只搬有互动帖”的假设。
6. 真实 AAD（以运行代码为准）：消息 `chat:message:<id>`，朋友圈 `moments:post:<id>`，评论 `moments:comment:<id>`；owner 都是会话/朋友圈所属 user_id，不是角色 id。
7. 媒体确定性 ID 按 owner + purpose + 原文件身份生成；不同用户不能共用私有对象。可先规划引用，但完成前必须补齐文件加密入库。文件头识别实际 MIME（旧 png 有 JPEG，表情有 SVG），过大音频可用新服务器已有 ffmpeg 转码；丢失源文件明确保留“文件缺失”提示，不能伪造可播放文件。
8. 媒体清单 `content-manifest.json` 包含 assets[{source,path,archive,bytes}]、external、missing、ignored。忽略项多数为 API 式 audio_url，可优先用同一消息的 media_path 取真实文件，不要将它们全部当缺失。群头像、用户头像也在资产清单。旧源媒体文件约 3.35GB，新站剩余空间 9.7GB（20:31 实测）。

### 一次性执行工具位置

`C:/wb-dev/logs/restore-legacy-voice-samples-20261024.ts`：488 样本与 189 默认声音已执行成功，不要重建；`enable-mimo-clone-20261024.ts`：137 型号已修正；`check-restored-voices-20261024.ts`：只重测过失败的 MiMo，结果成功，勿再反复收费测。

新站回执统一在 `/srv/weiban/import-staging/20261024-final/reports`：avatars-report、voices-report、voice-samples-restored、restored-voice-acceptance（千问成功/MiMo首次失败）、restored-mimo-acceptance（修正型号后成功）、users-final-import。
