# T-086 L6 安卓：导入流程、注销、宠物

| 项 | 内容 |
|---|---|
| 负责人 | android-lead |
| 派发人 | 项目总负责人 |
| 日期 | 2026-10-09 |
| 状态 | 待开始 |
| dev-plan | D-L6-09（第二部分）、D-L6-13（安卓） |
| 迁移号 | 无 |

## 目标

安卓原生端实现 T-084 的用户端功能：导入聊天记录 / 截图生成角色、补充设定导入、「资料已更新」提示、注销账号、宠物（领养、宠物页、总入口、服务页宫格）。管理后台部分不涉及。

## 输入文档

- `docs/tasks/L4-L7-index.md` 第 2 节
- `docs/tasks/T-084-l6-web-import-pets-admin.md`（功能与 PRD 参数，两端一致，不重复）
- `docs/architecture/contracts-3.0-map.md`
- `docs/product/prd-v1/03-characters.md` CHR-08～CHR-10；`docs/product/prd-v1/01-account-settings.md` ACC-06；`docs/product/prd-v1/16-interactive-play.md` PLAY-02
- `docs/design/pages/pet.md`、`contacts-add.md`、`settings.md`；`docs/design/tokens-android.md`

## PRD 条目与参数（原文）

同 T-084。重点：P-38「每个角色最多与用户共同领养 1 只（送养后可再领养）；同时在养的宠物最多 3 只」；P-39「幼年 第 1–29 天、少年 第 30–99 天、成年 第 100 天起；按钮互动每只宠物每天最多计 5 次亲密值（每次 +1），只升不降」；宠物名 1～8 字；注销密码错误保持登录。截图导入从系统相册多选（现值单次最多 30 张）。

## 范围

- 可以改：`apps/android/feature/**`、`apps/android/core/data/**`。
- 不可以改：`apps/android/core/contracts-generated/**`、`packages/contracts/**`、`docs/quality/**`。

## 交付物

1. 导入流程（粘贴、选文件 .txt / .csv、相册多选截图、发言人选择、确认、进度与完成通知）、补充设定导入、「资料已更新」。
2. 注销页面。
3. 宠物全部用户端页面与按钮动画。

## 本轮完成标准

本轮不写额外测试、不做评审，只保证可编译（`assembleDebug` 通过）。

## 验收标准（留给 Codex 整体验收）

与 T-084 用户端各条相同，在安卓上逐条核对。

## 交付

分支 `T-086-l6-android-import-pets`，worktree `C:\wb-dev\wb-t086`，交接 `docs/handoffs/2026-10-09-android-lead-T-086.md`。其余按 index 第 2 节。
