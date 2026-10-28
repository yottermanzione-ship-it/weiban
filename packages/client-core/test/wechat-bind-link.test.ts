import { describe, expect, it } from 'vitest';
import { wechatBindLink } from '../src/wechat-bind-link.js';

const original = 'https://liteapp.weixin.qq.com/q/test-only?ticket=TEST_ONLY%2Fticket&next=a%3Bb';
describe('微信官方绑定链接的系统打开方式', () => {
  it('安卓外部浏览器只尝试指定微信，回退仍是原官方 URL', () => {
    const result = wechatBindLink(original, 'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile')!;
    expect(result.bindUrl).toBe(original);
    expect(result.androidIntent).toBe(true);
    expect(result.href).toBe(
      `intent://liteapp.weixin.qq.com/q/test-only?ticket=TEST_ONLY%2Fticket&next=a%3Bb#Intent;scheme=https;package=com.tencent.mm;S.browser_fallback_url=${encodeURIComponent(original)};end`,
    );
    expect(result.href).not.toContain('weixin://');
  });
  it.each([
    'Mozilla/5.0 iPhone Safari',
    'Mozilla/5.0 Windows Chrome',
    'Android MicroMessenger/8.0',
  ])('微信内/iOS/桌面保留官方地址，不造私有 scheme：%s', (ua) => {
    expect(wechatBindLink(original, ua)?.href).toBe(original);
    expect(wechatBindLink(original, ua)?.androidIntent).toBe(false);
  });
  it('fragment 不与 Android Intent 分隔符混用', () => {
    expect(wechatBindLink(original + '#section', 'Android Chrome')?.href).toBe(
      original + '#section',
    );
  });
  it.each([
    'javascript:alert(1)',
    'weixin://dl/business/?url=x',
    'http://liteapp.weixin.qq.com/q/x',
    'https://evil.test/q/x',
    'https://liteapp.weixin.qq.com.evil.test/q/x',
    'https://user:pass@liteapp.weixin.qq.com/q/x',
    'https://liteapp.weixin.qq.com:8443/q/x',
    original + '\n',
  ])('不打开或复制非官方/混淆地址：%s', (value) => {
    expect(wechatBindLink(value, 'Android')).toBeNull();
  });
});
