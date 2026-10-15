# A4 第二批：消息转发开发交接

独立 worktree `C:\wb-dev\wb-a4-forward`、分支 `codex/chat-forward`、基线 `8ac8d1f`。完整实现提交 `1030dc0296727d49a0d2ea6797e70c75d6d13be6`；中途保护提交 `dda18da4ecdbfa58398f4c8fee29c40115e30418`、`d6e58a8bf181f2ecacf45710bbad67cd6490c05b`。本批为开发自查，不是独立质量验收；没有合主线、修改共享目录、GitHub 操作或部署。

## 已实现

- 长按转发进入多选并默认选中当前条；原六格浅色菜单保留，多选底栏新增转发。多条提供逐条/合并，单条直接逐条；取消回到原选择，不往返路由。
- 最近聊天在前，并能从完整 active 通讯录选未聊角色。代码核实添加通过时已持久创建私聊 ID，复用 Contact.conversationId，不绕添加资格造新创建入口。目标去重、最多 10 个，搜索复用 A1 SearchField。
- 客户端只发源会话/消息 ID、目标 ID、模式和 UUID，不上传正文或原发言人；每目标独立事务，消息/同步/outbox/转发收据原子提交。部分失败如实列出、重试锁定原内容与接收人及请求 UUID，已送达目标不重复。源/目标会话稳定顺序加锁、请求 advisory lock 与摘要防不同内容复用；占用其他普通发送的派生幂等键明确拒绝，不能拿别的消息当成功。
- 逐条以用户身份保留文本/图片/语音/表情/链接语义；合并卡显示谁与谁聊天，原发言人、时间和内容快照，点击展开。图片/表情/链接/语音复用真实媒体组件。动作、拍一拍、通话、信件和每日一问做静态内容，不执行旧对象动作、不把旧信件误当寄给接收角色。
- 源与目标归属/成员、撤回/清空/隐藏、归档/试聊到期均核；媒体由 getMedia 经 findReady+owner 校验，不把普通用户发送用途校验全面放开。普通 send schema 不接受 forwarded_record，writer 用户路径也明令拦截。adult 源不能转 normal 目标，adult 目标当前成员仍走既有政策校验；保留全部源标签，增加服务器 forwarded 后超过 8 个则明确拒绝。
- 快照用正常消息加密落库，不通过原会话链接再取内容；暂不再次转发合并卡，明确提示。最多 50 条、20,000 正文字、512 KiB 快照，不截断保存。
- 私聊、群聊及记忆共用可读内容渲染，合并记录保留实际原名/时间/文字/链接等，不送“聊天记录”占位。私聊新卡最多 3 项媒体沿既有 MediaAi 处理/缓存/额度，其余媒体与历史、群聊/记忆离线降级，不猜图；语音仅服务器转发标签可复用已知原文，普通用户语音 ASR 信任边界未放开。原稳定前缀组装不改、没有新增收费管线。
- 契约 3.10、新端点和服务端 forwarded_record（保留未知类型降级）；0093_chat_forward 迁移、journal、回滚、注销计数同步；安卓只生成契约配套，不改 UI、不编译。

接口细节与核查原因见 `docs/backend/chat-forward.md`；本任务不实施会员或支付。

## 交互证据

截图在 `docs/web/a4-forward-2026-10-15/`。子代理 IAB 初始化/开 tab 均报 unavailable，由主会话浏览器代操作。使用产品真实 ConversationPage、长按、多选、ForwardPicker、接收气泡和展开组件；仅 auth/chat state/API 是临时本地样例。不是实际后台转发、数据库或模型验收。临时预览源码、配置及离线探针已移除，5184 服务停止。

| 截图 | 实际操作 |
| --- | --- |
| 01-longpress、02-multi-select | 长按菜单六项，转发默认一条，再勾第二条；多选底栏四项 |
| 03-forward-modes | 多条模式选择；主会话实际取消后原两条选择仍保留 |
| 04-recent-targets、05-directory-uncontacted | 最近目标与完整通讯录；未聊角色能选。早期样例资料接口未回名字，04显示“角色”；最终样例用真实备注固定名字，与产品名称获取逻辑分开说明 |
| 06-partial-failure、07-same-request-retry | 样例第一次未聊目标失败、另一目标成功；重试记录同 UUID、源/目标/模式，成功目标未重复。收据后台幂等仅源码核对，未实际DB执行 |
| 08-received-card、09-expanded-record、10-uncontacted-received | 两目标各一张卡，展开原名/时间/正文。09发现正文继承居中，已修复 |
| 11-single-individual、12-individual-link-received | 单链接不弹模式、直接 individual；接收方用户侧链接标题/摘要/URL保留 |
| 13-expanded-record-final | 最终左对齐与夏知标题目视确认；为加速视觉复核预置的卡，不能充当发送或后端证据 |

`offline-ai-context.json` 是实际共享文字渲染器 + 现有 assemblePrompt 的离线输出，含原发言人/时间/文字/链接，头/历史/尾顺序保持；未调用收费模型。源数据为同类开发样例，不能说明模型真实响应已验证。

## 检查与限制

相关 contracts/client-core/server/web typecheck、受影响 ESLint、依赖边界检查通过；contracts generate/build、server/web 生产 build 通过。client-core 没有 build 脚本，只有 typecheck；第一次尝试该不存在命令的错误已核实，未记为通过。安卓生成及 --check 通过，未编译。没有写测试或跑测试套件。

最终 server/web typecheck 与生产 build 再次通过（网页构建号 413396）；受影响 ESLint、依赖边界、生成物 check、Prettier 与 `git diff --check 8ac8d1f..HEAD`、工作区差异空白检查通过。临时文件没有进入提交。

本机 Docker daemon 不可用，没有可复用临时 PostgreSQL。因此新端点真实 HTTP、迁移、事务回滚、跨目标并发/重复请求以及媒体权限失败均未实际执行，只完成编译与源码核对；上线前应在有数据库的开发环境复核。未调用收费模型，媒体识别与真实角色回复、香港端到端、Safari 真机长按/滑动未验证。新卡超过 3 项媒体时余项保留并可查看，AI按未识别说明降级。尚未再次转发合并记录，不做无限嵌套。生产 build 保留既有大包提示。

部署到有数据库的环境时先备份并执行 0093 迁移，随后才能使用新端点；本地 Git 合入不执行数据库变更。q-features 后续迁移从 0094 继续，避免覆盖。香港当前旧版没有该表/接口，未对其做写入。后续主负责人合入 local/trunk 并快进同步共享 main，再继续 A5。
