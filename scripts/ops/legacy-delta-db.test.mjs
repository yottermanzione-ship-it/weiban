import '../../apps/server/node_modules/reflect-metadata/Reflect.js';
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  openLab,
  addFixtureUser,
  addFixtureConversation,
  fixtureIncoming,
  fixturePlan,
  validateContent,
  maintenance,
  clock,
  cutoff,
  initialCutoff,
} from './legacy-delta-lab.mjs';
import {
  applyConversationDelta,
  applyMissingAccounts,
  readConversationBaseline,
  sequenceReferenceRegistry,
  assertFixtureDatabase,
} from './legacy-delta-db.mjs';
import {
  fingerprint,
  planAccounts,
  invariant,
  prepareLegacyChatRows,
  planConversationDelta,
} from './legacy-delta-core.mjs';
import {
  initializeRelationFixture,
  readLegacyRelationsBaseline,
  planLegacyRelations,
  applyLegacyRelations,
} from './legacy-delta-relations.mjs';
import { PasswordHasher } from '../../apps/server/src/modules/identity/infra/password-hasher.ts';
import { UpdateLogService } from '../../apps/server/src/modules/realtime/application/update-log.ts';
import { ChatStore } from '../../apps/server/src/modules/chat/application/store.ts';
import { ChatReadService } from '../../apps/server/src/modules/chat/application/read.ts';
import { SyncEngine } from '../../packages/client-core/src/sync-engine.ts';

const require = createRequire(new URL('../../apps/server/package.json', import.meta.url));
const { hash: bcryptHash } = require('@node-rs/bcrypt');
const url = process.env.MIGRATION_LAB_DATABASE_URL;
invariant(url, 'MIGRATION_LAB_DATABASE_URL_REQUIRED_NO_SHARED_DEFAULT');
let lab, account;
before(async () => {
  lab = await openLab(url);
  account = await addFixtureUser(lab);
});
after(async () => {
  await lab?.close();
});
const apply = (plan, extra = {}) =>
  applyConversationDelta({ ...lab, plan, validateContent, maintenance, ...extra });

test('完整当前表结构的序号字段清单与迁移映射一致', async () => {
  const rows = (
    await lab.database.query(
      "SELECT table_schema||'.'||table_name AS tbl,column_name AS col FROM information_schema.columns WHERE table_schema IN ('chat','ai_runtime','library','channels') AND column_name ~ '(^seq$|_seq$)' ORDER BY 1,2",
    )
  ).rows;
  const expected = sequenceReferenceRegistry
    .flatMap((item) => item.columns.map((column) => item.table + '.' + column))
    .concat([
      'chat.messages.seq',
      'chat.conversations.last_seq',
      'chat.participants.read_seq',
      'chat.user_conversation_states.read_seq',
      'chat.user_conversation_states.cleared_through_seq',
      // Explicit non-chat ordinals: daily activity order, and the QQ provider's
      // per-inbound-message reply counter (qq-session-store.ts claimReply resets/increments it).
      'ai_runtime.daily_events.seq',
      'channels.outbound_messages.qq_reply_seq',
      'channels.qq_sessions.reply_seq',
    ])
    .sort();
  assert.deepEqual(
    rows
      .map((row) => row.tbl + '.' + row.col)
      .sort(),
    expected,
  );
});

