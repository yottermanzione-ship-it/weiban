import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { legacyId } from './legacy-content-rules.mjs';
import { legacyMigrationOwnerDigest } from './legacy-migration-preservation.mjs';
import {
  assertIsolatedTarget,
  planAccounts,
  planProtectedRecords,
  planConversationDelta,
  prepareLegacyChatRows,
  fingerprint,
  deletionImpact,
} from './legacy-delta-core.mjs';

const initialCutoff = '2026-10-24T12:02:47.053Z',
  cutoff = '2026-11-09T00:00:00Z';
function fixture() {
  const id = randomUUID(),
    owner = randomUUID(),
    pid = randomUUID();
  const target = {
    conversation: { id, owner_user_id: owner, last_seq: 2, archived_at: null },
    messages: [1, 2].map((seq) => ({
      id: randomUUID(),
      conversation_id: id,
      seq,
      sender_participant_id: pid,
      sender_kind: 'character',
      created_at: `2026-11-08T00:0${seq * 2}:00Z`,
      status: 'normal',
      content_ciphertext: Buffer.from('synthetic-ciphertext'),
    })),
    states: [
      {
        user_id: owner,
        read_seq: 1,
        cleared_through_seq: 0,
        hidden: true,
        pinned: true,
        muted: true,
        marked_unread: true,
      },
    ],
    participants: [{ id: pid, kind: 'character', read_seq: 2 }],
    hidden: [],
    references: [],
  };
  const incoming = [1, 2, 3].map((n) => ({
    id: legacyId('message', 'chat_history', String(n), 0),
    conversation_id: id,
    owner_user_id: owner,
    sender_participant_id: pid,
    sender_kind: 'character',
    client_msg_id: legacyId('client-message', 'chat_history', String(n), 0),
    source: { table: 'chat_history', id: String(n), part: 0 },
    created_at: `2026-11-08T00:0${n * 2 - 1}:00Z`,
    scope: 'normal',
    content: { type: 'text', text: '合成资料' },
    quote_message_id: null,
  }));
  return { target, incoming, initialCutoff, cutoff, protection: { inventoryComplete: true } };
}

test('隔离执行拒绝生产、共享测试库、转发选项和未声明的真实数据', () => {
  const valid = {
    kind: 'isolated-fixture',
    synthetic: true,
    url: 'postgres://fixture@127.0.0.1:59999/codex_migration_example',
  };
  assert.equal(assertIsolatedTarget(valid), 'codex_migration_example');
  for (const url of [
    'postgres://fixture@example.com/codex_migration_example',
    'postgres://fixture@127.0.0.1/weiban_test',
    'postgres://fixture@127.0.0.1/codex_migration_example?host=example.com',
  ])
    assert.throws(() => assertIsolatedTarget({ ...valid, url }));
  assert.throws(() => assertIsolatedTarget({ ...valid, synthetic: false }));
});

test('群聊沿用旧版UUID和文本来源身份，不当作私聊数字编号，也不重建新身份', () => {
  const owner = randomUUID(),
    conversationId = randomUUID(),
    peer = randomUUID();
  const row = {
    id: randomUUID(),
    user_id: owner,
    sender_type: 'character',
    message_type: 'text',
    content: '合成群消息',
    created_at: '2026-11-08T00:00:00Z',
  };
  const input = {
    rows: [row],
    table: 'group_messages',
    cutoff,
    mapping: () => ({
      ownerUserId: owner,
      conversationId,
      peerKind: 'character',
      peerParticipantId: peer,
    }),
    validateContent: (value) => value,
  };
  const first = prepareLegacyChatRows(input);
  assert.equal(first.messages[0].id, legacyId('message', 'group_messages', row.id, 0));
  assert.deepEqual(prepareLegacyChatRows(input), first);
  const withoutSender = {
    ...input,
    rows: [{ ...row, user_id: '' }],
    mapping: () => ({ ...input.mapping(), legacyOwnerUserId: owner }),
  };
  assert.equal(prepareLegacyChatRows(withoutSender).messages[0].source_owner_user_id, owner);
  assert.throws(
    () => prepareLegacyChatRows({ ...withoutSender, mapping: input.mapping }),
    /GROUP_OWNER_PROOF_REQUIRED/,
  );
  assert.throws(
    () =>
      prepareLegacyChatRows({
        ...input,
        mapping: () => ({ ...input.mapping(), legacyOwnerUserId: randomUUID() }),
      }),
    /GROUP_MESSAGE_OWNER_CONFLICT/,
  );
  for (const id of ['a'.repeat(32), 'legacy-group-source-id'])
    assert.equal(
      prepareLegacyChatRows({ ...input, rows: [{ ...row, id }] }).messages[0].source.id,
      id,
    );
  for (const id of ['', ' space ', 'bad\nkey', {}, 5])
    assert.throws(
      () => prepareLegacyChatRows({ ...input, rows: [{ ...row, id }] }),
      /SOURCE_ID_REQUIRED/,
    );
  assert.throws(
    () =>
      prepareLegacyChatRows({
        ...input,
        table: 'chat_history',
        rows: [{ ...row, role: 'assistant' }],
      }),
    /SOURCE_ID_REQUIRED/,
  );
  assert.throws(
    () =>
      prepareLegacyChatRows({
        ...input,
        table: 'chat_history',
        rows: [{ ...row, id: Number.MAX_SAFE_INTEGER + 1, role: 'assistant' }],
      }),
    /SOURCE_ID_REQUIRED/,
  );
});

