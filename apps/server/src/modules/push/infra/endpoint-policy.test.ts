import { expect, it } from 'vitest';
import { isPublicPushAddress, validateWebPushEndpoint } from './endpoint-policy.js';
it('只认固定浏览器推送HTTPS域名，不接受内网、伪后缀、用户认证、端口与重定向式地址', () => {
  for (const url of [
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/abc',
    'https://foo.notify.windows.com/abc',
  ])
    expect(validateWebPushEndpoint(url).protocol).toBe('https:');
  for (const url of [
    'http://fcm.googleapis.com/abc',
    'https://fcm.googleapis.com.evil.test/abc',
    'https://fcm.googleapis.com@127.0.0.1/abc',
    'https://127.0.0.1/abc',
    'https://fcm.googleapis.com:8443/abc',
    'https://user:secret@fcm.googleapis.com/abc',
    'https://fcm.googleapis.com/abc#fragment',
  ])
    expect(() => validateWebPushEndpoint(url)).toThrow();
});
it('DNS只允许公共地址，拒绝private、mapped、保留及文档网段', () => {
  for (const address of ['8.8.8.8', '142.250.185.10', '2607:f8b0:400a:809::200a'])
    expect(isPublicPushAddress(address)).toBe(true);
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '192.0.2.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
    'invalid',
  ])
    expect(isPublicPushAddress(address)).toBe(false);
});
