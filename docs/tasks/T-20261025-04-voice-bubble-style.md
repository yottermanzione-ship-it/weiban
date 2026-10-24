# 第 4 项反馈：语音气泡样式照旧版重做

## 现象

用户截图：语音消息气泡里显示成 `·)) 13''`，三段弧线用 CSS 边框拼出来，看起来像标点；整体不符合旧版观感。要求「直接抄旧版的就行」。

## 旧版真实规格（Flutter 源码，[message_bubble.dart](<C:/wb-ref/old-weiban/src/lib/widgets/message_bubble.dart>) 第 876–972、1043–1098 行）

- 容器：宽 = `86 + clamp(秒数, 1, 30) × 4`，再夹在 `minWidth 108 / maxWidth 220`；内边距 `14 × 9`；圆角 8。
- 底色：自己 = 绿色气泡；对方 = 白/卡片色。播放中图标变绿 `#1F7A32`，出错转红 `#E84040`。
- 布局：对方是「图标 + 8px 间距 + 秒数」；自己是「秒数 + 8px + 图标」，图标水平镜像。
- 秒数文字：`13''`，字号 16，字重 500。
- 图标尺寸固定 22×18，自绘：一个半径 1.6 的实心圆点位于 x=18% 处，再画 3 段圆弧，半径依次 4.5 / 8.7 / 12.9，线宽 1.8、圆头、角度 `-0.75` 起跨 `1.5` 弧度；三段透明度 0.35–1，播放时按进度依次亮起。

## 当前实现的问题

[media.tsx](<C:/wb-dev/wb-client-logs/apps/web/src/features/media.tsx>) 第 629–633 行用三个 `<i>`，配合 [chat-old.css](<C:/wb-dev/wb-client-logs/apps/web/src/app/chat-old.css>) 第 304–355 行的 `border-color: transparent currentColor transparent transparent` 拼弧线，形状和旧版差距明显。

## 修复要求

- 按旧版几何重画图标（SVG 或 canvas 皆可），保持 22×18、圆点 + 三段同心弧、圆头 1.8 线宽、角度与透明度规则一致。
- 保持现有功能不变：点击播放/暂停、未播放红点、识别文字、失败重试、无障碍标签、按秒数定宽。
- 颜色继续用现有主题变量，不硬编码绿色背景，避免暗色模式破坏。
- 只动语音相关的 TSX 与 CSS，不碰其他消息类型。

## 执行

- 交给前端子代理，模型 `deepseek-account` / `deepseek-flash`。
- 文件范围：`apps/web/src/features/media.tsx`（仅语音组件部分）、`apps/web/src/app/chat-old.css`（仅 `.wx-voice*` 段落），不和另外两个改列表/数据缓存的子代理重叠。
- 不部署、不提交；检查只跑一次 `pnpm --filter @weiban/web typecheck`。
