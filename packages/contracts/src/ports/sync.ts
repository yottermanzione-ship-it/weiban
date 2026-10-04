import type { UserUpdatePayload } from '../http/sync.js';
import type { Tx } from './common.js';

/** 提供方：realtime。每用户更新日志、在线状态、实时转发。 */
export interface SyncPort {
  /**
   * 在调用方的事务中追加一条用户更新；事务提交后由 realtime 实时推给该用户所有在线设备。
   * 返回分配的 updateSeq。
   */
  appendUpdate(tx: Tx, userId: string, update: UserUpdatePayload): Promise<number>;
  /** 用户是否有设备正在前台查看该会话（CHAT-10 第 6 条：此时不推送）。 */
  isViewingConversation(userId: string, conversationId: string): Promise<boolean>;
  /** 用户最近一次在任一会话发消息的时间（P-09「正在聊天」判断）。 */
  getLastUserActivityAt(userId: string): Promise<string | null>;
  /** 向用户在线设备转发一闪而过的状态（正在输入），不落库。 */
  sendEphemeral(
    userId: string,
    frame: {
      type: 'typing';
      conversationId: string;
      participantId: string;
      state: 'start' | 'stop';
    },
  ): Promise<void>;
}
