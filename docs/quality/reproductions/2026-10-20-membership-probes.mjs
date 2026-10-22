// Read-only evidence probes: run from any directory with Node and installed repo TypeScript.
// No DB, network, env-file reads, application edits, or business test files.
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(import.meta.url);
const ts = require('typescript');
const BASE = '9b647d6228553cf8d1cec13557e310dc896179c5';
const EXPECTED = '65bb669821909ac62239c5b140410d569a078411';
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
assert.equal(git('rev-parse', EXPECTED), EXPECTED, 'Reviewed code SHA must be available');
const read = (file, baseline = false) => git('show', (baseline ? BASE : EXPECTED) + ':' + file);
function original(file, name, className, prefix = '', extra = {}, baseline = false) {
  const source = read(file, baseline);
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const node = className
    ? tree.statements
        .find((x) => ts.isClassDeclaration(x) && x.name.text === className)
        .members.find((x) => x.name?.getText(tree) === name)
    : tree.statements.find((x) => ts.isFunctionDeclaration(x) && x.name.text === name);
  assert(node, 'AST node must exist: ' + name);
  const body = node.getText(tree).replace(/^export\s+/, '');
  const code = className
    ? 'class Probe {' + body + '}; globalThis.value=Probe;'
    : body + ';globalThis.value=' + name + ';';
  const js = ts.transpileModule(prefix + '\n' + code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = { ...extra };
  vm.createContext(context);
  vm.runInContext(js, context);
  return context.value;
}
const resolver = 'apps/server/src/modules/model-access/application/resolver.ts';
async function background(baseline = false, userChat = 'user-expensive') {
  const Probe = original(resolver, 'pick', 'ModelResolver', '', {}, baseline),
    p = new Probe(),
    calls = [];
  p.selection = {
    raw: async () => ({ chat: userChat, background: null, adult: null }),
    rawOverride: async () => null,
  };
  p.catalog = {
    defaultModel: async (use) => {
      calls.push(use);
      return use === 'chat'
        ? { modelKey: 'platform-chat', entry: { modelKey: 'platform-chat' } }
        : null;
    },
    fact: async (key) => ({ modelKey: key }),
  };
  const result = await p.pick('user', 'background', null);
  assert.equal(result.facts.modelKey, 'platform-chat');
  assert.equal(calls.join(','), 'background,chat');
  return { baseline, userChat, defaultsRequested: calls, selected: result.facts.modelKey };
}
const catalog = 'apps/server/src/modules/model-access/application/catalog.ts';
class ProbeAppError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
async function vision(currentChat, baseline = false) {
  const Probe = original(
      catalog,
      'upsert',
      'CatalogService',
      '',
      { hasAdultContent: () => false, AppError: ProbeAppError },
      baseline,
    ),
    p = new Probe();
  p.validateBillingBounds = () => {};
  p.requirePrice = async () => {};
  p.defaultModel = async (use) => (use === 'chat' ? { modelKey: currentChat } : null);
  p.database = {
    transaction: async () => {
      throw new Error('REACHED_TRANSACTION_WITHOUT_VISION_GUARD');
    },
  };
  try {
    await p.upsert('admin', 'same-model', {
      modelKey: 'same-model',
      capabilities: ['text'],
      defaultFor: ['chat'],
      tags: [],
      enabled: true,
    });
    assert.fail('Expected sentinel');
  } catch (e) {
    return { baseline, currentChat, result: e.message };
  }
}
const b1 = await background();
const b0 = await background(true, null);
const vControl = await vision('other-model');
const vExperiment = await vision('same-model');
const vBaseline = await vision('same-model', true);
assert.match(vControl.result, /不能识图/);
assert.equal(vExperiment.result, 'REACHED_TRANSACTION_WITHOUT_VISION_GUARD');
assert.equal(vBaseline.result, 'REACHED_TRANSACTION_WITHOUT_VISION_GUARD');
const bonus = original('apps/server/src/modules/billing/application/ledger.ts', 'bonusDeltaOf');
let cases = 0;
for (const balance of [0, 50, 100, 200])
  for (const before of [0, 10, 50, 100].filter((x) => x <= balance))
    for (const amount of [-200, -50, -1, 0, 1, 50, 200])
      for (const credit of [true, false]) {
        const after = balance + amount,
          delta = bonus(before, after, amount, credit);
        assert(before + delta >= 0);
        assert(before + delta <= Math.max(0, after));
        if (amount < 0 && after >= 0) assert(delta === -Math.min(before, -amount));
        cases++;
      }
assert.equal(cases, 168);
const month = original(
  'apps/server/src/modules/identity/application/membership.ts',
  'addBeijingMonths',
  null,
  'const BEIJING_OFFSET_MS=8*3600000;',
);
const monthCases = [
  ['2026-01-31T12:30:00+08:00', 1, '2026-02-28T04:30:00.000Z'],
  ['2028-01-31T12:30:00+08:00', 1, '2028-02-29T04:30:00.000Z'],
  ['2026-12-31T23:59:00+08:00', 3, '2027-03-31T15:59:00.000Z'],
];
for (const [at, n, want] of monthCases) assert.equal(month(new Date(at), n).toISOString(), want);
console.log(
  JSON.stringify(
    {
      reviewedSha: EXPECTED,
      comparisonBase: BASE,
      node: process.version,
      scope: 'original AST method/function bodies with memory stubs; no database',
      MEM001: b1,
      MEM001_baseline: b0,
      MEM002_control: vControl,
      MEM002_experiment: vExperiment,
      MEM002_baseline: vBaseline,
      bonusInvariantCases: cases,
      beijingMonthBoundaryCases: monthCases.length,
      result: 'all assertions passed',
    },
    null,
    2,
  ),
);
