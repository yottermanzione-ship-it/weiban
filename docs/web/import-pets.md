# 网页：导入、补充设定、注销、宠物；后台宠物图鉴与注销未完成（T-084）

> 负责人：web-lead · 2026-10-10 · 对应 D-L6-06 第二部分、D-L6-13（网页）、D-L6-11 / D-L6-05 的后台页。设计：`docs/design/pages/import.md`、`pet.md`、`account-deletion.md`、`admin-content.md` 4.4 与第 6 节。

## 1. 页面与入口

| 页面 | 路由 | 入口 |
|---|---|---|
| 导入聊天记录（新角色） | `/imports/new` → `/imports/:jobId` | 创建角色页「导入聊天记录」 |
| 导入资料（补充设定） | `/imports/new?kind=supplement&characterId=` | 我的补充设定页「导入资料」 |
| 进行中的导入 | `/imports` | 创建角色页顶部「进行中的导入」 |
| 编辑导入草稿 | `/characters/custom/new?import=:jobId` | 导入完成后 |
| 我的补充设定 | `/characters/:id/supplement` | 聊天信息页 |
| 注销账号 | `/settings/delete-account` | 设置 › 账号与安全 › 注销账号 |
| 宠物总览 | `/services/pets` | 服务 › 互动玩法 › 宠物 |
| 领养流程 | `/pets/adopt?characterId=` | 宠物总览、聊天信息页「我们的宠物」、私聊提议卡片「去看看」 |
| 宠物主页（含成长记录、相册、设置、改名） | `/pets/:petId` | 宠物总览、聊天信息页 |
| 后台：宠物图鉴 / 注销未完成 | `/pet-species`、`/account-deletions` | 管理后台菜单 |

## 2. 实现要点

- 导入页按服务器任务状态（`ImportJob.status`）显示对应一步；识别、生成中每 2 秒刷新，也随 `data.changed(imports)` 刷新，离开后可回来继续。文件和截图用 multipart `file` 上传（保留原文件名）。
- 导入草稿进入现有自定义角色编辑器：默认「真人」（服务器给的 `suggestedClassification`），改选其他分类要先勾选声明，并提示替换疑似真名；导入来的字段带「来自导入」标签，改过后消失。
- 补充设定在契约里是一段文字，页面按行拆成「一条一条」编辑；保存 5 秒后再拉一次以显示冲突项。
- 注销：403 `invalid_credentials` 只显示「密码错误」并保持登录；成功后完成页，点「好的」清除本机数据（IndexedDB、缓存、推送订阅、本机存储）后回到登录页。
- 宠物照顾按钮不调用模型，反应小字为预置文案；亲密值直接替换数字。

## 3. 性能检查

| 项 | 结果 |
|---|---|
| 动画 | 宠物弹跳、反应气泡、领养完成弹出、进度条：只用 transform / opacity |
| 大图 | 宠物图、相册、截图缩略图 `loading="lazy"`；截图预览用本地对象 URL，离开时释放 |
| 轮询 | 只在识别 / 生成中、起名等待中轮询，状态结束即停 |
| 帧率 / 首屏实测 | **本轮按总经理要求未在浏览器实测**，留给整体验收 |
