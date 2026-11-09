#!/usr/bin/env node
/** Operator-only preparation. No HTTP provisioning, app bootstrap, model calls or account edits. */
import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Database } from '../../apps/server/src/platform/db/database.ts';
import { loadConfig } from '../../apps/server/src/platform/config/config.ts';
import { loadKekRing } from '../../apps/server/src/platform/crypto/kek-ring.ts';
import {
  EnvelopeCrypto,
  PLATFORM_KEY_OWNER,
} from '../../apps/server/src/platform/crypto/envelope.ts';
import { SystemClock } from '../../apps/server/src/platform/clock/clock.ts';
import { legacyAuthAad } from '../../apps/server/src/modules/channels/domain/legacy-relay-protocol.ts';
import {
  isLegacyMigrationOwnerPreserved,
  assertLegacyMigrationOwnerAllowed,
} from '../../scripts/ops/fast-cutover-owners.mjs';
import {
  allowedRelayExclusions,
  relayScopeExclusion,
  assertRelayChannel,
  assertRelayScope,
} from './relay-scope.mjs';

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invariant = (condition, code) => {
  if (!condition) throw new Error(code);
};
const safeWrite = (filename, data) => fs.writeFileSync(filename, data, { flag: 'wx', mode: 0o600 });
const recipientAad = (id) => `channels:legacy-transfer:${id}:private`;
const requireTmpfsRecipient = (prefix) =>
  invariant(
    typeof prefix === 'string' &&
      process.platform === 'linux' &&
      fs.statfsSync(path.dirname(prefix)).type === 0x01021994,
    'RELAY_RECIPIENT_REQUIRES_TMPFS',
  );

export function decryptExport(envelope, privateKey) {
  invariant(envelope.version === 1, 'RELAY_EXPORT_VERSION');
  const key = crypto.privateDecrypt(
    { key: privateKey, oaepHash: 'sha256', padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
    Buffer.from(envelope.wrappedKey, 'base64'),
  );
  let plaintext;
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(envelope.iv, 'base64'),
    );
    decipher.setAAD(Buffer.from('weiban-legacy-channel-export-v1'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.body, 'base64')),
      decipher.final(),
    ]);
    const decoded = JSON.parse(plaintext.toString('utf8'));
    invariant(
      decoded.version === 1 && Array.isArray(decoded.bindings) && decoded.bindings.length <= 1000,
      'RELAY_EXPORT_INVALID',
    );
    return decoded;
  } finally {
    key.fill(0);
    plaintext?.fill(0);
  }
}

