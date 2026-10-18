# 香港服务器临时验证库（dry-run）

> 2026-10-17 总经理决定：本机不再使用 Docker，数据库验证改在香港服务器做。
> 服务器当时无真实用户，允许占用其资源；但仍必须与生产库严格隔离、可一键清理。

## 一、它是什么

服务器上另起的一套**临时 PostgreSQL**，只用来做两件事：

1. 部署前把 `apps/server/drizzle/` 的迁移脚本按顺序跑一遍（目前欠 0091～0102 共 12 个）；
2. 跑需要真实数据库的集成测试（`pnpm test` 里的 PG 部分）。

**它不是第二个站点**：没有网页、没有接口、没有 AI，跑完就停。日常用户访问的仍然是生产环境 `http://103.231.58.124`。

## 二、分区（四层隔离，互不干扰）

| 层面 | 生产 | 临时验证 | 隔离方式 |
|---|---|---|---|
| compose 项目 | `weiban-prod` | `weiban-dryrun` | 项目名不同，容器/网络互不可见 |
| 容器 | `weiban-prod-postgres-1` | `weiban-dryrun-postgres` | 固定容器名，`docker ps` 一眼可分 |
| 数据卷 | `weiban-prod_pgdata` | `weiban-dryrun-pgdata` | 独立卷，删临时卷不影响生产数据 |
| 端口 | 不对外暴露 | `127.0.0.1:5433` | 只绑回环，公网访问不到 |
| 库名 | `weiban` | `weiban_dryrun` / `weiban_dryrun_test` | 库名带 `dryrun` 前缀 |
| 凭据 | 密钥文件 `/run/secrets` | 固定弱口令 `dryrun_local_only` | 与生产密码无关 |

资源硬限制：`mem_limit: 1g`、`cpus: 1.0`，`restart: 'no'`（不随开机自启）。服务器 4 核 8G，与生产应用共存。

配置文件：[`deploy/hk/dryrun-compose.yml`](../../deploy/hk/dryrun-compose.yml)、初始化脚本 [`deploy/hk/dryrun-init/01-init.sql`](../../deploy/hk/dryrun-init/01-init.sql)。

## 三、命令（在服务器上，root）

先设一个简写，避免每次打长串：

```bash
cd /srv/weiban/src
DR="docker compose -p weiban-dryrun -f deploy/hk/dryrun-compose.yml"
```

| 操作 | 命令 |
|---|---|
| 启动（首次会自动建库、装 pgvector） | `$DR up -d --wait` |
| 查看状态 | `$DR ps` |
| 看日志 | `$DR logs -f --tail 100 postgres` |
| 停止（保留数据） | `$DR stop` |
| **彻底清理（删库删卷）** | `$DR down -v` |
| 进 psql | `docker exec -it weiban-dryrun-postgres psql -U dryrun -d weiban_dryrun` |

清理后确认干净（三条都应为空）：

```bash
docker ps -a --filter name=weiban-dryrun
docker volume ls --filter name=weiban-dryrun
docker network ls --filter name=weiban-dryrun
```

## 四、从本机连接（不开本机 Docker）

数据库只监听服务器回环，本机通过 SSH 隧道使用。PowerShell 窗口保持打开：

```powershell
ssh -i ~/.ssh/weiban_deploy -N -L 5433:127.0.0.1:5433 root@103.231.58.124
```

然后在项目根目录（本机）临时指定测试库地址：

```bash
TEST_DATABASE_URL=postgres://dryrun:dryrun_local_only@127.0.0.1:5433/weiban_dryrun_test pnpm test
```

> 注意：只在单条命令前临时加环境变量，**不要写进 `.env`**，否则以后容易误连。

## 五、跑迁移

两种方式，推荐第一种（不依赖本机环境）：

**A. 在服务器上跑**（用已部署镜像里的迁移命令，最接近真实部署）：

```bash
$DR exec -T postgres pg_isready -U dryrun -d weiban_dryrun
docker run --rm --network weiban-dryrun_default \
  -e DATABASE_URL=postgres://dryrun:dryrun_local_only@postgres:5432/weiban_dryrun \
  weiban-app:local node dist/migrate.js up
```

**B. 在本机跑**（需要隧道已开，使用仓库代码）：

```bash
DATABASE_URL=postgres://dryrun:dryrun_local_only@127.0.0.1:5433/weiban_dryrun pnpm --filter @weiban/server db:migrate
```

回滚验证用 `db:rollback`，只允许在临时库执行。

## 六、登记表

每开一次登记一行；清理后补「已清理」和日期。**同一时间只允许存在一套临时环境。**

| 编号 | 用途 | 创建日期 | 负责人 | 状态 | 清理日期 | 备注 |
|---|---|---|---|---|---|---|
| DR-001 | 迁移 0091～0102 空库演练 + PG 集成测试 | 2026-10-17 | 总负责人 | 使用中 | — | 首次启用，详见下方演练记录 |

### DR-001 演练记录（2026-10-17）

环境：香港 `weiban-dryrun-postgres`，PostgreSQL 18 + pgvector 0.8.7，容器健康，端口仅 `127.0.0.1:5433`。

1. **空库全量迁移通过**：从空库执行 91 个迁移（0001～0102），全部成功，含此前从未执行过的 0091～0102。
2. **最后两个迁移可回滚可重放**：`0102_billing_prehold`、`0101_model_billing_bounds` 回滚成功，重新执行成功。
3. 生产库未参与任何一步；生产容器 `weiban-prod-postgres-1` 全程未重启。
4. **迁移测试通过**：`test/migrations.test.ts` 6/6（含“执行 → 回滚 → 再执行”完整循环，耗时 80.6s；迁移只增不改、失败整体回滚）。
5. **计费集成测试未跑完**：`test/billing.test.ts` 的 `beforeAll` 需先清库再跑 91 个迁移，经跨境 SSH 隧道耗时超过 vitest 的 120s 钩子上限，27 个用例全部跳过。这是**网络延迟导致的环境限制，不是用例失败**；迁移链本身已由第 1、2、4 条证明。该套件需在低延迟环境（CI 或本机库）补跑。
6. 隧道使用 `ServerAliveInterval=15` 保持；首次未加心跳的隧道在 43 分钟后被对端重置，长任务需注意。

结论：迁移链在全新 PG 18 上可完整建立，`0101/0102` 的 up/down 脚本可执行。**这不等于生产库可直接升级**——生产库是已有数据的库（当前 0090），真实数据上的迁移仍需先备份、再按 `hk-server.md` 的升级流程执行。

## 七、禁止事项

1. 不得把 `weiban-prod` 的库名、卷名、网络名写进 dry-run 配置；
2. 不得把 5433 改成 `0.0.0.0` 绑定或对公网开放；
3. 不得在临时库上跑会写入真实资金/真实用户数据的脚本（临时库只做结构与逻辑验证）；
4. 不得把临时库当作线上环境给用户访问；
5. 用完不停机不得超过 24 小时；超过则先 `stop`。
6. 迁移演练通过 ≠ 可以在生产直接执行；生产执行前仍须先手动备份（见 [`hk-server.md`](hk-server.md)）。
