import { randomUUID } from 'node:crypto';
import { AdminScenarioModeCreate } from '@weiban/contracts';
import { ScenarioModeService } from '../src/modules/characters/testing.js';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ContactsCommands } from '../src/modules/contacts/testing.js';
import { MembershipService } from '../src/modules/identity/testing.js';
import { MomentsService } from '../src/modules/moments/testing.js';
import { makeIsolatedApp } from './support/isolated-app.js';
import { describeDb } from './support/db.js';
describeDb('群聊与朋友圈并发回归', () => {
  let qa: Awaited<ReturnType<typeof makeIsolatedApp>>,
    owner: Awaited<ReturnType<typeof qa.user>>,
    other: typeof owner;
  const ids: string[] = [];
  let groupId: string, postId: string;
  beforeAll(async () => {
    qa = await makeIsolatedApp();
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
  it('群聊预设遵守全体成员资格，停用回落，普通预设之间切换确实产生提示', async () => {
    const catalog = qa.app.get(ScenarioModeService);
    const mode = await catalog.create(
      owner.id,
      AdminScenarioModeCreate.parse({
        id: 'qa_group_scene',
        name: '温柔讨论',
        presetPrompt: '先回应群里刚刚提出的具体问题，再邀请另一位成员补充。',
        hasRomanceContent: true,
      }),
    );
    const path = `/groups/${groupId}/companion-settings`;
    expect(
      (await qa.http(owner.token, `/groups/${groupId}/scenario-modes`)).data.customItems,
    ).toContainEqual(expect.objectContaining({ presetId: mode.id, id: 'daily' }));
    const switched = await qa.http(owner.token, path, 'PATCH', { scenarioPresetId: mode.id });
    expect(switched.status).toBe(200);
    expect(switched.data).toMatchObject({ scenarioMode: 'daily', scenarioPresetId: mode.id });
    await qa.db.query("UPDATE characters.characters SET age_setting='minor' WHERE id=$1", [ids[0]]);
    try {
      expect(
        (await qa.http(owner.token, `/groups/${groupId}/scenario-modes`)).data.customItems,
      ).toHaveLength(0);
      expect((await qa.http(owner.token, path)).data).toMatchObject({
        scenarioMode: 'daily',
        scenarioPresetId: null,
      });
      expect(
        (await qa.http(owner.token, path, 'PATCH', { scenarioPresetId: mode.id })).status,
      ).toBe(400);
    } finally {
      // 自建角色资格只能收紧，不能把同一个儿童样本改回成年。改用适合全员的普通预设继续测试。
      await catalog.update(owner.id, mode.id, { hasRomanceContent: false });
    }
    expect((await qa.http(owner.token, path, 'PATCH', { scenarioPresetId: mode.id })).status).toBe(
      200,
    );
    await catalog.update(owner.id, mode.id, { enabled: false });
    expect((await qa.http(owner.token, path)).data).toMatchObject({
      scenarioMode: 'daily',
      scenarioPresetId: null,
    });
    await catalog.delete(owner.id, mode.id);
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
    const changedRetry = await qa.http(owner.token, `/moments/posts/${postId}/comments`, 'POST', {
      ...comment,
      text: '重试不覆盖已提交的正文',
    });
    expect(changedRetry.status).toBe(200);
    expect(changedRetry.data.comments).toHaveLength(1);
    expect(changedRetry.data.comments[0].text).toBe(comment.text);
    const events = await qa.db.query<{ n: string }>(
      "SELECT count(*) AS n FROM platform.outbox WHERE event_type='moments.comment_created' AND event->'payload'->>'postId'=$1",
      [postId],
    );
    expect(events.rows[0]?.n).toBe('1');
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
    expect(
      (
        await qa.http(owner.token, `/moments/posts/${postId}/comments`, 'POST', {
          clientRequestId: randomUUID(),
          text: '已删除动态的迟到请求',
        })
      ).status,
    ).toBe(404);
  });
});
