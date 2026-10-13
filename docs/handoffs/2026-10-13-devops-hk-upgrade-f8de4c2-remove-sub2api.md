# 交接说明：香港服务器拆除 sub2api，并升级到旧版界面还原 / 积分制 / 上游账号池

| 项 | 内容 |
|---|---|
| 负责人 | devops-lead |
| 日期 | 2026-10-13 |

## 做了什么

结论：只动了香港服务器，本机 weiban-local 没有碰。sub2api 已全部拆除。微伴已升级到 local/trunk `6f77bf9`（业务代码为 `f8de4c2`，外加本次拆除 sub2api 的运维提交），数据库迁移到 0089。基本确认全部通过。

1. **升级前加密备份**：`/srv/weiban/backups/weiban-20261013T131354Z-t8ZlhV`，三份文件的 sha256 都校验 OK（这份里还带着最后一份 sub2api 的 dump）。
2. **拆除 sub2api**：拆之前查过库，里面只有部署时自动生成的管理员，合规承诺未确认，没有上游账号，也没有 Key，所以不涉及总经理录入的数据。
   - 已删除：sub2api、sub2api-postgres、sub2api-redis 三个容器，`sub2api_default` 网络，数据目录 `/srv/weiban/sub2api`，内部网络 `weiban-llm`（微伴 app 重建后已不在其中），三个镜像，以及 `/srv/weiban/secrets/sub2api-admin.txt`（shred）。
   - 仓库内：删除 `deploy/hk/sub2api/`；`deploy/hk/compose.override.yml` 去掉 `llm` 网络；`deploy/hk/backup.sh` 去掉 sub2api 那一项；`docs/ops/hk-server.md` 去掉 sub2api 一节，第一节补上微伴后台的桌面快捷方式模板。
   - 之前的备份里还留有 `sub2api.dump.age`，会随 7 份轮换自动淘汰。
3. **升级**：
   - 旧镜像打标签为 `rollback-16ebced`，旧源码保留在 `/srv/weiban/src-16ebced`；`src-2c2dd73` 已删除。
   - 新源码在服务器上构建，`up -d --wait` 执行了迁移 `0088_points_rates`、`0089_upstream_pool`。
   - 新 app 镜像 `sha256:db81502f8f70…`，edge 镜像 `sha256:643da981a906…`。
4. **检查结果**：
   - `/health` 正常，契约版本 3.4。
   - 公网首页 200，后台 `/model`（模型管理）页 200。
   - 管理员登录、`/me`、退出均通过。
   - MiMo 在后台都还在：上游 `mimo` 状态为 active，目录和模型列表里都有「MiMo V2.6 Flash」。
   - 0089 生成了账号池路由：`xiaomi/mimo-v2.6-flash → mimo`，上游模型 `mimo-v2.6-flash`，优先级 1，权重 100，已启用。
   - 没有调用 AI，没有创建账号。
   - 检查用的是我自己开的隧道，用完只结束了这一个 ssh 进程。
5. **版本记录**：`/srv/weiban/deployment-version.txt` 已更新，上一版另存为 `deployment-version.prev-16ebced.txt`。

## 改了哪些文件

- 仓库：`deploy/hk/compose.override.yml`、`deploy/hk/backup.sh`、`docs/ops/hk-server.md`、删除 `deploy/hk/sub2api/*`、本交接
- 服务器：见上文

## 遗留问题

- 0088 和 0089 改了数据库结构，所以回滚不能只换旧镜像，必须先恢复上面那份升级前备份。
- 宝塔面板、`hatch` 钥匙、02:11 那次 root 密码登录仍未处理，等总经理确认。详见 `2026-10-13-devops-sub2api.md` 第 4 节。
- 积分制和模型管理的新页面没有在浏览器里实际点过。

## 需要总经理决定的事

- 同上一份交接：宝塔、陌生钥匙、密码登录是不是您本人所为，以及是否同意禁用 SSH 密码登录。

## 给其他负责人的交接

- 给项目总负责人：香港服务器现在是 6f77bf9，迁移到 0089，sub2api 已清理干净。本机部署按总经理要求不再更新。
