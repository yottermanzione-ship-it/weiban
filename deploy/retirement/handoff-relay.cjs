'use strict';
// New-host operator utility. Plan is read-only; apply refuses a running old transport.
const fs = require('node:fs');
const crypto = require('node:crypto');
const Sqlite = require('../node_modules/better-sqlite3');
const { readKey, open } = require('./sealed-json.cjs');
const mode = process.argv[2];
if (!['plan', 'apply'].includes(mode)) throw new Error('HANDOFF_MODE_REQUIRED');
const filename = process.argv[3];
if (!/^wechat-\d+\.sealed\.json$/.test(filename || '')) throw new Error('CAPTURE_FILE_INVALID');
const bytes = fs.readFileSync('/entry/' + filename);
const key = readKey('/run/secrets/kek');
let capture;
try {
  capture = open(JSON.parse(bytes.toString('utf8')), key);
} finally {
  key.fill(0);
}
if (capture.kind !== 'wechat' || !Array.isArray(capture.entries))
  throw new Error('CAPTURE_INVALID');
const map = JSON.parse(fs.readFileSync('/entry/relay-control/legacy-map.json', 'utf8')).bindings;
const db = new Sqlite('/entry/bridge-data/bridge.sqlite', {
  readonly: mode === 'plan',
  fileMustExist: true,
});
const digest = (v) => crypto.createHash('sha256').update(v).digest('hex');
try {
  if (capture.entries.length !== map.length) throw new Error('CAPTURE_COHORT_CHANGED');
  let ready = 0,
    rebind = 0;
  for (const entry of capture.entries) {
    const m = map.find((row) => row.id === entry.legacyId && row.userId === entry.userId);
    if (!m) throw new Error('OWNER_CHANGED');
    const row = db
      .prepare('SELECT status,generation,persona_name FROM wechat_bindings WHERE user_id=?')
      .get(entry.userId);
    if (!row) throw new Error('TARGET_BINDING_MISSING');
    if (entry.needsRebind) {
      rebind++;
      continue;
    }
    if (
      m.generation !== entry.generation ||
      row.generation !== entry.generation ||
      row.status !== 'active' ||
      digest(row.persona_name) !== m.personaHash ||
      digest(entry.accountId) !== m.peerHash ||
      !entry.botToken ||
      !entry.botId
    )
      throw new Error('BINDING_STATE_CHANGED');
    ready++;
  }
  if (mode === 'apply') {
    if (
      !capture.sourcePollingStopped ||
      capture.pendingInbox !== 0 ||
      capture.pendingDeliveries !== 0
    )
      throw new Error('OLD_TRANSPORT_NOT_QUIESCENT');
    const age = Date.now() - Date.parse(capture.createdAt);
    if (!Number.isFinite(age) || age < 0 || age > 300000) throw new Error('CAPTURE_NOT_FRESH');
    // Operator must first confirm that the new site's offered_seq equals after_seq
    // for the mapped bindings, so acknowledged old deliveries cannot be replayed.
    if (process.argv[4] !== '--target-acknowledged') throw new Error('TARGET_ACK_CHECK_REQUIRED');
    if (fs.existsSync('/entry/relay-control/activation.json'))
      throw new Error('HANDOFF_ALREADY_APPLIED');
    db.transaction(() => {
      for (const entry of capture.entries) {
        if (entry.needsRebind) {
          db.prepare(
            "UPDATE wechat_bindings SET status='unbound',bot_token='',bot_id='',ilink_user_id='',cursor='',last_context_token='',updated_at=? WHERE user_id=?",
          ).run(capture.createdAt, entry.userId);
        } else {
          db.prepare(
            "UPDATE wechat_bindings SET bot_token=?,bot_id=?,ilink_user_id=?,base_url=?,cursor=?,last_context_token=?,last_poll_at=?,updated_at=? WHERE user_id=? AND status='active' AND generation=?",
          ).run(
            entry.botToken,
            entry.botId,
            entry.accountId,
            entry.baseUrl,
            entry.cursor || '',
            entry.contextToken || '',
            entry.lastPollAt || '',
            entry.sourceUpdatedAt,
            entry.userId,
            entry.generation,
          );
        }
      }
    })();
    const receipt = {
      version: 1,
      oldWechatStopped: true,
      captureSha256: digest(bytes),
      activatedAt: new Date().toISOString(),
      ready,
      rebind,
    };
    fs.writeFileSync('/entry/relay-control/activation.json', JSON.stringify(receipt), {
      flag: 'wx',
      mode: 0o600,
    });
    fs.chownSync('/entry/relay-control/activation.json', 1000, 1000);
  }
  console.log(
    JSON.stringify({
      mode,
      readyBindings: ready,
      needsRebind: rebind,
      oldTransportStopped: capture.sourcePollingStopped === true,
      pendingInbox: capture.pendingInbox,
      pendingDeliveries: capture.pendingDeliveries,
      enabledNewTransport: false,
    }),
  );
} finally {
  db.close();
}
