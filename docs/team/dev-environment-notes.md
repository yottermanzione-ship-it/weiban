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
- **本机没有 Java、没有安卓 SDK**（`java`、`ANDROID_HOME` 都没有）。安卓的原生构建/单元测试在本机暂时跑不了，安卓改动以 **GitHub CI 的 Android job** 为准；需要本机验证安卓时先报告，不要假装跑过。
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
