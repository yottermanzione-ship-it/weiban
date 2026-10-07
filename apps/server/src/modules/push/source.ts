import type { ChatNotificationReadPort, Tx } from '@weiban/contracts';
export const PUSH_MESSAGE_SOURCE = Symbol('weiban.push.message-source');
/** 组合根适配中层读取；push自身不得import聊天、角色模块。 */
export interface PushMessageSource {
  current(
    userId: string,
    messageId: string,
    tx?: Tx,
  ): ReturnType<ChatNotificationReadPort['getNotificationContext']>;
  name(userId: string, characterId: string | null, tx?: Tx): Promise<string>;
}

export const PUSH_MODEL_SOURCE = Symbol('weiban.push.model-source');
export type PushModelSource = import('@weiban/contracts').ModelNotificationReadPort;
