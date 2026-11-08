# 双盘容量与打包缓存

本任务不属于旧站数据迁移。总经理已明确两块盘均可用于微伴，按剩余容量和增长需求安排目录，不再把用途硬分成“系统盘”和“数据盘”。

## 实施方案

- 当前50G盘尚余约28GiB，40G盘尚余约16GiB。40G盘的默认构建缓存约13.43GB，是本轮主要空间来源；用户数据约4.5GB，不为本任务搬动。
- 新建 weiban-release 独立BuildKit，将其管理卷绑定至50G盘 /var/lib/weiban-build-cache；验证卷身份和实际文件系统，拒绝静默回落到原盘。
- 新缓存保留4GiB，旧默认缓存保留1GiB；新缓存内置GC，30分钟定时回收及发布后按容量回收。活跃构建可暂超预算，完成后回收；不是硬磁盘配额。
- 新构建最多使用2核/4GiB内存，保留12GiB可用磁盘；不会因此暂停现有聊天服务。
- 当前及两次回退程序镜像继续保留。只清理Docker认定可回收的构建缓存，不执行卷、容器或整机清理。
- 定时维护只在Docker已经运行时执行，不通过服务依赖启动Docker；主动停服时跳过，避免干扰后续迁移维护。
- 维护命令开始时检查备份服务的 ActiveState，启动/执行/停止中或状态无法确认时跳过。Type=oneshot 的执行期间为 activating，不能只用 is-active 判断。该检查用于避让，不替代迁移的全写入者停写：检查后才启动的备份仍可能短时重叠；本任务不改变备份原有锁与启动顺序。

## 发布与恢复

固定提交通过检查及 Assert-ReleaseSource.ps1 后，单独安装运维运行副本和构建环境，不修改应用 src 或版本清单，不运行应用发布、数据库迁移或重启Docker。

安装入口为 bash deploy/hk/build-cache.sh install <完整源码目录> <完整提交>。新发布脚本读取 /srv/weiban/ops-state/build-cache.env，显式选择新builder；安装同时将本机当前builder设为 weiban-release，承接旧手工构建。确认微型Compose构建实际加载到原镜像存储后，才回收旧缓存。

恢复时先停止 weiban-build-cache.timer，重新选择 default 构建器并移开上述启用配置，再切回前一运维槽；这些步骤仅恢复打包/维护路径，不需要回滚或重启正在服务的应用。缓存卷保留供核查，不自动删除。

正式执行与容量、健康检查结果待追加；旧站迁移仍只做阅读和计划，不自动切站。

## 参考

- [Docker容器构建驱动及命名状态卷](https://docs.docker.com/build/builders/drivers/docker-container/)
- [构建缓存回收与容量规则](https://docs.docker.com/build/cache/garbage-collection/)
- [BuildKit配置](https://docs.docker.com/build/buildkit/toml-configuration/)
- [Compose显式选择构建器](https://docs.docker.com/reference/cli/docker/compose/build/)
