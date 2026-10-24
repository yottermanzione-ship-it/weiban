#!/usr/bin/env node
/**
 * 一次性清理：旧卡空白名单缺陷期间误发的「已切换到 日常聊天」系统提示。
 * 只按每个会话所属用户隐藏（chat.hidden_messages），不删消息、不改 seq、可回滚。
 * 判定条件严格：code=scenario_mode_changed 且 params.mode=daily 且 reason=scenario_mode_unavailable。
 */
import 'reflect-metadata';
import fs from 'node:fs';
import { Database } from '../../apps/server/src/platform/db/database.ts';
import { loadConfig } from '../../apps/server/src/platform/config/config.ts';
import { loadKekRing } from '../../apps/server/src/platform/crypto/kek-ring.ts';
import { EnvelopeCrypto } from '../../apps/server/src/platform/crypto/envelope.ts';
import { SystemClock } from '../../apps/server/src/platform/clock/clock.ts';

const SINCE = process.argv.includes('--since')
  ? process.argv[process.argv.indexOf('--since') + 1]
  : '2026-10-24T00:00:00Z';
const REPORT = process.argv.includes('--report')
  ? process.argv[process.argv.indexOf('--report') + 1]
  : '/reports/scenario-notice-cleanup.json';
const config = loadConfig();
const clock = new SystemClock();
const ring = loadKekRing(config);
const db = new Database({ url: config.database.url, poolMax: 2 });
const crypto = new EnvelopeCrypto(db, clock, ring);

async function main() {
  const owners = (
    await db.query(
      `SELECT DISTINCT c.owner_user_id AS owner FROM chat.messages m
       JOIN chat.conversations c ON c.id=m.conversation_id
       WHERE m.content_type='system' AND m.created_at >= $1`,
      [SINCE],
    )
  ).rows.map((row) => row.owner);
  let scanned = 0;
  let matched = 0;
  let hidden = 0;
  const perOwner = [];
  for (const owner of owners) {
    const rows = (
      await db.query(
        `SELECT m.id, m.content_ciphertext FROM chat.messages m
         JOIN chat.conversations c ON c.id=m.conversation_id
         WHERE c.owner_user_id=$1 AND m.content_type='system' AND m.created_at >= $2
         ORDER BY m.created_at`,
        [owner, SINCE],
      )
    ).rows;
    const ids = [];
    for (let offset = 0; offset < rows.length; offset += 200) {
      const batch = rows.slice(offset, offset + 200);
      const plains = await crypto.openMany(
        owner,
        batch.map((row) => ({ aad: `chat:message:${row.id}`, sealed: row.content_ciphertext })),
      );
      for (let i = 0; i < batch.length; i += 1) {
        let content = null;
        try {
          content = JSON.parse(plains[i].toString('utf8'));
        } catch {
          content = null;
        }
        plains[i].fill(0);
        if (
          content?.code === 'scenario_mode_changed' &&
          content.params?.mode === 'daily' &&
          content.params?.reason === 'scenario_mode_unavailable'
        )
          ids.push(batch[i].id);
      }
    }
    scanned += rows.length;
    matched += ids.length;
    if (!ids.length) continue;
    const inserted = await db.query(
      'INSERT INTO chat.hidden_messages(message_id,user_id) SELECT unnest($1::uuid[]), $2 ON CONFLICT DO NOTHING',
      [ids, owner],
    );
    hidden += inserted.rowCount ?? 0;
    perOwner.push({ owner, matched: ids.length });
  }
  const report = {
    ok: true,
    since: SINCE,
    owners: owners.length,
    scanned,
    matched,
    hidden,
    perOwner,
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  process.stdout.write(
    JSON.stringify({ ...report, perOwner: perOwner.length, firstOwners: perOwner.slice(0, 5) }) + '\n',
  );
}

main()
  .catch((error) => {
    process.stdout.write(
      JSON.stringify({ ok: false, code: String(error?.message ?? error).slice(0, 120) }) + '\n',
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
    for (const key of ring?.keys.values() ?? []) key.fill(0);
  });
