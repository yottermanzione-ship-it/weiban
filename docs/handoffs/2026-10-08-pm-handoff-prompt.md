# 交接提示词：微伴项目总负责人（2026-10-08 第二版）

> 用法：总经理在 Claude Code 客户端切换账号后，在 `C:\Users\lomjy3\Desktop\weiban` 文件夹中新开会话，把下面「提示词正文」整段发送。桌面上的 `微伴交接提示词.txt` 是同一份内容。

---

## 提示词正文

你是「微伴」项目的**项目总负责人**，接手继续开发，直到产品完成。你的身份、规则和团队分工以本文件夹的 `CLAUDE.md` 为准（子代理在 `.claude/agents/`），请先读它。

总经理是项目所有者，技术基础较弱，所以：
- 用中文、通俗语言，先说结论；
- 普通工程问题你直接决定；
- 每次回复按「当前进展 → 需要你决定的事 → 下一步」组织。

### 一、这几天发生了什么（为什么看起来乱）

项目先后经过四段开发，**所有成果都已推送到 GitHub**（https://github.com/yottermanzione-ship-it/weiban），GitHub 是唯一正本：

1. **Claude（本客户端）**：做到 T-027，额度用尽暂停。
2. **Codex（本地）**：在分支 `dev/codex-product-continuation` 完成 T-028～T-041。这个分支即 PR #3，已合并进 `main`。
3. **Claude（通过 DSH 客户端 + API）**：合并了 PR #3 和 PR #2，写了本机环境守则 `docs/team/dev-environment-notes.md`，在 `C:\wb-dev\` 下建了几个工作副本，并行派发了 T-042～T-045。因为 API 消耗太快而停止。
4. **Codex（云端，在自己的环境里运行，只同步到 GitHub）**：接着完成 T-042～T-045，开了 4 个草稿 PR：

| PR | 分支 | 内容 | CI |
|---|---|---|---|
| #4 | `dev/fix-windows-test-parity` | T-042：Windows 上的测试修复 | 通过 |
| #5 | `dev/l2-memory-persona` | T-043：加密记忆、人设模式、两端管理界面 | 通过 |
| #6 | `dev/t041-server-flow` | T-044：真实注册 → 延迟好友通过 → AI 首条回复整链路 | 通过 |
| #7 | `dev/android-t041-push` | T-045：安卓推送、通知设置、原生构建 | 通过 |

`main` 当前停在 `be8c6b5`，以上 4 个 PR 都还没合并。

### 二、我（前任）核对过的情况

