// 文档产物静态完整性核对。只编译HTML脚本，不执行DOM/网络，不是产品测试套件。
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { deepStrictEqual, strictEqual, ok } from 'node:assert';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)),
  root = resolve(here, '../../..');
const json = (name) => JSON.parse(readFileSync(resolve(here, name), 'utf8'));
const { metadata, rows } = json('ledger.json'),
  mapping = json('evidence-map.json'),
  summary = json('summary.json');
const original = JSON.parse(
  readFileSync(resolve(root, 'docs/refactor/08-master-map.json'), 'utf8'),
);
strictEqual(rows.length, 401);
strictEqual(new Set(rows.map((r) => r.id)).size, 401);
deepStrictEqual(
  rows.map((r) => r.sourceRow),
  original,
);
strictEqual(mapping.items.length, 185);
deepStrictEqual(
  mapping.items.map((r) => r.id),
  rows.filter((r) => r.needsAction).map((r) => r.id),
);
for (const r of rows) {
  ok(
    [
      '未核',
      '源码已核待点按',
      '历史截图待复点',
      '后端冻结',
      '产品待定',
    ].includes(r.evidence.status),
  );
  if (r.evidence.status === '源码已核待点按')
    ok(r.evidence.refs.some((p) => p.kind === '本轮源码阅读'));
  if (r.evidence.status === '历史截图待复点')
    ok(r.evidence.refs.some((p) => p.kind === '历史开发交接'));
  strictEqual(r.annotation.parentInheritanceApplied, false);
  if (r.annotation.missingDirect) {
    strictEqual(r.annotation.directVerdict, '未批注');
    strictEqual(r.annotation.sourceType, '导出总说明继承');
    strictEqual(r.annotation.source.line, 3);
  }
  for (const ref of r.evidence.refs) {
    const source = readFileSync(resolve(root, ref.path), 'utf8');
    ok(source.includes(ref.quote));
    strictEqual(
      source.slice(0, source.indexOf(ref.quote)).split(/\r?\n/).length,
      ref.line,
    );
  }
}
strictEqual(rows.filter((r) => r.annotation.missingDirect).length, 186);
deepStrictEqual(
  rows.filter((r) => r.annotation.verdict === '未标').map((r) => r.id),
  ['T1.12.1', 'T1.16.5', 'T2.3', 'T4.2.7', 'T4.10.1'],
);
for (const source of metadata.sources)
  strictEqual(
    createHash('sha256')
      .update(readFileSync(resolve(root, source.path), 'utf8'))
      .digest('hex'),
    source.sha256,
  );
const html = readFileSync(resolve(here, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
strictEqual(scripts.length, 1);
new Script(scripts[0][1], { filename: 'ui-ledger-inline.js' });
const embedded = scripts[0][1].match(/const DATA=(.*);\nconst escapeHtml=/);
ok(embedded);
deepStrictEqual(JSON.parse(embedded[1]), rows);
const escaped = [...embedded[1].matchAll(/(\\+)u003c/g)];
ok(escaped.length > 0);
for (const m of escaped) strictEqual(m[1].length, 1);
ok(!embedded[1].includes('<'));
for (const id of [
  'tab',
  'original',
  'verdict',
  'origin',
  'state',
  'action',
  'q',
])
  ok(html.includes(`id="${id}"`));
strictEqual(summary.needsAction, 185);
strictEqual(summary.noBrowserAcceptance, true);
console.log(
  JSON.stringify(
    {
      originalRows: 401,
      sourceFieldsPreserved: true,
      actionMappings: 185,
      explicitAnnotations: 215,
      exportInherited: 186,
      explicitUnmarked: 5,
      evidenceReferencesValid: true,
      htmlScriptsCompiled: 1,
      inlineJsonRoundtrip: true,
      unicodeEscapeBackslashes: 1,
      domExecuted: false,
      browserVerified: false,
    },
    null,
    2,
  ),
);
