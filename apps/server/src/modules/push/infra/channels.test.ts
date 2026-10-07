import 'reflect-metadata';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  createECDH,
  createHmac,
  createDecipheriv,
  randomBytes,
  createPublicKey,
  verify,
} from 'node:crypto';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import webpush from 'web-push';
import { NotificationEnvelope, type RegisterPushDeviceRequest } from '@weiban/contracts';
import { newId } from '../../../platform/index.js';
import { testConfig } from '../../../../test/support/fixtures.js';
import { PushChannels } from './channels.js';
import type { PushHttpPort } from './http-transport.js';

const directory = mkdtempSync(join(tmpdir(), 'weiban-push-channel-'));
const vapid = webpush.generateVAPIDKeys();
const client = createECDH('prime256v1');
client.generateKeys();
const auth = randomBytes(16);
const subscription: RegisterPushDeviceRequest = {
  kind: 'webpush',
  subscription: {
    endpoint: 'https://fcm.googleapis.com/fcm/send/test-credential',
    keys: { p256dh: client.getPublicKey().toString('base64url'), auth: auth.toString('base64url') },
  },
};
const android: RegisterPushDeviceRequest = {
  kind: 'android',
  provider: 'jpush',
  token: 'fixture-registration-id',
};
const envelope = NotificationEnvelope.parse({
  v: 1,
  count: 1,
  kind: 'message',
  title: '测试角色',
  body: '加密正文金丝雀',
  deepLink: `/chat/${newId()}`,
  conversationId: newId(),
  collapseKey: newId(),
  sound: false,
  sentAt: new Date().toISOString(),
  recipientUserId: newId(),
  recipientSessionId: newId(),
  notificationId: newId(),
});
let base: string;
let reply = { status: 201, body: '' };
const received: { path: string; headers: IncomingHttpHeaders; body: Buffer }[] = [];
const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  received.push({ path: req.url!, headers: req.headers, body: Buffer.concat(chunks) });
  res.writeHead(reply.status, { 'content-type': 'application/json' });
  res.end(reply.body);
});
// 仅测试装配改写网络目标；通道仍生成原厂商地址、真实VAPID与RFC8291密文。
const http: PushHttpPort = {
  async post(input) {
    const response = await fetch(`${base}${input.url.pathname}`, {
      method: 'POST',
      headers: Object.fromEntries(Object.entries(input.headers).map(([k, v]) => [k, String(v)])),
      body: new Uint8Array(Buffer.from(input.body)),
    });
    return { status: response.status, body: await response.text() };
  },
};
let channels: PushChannels;
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture_listen_failed');
  base = `http://127.0.0.1:${address.port}`;
  const path = join(directory, 'credentials.json');
  writeFileSync(
    path,
    JSON.stringify({
      webpush: { ...vapid, subject: 'mailto:test@example.com' },
      jpush: { appKey: 'fixture-key', masterSecret: 'fixture-secret' },
    }),
  );
  channels = new PushChannels(testConfig({ PUSH_CREDENTIALS_FILE: path }), http);
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  rmSync(directory, { recursive: true, force: true });
});
const hmac = (key: Buffer, data: Buffer) => createHmac('sha256', key).update(data).digest();
const expand = (prk: Buffer, info: string | Buffer, size: number) =>
  hmac(prk, Buffer.concat([Buffer.from(info), Buffer.from([1])])).subarray(0, size);