test('交错补入保留目标相对顺序、隐藏/已读状态及引用身份', () => {
  const input = fixture();
  input.incoming[1].quote_message_id = input.target.messages[0].id;
  const plan = planConversationDelta(input);
  assert.deepEqual(
    plan.newMessages.map((row) => row.seq),
    [1, 3, 5],
  );
  assert.deepEqual(
    plan.remap.map((row) => row.newSeq),
    [2, 4],
  );
  assert.equal(plan.states[0].read_seq, 2);
  for (const key of ['hidden', 'pinned', 'muted', 'marked_unread'])
    assert.equal(plan.states[0][key], true);
  assert.equal(plan.newMessages[1].quote_message_id, input.target.messages[0].id);
  assert.equal(plan.participants[0].read_seq, 4);
});

test('同时间群聊文本编号按旧SQLite字节顺序排列，私聊数字仍按数值顺序', () => {
  for (const [table, ids, expected] of [
    [
      'group_messages',
      ['bbb-source', 'aaa-source', '00000000-0000-4000-8000-000000000001'],
      ['00000000-0000-4000-8000-000000000001', 'aaa-source', 'bbb-source'],
    ],
    ['chat_history', ['10', '2', '1'], ['1', '2', '10']],
  ]) {
    const input = fixture();
    input.incoming.forEach((row, index) => {
      row.source = { table, id: ids[index], part: 0 };
      row.id = legacyId('message', table, ids[index], 0);
      row.client_msg_id = legacyId('client-message', table, ids[index], 0);
      row.created_at = '2026-11-08T00:01:00Z';
    });
    assert.deepEqual(
      planConversationDelta(input).newMessages.map((row) => row.source.id),
      expected,
    );
  }
});

test('稀疏历史与尾部删除缺口不压缩、原消息序号只增不减', () => {
  const input = fixture();
  input.target.messages[0].seq = 10;
  input.target.messages[1].seq = 20;
  input.target.conversation.last_seq = 30;
  input.target.states[0].read_seq = 10;
  const plan = planConversationDelta(input);
  assert.deepEqual(
    plan.remap.map((row) => row.newSeq),
    [11, 22],
  );
  assert.deepEqual(
    plan.newMessages.map((row) => row.seq),
    [1, 12, 33],
  );
  assert.equal(plan.lastSeq, 33);
});

test('重跑无新增不压缩、清空边界缺失或目标时钟逆序先阻断', () => {
  const input = fixture();
  input.incoming = [];
  assert.equal(planConversationDelta(input).changed, false);
  input.target.states[0].cleared_through_seq = 3;
  assert.throws(() => planConversationDelta(input), /CLEAR_BOUNDARY_GAP/);
  input.target.states[0].cleared_through_seq = 0;
  input.target.messages.reverse();
  input.target.messages[0].seq = 1;
  input.target.messages[1].seq = 2;
  assert.throws(() => planConversationDelta(input), /CLOCK_INVERSION/);
});

