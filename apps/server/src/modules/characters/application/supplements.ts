/**
 * 我的补充设定（CHR-09）与「资料已更新」提示（CHR-10 第 4 条），T-079。
 * - 补充设定只对预设角色可用、只对当前用户生效；不能改变分类与成人模式资格（本服务只存文字，不触碰分类字段）。
 * - 冲突项（与公开事实不一致处）由 AI（T-081）检出后经 setConflicts 写入；用户手写保存时清空旧冲突项。
 * - 「资料已更新」：用户第一次看到某预设角色时记下当时的人设版本；之后版本变大即显示红点，看过后清除。
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt } from 'drizzle-orm';
import {
  Id,
  PersonaUpdateNote,
  SupplementConflict,
  UserSupplement,
  type CharacterSupplementConflictsWritePort,
  type CharacterSupplementPort,
  type PortResult,
  type SyncPort,
} from '@weiban/contracts';
import { createHash } from 'node:crypto';
import { SYNC_PORT } from '../../realtime/index.js';
import { z } from 'zod';
import {
  AppError,
  CLOCK,
  DATABASE,
  ENVELOPE_CRYPTO,
  OUTBOX,
  parseContract,
  type Clock,
  type Database,
  type DbTx,
  type EnvelopeCrypto,
  type Outbox,
} from '../../../platform/index.js';
import {
  characters,
  personaUpdateSeen,
  personaVersions,
  userChildFeatureFlags,
  userSupplements,
} from '../infra/db/schema.js';

type SupplementDto = z.infer<typeof UserSupplement>;
type ConflictDto = z.infer<typeof SupplementConflict>;
const aad = (userId: string, characterId: string) =>
  `characters:supplement:${userId}:${characterId}`;

@Injectable()
export class CharacterSupplementService
  implements CharacterSupplementPort, CharacterSupplementConflictsWritePort
{
  constructor(
    @Inject(SYNC_PORT) private readonly sync: SyncPort,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(OUTBOX) private readonly outbox: Outbox,
  ) {}

  // ---------- 补充设定 ----------

  /** 契约 CharacterSupplementPort（ai-runtime 组装人设时读取）。 */
  async getSupplement(userId: string, characterId: string): Promise<string | null> {
    const [row] = await this.db.db
      .select()
      .from(userSupplements)
      .where(and(eq(userSupplements.userId, userId), eq(userSupplements.characterId, characterId)));
    if (!row) return null;
    return (await this.crypto.open(userId, aad(userId, characterId), row.textCiphertext)).toString(
      'utf8',
    );
  }

  async getForUser(userId: string, characterId: string): Promise<SupplementDto | null> {
    parseContract(Id, characterId);
    await this.presetOrThrow(characterId);
    const [row] = await this.db.db
      .select()
      .from(userSupplements)
      .where(and(eq(userSupplements.userId, userId), eq(userSupplements.characterId, characterId)));
    if (!row) return null;
    const text = (
      await this.crypto.open(userId, aad(userId, characterId), row.textCiphertext)
    ).toString('utf8');
    return UserSupplement.parse({
      characterId,
      text,
      conflicts: row.conflicts,
      plazaSource: row.plazaSource ?? null,
      updatedAt: row.updatedAt.toISOString(),
    });
  }

  async put(userId: string, characterId: string, body: { text: string }): Promise<SupplementDto> {
    parseContract(Id, characterId);
    await this.presetOrThrow(characterId);
    const text = body.text.trim();
    if (!text || text.length > 5000) throw new AppError('bad_request', '补充设定为 1～5000 字');
    const now = this.clock.now();
    await this.db.transaction(async (tx) => {
      const sealed = await this.crypto.seal(userId, aad(userId, characterId), text, tx);
      await tx.db
        .insert(userSupplements)
        .values({
          userId,
          characterId,
          textCiphertext: sealed,
          conflicts: [],
          plazaSource: null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [userSupplements.userId, userSupplements.characterId],
          set: { textCiphertext: sealed, conflicts: [], plazaSource: null, updatedAt: now },
        });
      await this.outbox.publish(tx, 'characters.supplement_changed', 'characters', {
        userId,
        characterId,
        action: 'saved',
      });
    });
    return (await this.getForUser(userId, characterId))!;
  }

  /**
   * 人设广场「应用改版」（PLZ-04 第 3 条，T-088 经 CharacterPlazaPort.applyVariant 调用）：写入 / 替换补充设定并记来源。
   * 重复调用结果相同（幂等）；聊天记录、记忆、熟悉度不受影响，分类不变（补充设定只是文字）。
   */
  async putFromPlaza(
    userId: string,
    characterId: string,
    text: string,
    plazaSource: {
      workId: string;
      version: number;
      authorName: string;
      /** 3.1：改版快照检出儿童特征（与预设分类取更严），只对这位用户生效。 */
      childFeaturesDetected?: boolean;
    },
    /** 儿童特征永久标记第一次写入时在同一事务里调用（发分类变化事件，让成人模式立即切回日常）。 */
    onChildFlagAdded?: (tx: DbTx) => Promise<void>,
  ): Promise<boolean> {
    try {
      await this.presetOrThrow(characterId);
    } catch {
      return false;
    }
    const clean = text.trim().slice(0, 5000);
    if (!clean) return false;
    const now = this.clock.now();
    await this.db.transaction(async (tx) => {
      const sealed = await this.crypto.seal(userId, aad(userId, characterId), clean, tx);
      await tx.db
        .insert(userSupplements)
        .values({
          userId,
          characterId,
          textCiphertext: sealed,
          conflicts: [],
          plazaSource,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [userSupplements.userId, userSupplements.characterId],
          set: { textCiphertext: sealed, conflicts: [], plazaSource, updatedAt: now },
        });
      if (plazaSource.childFeaturesDetected === true) {
        // 只增不减：独立表，用户改写 / 删除补充设定都不清除。
        const added = await tx.db
          .insert(userChildFeatureFlags)
          .values({ userId, characterId, detectedAt: now })
          .onConflictDoNothing()
          .returning({ id: userChildFeatureFlags.characterId });
        if (added.length && onChildFlagAdded) await onChildFlagAdded(tx);
      }
      await this.outbox.publish(tx, 'characters.supplement_changed', 'characters', {
        userId,
        characterId,
        action: 'saved',
      });
    });
    return true;
  }

  /**
   * 契约 3.1 CharacterSupplementConflictsWritePort：AI 检出冲突项后写入。
   * expectedTextSha256 与当前原文不一致（用户又改过）返回 stale；写入后发 data.changed(supplement)。
   */
  async setConflicts(
    userId: string,
    characterId: string,
    conflicts: ConflictDto[],
    expectedTextSha256?: string,
  ): Promise<PortResult<void, 'not_found' | 'stale'>> {
    const parsed = parseContract(z.array(SupplementConflict).max(50), conflicts);
    return this.db.transaction(async (tx) => {
      const [row] = await tx.db
        .select()
        .from(userSupplements)
        .where(
          and(eq(userSupplements.userId, userId), eq(userSupplements.characterId, characterId)),
        )
        .for('update');
      if (!row) return { ok: false, error: 'not_found', message: '补充设定不存在' };
      if (expectedTextSha256) {
        const text = (
          await this.crypto.open(userId, aad(userId, characterId), row.textCiphertext)
        ).toString('utf8');
        const current = createHash('sha256').update(text).digest('hex');
        if (current !== expectedTextSha256.toLowerCase())
          return { ok: false, error: 'stale', message: '补充设定已修改' };
      }
      await tx.db
        .update(userSupplements)
        .set({ conflicts: parsed })
        .where(
          and(eq(userSupplements.userId, userId), eq(userSupplements.characterId, characterId)),
        );
      await this.sync.appendUpdate(tx, userId, {
        type: 'data.changed',
        data: { section: 'supplement', characterId, itemId: null },
      });
      return { ok: true, value: undefined };
    });
  }

  async remove(userId: string, characterId: string): Promise<void> {
    parseContract(Id, characterId);
    await this.db.transaction(async (tx) => {
      const removed = await tx.db
        .delete(userSupplements)
        .where(
          and(eq(userSupplements.userId, userId), eq(userSupplements.characterId, characterId)),
        )
        .returning({ id: userSupplements.characterId });
      if (removed.length)
        await this.outbox.publish(tx, 'characters.supplement_changed', 'characters', {
          userId,
          characterId,
          action: 'deleted',
        });
    });
  }

  /**
   * 3.1（积压 ㉝ / B7 遗留）：这位用户是否套用过检出儿童特征的预设改版（运行时按更严处理）。
   * 读独立的永久标记表（迁移 0083），一旦检出永不放松。
   */
  async variantChildFeaturesDetected(userId: string, characterId: string): Promise<boolean> {
    const [row] = await this.db.db
      .select({ id: userChildFeatureFlags.characterId })
      .from(userChildFeatureFlags)
      .where(
        and(
          eq(userChildFeatureFlags.userId, userId),
          eq(userChildFeatureFlags.characterId, characterId),
        ),
      );
    return !!row;
  }

  // ---------- 资料已更新 ----------

  /** 资料页红点：用户看过的版本 < 当前版本。第一次看到时记下当前版本（不显示红点）。 */
  async isUnseen(userId: string, characterId: string, currentVersion: number): Promise<boolean> {
    const [seen] = await this.db.db
      .select()
      .from(personaUpdateSeen)
      .where(
        and(eq(personaUpdateSeen.userId, userId), eq(personaUpdateSeen.characterId, characterId)),
      );
    if (seen) return seen.seenVersion < currentVersion;
    await this.db.db
      .insert(personaUpdateSeen)
      .values({ userId, characterId, seenVersion: currentVersion, updatedAt: this.clock.now() })
      .onConflictDoNothing();
    return false;
  }

  async listUpdates(
    userId: string,
    characterId: string,
  ): Promise<{ items: z.infer<typeof PersonaUpdateNote>[]; unseenCount: number }> {
    parseContract(Id, characterId);
    const character = await this.presetOrThrow(characterId);
    const rows = await this.db.db
      .select({
        version: personaVersions.version,
        summary: personaVersions.summary,
        publishedAt: personaVersions.publishedAt,
      })
      .from(personaVersions)
      .where(and(eq(personaVersions.characterId, characterId), gt(personaVersions.version, 1)))
      .orderBy(desc(personaVersions.version))
      .limit(20);
    const [seen] = await this.db.db
      .select()
      .from(personaUpdateSeen)
      .where(
        and(eq(personaUpdateSeen.userId, userId), eq(personaUpdateSeen.characterId, characterId)),
      );
    const seenVersion = seen?.seenVersion ?? character.personaVersion;
    const items = rows
      .filter((r) => r.summary && r.summary.trim())
      .map((r) =>
        PersonaUpdateNote.parse({
          personaVersion: r.version,
          summary: r.summary!.slice(0, 200),
          publishedAt: r.publishedAt.toISOString(),
        }),
      );
    return { items, unseenCount: items.filter((i) => i.personaVersion > seenVersion).length };
  }

  async markSeen(userId: string, characterId: string): Promise<void> {
    parseContract(Id, characterId);
    const character = await this.presetOrThrow(characterId);
    const now = this.clock.now();
    await this.db.db
      .insert(personaUpdateSeen)
      .values({ userId, characterId, seenVersion: character.personaVersion, updatedAt: now })
      .onConflictDoUpdate({
        target: [personaUpdateSeen.userId, personaUpdateSeen.characterId],
        set: { seenVersion: character.personaVersion, updatedAt: now },
      });
  }

  // ---------- 删除清单（由 CharacterService.purgeUser 调用） ----------

  async purgeUser(userId: string): Promise<number> {
    const a = await this.db.db
      .delete(userSupplements)
      .where(eq(userSupplements.userId, userId))
      .returning({ id: userSupplements.characterId });
    const b = await this.db.db
      .delete(personaUpdateSeen)
      .where(eq(personaUpdateSeen.userId, userId))
      .returning({ id: personaUpdateSeen.characterId });
    const c = await this.db.db
      .delete(userChildFeatureFlags)
      .where(eq(userChildFeatureFlags.userId, userId))
      .returning({ id: userChildFeatureFlags.characterId });
    return a.length + b.length + c.length;
  }

  async countUserData(userId: string): Promise<number> {
    const a = await this.db.db
      .select({ id: userSupplements.characterId })
      .from(userSupplements)
      .where(eq(userSupplements.userId, userId));
    const b = await this.db.db
      .select({ id: personaUpdateSeen.characterId })
      .from(personaUpdateSeen)
      .where(eq(personaUpdateSeen.userId, userId));
    const c = await this.db.db
      .select({ id: userChildFeatureFlags.characterId })
      .from(userChildFeatureFlags)
      .where(eq(userChildFeatureFlags.userId, userId));
    return a.length + b.length + c.length;
  }

  private async presetOrThrow(characterId: string) {
    const [row] = await this.db.db
      .select({
        kind: characters.kind,
        status: characters.status,
        personaVersion: characters.personaVersion,
      })
      .from(characters)
      .where(eq(characters.id, characterId));
    if (!row) throw new AppError('not_found', '找不到角色');
    if (row.kind !== 'preset')
      throw new AppError('bad_request', '补充设定只对预设角色可用；自定义角色请直接编辑人设');
    if (!['published', 'unpublished'].includes(row.status))
      throw new AppError('not_found', '找不到角色');
    return row;
  }
}
