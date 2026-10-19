# 生态预览信息层次与准确性交接（GUI待核）

分支`codex/ui-ecology-clarity-1018`，副本`C:\wb-dev\wb-ui-ecology-clarity-1018`。本批起点`8869b70da36aef5c1ee78e05b926412a61ce77cb`（已含模型入口纠偏e5adbec及主线文档），初始工作区干净。业务WIP `d3e7408`、样式/最终业务`ec0f402`。完整最终SHA见交付消息。没有自行合主线，整条分支保留待浏览器核查。

## 修改范围

仅`apps/web/src/features/ecology.tsx`与`apps/web/src/app/ecology.css`，相对本批起点70增37删，外加本文交接。没有修改共享台账或其生成物，没有混入搜索待核分支，没有改旧设置/后端/契约/会员/模型选择/计费。

- 顶部“界面预览”先说明本页不启停真实角色、不扣积分，再单列“目标方向”。开关改为“预览角色生态”，行内说明只展开/收起演示，不控制现有角色。
- 动作选项、思考频率、每个积分数字与合计均标示例/供讨论。去掉频率里“推荐、成本可控”等未经确认的承诺；保留原演示数字和本机交互，没有新费率。
- 删除monthly/useMemo及人民币元/月换算；合计注明不是实际报价，不从账户扣除。
- 动作历史标题改“动作记录示例”，补虚构演示说明，时间均带“示例”；移除no-op点击，记录行禁用。局部`.ecology-page .ecology-example-log .menu-row:disabled`设opacity1以保持文字可读，不改变全局disabled或模型行的禁用状态。
- 模型行保留上一批“尚未接通”、disabled、无箭头，无聊天模型跳转。
- 页尾说明预览仅存当前浏览器、不修改旧主动消息或角色日常设置；“本页尚未接通实际执行、模型选择或计费”，不再声称关掉预览就会停止旧后台或未来排队任务。
- 局部CSS沿现有主题token，去硬编码白卡/灰字/绿色；顶部说明分层，动作标签、频率右侧、示例合计可换行。实际窄屏/深色可读性待GUI，不以CSS声明判通过。

## 旧真实入口关系（只核，不改）

- me.tsx服务页同时保留`/services/ecology`与`/services/proactive`；settings.tsx亦链接旧主动消息设置。
- account-settings.tsx的ProactiveSettingsPage实际读/写IdentityEndpoints通知设置（proactiveMessagesEnabled、proactiveCallsEnabled、doNotDisturb）。
- chat-settings.tsx“TA的日常”实际PATCH CompanionEndpoints.updateForCharacter的dailyLife；主动消息还会读取旧通知总开关。

因此新生态预览并未统一控制这些真实开关；本页文字明确隔离其作用域。本批没有擅改旧开关语义、保存数据或停用旧后台。后续若要统一入口须另按C9讨论，不能从本页预览推断统一生态执行已完成。

## 检查记录

| 命令/核查 | 会话/退出状态 | 证据范围 |
| --- | --- | --- |
| `pnpm install --offline --frozen-lockfile --ignore-scripts` | 86585，exit0 | C盘离线依赖，无包/锁跟踪改动 |
| `pnpm --filter @weiban/web typecheck` | 76597，终输出aa2ac2，exit0 | 两个tsconfig |
| `pnpm exec eslint apps/web/src/features/ecology.tsx` | 直接输出ae2053，exit0 | 本页TSX |
| `pnpm --filter @weiban/web build` | 直接输出0350af，exit0 | 构建417865；4831模块；SW232模块/16预缓存项 |
| 源码rg：monthly/useMemo/元每月/错误模型跳转/旧关闭承诺 | 无命中，预期exit1 | 只说明相应旧代码/文案已移除，不是行为测试 |
| `git diff --check 8869b70...HEAD`及工作区空白检查 | 最终exit0 | 提交前后核对 |

格式按仓库Prettier配置。既有大包>500KB提示与SW inlineDynamicImports弃用提示保留，未导致构建失败。没有写或运行测试套件，没有重复启动检查；没有后端、SSH、数据库、迁移、部署或外部浏览器绕过。

## GUI环境与恢复清单

本轮CUA getState实际返回`apps:[]、browsers:[]`，没有可用浏览器，没有截图、实际点按或视口验证。保留分支待核，不宣称完整UI验收。本分支继承e5adbec的私密提示/模型入口也仍待原GUI清单复核，不能由本页构建替代。

浏览器恢复后，在本分支前端/可控真实组件样例中核查：

1. 初始与已保存开启两种状态都先看到预览说明；开关行可读当前作用域，不像真实后台总闸。
2. 展开、切8种动作与3档频率、收起再打开，数字仍只为演示；每处数字有示例标识，页面没有人民币月费。
3. 动作记录清楚为虚构；记录不可点击/不可键盘激活，文字对比清楚。模型行继续禁用，不能跳聊天模型页。
4. 窄屏320/390px及深色下顶部、动作长文、频率勾选/示例数字、合计能换行，不挤压开关。
5. 重新进入仅恢复当前浏览器演示选择；本页动作没有HTTP写请求、不扣积分，不更改旧通知/TA日常。真实后台行为不在本轮GUI证明范围。

未新起预览服务或fixture，无本批临时端口待停。共享台账按PM要求未改，未来合入时再统一更新引用与待核状态。
