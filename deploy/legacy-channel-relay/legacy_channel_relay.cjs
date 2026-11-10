'use strict';

// Installed beside the old server's existing lib modules. No application/model imports.
// Existing inbox + delivery tables are reused; old pending reply jobs are never created.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const SOURCE = 'legacy_relay';
const keyOf = (channel, id) => `${channel}:${id}`;
const sha = (value) =>
  crypto
    .createHash('sha256')
    .update(Buffer.isBuffer(value) ? value : String(value))
    .digest('hex');
const str = (value) => String(value == null ? '' : value).trim();
const fail = (code) => {
  throw new Error(code);
};

function deriveKey(jwtSecret, id) {
  if (str(jwtSecret).length < 24 || str(jwtSecret).startsWith('wbenc:'))
    fail('LEGACY_RELAY_SECRET_UNAVAILABLE');
  return crypto
    .createHmac('sha256', jwtSecret)
    .update(`weiban:legacy-channel-key:v1:${id}`)
    .digest();
}

function sign(key, id, payload, now = Date.now()) {
  const envelope = { sentAt: now, nonce: crypto.randomUUID(), payload: JSON.stringify(payload) };
  envelope.signature = crypto
    .createHmac('sha256', key)
    .update(
      `weiban-legacy-relay-v1\n${id}\n${envelope.sentAt}\n${envelope.nonce}\n${envelope.payload}`,
    )
    .digest('hex');
  return envelope;
}

function parseMap(raw) {
  if (
    !raw ||
    raw.version !== 1 ||
    !Array.isArray(raw.bindings) ||
    !raw.bindings.length ||
    raw.bindings.length > 1000
  )
    fail('LEGACY_RELAY_MAP_INVALID');
  const seen = new Set();
  for (const m of raw.bindings) {
    if (
      !m ||
      !UUID.test(m.id) ||
      !UUID.test(m.userId) ||
      !['wechat', 'weibo', 'qq'].includes(m.channel) ||
      !str(m.legacyBindingId) ||
      !Number.isSafeInteger(m.generation) ||
      m.generation < 1 ||
      !HASH.test(m.peerHash) ||
      !HASH.test(m.personaHash) ||
      !Number.isFinite(Date.parse(m.cutoverAt)) ||
      seen.has(keyOf(m.channel, m.legacyBindingId)) ||
      seen.has(m.id)
    )
      fail('LEGACY_RELAY_MAP_INVALID');
    seen.add(keyOf(m.channel, m.legacyBindingId));
    seen.add(m.id);
  }
  return raw.bindings;
}

function eventTime(value) {
  const numeric = Number(value);
  const ms =
    typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value || ''))
      ? numeric < 10_000_000_000
        ? numeric * 1000
        : numeric
      : Date.parse(String(value || ''));
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

function createMaintenanceMiddleware(env = process.env) {
  let origin = null;
  if (env.LEGACY_WEB_REDIRECT_ORIGIN) {
    const parsed = new URL(env.LEGACY_WEB_REDIRECT_ORIGIN);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== '/'
    )
      fail('LEGACY_REDIRECT_ORIGIN_INVALID');
    origin = parsed.origin;
  }
  return (req, res, next) => {
    // Express routes are case-insensitive; classification must use the same rule.
    // This does not rewrite the URL or the case of any route parameter.
    const pathname = String(req.originalUrl || req.url || '')
      .split('?')[0]
      .toLowerCase();
    if (
      origin &&
      ['GET', 'HEAD'].includes(req.method) &&
      (pathname === '/app' || pathname.startsWith('/app/'))
    ) {
      res.setHeader('Cache-Control', 'no-store');
      return res.redirect(302, origin + '/');
    }
    if (
      env.LEGACY_WRITES_PAUSED === '1' &&
      pathname.startsWith('/api/') &&
      req.method !== 'OPTIONS'
    ) {
      // Some old GET routes mutate state (QR confirmation, payment status, proactive receipts).
      // Provider channel ingress is long-poll/WSS and never traverses Express. Old payment
      // callbacks receive 503 and retain their retry; they must never settle old orders again.
      if (
        ['GET', 'HEAD'].includes(req.method) &&
        ['/api/app/config', '/api/download-config'].includes(pathname)
      )
        return next();
      const adminRoute = pathname.startsWith('/api/admin/') || pathname.startsWith('/api/ops/');
      const adminSession =
        req.method === 'POST' && /^\/api\/admin\/(login|logout)\/?$/.test(pathname);
      if ((adminRoute && ['GET', 'HEAD'].includes(req.method)) || adminSession) {
        // Only remove the migration gate. Original rate limits, password/session
        // validation, CSRF checks and each route's requireAdmin still run.
        res.setHeader('Cache-Control', 'no-store');
        return next();
      }
      if (adminRoute) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(409).json({
          ok: false,
          code: 'LEGACY_ADMIN_READ_ONLY',
          error: '旧后台可查看历史资料；账号、订单和配置修改请在新版后台进行。',
          message: '旧后台可查看历史资料；账号、订单和配置修改请在新版后台进行。',
          new_admin_url: 'https://admin.weiban.online/',
        });
      }
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Retry-After', '60');
      return res.status(503).json({
        ok: false,
        code: 'UPGRADE_MAINTENANCE',
        error: '微伴正在升级，请前往新版继续使用。',
        message: '微伴正在升级，请前往新版继续使用。',
        new_app_url: origin,
      });
    }
    return next();
  };
}

