import { afterEach, expect, it, vi } from 'vitest';
import { describeDevice, shellVersion } from '../src/data/device-info.js';

afterEach(() => vi.unstubAllGlobals());
it('recognizes formal and old shells without mistaking an ordinary Android browser for the app', () => {
  for (const version of ['1', '3.0.0', '3.0.0-debug']) {
    expect(shellVersion(`Android WeibanShell/${version}`)).toBe(version);
    expect(describeDevice(`Android WeibanShell/${version}`, false)).toMatchObject({
      platform: 'android',
      name: '微伴安卓应用',
      appVersion: version,
    });
  }
  expect(describeDevice('Android Chrome/140 Safari/537', false)).toMatchObject({
    platform: 'web',
    name: 'Chrome · 安卓',
  });
  for (const ua of [
    'Android Chrome/140',
    'WeibanShell/',
    'WeibanShell/3.0.0evil',
    'FakeWeibanShell/3',
  ])
    expect(shellVersion(ua)).toBeUndefined();
});
it('separates iPhone browser and home-screen mode', () => {
  expect(describeDevice('iPhone Safari/600', false).platform).toBe('web');
  expect(describeDevice('iPhone Safari/600', true).platform).toBe('ios_pwa');
});
