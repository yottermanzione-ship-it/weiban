/**
 * @weiban/contracts —— 微伴接口与事件契约的唯一准绳。
 * 使用方式：
 *   import { ChatEndpoints, Message, Events, type ChatParticipantPort } from '@weiban/contracts';
 */
export * from './version.js';
export * from './common.js';
export * from './character-card.js';
export * from './legacy-character-card.js';
export * from './client-sync.js';
export * from './client-log-safety.js';

// HTTP 接口（客户端 ↔ 服务器）
export * from './http/identity.js';
export * from './http/model-access.js';
export * from './http/billing.js';
export * from './http/characters.js';
export * from './http/admin-content.js';
export * from './http/contacts.js';
export * from './http/chat.js';
export * from './http/sync.js';
export * from './http/push.js';
export * from './http/companion.js';
export * from './http/memory.js';
export * from './http/media.js';
export * from './http/health.js';
export * from './http/growth.js';
export * from './http/timeline.js';
export * from './http/proactive.js';
// 3.0（L4～L7，T-062）
export * from './http/chat-groups.js';
export * from './http/character-extras.js';
export * from './http/assets.js';
export * from './http/moments.js';
export * from './http/calls.js';
export * from './http/growth-cards.js';
export * from './http/pets.js';
export * from './http/library.js';
export * from './http/importer.js';
export * from './http/plaza.js';
export * from './http/role-requests.js';
export * from './http/play.js';
export * from './http/ai-runtime-extras.js';
export * from './http/announcements.js';
export * from './http/public-updates.js';
export * from './http/official-assistant.js';
// 3.8（总对照表 Q 清单）
export * from './http/support.js';
export * from './http/status.js';
export * from './http/client-logs.js';
// 3.42：设置 › 插件 › 微信 / 微博接入（外部渠道绑定与网关回调）
export * from './http/channels.js';
// 10-25：年度回忆（PRO+ 权益，每年 12-31 22:00 服务端生成；只读待展示端点 + 已读确认）
export * from './http/recap.js';

// WebSocket 帧
export * from './ws.js';

// 领域事件（模块 → 模块），以命名空间导出避免与 HTTP 类型重名：Events.MessageCreated
export * as Events from './events.js';

// 端口（模块 ↔ 模块，同进程接口）
export * from './ports/index.js';

// v0.2：原生桥 bridge.ts 已删除（安卓改为 Kotlin 原生客户端，ADR-0011），网页与安卓之间没有桥。

export * from './http/membership.js';
export * from './http/admin-users.js';
export * from './http/ecology.js';
export * from './http/search.js';
export * from './ports/shared-search.js';
