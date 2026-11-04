import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { evaluateUserMessage } from '../../../../apps/server/src/modules/growth/domain/familiarity-rules.js';
import { GrowthEvents } from '../../../../apps/server/src/modules/growth/application/growth-events.js';
import { SyncEngine } from '../../../../packages/client-core/src/sync-engine.js';
import { renderStableMemory } from '../../../../apps/server/src/modules/ai-runtime/domain/memory-window.js';

it('Q-018：观察现有语音事件没有转写时不计分；是否缺后续接入须结合源码判断', async () => {
  let awards = 0;
  const handler = Object.create(GrowthEvents.prototype);
  Object.assign(handler, {
    ctx: {
      contacts: { listActiveContacts: async () => [{ conversationId: 'c', characterId: 'r' }] },
    },
    growth: {
      lockFamiliarity: async () => {},
      awardUserMessage: async () => {
        awards++;
      },
    },
    chat: {
      getMessage: async () => ({
        createdAt: '2026-11-04T08:00:00Z',
        content: { type: 'voice', mediaId: 'm', transcript: null },
      }),
    },
  });
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
  console.log(JSON.stringify({ probe: 'voice-growth', awardCalls: awards }));
  // 此观察通过不代表语音熟悉度已验收。检查 media 转写落库及订阅者可确定是否存在补计路径。
  expect(awards).toBe(0);
});

it('Q-017：旧月摘要回退路径不得带入免费七天以外的事实', () => {
  const text = renderStableMemory({
    scope: 'normal',
    resident: [],
    windowStart: 100,
    segments: [],
    legacySummary: '',
    daily: [],
    monthly: [{ period: '2026-10', normal: 'QA_OLD_OCT01', adult: '' }],
    summarySince: '2026-10-14',
  });
  const oldFactIncluded = text.includes('QA_OLD_OCT01');
  console.log(JSON.stringify({ probe: 'legacy-month-cutoff', oldFactIncluded }));
  expect(oldFactIncluded).toBe(false);
});

it('Q-019：乱序消息不得突破三秒计分间隔', () => {
  let lastMessageHash: string | null = null,
    lastMessageScoredAt: Date | null = null;
  const results: boolean[] = [];
  for (const [text, second] of [
    ['今天好吗', 0],
    ['已经好了', 10],
    ['今天再说', 1],
  ] as const) {
    const sentAt = new Date(Date.UTC(2026, 10, 4, 0, 0, second));
    const result = evaluateUserMessage({ text, sentAt, lastMessageHash, lastMessageScoredAt });
    results.push(result.valid);
    lastMessageHash = result.hash;
    if (result.valid) lastMessageScoredAt = sentAt;
  }
  console.log(JSON.stringify({ probe: 'out-of-order-growth', valid: results }));
  expect(results).toEqual([true, true, false]);
});

it('Q-020：消息卡片的选择结果应随同步状态持久化', () => {
  const vector = JSON.parse(
    readFileSync(
      new URL(
        '../../../../packages/contracts/test-vectors/recall-before-history.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const source = vector.steps[2].operation.update.data.message;
  const card = {
    ...source,
    content: {
      type: 'action_card',
      cardKind: 'wishlist_proposal',
      text: '合成卡片',
      actions: [{ actionId: 'add', label: '好', style: 'primary' }],
      ref: null,
    },
    actionChoice: null,
  };
  const engine = new SyncEngine({ ...vector.initialState, messages: [card] });
  const choice = { actionId: 'add', chosenAt: '2026-11-04T00:00:00.000Z' };
  engine.apply({
    type: 'update',
    update: {
      updateSeq: 1,
      occurredAt: choice.chosenAt,
      type: 'message.updated',
      data: { message: { ...card, actionChoice: choice } },
    },
  });
  const reopened = new SyncEngine(JSON.parse(JSON.stringify(engine.state)));
  console.log(
    JSON.stringify({
      probe: 'persisted-message-update',
      cursor: reopened.state.lastUpdateSeq,
      choiceSaved: reopened.state.messages[0]?.actionChoice != null,
    }),
  );
  expect(reopened.state.messages[0]?.actionChoice).toEqual(choice);
});
