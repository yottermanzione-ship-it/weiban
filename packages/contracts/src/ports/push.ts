/**
 * 提供方：push。大多数推送由 push 模块订阅事件自行判断（例如 chat.message_created），
 * 只有少数场景（模型不可用通知、来电）由其他模块直接请求。
 * 调用方只提供「要提醒什么」，免打扰、隐藏内容、合并等规则由 push 统一执行。
 */
export interface PushRequest {
  userId: string;
  kind: 'model_status' | 'call' | 'system';
  title: string;
  body: string;
  deepLink: string;
  conversationId: string | null;
  /** 去重键：同一键在 dedupeWindowHours 内只推一次（例如 MDL-04 第 3 条：24 小时）。 */
  dedupeKey: string;
  dedupeWindowHours: number;
  /** 是否属于「主动打扰」类（来电），需遵守全局免打扰时段。 */
  respectsDoNotDisturb: boolean;
}

export interface PushPort {
  send(request: PushRequest): Promise<{ delivered: boolean; reason?: 'deduplicated' | 'do_not_disturb' | 'no_device' }>;
}
