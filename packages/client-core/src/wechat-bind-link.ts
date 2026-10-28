import { WECHAT_BIND_URL_HOST } from '@weiban/contracts';

/** 授权票只交给微信官方页面；不接第三方跳板，也不拼没有凭据依据的 weixin:// 私有地址。 */
export function wechatBindLink(
  bindUrl: string,
  userAgent: string,
): { bindUrl: string; href: string; label: string; androidIntent: boolean } | null {
  let url: URL;
  try {
    if (Array.from(bindUrl).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))
      return null;
    url = new URL(bindUrl);
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== WECHAT_BIND_URL_HOST ||
    url.port ||
    url.username ||
    url.password
  )
    return null;
  const original = url.href;
  const inWechat = /MicroMessenger/i.test(userAgent);
  // Chrome 的公开 Android Intent 格式：用户点击后尝试微信；不支持则退回原官方 HTTPS 页。
  // 有 fragment 时不组合 Intent，避免授权 URL 的 fragment 与 #Intent; 分隔符混淆。
  const androidIntent = /Android/i.test(userAgent) && !inWechat && !url.hash;
  return {
    bindUrl: original,
    href: androidIntent
      ? `intent:${original.slice('https:'.length)}#Intent;scheme=https;package=com.tencent.mm;S.browser_fallback_url=${encodeURIComponent(original)};end`
      : original,
    label: inWechat ? '在微信内继续绑定' : androidIntent ? '尝试用微信打开' : '打开绑定链接',
    androidIntent,
  };
}
