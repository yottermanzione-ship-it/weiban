# 交接说明：香港服务器与本机部署升级到 local/trunk 2c2dd73

| 项 | 内容 |
|---|---|
| 负责人 | devops-lead |
| 日期 | 2026-10-13 |

## 做了什么

结论：两处都已升级到 `2c2dd736286005f15f565606f2f608c10cfe0a22`，包含网页换壳、契约 3.2 和迁移 0084～0087。两处都通过了健康检查、管理员登录和用户端首页检查，没有创建账号，也没有调用 AI。

**香港服务器 103.231.58.124**（按 `docs/ops/hk-server.md` 的流程）

- 升级前加密备份：`/srv/weiban/backups/weiban-20261012T225658Z-pxlV7f`
- 回滚准备：旧镜像打标签为 `weiban-app:rollback-cafa849` / `weiban-edge:rollback-cafa849`，旧源码保留在 `/srv/weiban/src-cafa849`。
- 新源码用 `git archive 2c2dd73` 生成，解压到 `/srv/weiban/src` 后在服务器上构建。`up -d --wait` 顺序执行了 0084、0085、0086、0087 四个迁移，最新为 `0087_scenario_presets_ai`。
- 新镜像：app `sha256:0077fede41a5…`，edge `b87555943190`。
- 检查结果：`/health` 正常，contractVersion 3.2。公网首页 200，标题「微伴」。通过自己开的隧道访问 localhost:9081，后台首页 200，管理员 admin 登录、`/me`、退出均通过。隧道用完已关闭。
- 版本记录：`/srv/weiban/deployment-version.txt`，文件权限 600。

**本机 weiban-local**

- 升级前加密备份：`C:\wb-local\backups\20261013-065759-0ba1c361762e4c14ac950c70949aa5cc`，由 `Backup-Weiban.ps1` 生成，备份时带了 `-AgeExecutable`。
- 回滚准备：旧镜像打标签为 `weiban-app:rollback-314ca3e` / `weiban-edge:rollback-314ca3e`。
- 在 `C:\wb-dev\wb-int`（2c2dd73，工作区干净）里构建后执行 `up -d --wait`，迁移 0084～0087 已执行，最新为 0087。
- 新镜像：app `sha256:8df2b4b84faf…`，edge `sha256:5bc93385e0e3…`。
- 检查结果：8080/8081 的 `/health` 都返回 200，契约版本 3.2。用户首页 200，后台首页 200，管理员登录、`/me`、退出均通过。
- 版本记录：`C:\wb-local\deployment-version.txt` 已更新，旧记录保存在 `C:\wb-local\deployment-history\pre-trunk-2c2dd73-20261013.json`。
- 日志：`C:\wb-dev\closeout-logs\trunk-2c2dd73-local-build-round1.log`、`trunk-2c2dd73-local-upgrade-round1.log`。

## 改了哪些文件

- 仓库内：只有本交接说明，没有改代码。
- 仓库外：两处的版本记录、备份目录、回滚镜像标签，以及服务器上的 `/srv/weiban/src`（旧版本改名为 `src-cafa849`）。

## 遗留问题

- 开工时本机 Docker Desktop 没有运行，所以本机部署当时是停着的。我启动 Docker Desktop 后容器自动起来了，之后才做的备份和升级。电脑重启后需要确认 Docker Desktop 会随开机自动启动。
- 迁移 0084～0087 改变了数据库结构。如果要回滚，不能只换回旧镜像，必须先恢复本次升级前的备份。
- 没有跑测试套件，没有用浏览器点击检查换壳后的页面，没有调用 AI。
- 这次只结束了我自己开的隧道进程，没有动其他 ssh 进程。

## 需要总经理决定的事

无

## 给其他负责人的交接

- 给项目总负责人：两处现在都是 2c2dd73，迁移到 0087。两边数据仍然各自独立。
