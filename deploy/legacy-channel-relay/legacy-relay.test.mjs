import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const {
  createLegacyRelay,
  createMaintenanceMiddleware,
  deriveKey,
  sha,
} = require('./legacy_channel_relay.cjs');
const { patchChatSource, patchGroupSource, patchModelSource } = require('./apply-old-patch.cjs');
const { encryptPayload } = require('./export-old.cjs');
const { patchEnvironment, overlay } = require('./patch-old-env.cjs');
const { inspect, freeze } = require('./freeze-old-queues.cjs');

const OWNER = '11111111-1111-4111-8111-111111111111';
const WX = '22222222-2222-4222-8222-222222222222';
const WB = '33333333-3333-4333-8333-333333333333';
const WB2 = '44444444-4444-4444-8444-444444444444';
const MSG = '55555555-5555-4555-8555-555555555555';
const QQ = '66666666-6666-4666-8666-666666666666';
const NOW = '2026-11-09T12:30:00.000Z';
const SECRET = 'FAKE_OLD_JWT_SECRET_FOR_TEST_ONLY_12345678';

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE chat_reply_jobs (id TEXT PRIMARY KEY,user_id TEXT,persona_name TEXT,user_message TEXT,context_json TEXT,status TEXT,reply TEXT,created_at TEXT,updated_at TEXT,completed_at TEXT);
    CREATE TABLE group_turn_jobs (id TEXT,status TEXT);
    CREATE TABLE wechat_bindings(user_id TEXT PRIMARY KEY,generation INTEGER,status TEXT,persona_name TEXT,ilink_user_id TEXT,bot_token TEXT,base_url TEXT,cursor TEXT,last_context_token TEXT,last_poll_at TEXT,updated_at TEXT);
    CREATE TABLE weibo_bindings(id TEXT PRIMARY KEY,user_id TEXT,generation INTEGER,status TEXT,persona_name TEXT,weibo_uid TEXT);
    CREATE TABLE qq_bindings(id TEXT PRIMARY KEY,user_id TEXT,generation INTEGER,status TEXT,persona_name TEXT,qq_uid TEXT);
    CREATE TABLE wechat_inbox(id TEXT PRIMARY KEY,user_id TEXT,binding_generation INTEGER,dedupe_key TEXT,source_cursor TEXT,sender_id TEXT,text TEXT,context_token TEXT,message_created_at TEXT,status TEXT,reason TEXT,job_id TEXT,created_at TEXT,processed_at TEXT,UNIQUE(user_id,binding_generation,dedupe_key));
    CREATE TABLE weibo_inbox(id TEXT PRIMARY KEY,weibo_uid TEXT,dedupe_key TEXT,text TEXT,status TEXT,reason TEXT,job_id TEXT,created_at TEXT,processed_at TEXT,UNIQUE(weibo_uid,dedupe_key));
    CREATE TABLE qq_inbox(id TEXT PRIMARY KEY,qq_uid TEXT,dedupe_key TEXT,text TEXT,status TEXT,reason TEXT,job_id TEXT,created_at TEXT,processed_at TEXT,UNIQUE(qq_uid,dedupe_key));
    CREATE TABLE wechat_deliveries(job_id TEXT PRIMARY KEY,user_id TEXT,status TEXT,binding_generation INTEGER,context_token TEXT,next_attempt_at TEXT,client_id TEXT,created_at TEXT,updated_at TEXT,error TEXT);
    CREATE TABLE weibo_deliveries(job_id TEXT PRIMARY KEY,user_id TEXT,weibo_uid TEXT,status TEXT,binding_generation INTEGER,next_attempt_at TEXT,created_at TEXT,updated_at TEXT,binding_id TEXT,last_error TEXT,attempt_count INTEGER DEFAULT 0);
    CREATE TABLE qq_deliveries(job_id TEXT PRIMARY KEY,user_id TEXT,qq_uid TEXT,status TEXT,binding_generation INTEGER,next_attempt_at TEXT,created_at TEXT,updated_at TEXT,last_error TEXT,attempt_count INTEGER DEFAULT 0);
  `);
  return {
    raw: db,
    prepare: (sql) => db.prepare(sql),
    transaction: (fn) => {
      const run = (...args) => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const value = fn(...args);
          db.exec('COMMIT');
          return value;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      };
      run.immediate = run;
      return run;
    },
  };
}

function fixture(t) {
  const db = database();
  t.after(() => db.raw.close());
  db.prepare(
    "INSERT INTO wechat_bindings VALUES(?,3,'active','synthetic role','wx-peer','FAKE_BOT_TOKEN','https://ilinkai.weixin.qq.com','','','','')",
  ).run(OWNER);
  db.prepare(
    "INSERT INTO weibo_bindings VALUES('slot1',?,3,'active','synthetic role','wb-peer')",
  ).run(OWNER);
  db.prepare(
    "INSERT INTO weibo_bindings VALUES('slot2',?,4,'active','other synthetic role','wb-peer')",
  ).run(OWNER);
  db.prepare("INSERT INTO qq_bindings VALUES('bot1',?,3,'active','synthetic role','qq-peer')").run(
    OWNER,
  );
  const mapping = {
    version: 1,
    bindings: [
      {
        id: WX,
        channel: 'wechat',
        legacyBindingId: OWNER,
        generation: 3,
        userId: OWNER,
        peerHash: sha('wx-peer'),
        personaHash: sha('synthetic role'),
        cutoverAt: '2026-11-09T12:00:00.000Z',
      },
      {
        id: WB,
        channel: 'weibo',
        legacyBindingId: 'slot1',
        generation: 3,
        userId: OWNER,
        peerHash: sha('wb-peer'),
        personaHash: sha('synthetic role'),
        cutoverAt: '2026-11-09T12:00:00.000Z',
      },
      {
        id: WB2,
        channel: 'weibo',
        legacyBindingId: 'slot2',
        generation: 4,
        userId: OWNER,
        peerHash: sha('wb-peer'),
        personaHash: sha('other synthetic role'),
        cutoverAt: '2026-11-09T12:00:00.000Z',
      },
      {
        id: QQ,
        channel: 'qq',
        legacyBindingId: 'bot1',
        generation: 3,
        userId: OWNER,
        peerHash: sha('qq-peer'),
        personaHash: sha('synthetic role'),
        cutoverAt: '2026-11-09T12:00:00.000Z',
      },
    ],
  };
  const requests = [];
  let unavailable = false,
    httpStatus = 200,
    replies = [];
  const env = { ...overlay, JWT_SECRET: SECRET };
  const relay = createLegacyRelay({
    database: db,
    mapping,
    env,
    now: () => NOW,
    wechatHelpers: {
      dedupeKey: (msg) => msg.client_id,
      deliveryClientIdFor: (job) => `out-${sha(job)}`,
    },
    fetch: async (url, init) => {
      const envelope = JSON.parse(init.body),
        payload = JSON.parse(envelope.payload);
      requests.push({ url, envelope, payload });
      if (unavailable) throw new Error('SYNTHETIC_NETWORK_FAILURE');
      const id = url.split('/').at(-1),
        m = mapping.bindings.find((entry) => entry.id === id);
      const key = deriveKey(SECRET, id);
      const signature = crypto
        .createHmac('sha256', key)
        .update(
          `weiban-legacy-relay-v1\n${id}\n${envelope.sentAt}\n${envelope.nonce}\n${envelope.payload}`,
        )
        .digest('hex');
      assert.equal(envelope.signature, signature);
      key.fill(0);
      const result =
        payload.op === 'poll'
          ? { generation: m.generation, throughSeq: 12, messages: replies }
          : { accepted: true, enabled: true, acknowledged: true };
      return new Response(JSON.stringify(result), { status: httpStatus });
    },
  });
  return {
    db,
    relay,
    mapping,
    requests,
    env,
    setUnavailable: (value) => {
      unavailable = value;
    },
    setHttpStatus: (value) => {
      httpStatus = value;
    },
    setReplies: (value) => {
      replies = value;
    },
  };
}

function wxMessage(overrides = {}) {
  return {
    client_id: 'external-1',
    from_user_id: 'wx-peer',
    create_time_ms: Date.parse(NOW),
    context_token: 'FAKE_CONTEXT',
    item_list: [{ text_item: { text: 'ordinary synthetic text' } }],
    ...overrides,
  };
}

test('wechat durable inbox/cursor, transport retry and replay never create an old pending model job or consume quota', async (t) => {
  const f = fixture(t),
    binding = f.db.prepare('SELECT * FROM wechat_bindings').get();
  const input = f.relay.wechatInbound();
  assert.equal(
    input.ingestBatch(binding, { messages: [wxMessage()], nextCursor: 'cursor-2' }).accepted,
    1,
  );
  assert.equal(
    input.ingestBatch(binding, { messages: [wxMessage()], nextCursor: 'cursor-2' }).duplicates,
    1,
  );
  assert.equal(f.db.prepare('SELECT cursor FROM wechat_bindings').get().cursor, 'cursor-2');
  f.setUnavailable(true);
  await f.relay.runPump('wechat');
  assert.equal(f.db.prepare('SELECT status FROM wechat_inbox').get().status, 'received');
  f.setUnavailable(false);
  await f.relay.runPump('wechat');
  assert.equal(f.db.prepare('SELECT status FROM wechat_inbox').get().status, 'accepted');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM chat_reply_jobs').get().n, 0);
  const ingress = f.requests.filter((request) => request.payload.op === 'ingest');
  assert.equal(ingress[0].payload.externalId, ingress[1].payload.externalId);
  assert.equal(ingress[1].payload.peerHash, sha('wx-peer'));
});

test('fixed peer/generation/persona reject changed bindings; sender cannot choose the owner', async (t) => {
  const f = fixture(t),
    binding = f.db.prepare('SELECT * FROM wechat_bindings').get();
  assert.equal(
    f.relay.wechatInbound().ingestBatch(binding, {
      messages: [wxMessage({ from_user_id: 'foreign-peer' })],
      nextCursor: 'c',
    }).rejected,
    1,
  );
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM wechat_inbox').get().n, 0);
  f.db.prepare("UPDATE wechat_bindings SET persona_name='changed role'").run();
  await f.relay.runPump('wechat');
  assert.equal(f.requests.length, 0);
});

test('weibo preserves distinct approved slots sharing a peer and external message id', async (t) => {
  const f = fixture(t),
    input = f.relay.weiboInbound();
  const message = {
    fromUserId: 'wb-peer',
    messageId: 'same-external-id',
    text: 'synthetic slot text',
    raw: { timestamp: Date.parse(NOW) },
  };
  assert.equal(
    (await input.handleInbound(message, { bindingId: 'slot1', userId: OWNER })).ok,
    true,
  );
  assert.equal(
    (await input.handleInbound(message, { bindingId: 'slot2', userId: OWNER })).ok,
    true,
  );
  assert.equal((await input.handleInbound(message, { bindingId: 'slot1', userId: WX })).ok, false);
  await f.relay.runPump('weibo');
  assert.equal(
    f.db.prepare("SELECT count(*) AS n FROM weibo_inbox WHERE status='accepted'").get().n,
    2,
  );
  assert.equal(f.requests.filter((request) => request.payload.op === 'ingest').length, 2);
});

test('QQ uses only its fixed peer and a recent accepted reply id; uncertain sends are never retried', async (t) => {
  const f = fixture(t),
    inbound = f.relay.qqInbound();
  const event = {
    userId: 'qq-peer',
    messageId: 'qq-incoming-1',
    text: 'synthetic QQ text',
    raw: { d: { timestamp: NOW } },
  };
  assert.equal((await inbound.handleInbound({ ...event, userId: 'foreign-peer' })).ok, false);
  assert.equal((await inbound.handleInbound(event)).ok, true);
  f.setReplies([{ messageId: MSG, seq: 12, text: 'synthetic new reply', createdAt: NOW }]);
  await f.relay.runPump('qq');
  let calls = 0;
  const send = async (_mapping, peer, _text, replyTo) => {
    calls++;
    assert.equal(peer, 'qq-peer');
    assert.equal(replyTo, 'qq-incoming-1');
    throw new Error('SYNTHETIC_UNKNOWN_PROVIDER_RESULT');
  };
  await f.relay.flushSocket('qq', send);
  assert.equal(f.db.prepare('SELECT status FROM qq_deliveries').get().status, 'ambiguous');
  await f.relay.flushSocket('qq', send);
  assert.equal(calls, 1);
});

test('new-site unbind stops old acceptance and provider sends without deleting existing queues', async (t) => {
  const f = fixture(t),
    original = f.db.prepare('SELECT * FROM wechat_bindings').get();
  f.setHttpStatus(403);
  await f.relay.runPump('wechat');
  assert.equal(
    f.relay.wechatInbound().ingestBatch(original, { messages: [wxMessage()], nextCursor: 'paused' })
      .stale,
    true,
  );
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM wechat_inbox').get().n, 0);
  let called = false;
  const sender = f.relay.mappedWechatClient({
    sendText: async () => {
      called = true;
    },
  });
  await assert.rejects(
    sender.sendText(
      'FAKE_BOT_TOKEN',
      'wx-peer',
      'synthetic',
      '',
      'client',
      'https://ilinkai.weixin.qq.com',
    ),
  );
  assert.equal(called, false);
});

test('poll replay queues one synthetic done job and one delivery; external target comes from current stored binding', async (t) => {
  const f = fixture(t);
  f.setReplies([{ messageId: MSG, seq: 12, text: 'synthetic new reply', createdAt: NOW }]);
  await f.relay.runPump('wechat');
  await f.relay.runPump('wechat');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM chat_reply_jobs').get().n, 1);
  assert.equal(f.db.prepare('SELECT status FROM chat_reply_jobs').get().status, 'done');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM wechat_deliveries').get().n, 1);
  const sent = [];
  const wrapped = f.relay.mappedWechatClient({ sendText: async (...args) => sent.push(args) });
  await wrapped.sendText(
    'FAKE_BOT_TOKEN',
    'wx-peer',
    'synthetic new reply',
    'FAKE_CONTEXT',
    'fixed-client-id',
    'https://ilinkai.weixin.qq.com',
  );
  assert.equal(sent[0][1], 'wx-peer');
  f.db.prepare('UPDATE wechat_bindings SET generation=4').run();
  await assert.rejects(
    wrapped.sendText(
      'FAKE_BOT_TOKEN',
      'wx-peer',
      'synthetic new reply',
      '',
      'id',
      'https://ilinkai.weixin.qq.com',
    ),
  );
  assert.equal(sent.length, 1);
});

test('queue freeze refuses unfinished jobs, preserves ambiguous history, and marks only old retry rows', (t) => {
  const f = fixture(t);
  f.db
    .prepare(
      "INSERT INTO wechat_deliveries(job_id,status) VALUES('old-retry','retry'),('old-ambiguous','ambiguous'),('lrout-current','pending')",
    )
    .run();
  const snapshot = inspect(f.db),
    digest = sha(Buffer.from(JSON.stringify(snapshot)));
  assert.throws(() => freeze(f.db, digest, false));
  assert.equal(freeze(f.db, digest, true).wechat, 1);
  assert.equal(
    f.db.prepare("SELECT status FROM wechat_deliveries WHERE job_id='old-ambiguous'").get().status,
    'ambiguous',
  );
  assert.equal(
    f.db.prepare("SELECT status FROM wechat_deliveries WHERE job_id='lrout-current'").get().status,
    'pending',
  );
});

test('maintenance redirects app without forwarding private query, keeps public download/config/health and blocks old payment callbacks', () => {
  const middleware = createMaintenanceMiddleware({
    LEGACY_WRITES_PAUSED: '1',
    LEGACY_WEB_REDIRECT_ORIGIN: 'https://app.weiban.online',
  });
  const run = (method, url) => {
    const result = {};
    const response = {
      setHeader() {},
      status(code) {
        result.status = code;
        return this;
      },
      json(body) {
        result.body = body;
      },
      redirect(code, target) {
        result.status = code;
        result.target = target;
      },
    };
    middleware({ method, originalUrl: url }, response, () => {
      result.next = true;
    });
    return result;
  };
  assert.equal(run('GET', '/app/chat?token=FAKE').target, 'https://app.weiban.online/');
  for (const url of [
    '/api/app/config',
    '/api/download-config',
    '/download-assets/test.apk',
    '/health/ready',
  ])
    assert.equal(run('GET', url).next, true);
  for (const url of [
    '/api/auth/register',
    '/api/wechat/bind',
    '/api/chat/messages',
    '/api/pay/alipay/notify',
    '/api/account/profile',
  ])
    assert.equal(run('POST', url).status, 503);
  assert.equal(run('GET', '/api/pay/alipay/return').status, 503);
});

test('old generation hard gates stop recovery and provider callbacks; source patch rejects drift', async () => {
  const chat = patchChatSource(
    "async function generateReply(name, message, context) { return 'ran'; }\nfunction scheduleReplyJob(id) { calls++; }\nasync function runReplyJob(id, overrides = {}) { calls++; }\nfunction recoverReplyWork() { calls++; }\nconst scheduledReplyTrigger={start(){calls++}}; scheduledReplyTrigger.start(1000);",
  );
  const context = { process: { env: { LEGACY_GENERATION_DISABLED: '1' } }, calls: 0 };
  vm.runInNewContext(chat + '\nrecoverReplyWork(); scheduleReplyJob("x");', context);
  assert.equal(context.calls, 0);
  await assert.rejects(
    vm.runInNewContext(chat + '\ngenerateReply("role","message",{});', {
      process: context.process,
      calls: 0,
    }),
  );
  const group = patchGroupSource(
    '  function scheduleTurnJob(jobId) { calls++; }\n  function recoverTurnJobs() { calls++; }\n  function expireAbandonedTurns() { calls++; }',
  );
  vm.runInNewContext(group + '\nrecoverTurnJobs(); scheduleTurnJob("x");', context);
  assert.equal(context.calls, 0);
  const model = patchModelSource(
    'async function withSceneBestOfN(scene, fn, options = {}) { return fn(); }\nasync function withSceneFailover(scene, fn, options = {}) { return fn(); }',
  );
  await assert.rejects(
    vm.runInNewContext(model + '\nwithSceneFailover("text",()=>{calls++});', context),
  );
  assert.equal(context.calls, 0);
  assert.throws(() => patchModelSource('unexpected live code'));
});

test('one env overlay preserves existing encrypted secrets and refuses duplicate conflicting assignments', () => {
  const original = 'JWT_SECRET=wbenc:v1:FAKE_ENCRYPTED_ONLY\nUNRELATED=keep\nMOMENTS_DISABLED=0\n';
  const patched = patchEnvironment(original);
  assert.ok(patched.includes('JWT_SECRET=wbenc:v1:FAKE_ENCRYPTED_ONLY'));
  assert.ok(patched.includes('UNRELATED=keep'));
  assert.ok(patched.includes('MOMENTS_DISABLED=1'));
  assert.throws(() => patchEnvironment('MOMENTS_DISABLED=0\nMOMENTS_DISABLED=1'));
});

test('authentication export is recipient-encrypted and hashes binary recipient DER consistently', () => {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
  const payload = { authKey: 'FAKE_DERIVED_AUTH_KEY_NOT_FOR_PLAINTEXT_DISK' };
  const encrypted = encryptPayload(payload, pair.publicKey);
  assert.equal(JSON.stringify(encrypted).includes(payload.authKey), false);
  const key = crypto.privateDecrypt(
    { key: pair.privateKey, oaepHash: 'sha256', padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
    Buffer.from(encrypted.wrappedKey, 'base64'),
  );
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(encrypted.iv, 'base64'));
  decipher.setAAD(Buffer.from('weiban-legacy-channel-export-v1'));
  decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(encrypted.body, 'base64')),
    decipher.final(),
  ]);
  assert.deepEqual(JSON.parse(plain), payload);
  key.fill(0);
  plain.fill(0);
  const der = pair.publicKey.export({ type: 'spki', format: 'der' });
  assert.equal(sha(der), crypto.createHash('sha256').update(der).digest('hex'));
});
