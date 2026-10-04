/**
 * @weiban/contracts —— 微伴接口与事件契约的唯一准绳。
 * 使用方式：
 *   import { ChatEndpoints, Message, Events, type ChatParticipantPort } from '@weiban/contracts';
 */
export * from './version.js';
export * from './common.js';
export * from './character-card.js';

// HTTP 接口（客户端 ↔ 服务器）
export * from './http/identity.js';
export * from './http/model-access.js';
export * from './http/billing.js';
export * from './http/characters.js';
export * from './http/contacts.js';
export * from './http/chat.js';
export * from './http/sync.js';
export * from './http/push.js';
export * from './http/companion.js';
export * from './http/media.js';

// WebSocket 帧
export * from './ws.js';

// 领域事件（模块 → 模块），以命名空间导出避免与 HTTP 类型重名：Events.MessageCreated
export * as Events from './events.js';

// 端口（模块 ↔ 模块，同进程接口）
export * from './ports/index.js';

// v0.2：原生桥 bridge.ts 已删除（安卓改为 Kotlin 原生客户端，ADR-0011），网页与安卓之间没有桥。