test('永久删除、清空及首次截止前缺项不被全量快照复活', () => {
  const input = fixture();
  input.protection.permanentlyDeleted = true;
  assert.equal(planConversationDelta(input).newMessages.length, 0);
  input.protection.permanentlyDeleted = false;
  input.incoming[0].created_at = '2026-10-01T00:00:00Z';
  const plan = planConversationDelta(input);
  assert.equal(plan.conflicts.length, 1);
  input.protection.inventoryComplete = false;
  assert.throws(() => planConversationDelta(input), /INVENTORY_REQUIRED/);
});

test('同一来源内容矛盾、错误归属和未知引用禁止导入', () => {
  const input = fixture();
  input.incoming.push({ ...input.incoming[0], content: { type: 'text', text: '不同的合成内容' } });
  assert.throws(() => planConversationDelta(input), /DUPLICATE_CONFLICT/);
  input.incoming.pop();
  input.incoming[0].owner_user_id = randomUUID();
  assert.throws(() => planConversationDelta(input), /OWNERSHIP/);
  input.incoming[0].owner_user_id = input.target.conversation.owner_user_id;
  input.incoming[0].quote_message_id = randomUUID();
  assert.throws(() => planConversationDelta(input), /UNRESOLVED_QUOTE/);
});

test('小V明确使用官方发送者，媒体按已验证拥有者绑定', () => {
  const owner = randomUUID();
  const binding = {
    ownerUserId: owner,
    conversationId: randomUUID(),
    userParticipantId: randomUUID(),
    peerParticipantId: randomUUID(),
    systemParticipantId: randomUUID(),
    peerKind: 'official',
    officialKey: 'official:xiaov',
  };
  const row = {
    id: 1,
    role: 'assistant',
    content: '合成官方回复',
    message_type: 'text',
    created_at: '2026-11-08 00:00:00',
  };
  const options = {
    rows: [row],
    table: 'chat_history',
    mapping: () => binding,
    cutoff,
    validateContent: (content) => content,
  };
  assert.equal(prepareLegacyChatRows(options).messages[0].sender_kind, 'official');
  binding.peerKind = 'character';
  assert.throws(() => prepareLegacyChatRows(options), /OFFICIAL_IDENTITY/);
  binding.peerKind = 'official';
  row.message_type = 'voice';
  assert.throws(() => prepareLegacyChatRows(options), /MEDIA_NOT_READY/);
});

function missingMediaCase(kind = 'voice', reason = 'missing_file') {
  const owner = randomUUID(),
    sourceDigest = fingerprint('synthetic-fixed-snapshot');
  const row = {
    id: 9001,
    user_id: owner,
    role: 'assistant',
    message_type: kind,
    content: '合成正文',
    quoted_content: '合成引用',
    quoted_author: '合成角色',
    created_at: '2026-11-08 00:00:00',
    ...(reason === 'missing_file' ? { media_path: '/synthetic/missing-file' } : {}),
  };
  const binding = {
    ownerUserId: owner,
    conversationId: randomUUID(),
    peerKind: 'character',
    peerParticipantId: randomUUID(),
  };
  const review = {
    version: 1,
    sourceDigest,
    table: 'chat_history',
    sourceId: String(row.id),
    ownerUserId: owner,
    sourceRowDigest: fingerprint(row),
    reason,
    proofDigest: fingerprint('synthetic-reviewed-proof'),
  };
  const input = {
    rows: [row],
    table: 'chat_history',
    cutoff,
    sourceDigest,
    missingMediaReviews: [review],
    mapping: () => binding,
    validateContent: (value) => value,
  };
  return { row, binding, review, input };
}

test('逐条审定缺附件保留语音/图片/无引用的文字与时间，稳定ID重跑一致', () => {
  for (const [kind, reason] of [
    ['voice', 'missing_file'],
    ['image', 'missing_file'],
    ['image', 'no_reference'],
    ['sticker', 'no_reference'],
  ]) {
    const f = missingMediaCase(kind, reason);
    const first = prepareLegacyChatRows(f.input);
    assert.equal(first.messages[0].content.type, 'text');
    assert.match(first.messages[0].content.text, /附件不可用/);
    assert(first.messages[0].content.text.includes('↪ 合成角色：合成引用\n合成正文'));
    assert.equal(first.messages[0].created_at, '2026-11-08T00:00:00.000Z');
    assert.equal(first.messages[0].id, legacyId('message', 'chat_history', '9001', 0));
    assert.equal(first.messages[0].source.mediaUnavailable.proofDigest, f.review.proofDigest);
    assert.deepEqual(prepareLegacyChatRows(f.input), first);
  }
});

