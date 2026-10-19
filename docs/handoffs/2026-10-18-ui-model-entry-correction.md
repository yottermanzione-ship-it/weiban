# UI模型入口纠偏（开发检查完成，GUI待核）

工作副本`C:\wb-dev\wb-ui-model-entry-1018`，分支`codex/ui-model-entry-1018`，基线`6f24f7c58dec2037058e326a48d62cc98d99c534`。WIP `9baabed`、`a76363b`，最终业务保护`b7d5f4f`。完整交付HEAD随本交接提交在交付消息登记。没有自行合主线，因浏览器不可用保留分支待核。

## 代码核实与修正

- `ecology.tsx`：原“生态模型”行链接`/models`，文案声称与聊天分开。实际`models.tsx`只PATCH `{chat: ...}`，会误引导修改聊天选择。现移除链接，副文案“当前仅为界面预览，生态模型选择尚未接通”，值为“尚未接通”，禁用且无箭头。沿现有MenuRow，源码确认禁用时渲染disabled button；没有新端点或本机模型选择逻辑。
- `scenario.tsx`：缺私密模型时，原Dialog“去选择”同样跳到聊天选择页。现提示“暂时无法开启私密模式”，说明尚未设置私密模型且选择入口暂未开放，只提供“知道了”关闭。删除无用途的useNavigate。
- `choose()`仍读真实getSelection；已有adult配置仍走原开启确认；读失败仍交服务器判断。`apply()`原adult_model_missing、adult_mode_not_eligible、romance_not_allowed处理均保留，没有绕开服务端资格、允许任意模型或自动打开私密模式。
- 未改models.tsx、其他聊天选择、后端、契约、会员、安全/计费、路由或静态生态预览HTML。两文件按仓库Prettier配置整理末尾换行，少量既有联合类型/长行重排无逻辑变化。基线至业务源12增20删；没有新增产品样式。

## 检查记录

| 命令 | 会话/终输出与退出 | 说明 |
| --- | --- | --- |
| `pnpm install --offline --frozen-lockfile --ignore-scripts` | 47926，exit0 | C盘本副本依赖；包/锁文件无跟踪改动 |
| `pnpm --filter @weiban/web typecheck` | 30431，终输出e05b0f，exit0 | 两个tsconfig均执行 |
| `pnpm exec eslint apps/web/src/features/ecology.tsx apps/web/src/features/scenario.tsx` | 78365，终输出c2b087，exit0 | 仅受影响文件 |
| `pnpm --filter @weiban/web build` | 14009，终输出d61ccd，exit0 | 4831模块，构建417853；SW232模块/16预缓存项 |
| `git diff --check 6f24f7c...HEAD`及工作区空白检查 | 直接返回exit0 | 交付前/后核对 |

既有JS大于500KB提示及SW inlineDynamicImports弃用提示保留，未导致失败。没有写或运行测试套件；无挂起检查进程。

## GUI阻塞与恢复核查步骤

本轮CUA `getState()`实际返回`apps:[]、browsers:[]`。没有创建外部Playwright/CDP、没有伪造截图或把编译当点按；没有启动后端/数据库、SSH或部署。主会话现有前端是否运行不代表本分支可登录验证。GUI尚未通过，不记独立验收。

浏览器恢复后，应在本分支前端及可控样例/有效开发数据中核：

1. 生态样例开关开启后，模型行可读“尚未接通”，不显示箭头，触摸/点击/键盘不能跳转models或写聊天选择；关闭样例开关不触发额外请求。
2. 情景预设存在私密选项、当前selection.adult为空时，点击显示准确说明；“知道了”只关闭提示并保留原预设/输入，不跳models，不PATCH开启私密。
3. getSelection读取失败、随后服务端adult_model_missing同样显示该提示；资格拒绝仍原提示，普通预设/取消正常。
4. 已有有效私密配置的原开启确认/取消不受误伤。仅做界面样例证据，真实HTTP/模型/安全资格验证另记，不调用收费模型来证明文案。

## 交主会话

UI总账的原源码引用按2e92c92基线记录，正是被本次纠正的`to="/models"`及`navigate('/models')`片段；合入后若重跑台账validate，将提示旧引用失效。请在后续证据更新中把相应ID记录改为本次源码修正且GUI待核，并保留原问题来源，不能直接销账通过。本任务按范围未顺手改台账/其他UI，也未解冻模型路由或会员。
