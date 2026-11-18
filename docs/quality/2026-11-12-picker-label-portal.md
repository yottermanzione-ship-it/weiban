# 提醒/记忆等时间选择弹层关不掉（2026-11-12）

- 结论：与 11-10 记忆状态选择同一根因——选择弹层（Sheet / ActionSheet）渲染在表单的 `<label>` 里。移动 WebKit 点蒙层或滚轮（非交互元素）时，先执行我们自己的关闭，随后浏览器按 `<label>` 的默认行为再点一次里面的触发器按钮，弹层立刻重开，看起来“卡住”。
- 11-10 的修复（`c4d8c823`）只把记忆页的“分类 / 状态”外层 label 换成普通容器；提醒页的“时间 / 重复 / 日期”、以及关系、支持、搜索、周期、角色广场、成长、资料等页面仍把选择框放在 label 内，所以同一问题会复现。
- 本次修复改为**根因层**：`shell-kit.tsx` 的 `Sheet` 与 `ActionSheet` 用 `createPortal` 渲染到 `document.body`，弹层不再是 `<label>` 的后代，点蒙层、滚轮、取消都不会触发 label 的默认激活。一处修复覆盖所有使用这两个组件的页面（提醒时间/重复/日期、记忆、关系、支持、搜索、周期、角色广场、成长、资料等 14 处）。
- 文件：`apps/web/src/features/shell-kit.tsx`。未改各页面结构，未改 CSS。
- 验证：`pnpm --filter @weiban/web build` 通过；已发布 `4589bdce`（15:08 +08，健康检查正常）。**未在真实 iPhone Safari / 主屏幕入口复验**；11-10 的记忆修复当时在 Chromium / WebKit 合成环境通过，但用户真机“所有项都无效”未完整复现。
- 回退：`bash /srv/weiban/ops/current/rollback.sh 1`。