test('真实数据库交错合并、密文解密、隐藏/清空、引用和重跑幂等', async () => {
  const f = await addFixtureConversation(lab, {
    owner: account.id,
    protectedState: true,
    seed: 1000,
  });
  const before = await readConversationBaseline(lab.database, f.id);
  await lab.database.query('INSERT INTO chat.hidden_messages(message_id,user_id) VALUES($1,$2)', [
    before.messages[2].id,
    f.owner,
  ]);
  await lab.database.query(
    "UPDATE chat.messages SET status='recalled',content_ciphertext=NULL,recalled_at=$2 WHERE id=$1",
    [before.messages[3].id, cutoff],
  );
  const incoming = fixtureIncoming(f);
  incoming[1].quote_message_id = before.messages[0].id;
  const plan = await fixturePlan(lab, f, incoming);
  assert.deepEqual(await apply(plan), { status: 'applied', inserted: 3 });
  const result = await readConversationBaseline(lab.database, f.id);
  assert.deepEqual(
    result.messages.map((row) => Number(row.seq)),
    [1, 2, 3, 4, 5, 6, 7],
  );
  assert.equal(result.states[0].read_seq, '4');
  assert.equal(result.states[0].cleared_through_seq, '2');
  assert.equal(result.states[0].hidden, true);
  assert.equal(result.states[0].marked_unread, true);
  assert.equal(result.hidden.length, 1);
  assert.equal(result.messages.at(-1).status, 'recalled');
  assert.equal(result.messages[2].quote_message_id, before.messages[0].id);
  const buffer = await lab.crypto.open(
    f.owner,
    `chat:message:${incoming[0].id}`,
    result.messages[0].content_ciphertext,
  );
  try {
    assert.deepEqual(JSON.parse(buffer.toString()), incoming[0].content);
  } finally {
    buffer.fill(0);
  }
  await assert.rejects(
    lab.crypto.open(
      randomUUID(),
      `chat:message:${incoming[0].id}`,
      result.messages[0].content_ciphertext,
    ),
  );
  const digest = fingerprint(result);
  assert.equal((await apply(plan)).status, 'already_applied');
  assert.equal(fingerprint(await readConversationBaseline(lab.database, f.id)), digest);
  assert.equal((await apply(await fixturePlan(lab, f, incoming))).status, 'unchanged');
});

async function addWeiboBoundary(fixture, slot, boundary) {
  const bindingId = randomUUID();
  const peer = await lab.crypto.seal(
    fixture.owner,
    `synthetic:weibo-peer:${bindingId}`,
    'synthetic-peer',
  );
  await lab.database.query(
    `INSERT INTO channels.bindings(id,user_id,channel,slot,status,character_id,character_name,
      generation,context_token_sealed,reply_conversation_id,reply_after_seq,created_at,updated_at)
      VALUES($1,$2,'weibo',$3,'active',$4,'合成角色',4,$5,$6,$7,$8,$8)`,
    [
      bindingId,
      fixture.owner,
      slot,
      fixture.peer,
      peer,
      boundary === null ? null : fixture.id,
      boundary,
      cutoff,
    ],
  );
  return bindingId;
}

test('微博回复边界随历史重排并使旧代际失效，边界两侧身份、其他槽及密文保持', async () => {
  const owner = (await addFixtureUser(lab)).id;
  const f = await addFixtureConversation(lab, { owner, seed: 17000 });
  const other = await addFixtureConversation(lab, { owner, seed: 18000 });
  const bindingId = await addWeiboBoundary(f, 'main', 2);
  const otherId = await addWeiboBoundary(other, 'blue', 1);
  const unconfiguredId = await addWeiboBoundary(
    await addFixtureConversation(lab, { owner, seed: 19000 }),
    'white',
    null,
  );
  const bindingsBefore = (
    await lab.database.query('SELECT * FROM channels.bindings WHERE user_id=$1 ORDER BY id', [
      owner,
    ])
  ).rows;
  const before = await readConversationBaseline(lab.database, f.id);
  const eligibleIds = before.messages
    .filter((m) => Number(m.seq) > 2)
    .map((m) => m.id)
    .sort();
  const plan = await fixturePlan(lab, f);
  await apply(plan);
  const after = await readConversationBaseline(lab.database, f.id);
  const bindingsAfter = (
    await lab.database.query('SELECT * FROM channels.bindings WHERE user_id=$1 ORDER BY id', [
      owner,
    ])
  ).rows;
  const current = bindingsAfter.find((row) => row.id === bindingId);
  assert.equal(Number(current.reply_after_seq), 4);
  assert.deepEqual(
    after.messages
      .filter(
        (m) =>
          before.messages.some((old) => old.id === m.id) &&
          Number(m.seq) > Number(current.reply_after_seq),
      )
      .map((m) => m.id)
      .sort(),
    eligibleIds,
  );
  const previous = bindingsBefore.find((row) => row.id === bindingId);
  assert.equal(current.generation, previous.generation + 1);
  assert.deepEqual(
    { ...current, reply_after_seq: previous.reply_after_seq, generation: previous.generation },
    previous,
  );
  for (const id of [otherId, unconfiguredId])
    assert.deepEqual(
      bindingsAfter.find((row) => row.id === id),
      bindingsBefore.find((row) => row.id === id),
    );
  assert.equal((await apply(plan)).status, 'already_applied');
  assert.equal(
    (await lab.database.query('SELECT generation FROM channels.bindings WHERE id=$1', [bindingId]))
      .rows[0].generation,
    current.generation,
  );
});

