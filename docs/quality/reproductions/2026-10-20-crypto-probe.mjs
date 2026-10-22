// Read-only probe of the immutable reviewed crypto module. Run from repository root.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import ts from 'typescript';

const sha = '65bb669821909ac62239c5b140410d569a078411';
const source = execFileSync('git', ['show', `${sha}:apps/server/src/platform/crypto/envelope.ts`], {
  encoding: 'utf8',
});
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { EnvelopeCrypto, aesGcmSeal } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);
const kek = randomBytes(32);
const dek = randomBytes(32);
const owner = '00000000-0000-4000-8000-000000000001';
const wrapped = aesGcmSeal(kek, `weiban:dek:${owner}:v1`, dek);
let queries = 0;
let deleted = false;
const db = {
  async query(_sql, params) {
    queries++;
    return {
      rows: deleted || params[0] !== owner ? [] : [{ wrapped_dek: wrapped, kek_version: 1 }],
    };
  },
};
const crypto = new EnvelopeCrypto(db, {}, { currentVersion: 1, keys: new Map([[1, kek]]) });
const records = ['one', 'two'].map((value, index) => ({
  aad: `row:${index}`,
  sealed: aesGcmSeal(dek, `weiban:data:${owner}:row:${index}`, Buffer.from(value)),
}));
const opened = await crypto.openMany(owner, records);
assert.deepEqual(
  opened.map((value) => value.toString()),
  ['one', 'two'],
);
assert.equal(queries, 1);
opened.forEach((value) => value.fill(0));
assert.deepEqual(await crypto.openMany(owner, []), []);
assert.equal(queries, 1);
await assert.rejects(crypto.openMany(owner, [{ ...records[0], aad: 'wrong-row' }]));
await assert.rejects(crypto.openMany('00000000-0000-4000-8000-000000000002', records));
deleted = true;
await assert.rejects(crypto.openMany(owner, records));
dek.fill(0);
kek.fill(0);
console.log(
  JSON.stringify({
    sha,
    checks: [
      'batch-order-and-content',
      'one-key-read-per-batch',
      'empty-batch-no-read',
      'wrong-aad-rejected',
      'other-owner-rejected',
      'deleted-key-rejected',
    ],
    passed: 6,
    database: 'in-memory read-only stub; no PostgreSQL',
  }),
);
