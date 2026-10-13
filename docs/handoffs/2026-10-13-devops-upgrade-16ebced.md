# 交接说明：香港服务器与本机部署升级到 local/trunk 16ebced

| 项 | 内容 |
|---|---|
| 负责人 | devops-lead |
| 日期 | 2026-10-13 |

## 做了什么

结论：两处都已升级到 `16ebced`。这一版的改动是：内置宠物图按 Accept 返回 WebP 或 PNG，会话列表也返回隐藏会话。没有新迁移，数据库仍为 0087。两处都做了基本确认：健康检查正常、契约版本 3.2，用户首页和后台首页都返回 200，管理员能登录、读取 `/me`、退出。没有跑测试，没有调用 AI。

| | 香港服务器 | 本机 weiban-local |
|---|---|---|
| 升级前加密备份 | `/srv/weiban/backups/weiban-20261013T025226Z-Z5IcW1` | `C:\wb-local\backups\20261013-105236-c45ef406a5204d8db2b1a5eca01f9419` |
| 回滚镜像 | `weiban-app/edge:rollback-2c2dd73`，旧源码在 `/srv/weiban/src-2c2dd73` | `weiban-app/edge:rollback-2c2dd73` |
| 新 app 镜像 | `sha256:c5b5b66abeae…` | `sha256:5ebec09a9c08…` |
| 版本记录 | `/srv/weiban/deployment-version.txt`（上一版另存为 `deployment-version.prev-2c2dd73.txt`） | `C:\wb-local\deployment-version.txt`（上一版另存在 `deployment-history\pre-trunk-16ebced-20261013.json`） |

数据库结构没有变化，所以回滚只需换回旧镜像，不用恢复数据。服务器上更早的 `/srv/weiban/src-cafa849` 已删除。香港后台通过我自己开的隧道检查，检查完只结束了这一个 ssh 进程。本机日志：`C:\wb-dev\closeout-logs\trunk-16ebced-local-{build,upgrade}-round1.log`。

## 改了哪些文件

- 仓库内：只有本交接说明。
- 仓库外：两处的版本记录、备份目录和回滚镜像标签，以及服务器上的源码目录。

## 遗留问题

- 宠物图返回 WebP/PNG 和隐藏会话这两项改动，都没有在浏览器里实际验证。

## 需要总经理决定的事

无

## 给其他负责人的交接

- 给项目总负责人：两处都是 16ebced，迁移仍为 0087。