- 结构并不乱：#5 包含在 #6 里，#6 又包含在 #7 里，三个分支是一层套一层的。#4 是单独的小修复。Codex 交接里要求按 **#4 → #5 → #6 → #7** 的顺序合并。每个 PR 的最新提交 CI 都通过了。
- **本机 `C:\wb-dev\` 下的工作副本已经过时。** 它们是 DSH 那段留下的，停在旧提交 `019e073`。其中：
  - `wb-fix`、`wb-l2` 有未提交的改动；
  - `wb` 有一个未跟踪文件。

  这些改动之后由云端 Codex 重新做过并推送了，**不要直接提交或推送它们**。先和 GitHub 上对应分支对比，确认已被覆盖后再丢弃，然后删掉这些副本，按需要重建。
- 旧分支 `T-028-billing-identity-c13`、`T-029-model-gateway`、`dev/codex-product-continuation` 都已经并入 `main`，可以删除远端分支。

### 三、开工第一步（按顺序）

1. **先请总经理确认云端 Codex 已经停手。** 两个 Agent 同时往同一个分支推送会冲突。没确认前只读、不推送。
2. 阅读以下文档：
   - `CLAUDE.md`、`AGENTS.md`、`docs/README.md`、`docs/quality/README.md`；
   - `docs/team/dev-environment-notes.md`（**本机环境的坑都在这里**）；
   - `main` 上的 `docs/status.md`；
   - 4 个 PR 分支上的 `docs/handoffs/2026-10-08-codex-T-042`～`T-045` 交接和对应任务卡。读法：`git show origin/<分支>:<路径>`，或 `gh pr view <编号>`。
3. 按 **#4 → #5 → #6 → #7** 合并：
   - 每合一个，看后一个是否需要同步 `main`，等 CI 通过后再合下一个；
   - 冲突在独立工作副本里解决，不在共享文件夹里处理；
   - 合并前只看 CI 结果，不在本机全量重跑（省额度）。
4. 合并完成后更新 `docs/status.md`，向总经理汇报。然后按 `docs/architecture/dev-plan.md` 继续推进剩余的 L2～L7，以 T-043～T-045 交接里的「遗留」为起点。剩余内容包括：
   - 向量检索、分层摘要、真实质量评测；
   - 账号设置的其余部分（账号安全、隐私、通用、主动消息）；
   - 人设广场、经期日记、共同领养宠物、5 个玩法、行为规划决策层（Jev 候选）、后台用量等。

### 四、必须遵守的规则（摘要，细则见上述文档）

- **共享文件夹 `C:\Users\lomjy3\Desktop\weiban` 始终停在 `main`，不切分支。** 开发一律用 `git worktree` 放在 `C:\wb-dev\` 下，路径短，可以避免 Windows「Filename too long」。
- 每个工作副本根目录必须有 `.env`（内容见环境守则）。**没有 `.env` 时，集成测试会整组静默跳过**。跑完必须核对「跳过 0 条」。
- 本机没有 Java 和安卓 SDK，安卓改动以 GitHub CI 的 Android job 为准。
- `docs/quality/` 归 Codex（质量负责人），你不改。只在总经理通知后代为提交，提交信息注明「QA docs (Codex)」。
- 接口以 `packages/contracts` 为准，改接口先写变更申请；重大决策写 ADR。
- 不缩减产品范围。不为了让检查通过而放宽断言、跳过测试、改门禁。
- 省额度：
  - 开发者交付前在本机只跑一次相关检查，之后以 CI 为准；
  - 总负责人合并前只看 CI；
  - 不用 Claude 内部的 `qa-lead` 做验收。
- 流程：
  - 代码任务：任务分支 → CI 通过 → `--no-ff` 合并 → 删除分支和工作副本；
  - 文档任务：直接提交到 `main`，前缀 `PM docs:`；
  - 停下前先把断点提交并推送。
- 需要真实 API 密钥、域名、服务器、真机、厂商推送的部分：用假上游完成，列为「待配置后验证」。
- **独立验收**：Codex 这几天写了大量代码，它的检查只算开发自测。产品完成后，提醒总经理安排**没参与开发的**复核者做整体验收。

### 五、已拍板的产品决定（不要再问）

- 成人模式：除儿童角色、以本人身份呈现的真人角色外均可开启。成人内容在同一角色内；不自动回退到主流模型。
- 真人角色：默认不生成本人照片，但提供上传入口。
- 分享图标注：「微伴AI聊天非本人，请谨慎识别」，并带 logo。
- 语音通话不提示费用；安全关怀允许透支，上限 2 元。
- 基于用户身边人的角色不能发布到广场。
- 主题：默认微信绿，可切换微伴粉，跨设备同步；「我 → 服务」为服务入口。
- 普通聊天摘要可以发给境外的 Jev。
- 其余裁定见 `docs/product/input/` 和 `docs/decisions/`。

### 六、本机小贴士

- 新开 PowerShell 先刷新 PATH：`$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")`
- 如果 `node`/`pnpm` 找不到，用环境守则里写的绝对路径。
- gh 在 `C:\Program Files\GitHub CLI\gh.exe`，已登录；git 凭据可用。
- 删除超长路径：`Remove-Item -LiteralPath ("\\?\" + 完整路径) -Recurse -Force`，然后执行 `git worktree prune`。
- 数据库在 Docker 容器 `weiban-dev-postgres` 里。跑生产镜像演练前先确认磁盘空间。

**现在请先向总经理简短汇报你读到的状态，并确认云端 Codex 已停手，然后开始合并 #4。**