test('缺附件的完整长文及引用分片不截断，来源原行摘要不能被归一化替换', () => {
  const f = missingMediaCase('image');
  f.row.content = '合成正文🙂'.repeat(1300);
  f.row.quoted_content = '合成引用🙂'.repeat(900);
  f.review.sourceRowDigest = fingerprint(f.row);
  const prepared = prepareLegacyChatRows(f.input);
  assert(prepared.messages.length > 3);
  assert.equal(
    prepared.messages.map((row) => row.content.text).join(''),
    `[旧图片附件不可用] \n↪ 合成角色：${f.row.quoted_content}\n${f.row.content}`,
  );
  assert(
    prepared.messages.every(
      (row, index) =>
        row.content.text.length <= 4000 &&
        row.source.part === index &&
        row.id === legacyId('message', 'chat_history', '9001', index),
    ),
  );
  f.row.created_at = '2026-11-08T00:00:00Z';
  assert.throws(() => prepareLegacyChatRows(f.input), /MISSING_MEDIA_REVIEW_SOURCE_MISMATCH/);
});

test('默认无证明及错误owner/来源/类别/原行/多余证明全部拒绝，不吞失败', () => {
  const f = missingMediaCase();
  assert.throws(
    () => prepareLegacyChatRows({ ...f.input, missingMediaReviews: [] }),
    /MEDIA_NOT_READY/,
  );
  for (const patch of [
    { ownerUserId: randomUUID() },
    { sourceRowDigest: fingerprint('different') },
    { sourceDigest: fingerprint('other-snapshot') },
    { reason: 'no_reference' },
    { reason: 'permission_denied' },
    { proofDigest: 'not-a-digest' },
  ])
    assert.throws(
      () => prepareLegacyChatRows({ ...f.input, missingMediaReviews: [{ ...f.review, ...patch }] }),
      /MISSING_MEDIA/,
    );
  assert.throws(
    () => prepareLegacyChatRows({ ...f.input, missingMediaReviews: [f.review, f.review] }),
    /MISSING_MEDIA_REVIEW_DUPLICATE/,
  );
  const extra = { ...f.review, sourceId: '9002' };
  assert.throws(
    () => prepareLegacyChatRows({ ...f.input, missingMediaReviews: [f.review, extra] }),
    /MISSING_MEDIA_REVIEW_UNUSED/,
  );
  assert.throws(
    () =>
      prepareLegacyChatRows({
        ...f.input,
        mapping: () => ({ ...f.binding, ownerUserId: randomUUID() }),
      }),
    /MISSING_MEDIA_REVIEW_OWNER_CONFLICT/,
  );
});

test('已有ready/错误归属/待处理媒体绑定不准降级成缺附件文字', () => {
  const f = missingMediaCase('image'),
    id = randomUUID();
  for (const ready of [
    undefined,
    { id, ownerUserId: f.binding.ownerUserId, purpose: 'chat_image' },
    { id, ownerUserId: randomUUID(), purpose: 'chat_image' },
  ]) {
    assert.throws(
      () =>
        prepareLegacyChatRows({
          ...f.input,
          mapping: () => ({ ...f.binding, mediaId: id }),
          mediaReady: new Map(ready ? [[id, ready]] : []),
        }),
      /MISSING_MEDIA_REVIEW_BINDING_CONFLICT/,
    );
  }
});

test('缺媒体例外不能绕过固定账号保护，群来源摘要绑定原空user_id与实际群owner', () => {
  const f = missingMediaCase();
  assert.throws(
    () =>
      prepareLegacyChatRows({
        ...f.input,
        options: {
          additionalPreservedOwnerDigests: [legacyMigrationOwnerDigest(f.binding.ownerUserId)],
        },
      }),
    /MISSING_MEDIA_REVIEW_UNUSED/,
  );
  f.row.id = randomUUID();
  f.row.user_id = '';
  delete f.row.role;
  f.row.sender_type = 'character';
  f.review = {
    ...f.review,
    table: 'group_messages',
    sourceId: f.row.id,
    sourceRowDigest: fingerprint(f.row),
  };
  const input = {
    ...f.input,
    table: 'group_messages',
    missingMediaReviews: [f.review],
    mapping: () => ({ ...f.binding, legacyOwnerUserId: f.binding.ownerUserId }),
  };
  assert.equal(
    prepareLegacyChatRows(input).messages[0].source_owner_user_id,
    f.binding.ownerUserId,
  );
  assert.throws(
    () => prepareLegacyChatRows({ ...input, rows: [{ ...f.row, user_id: f.binding.ownerUserId }] }),
    /MISSING_MEDIA_REVIEW_SOURCE_MISMATCH/,
  );
});

