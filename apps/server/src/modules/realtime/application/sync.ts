import { Inject, Injectable } from '@nestjs/common';
import type { SyncPort, Tx, UserUpdatePayload } from '@weiban/contracts';
import { UpdateLogService } from './update-log.js';
import { PresenceService } from './presence.js';
@Injectable()
export class SyncService implements SyncPort {
  constructor(
    @Inject(UpdateLogService) private readonly log: UpdateLogService,
    @Inject(PresenceService) private readonly presence: PresenceService,
  ) {}
  appendUpdate(tx: Tx, userId: string, update: UserUpdatePayload): Promise<number> {
    return this.log.appendUpdate(tx, userId, update);
  }
  isViewingConversation(userId: string, conversationId: string, tx?: Tx): Promise<boolean> {
    return this.presence.isViewingConversation(userId, conversationId, tx);
  }
  getLastUserActivityAt(userId: string): Promise<string | null> {
    return this.presence.getLastUserActivityAt(userId);
  }
  sendEphemeral(userId: string, frame: Parameters<SyncPort['sendEphemeral']>[1]): Promise<void> {
    return this.presence.sendEphemeral(userId, frame);
  }
}