test('渠道既有排队与尚未消费的消息事件必须排空，边界改变使旧迁移计划拒绝', async () => {
  const owner = (await addFixtureUser(lab)).id;
  const f = await addFixtureConversation(lab, { owner, seed: 20000 });
  const bindingId = await addWeiboBoundary(f, 'main', 2);
  const before = await readConversationBaseline(lab.database, f.id);
  const plan = await fixturePlan(lab, f);
  const queuedId = randomUUID();
  await lab.database.query(
    `INSERT INTO channels.outbound_messages(id,binding_id,user_id,channel,chat_message_id,text_sealed,
      status,next_attempt_at,created_at,updated_at) VALUES($1,$2,$3,'weibo',$4,$5,'pending',$6,$6,$6)`,
    [
      queuedId,
      bindingId,
      owner,
      before.messages[0].id,
      await lab.crypto.seal(owner, `synthetic:outbound:${queuedId}`, 'synthetic-outbound'),
      cutoff,
    ],
  );
  await assert.rejects(apply(plan), /CHANNEL_DELIVERY_MUST_DRAIN/);
  assert.equal(
    fingerprint(await readConversationBaseline(lab.database, f.id)),
    fingerprint(before),
  );
  await lab.database.query("UPDATE channels.outbound_messages SET status='sent' WHERE id=$1", [
    queuedId,
  ]);
  const eventId = randomUUID();
  await lab.database.query(
    `INSERT INTO platform.outbox(id,event_type,producer,event,occurred_at,created_at,next_attempt_at)
      VALUES($1,'chat.message_created','chat',$2,$3,$3,$3)`,
    [eventId, { payload: { conversationId: f.id, messageId: before.messages[0].id } }, cutoff],
  );
  await assert.rejects(apply(plan), /CHANNEL_DELIVERY_MUST_DRAIN/);
  assert.equal(
    fingerprint(await readConversationBaseline(lab.database, f.id)),
    fingerprint(before),
  );
  await lab.database.query('UPDATE platform.outbox SET dispatched_at=$2 WHERE id=$1', [
    eventId,
    cutoff,
  ]);
  await lab.database.query('UPDATE channels.bindings SET generation=generation+1 WHERE id=$1', [
    bindingId,
  ]);
  await assert.rejects(apply(plan), /TARGET_CHANGED_REPLAN_REQUIRED/);
  const revised = await fixturePlan(lab, f);
  await apply(revised);
  assert.equal(
    (await lab.database.query('SELECT generation FROM channels.bindings WHERE id=$1', [bindingId]))
      .rows[0].generation,
    6,
  );
});

test('两处断点故障全部回滚，目标并发变化使旧计划失效', async () => {
  const f = await addFixtureConversation(lab, { owner: account.id, seed: 2000 });
  const baseline = fingerprint(await readConversationBaseline(lab.database, f.id));
  const plan = await fixturePlan(lab, f);
  for (const stage of ['after_sequence_shift', 'before_receipt']) {
    await assert.rejects(
      apply(plan, {
        fault: (at) => {
          if (at === stage) throw new Error('SYNTHETIC_INTERRUPTION');
        },
      }),
      /SYNTHETIC_INTERRUPTION/,
    );
    assert.equal(fingerprint(await readConversationBaseline(lab.database, f.id)), baseline);
  }
  await lab.database.query(
    'UPDATE chat.user_conversation_states SET muted=true WHERE conversation_id=$1',
    [f.id],
  );
  await assert.rejects(apply(plan), /TARGET_CHANGED/);
  assert.equal((await apply(await fixturePlan(lab, f))).inserted, 3);
});

test('并发重试同计划只入一次，旧密码和资产原样保留', async () => {
  const f = await addFixtureConversation(lab, { owner: account.id, seed: 3000 });
  const plan = await fixturePlan(lab, f);
  const states = await Promise.all([apply(plan), apply(plan)]);
  assert.deepEqual(states.map((row) => row.status).sort(), ['already_applied', 'applied']);
  assert.equal(
    (await lab.database.query('SELECT password_hash FROM identity.users WHERE id=$1', [account.id]))
      .rows[0].password_hash,
    account.hash,
  );
});

