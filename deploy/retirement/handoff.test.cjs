'use strict';
// Disposable container test only: /entry and /run/secrets must be empty tmpfs mounts.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const Sqlite = require('../node_modules/better-sqlite3');
const { seal } = require('./sealed-json.cjs');
if (fs.existsSync('/entry/archive.sealed.json')) throw new Error('TEST_REQUIRES_EMPTY_DIRECTORY');
fs.mkdirSync('/entry/bridge-data', { recursive: true });
fs.mkdirSync('/entry/relay-control', { recursive: true });
const key = Buffer.alloc(32, 7); // Synthetic test key, never a live credential.
fs.writeFileSync('/run/secrets/kek', key.toString('hex'));
const hash = (v) => crypto.createHash('sha256').update(v).digest('hex');
const m = {
  id: 'fake-legacy-binding',
  userId: 'fake-user',
  generation: 3,
  peerHash: hash('fake-peer'),
  personaHash: hash('fake-persona'),
};
fs.writeFileSync('/entry/relay-control/legacy-map.json', JSON.stringify({ bindings: [m] }));
const db = new Sqlite('/entry/bridge-data/bridge.sqlite');
db.exec(`CREATE TABLE wechat_bindings(user_id TEXT PRIMARY KEY,status TEXT,generation INTEGER,persona_name TEXT,
bot_token TEXT,bot_id TEXT,ilink_user_id TEXT,base_url TEXT,cursor TEXT,last_context_token TEXT,last_poll_at TEXT,updated_at TEXT);
INSERT INTO wechat_bindings VALUES('fake-user','active',3,'fake-persona','FAKE-OLD-TOKEN','','','','','','','');`);
const entry = {
  legacyId: m.id,
  userId: m.userId,
  generation: 3,
  accountId: 'fake-peer',
  botId: 'fake-bot',
  botToken: 'FAKE-NEW-TOKEN',
  baseUrl: 'https://ilinkai.weixin.qq.com',
  cursor: 'fake-cursor',
  contextToken: 'FAKE-CONTEXT',
  lastPollAt: '',
  sourceUpdatedAt: '2026-11-10T00:00:00Z',
  needsRebind: false,
};
const base = {
  kind: 'wechat',
  version: 1,
  createdAt: new Date().toISOString(),
  sourcePollingStopped: false,
  pendingInbox: 0,
  pendingDeliveries: 0,
  entries: [entry],
};
const invoke = (mode, payload, targetAcknowledged = true) => {
  fs.writeFileSync('/entry/wechat-100.sealed.json', JSON.stringify(seal(payload, key)));
  try {
    return {
      ok: true,
      value: JSON.parse(
        execFileSync(
          process.execPath,
          [
            __dirname + '/handoff-relay.cjs',
            mode,
            'wechat-100.sealed.json',
            ...(targetAcknowledged ? ['--target-acknowledged'] : []),
          ],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        ),
      ),
    };
  } catch (error) {
    return { ok: false, error: /Error: ([A-Z_]+)/.exec(String(error.stderr))?.[1] };
  }
};
assert.equal(invoke('plan', base).value.readyBindings, 1);
assert.equal(invoke('apply', base).error, 'OLD_TRANSPORT_NOT_QUIESCENT');
assert.equal(
  invoke('apply', { ...base, sourcePollingStopped: true, pendingInbox: 1 }).error,
  'OLD_TRANSPORT_NOT_QUIESCENT',
);
assert.equal(
  invoke('apply', { ...base, sourcePollingStopped: true, createdAt: '2000-01-01T00:00:00Z' }).error,
  'CAPTURE_NOT_FRESH',
);
assert.equal(
  invoke('plan', { ...base, entries: [{ ...entry, userId: 'different-user' }] }).error,
  'OWNER_CHANGED',
);
assert.equal(
  invoke('apply', { ...base, sourcePollingStopped: true }, false).error,
  'TARGET_ACK_CHECK_REQUIRED',
);
assert.equal(db.prepare('SELECT bot_token FROM wechat_bindings').get().bot_token, 'FAKE-OLD-TOKEN');
assert.equal(invoke('apply', { ...base, sourcePollingStopped: true }).ok, true);
assert.equal(db.prepare('SELECT bot_token FROM wechat_bindings').get().bot_token, 'FAKE-NEW-TOKEN');
assert.equal(
  invoke('apply', { ...base, sourcePollingStopped: true }).error,
  'HANDOFF_ALREADY_APPLIED',
);
assert.equal(
  JSON.parse(fs.readFileSync('/entry/relay-control/activation.json')).oldWechatStopped,
  true,
);
db.close();
console.log(
  JSON.stringify({
    passed: 8,
    realCredentials: false,
    realAccounts: false,
    enabledAnyTransport: false,
  }),
);
