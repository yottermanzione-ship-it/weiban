import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ContactsCommands } from '../../../../apps/server/src/modules/contacts/application/commands.js';
import { HealthService } from '../../../../apps/server/src/modules/health/application/health.service.js';
import { RemindersService } from '../../../../apps/server/src/modules/play/application/reminders.service.js';
import { PlayContext } from '../../../../apps/server/src/modules/play/application/context.js';
import { makeQaApp } from './qa-app.js';
let qa: Awaited<ReturnType<typeof makeQaApp>>,
  owner: Awaited<ReturnType<typeof qa.user>>,
  other: typeof owner,
  characterId: string;
beforeAll(async () => {
  qa = await makeQaApp();
  owner = await qa.user('qa_play_owner');
  other = await qa.user('qa_play_other');
  const c = await qa.http(owner.token, '/characters/custom', 'POST', {
    name: '合成玩法角色',
    description:
      '这是一位完全虚构的成年角色，喜欢阅读和观察日常，语气自然简洁，尊重他人边界，愿意认真倾听。所有资料均为本地验收合成内容，不代表任何真实人物。',
    classification: {
      basis: 'original',
      realPersonKind: null,
      ageSetting: 'adult',
      childAppearance: false,
    },
  });
  expect(c.status).toBe(200);
  characterId = c.data.characterId;
  await qa.app.get(ContactsCommands).add(owner.id, { characterId });
  const r = await qa.db.query<{ request_id: string; accept_after: Date }>(
    'SELECT request_id,accept_after FROM contacts.contacts WHERE user_id=$1 AND character_id=$2',
    [owner.id, characterId],
  );
  qa.clock.advance(Math.max(0, r.rows[0]!.accept_after.getTime() - qa.clock.nowMs()));
  await qa.app
    .get(ContactsCommands)
    .accept({ userId: owner.id, characterId, requestId: r.rows[0]!.request_id });
}, 120_000);
afterAll(async () => qa?.close());
it('专注：并发相同请求只开一场，别人不能结束，离开页面后按服务端时间完成', async () => {
  const body = { clientRequestId: randomUUID(), characterId, minutes: 5, note: '合成任务' };
  const r = await Promise.all([
    qa.http(owner.token, '/play/focus', 'POST', body),
    qa.http(owner.token, '/play/focus', 'POST', body),
  ]);
  expect(r.map((x) => x.status)).toEqual([200, 200]);
  expect(r[0].data.focusId).toBe(r[1].data.focusId);
  const id = r[0].data.focusId;
  expect([403, 404]).toContain(
    (await qa.http(other.token, `/play/focus/${id}/end`, 'POST')).status,
  );
  expect((await qa.http(owner.token, '/play/focus')).data.session.focusId).toBe(id);
  qa.clock.advance(6 * 60_000);
  const ended = await qa.http(owner.token, `/play/focus/${id}/end`, 'POST');
  expect(ended.status).toBe(200);
  expect(ended.data.result).toBe('completed');
  expect((await qa.http(owner.token, `/play/focus/${id}/end`, 'POST')).data.result).toBe(
    'completed',
  );
});
it('健康：账号隔离、授权实时撤销、群与朋友圈场景不可读，一键清空', async () => {
  const cycle = await qa.http(owner.token, '/me/health/cycles', 'POST', {
    startDate: '2026-11-04',
  });
  expect(cycle.status).toBe(200);
  const id = cycle.data.cycleId;
  expect([403, 404]).toContain(
    (await qa.http(other.token, `/me/health/cycles/${id}`, 'PATCH', { endDate: '2026-11-04' }))
      .status,
  );
  const svc = qa.app.get(HealthService);
  const base = { userId: owner.id, characterId };
  expect(await svc.getPeriodContext({ ...base, scene: 'direct_reply' })).toBeNull();
  expect(
    (
      await qa.http(owner.token, '/me/health/authorization', 'PUT', {
        authorizedCharacterIds: [characterId],
      })
    ).status,
  ).toBe(200);
  expect(await svc.getPeriodContext({ ...base, scene: 'direct_reply' })).not.toBeNull();
  expect(await svc.getPeriodContext({ ...base, scene: 'group_reply' as never })).toBeNull();
  expect(await svc.getPeriodContext({ ...base, scene: 'moments' as never })).toBeNull();
  await qa.http(owner.token, '/me/health/authorization', 'PUT', { authorizedCharacterIds: [] });
  expect(await svc.getPeriodContext({ ...base, scene: 'direct_reply' })).toBeNull();
  expect(
    (await qa.http(owner.token, '/me/health/clear', 'POST', { confirm: 'CLEAR' })).status,
  ).toBe(200);
  const n = await qa.db.query<{ n: string }>(
    'SELECT count(*) AS n FROM health.period_entries WHERE user_id=$1',
    [owner.id],
  );
  expect(n.rows[0]?.n).toBe('0');
});
it('宠物：领养重试、跨账号隔离和每日互动上限；使用合成图鉴，图片加载未验证', async () => {
  const speciesId = randomUUID(),
    appearanceId = randomUUID(),
    mediaId = randomUUID();
  await qa.db.query(
    'INSERT INTO growth.pet_species(id,name,intro,preset_names,listed,created_at,updated_at) VALUES($1,$2,$3,$4,true,$5,$5)',
    [speciesId, '合成猫', '本地测试', [], qa.clock.now()],
  );
  await qa.db.query(
    'INSERT INTO growth.pet_appearances(id,species_id,name,baby_media_id,junior_media_id,adult_media_id,created_at) VALUES($1,$2,$3,$4,$4,$4,$5)',
    [appearanceId, speciesId, '合成外观', mediaId, qa.clock.now()],
  );
  const body = {
    clientRequestId: randomUUID(),
    characterId,
    speciesId,
    appearanceId,
    name: '合成咪',
  };
  const r = await Promise.all([
    qa.http(owner.token, '/pets', 'POST', body),
    qa.http(owner.token, '/pets', 'POST', body),
  ]);
  expect(r.map((x) => x.status)).toEqual([201, 201]);
  const id = r[0].data.petId;
  expect(id).toBe(r[1].data.petId);
  expect((await qa.http(other.token, `/pets/${id}`)).status).toBe(404);
  let total = 0;
  for (let i = 0; i < 7; i++) {
    const x = await qa.http(owner.token, `/pets/${id}/interactions`, 'POST', {
      kind: 'pat',
      clientActionId: randomUUID(),
    });
    expect(x.status).toBe(200);
    total += x.data.intimacyAdded;
  }
  expect(total).toBe(5);
});
it.each([false, true])(
  '提醒（健康标记=%s）：零余额也能到点发送，重复扫描不重复消息',
  async (health) => {
    const wall = new Date(qa.clock.nowMs() + 8 * 3_600_000 + 3 * 60_000).toISOString();
    const r = await qa.http(owner.token, '/play/reminders', 'POST', {
      clientRequestId: randomUUID(),
      characterId,
      text: '合成提醒',
      time: wall.slice(11, 16),
      repeat: { kind: 'once', date: wall.slice(0, 10) },
      health,
      bypassDoNotDisturb: true,
      enabled: true,
    });
    expect(r.status).toBe(200);
    const badKey = `reminder:${r.data.reminderId}:${new Date(r.data.nextFireAt).toISOString()}`;
    await expect(
      qa.db.transaction((tx) =>
        qa.app
          .get(PlayContext)
          .postToDirectChat(tx, {
            userId: owner.id,
            characterId,
            sender: 'character',
            content: { type: 'text', text: '合成提醒对照' },
            idempotencyKey: badKey,
            labels: ['health'],
          }),
      ),
    ).rejects.toMatchObject({ code: 'bad_request' });
    await qa.db.transaction((tx) =>
      qa.app
        .get(PlayContext)
        .postToDirectChat(tx, {
          userId: owner.id,
          characterId,
          sender: 'character',
          content: { type: 'text', text: '合成有效键对照' },
          idempotencyKey: `qa-reminder-control:${r.data.reminderId}`,
          labels: ['health'],
        }),
    );
    qa.clock.advance(Math.max(0, new Date(r.data.nextFireAt).getTime() - qa.clock.nowMs()) + 1000);
    const svc = qa.app.get(RemindersService);
    await svc.sweepDue(qa.clock.now());
    await svc.sweepDue(qa.clock.now());
    const n = await qa.db.query<{ n: string; health: string }>(
      "SELECT count(*) AS n,count(*) FILTER(WHERE 'health'=ANY(labels)) AS health FROM chat.messages WHERE client_msg_id LIKE $1",
      [`reminder:${r.data.reminderId}:%`],
    );
    const state = await qa.db.query<{ consumed: boolean }>(
      'SELECT last_fired_at IS NOT NULL AND next_fire_at IS NULL AS consumed FROM play.reminders WHERE id=$1',
      [r.data.reminderId],
    );
    console.info(
      'QA_REMINDER_COUNTS',
      JSON.stringify({
        ...n.rows[0],
        healthSetting: health,
        consumed: state.rows[0]?.consumed,
        invalidKeyRejected: true,
        validKeyControlPassed: true,
      }),
    );
    expect(n.rows[0]).toEqual({ n: '1', health: health ? '1' : '0' });
  },
);
