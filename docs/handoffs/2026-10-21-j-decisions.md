# J 决策模型接续交接（2026-10-21）

任务：第四轮第五轮补充的 J（见 `docs/tasks/2026-10-21-gm-feedback-4.md`），实测授权来自第三轮 G4-5。独立目录 `C:\wb-dev\wb-decision-j`，分支 `codex/decision-j`，基于 S 完整提交 `e3ceff2c5534b48196dc030452a50c7e528b2615`；`git merge local/trunk` 返回 Already up to date。未动共享 main，未 push、合并主线或部署。

## 交付

1. 修复原推测 `/v1/judge`：已有 B.AI 共享上游仍保持 `openai_compatible`，仅在决定调用中走其 `/decisions`；原生 `jev` 协议走 `/v1/systemone`，兼容 base 带 / 不带 v1。没有切换线上账号协议，避免影响它的其它聊天模型。
2. 正确组装 question ID map、instructions、Choice criteria、Noul、Score；按 ID 解析，验证选项集合、概率分布和非负 token 用量。不再拿「state 字符数的一半」当实际用量。Noul 映射 yes/no 与 `abs(2p-1)` 的本地决策裕量；Choice / Score 使用供应商 confidence。旧端口只有离散 choice，Scale 返回概率最高的等级索引，不伪装成连续 score。
3. 已知拒绝为零成本，网络丢失 / 畸形成功响应 / 5xx 等保留未知成本；B.AI 400 的额度错误和无正文 429 正确归类，不回显供应商错误正文。单次尝试，没有供应商幂等保证时不自动重试。
4. 网关开始时检查 deadline，并在计费准备后、实际发送前重新计算剩余时间；已过期不发请求。无效问题在冻结前拒绝，Scale 级数恢复传递。响应体最多 2MB、请求最多 32KB、不跟重定向。日常路由、计费入口和规则回退继续沿用。
5. 新增有显式运行开关的 `evaluate-decisions` 命令（构建入口已登记）：只读连接，指定两个模型、合成场景、最多 28 请求、固定白名单输出。未启动 Nest 应用或 worker。命令返回失败时退出非零；不能把进程退出零当成业务样本标签正确。
6. 真实容器内先 4 次冒烟，再 28 次完整代表性调用，32 次均成功。固定版 / latest 实际都返回 jev-1.13.0；公开动态与海报语义题低置信度，保留反例。实际执行源码为 `96bec71e7a068ceaa85430c59ff920853c84ea89`；后续加严的防御分支由本地回归验证，未重复付费调用。

详见 [实测报告及原始白名单证据](../ai/eval-runs/2026-10-21-planner-jev.md) 与 [25 号生态方案](../refactor/25-jev-ecology-decisions.md)。报告含每条线路耗时、token、标准标签对照、失败切换门槛和未验范围。后续按生态唤醒生成动态动作候选，由代码检查权限 / 费用 / 缓存，Jev 做窄语义判断；本批没有启用 H4 / P3 或更改全局置信度门槛。

## 验证证据

日志在 `C:\wb-dev\logs\j-*.txt`。最终检查已通过，见以下日志；不运行本机 Docker，没有迁移 / 契约改动，没有新增测试套件或依赖，也没有 UI 改动。

- `j-tests-final.txt`：现有 model-access rules 套件 **27 条通过**，包含新协议、错误 / 成本未知、deadline 在准备时过期回归。
- `j-di-final.txt`：只选完整 AppModule 依赖图装配用例，**1 条通过、10 条未运行**；不启动数据库 / 任务，其余数据库用例不代表通过。
- `j-types-final.txt`、`j-lint-final.txt`、`j-boundaries-final.txt`、`j-build-final.txt`：最终服务端类型、本批 lint、模块依赖边界（430 模块 / 1925 依赖）、生产构建均通过。
- 新证据 JSONL 统一 LF 并登记 SHA256。格式检查（`j-format-check.txt`）与 `git diff --check` 通过。
- 没有重跑无关 Web / Admin / Android 构建。全仓 lint 仍有 S 交接已登记的台账脚本既有问题，没有以本批通过替代全仓 `pnpm check`。

本次开发自测不能替代独立验收。真实请求验证的是同一适配器和已有凭据可用，不代表用户网关结算 / 欠费并发 / 完整生态链经过真实数据库验证。

## 断点

下一项 H4 按 25 号建议细化任务、扩展多人费用分摊契约并实现。当前 S 仅平台付费搜索，尚不能直接满足 H4 平摊。P3 图片触发仍需按已定「方案确认后实施」推进；M 统一记忆、L 日志、P1 角色搜索方案以及 H3 / S 数据库链路验证仍未完成。

正式切换 Jev 前，`eval-plan.md` 的中文 60 题、盲评、1000 次延迟、7 天稳定性、50 次出境金丝雀、人设检查、数据保存 / 训练政策及真实资金验证均要补齐。本批没有登记这些项目为通过，也没有修改线上 planner_config。
