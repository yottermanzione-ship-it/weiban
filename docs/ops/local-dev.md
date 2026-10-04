# 本机开发说明（Windows 11）：装依赖、起停数据库、跑检查

> 负责人：运维负责人 · 最后更新：2026-10-04 · 来源任务：T-011（D-L0-01、D-L0-02）
> 读者：总经理（零基础）。前提：已按 `docs/ops/dev-env-setup.md` 装好 Node.js 24、pnpm 11、Docker Desktop。
> 软件版本以 `docs/decisions/ADR-0003-tech-stack.md`「版本基线」为准，本文只讲怎么用。

---

## 一句话

**第一次：`pnpm install` → 复制 `.env` → `pnpm db:up`。以后每天：`pnpm db:up` 起数据库，`pnpm check` 跑全部检查，用完 `pnpm db:down`。**

几个词：

| 词 | 通俗解释 |
|---|---|
| 依赖 | 项目用到的别人写好的代码包（零件）。`pnpm install` 按清单把它们下载到 `node_modules` 文件夹 |
| 数据库 | 存所有数据的地方。我们用 PostgreSQL 18，外加 pgvector 扩展（让数据库能做「按意思相近程度查找」，AI 记忆要用） |
| 容器 | Docker 里运行的一个「隔离的小电脑」。数据库就跑在容器里，不用在 Windows 上直接安装 PostgreSQL |
| 数据卷 | Docker 专门存数据的地方。容器删了重建，数据卷里的数据还在 |
| 检查 | 代码格式检查（Prettier）、代码规则检查（ESLint，含模块边界规则）、类型检查（TypeScript）、自动测试（Vitest） |

---

## 一、打开项目所在的 PowerShell（每次都从这里开始）

1. 打开文件资源管理器，进入项目文件夹 `C:\Users\lomjy3\Desktop\weiban`。
2. 在窗口上方的地址栏里点一下，输入 `powershell`，回车。会弹出一个已经位于项目文件夹的 PowerShell 窗口。
3. 下面所有命令都在这个窗口里输入，每行输完按回车。

> PowerShell 有时会把正常输出也显示成**红字**，并带有 `NativeCommandError` 字样（这是 Windows PowerShell 的老毛病）。判断成功与否看最后几行有没有 `ERROR`、`failed`、`exit code 1` 之类的字，以及本文写的「成功的样子」。

---

## 二、第一次使用（只做一次，约 5 分钟）

### 1. 确认 Docker Desktop 在运行

看屏幕右下角托盘有没有小鲸鱼图标；没有就从开始菜单打开 **Docker Desktop**，等它左下角显示绿色的 **Engine running**。

### 2. 安装项目依赖

```
pnpm install
```

成功的样子：最后一行类似 `Done in 12.3s using pnpm v11.28.4`。

- 第一次需要下载，可能要几分钟；网络报 `ETIMEDOUT`、`ECONNRESET` 就再执行一次，仍不行按 `dev-env-setup.md` 第五节换国内镜像。
- 如果提示 `This project requires Node.js ...`：Node 版本不对，项目锁定 Node 24，按 `dev-env-setup.md` 第四节安装。
- 如果提示 pnpm 版本不一致，pnpm 会自动下载项目要求的版本（项目锁定 pnpm 11.28.4），不用处理。

### 3. 生成本机配置文件 `.env`

```
Copy-Item .env.example .env
```

- `.env.example` 是模板（进仓库），`.env` 是你电脑上的实际配置（**不进仓库**，git 会自动忽略它）。
- 里面是数据库用户名、密码、端口，都是**只在本机使用的开发值**，数据库只允许本机连接。一般不用改。

---

## 三、起停数据库（日常）

### 1. 启动

```
pnpm db:up
```

成功的样子：最后一行 `Container weiban-dev-postgres  Healthy`。

