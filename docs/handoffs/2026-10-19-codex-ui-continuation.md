# 2026-10-19 交接：全站 UI 优化（给 Codex）

> 本文件是可直接粘贴给 Codex 的提示词。基线 `codex/ui-global-1018` @ `05acd75`，工作区干净。
> 环境由项目方起好，Codex 直接接手，不需要重建。

---

## 提示词正文

你在 `C:\wb-dev\wb-ui-global-1018`（分支 `codex/ui-global-1018`）继续做微伴网页端的全站 UI 优化。
基线提交 `05acd75`，工作区干净，不要切换分支、不要碰共享目录 `C:\Users\lomjy3\Desktop\weiban` 的 `main`。

### 一、环境已经就绪，直接用

| 部件 | 说明 |
|---|---|
| 数据库 | 香港 DR-001 临时库，经 SSH 隧道映射到本机 `5433` |
| 后端 | `127.0.0.1:3000`，`APP_ROLE=web`，`DATABASE_POOL_MAX=8` |
| 网页 | `http://localhost:5173`，vite 从本 worktree 提供，`/api` 代理到 3000 |
| 账号 | `weiban_admin`；密码读 `C:\wb-dev\secrets\dev-admin-password.txt`，**不要写进仓库、文档或对话** |
| 启动/排障 | `docs/ops/local-preview.md` |

隧道断了按该文档重建；`APP_ROLE=all` 会因为 pg-boss 在跨境链路上连接超时而起不来，保持 `web`。

### 二、当前进度（不要重复做）

- 104 条路由已打开约 100 条，截图在 `C:\wb-dev\logs\ui-routes-1019\`
- 逐路由记录：`docs/web/ui-global-2026-10-18/routes.md`、`coverage.md`
- 401 条台账：`docs/web/ui-ledger-2026-10-18/`
- 已完成的批次：搜索清除、推荐角色头像位置、反馈表单、表情包封面、小程序加载与导航、朋友圈相机长按、认证恢复竞态、嵌套按钮、专注页布局、统一 NavBar（周期/纪念日/关系/卡册/成就/好感度/角色创建/导入）、`fieldset/.radio-option` 缺失样式、插件页空白、分享页与举报页、**熟悉度→好感度改名**、**生态页 11 个细项独立开关**。
- 总经理最新决定：`docs/product/input/2026-10-19-gm-decisions.md`；好感度方案：`docs/design/affinity-v1.md`。

### 三、两个阻塞 bug，先修这两个

**Bug A：会话列表所有行都显示「角色」，头像是问号**

- 复现：登录后进 `/chat`，三行标题全是「角色」，头像显示 `?`；同一账号进 `/contacts` 能正常显示「程澈」「温言」。
- 线索：会话标题取自本地 sync 状态里的 contacts（当前为空）；`data/character-names.ts` 的 `useCharacterNames` 逐条拉 `getProfile` 也补不上；第三个联系人（`01a14ac2-3d86-7193-a00f-6ded2bdb96ce`）疑似已删除。
- 期望：能拿到名字就显示名字/备注；拿不到时给明确占位（例如「已删除的角色」），**不要统一显示「角色」**。
- 证据截图：`C:\wb-dev\logs\ui-routes-1019\chat-list-now.png`。

**Bug B：首屏同步 22.7 秒**

- 实测：`GET /api/v1/sync/updates?since=0` 返回 129 条更新、48KB，耗时 **22.7 秒**；期间 `/chat` 一直显示「正在读取聊天…」。
- 怀疑：逐条回放、可能存在 N+1 查询；跨境库放大了延迟，但回放逻辑本身要优化。
- 期望：首屏 3 秒内可用；做不到就分批 + 先渲染骨架。
- 注意：`/sync/state` 本身只要 2.4 秒，慢的是 updates。

### 四、接下来要做的

1. **手势验收**（截图看不出来，必须真点）：会话行长按（应出浅色菜单，不弹浏览器菜单）、左滑三键、气泡长按 6 项、头像双击拍一拍、滚动惯性、复制「已复制」提示、页面右侧切入动画。
2. **全站视觉复核**：间距、字号、行高、图标对齐，按 `docs/refactor/06-old-ui-spec.md` 和微信实机对照。
3. **缺数据的两条**：`/plaza/works/:workId`（要先建自定义角色再走发布草稿）、`/calls/:callId`（需真实通话）。
4. **待总经理拍板的 6 项**见 `2026-10-19-gm-decisions.md`，未定的不要自己实现。

### 五、规则

- 只在本 worktree 改；共享目录的 `main` 不动。
- 不部署生产、不写生产库、不把密钥写进仓库或文档。
- 每批改动跑 `pnpm --filter @weiban/web typecheck` 与 `pnpm exec eslint <改动文件>`，保持通过。
- 只写有证据的结论：没点过的页面不写「通过」，截图和临时脚本放 `C:\wb-dev\logs`、`C:\wb-dev\scripts`，不进仓库。
- 提交信息写清楚「改了什么、为什么、证据在哪」。

### 六、建议顺序

Bug A → Bug B → 手势 → 视觉复核 → 补数据的两条路由 → 更新 `routes.md` 与台账。
