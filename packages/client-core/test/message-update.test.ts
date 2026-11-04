import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Message, ProtocolVector } from '@weiban/contracts';
import { SyncEngine } from '../src/sync-engine.js';

const vector = ProtocolVector.parse(
  JSON.parse(
    readFileSync(
      new URL('../../contracts/test-vectors/recall-before-history.json', import.meta.url),
      'utf8',
    ),
  ),
);
const step = vector.steps[2]!.operation;
if (step.type !== 'update' || step.update.type !== 'message.created')
  throw new Error('fixture changed');
const source = step.update.data.message;
const choice = { actionId: 'add', chosenAt: '2026-11-04T00:00:00.000Z' };
const card = Message.parse({
  ...source,
  content: {
    type: 'action_card',
    cardKind: 'wishlist_proposal',
    text: '本机合成卡片',
    actions: [{ actionId: 'add', label: '好', style: 'primary' }],
    ref: null,
  },
  actionChoice: null,
});
const applyChoice = (engine: SyncEngine) =>
  engine.apply({
    type: 'update',
    update: {
      updateSeq: 1,
      occurredAt: choice.chosenAt,
      type: 'message.updated',
      data: { message: { ...card, actionChoice: choice } },
    },
  });

it('选择更新写入持久状态，重开及后到的旧历史页不会丢失', () => {
  const engine = new SyncEngine({ ...vector.initialState, messages: [card] });
  applyChoice(engine);
  const reopened = new SyncEngine(JSON.parse(JSON.stringify(engine.state)));
  expect(reopened.state.messages[0]?.actionChoice).toEqual(choice);
  expect(reopened.lastUpdateSeq).toBe(1);
  reopened.history(card.conversationId, card.seq + 1, {
    items: [card],
    hasMore: false,
    nextBeforeSeq: null,
  });
  expect(reopened.state.messages[0]?.actionChoice).toEqual(choice);
});

it('撤回和清空后的卡片不会因选择更新恢复正文或重新出现', () => {
  const recalled = new SyncEngine({
    ...vector.initialState,
    messages: [{ ...card, status: 'recalled', content: null, recalledAt: choice.chosenAt }],
  });
  applyChoice(recalled);
  expect(recalled.state.messages[0]?.content).toBeNull();
  const cleared = new SyncEngine({ ...vector.initialState, messages: [card] });
  cleared.clearHistory(card.conversationId, card.seq);
  applyChoice(cleared);
  expect(cleared.state.messages).toHaveLength(0);
  expect(cleared.lastUpdateSeq).toBe(1);
});