test('全部关联序号随原消息移动；记忆和收藏内容本身不改写', async () => {
  const f = await addFixtureConversation(lab, { owner: account.id, seed: 4000 });
  const base = await readConversationBaseline(lab.database, f.id);
  const memory = randomUUID(),
    summary = randomUUID();
  const data = Buffer.from('synthetic-encrypted-placeholder');
  await lab.database.query(
    'INSERT INTO ai_runtime.memory_states(id,user_id,character_id,conversation_id,barrier_seq,cursor_seq,window_start_seq,fact_trigger_seq,updated_at) VALUES($1,$2,$3,$4,1,2,1,2,$5)',
    [memory, f.owner, f.peer, f.id, cutoff],
  );
  await lab.database.query(
    "INSERT INTO ai_runtime.chat_summary_states(id,parent_id,scope,covered_seq,target_seq,updated_at) VALUES($1,$2,'normal',2,2,$3)",
    [summary, memory, cutoff],
  );
  await lab.database.query(
    'INSERT INTO ai_runtime.chat_summary_versions(id,state_id,version,from_seq,to_seq,ciphertext,created_at) VALUES($1,$2,1,1,2,$3,$4)',
    [randomUUID(), summary, data, cutoff],
  );
  await lab.database.query(
    "INSERT INTO ai_runtime.model_blocked_messages(conversation_id,seq,user_id,character_id,message_id,source) VALUES($1,2,$2,$3,$4,'manual')",
    [f.id, f.owner, f.peer, base.messages[1].id],
  );
  await lab.database.query(
    "INSERT INTO library.favorites(id,user_id,source_kind,source_id,conversation_id,content_ciphertext,content_type,source_created_at,created_at,source_seq) VALUES($1,$2,'message',$3,$4,$5,'text',$6,$6,2)",
    [randomUUID(), f.owner, base.messages[1].id, f.id, data, cutoff],
  );
  await apply(await fixturePlan(lab, f));
  const after = await readConversationBaseline(lab.database, f.id);
  const row = (table) => after.references.find((item) => item.table === table).rows[0];
  assert.equal(Number(row('ai_runtime.memory_states').barrier_seq), 2);
  assert.equal(Number(row('ai_runtime.memory_states').cursor_seq), 4);
  assert.equal(Number(row('ai_runtime.chat_summary_states').covered_seq), 4);
  assert.equal(Number(row('ai_runtime.chat_summary_versions').from_seq), 2);
  assert.equal(Number(row('ai_runtime.chat_summary_versions').to_seq), 4);
  assert.equal(Number(row('ai_runtime.model_blocked_messages').seq), 4);
  assert.equal(Number(row('library.favorites').source_seq), 4);
  assert.deepEqual(row('library.favorites').content_ciphertext, data);
});

test('真实同步过期响应驱动真实客户端重建，跨用户历史访问仍被拒绝', async () => {
  const f = await addFixtureConversation(lab, { owner: account.id, seed: 5000 });
  const accounts = { getAccountStatus: async (id) => (id === account.id ? 'active' : null) };
  const updates = new UpdateLogService(lab.database, clock, lab.crypto, accounts);
  const reader = new ChatReadService(lab.database, new ChatStore(lab.crypto, accounts));
  const prior = await updates.getState(f.owner);
  const oldConversation = await reader.forUser(f.owner, f.id);
  const oldPage = await reader.pageForUser(f.owner, f.id, { limit: 50 });
  const engine = new SyncEngine();
  engine.apply({ type: 'cursor.expired' });
  engine.apply({ type: 'rebuild.state', latestUpdateSeq: prior.latestUpdateSeq });
  engine.apply({
    type: 'snapshot',
    startSeq: prior.latestUpdateSeq,
    snapshot: {
      conversations: [oldConversation],
      contacts: [],
      messages: oldPage.items,
      coverages: [{ conversationId: f.id, coverage: oldPage.coverage }],
      settings: {},
    },
  });
  const pendingId = randomUUID();
  engine.apply({
    type: 'enqueue',
    conversationId: f.id,
    body: { clientMsgId: pendingId, content: { type: 'text', text: '合成未发送内容' } },
    now: Date.now(),
  });
  await apply(await fixturePlan(lab, f));
  await assert.rejects(
    updates.getUpdates(f.owner, { since: prior.latestUpdateSeq, limit: 100 }),
    (error) => error.code === 'sync_cursor_expired',
  );
  engine.apply({ type: 'cursor.expired' });
  const state = await updates.getState(f.owner);
  engine.apply({ type: 'rebuild.state', latestUpdateSeq: state.latestUpdateSeq });
  const conversation = await reader.forUser(f.owner, f.id),
    page = await reader.pageForUser(f.owner, f.id, { limit: 50 });
  engine.apply({
    type: 'snapshot',
    startSeq: state.latestUpdateSeq,
    snapshot: {
      conversations: [conversation],
      contacts: [],
      messages: page.items,
      coverages: [{ conversationId: f.id, coverage: page.coverage }],
      settings: {},
    },
  });
  assert.deepEqual(
    engine.state.messages.map((row) => row.seq).sort((a, b) => a - b),
    [1, 2, 3, 4, 5, 6, 7],
  );
  assert.equal(engine.isRebuilding, false);
  assert.equal(engine.state.outbox.length, 1);
  assert.equal(engine.state.outbox[0].body.clientMsgId, pendingId);
  await assert.rejects(
    reader.forUser(randomUUID(), f.id),
    (error) => error.code === 'not_conversation_member',
  );
});

