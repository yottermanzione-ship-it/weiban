import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { newId } from '../src/platform/index.js';
import { describeDb, requireTestDatabaseUrl, resetTestDatabase } from './support/db.js';

describeDb('旧私密概括升级隔离：正式迁移与缓存边界', () => {
  let db: pg.Client;
  beforeAll(async () => {
    await resetTestDatabase();
    db = new pg.Client({ connectionString: requireTestDatabaseUrl() });
    await db.connect();
  });
  afterAll(async () => {
    await db?.end();
  });

  it('保留内容但纠正来源、废弃旧模型快照，回退不恢复泄漏范围', async () => {
    const user = newId(),
      character = newId(),
      conversation = newId(),
      parent = newId();
    const memory = newId(),
      otherMemory = newId(),
      plan = newId(),
      partial = newId(),
      group = newId(),
      groupMemory = newId();
    const opaque = Buffer.from('opaque-encrypted-fixture');
    await db.query(
      'INSERT INTO ai_runtime.memories(id,user_id,character_id,conversation_id,scope,ciphertext,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,now(),now()),($7,$8,$3,$4,$5,$6,now(),now())',
      [memory, user, character, conversation, 'normal', opaque, otherMemory, newId()],
    );
    await db.query(
      'INSERT INTO ai_runtime.memory_states(id,user_id,character_id,conversation_id,revision,window_block_ciphertext,updated_at) VALUES($1,$2,$3,$4,10,$5,now())',
      [parent, user, character, conversation, opaque],
    );
    await db.query(
      'INSERT INTO ai_runtime.private_digests(id,user_id,character_id,conversation_id,event_key,to_seq,memory_id,status,next_attempt_at,created_at,updated_at) VALUES($1,$2,$3,$4,$7,1,$5,$6,now(),now(),now())',
      [newId(), user, character, conversation, memory, 'done', newId()],
    );
    for (const [id, next] of [
      [plan, 0],
      [partial, 1],
    ] as const) {
      await db.query(
        "INSERT INTO ai_runtime.reply_plans(id,user_id,character_id,conversation_id,trigger_id,trigger_seq,kind,status,due_at,created_at,next_bubble,input_ciphertext,result_ciphertext,lease_id,lease_until) VALUES($1,$2,$3,$4,$5,1,$6,$7,now(),now(),$8,$9,$9,$10,now()+interval '1 minute')",
        [id, user, character, conversation, newId(), 'message', 'sending', next, opaque, newId()],
      );
    }
    await db.query(
      'INSERT INTO ai_runtime.group_reply_plans(id,user_id,conversation_id,trigger_message_id,trigger_seq,scope,status,plan_ciphertext,input_ciphertext,result_ciphertext,created_at,updated_at) VALUES($1,$2,$3,$4,1,$5,$6,$7,$7,$7,now(),now())',
      [group, user, conversation, newId(), 'normal', 'queued', opaque],
    );
    await db.query(
      'INSERT INTO ai_runtime.group_memory_states(id,user_id,conversation_id,last_user_at,pending_count,prepared_ciphertext,result_ciphertext) VALUES($1,$2,$3,now(),2,$4,$4)',
      [groupMemory, user, conversation, opaque],
    );
    await db.query('BEGIN');
    await db.query(
      readFileSync(
        new URL('../drizzle/0149_private_digest_quarantine.sql', import.meta.url),
        'utf8',
      ),
    );
    await db.query('COMMIT');
    const facts = await db.query<{ id: string; scope: string; ciphertext: Buffer }>(
      'SELECT id,scope,ciphertext FROM ai_runtime.memories WHERE id IN ($1,$2)',
      [memory, otherMemory],
    );
    expect(facts.rows.find((r) => r.id === memory)?.scope).toBe('adult');
    expect(facts.rows.find((r) => r.id === otherMemory)?.scope).toBe('normal');
    expect(facts.rows.every((r) => r.ciphertext.equals(opaque))).toBe(true);
    expect(
      (
        await db.query(
          'SELECT revision,window_block_ciphertext FROM ai_runtime.memory_states WHERE id=$1',
          [parent],
        )
      ).rows[0],
    ).toMatchObject({ revision: 11, window_block_ciphertext: null });
    const fresh = (
      await db.query(
        'SELECT status,input_ciphertext,result_ciphertext,lease_id,retry_epoch FROM ai_runtime.reply_plans WHERE id=$1',
        [plan],
      )
    ).rows[0];
    expect(fresh).toMatchObject({
      status: 'queued',
      input_ciphertext: null,
      result_ciphertext: null,
      lease_id: null,
      retry_epoch: 1,
    });
    expect(
      (await db.query('SELECT status FROM ai_runtime.reply_plans WHERE id=$1', [partial])).rows[0]
        ?.status,
    ).toBe('cancelled');
    expect(
      (
        await db.query(
          'SELECT status,plan_ciphertext,input_ciphertext,result_ciphertext,retry_epoch FROM ai_runtime.group_reply_plans WHERE id=$1',
          [group],
        )
      ).rows[0],
    ).toMatchObject({
      status: 'queued',
      plan_ciphertext: null,
      input_ciphertext: null,
      result_ciphertext: null,
      retry_epoch: 1,
    });
    expect(
      (
        await db.query(
          'SELECT generation,pending_count,prepared_ciphertext,result_ciphertext FROM ai_runtime.group_memory_states WHERE id=$1',
          [groupMemory],
        )
      ).rows[0],
    ).toMatchObject({
      generation: 1,
      pending_count: 2,
      prepared_ciphertext: null,
      result_ciphertext: null,
    });
    await db.query(
      readFileSync(
        new URL('../drizzle/0149_private_digest_quarantine.down.sql', import.meta.url),
        'utf8',
      ),
    );
    expect(
      (await db.query('SELECT scope FROM ai_runtime.memories WHERE id=$1', [memory])).rows[0]
        ?.scope,
    ).toBe('adult');
  });
});
