import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import {
  ReplyPlanStore,
  PlayContinuityStore,
  proactivePlans,
} from '../src/modules/ai-runtime/testing.js';
import { TestClock, newId } from '../src/platform/index.js';
import { describeDb, resetTestDatabase } from './support/db.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';

describeDb('PLAY-03/05 连续性：真实数据库与用户密钥', () => {
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  let continuity: PlayContinuityStore;
  let store: ReplyPlanStore;
  let userId: string;
  const characterId = newId();
  const clock = new TestClock('2026-10-11T04:00:00Z');
  beforeAll(async () => {
    await resetTestDatabase();
    moduleRef = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config: testConfig({ APP_ROLE: 'web' }),
          clock,
          logger: captureLogger().logger,
          kekRing: testKekRing().ring,
          background: false,
        }),
      ],
    }).compile();
    userId = await moduleRef
      .get(IdentityCommands)
      .createAdmin('continuity_user', 'correct horse battery');
    continuity = moduleRef.get(PlayContinuityStore);
    store = moduleRef.get(ReplyPlanStore);
  });
  afterAll(async () => {
    await moduleRef?.close();
  });

  it('相同话题并发只有一种自述；正文加密、不串用户、不泄漏成人范围', async () => {
    const answers = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        continuity.rememberAnswer(
          userId,
          characterId,
          newId(),
          '最喜欢的季节？',
          `SELF_REPORT_CANARY_${i}`,
          'normal',
        ),
      ),
    );
    expect(new Set(answers).size).toBe(1);
    const rows = await store.db.query<{ payload_ciphertext: Buffer }>(
      'SELECT payload_ciphertext FROM ai_runtime.character_self_reports WHERE user_id=$1',
      [userId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.payload_ciphertext.toString('utf8')).not.toContain('SELF_REPORT_CANARY');
    expect(await continuity.context(newId(), characterId, 'adult')).toBe('');
    await continuity.rememberAnswer(
      userId,
      characterId,
      newId(),
      '私密话题',
      'ADULT_REPORT_CANARY',
      'adult',
    );
    expect(await continuity.context(userId, characterId, 'normal')).not.toContain(
      'ADULT_REPORT_CANARY',
    );
    expect(await continuity.context(userId, characterId, 'adult')).toContain('ADULT_REPORT_CANARY');
  });

  it('待寄计划跨日恢复使用原幂等键；生成中不抢占；送达或删除角色后清队列', async () => {
    const now = clock.now();
    const [plan] = await store.db.db
      .insert(proactivePlans)
      .values({
        id: newId(),
        userId,
        characterId,
        sourceRef: 'play_letter_anniv:test:2026-10-11',
        topicKey: 'anniv:test',
        reason: 'anniversary',
        brief: 'LETTER_BRIEF_CANARY',
        priority: 110,
        isHoliday: false,
        status: 'dropped',
        localDate: '2026-10-11',
        dueAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await continuity.keepLetter(plan!);
    await continuity.keepLetter(plan!);
    const pending = await store.db.query<{ payload_ciphertext: Buffer }>(
      'SELECT payload_ciphertext FROM ai_runtime.pending_anniversary_letters WHERE user_id=$1',
      [userId],
    );
    expect(pending.rows).toHaveLength(1);
    expect(pending.rows[0]!.payload_ciphertext.toString('utf8')).not.toContain(
      'LETTER_BRIEF_CANARY',
    );
    clock.advance(86400_000);
    await continuity.restoreLetters(userId, '2026-10-12', [characterId]);
    let [restored] = await store.db.db
      .select()
      .from(proactivePlans)
      .where(eq(proactivePlans.id, plan!.id));
    expect(restored).toMatchObject({
      id: plan!.id,
      status: 'planned',
      localDate: '2026-10-12',
      sourceRef: plan!.sourceRef,
    });
    await store.db.db
      .update(proactivePlans)
      .set({ status: 'generating' })
      .where(eq(proactivePlans.id, plan!.id));
    await continuity.restoreLetters(userId, '2026-10-13', [characterId]);
    [restored] = await store.db.db
      .select()
      .from(proactivePlans)
      .where(eq(proactivePlans.id, plan!.id));
    expect(restored?.status).toBe('generating');
    await continuity.restoreLetters(userId, '2026-10-13', []);
    expect(
      (
        await store.db.query(
          'SELECT * FROM ai_runtime.pending_anniversary_letters WHERE user_id=$1',
          [userId],
        )
      ).rows,
    ).toHaveLength(0);
  });

  it('注销清除存档，迟到生成不能重新写入', async () => {
    await store.db.query("UPDATE identity.users SET status='deleting' WHERE id=$1", [userId]);
    await store.purgeUser(userId);
    expect(
      await continuity.rememberAnswer(
        userId,
        characterId,
        newId(),
        '迟到问题',
        '迟到回答',
        'normal',
      ),
    ).toBeNull();
    expect(
      (
        await store.db.query('SELECT * FROM ai_runtime.character_self_reports WHERE user_id=$1', [
          userId,
        ])
      ).rows,
    ).toHaveLength(0);
    expect(await store.countUserData(userId)).toBe(0);
  });
});
