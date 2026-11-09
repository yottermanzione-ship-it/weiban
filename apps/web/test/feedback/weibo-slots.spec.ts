import { expect, test, type Page } from '@playwright/test';

const fixture = '/test/browser-fixtures/wechat-binding.html?channel=weibo';
type Call = {
  path: string;
  method: string;
  params?: { bindingId: string };
  body?: Record<string, string>;
};
const calls = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { wechatFixture: { calls: Call[] } }).wechatFixture.calls,
  );
async function open(page: Page, count: number) {
  await page.goto(`${fixture}&slots=${count}`);
  await page.getByRole('button', { name: '微博接入', exact: false }).click();
  await expect(page.getByRole('dialog', { name: '微博助手 · 五个槽位' })).toBeVisible();
}

test('五槽各自展示；改角色和解绑只发送所选 bindingId，其他槽角色仍可见', async ({ page }) => {
  await page.setViewportSize({ width: 340, height: 766 });
  await open(page, 5);
  const slots = page.getByRole('dialog', { name: '微博助手 · 五个槽位' });
  for (const label of ['主号', '小蓝', '小白', '小粉', '小黄'])
    await expect(slots.getByRole('button', { name: `${label} ·`, exact: false })).toBeVisible();
  await slots.getByRole('button', { name: '小蓝 ·', exact: false }).click();
  const detail = page.getByRole('dialog', { name: '微博 · 小蓝' });
  await expect(detail.getByRole('button', { name: '测试角色 01', exact: true })).toHaveCount(0);
  await expect(detail.getByRole('button', { name: '测试角色 03', exact: true })).toHaveCount(0);
  await detail.getByRole('button', { name: '测试角色 06', exact: true }).click();
  await detail.getByRole('button', { name: '保存出口角色', exact: true }).click();
  await expect(detail.getByText('测试角色 06', { exact: true }).first()).toBeVisible();
  const changes = (await calls(page)).filter((call) => call.method === 'PATCH');
  expect(changes).toHaveLength(1);
  expect(changes[0]?.params?.bindingId).toBe('11111111-1111-4111-8111-000000000002');
  expect(changes[0]?.body?.characterId).toBe('00000000-0000-4000-8000-000000000006');
  await detail.getByRole('button', { name: '解除此槽位绑定' }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  expect((await calls(page)).filter((call) => call.method === 'DELETE')).toHaveLength(0);
  await detail.getByRole('button', { name: '解除此槽位绑定' }).click();
  await page.getByRole('button', { name: '解除绑定', exact: true }).click();
  await expect(detail).toHaveCount(0);
  const removal = (await calls(page)).filter((call) => call.method === 'DELETE');
  expect(removal).toHaveLength(1);
  expect(removal[0]?.params?.bindingId).toBe('11111111-1111-4111-8111-000000000002');
  await expect(slots.getByRole('button', { name: '主号 ·', exact: false })).toContainText(
    '测试角色 01',
  );
  await expect(slots.getByRole('button', { name: '小白 ·', exact: false })).toContainText(
    '测试角色 03',
  );
  await expect(slots.getByRole('button', { name: '小蓝 ·', exact: false })).toContainText('未绑定');
  expect(await slots.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(false);
});

test('空槽连接发送指定 slot；已有其他槽角色不可重复选择', async ({ page }) => {
  await open(page, 2);
  await page.getByRole('button', { name: '小黄 ·', exact: false }).click();
  const detail = page.getByRole('dialog', { name: '微博 · 小黄' });
  await expect(detail.getByRole('button', { name: '测试角色 01', exact: true })).toHaveCount(0);
  await detail.getByRole('button', { name: '测试角色 03', exact: true }).click();
  await detail.getByLabel('AppID', { exact: true }).fill('synthetic-yellow-app');
  await detail.getByLabel('AppSecret', { exact: true }).fill('synthetic-yellow-secret');
  await detail.getByRole('button', { name: '连接微博', exact: true }).click();
  await expect(detail.getByRole('button', { name: '解除此槽位绑定' })).toBeVisible();
  const posted = (await calls(page)).filter(
    (call) => call.method === 'POST' && call.path === '/api/v1/channels/weibo/bindings',
  );
  expect(posted).toHaveLength(1);
  expect(posted[0]?.body).toMatchObject({
    slot: 'yellow',
    characterId: '00000000-0000-4000-8000-000000000003',
    appId: 'synthetic-yellow-app',
  });
  expect(posted[0]?.path).toBe('/api/v1/channels/weibo/bindings');
});
