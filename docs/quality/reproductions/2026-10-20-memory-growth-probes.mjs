// Read-only business probes; run: node docs/quality/reproductions/2026-10-20-memory-growth-probes.mjs
// Writes only the adjacent QA evidence .txt. No database or provider calls.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const target = '65bb669821909ac62239c5b140410d569a078411';
const self = fileURLToPath(import.meta.url);
const root = resolve(dirname(self), '../../..');
const server = resolve(root, 'apps/server');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

if (!process.argv.includes('--verified-inner')) {
  // Compare worktree contents with target blobs, not HEAD: QA-only commits are allowed.
  const entries = git(
    'ls-tree',
    '-r',
    target,
    '--',
    'apps/server/src',
    'packages/contracts/src',
    'apps/server/tsconfig.json',
    'tsconfig.base.json',
  )
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^\d+ blob ([0-9a-f]+)\t(.+)$/);
      assert(m, line);
      return { blob: m[1], path: m[2] };
    });
  const hashes = execFileSync('git', ['hash-object', '--stdin-paths'], {
    cwd: root,
    encoding: 'utf8',
    input: entries.map((e) => e.path).join('\n') + '\n',
  })
    .trim()
    .split('\n');
  assert.equal(hashes.length, entries.length);
  for (let i = 0; i < entries.length; i++)
    assert.equal(hashes[i], entries[i].blob, `Source changed: ${entries[i].path}`);
  const child = spawnSync(process.execPath, ['--import', 'tsx', self, '--verified-inner'], {
    cwd: server,
    encoding: 'utf8',
    env: process.env,
  });
  const output =
    `Target SHA: ${target}\nNode: ${process.version}\nVerified target blobs: ${entries.length}\n` +
    (child.stdout ?? '') +
    (child.stderr ?? '') +
    `Child exit: ${child.status}\n`;
  writeFileSync(self.replace(/\.mjs$/, '.txt'), output, 'utf8');
  process.stdout.write(output);
  if (child.error) throw child.error;
  process.exit(child.status ?? 1);
}

const source = (path) => pathToFileURL(resolve(server, path)).href;
const { renderStableMemory } = await import(
  source('src/modules/ai-runtime/domain/memory-window.ts')
);
const { evaluateUserMessage } = await import(
  source('src/modules/growth/domain/familiarity-rules.ts')
);
const { GrowthEvents } = await import(source('src/modules/growth/application/growth-events.ts'));

const monthly = renderStableMemory({
  scope: 'normal',
  resident: [],
  windowStart: 100,
  segments: [],
  legacySummary: '',
  daily: [],
  monthly: [{ period: '2026-10', normal: 'OLD_2026_10_01', adult: '' }],
  summarySince: '2026-10-14',
});
assert(monthly.includes('OLD_2026_10_01'));
console.log('MG-01: reproduced; old monthly marker survives cutoff');
console.log(monthly);

let awardCalls = 0;
const growth = {
  awardUserMessage: async () => {
    awardCalls++;
  },
};
const ctx = {
  contacts: { listActiveContacts: async () => [{ conversationId: 'c', characterId: 'r' }] },
};
const chat = {
  getMessage: async () => ({
    createdAt: '2026-10-20T08:00:00Z',
    content: { type: 'voice', mediaId: 'm', transcript: null },
  }),
};
const handler = new GrowthEvents(
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  growth,
  undefined,
  undefined,
  ctx,
  undefined,
  chat,
  undefined,
);
await handler.onUserMessageForFamiliarity(
  {
    payload: {
      senderKind: 'user',
      senderRefId: 'u',
      contentType: 'voice',
      conversationType: 'direct',
      conversationId: 'c',
      messageId: 'msg',
      scope: 'normal',
    },
  },
  {},
);
assert.equal(awardCalls, 0);
console.log('MG-02: reproduced; standard user voice has awardCalls=' + awardCalls);

let hash = null,
  scoredAt = null;
const arrivals = [];
for (const [text, sec] of [
  ['今天好吗', 0],
  ['已经好了', 10],
  ['今天再说', 1],
]) {
  const sentAt = new Date(Date.UTC(2026, 9, 20, 0, 0, sec));
  const result = evaluateUserMessage({
    text,
    sentAt,
    lastMessageHash: hash,
    lastMessageScoredAt: scoredAt,
  });
  arrivals.push({ sec, valid: result.valid });
  hash = result.hash;
  if (result.valid) scoredAt = sentAt;
}
assert(arrivals.every((x) => x.valid));
console.log('MG-03: reproduced; ' + JSON.stringify(arrivals));
console.log('All three defect probes reproduced. These are not end-to-end acceptance tests.');
