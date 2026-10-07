import { isIP } from 'node:net';
import { AppError } from '../../../platform/index.js';

/** 只接受浏览器厂商的HTTPS服务；不允许用户把服务器当任意HTTP代理。 */
export function validateWebPushEndpoint(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError('bad_request', '无效推送地址');
  }
  const host = url.hostname.toLowerCase();
  const known =
    host === 'fcm.googleapis.com' ||
    host === 'updates.push.services.mozilla.com' ||
    (host.endsWith('.push.apple.com') && host !== '.push.apple.com') ||
    host.endsWith('.notify.windows.com');
  if (
    !known ||
    url.protocol !== 'https:' ||
    (url.port && url.port !== '443') ||
    url.username ||
    url.password ||
    url.hash ||
    value.length > 4096
  )
    throw new AppError('bad_request', '不支持的推送服务地址');
  return url;
}

/** IPv6只认全球单播；拒绝mapped/private/文档/loopback，IPv4拒绝所有本地保留网段。 */
export function isPublicPushAddress(address: string): boolean {
  if (isIP(address) === 6)
    return /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:db8:/i.test(address);
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number) as [number, number, number, number];
  return (
    a !== 0 &&
    a !== 10 &&
    a !== 127 &&
    a < 224 &&
    !(a === 100 && b >= 64 && b <= 127) &&
    !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) &&
    !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) &&
    !(a === 203 && b === 0 && c === 113)
  );
}
