import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { MomentsActor, MomentsComment } from '@weiban/contracts';
import '../../../../docs/design/tokens.css';
import '../../src/app/styles.css';
import '../../src/app/shell.css';
import '../../src/app/old-ui.css';
import '../../src/app/pages-old.css';
import { MomentActorName, MomentCommentRow } from '../../src/features/moments.js';
import { ModelPriceLine } from '../../src/features/models.js';
import { isUserPriceModel } from '../../src/features/model-prices.js';
const A = '33333333-3333-4333-8333-333333333333',
  B = '44444444-4444-4444-8444-444444444444';
const actors = {
  register: () => {},
  profile: undefined,
  name: (actor: MomentsActor) => (actor.refId === A ? '角色甲' : '角色乙'),
};
const comment: MomentsComment = {
  commentId: '55555555-5555-4555-8555-555555555555',
  author: { kind: 'character', refId: A },
  replyTo: { kind: 'character', refId: B },
  replyToCommentId: null,
  mentionsUser: false,
  text: '这是一条可以回复的评论',
  createdAt: '2026-10-26T00:00:00.000Z',
};
function Fixture() {
  const location = useLocation(),
    [replies, setReplies] = useState(0);
  return (
    <main>
      <output data-testid="route">{location.pathname}</output>
      <output data-testid="replies">{replies}</output>
      <div data-testid="likes">
        <MomentActorName actor={comment.author} actors={actors} />
      </div>
      <MomentCommentRow
        comment={comment}
        actors={actors}
        pending={false}
        onReply={() => setReplies((x) => x + 1)}
        onDelete={() => {}}
      />
      <div data-testid="minute">
        <ModelPriceLine
          scenario="voice_call"
          model={{
            pointsPerMinute: 3.25,
            pointsPerReply: 99,
            pointsPerUse: { voice_call: 99 },
            displayMultiplier: 2,
            discount: null,
          }}
        />
      </div>
      <div data-testid="old-server">
        <ModelPriceLine
          scenario="voice_call"
          model={{ pointsPerReply: 99, pointsPerUse: { voice_call: 99 } }}
        />
      </div>
      <div data-testid="public-prices">
        {[
          { name: 'Jev', scenarios: [] },
          { name: '联网搜索', scenarios: [] },
          { name: '正常聊天模型', scenarios: ['chat' as const] },
          { name: '通话模型', scenarios: ['voice_call' as const] },
        ]
          .filter(isUserPriceModel)
          .map((x) => (
            <p key={x.name}>{x.name}</p>
          ))}
      </div>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <MemoryRouter>
    <Fixture />
  </MemoryRouter>,
);
