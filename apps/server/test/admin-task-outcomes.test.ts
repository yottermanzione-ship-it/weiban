import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  MODEL_TASK_OUTCOME_PORT,
  type ModelTaskOutcomePort,
  AdminModelTask,
  AdminTaskAttempt,
} from '@weiban/contracts';
import { createApp } from '../src/main.js';
import { Database, DATABASE, TestClock, newId, modelTaskKey } from '../src/platform/index.js';
import {
  AdminTaskService,
  UsageRecorder,
  ModelAccessLifecycle,
} from '../src/modules/model-access/testing.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import { BillingAdminService } from '../src/modules/billing/testing.js';
import { describeDb, resetTestDatabase } from './support/db.js';
import { testConfig, captureLogger, testKekRing } from './support/fixtures.js';

describeDb('管理任务结果：业务证据、账本与原始线路', () => {
  let app: INestApplication,
    db: Database,
    admin: string,
    svc: AdminTaskService,
    receipts: ModelTaskOutcomePort;
  const clock = new TestClock('2026-11-20T04:00:00Z');
  const filter = { from: '2026-11-20T00:00:00Z', to: '2026-11-21T00:00:00Z' };
  beforeAll(async () => {
    await resetTestDatabase();
    app = await createApp({
      config: testConfig(),
      clock,
      logger: captureLogger().logger,
      kekRing: testKekRing().ring,
      background: false,
    });
    await app.init();
    db = app.get(DATABASE);
    svc = app.get(AdminTaskService);
    receipts = app.get(MODEL_TASK_OUTCOME_PORT);
    admin = await app.get(IdentityCommands).createAdmin('task_reader', 'local test password');
  });
  afterAll(async () => {
    await app?.close();
  });
  it('同一任务含失败主线、跨模型备用入库与退款；金额逐用量ID核验', async () => {
    const taskKey = modelTaskKey(admin, 'fixture-dialogue');
    const usage = app.get(UsageRecorder);
    const first = await usage.start({
      input: {
        userId: admin,
        taskKey,
        purpose: 'chat_reply',
        billingOwner: 'user',
        modelRole: 'chat',
        idempotencyKey: newId(),
      },
      upstreamId: newId(),
      upstreamModelId: 'head',
      modelKey: 'fixture/head',
      countsAsBackground: false,
    });
    await usage.finish(first.record.id, {
      status: 'failed',
      errorCode: 'timeout_progress',
      inputTokens: 700,
      cachedInputTokens: 0,
      outputTokens: 0,
      estimated: true,
      latencyMs: 1200,
      retryCount: 0,
    });
    await usage.writeReleaseSnapshot(first.record.id, { absorbedCostMicros: 420, costKnown: true });
    clock.advance(50);
    const second = await usage.start({
      input: {
        userId: admin,
        taskKey,
        purpose: 'chat_reply',
        billingOwner: 'user',
        modelRole: 'chat',
        idempotencyKey: newId(),
      },
      upstreamId: newId(),
      upstreamModelId: 'other',
      modelKey: 'fixture/other',
      countsAsBackground: false,
    });
    await usage.finish(second.record.id, {
      status: 'succeeded',
      inputTokens: 210000,
      cachedInputTokens: 1200,
      cacheWrite5mTokens: 65,
      cacheWrite1hTokens: 80,
      outputTokens: 100,
      estimated: false,
      latencyMs: 400,
      retryCount: 0,
    });
    const price = newId();
    await usage.writeSettleSnapshot(second.record.id, {
      ledgerEntryId: newId(),
      costKnown: true,
      costMicros: 450,
      amountMicros: 700,
    });
    await db.query('UPDATE model_access.usage_records SET price_version_id=$1 WHERE id=$2', [
      price,
      second.record.id,
    ]);
    await app.get(BillingAdminService).adjust(admin, admin, {
      direction: 'grant',
      amountMicros: 50000,
      reason: '本机测试',
      idempotencyKey: newId(),
    });
    await db.query(
      `INSERT INTO billing.ledger_entries(id,account_id,created_at,type,amount_micros,balance_after_micros,idempotency_key,usage_record_id,absorbed,safety_overdraft)
     SELECT gen_random_uuid(),a.id,now(),v.t,v.amount,50000,gen_random_uuid()::text,$2,false,false FROM billing.accounts a CROSS JOIN (VALUES('charge',-700),('refund',700)) v(t,amount) WHERE a.user_id=$1`,
      [admin, second.record.id],
    );
    const attempt = await usage.startAttempt({
      generationId: newId(),
      userId: admin,
      ordinal: 0,
      upstreamId: first.record.upstreamId,
      modelKey: 'fixture/head',
      upstreamModelId: 'head',
      usageRecordId: first.record.id,
      holdId: newId(),
      boundSnapshot: {
        dispatchTiming: {
          deadlineMs: 2300,
          adapterElapsedMs: 1200,
          progressTimeoutMs: 1100,
          routePriority: 1,
        },
        providerDiagnostic: {
          httpStatus: 503,
          stage: 'read',
          privateValue: 'sensitive-fixture',
          providerCode: 'bad value / raw',
        },
      },
    });
    await usage.finishAttempt(attempt, null, false, 'timeout_progress', 'estimated');
    const before = (await svc.list({ filter, limit: 10 })).items[0]!;
    expect(before.state).toBe('unverified');
    expect(before.rescued).toBe(false);
    await receipts.record({
      taskKey,
      userId: admin,
      purpose: 'chat_reply',
      state: 'delivered',
      usageRecordId: second.record.id,
    });
    await receipts.record({
      taskKey,
      userId: admin,
      purpose: 'chat_reply',
      state: 'failed',
      reason: 'late_failure',
    });
    await expect(
      receipts.record({
        taskKey,
        userId: newId(),
        purpose: 'chat_reply',
        state: 'delivered',
        usageRecordId: second.record.id,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    const result = await svc.list({
      filter: { ...filter, modelKey: 'fixture/head', state: 'message_saved', rescued: true },
      limit: 4,
    });
    expect(result.items.map((t) => AdminModelTask.parse(t))).toMatchObject([
      {
        taskKey,
        state: 'message_saved',
        attemptCount: 2,
        failedAttempts: 1,
        modelCount: 2,
        rescued: true,
        chargedMicros: 700,
        refundedMicros: 700,
        estimatedCostMicros: 420,
        reportedCostMicros: 450,
      },
    ]);
    const detail = await svc.attempts({ taskKey, limit: 1 });
    expect(AdminTaskAttempt.parse(detail.items[0])).toMatchObject({
      usageRecordId: first.record.id,
      sent: 'sent',
      deadlineMs: 2300,
      diagnostic: { httpStatus: 503, stage: 'read' },
    });
    expect(JSON.stringify(detail)).not.toContain('sensitive-fixture');
    expect(
      (await svc.attempts({ taskKey, limit: 1, cursor: detail.nextCursor! })).items[0],
    ).toMatchObject({
      inputTokens: 210000,
      cachedInputTokens: 1200,
      priceVersionId: price,
      chargedMicros: 700,
      refundedMicros: 700,
    });
  });
  it('旧缓存采用可认领未标任务的行，已清理的用量仅记业务回执，不冒用其他用户或用途', async () => {
    const key = modelTaskKey(admin, 'legacy-job');
    const { record } = await app.get(UsageRecorder).start({
      input: {
        userId: admin,
        purpose: 'memory',
        billingOwner: 'user',
        modelRole: 'background',
        idempotencyKey: newId(),
      },
      modelKey: 'fixture/legacy',
      upstreamId: newId(),
      upstreamModelId: 'legacy',
      countsAsBackground: true,
    });
    await receipts.record({
      taskKey: key,
      userId: admin,
      purpose: 'memory',
      state: 'saved',
      usageRecordId: record.id,
    });
    const result = await db.query<{ task_key: string }>(
      'SELECT task_key FROM model_access.usage_records WHERE id=$1',
      [record.id],
    );
    expect(result.rows[0]?.task_key).toBe(key);
    await expect(
      receipts.record({
        taskKey: key,
        userId: admin,
        purpose: 'chat_reply',
        state: 'delivered',
        usageRecordId: record.id,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    const orphan = newId();
    await receipts.record({
      taskKey: orphan,
      userId: admin,
      purpose: 'memory',
      state: 'saved',
      usageRecordId: newId(),
    });
    expect(
      (
        await db.query(
          'SELECT state,usage_record_id FROM model_access.task_outcomes WHERE task_key=$1',
          [orphan],
        )
      ).rows,
    ).toEqual([{ state: 'saved', usage_record_id: null }]);
    const overview = await svc.overview(filter);
    expect(overview.total).toBeGreaterThanOrEqual(3);
    expect(overview.rescued).toBe(1);
  });
  it('无调用回执、跨页、撤销事务、精确关联与普通用户权限', async () => {
    const userId = newId();
    const source = modelTaskKey(userId, 'version-1');
    await expect(
      db.transaction(async (tx) => {
        await receipts.record({ taskKey: source, userId, purpose: 'memory', state: 'saved' }, tx);
        throw Error('回滚');
      }),
    ).rejects.toThrow('回滚');
    expect(
      (await svc.list({ filter: { ...filter, userIds: [userId] }, limit: 1 })).items,
    ).toHaveLength(0);
    for (const [index, state] of [
      'deferred',
      'filtered',
      'displayed',
      'failed',
      'blocked',
      'cancelled',
    ].entries()) {
      await receipts.record({
        taskKey: modelTaskKey(userId, 'task-' + index),
        userId,
        purpose: 'memory',
        state: state as 'deferred',
        reason: state === 'blocked' ? 'insufficient_balance' : 'fixture_reason',
        retryAt: state === 'deferred' ? filter.to : null,
      });
    }
    const list = await svc.list({ filter: { ...filter, userIds: [userId] }, limit: 2 });
    const ids = list.items.map((x) => x.taskKey);
    let cursor = list.nextCursor;
    while (cursor) {
      const page = await svc.list({ filter: { ...filter, userIds: [userId] }, limit: 2, cursor });
      ids.push(...page.items.map((x) => x.taskKey));
      cursor = page.nextCursor;
    }
    expect(new Set(ids).size).toBe(6);
    const deferred = await svc.list({
      filter: { ...filter, userIds: [userId], state: 'retry_pending' },
      limit: 2,
    });
    expect(deferred.items[0]).toMatchObject({
      retryAt: new Date(filter.to).toISOString(),
      attemptCount: 0,
      state: 'retry_pending',
    });
    expect((await svc.export(admin, { ...filter, userIds: [userId] })).items).toHaveLength(6);
    expect(
      (await db.query("SELECT id FROM platform.audit_log WHERE action='tasks.exported'")).rowCount,
    ).toBe(1);
    const endpoint = '/api/v1/admin/model/usage/tasks';
    await request(app.getHttpServer()).post(endpoint).send({ filter }).expect(401);
    const registered = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        username: 'task_regular',
        password: 'local test password',
        device: {
          name: 'task-browser',
          platform: 'web',
          appVersion: '0.1.0',
          timeZone: 'Asia/Shanghai',
        },
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(endpoint)
      .set('authorization', 'Bearer ' + registered.body.session.token)
      .send({ filter })
      .expect(403);
    await app.get(ModelAccessLifecycle).purgeUser(userId);
    expect(await app.get(ModelAccessLifecycle).countUserData(userId)).toBe(0);
  });
  it('分别显示已保存决策、规则兜底、碎碎念过滤和派发待核', async () => {
    const userId = newId();
    for (const [state, reason] of [
      ['saved', 'jev_declined'],
      ['filtered', 'planning_rules_timeout'],
      ['filtered', 'display_filter'],
      ['blocked', 'interrupted'],
    ] as const) {
      await receipts.record({
        taskKey: newId(),
        userId,
        purpose: 'behavior_planning',
        state,
        reason,
      });
    }
    const result = await svc.list({ filter: { ...filter, userIds: [userId] }, limit: 10 });
    expect(Object.fromEntries(result.items.map((item) => [item.reason, item.state]))).toEqual({
      jev_declined: 'planning_saved',
      planning_rules_timeout: 'rules_used',
      display_filter: 'thought_filtered',
      interrupted: 'needs_review',
    });
  });
  it('迁移按保留的真实幂等哈希关联跨模型旧尝试，仅采纳有展示证据的碎碎念', async () => {
    const owner = newId(),
      role = newId(),
      run = newId(),
      biz = 'eco:murmur:' + run;
    const usage = app.get(UsageRecorder);
    await db.query(
      `INSERT INTO ai_runtime.ecology_runs(id,user_id,character_id,origin,run_key,local_date,status,scheduled_at,created_at,finished_at,murmur_ciphertext) VALUES($1,$2,$3,'ecology','fixture','2026-11-20','done',$4,$4,$4,decode('00','hex'))`,
      [run, owner, role, clock.now()],
    );
    for (const [index, modelKey] of ['fixture/first', 'fixture/standby'].entries()) {
      const gid = newId(),
        at = clock.now();
      clock.advance(1);
      const key = index ? 'chatfallback:' + biz + ':' + modelKey : biz;
      const keyHash = createHash('sha256')
        .update(owner + '\0' + key)
        .digest('hex');
      const { record } = await usage.start({
        input: {
          userId: owner,
          characterId: role,
          purpose: 'behavior_planning',
          billingOwner: 'user',
          modelRole: 'chat',
          idempotencyKey: `gateway:${gid}:attempt:0`,
          meta: { promptTemplateVersion: 'ecology-murmur-v1' },
        },
        modelKey,
        upstreamId: newId(),
        upstreamModelId: modelKey,
        countsAsBackground: false,
      });
      await usage.finish(record.id, {
        status: index ? 'succeeded' : 'failed',
        errorCode: index ? null : 'timeout_idle',
        inputTokens: 5,
        outputTokens: 2,
        cachedInputTokens: 0,
        estimated: false,
        latencyMs: 10,
        retryCount: 0,
      });
      await db.query(
        `INSERT INTO model_access.generation_results(id,user_id,key_hash,request_hash,phase,created_at,expires_at) VALUES ($1,$2,$3,'fixture','complete',$4,$4::timestamptz+interval '1 day')`,
        [gid, owner, keyHash, at],
      );
      await usage.startAttempt({
        generationId: gid,
        userId: owner,
        ordinal: 0,
        modelKey,
        upstreamId: record.upstreamId,
        upstreamModelId: modelKey,
        usageRecordId: record.id,
        holdId: newId(),
        boundSnapshot: {},
      });
    }
    // 旧版把纯发前拦截的回复计划也记为 cancelled/failed。用量行可没有 hold 或 attempt。
    const oldReply = newId(),
      conversation = newId(),
      generation = newId();
    await db.query(
      `INSERT INTO ai_runtime.reply_plans(id,user_id,character_id,conversation_id,trigger_id,trigger_seq,kind,status,due_at,created_at,failure)
     VALUES($1,$2,$3,$4,$5,1,'message','cancelled',$6,$6,'model_failure')`,
      [oldReply, owner, role, conversation, newId(), clock.now()],
    );
    const exactHash = createHash('sha256')
      .update(owner + '\0ai:' + oldReply + ':0:reply')
      .digest('hex');
    await db.query(
      `INSERT INTO model_access.generation_results(id,user_id,key_hash,request_hash,phase,created_at,expires_at)
     VALUES($1,$2,$3,'fixture','complete',$4,$4::timestamptz + interval '1 day')`,
      [generation, owner, exactHash, clock.now()],
    );
    const blocked = await usage.start({
      input: {
        userId: owner,
        characterId: role,
        conversationId: conversation,
        purpose: 'chat_reply',
        billingOwner: 'user',
        modelRole: 'chat',
        idempotencyKey: `gateway:${generation}:attempt:0`,
      },
      modelKey: 'fixture/chat',
      upstreamId: newId(),
      upstreamModelId: 'fixture',
      countsAsBackground: false,
    });
    await usage.finish(blocked.record.id, {
      status: 'failed',
      errorCode: 'insufficient_balance',
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      estimated: false,
      latencyMs: 0,
      retryCount: 0,
    });
    await db.transaction(async (tx) => {
      for (const suffix of ['.down', ''])
        await tx.query(
          readFileSync(
            new URL(`../drizzle/0168_model_task_outcomes${suffix}.sql`, import.meta.url),
            'utf8',
          ),
        );
      expect(
        (
          await tx.query('SELECT state,reason FROM model_access.task_outcomes WHERE task_key=$1', [
            modelTaskKey(owner, 'reply:' + oldReply),
          ])
        ).rows,
      ).toEqual([{ state: 'blocked', reason: 'insufficient_balance' }]);
      const taskKey = modelTaskKey(owner, biz);
      expect(
        (
          await tx.query('SELECT state,purpose FROM model_access.task_outcomes WHERE task_key=$1', [
            taskKey,
          ])
        ).rows,
      ).toEqual([{ state: 'displayed', purpose: 'behavior_planning' }]);
      expect(
        (
          await tx.query(
            'SELECT count(*)::int n FROM model_access.usage_records WHERE task_key=$1',
            [taskKey],
          )
        ).rows,
      ).toEqual([{ n: 2 }]);
    });
  });
});
