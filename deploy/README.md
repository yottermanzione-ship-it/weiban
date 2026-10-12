# deploy · 部署文件

负责人：运维负责人。

| 路径                 | 内容                                                                                           | 状态                           |
| -------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------ |
| `dev/postgres-init/` | 本机开发数据库首次初始化脚本（建测试库、开 pgvector 扩展），由根目录 `docker-compose.yml` 挂载 | 已建（T-011）                  |
| `prod/`              | 生产Compose/Caddy/镜像、秘密文件、加密备份与空卷恢复                                           | T-033 建立；真实节点待配置验证 |
| `local/`             | Windows 本机部署（见 `docs/ops/local-deploy.md`）                                              | 运行中                         |
| `hk/`                | 香港服务器仅 IP 试运行：覆盖配置、初始化、每日备份（见 `docs/ops/hk-server.md`）               | 2026-10-13 上线                |

本机开发数据库的使用方法见 `docs/ops/local-dev.md`。

操作手册见 `docs/ops/production-deploy.md`，密钥轮换见 `docs/ops/kek-rotation.md`。
