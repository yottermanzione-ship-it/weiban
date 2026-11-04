import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { PlazaService } from '../../../../apps/server/src/modules/plaza/application/plaza.service.js';
import { PLAZA_PUBLISH_CHECK } from '../../../../apps/server/src/modules/plaza/tokens.js';
import { makeQaApp } from './qa-app.js';
let qa: Awaited<ReturnType<typeof makeQaApp>>,
  owner: Awaited<ReturnType<typeof qa.user>>,
  reader: typeof owner;
let service: PlazaService,
  characterId: string,
  workId: string,
  checkAvailable = false;
beforeAll(async () => {
  qa = await makeQaApp([
    {
      token: PLAZA_PUBLISH_CHECK,
      value: {
        checkBeforePublish: async () =>
          checkAvailable
            ? { ok: true, value: { childFeaturesDetected: false, spans: [] } }
            : { ok: false, error: 'unavailable' },
      },
    },
  ]);
  owner = await qa.user('qa_plaza_owner');
  reader = await qa.user('qa_plaza_reader');
  service = qa.app.get(PlazaService);
  const created = await qa.http(owner.token, '/characters/custom', 'POST', {
    name: '合成成年角色',
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
  characterId = created.data.characterId;
}, 120_000);
afterAll(async () => {
  await qa?.close();
});
it('发布检查不可用时停止；成功后并发确认同一草稿只发布一个版本', async () => {
  const source = { kind: 'custom_character', characterId };
  await expect(service.createPublishDraft(owner.id, { source })).rejects.toThrow();
  const empty = await qa.db.query<{ n: string }>('SELECT count(*) AS n FROM plaza.works');
  expect(Number(empty.rows[0]?.n)).toBe(0);
  checkAvailable = true;
  await service.putMyProfile(owner.id, { nickname: '合成作者', avatarMediaId: null });
  const draft = await service.createPublishDraft(owner.id, { source });
  const body = {
    settings: { tagline: '本地测试作品', publishNote: '', allowRemix: true, commentsOpen: true },
    keptSpanIds: [],
    avatarRightsConfirmed: false,
  };
  const results = await Promise.allSettled([
    service.confirmPublish(owner.id, draft.draftId, body),
    service.confirmPublish(owner.id, draft.draftId, body),
  ]);
  const success = results.find((r) => r.status === 'fulfilled');
  expect(success?.status).toBe('fulfilled');
  workId = (success as PromiseFulfilledResult<{ workId: string }>).value.workId;
  // PLZ-02 明确允许首次来源冲突；最终只有一个作品，完成后的重试返回原作品。
  for (const result of results)
    if (result.status === 'rejected') expect(result.reason.code).toBe('conflict');
  expect((await service.confirmPublish(owner.id, draft.draftId, body)).workId).toBe(workId);
  const rows = await qa.db.query<{ works: string; versions: string }>(
    'SELECT (SELECT count(*) FROM plaza.works) AS works, (SELECT count(*) FROM plaza.work_versions) AS versions',
  );
  expect(rows.rows[0]).toEqual({ works: '1', versions: '1' });
});
it('作品并发复制只建一个角色和一次添加记录；作者外的用户不能改作品', async () => {
  const adoptionId = randomUUID();
  const results = await Promise.all([
    service.adopt(reader.id, workId, { adoptionId }),
    service.adopt(reader.id, workId, { adoptionId }),
  ]);
  expect(results[0].characterId).toBe(results[1].characterId);
  const rows = await qa.db.query<{ copies: string; adoptions: string }>(
    'SELECT (SELECT count(*) FROM characters.characters WHERE owner_id=$1) AS copies, (SELECT count(*) FROM plaza.adoptions WHERE user_id=$1) AS adoptions',
    [reader.id],
  );
  expect(rows.rows[0]).toEqual({ copies: '1', adoptions: '1' });
  await expect(
    service.updateWorkSettings(reader.id, workId, {
      tagline: '合成',
      publishNote: '',
      allowRemix: true,
      commentsOpen: false,
    }),
  ).rejects.toMatchObject({ code: 'not_found' });
});
it('同一个新版本草稿并发确认只生成一个新版本', async () => {
  const draft = await service.createPublishDraft(owner.id, {
    source: { kind: 'custom_character', characterId },
  });
  const body = {
    settings: {
      tagline: '本地测试作品第二版',
      publishNote: '',
      allowRemix: true,
      commentsOpen: true,
    },
    keptSpanIds: [],
    avatarRightsConfirmed: false,
    changeNote: '合成更新',
  };
  await Promise.allSettled([
    service.confirmPublish(owner.id, draft.draftId, body),
    service.confirmPublish(owner.id, draft.draftId, body),
  ]);
  const rows = await qa.db.query<{ n: string; current_version: number }>(
    'SELECT (SELECT count(*) FROM plaza.work_versions WHERE work_id=$1) AS n, current_version FROM plaza.works WHERE id=$1',
    [workId],
  );
  console.info('QA_PLAZA_VERSION_COUNT', JSON.stringify(rows.rows[0]));
  expect(rows.rows[0]).toEqual({ n: '2', current_version: 2 });
});
it('下架后不再出现在公开列表，新的复制被拒绝', async () => {
  await service.unlistWork(owner.id, workId);
  const list = await service.listWorks(reader.id, {});
  expect(list.items.some((x) => x.workId === workId)).toBe(false);
  await expect(service.adopt(reader.id, workId, { adoptionId: randomUUID() })).rejects.toThrow();
});
