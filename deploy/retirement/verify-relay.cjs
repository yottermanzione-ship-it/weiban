'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const Sqlite = require('../node_modules/better-sqlite3');
const { loadEnvironment } = require('./archive-environment.cjs');
loadEnvironment({ WEIBAN_DB_PATH: '/bridge-data/bridge.sqlite' });
const { deriveKey, sign } = require('../lib/legacy_channel_relay.cjs');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
async function main() {
  const map = JSON.parse(fs.readFileSync('/run/retirement/legacy-map.json', 'utf8')).bindings;
  const db = new Sqlite('/bridge-data/bridge.sqlite', { readonly: true, fileMustExist: true });
  let localInvalid = 0,
    accepted = 0;
  const http = {};
  try {
    for (const m of map) {
      const row = db
        .prepare(
          'SELECT status,generation,ilink_user_id,persona_name FROM wechat_bindings WHERE user_id=?',
        )
        .get(m.userId);
      if (!row || row.status !== 'active') {
        localInvalid++;
        continue;
      }
      if (
        row.generation !== m.generation ||
        hash(row.ilink_user_id) !== m.peerHash ||
        hash(row.persona_name) !== m.personaHash
      )
        throw new Error('MAPPING_MISMATCH');
      const key = deriveKey(process.env.JWT_SECRET, m.id);
      try {
        const r = await fetch(`https://app.weiban.online/api/v1/internal/channels/legacy/${m.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sign(key, m.id, { op: 'status', generation: m.generation })),
          redirect: 'error',
          signal: AbortSignal.timeout(15000),
        });
        http[r.status] = (http[r.status] || 0) + 1;
        if (r.ok) {
          const value = await r.json();
          if (value.enabled && value.generation === m.generation) accepted++;
        }
      } finally {
        key.fill(0);
      }
    }
    const polling = db
      .prepare(
        "SELECT count(*) AS active,max(last_poll_at) AS newestPoll FROM wechat_bindings WHERE status='active'",
      )
      .get();
    console.log(
      JSON.stringify({
        mapped: map.length,
        localInvalid,
        signedStatusAccepted: accepted,
        http,
        standbyPollTimestamp: polling.newestPoll,
        connectedToWechat: false,
        messagesSent: 0,
        modelCalls: 0,
      }),
    );
    if (accepted + localInvalid !== map.length) process.exitCode = 1;
  } finally {
    db.close();
  }
}
main().catch(() => {
  console.error('RELAY_PREPARATION_CHECK_FAILED');
  process.exitCode = 1;
});