- 第一次启动会下载数据库镜像（约 150 MB），需要几分钟。
- 第一次启动时还会自动做两件事：开启 pgvector 扩展；另建一个测试专用库 `weiban_test`（自动测试会随意清空它，不影响开发库）。
- 启动后**一直在后台运行**，关掉 PowerShell 也不影响；重启电脑后，只要 Docker Desktop 开着，它会自动重新运行。

### 2. 看状态

```
docker compose ps
```

`STATUS` 一列显示 `Up ... (healthy)` 就是正常。什么都没列出来说明没在运行，执行上一步启动。

### 3. 连进数据库看看（可选）

```
pnpm db:psql
```

会出现 `weiban=#` 提示符，表示已经连进数据库。可以试着输入：

```
\dx
```

能看到一行 `vector`，说明 pgvector 扩展已开启。输入 `\q` 回车退出。

### 4. 停止

```
pnpm db:down
```

成功的样子：显示 `Container weiban-dev-postgres  Removed`。

**数据不会丢**：数据存在名为 `weiban-dev-pgdata` 的数据卷里，下次 `pnpm db:up` 一切照旧。不开发时停掉可以省电脑内存（数据库约占 100～300 MB）。

### 5. 看数据库日志（排查问题时用）

```
pnpm db:logs
```

按 `Ctrl + C` 退出查看（数据库不会因此停止）。

### 6. 彻底清空数据库（危险，一般不要做）

只有当负责人明确要求「重建开发数据库」时才执行：

```
docker compose down -v
```

`-v` 表示**连数据卷一起删除**，开发库里的所有数据都会消失且无法恢复。之后执行 `pnpm db:up` 会得到一个全新的空数据库。

> 开发库里只有测试用数据，没有备份；生产数据库的备份与恢复是另一套（D-L0-14），与这里无关。

---

## 四、跑检查

| 命令 | 做什么 | 成功的样子 |
|---|---|---|
| `pnpm check` | **一次跑完下面全部四项**（推荐） | 最后没有 `ERR`，且测试部分显示 `passed` |
| `pnpm format` | 把代码自动排版整齐（会改文件） | 列出文件名，不报错 |
| `pnpm lint` | 代码规则检查，含模块边界规则 R1～R9 | 只显示 `$ eslint .`，没有其他输出 |
| `pnpm typecheck` | 类型检查 | 每个子项目都显示 `Done` |
| `pnpm test` | 自动测试 | `Test Files  N passed`、`Tests  N passed` |

- `pnpm check` 里的格式检查只「检查」不改文件；格式不对时先执行 `pnpm format` 再跑一次。
- 自动化测试服务器（CI，D-L0-03）以后会在每次提交时跑同样的命令。

---

## 五、常见问题

**Q：`pnpm db:up` 报 `port is already allocated` 或 `5432` 被占用？**
电脑上已有别的程序占用了 5432 端口（例如以前装过 PostgreSQL）。打开 `.env`（用记事本），把 `POSTGRES_PORT=5432` 改成 `POSTGRES_PORT=5433`，并把下面两个连接串里的 `:5432/` 也改成 `:5433/`，保存后重新 `pnpm db:up`。

**Q：报 `error during connect`、`cannot find the file specified`、`docker daemon is not running`？**
Docker Desktop 没有运行。打开它，等到 **Engine running** 再试。

**Q：`pnpm db:up` 一直等不到 `Healthy`，最后报错？**
执行 `pnpm db:logs` 看日志，截图发给项目总负责人。

**Q：改了 `deploy/dev/postgres-init/` 里的初始化脚本，为什么没生效？**
初始化脚本只在数据卷为空、第一次启动时执行。需要让它重新执行，就得按第三节第 6 步清空后重建（会丢开发数据）。

**Q：`pnpm install` 报 `ERR_PNPM_IGNORED_BUILDS`？**
某个新加的依赖想在安装时运行脚本，pnpm 出于安全默认拦下了。把报错截图发给运维负责人，由他在 `pnpm-workspace.yaml` 的 `allowBuilds` 里登记，**不要**自己执行 `pnpm approve-builds`。
