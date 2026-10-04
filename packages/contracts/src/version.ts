/**
 * 契约版本。
 * - 主版本（第一位）：出现不兼容改动时加一（删字段、改字段含义、改必填）。
 * - 次版本（第二位）：只新增可选字段、新增接口 / 事件时加一。
 * 客户端启动时把自己的契约版本发给服务器（WebSocket auth 帧），服务器返回 minClientVersion，
 * 过旧的安卓 APK 会被提示更新（见 ADR-0003「网页打包进 APK」的代价）。
 */
export const CONTRACT_VERSION = '0.1' as const;
