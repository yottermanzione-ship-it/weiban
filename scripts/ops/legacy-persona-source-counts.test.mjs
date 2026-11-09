import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const sql = readFileSync(new URL('./legacy-persona-source-counts.sql', import.meta.url), 'utf8');
const query = sql.slice(sql.indexOf('WITH customized'), sql.lastIndexOf('ROLLBACK;')).trim();
const expectedKeys = [
  'customized',
  'reset',
  'missing_signature',
  'missing_exact_base',
  'ambiguous_exact_base',
  'exact_base',
  'invalid_patch_json',
  'non_object_patch',
  'patch_above_byte_limit',
  'invalid_base_json',
  'non_object_base',
  'base_missing_stable_id',
];
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE persona_customizations(persona_name text,state text,base_signature text,base_revision text,patch_json text);
    CREATE TABLE persona_base_versions(persona_name text,signature text,revision text,package_json text);`);
  return db;
}
function audit(db) {
  db.exec('PRAGMA query_only=ON; BEGIN');
  try {
    const value = JSON.parse(Object.values(db.prepare(query).get())[0]);
    assert.deepEqual(Object.keys(value), expectedKeys);
    assert.ok(Object.values(value).every((v) => Number.isSafeInteger(v) && v >= 0));
    assert.throws(() => db.exec('DELETE FROM persona_customizations'), /readonly/i);
    return value;
  } finally {
    db.exec('ROLLBACK');
  }
}
test('empty source emits fixed counts only and stays read-only', () => {
  const db = fixture();
  try {
    assert.deepEqual(
      Object.values(audit(db)),
      expectedKeys.map(() => 0),
    );
  } finally {
    db.close();
  }
});
test('exact immutable base, revision mismatch, duplicate and malformed payloads are separate counts', () => {
  const db = fixture();
  try {
    const insert = db.prepare('INSERT INTO persona_customizations VALUES(?,?,?,?,?)');
    const base = db.prepare('INSERT INTO persona_base_versions VALUES(?,?,?,?)');
    const rows = [
      [
        'valid',
        'customized',
        's1',
        'r1',
        '{"raw_persona":{"soulspec":{"personality":"synthetic private canary"}}}',
      ],
      ['revision', 'customized', 's2', 'r2', '{}'],
      ['duplicate', 'customized', 's3', 'r3', '{}'],
      ['missing', 'customized', '', '', '{'],
      ['badbase', 'customized', 's4', 'r4', '[]'],
      ['noid', 'customized', 's5', 'r5', '{}'],
      ['scalarbase', 'customized', 's6', 'r6', JSON.stringify({ value: 'x'.repeat(524288) })],
      ['reset', 'reset', '', '', '{}'],
    ];
    for (const row of rows) insert.run(...row);
    base.run('valid', 's1', 'r1', '{"id":"synthetic-role","name":"synthetic private canary"}');
    base.run('revision', 's2', 'other', '{"id":"synthetic-role"}');
    base.run('duplicate', 's3', 'r3', '{}');
    base.run('duplicate', 's3', 'r3', '{}');
    base.run('badbase', 's4', 'r4', '{');
    base.run('noid', 's5', 'r5', '{}');
    base.run('scalarbase', 's6', 'r6', '[]');
    const result = audit(db);
    assert.deepEqual(Object.values(result), [7, 1, 1, 2, 1, 4, 1, 1, 1, 1, 1, 2]);
    assert.equal(JSON.stringify(result).includes('canary'), false);
    assert.equal(db.prepare('SELECT count(*) n FROM persona_customizations').get().n, 8);
  } finally {
    db.close();
  }
});
