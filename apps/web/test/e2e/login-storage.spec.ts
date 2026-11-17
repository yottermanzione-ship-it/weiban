import { expect, test, type Page } from '@playwright/test';
import { clientLogCodeId, type ClientRuntimeEvent } from '@weiban/contracts';

type Fault = 'none' | 'transient' | 'denied' | 'quota' | 'device-only';
const auth = {
  user: {
    userId: '11111111-1111-4111-8111-111111111111',
    username: 'storage_audit',
    role: 'user',
    profileCompleted: false,
    createdAt: '2026-11-17T00:00:00.000Z',
  },
  session: {
    sessionId: '22222222-2222-4222-8222-222222222222',
    token: 'CANARY_SYNTHETIC_TOKEN_NOT_A_REAL_CREDENTIAL_12345',
    kind: 'app',
    expiresAt: '2027-02-15T00:00:00.000Z',
  },
};

async function injectStorageFault(page: Page, fault: Fault) {
  await page.addInitScript((mode) => {
    const control = { enabled: true };
    Object.defineProperty(window, 'loginStorageFault', { value: control });
    const open = IDBFactory.prototype.open;
    let first = true;
    IDBFactory.prototype.open = function (name, version) {
      const denied =
        control.enabled &&
        ((mode === 'denied' && name.startsWith('weiban-')) ||
          (mode === 'transient' && name === 'weiban-app' && first) ||
          (mode === 'device-only' && name === 'weiban-installation'));
      if (!denied) return open.call(this, name, version);
      first = false;
      const request = {
        error: new DOMException('CANARY_SYNTHETIC_STORAGE_ERROR', 'SecurityError'),
        onerror: null as (() => void) | null,
      };
      setTimeout(() => request.onerror?.(), 0);
      return request as unknown as IDBOpenDBRequest;
    };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (
        control.enabled &&
        mode === 'quota' &&
        this.transaction.db.name === 'weiban-app' &&
        key === 'session'
      )
        throw new DOMException('CANARY_SYNTHETIC_STORAGE_ERROR', 'QuotaExceededError');
      return put.call(this, value, key);
    };
  }, fault);
}

async function setup(page: Page, fault: Fault, reply: 'ok' | 'password' | 'invalid' = 'ok') {
  const events: ClientRuntimeEvent[] = [];
  const logins: Array<{ installationId?: string }> = [];
  await injectStorageFault(page, fault);
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/client-logs')) {
      const batch = request.postDataJSON() as { events: ClientRuntimeEvent[] };
      events.push(...batch.events);
      return route.fulfill({ json: { accepted: true } });
    }
    if (path === '/api/v1/auth/login') {
      const body = request.postDataJSON() as { device: { installationId?: string } };
      logins.push(body.device);
      if (reply === 'password')
        return route.fulfill({
          status: 422,
          json: {
            error: { code: 'invalid_credentials', message: '用户名或密码错误', requestId: 'audit' },
          },
        });
      return route.fulfill({ json: reply === 'invalid' ? { invalid: true } : auth });
    }
    return route.fulfill({
      status: 503,
      json: {
        error: { code: 'service_unavailable', message: 'Synthetic fixture', requestId: 'audit' },
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByLabel('账号', { exact: true }).fill('storage_audit');
  await page.getByLabel('密码', { exact: true }).fill('CANARY_SYNTHETIC_PASSWORD');
  return { events, logins };
}

const submit = (page: Page) =>
  page.getByRole('button', { name: '同意并登录', exact: true }).click();

async function restoreStorage(page: Page) {
  await page.evaluate(() => {
    const control = (window as typeof window & { loginStorageFault: { enabled: boolean } })
      .loginStorageFault;
    control.enabled = false;
  });
}

async function expectDiagnostic(events: ClientRuntimeEvent[], stage: string, reason: string) {
  await expect
    .poll(() =>
      events.some(
        (event) =>
          event.components?.includes(clientLogCodeId(`auth:${stage}`)) &&
          event.components.includes(clientLogCodeId(`auth:${reason}`)),
      ),
    )
    .toBe(true);
  const serialized = JSON.stringify(events);
  expect(serialized).not.toContain('CANARY');
  expect(serialized).not.toContain('storage_audit');
}

for (const fault of ['none', 'transient', 'device-only'] as const) {
  test(`本机存储 ${fault}：同一页面登录成功，不依赖 Cookie`, async ({ page, context }) => {
    const { logins } = await setup(page, fault);
    await submit(page);
    await expect(page).toHaveURL(/\/profile$/);
    expect(logins).toHaveLength(1);
    expect(!!logins[0]?.installationId).toBe(fault !== 'device-only');
    expect(await context.cookies()).toEqual([]);
  });
}

test('存储被拒绝先明确提示并上报；环境恢复后原页面重试成功', async ({ page }) => {
  const { events, logins } = await setup(page, 'denied');
  await submit(page);
  await expect(page.getByRole('alert')).toContainText('浏览器限制了本机存储');
  expect(logins).toHaveLength(0);
  await expectDiagnostic(events, 'storage_check', 'storage_denied');
  await restoreStorage(page);
  await submit(page);
  await expect(page).toHaveURL(/\/profile$/);
  expect(logins).toHaveLength(1);
});

test('认证成功后保存空间不足有准确提示与诊断，释放空间后可重试', async ({ page }) => {
  const { events, logins } = await setup(page, 'quota');
  await submit(page);
  await expect(page.getByRole('alert')).toContainText('验证已通过，但本机存储空间不足');
  expect(logins).toHaveLength(1);
  await expectDiagnostic(events, 'session_save', 'quota_exceeded');
  await restoreStorage(page);
  await submit(page);
  await expect(page).toHaveURL(/\/profile$/);
});

test('真正密码错误沿用服务器说明', async ({ page }) => {
  const { logins } = await setup(page, 'none', 'password');
  await submit(page);
  await expect(page.getByRole('alert')).toHaveText('用户名或密码错误');
  expect(logins).toHaveLength(1);
});

test('登录响应格式异常明确提示并记录请求阶段，不能归因于输入密码', async ({ page }) => {
  const { events } = await setup(page, 'none', 'invalid');
  await submit(page);
  await expect(page.getByRole('alert')).toContainText('登录数据处理异常');
  await expectDiagnostic(events, 'request', 'invalid_data');
});
