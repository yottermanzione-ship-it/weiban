/** 独立容器演练数据；禁止指向公网地址。 */
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
const [mode, base, recordFile, imageFile] = process.argv.slice(2);
const target = new URL(base);
assert(['127.0.0.1', 'localhost'].includes(target.hostname), '只允许本机演练地址');
const password = 'smoke-only-password-canary';
const device = {
  platform: 'web',
  name: '部署演练',
  appVersion: '0.1.0',
  timeZone: 'Asia/Shanghai',
};
async function call(path, { method = 'GET', body, token, file, host = 'app.localhost' } = {}) {
  const headers = { Host: host };
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (file) {
    payload = new FormData();
    payload.append('file', new Blob([await readFile(file)], { type: 'image/png' }), 'smoke.png');
  } else if (body) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const url = new URL(path, base);
  const prepared = new Request(url, { method, headers, body: payload });
  const bytes = payload ? Buffer.from(await prepared.arrayBuffer()) : null;
  const actualHeaders = Object.fromEntries(prepared.headers);
  actualHeaders.host = host;
  if (bytes) actualHeaders['content-length'] = String(bytes.length);
  const r = await new Promise((resolve, reject) => {
    const outgoing = request(url, { method, headers: actualHeaders }, (incoming) => {
      const chunks = [];
      incoming.on('data', (chunk) => chunks.push(chunk));
      incoming.on('error', reject);
      incoming.on('end', () =>
        resolve(
          new Response(Buffer.concat(chunks), {
            status: incoming.statusCode,
            headers: incoming.headers,
          }),
        ),
      );
    });
    outgoing.on('error', reject);
    outgoing.setTimeout(20_000, () => outgoing.destroy(new Error('本机演练请求超时')));
    outgoing.end(bytes);
  });
  assert(r.ok, `${method} ${path} HTTP${r.status}`);
  return r;
}
async function json(path, options) {
  return (await call('/api/v1' + path, options)).json();
}
async function login(username, kind = 'app') {
  return json('/auth/login', { method: 'POST', body: { username, password, kind, device } });
}
const web = await call('/');
assert((await web.text()).includes('微伴'));
assert(web.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));
const adminHTML = await call('/', { host: 'admin.localhost' });
assert((await adminHTML.text()).includes('微伴管理后台'));
assert.equal((await (await call('/health')).json()).checks.crypto.configured, true);
let user, record;
if (mode === 'seed') {
  const admin = await login('deploy_admin', 'admin');
  const invite = await json('/admin/invites', {
    method: 'POST',
    token: admin.session.token,
    body: { expiresInDays: 1, bonusMicros: 5000001 },
  });
  user = await json('/auth/register', {
    method: 'POST',
    body: { username: 'deploy_user', password, inviteCode: invite.code, device },
  });
  const uploaded = await json('/media?purpose=user_avatar', {
    method: 'POST',
    token: user.session.token,
    file: imageFile,
  });
  record = {
    mediaId: uploaded.mediaId,
    mediaHex: Buffer.from(
      await (
        await call(new URL(uploaded.url).pathname + new URL(uploaded.url).search)
      ).arrayBuffer(),
    ).toString('hex'),
  };
  await writeFile(recordFile, JSON.stringify(record), { mode: 0o600 });
} else {
  assert.equal(mode, 'verify');
  user = await login('deploy_user');
  record = JSON.parse(await readFile(recordFile, 'utf8'));
}
let balance;
for (let i = 0; i < 30; i++) {
  balance = await json('/billing/wallet', { token: user.session.token });
  if (balance.balanceMicros === 5000001) break;
  await new Promise((resolve) => setTimeout(resolve, 200));
}
assert.equal(balance.balanceMicros, 5000001);
const media = await json(`/media/${record.mediaId}`, { token: user.session.token });
const image = await call(new URL(media.url).pathname + new URL(media.url).search);
assert.equal(Buffer.from(await image.arrayBuffer()).toString('hex'), record.mediaHex);
console.log(`${mode}: 双域静态页/安全头、健康、账号/5.000001元余额与加密媒体下载验证通过`);
