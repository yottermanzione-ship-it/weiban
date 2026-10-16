/** 11 C8：邀请码已停用。保留服务签名兼容旧HTTP/CLI，历史表不读写。 */
import { Inject, Injectable } from '@nestjs/common';
import type { Invite } from '@weiban/contracts';
import {
  AppError,
  AUDIT_LOG,
  CLOCK,
  DATABASE,
  type AuditLog,
  type Clock,
  type Database,
} from '../../../platform/index.js';

export type { Invite } from '@weiban/contracts';

@Injectable()
export class InviteService {
  constructor(
    @Inject(DATABASE) database: Database,
    @Inject(CLOCK) clock: Clock,
    @Inject(AUDIT_LOG) audit: AuditLog,
  ) {
    void database;
    void clock;
    void audit;
  }

  async create(
    _options: { expiresInDays: number | null; bonusMicros?: number },
    _createdBy: string | null,
    _idempotencyKey?: string,
  ): Promise<Invite> {
    throw new AppError('service_unavailable', '邀请码功能已停用，请直接注册');
  }

  async list(): Promise<Invite[]> {
    return [];
  }
}
