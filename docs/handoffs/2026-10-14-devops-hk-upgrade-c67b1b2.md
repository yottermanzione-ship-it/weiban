# 交接说明：香港服务器升级到 local/trunk c67b1b2（迁移 0090）

| 项 | 内容 |
|---|---|
| 负责人 | devops-lead |
| 日期 | 2026-10-14 |

## 做了什么

结论：香港服务器已升级到 `c67b1b2`，内容包括启动页、微信式登录页、通讯录、添加朋友和角色广场、申请制作，以及后台「制作申请」菜单。数据库迁移 `0090_plaza_official_role_requests` 已执行，基本确认全部通过。本机部署没有碰。

- **升级前加密备份**：`/srv/weiban/backups/weiban-20261013T201907Z-UdIs3t`，sha256 校验 OK。
- **回滚准备**：旧镜像打标签为 `rollback-6f77bf9`，旧源码保留在 `/srv/weiban/src-6f77bf9`；`src-16ebced` 已删除。
- **新镜像**：app `sha256:38f7fb4e58ef…`，edge `sha256:2a3a5962668b…`。
- **检查结果**：
  - `/health` 正常，契约版本 3.5。
  - 公网首页、`/login`、主脚本都返回 200。
  - 后台 `/role-requests` 页返回 200。
  - 管理员登录、`/me`、退出均通过。
  - `GET /admin/role-requests` 返回 200，字段为 items、nextCursor、pendingCount；`GET /admin/role-requests/config` 返回 200，字段为 enabled、pointsCost、maxOpenPerUser。
  - 没有调用 AI，没有创建账号。
  - 检查用的隧道是我自己开的，用完只结束了这一个 ssh 进程。
- **版本记录**：`/srv/weiban/deployment-version.txt` 已更新，上一版另存为 `deployment-version.prev-6f77bf9.txt`。

## 改了哪些文件

- 仓库内：只有本交接说明。
- 服务器：源码目录、镜像、回滚标签、版本记录。

## 遗留问题

- 「启动页 → 登录页」的跳转是在浏览器里完成的，这次只确认了页面和脚本能下载，没有在浏览器里实际看跳转效果。
- 0090 改了数据库结构，所以回滚不能只换旧镜像，必须先恢复上面那份升级前备份。
- 宝塔面板、`hatch` 钥匙、root 密码登录的问题仍未处理（见 `2026-10-13-devops-sub2api.md` 第 4 节）。

## 需要总经理决定的事

- 同前：宝塔、陌生钥匙、密码登录是不是您本人所为，以及是否同意禁用 SSH 密码登录。

## 给其他负责人的交接

- 给项目总负责人：香港服务器现在是 c67b1b2，迁移到 0090。