async function main(args) {
  const mode = args[0],
    options = new Map();
  for (let i = 1; i < args.length; i += 2) options.set(args[i], args[i + 1]);
  invariant(
    ['recipient', 'plan', 'apply', 'enable', 'disable'].includes(mode),
    'RELAY_MODE_INVALID',
  );
  const config = loadConfig(),
    clock = new SystemClock(),
    ring = loadKekRing(config);
  const db = new Database({ url: config.database.url, poolMax: 2 });
  const envelopeCrypto = new EnvelopeCrypto(db, clock, ring);
  try {
    if (mode === 'recipient') {
      const prefix = options.get('--recipient-prefix');
      invariant(prefix, 'RELAY_RECIPIENT_PREFIX_REQUIRED');
      requireTmpfsRecipient(prefix);
      const id = crypto.randomUUID();
      const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
      const privatePem = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }));
      try {
        const sealed = await envelopeCrypto.seal(PLATFORM_KEY_OWNER, recipientAad(id), privatePem);
        safeWrite(`${prefix}.private.sealed`, sealed);
      } finally {
        privatePem.fill(0);
      }
      const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
      const publicSha256 = hash(publicKey.export({ type: 'spki', format: 'der' }));
      safeWrite(`${prefix}.public.pem`, publicPem);
      safeWrite(`${prefix}.json`, JSON.stringify({ version: 1, id, publicSha256 }));
      return { recipientCreated: true, publicSha256 };
    }

    const planPath = options.get('--plan');
    if (mode === 'enable' || mode === 'disable') {
      const bytes = fs.readFileSync(planPath),
        plan = JSON.parse(bytes.toString('utf8'));
      invariant(hash(bytes) === options.get('--plan-sha256'), 'RELAY_PLAN_DIGEST_MISMATCH');
      const changed = await db.transaction(async (tx) => {
        let count = 0;
        for (const row of plan.bindings) {
          assertLegacyMigrationOwnerAllowed(row.userId);
          if (mode === 'enable') {
            await assertRelayScope(tx, row);
            const native = await tx.query(
              "SELECT 1 FROM channels.bindings WHERE user_id=$1 AND channel=$2 AND status='active'",
              [row.userId, row.channel],
            );
            invariant(!native.rowCount, 'RELAY_NATIVE_BINDING_CONFLICT');
          }
          const result = await tx.query(
            `UPDATE channels.legacy_bindings SET enabled=$2,updated_at=$3
            WHERE id=$1 AND generation=$4 AND user_id=$5 AND character_id=$6 AND conversation_id=$7 AND peer_hash=$8 AND persona_hash=$9
              AND ($2=false OR NOT user_disabled)`,
            [
              row.id,
              mode === 'enable',
              clock.now(),
              row.generation,
              row.userId,
              row.characterId,
              row.conversationId,
              row.peerHash,
              row.personaHash,
            ],
          );
          invariant(result.rowCount === 1, 'RELAY_PLAN_STATE_CHANGED');
          count++;
        }
        return count;
      });
      return { enabled: mode === 'enable', bindings: changed };
    }

    let privatePem;
    if (options.get('--private-key-stdin') === 'yes') {
      privatePem = fs.readFileSync(0);
      invariant(
        privatePem.length > 0 && privatePem.length <= 32768,
        'RELAY_PRIVATE_KEY_STDIN_INVALID',
      );
    } else {
      const prefix = options.get('--recipient-prefix');
      requireTmpfsRecipient(prefix);
      const recipient = JSON.parse(fs.readFileSync(`${prefix}.json`, 'utf8'));
      privatePem = await envelopeCrypto.open(
        PLATFORM_KEY_OWNER,
        recipientAad(recipient.id),
        fs.readFileSync(`${prefix}.private.sealed`),
      );
    }
    let source;
    try {
      source = decryptExport(
        JSON.parse(fs.readFileSync(options.get('--encrypted-source'), 'utf8')),
        privatePem,
      );
    } finally {
      privatePem.fill(0);
    }
    const metadata = source.bindings.map(({ authKey: _auth, ...row }) => row);
    const sourceDigest = hash(JSON.stringify(metadata));
    for (const row of source.bindings)
      invariant(
        uuid.test(row.id) &&
          uuid.test(row.userId) &&
          ['wechat', 'weibo', 'qq'].includes(row.channel) &&
          Number.isInteger(row.generation) &&
          row.generation > 0 &&
          Buffer.from(row.authKey, 'base64').length === 32 &&
          hash(row.personaName) === row.personaHash,
        'RELAY_SOURCE_INVALID',
      );

    if (mode === 'plan') {
      const cutoff = new Date(options.get('--cutover-at'));
      invariant(Number.isFinite(cutoff.getTime()), 'RELAY_CUTOVER_REQUIRED');
      const roles = (
        await db.query(`SELECT id,legacy_card->>'id' AS legacy_id
        FROM characters.characters WHERE kind='preset' AND status='published'`)
      ).rows;
      const legacyIds = new Map();
      for (const role of roles) {
        if (!role.legacy_id) continue;
        const ids = legacyIds.get(String(role.legacy_id)) || new Set();
        ids.add(role.id);
        legacyIds.set(String(role.legacy_id), ids);
      }
      const bindings = [],
        excluded = [];
      for (const old of metadata) {
        const reject = (reason) => excluded.push({ id: old.id, channel: old.channel, reason });
        if (old.channel === 'weibo') {
          reject('manager_skip_weibo');
          continue;
        }
        if (isLegacyMigrationOwnerPreserved(old.userId)) {
          reject('preserved_existing_account');
          continue;
        }
        if (old.channel === 'wechat') {
          const membership = await db.query(
            'SELECT pro_plus_until FROM identity.memberships WHERE user_id=$1',
            [old.userId],
          );
          const reason = relayScopeExclusion(
            { ...old, cutoverAt: cutoff.toISOString() },
            membership.rows[0]?.pro_plus_until,
          );
          if (reason) {
            reject(reason);
            continue;
          }
        }
        if (old.sourceUserActive !== true) {
          reject('legacy_user_inactive');
          continue;
        }
        if (!old.peerHash) {
          reject('unconfirmed_peer');
          continue;
        }
        const candidates = [...(legacyIds.get(String(old.sourceCharacterId || '')) || [])];
        if (candidates.length !== 1) {
          reject('preset_character_unmapped');
          continue;
        }
        const characterId = candidates[0];
        const target = (
          await db.query(
            `SELECT c.id,c.last_seq FROM chat.conversations c
          JOIN identity.users u ON u.id=c.owner_user_id AND u.status='active'
          JOIN contacts.contacts f ON f.user_id=u.id AND f.character_id=c.character_id AND f.status='active' AND f.conversation_id=c.id
          WHERE c.owner_user_id=$1 AND c.character_id=$2 AND c.type='direct' AND c.archived_at IS NULL AND c.content_scope='normal'`,
            [old.userId, characterId],
          )
        ).rows;
        if (target.length !== 1) {
          reject('existing_direct_dependency_missing');
          continue;
        }
        const native = await db.query(
          "SELECT 1 FROM channels.bindings WHERE user_id=$1 AND channel=$2 AND status='active'",
          [old.userId, old.channel],
        );
        if (native.rowCount) {
          reject('native_binding_conflict');
          continue;
        }
        const { personaName: _name, ...safe } = old;
        bindings.push({
          ...safe,
          characterId,
          conversationId: target[0].id,
          afterSeq: Number(target[0].last_seq),
          cutoverAt: cutoff.toISOString(),
        });
      }
      const sourceSkipped = {
        weibo: source.excludedWeibo ?? 0,
        preserved: source.excludedProtected ?? 0,
      };
      const plan = { version: 1, sourceDigest, bindings, excluded, sourceSkipped };
      const bytes = Buffer.from(JSON.stringify(plan, null, 2));
      safeWrite(planPath, bytes);
      return {
        planned: bindings.length,
        sourceSkipped,
        excluded: excluded.length,
        reasons: Object.fromEntries(
          [...new Set(excluded.map((r) => r.reason))].map((reason) => [
            reason,
            excluded.filter((r) => r.reason === reason).length,
          ]),
        ),
        planSha256: hash(bytes),
      };
    }

    const planBytes = fs.readFileSync(planPath),
      plan = JSON.parse(planBytes.toString('utf8'));
    invariant(
      hash(planBytes) === options.get('--plan-sha256') && plan.sourceDigest === sourceDigest,
      'RELAY_PLAN_DIGEST_MISMATCH',
    );
    invariant(
      !plan.excluded.length ||
        (options.get('--allow-exclusions') === 'yes' &&
          plan.excluded.every((row) => allowedRelayExclusions.has(row.reason))),
      'RELAY_EXCLUSIONS_REQUIRE_REVIEW',
    );
    for (const row of plan.bindings) assertRelayChannel(row);
    const oldMap = {
      version: 1,
      bindings: plan.bindings.map(
        ({ characterId: _c, conversationId: _v, afterSeq: _s, ...row }) => row,
      ),
    };
    const oldMapText = JSON.stringify(oldMap, null, 2),
      oldMapOutput = options.get('--old-map-output');
    invariant(
      typeof oldMapOutput === 'string' && oldMapOutput.length > 0,
      'RELAY_OLD_MAP_OUTPUT_REQUIRED',
    );
    if (fs.existsSync(oldMapOutput))
      invariant(
        fs.readFileSync(oldMapOutput, 'utf8') === oldMapText,
        'RELAY_OLD_MAP_EXISTS_DIFFERENT',
      );
    else safeWrite(oldMapOutput, oldMapText);
    const selected = new Map(source.bindings.map((row) => [row.id, row]));
    const inserted = await db.transaction(async (tx) => {
      let count = 0;
      for (const row of plan.bindings) {
        await assertRelayScope(tx, row);
        const old = selected.get(row.id);
        assertLegacyMigrationOwnerAllowed(old?.userId);
        invariant(
          old &&
            old.userId === row.userId &&
            old.channel === row.channel &&
            old.generation === row.generation &&
            old.legacyBindingId === row.legacyBindingId &&
            old.peerHash === row.peerHash &&
            old.personaHash === row.personaHash,
          'RELAY_APPROVAL_SOURCE_MISMATCH',
        );
        const verified = await tx.query(
          `SELECT 1 FROM chat.conversations c
          JOIN identity.users u ON u.id=c.owner_user_id AND u.status='active'
          JOIN characters.characters r ON r.id=c.character_id AND r.kind='preset' AND r.status='published'
          JOIN contacts.contacts f ON f.user_id=u.id AND f.character_id=r.id AND f.status='active' AND f.conversation_id=c.id
          WHERE c.id=$1 AND c.owner_user_id=$2 AND c.character_id=$3 AND c.type='direct' AND c.archived_at IS NULL AND c.content_scope='normal' AND c.last_seq=$4
            AND r.legacy_card->>'id'=$5 FOR SHARE OF c,u,r,f`,
          [row.conversationId, row.userId, row.characterId, row.afterSeq, old.sourceCharacterId],
        );
        invariant(verified.rowCount === 1, 'RELAY_TARGET_CHANGED_REPLAN');
        const native = await tx.query(
          "SELECT 1 FROM channels.bindings WHERE user_id=$1 AND channel=$2 AND status='active'",
          [row.userId, row.channel],
        );
        invariant(!native.rowCount, 'RELAY_NATIVE_BINDING_CONFLICT');
        const key = Buffer.from(old.authKey, 'base64');
        let sealed;
        try {
          sealed = await envelopeCrypto.seal(row.userId, legacyAuthAad(row.id), key, tx);
        } finally {
          key.fill(0);
        }
        const result = await tx.query(
          `INSERT INTO channels.legacy_bindings
          (id,channel,legacy_binding_id,generation,user_id,character_id,conversation_id,peer_hash,persona_hash,auth_key_sealed,enabled,after_seq,offered_seq,cutover_at,created_at,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false,$11,$11,$12,$13,$13) ON CONFLICT DO NOTHING`,
          [
            row.id,
            row.channel,
            row.legacyBindingId,
            row.generation,
            row.userId,
            row.characterId,
            row.conversationId,
            row.peerHash,
            row.personaHash,
            sealed,
            row.afterSeq,
            row.cutoverAt,
            clock.now(),
          ],
        );
        invariant(result.rowCount === 1, 'RELAY_MAPPING_EXISTS_NO_OVERWRITE');
        count++;
      }
      return count;
    });
    return {
      imported: inserted,
      enabled: false,
      oldMapSha256: hash(oldMapText),
    };
  } finally {
    await db.close();
    for (const key of ring?.keys.values() || []) key.fill(0);
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url).replaceAll('\\', '/') === process.argv[1].replaceAll('\\', '/')
) {
  main(process.argv.slice(2))
    .then((result) => process.stdout.write(JSON.stringify(result) + '\n'))
    .catch((error) => {
      const code = /^RELAY_[A-Z_]+$/.test(String(error?.message)) ? error.message : 'UNEXPECTED';
      process.stderr.write(`LEGACY_RELAY_PREPARATION_FAILED ${code}\n`);
      process.exitCode = 1;
    });
}

export { main };
