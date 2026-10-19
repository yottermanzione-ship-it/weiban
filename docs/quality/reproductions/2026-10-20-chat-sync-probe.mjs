// Read-only probe. Run from repository root:
// pnpm --filter @weiban/contracts exec tsx ../../docs/quality/reproductions/2026-10-20-chat-sync-probe.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SyncEngine } from '../../../packages/client-core/src/sync-engine.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const target = '65bb669821909ac62239c5b140410d569a078411';
const sources = [
  'packages/client-core/src/sync-engine.ts',
  'packages/client-core/src/sync-state.ts',
  'packages/contracts/src/http/chat.ts',
  'packages/contracts/src/http/sync.ts',
  'packages/contracts/src/client-sync.ts',
  'packages/contracts/test-vectors/recall-before-history.json',
];
for (const path of sources) {
  const expected = execFileSync('git', ['rev-parse', `${target}:${path}`], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  const actual = execFileSync('git', ['hash-object', '--', path], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  if (actual !== expected) throw new Error(`Source differs from reviewed SHA: ${path}`);
}

const vector = JSON.parse(
  readFileSync(
    new URL('../../../packages/contracts/test-vectors/recall-before-history.json', import.meta.url),
    'utf8',
  ),
);
const source = vector.steps[2].operation.update.data.message;
const card = {
  ...source,
  content: {
    type: 'action_card',
    cardKind: 'wishlist_proposal',
    text: '一起去看海',
    actions: [{ actionId: 'add', label: '好', style: 'primary' }],
    ref: null,
  },
  actionChoice: null,
};
const engine = new SyncEngine({ ...vector.initialState, messages: [card] });
engine.apply({
  type: 'update',
  update: {
    updateSeq: 1,
    occurredAt: '2026-10-20T00:00:00.000Z',
    type: 'message.updated',
    data: {
      message: {
        ...card,
        actionChoice: { actionId: 'add', chosenAt: '2026-10-20T00:00:00.000Z' },
      },
    },
  },
});
const reopened = new SyncEngine(JSON.parse(JSON.stringify(engine.state)));
console.log(
  JSON.stringify({
    lastUpdateSeq: reopened.state.lastUpdateSeq,
    actionChoice: reopened.state.messages[0].actionChoice,
    messageType: reopened.state.messages[0].content.type,
  }),
);
