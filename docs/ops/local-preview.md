# 本机预览环境（2026-10-18）

> 用途：总经理点界面、逐条核对 UI 批注。**不是生产，数据可随时丢弃。**
> 本机不装 Docker：数据库用香港服务器上的临时库 DR-001，通过 SSH 隧道连过来。

## 一、怎么打开

| 项 | 值 |
|---|---|
| 用户端 | <http://localhost:5173> |
| 管理后台 | 未启动（本次只做用户端 UI） |
| 账号 | `weiban_admin` |
| 密码 | 见 `C:\wb-dev\secrets\dev-admin-password.txt`（不写进仓库） |

首次登录会要求填昵称，随便填即可。

**角色生态页**：登录后 → 我 → 服务 → **角色生态**（`/services/ecology`）。

## 二、这套环境是什么

| 部件 | 说明 |
|---|---|
| 数据库 | 香港 `weiban-dryrun-postgres`（DR-001），已跑完全部 91 个迁移，含 9 个预设角色 |
| 隧道 | `ssh -L 5433:127.0.0.1:5433 root@103.231.58.124`，带 15 秒心跳 |
| 服务端 | 本机 `tsx watch`，`127.0.0.1:3000`，`APP_ROLE=web` |
| 网页 | 本机 Vite，`127.0.0.1:5173`，`/api` 代理到 3000 |

## 三、现在**不能**做的事

1. **AI 不会回复**：没有模型目录、没有供应商密钥，服务端也以 `APP_ROLE=web` 启动（不跑后台任务）。
   点开聊天能看界面、看历史，但发消息不会有 AI 回复。
2. **主动消息、朋友圈自主生成不会运行**：后台任务没启动。
3. **管理后台没开**：需要时另起。
4. 数据写进香港临时库，**不是线上**。可以随便点、随便删。

## 四、启动 / 停止

启动（三步，顺序不能乱）：

```bash
# 1. 香港临时库
ssh -i ~/.ssh/weiban_deploy root@103.231.58.124 "cd /srv/weiban/src && docker compose -p weiban-dryrun -f deploy/hk/dryrun-compose.yml up -d --wait"

# 2. 隧道（保持窗口开着）
ssh -i ~/.ssh/weiban_deploy -N -L 5433:127.0.0.1:5433 -o ServerAliveInterval=15 root@103.231.58.124

# 3. 服务端与网页
DATABASE_URL=postgres://dryrun:dryrun_local_only@127.0.0.1:5433/weiban_dryrun \
PLATFORM_KEK_FILE=C:/wb-dev/secrets/dev-kek APP_ROLE=web DATABASE_POOL_MAX=3 \
MEDIA_DISK_ROOT=C:/wb-dev/media MEDIA_PUBLIC_BASE_URL=http://127.0.0.1:3000 ALLOW_LOCAL_HTTP=1 \
pnpm --filter @weiban/server dev

pnpm --filter @weiban/web dev
```

停止：`Ctrl+C` 两个 dev 进程；隧道窗口关掉；临时库可 `stop`（卷保留）。

## 五、踩过的坑

- `APP_ROLE=all` 时 pg-boss 会在启动阶段反复连库超时（跨境隧道 + 连接池），导致服务起不来；用 `APP_ROLE=web` 绕开。
- `DATABASE_POOL_MAX` 调小到 3，减少隧道并发连接。
- 登录接口必须带完整 `device`（deviceId / name / platform / appVersion / timeZone），少一个字段就 400。
