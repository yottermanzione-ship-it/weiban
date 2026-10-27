import 'reflect-metadata';
import { expect, it, vi } from 'vitest';
vi.mock('../../../platform/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../platform/index.js')>()),
  asDbTx: (tx: unknown) => tx,
}));
import { WeiboPublication } from './weibo.js';
const raw = {
  id: 'fixture-role',
  display_name: '程澈',
  core_persona: '原创成年人物',
  weibo_nickname: '程澈工作室',
};
function harness(legacyCard: Record<string, unknown>) {
  const published: unknown[] = [];
  const open = vi.fn(async () => {
    throw Error('迁入角色不应读取新格式密文');
  });
  const role = {
    id: 'fixture-role',
    kind: 'preset',
    status: 'published',
    realPersonKind: null,
    eligibilityOverride: null,
    publishedCiphertext: null,
    legacyCard,
  };
  const tx = {
    db: {
      select: () => ({ from: () => ({ where: () => ({ for: async () => [role] }) }) }),
      insert: () => ({
        values: async (value: unknown) => {
          published.push(value);
        },
      }),
    },
    query: async () => ({ rows: [] }),
  };
  const service = new WeiboPublication(
    { now: () => new Date('2026-10-26T10:00:00Z') } as never,
    { open } as never,
  );
  return {
    published,
    open,
    run: (nickname = '程澈工作室') =>
      service.publish(tx as never, {
        characterId: 'fixture-role',
        nickname,
        content: '今天分享公开创作进度。',
        sourceUrl: 'https://weibo.com/1234567890/AbCdEf',
        publishedOn: '2026-10-26',
      }),
  };
}
it('已有微博昵称的迁入角色可发布已核验文字，不要求伪造头像或新卡密文', async () => {
  const h = harness(raw);
  expect(await h.run()).toEqual(expect.any(String));
  expect(h.published).toHaveLength(1);
  expect(h.open).not.toHaveBeenCalled();
});
it('保存时仍锁定核对标记；关闭或昵称变更后拒绝旧任务发布', async () => {
  for (const next of [
    { ...raw, weibo_profile_json: JSON.stringify({ enabled: false, nickname: '程澈工作室' }) },
    { ...raw, weibo_nickname: '别的昵称' },
  ]) {
    const h = harness(next);
    await expect(h.run()).rejects.toThrow('weibo marker changed');
    expect(h.published).toHaveLength(0);
    expect(h.open).not.toHaveBeenCalled();
  }
});
