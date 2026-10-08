# 本机开发环境与工作守则（总负责人维护，2026-10-07）

给所有子代理看。先读这一页，再读你的任务卡和对应需求文档。

## 本机环境（Windows 11）

- 项目共享副本（**不要在里面开发、不要切分支**）：`C:\Users\lomjy3\Desktop\weiban`（始终停在 `main`）。
- 开发副本一律用 `git worktree`，放在 `C:\wb-dev\` 下（短路径，避免 Windows「Filename too long」）。
- Node / pnpm **不在系统 PATH 上**，必须用绝对路径调用：

```
$node = "C:\Users\lomjy3\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"   # v24.21.0
$pnpm = "C:\Users\lomjy3\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs"  # 11.28.4
& $node $pnpm install
& $node $pnpm check          # 格式 + lint + 边界 + 类型 + 测试 + 令牌，全仓
```

- 每次新开 pwsh 先刷新 PATH：
  `$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")`
- 数据库：Docker 里的 `weiban-dev-postgres` 已运行且健康（`docker ps`）。测试用真实 PostgreSQL，不要改成内存库或跳过。
  - **每个副本根目录必须有 `.env`**（不进仓库，`.gitignore` 忽略）。没有 `.env` 时，集成测试会**整组跳过**（本机曾出现「453 条里 220 条被跳过」的假象，CI 里是跑满的）。
  - 总负责人已于 2026-10-07 给每个副本写好 `.env`。如果你新建副本，自己复制一份：
    `POSTGRES_USER=weiban` / `POSTGRES_PASSWORD=weiban_dev_only` / `POSTGRES_DB=weiban` / `POSTGRES_PORT=5432`
    `DATABASE_URL=postgres://weiban:weiban_dev_only@127.0.0.1:5432/weiban`
    `TEST_DATABASE_URL=postgres://weiban:weiban_dev_only@127.0.0.1:5432/weiban_test`
    `PLATFORM_KEK_FILE=C:/wb-dev/secrets/dev-kek`（开发主密钥，共享一份即可）
  - 跑完测试**必须核对「跳过 0 条」**。有跳过就说明你的环境不对，不是测试通过。
- git / gh 可用（gh 已登录）。`gh` 在 `C:\Program Files\GitHub CLI\gh.exe`。
- **本机安卓环境（2026-10-08 总负责人实测更新，原文写「没有 Java、没有安卓 SDK」已过时）**：`java` = Temurin 21.0.12.1，`ANDROID_HOME=C:\android-sdk`，SDK 里有 `platforms/android-36`、`build-tools/35.0.0` 与 `36.0.0`，`~/.gradle` 已缓存 Gradle 8.13。**即环境看起来已齐，但总负责人没有实际跑过一次 gradle 构建，因此只能算「看起来能用」，不能当作已验证。**
- **安卓改动一律以 GitHub CI 的 Android job 为准**（总经理 2026-10-08 决定）：CI 跑在 GitHub 云端，**不消耗 Claude 额度**；本机跑安卓需要额外装环境、调问题，反而更费额度。需要本机验证安卓时先报告，不要假装跑过。
- 32GB 内存、12 核、C 盘约 356GB 可用。

## 硬性规则

1. **只在分配给你的 worktree 和分支上工作。** 不切共享副本的分支，不动别人的 worktree，不强推，不合 `main`。
2. **接口以 `packages/contracts` 为准。** 改接口要先在 `docs/handoffs/` 写变更申请再改，并同步更新契约版本与生成物。
3. **不改 `docs/quality/`**（归 Codex 质量负责人）。
4. **重大技术决策写 ADR**，放 `docs/decisions/`。
5. **不缩减产品范围**，不为了让检查通过而放宽断言、加超时、跳过测试、改门禁。
6. 交付前在**本机只跑一次**相关检查确认通过；之后以 GitHub CI 为准，不要反复跑全仓检查（省额度、省时间）。
7. 提交信息用中文，末尾加你自己的署名行，例如 `Co-Authored-By: Claude <noreply@anthropic.com>`。
8. **写完就提交并推送**，防止额度中断丢进度。推送后读一次 CI 结果。
9. 每一步都要能复现：写清楚你跑了什么命令、结果如何、哪些**没有**验证。
10. **不要夸大**：模拟/夹具/单元测试不等于真机、真实供应商、真实操作系统行为。没验证的写「未验证」。

## 交付格式（交给总负责人）

- 做了什么、改了哪些文件（按目录归类）。
- 追加/修改了哪些文件。
- 跑了哪些命令、实际结果（测试数量、通过/失败、退出码）。
- 未验证或未完成的部分。
- 遗留问题与建议下一步。
- 分支名、提交 SHA、是否已推送、CI 结论。

## 当前产品进度速览

- L0（底座：账号、计费、模型网关、媒体、角色库、网页、后台、部署、协议向量、安卓底座）已完成开发自测。
- L1（聊天链路：实时同步、聊天存储、好友、AI 回复、推送、两端客户端聊天）大部分完成，T-041 收尾中。
- L2～L7 未开始。产品未完成，未做独立质量验收。

## 2026-10-08 Codex 云端临时接手

总经理明确改为先以 GitHub 为准，云端执行 #1 Windows 一致性 → #3 L2 记忆与人设 → #2 T-041 服务端整链路 → #4 Android 推送，串行开发，角色为开发者。上述 Windows 环境是历史记录；总经理说明本机已安装 JDK21/SDK，但云端没有访问本机验证，也未比对 C:\wb-dev\wb 中尚未推送的环境文件。不得称未提交成果已恢复。

云端每个任务另建 /workspace/wb-fix、wb-l2、wb-t041、wb-android 独立副本，不改 /workspace/weiban 共享副本；测试库分别为 weiban_test_fix、weiban_test_l2、weiban_test_t041、weiban_test_pm，连接云端现有 PostgreSQL 18+pgvector 的 127.0.0.1:55432，每个副本的 .env 不入 Git。日志统一 /workspace/logs/，文件名带 wb-fix / wb-l2 / wb-t041 / wb-android 前缀，不写 /tmp。

Node 当前 24.19.0；pnpm 固定 11.28.4，通过 `pnpm --package=pnpm@11.28.4 dlx pnpm <命令>` 调用工程指定版本。缺离线元数据时按正常网络安装，不关闭供应链检查、不改锁文件或降版本。各任务交付跑一次相关完整检查，失败修正后才按需要重跑；不得把缺数据库导致的跳过记为通过。所有新增代码的检查是开发自测，独立验收由总经理另行安排。当前授权不包含合并 main。