test('缺失账号承接真实旧密码验证和新设置，但不发注册赠分/主动事件', async () => {
  const id = randomUUID(),
    password = randomBytes(24).toString('hex');
  const passwordHash = await bcryptHash(password, { cost: 4, version: '2a' });
  const source = [
    {
      id,
      username: 'fixture_' + id.replaceAll('-', '').slice(0, 12),
      passwordHash,
      credentialDigest: fingerprint(passwordHash),
      status: 'active',
      role: 'user',
      createdAt: cutoff,
    },
  ];
  const plan = planAccounts({ source, target: [], baseline: [], inventoryComplete: true });
  const before = (await lab.database.query('SELECT count(*)::int AS n FROM platform.outbox'))
    .rows[0].n;
  const result = await applyMissingAccounts({
    ...lab,
    plan,
    source,
    maintenance,
    createDefaults: (tx, userId, zone) => lab.settings.createDefaults(tx, userId, zone),
  });
  assert.equal(result.inserted, 1);
  const stored = (
    await lab.database.query('SELECT password_hash FROM identity.users WHERE id=$1', [id])
  ).rows[0].password_hash;
  const hasher = new PasswordHasher();
  assert.equal(await hasher.verify(stored, password), true);
  assert.equal(hasher.needsRehash(stored), true);
  const notification = (
    await lab.database.query(
      'SELECT proactive_messages_enabled,proactive_calls_enabled FROM identity.notification_settings WHERE user_id=$1',
      [id],
    )
  ).rows[0];
  assert.deepEqual(notification, {
    proactive_messages_enabled: false,
    proactive_calls_enabled: false,
  });
  assert.equal(
    (await lab.database.query('SELECT count(*)::int AS n FROM platform.outbox')).rows[0].n,
    before,
  );
  assert.equal(
    (
      await lab.database.query('SELECT count(*)::int AS n FROM billing.accounts WHERE user_id=$1', [
        id,
      ])
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await applyMissingAccounts({
        ...lab,
        plan,
        source,
        maintenance,
        createDefaults: () => {
          throw new Error('MUST_NOT_RECREATE');
        },
      })
    ).inserted,
    0,
  );
});

test('实际连接与宣称目标不一致时首个查询之前拒绝', async () => {
  let queried = false;
  await assert.rejects(
    assertFixtureDatabase(
      {
        pool: { options: { connectionString: 'postgres://invalid.example/production' } },
        query: () => {
          queried = true;
        },
      },
      lab.target,
    ),
    /CONNECTION_MISMATCH/,
  );
  assert.equal(queried, false);
});

