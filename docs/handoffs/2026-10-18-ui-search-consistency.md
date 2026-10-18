# 搜索一致性与操作可达性交接（GUI待核）

专用分支`codex/ui-search-1018`，副本`C:\wb-dev\wb-ui-search-1018`，基线`59037fb7772a1b96c9fbf1954e7eee0714f06664`。断点`59abfb2`、业务WIP`41bd314`、覆盖/台账WIP`2c8ae8c`。完整最终SHA见交付消息。旧模型入口e5adbec未混入，未合主线、未改共享main；本批仅开发自查，不是独立验收。

## 结果与范围

覆盖矩阵：[docs/web/ui-search-2026-10-18/coverage.md](../web/ui-search-2026-10-18/coverage.md)。已读全部9个SearchField调用点/7个调用文件、会话列表Link、生产CSS导入顺序以及两张原始截图。

1. SearchField外层label改div，避免同一label嵌input/范围/清除多个表单控件。输入aria名称、属性、autoFocus及外部inputRef转接保留；空白/图标点击显式聚焦，输入/按钮/链接等内部交互不被截获，不新增容器Tab位。
2. 组件专用样式统一到common-fixes的双class限定规则，清掉pages-old和shell的组件input/label重复块，避免改标签漏样式。旧会话列表Link.search-entry不受影响；保留全局16px输入修复、主题token与微信式圆角。清除36px点击区、范围宽度限制/省略、取消/提交可见区域及键盘focus保持，输入仅底线焦点，不恢复旧整框绿边。
3. 官方角色与自定义角色广场均补可见搜索按钮。任务线索曾称自定义已有按钮，本轮实际源码确认没有，按事实补齐。三个提交表单沿原接口，官方/自定义原本trim，添加朋友本轮补trim；清空/纯空格恢复全量，添加朋友同时重置分页，避免空白禁用堵住恢复路径。
4. G3.5原图是专注时长/事项/开始按钮，实际在play.tsx，无搜索；本批未动专注布局、不强加组件，不将搜索批次宣称解决专注UI反馈。
5. 人工台账仅更新实际读过的T1.2、T1.16.2、T1.18、T2.2、G3.5，全部保持源码已核待点按。C1产品来源/C9冻结与原批注统计差异不变。原审计报告加后续版本提示，生成物反映当前源码引用行号。没有关键词命中销账。

业务仅7文件：search-field/contacts/plaza/role-plaza四TSX与common-fixes/pages-old/shell三CSS；未改server、contracts、会员、模型、计费、数据库、登录或搜索候选引擎。无新增库或UI安全绕过。

## 最终检查

| 命令 | 会话/输出与退出 | 范围 |
| --- | --- | --- |
| `pnpm install --offline --frozen-lockfile --ignore-scripts` | 88606，exit0 | 本副本C盘依赖；无包/锁跟踪改动 |
| `pnpm --filter @weiban/web typecheck` | 54040，终输出020102，exit0 | 两个tsconfig |
| `pnpm exec eslint`四个受影响TSX | 直接输出59d38d，exit0 | search-field、contacts、plaza、role-plaza |
| `pnpm --filter @weiban/web build` | 直接输出5305ab，exit0 | 构建417861，4831模块；SW232模块/16预缓存项 |
| 台账`node .../build.mjs`与`node .../validate.mjs` | 输出f97632，均exit0 | 401原数据/185映射/引用/HTML脚本只编译/JSON往返；browserVerified=false |
| 工作区及`git diff --check 59037fb...HEAD` | 最终exit0 | 曾发现审计文档末尾空行，已移除；不掩盖WIP未完成状态 |

TSX/CSS按仓库Prettier配置格式化。既有>500KB大包提示及SW inlineDynamicImports弃用提示保留，不导致失败。没有写或跑测试套件，没有反复启动同一检查；本轮没有新增产品构建之外的后端操作。

## GUI待核及限制

本轮CUA getState实际返回`apps:[]、browsers:[]`；未用外部Playwright/CDP绕过。没有当前产品截图、真实输入/窄屏/滚动/点击/焦点/Safari验收，CSS声明与build不能证明最终视觉。没有启动后端/数据库/SSH/部署，也没有用PM的旧前端预览冒充此分支。

浏览器恢复后按覆盖矩阵逐入口核查，重点：

- 320/390px宽全局范围标签+长输入+清除+取消不互相挤压，输入16px、没有整框绿色focus；Tab焦点清楚。
- 搜索图标/空白聚焦，输入选字不被抢，范围/清除按钮维持各自动作并正确回焦输入。
- 三个角色表单的按钮/Enter一致、trim正确、空白禁用、清空后恢复全量与分页；排序/分类保留。
- 单聊/群聊记录取消和返回不循环；转发目标、小程序、群成员本地筛选不因共用组件改变业务。
- 专注页仅列后续目视项，保持未改；Safari原生输入/触控体验需实际设备。

GUI缺失先保留分支交PM复核，不能写UI已验收通过。本批无新预览端口/fixture需要停止或清理。
