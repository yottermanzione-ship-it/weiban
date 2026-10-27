import { describe, expect, it } from 'vitest';
import { parseWeiboCredentials } from '../src/channel-credentials.js';

const pair = { appId: 'helper-app-123456', appSecret: 'CANARY-helper-secret-123456' };
describe('微博龙虾助手凭据识别（无个人 UID，无命令执行）', () => {
  it.each([
    `连接信息\nAppID：${pair.appId}\nAppSecret：${pair.appSecret}\n请粘贴到微伴`,
    JSON.stringify(pair),
    JSON.stringify({ app_key: pair.appId, app_secret: pair.appSecret }),
    `${pair.appId}\n${pair.appSecret}`,
    `openclaw config set channels.weibo.appId '${pair.appId}'\nopenclaw config set channels.weibo.appSecret '${pair.appSecret}'`,
  ])('识别助手整段、JSON、两行及配置命令', (text) => {
    expect(parseWeiboCredentials(text)).toEqual(pair);
  });
  it('缺项、混合多份凭据和过大原文均拒绝，不能沿用上次识别的值', () => {
    expect(parseWeiboCredentials(`AppId: ${pair.appId}`)).toBeNull();
    expect(
      parseWeiboCredentials(
        JSON.stringify(pair) + '\n' + JSON.stringify({ ...pair, appId: 'other-helper-12345' }),
      ),
    ).toBeNull();
    expect(parseWeiboCredentials('x'.repeat(16385))).toBeNull();
  });
});
