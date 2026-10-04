# T-007 开发环境安装说明（Node.js、Docker Desktop）

| 项 | 内容 |
|---|---|
| 负责人 | devops-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-04 |
| 状态 | 进行中 |

## 目标

总经理能照着一步步在 Windows 11 上装好开发所需软件，装好后可以开始 D-L0-01 仓库骨架。

## 背景

技术栈已定（`docs/decisions/ADR-0003-tech-stack.md`）：Node.js 24、pnpm、Docker Compose（PostgreSQL 18 + pgvector）。总经理电脑目前只装了 git（2.56，已配置）。总经理技术基础弱，上次装 git 时一路点了 Next，所以每一屏怎么选必须写清楚。

## 输入文档

- `docs/decisions/ADR-0003-tech-stack.md`
- `docs/architecture/repo-structure.md`
- `docs/architecture/dev-plan.md`（D-L0-01、D-L0-02）
- `docs/ops/git-setup.md`（参考写法）

## 范围

- 可以改：`docs/ops/` 下新建文档
- 不可以改：其他目录；不替总经理安装任何软件；不执行 git 命令

## 验收标准

- [ ] `docs/ops/dev-env-setup.md`，面向零基础：
  - Node.js 24 LTS：下载地址（官网 + 国内镜像）、安装选项、验证命令
  - pnpm：推荐的安装方式（如 corepack）、验证命令；国内网络下的 npm 镜像配置（可选，说明利弊）
  - Docker Desktop：系统要求（WSL 2、BIOS 虚拟化）、怎么检查和开启、安装选项、首次启动注意事项（是否需要登录账号）、验证命令；占用资源的提醒
  - 每一步怎么判断成功、常见报错怎么办
  - 结尾一张「装完自查清单」，总经理把各验证命令的输出贴给总负责人即可
- [ ] 说明哪些软件可以先不装（如 Android Studio 留到安卓阶段）
- [ ] 通俗解释 Node.js、pnpm、Docker 分别是做什么的

## 交付物

- `docs/ops/dev-env-setup.md`
- 交接说明：`docs/handoffs/2026-10-04-devops-lead-T-007.md`
