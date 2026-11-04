import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ContactsCommands } from '../../../../apps/server/src/modules/contacts/application/commands.js';
import { MembershipService } from '../../../../apps/server/src/modules/identity/application/membership.js';
import { MomentsService } from '../../../../apps/server/src/modules/moments/application/moments.js';
import { makeQaApp } from './qa-app.js';
let qa: Awaited<ReturnType<typeof makeQaApp>>,
  owner: Awaited<ReturnType<typeof qa.user>>,
  other: typeof owner;
const ids: string[] = [];
let groupId: string, postId: string;
beforeAll(async () => {
  qa = await makeQaApp();
  owner = await qa.user('qa_social_owner');
  other = await qa.user('qa_social_other');
  for (let i = 0; i < 3; i++) {
    const created = await qa.http(owner.token, '/characters/custom', 'POST', {
      name: `合成群友${i}`,
      description:
        '这是一位完全虚构的成年角色，喜欢阅读和观察日常，语气自然简洁，尊重他人边界，愿意认真倾听。所有资料均为本地验收合成内容，不代表任何真实人物。',
      classification: {
        basis: 'original',
        realPersonKind: null,
        ageSetting: 'adult',
        childAppearance: false,
      },
    });
    expect(created.status).toBe(200);
    const id = created.data.characterId;
    ids.push(id);
    await qa.app.get(ContactsCommands).add(owner.id, { characterId: id });
    const rows = await qa.db.query<{ request_id: string; accept_after: Date }>(
      'SELECT request_id,accept_after FROM contacts.contacts WHERE user_id=$1 AND character_id=$2',
      [owner.id, id],
    );
    qa.clock.advance(Math.max(0, rows.rows[0]!.accept_after.getTime() - qa.clock.nowMs()));
    await qa.app
      .get(ContactsCommands)
      .accept({ userId: owner.id, characterId: id, requestId: rows.rows[0]!.request_id });
  }
}, 120_000);
afterAll(async () => qa?.close());
it('群聊：免费账号拒绝；开通后并发建群只建一次，陌生账号不能读取或改名', async () => {
  const body = { clientRequestId: randomUUID(), characterIds: ids.slice(0, 2) };
  expect((await qa.http(owner.token, '/groups', 'POST', body)).status).toBe(403);
  await qa.db.transaction((tx) =>
    qa.app
      .get(MembershipService)
      .extendProPlus({ userId: owner.id, months: 1, operatorUserId: null }, tx),
  );
  const r = await Promise.all([
    qa.http(owner.token, '/groups', 'POST', body),
    qa.http(owner.token, '/groups', 'POST', body),
  ]);
  expect(r.map((x) => x.status)).toEqual([201, 201]);
  expect(r[0].data.conversationId).toBe(r[1].data.conversationId);
  groupId = r[0].data.conversationId;
  expect([403, 404]).toContain((await qa.http(other.token, `/conversations/${groupId}`)).status);
  expect([403, 404]).toContain(
    (await qa.http(other.token, `/groups/${groupId}`, 'PATCH', { title: '越权合成' })).status,
  );
  expect(
    (
      await qa.http(owner.token, `/conversations/${groupId}/messages`, 'POST', {
        clientMsgId: randomUUID(),
        content: { type: 'text', text: '合成群消息' },
      })
    ).status,
  ).toBe(200);
});
it('群聊：加人、移出、重入和改名恢复；会员到期后历史可看而新消息被拒绝', async () => {
  expect(
    (await qa.http(owner.token, `/groups/${groupId}/members`, 'POST', { characterIds: [ids[2]] }))
      .status,
  ).toBe(200);
  const left = await qa.http(owner.token, `/groups/${groupId}/members/${ids[0]}`, 'DELETE');
  expect(left.status).toBe(200);
  expect(
    left.data.group.formerParticipants.some((x: { refId: string }) => x.refId === ids[0]),
  ).toBe(true);
  expect(
    (await qa.http(owner.token, `/groups/${groupId}/members`, 'POST', { characterIds: [ids[0]] }))
      .status,
  ).toBe(200);
  expect(
    (await qa.http(owner.token, `/groups/${groupId}`, 'PATCH', { title: '自定群名' })).data.title,
  ).toBe('自定群名');
  const reset = await qa.http(owner.token, `/groups/${groupId}`, 'PATCH', { title: null });
  expect(reset.data.title).toContain('合成群友');
  qa.clock.advance(32 * 86_400_000);
  expect((await qa.http(owner.token, `/conversations/${groupId}`)).status).toBe(200);
  expect(
    (
      await qa.http(owner.token, `/conversations/${groupId}/messages`, 'POST', {
        clientMsgId: randomUUID(),
        content: { type: 'text', text: '合成消息' },
      })
    ).status,
  ).toBe(403);
});
it('朋友圈：并发发布和评论幂等，其他用户不能读取、点赞或删除', async () => {
  const body = {
    clientRequestId: randomUUID(),
    text: '合成动态',
    imageMediaIds: [],
    visibility: { kind: 'all_characters', characterIds: [] },
  };
  const posts = await Promise.all([
    qa.http(owner.token, '/moments/posts', 'POST', body),
    qa.http(owner.token, '/moments/posts', 'POST', body),
  ]);
  expect(posts.map((x) => x.status)).toEqual([201, 201]);
  expect(posts[0].data.postId).toBe(posts[1].data.postId);
  postId = posts[0].data.postId;
  expect((await qa.http(other.token, `/moments/posts/${postId}`)).status).toBe(404);
  expect((await qa.http(other.token, `/moments/posts/${postId}/like`, 'POST')).status).toBe(404);
  // 删除对非本人对象幂等空操作，必须确认原作者数据还在，不能只靠响应码。
  expect([204, 404]).toContain(
    (await qa.http(other.token, `/moments/posts/${postId}`, 'DELETE')).status,
  );
  expect((await qa.http(owner.token, `/moments/posts/${postId}`)).status).toBe(200);
  const comment = { clientRequestId: randomUUID(), text: '合成评论' };
  const replies = await Promise.all([
    qa.http(owner.token, `/moments/posts/${postId}/comments`, 'POST', comment),
    qa.http(owner.token, `/moments/posts/${postId}/comments`, 'POST', comment),
  ]);
  const n = await qa.db.query<{ n: string }>(
    'SELECT count(*) AS n FROM moments.comments WHERE post_id=$1',
    [postId],
  );
  const retry = await qa.http(owner.token, `/moments/posts/${postId}/comments`, 'POST', comment);
  console.info(
    'QA_MOMENTS_COMMENT',
    JSON.stringify({
      statuses: replies.map((x) => x.status),
      rows: Number(n.rows[0]?.n),
      retryStatus: retry.status,
    }),
  );
  expect(n.rows[0]?.n).toBe('1');
  expect(retry.status).toBe(200);
  expect(replies.map((x) => x.status)).toEqual([200, 200]);
});
it('朋友圈部分可见：未选中的角色读不到正文，选中的角色能读取', async () => {
  const post = await qa.http(owner.token, '/moments/posts', 'POST', {
    clientRequestId: randomUUID(),
    text: '合成部分可见',
    imageMediaIds: [],
    visibility: { kind: 'selected', characterIds: [ids[0]] },
  });
  expect(post.status).toBe(201);
  const service = qa.app.get(MomentsService);
  expect(
    await service.getPostVisibleToCharacter(owner.id, post.data.postId, ids[0]!),
  ).not.toBeNull();
  expect(await service.getPostVisibleToCharacter(owner.id, post.data.postId, ids[1]!)).toBeNull();
});
it('群聊与朋友圈删除后重试安全，私有历史不再返回', async () => {
  for (let i = 0; i < 2; i++)
    expect((await qa.http(owner.token, `/groups/${groupId}/dissolve`, 'POST')).status).toBe(204);
  expect((await qa.http(owner.token, `/conversations/${groupId}`)).status).toBe(404);
  expect((await qa.http(owner.token, `/moments/posts/${postId}`, 'DELETE')).status).toBe(204);
  expect((await qa.http(owner.token, `/moments/posts/${postId}`)).status).toBe(404);
});