test('账号→官方依赖→真实旧消息转换→补迁→读取串联，不创建收费角色或历史事件', async () => {
  const id = randomUUID(),
    password = randomBytes(24).toString('hex');
  const passwordHash = await bcryptHash(password, { cost: 4, version: '2a' });
  const source = [
    {
      id,
      username: 'fixture_' + id.replaceAll('-', '').slice(0, 12),
      passwordHash,
      credentialDigest: fingerprint(passwordHash),
      status: 'active',
      role: 'user',
      createdAt: cutoff,
    },
  ];
  const accountsPlan = planAccounts({ source, target: [], baseline: [], inventoryComplete: true });
  await applyMissingAccounts({
    ...lab,
    plan: accountsPlan,
    source,
    maintenance,
    createDefaults: (tx, owner, zone) => lab.settings.createDefaults(tx, owner, zone),
  });
  await initializeRelationFixture(lab);
  const sourceRelations = [
    { sourceKey: `synthetic-official:${id}`, ownerUserId: id, kind: 'official', createdAt: cutoff },
  ];
  const targetBaseline = await readLegacyRelationsBaseline({ ...lab, sourceRelations });
  const relationPlan = planLegacyRelations({
    sourceRelations,
    targetBaseline,
    protection: { inventoryComplete: true },
    capturedAt: cutoff,
  });
  await applyLegacyRelations({ ...lab, plan: relationPlan, maintenance });
  const binding = relationPlan.bindings[0];
  const baseId = BigInt('0x' + randomBytes(6).toString('hex'));
  const rows = [
    {
      id: String(baseId),
      role: 'assistant',
      message_type: 'text',
      content: '合成客服历史',
      created_at: '2026-11-08 00:00:00',
    },
    {
      id: String(baseId + 1n),
      role: 'user',
      message_type: 'call',
      content: '合成通话记录',
      created_at: '2026-11-08 00:01:00',
    },
  ];
  const prepared = prepareLegacyChatRows({
    rows,
    table: 'chat_history',
    mapping: () => binding,
    cutoff,
    validateContent,
  });
  assert.deepEqual(
    prepared.messages.map((row) => row.sender_kind),
    ['official', 'system'],
  );
  const baseline = await readConversationBaseline(lab.database, binding.conversationId);
  const plan = planConversationDelta({
    target: baseline,
    incoming: prepared.messages,
    initialCutoff,
    cutoff,
    protection: { inventoryComplete: true },
    newConversationReadCursor: {
      userId: id,
      verified: true,
      table: 'chat_history',
      lastReadSourceId: rows[0].id,
    },
  });
  await apply(plan);
  const reader = new ChatReadService(
    lab.database,
    new ChatStore(lab.crypto, { getAccountStatus: async () => 'active' }),
  );
  const page = await reader.pageForUser(id, binding.conversationId, { limit: 50 });
  assert.equal(page.items.length, 2);
  const conversation = (await readConversationBaseline(lab.database, binding.conversationId))
    .conversation;
  assert.equal(conversation.character_id, null);
  assert.equal(conversation.official_identity_key, 'official:xiaov');
  assert.equal(
    (await readConversationBaseline(lab.database, binding.conversationId)).states[0].read_seq,
    '1',
  );
  assert.equal(
    Number(
      (
        await lab.database.query('SELECT count(*) AS n FROM billing.accounts WHERE user_id=$1', [
          id,
        ])
      ).rows[0].n,
    ),
    0,
  );
});

test('群聊未读位置保持；事实提取未排空、失踪引用和陈旧记忆基线均阻断', async () => {
  const f = await addFixtureConversation(lab, { owner: account.id, type: 'group', seed: 6000 });
  await apply(await fixturePlan(lab, f));
  assert.equal((await readConversationBaseline(lab.database, f.id)).states[0].read_seq, '4');
  const other = await addFixtureConversation(lab, { owner: account.id, seed: 7000 });
  const memoryId = randomUUID();
  await lab.database.query(
    'INSERT INTO ai_runtime.memory_states(id,user_id,character_id,conversation_id,cursor_seq,fact_trigger_seq,updated_at) VALUES($1,$2,$3,$4,1,2,$5)',
    [memoryId, other.owner, other.peer, other.id, cutoff],
  );
  await assert.rejects(apply(await fixturePlan(lab, other)), /MEMORY_WORK_MUST_DRAIN/);
  await lab.database.query('UPDATE ai_runtime.memory_states SET fact_trigger_seq=1 WHERE id=$1', [
    memoryId,
  ]);
  const plan = await fixturePlan(lab, other);
  await lab.database.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('ai_runtime:user:' || $1,0))", [
      other.owner,
    ]);
    await tx.query(
      'UPDATE ai_runtime.memory_states SET cursor_seq=2,fact_trigger_seq=2 WHERE id=$1',
      [memoryId],
    );
  });
  await assert.rejects(apply(plan), /TARGET_CHANGED/);
  await lab.database.query(
    "INSERT INTO ai_runtime.model_blocked_messages(conversation_id,seq,user_id,character_id,message_id,source) VALUES($1,3,$2,$3,$4,'manual')",
    [other.id, other.owner, other.peer, randomUUID()],
  );
  const snapshot = fingerprint(await readConversationBaseline(lab.database, other.id));
  await assert.rejects(apply(await fixturePlan(lab, other)), /MISSING_REFERENCED_MESSAGE/);
  assert.equal(fingerprint(await readConversationBaseline(lab.database, other.id)), snapshot);
});