it('真实HTTP收到RFC8291密文；独立解密与VAPID签名验证、稳定Topic及TTL', async () => {
  reply = { status: 201, body: '' };
  channels.validate(subscription);
  expect(await channels.send(subscription, envelope)).toBe('accepted');
  const wire = received.at(-1)!;
  expect(wire.path).toBe('/fcm/send/test-credential');
  expect(wire.headers.ttl).toBe('60');
  expect(wire.headers.topic).toMatch(/^[\w-]{32}$/);
  expect(wire.headers['content-encoding']).toBe('aes128gcm');
  expect(wire.body.includes(Buffer.from(envelope.body))).toBe(false);
  const salt = wire.body.subarray(0, 16);
  expect(wire.body.readUInt32BE(16)).toBeGreaterThan(wire.body.length);
  expect(wire.body[20]).toBe(65);
  const senderPublicKey = wire.body.subarray(21, 86);
  const ikm = expand(
    hmac(auth, client.computeSecret(senderPublicKey)),
    Buffer.concat([Buffer.from('WebPush: info\0'), client.getPublicKey(), senderPublicKey]),
    32,
  );
  const prk = hmac(salt, ikm);
  const decipher = createDecipheriv(
    'aes-128-gcm',
    expand(prk, 'Content-Encoding: aes128gcm\0', 16),
    expand(prk, 'Content-Encoding: nonce\0', 12),
  );
  decipher.setAuthTag(wire.body.subarray(-16));
  const plaintext = Buffer.concat([decipher.update(wire.body.subarray(86, -16)), decipher.final()]);
  expect(plaintext.at(-1)).toBe(2);
  expect(JSON.parse(plaintext.subarray(0, -1).toString())).toEqual(envelope);
  const authorization = String(wire.headers.authorization);
  const jwt = /t=([^,]+)/.exec(authorization)![1]!;
  const parts = jwt.split('.');
  const claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString());
  expect(claims.aud).toBe('https://fcm.googleapis.com');
  expect(claims.sub).toBe('mailto:test@example.com');
  const key = Buffer.from(vapid.publicKey, 'base64url');
  const publicKey = createPublicKey({
    format: 'jwk',
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: key.subarray(1, 33).toString('base64url'),
      y: key.subarray(33).toString('base64url'),
    },
  });
  expect(
    verify(
      'sha256',
      Buffer.from(`${parts[0]}.${parts[1]}`),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(parts[2]!, 'base64url'),
    ),
  ).toBe(true);
  const topic = wire.headers.topic;
  await channels.send(subscription, { ...envelope, body: '第二条' });
  expect(received.at(-1)!.headers.topic).toBe(topic);
});
it('极光真实HTTP认证、受账号/会话约束的extras、通用系统文案与静音', async () => {
  reply = { status: 200, body: '{"sendno":"0","msg_id":"123"}' };
  expect(await channels.send(android, envelope)).toEqual({
    status: 'accepted',
    providerMessageId: '123',
  });
  const wire = received.at(-1)!;
  expect(wire.path).toBe('/v3/push');
  expect(wire.headers.authorization).toBe(
    `Basic ${Buffer.from('fixture-key:fixture-secret').toString('base64')}`,
  );
  const payload = JSON.parse(wire.body.toString());
  expect(payload.audience).toEqual({ registration_id: [android.token] });
  expect(payload.notification.android).toEqual({
    alert: '你有新的微伴消息',
    title: '微伴',
    alert_type: 0,
    extras: { weiban: envelope },
  });
  expect(payload.options).toEqual({ time_to_live: 60 });
  reply = { status: 200, body: '{"msg_id":9223372036854775806}' };
  expect(
    await channels.send(android, envelope, { previousMessageId: '9223372036854775805' }),
  ).toEqual({ status: 'accepted', providerMessageId: '9223372036854775806' });
  expect(received.at(-1)!.body.toString()).toContain('"override_msg_id":9223372036854775805');
  expect(received.at(-1)!.body.toString()).not.toContain('collapse_key');
});
it('404/410和极光1011失效；限额、重定向、损坏回包只重试，不删除凭证', async () => {
  for (const status of [404, 410]) {
    reply = { status, body: '' };
    expect(await channels.send(subscription, envelope)).toBe('invalid_device');
  }
  reply = { status: 400, body: '{"error":{"code":1011}}' };
  expect(await channels.send(android, envelope)).toBe('invalid_device');
  for (const body of ['{"error":{"code":1012}}', 'not-json']) {
    reply = { status: 400, body };
    expect(await channels.send(android, envelope)).toBe('temporary_failure');
  }
  reply = { status: 307, body: '' };
  expect(await channels.send(subscription, envelope)).toBe('temporary_failure');
  const failing = new PushChannels(
    testConfig({ PUSH_CREDENTIALS_FILE: join(directory, 'credentials.json') }),
    {
      post: async () => {
        throw new Error('fixture_timeout');
      },
    },
  );
  expect(await failing.send(subscription, envelope)).toBe('temporary_failure');
  const unavailable = new PushChannels(testConfig(), http);
  expect(await unavailable.send(android, envelope)).toBe('unconfigured');
});