function createLegacyRelay(options = {}) {
  const env = options.env || process.env;
  if (env.LEGACY_CHANNEL_RELAY_ENABLED !== '1') return null;
  if (env.WEIBO_CHANNEL_ENABLED !== '0') fail('LEGACY_WEIBO_RELAY_NOT_AUTHORIZED');
  if (
    [
      'LEGACY_GENERATION_DISABLED',
      'LEGACY_BACKGROUND_DISABLED',
      'LEGACY_WRITES_PAUSED',
      'HEARTBEAT_DISABLED',
      'GROUP_SCENES_DISABLED',
      'MOMENTS_DISABLED',
      'MOMENTS_PUBLISH_DISABLED',
    ].some((key) => env[key] !== '1')
  )
    fail('LEGACY_RELAY_REQUIRES_GENERATION_PAUSED');
  const database = options.database;
  if (!database) fail('LEGACY_RELAY_DATABASE_REQUIRED');
  const bindings = parseMap(
    options.mapping || JSON.parse(fs.readFileSync(env.LEGACY_CHANNEL_RELAY_MAP_FILE, 'utf8')),
  );
  const url = new URL(env.LEGACY_CHANNEL_RELAY_BASE_URL);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  )
    fail('LEGACY_RELAY_HTTPS_ORIGIN_REQUIRED');
  const fetchImpl = options.fetch || global.fetch;
  const now = options.now || (() => new Date().toISOString());
  const byOld = new Map(bindings.map((m) => [keyOf(m.channel, m.legacyBindingId), m]));
  const remoteDisabled = new Set();
  const acknowledged = new Map();
  const root = options.legacyRoot || path.resolve(__dirname, '..');
  const { dedupeKey, deliveryClientIdFor } =
    options.wechatHelpers || require(path.join(root, 'lib/wechat/inbound_service.js'));

  // Global startup recovery must have nothing left that could invoke the old model or resend an old reply.
  const jobs = database
    .prepare("SELECT count(*) AS n FROM chat_reply_jobs WHERE status IN ('pending','running')")
    .get();
  const groupJobs = database
    .prepare("SELECT count(*) AS n FROM group_turn_jobs WHERE status IN ('pending','running')")
    .get();
  if (jobs.n || groupJobs.n) fail('LEGACY_RELAY_OLD_JOBS_NOT_DRAINED');
  for (const channel of ['wechat', 'weibo', 'qq']) {
    const row = database
      .prepare(
        `SELECT count(*) AS n FROM ${channel}_deliveries WHERE status IN ('pending','retry','claimed','sending') AND job_id NOT LIKE 'lrout-%'`,
      )
      .get();
    if (row.n) fail('LEGACY_RELAY_OLD_DELIVERIES_NOT_FROZEN');
    // No automatic retransmission after a process dies during a provider send.
    if (channel !== 'wechat')
      database
        .prepare(
          `UPDATE ${channel}_deliveries SET status='ambiguous',last_error='relay_interrupted_after_send',updated_at=? WHERE status='sending' AND job_id LIKE 'lrout-%'`,
        )
        .run(now());
  }

  function current(m) {
    const row =
      m.channel === 'wechat'
        ? database.prepare('SELECT * FROM wechat_bindings WHERE user_id=?').get(m.legacyBindingId)
        : database.prepare(`SELECT * FROM ${m.channel}_bindings WHERE id=?`).get(m.legacyBindingId);
    const peer =
      row &&
      str(
        row[
          m.channel === 'wechat' ? 'ilink_user_id' : m.channel === 'weibo' ? 'weibo_uid' : 'qq_uid'
        ],
      );
    if (
      !row ||
      row.status !== 'active' ||
      str(row.user_id) !== m.userId ||
      Number(row.generation) !== m.generation ||
      !peer ||
      sha(peer) !== m.peerHash ||
      sha(str(row.persona_name)) !== m.personaHash
    )
      return null;
    return { ...row, relayPeer: peer };
  }

  function resolve(channel, id) {
    const mapping = byOld.get(keyOf(channel, str(id)));
    return mapping && !remoteDisabled.has(mapping.id) && current(mapping) ? mapping : null;
  }

  async function request(m, payload) {
    if (!current(m)) fail('LEGACY_RELAY_BINDING_CHANGED');
    const key = deriveKey(env.JWT_SECRET, m.id);
    let response;
    try {
      response = await fetchImpl(`${url.origin}/api/v1/internal/channels/legacy/${m.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          sign(key, m.id, { ...payload, generation: m.generation }, Date.parse(now())),
        ),
        signal: AbortSignal.timeout(15_000),
        redirect: 'error',
      });
    } catch {
      fail('LEGACY_RELAY_UNREACHABLE');
    } finally {
      key.fill(0);
    }
    if (!response.ok) {
      if ([401, 403, 409].includes(response.status)) remoteDisabled.add(m.id);
      const error = new Error(`LEGACY_RELAY_HTTP_${response.status}`);
      error.status = response.status;
      throw error;
    }
    try {
      const value = await response.json();
      remoteDisabled.delete(m.id);
      return value;
    } catch {
      fail('LEGACY_RELAY_RESPONSE_INVALID');
    }
  }

  function validInbound(m, peer, externalId, text, createdAt) {
    return (
      current(m) &&
      sha(str(peer)) === m.peerHash &&
      str(externalId).length > 0 &&
      str(externalId).length <= 256 &&
      str(text).length > 0 &&
      str(text).length <= 2000 &&
      createdAt &&
      Date.parse(createdAt) >= Date.parse(m.cutoverAt) &&
      Date.parse(createdAt) <= Date.parse(now()) + 60_000
    );
  }

  function inboxKey(m, externalId) {
    return `lr:${m.id}:${externalId}`;
  }
  function marker(m) {
    return `lr:${m.id}`;
  }

  function wechatInbound() {
    const ingest = database.transaction((candidate, batch) => {
      const m = resolve('wechat', candidate && candidate.user_id);
      if (!m || Number(candidate.generation) !== m.generation)
        return { stale: true, jobIds: [], results: [] };
      const binding = current(m);
      let accepted = 0,
        duplicates = 0,
        rejected = 0,
        contextToken = '';
      for (const msg of Array.isArray(batch.messages) ? batch.messages : []) {
        const externalId = dedupeKey(msg);
        const text = (Array.isArray(msg.item_list) ? msg.item_list : [])
          .filter((item) => item && item.text_item && typeof item.text_item.text === 'string')
          .map((item) => item.text_item.text)
          .join('\n')
          .trim();
        const createdAt = eventTime(msg.create_time_ms) || now();
        if (!validInbound(m, msg.from_user_id, externalId, text, createdAt)) {
          rejected++;
          continue;
        }
        // Any pre-cutover receipt remains authoritative, even if the platform replays it.
        if (
          database
            .prepare(
              'SELECT 1 FROM wechat_inbox WHERE user_id=? AND binding_generation=? AND dedupe_key=?',
            )
            .get(m.userId, m.generation, externalId)
        ) {
          duplicates++;
          continue;
        }
        const key = inboxKey(m, externalId);
        const inserted = database
          .prepare(
            `INSERT OR IGNORE INTO wechat_inbox
          (id,user_id,binding_generation,dedupe_key,source_cursor,sender_id,text,context_token,message_created_at,status,job_id,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,'received',?,?)`,
          )
          .run(
            `lri-${sha(key)}`,
            m.userId,
            m.generation,
            key,
            str(batch.nextCursor),
            str(msg.from_user_id),
            text,
            str(msg.context_token),
            createdAt,
            marker(m),
            now(),
          );
        if (inserted.changes) accepted++;
        else duplicates++;
        if (msg.context_token) contextToken = str(msg.context_token);
      }
      const updated = database
        .prepare(
          `UPDATE wechat_bindings SET cursor=?,last_context_token=CASE WHEN ?<>'' THEN ? ELSE last_context_token END,last_poll_at=?,updated_at=?
        WHERE user_id=? AND generation=? AND status='active'`,
        )
        .run(
          str(batch.nextCursor) || binding.cursor,
          contextToken,
          contextToken,
          now(),
          now(),
          m.userId,
          m.generation,
        );
      if (updated.changes !== 1) fail('LEGACY_RELAY_BINDING_CHANGED');
      return { accepted, duplicates, rejected, stale: false, jobIds: [], results: [] };
    });
    return { ingestBatch: (binding, batch) => ingest.immediate(binding, batch || {}) };
  }

  function socketInbound(channel) {
    return {
      handleInbound: async (msg, ctx = {}) => {
        let m;
        const peer = str(channel === 'weibo' ? msg.fromUserId : msg.userId);
        if (channel === 'weibo') {
          m = resolve(channel, ctx.bindingId);
          if (!m || str(ctx.userId) !== m.userId) return { ok: false, reason: 'unmapped' };
        } else {
          m = bindings.find(
            (item) =>
              item.channel === 'qq' &&
              !remoteDisabled.has(item.id) &&
              item.peerHash === sha(peer) &&
              current(item),
          );
        }
        if (!m) return { ok: false, reason: 'unmapped' };
        const text = str(msg.text),
          externalId = str(msg.messageId);
        const createdAt =
          eventTime(
            channel === 'weibo'
              ? (msg.raw && msg.raw.timestamp) || msg.timestamp
              : msg.raw && msg.raw.d && msg.raw.d.timestamp,
          ) || now();
        if (!validInbound(m, peer, externalId, text, createdAt))
          return { ok: false, reason: 'rejected' };
        const peerColumn = channel === 'weibo' ? 'weibo_uid' : 'qq_uid';
        if (
          database
            .prepare(`SELECT 1 FROM ${channel}_inbox WHERE ${peerColumn}=? AND dedupe_key=?`)
            .get(peer, externalId)
        )
          return { ok: false, reason: 'duplicate' };
        const key = inboxKey(m, externalId);
        const result = database
          .prepare(
            `INSERT OR IGNORE INTO ${channel}_inbox (id,${peerColumn},dedupe_key,text,status,job_id,created_at)
        VALUES(?,?,?,?,'received',?,?)`,
          )
          .run(`lri-${sha(key)}`, peer, key, text, marker(m), createdAt);
        return { ok: result.changes === 1, reason: result.changes ? 'queued' : 'duplicate' };
      },
    };
  }

  async function forwardInbound(m) {
    const table = `${m.channel}_inbox`;
    const rows = database
      .prepare(
        `SELECT * FROM ${table} WHERE job_id=? AND status='received' ORDER BY created_at,id LIMIT 10`,
      )
      .all(marker(m));
    for (const row of rows) {
      try {
        const result = await request(m, {
          op: 'ingest',
          externalId: row.dedupe_key.slice(inboxKey(m, '').length),
          peerHash: m.peerHash,
          text: row.text,
          createdAt: m.channel === 'wechat' ? row.message_created_at : row.created_at,
        });
        if (!result || result.accepted !== true) fail('LEGACY_RELAY_RESPONSE_INVALID');
        database
          .prepare(
            `UPDATE ${table} SET status='accepted',reason='',processed_at=? WHERE id=? AND status='received'`,
          )
          .run(now(), row.id);
      } catch (error) {
        if (error.status === 400 || error.status === 422)
          database
            .prepare(
              `UPDATE ${table} SET status='rejected',reason='new_server_rejected',processed_at=? WHERE id=? AND status='received'`,
            )
            .run(now(), row.id);
        // Auth, maintenance, mapping and transport errors are held. Never an old-model fallback.
        else break;
      }
    }
  }

  const enqueue = database.transaction((m, page) => {
    const binding = current(m);
    if (
      !binding ||
      !page ||
      page.generation !== m.generation ||
      !Number.isSafeInteger(page.throughSeq) ||
      !Array.isArray(page.messages) ||
      page.messages.length > 50
    )
      fail('LEGACY_RELAY_RESPONSE_INVALID');
    for (const message of page.messages) {
      if (
        !message ||
        !UUID.test(message.messageId) ||
        !Number.isSafeInteger(message.seq) ||
        message.seq > page.throughSeq ||
        typeof message.text !== 'string' ||
        !message.text.trim() ||
        message.text.length > 20_000
      )
        fail('LEGACY_RELAY_RESPONSE_INVALID');
      const id = `lrout-${sha(`${m.id}\0${message.messageId}`)}`;
      const ts = now();
      const context = {
        source: SOURCE,
        legacy_relay_binding_id: m.id,
        legacy_generation: m.generation,
        new_message_id: message.messageId,
        relay_seq: message.seq,
      };
      const inserted = database
        .prepare(
          `INSERT OR IGNORE INTO chat_reply_jobs
        (id,user_id,persona_name,user_message,context_json,status,reply,created_at,updated_at,completed_at)
        VALUES(?,?,?,'',?,'done',?,?,?,?)`,
        )
        .run(id, m.userId, binding.persona_name, JSON.stringify(context), message.text, ts, ts, ts);
      if (!inserted.changes) continue;
      if (m.channel === 'wechat')
        database
          .prepare(
            `INSERT INTO wechat_deliveries
        (job_id,user_id,status,binding_generation,context_token,next_attempt_at,client_id,created_at,updated_at)
        VALUES(?,?,'pending',?,?,?,?,?,?)`,
          )
          .run(
            id,
            m.userId,
            m.generation,
            binding.last_context_token || '',
            ts,
            deliveryClientIdFor(id),
            ts,
            ts,
          );
      else {
        const peerColumn = m.channel === 'weibo' ? 'weibo_uid' : 'qq_uid';
        const extraColumn = m.channel === 'weibo' ? ',binding_id' : '';
        const extraPlaceholder = m.channel === 'weibo' ? ',?' : '';
        database
          .prepare(
            `INSERT INTO ${m.channel}_deliveries
          (job_id,user_id,${peerColumn},status,binding_generation,next_attempt_at,created_at,updated_at${extraColumn})
          VALUES(?,?,?,'pending',?,?,?,?${extraPlaceholder})`,
          )
          .run(
            id,
            m.userId,
            binding.relayPeer,
            m.generation,
            ts,
            ts,
            ts,
            ...(m.channel === 'weibo' ? [m.legacyBindingId] : []),
          );
      }
    }
  });

  async function pump(m) {
    if (!current(m)) return;
    await forwardInbound(m);
    const page = await request(m, { op: 'poll' });
    enqueue.immediate(m, page);
    if (acknowledged.get(m.id) !== page.throughSeq) {
      const ack = await request(m, { op: 'ack', throughSeq: page.throughSeq });
      if (!ack || ack.acknowledged !== true) fail('LEGACY_RELAY_RESPONSE_INVALID');
      acknowledged.set(m.id, page.throughSeq);
    }
  }

  const pumping = new Set();
  function runPump(channel) {
    if (pumping.has(channel)) return Promise.resolve();
    pumping.add(channel);
    return (async () => {
      const items = bindings.filter((m) => m.channel === channel);
      // Four bounded lanes, no second scheduler or model worker.
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, items.length) }, async () => {
          for (;;) {
            const m = items[next++];
            if (!m) return;
            try {
              await pump(m);
            } catch {
              /* held in durable inbox/outbox */
            }
          }
        }),
      );
    })().finally(() => pumping.delete(channel));
  }

  function mappedWechatStore(store) {
    return {
      ...store,
      listActive: () => store.listActive().filter((row) => resolve('wechat', row.user_id)),
      proRejection: (userId) => (resolve('wechat', userId) ? null : '中继绑定不可用'),
    };
  }

  function mappedWechatClient(client) {
    return {
      ...client,
      sendText: async (token, peer, text, context, clientId, baseUrl) => {
        const m = bindings.find(
          (item) => item.channel === 'wechat' && item.peerHash === sha(str(peer)) && current(item),
        );
        if (!m) fail('LEGACY_RELAY_BINDING_CHANGED');
        await request(m, { op: 'status' });
        const fresh = current(m);
        if (!fresh || fresh.bot_token !== token || fresh.base_url !== baseUrl)
          fail('LEGACY_RELAY_BINDING_CHANGED');
        return client.sendText(token, fresh.relayPeer, text, context, clientId, baseUrl);
      },
    };
  }

  async function socketDelivery(channel, send) {
    const rows = database
      .prepare(
        `SELECT d.*,j.context_json,j.reply FROM ${channel}_deliveries d JOIN chat_reply_jobs j ON j.id=d.job_id
      WHERE d.status='pending' AND d.job_id LIKE 'lrout-%' AND j.status='done' ORDER BY d.created_at,d.job_id LIMIT 20`,
      )
      .all();
    for (const row of rows) {
      let context;
      try {
        context = JSON.parse(row.context_json);
      } catch {
        continue;
      }
      const m = bindings.find(
        (item) => item.id === context.legacy_relay_binding_id && item.channel === channel,
      );
      const fresh = m && current(m);
      const peer = str(row[channel === 'weibo' ? 'weibo_uid' : 'qq_uid']);
      if (
        !fresh ||
        row.user_id !== m.userId ||
        Number(row.binding_generation) !== m.generation ||
        context.legacy_generation !== m.generation ||
        sha(peer) !== m.peerHash ||
        (channel === 'weibo' && row.binding_id !== m.legacyBindingId)
      ) {
        database
          .prepare(
            `UPDATE ${channel}_deliveries SET status='skipped',last_error='relay_binding_changed',updated_at=? WHERE job_id=? AND status='pending'`,
          )
          .run(now(), row.job_id);
        continue;
      }
      try {
        await request(m, { op: 'status' });
      } catch {
        continue;
      }
      if (!current(m)) continue;
      let replyTo = '';
      if (channel === 'qq') {
        const incoming = database
          .prepare(
            "SELECT dedupe_key,created_at FROM qq_inbox WHERE job_id=? AND status='accepted' ORDER BY created_at DESC LIMIT 1",
          )
          .get(marker(m));
        if (!incoming || Date.parse(now()) - Date.parse(incoming.created_at) > 5 * 60_000) continue;
        replyTo = incoming.dedupe_key.slice(inboxKey(m, '').length);
      }
      const claimed = database
        .prepare(
          `UPDATE ${channel}_deliveries SET status='sending',attempt_count=attempt_count+1,updated_at=? WHERE job_id=? AND status='pending'`,
        )
        .run(now(), row.job_id);
      if (!claimed.changes) continue;
      try {
        await send(m, fresh.relayPeer, row.reply, replyTo);
        database
          .prepare(
            `UPDATE ${channel}_deliveries SET status='sent',last_error='',updated_at=? WHERE job_id=? AND status='sending'`,
          )
          .run(now(), row.job_id);
      } catch {
        database
          .prepare(
            `UPDATE ${channel}_deliveries SET status='ambiguous',last_error='provider_result_unknown',updated_at=? WHERE job_id=? AND status='sending'`,
          )
          .run(now(), row.job_id);
      }
    }
  }

  function socketRunner(channel, start, stop, send) {
    let timer = null,
      busy = false,
      running = false;
    const tick = async () => {
      if (!running || busy) return;
      busy = true;
      try {
        await runPump(channel);
        if (running) await socketDelivery(channel, send);
      } catch {
        /* never log provider bodies, credentials or chat text */
      } finally {
        busy = false;
      }
    };
    return {
      start() {
        if (running) return;
        running = true;
        start();
        timer = setInterval(tick, 5000);
        timer.unref?.();
        void tick();
      },
      stop() {
        running = false;
        if (timer) clearInterval(timer);
        timer = null;
        stop();
      },
    };
  }

  function wrapWechatPoller(poller) {
    return {
      ...poller,
      deliverDue: async (input) => {
        await runPump('wechat');
        return poller.deliverDue(input);
      },
    };
  }

  return {
    wechatInbound,
    weiboInbound: () => socketInbound('weibo'),
    qqInbound: () => socketInbound('qq'),
    mappedWechatStore,
    mappedWechatClient,
    wrapWechatPoller,
    weiboRunner: (pool) =>
      socketRunner(
        'weibo',
        () => pool.startAll(),
        () => pool.stopAll(),
        (m, peer, text) => pool.sendText(m.legacyBindingId, peer, text),
      ),
    qqRunner: (client) =>
      socketRunner(
        'qq',
        () => client.start(),
        () => client.stop(),
        (_m, peer, text, replyTo) => client.sendPrivateText(peer, text, replyTo),
      ),
    // Narrow test seams; never returned over HTTP.
    current,
    request,
    runPump,
    flushSocket: socketDelivery,
  };
}

module.exports = {
  createLegacyRelay,
  createMaintenanceMiddleware,
  parseMap,
  deriveKey,
  sign,
  eventTime,
  sha,
};