test('密码算法升级保留；凭据真变、重名、被删除账号有明确分类', () => {
  const one = { id: randomUUID(), username: 'fixture_one', credentialDigest: 'old' },
    two = { id: randomUUID(), username: 'fixture_two', credentialDigest: 'new-old-site' };
  const target = [
    { ...one, credentialDigest: 'upgraded', status: 'active' },
    { ...two, credentialDigest: 'reset-on-new', status: 'active' },
  ];
  const result = planAccounts({
    source: [one, two, { id: randomUUID(), username: 'fixture_one', credentialDigest: 'x' }],
    target,
    baseline: [{ id: one.id, sourceCredentialDigest: 'old', imported: true }],
    inventoryComplete: true,
  });
  assert.deepEqual(
    result.map((row) => row.action),
    ['keep_target', 'credential_conflict_review', 'username_conflict_review'],
  );
  assert.equal(
    planAccounts({
      source: [one],
      target: [],
      baseline: [{ id: one.id, imported: true }],
      inventoryComplete: true,
    })[0].action,
    'preserve_deletion',
  );
});

test('资料记忆三方比较保留新站编辑和遗忘，不以较晚时间覆盖', () => {
  const result = planProtectedRecords({
    ownerUserId: 'synthetic-record-owner',
    domain: 'memory',
    inventoryComplete: true,
    source: [
      { key: 'a', digest: 'source-new' },
      { key: 'b', digest: 'source-new' },
      { key: 'c', digest: 'old' },
      { key: 'd', digest: 'new' },
    ],
    baseline: [
      { key: 'a', sourceDigest: 'old', targetDigest: 'old' },
      { key: 'b', sourceDigest: 'old', targetDigest: 'old' },
      { key: 'c', sourceDigest: 'old', targetDigest: 'old' },
    ],
    target: [
      { key: 'a', digest: 'target-new' },
      { key: 'b', digest: 'old' },
    ],
    tombstones: [],
  });
  assert.deepEqual(
    result.map((row) => row.action),
    ['conflict_review', 'source_change_review', 'preserve_deletion', 'insert'],
  );
  assert.throws(
    () =>
      planProtectedRecords({
        domain: 'wallet',
        source: [],
        target: [],
        baseline: [],
        inventoryComplete: true,
      }),
    /SPECIALIZED/,
  );
});

test('源删除按全部拆条计算影响，结果只是审查范围', () => {
  const row = {
    id: 5,
    user_id: 'synthetic-delete-owner',
    content: '合'.repeat(9000),
    message_type: 'text',
    deleted_at: '2026-11-08T00:00:00Z',
  };
  const ids = [0, 1, 2].map((part) => legacyId('message', 'chat_history', '5', part));
  const report = deletionImpact({
    sourceRows: [row],
    table: 'chat_history',
    targetById: new Map(ids.map((id) => [id, {}])),
    dependents: [{ messageId: ids[1] }],
  });
  assert.equal(report.action, 'review_only');
  assert.deepEqual(report.summary, { messages: 3, dependents: 1, unresolved: 0 });
  row.message_type = 'image';
  assert.equal(
    deletionImpact({ sourceRows: [row], table: 'chat_history', targetById: new Map() }).summary
      .unresolved,
    1,
  );
  const media = deletionImpact({
    sourceRows: [row],
    table: 'chat_history',
    targetById: new Map(ids.map((id) => [id, {}])),
    sourceFragments: new Map([['chat_history:5', ids]]),
    dependents: [{ messageId: ids[1] }],
  });
  assert.deepEqual(media.summary, { messages: 3, dependents: 1, unresolved: 0 });
});

test('受保护计划摘要稳定且密文变化可检出', () => {
  const a = { b: 2, a: Buffer.from('test-a') },
    b = { a: Buffer.from('test-a'), b: 2 };
  assert.equal(fingerprint(a), fingerprint(b));
  b.a = Buffer.from('test-b');
  assert.notEqual(fingerprint(a), fingerprint(b));
});
