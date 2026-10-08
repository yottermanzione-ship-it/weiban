import type { INestApplication } from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import {
  AdminCharacter,
  AdminCharacterWrite,
  AuthResponse,
  CharacterCard,
} from '@weiban/contracts';
import { createApp } from '../../src/main.js';
import { IdentityCommands } from '../../src/modules/identity/index.js';
import { PriceService } from '../../src/modules/billing/testing.js';
import { CatalogService, UpstreamService } from '../../src/modules/model-access/testing.js';
import { captureLogger, testConfig, testKekRing } from './fixtures.js';

export const FLOW_MODEL = 'flow/real-assembly';
export const FLOW_KEY = 'sk-weiban-canary-flow-upstream-479302';
export const FLOW_INPUT = '首条消息FLOW-479302：今天想聊聊我的第一天。';
export const FLOW_REPLY = '看见你的首条消息啦，FLOW-479302，我们慢慢聊。';
export const FLOW_GREETING = '你好呀，欢迎来聊天。';
export const FLOW_DEVICE = {
  platform: 'web' as const,
  name: 'real assembly flow',
  appVersion: '0.1.0',
  timeZone: 'Asia/Shanghai',
};
type UpstreamBody = { model: string; messages: { role: string; content: string }[] };
export class FlowUpstream {
  readonly calls: { body: UpstreamBody; authorization: string | undefined }[] = [];
  readonly server: Server;
  constructor() {
    this.server = createServer(async (req, res) => {
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"data":[]}');
        return;
      }
      if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
        res.writeHead(404).end();
        return;
      }
      let raw = '';
      for await (const part of req) raw += part.toString();
      const body = JSON.parse(raw) as UpstreamBody;
      this.calls.push({ body, authorization: req.headers.authorization });
      const system = body.messages[0]?.content ?? '';
      const content = system.startsWith('你是严格的角色上架评测器')
        ? JSON.stringify({
            childFeaturesDetected: false,
            personaStabilityPassed: true,
            hardBoundaryCasesPassed: true,
          })
        : body.messages.some((m) => m.role === 'user' && m.content === FLOW_INPUT)
          ? FLOW_REPLY
          : FLOW_GREETING;
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { content } }],
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        }),
      );
    });
  }
  async start(): Promise<string> {
    await new Promise<void>((done) => this.server.listen(0, '127.0.0.1', done));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/v1`;
  }
  async close(): Promise<void> {
    await new Promise<void>((done, reject) =>
      this.server.close((err) => (err ? reject(err) : done())),
    );
  }
}

export async function startFlowApp() {
  const upstream = new FlowUpstream();
  const url = await upstream.start();
  const logs = captureLogger();
  let app: INestApplication | undefined;
  try {
    app = await createApp({
      config: testConfig({ APP_ROLE: 'all' }),
      logger: logs.logger,
      kekRing: testKekRing().ring,
      // SystemClock and background workers are the production defaults.
    });
    await app.listen(0, '127.0.0.1');
    const adminId = await app
      .get(IdentityCommands)
      .createAdmin('flow_admin', 'correct horse battery');
    await configureFlowModel(app, adminId, url);
    const adminToken = AuthResponse.parse(
      (
        await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({
            username: 'flow_admin',
            password: 'correct horse battery',
            kind: 'admin',
            device: FLOW_DEVICE,
          })
          .expect(200)
      ).body,
    ).session.token;
    const character = await createFlowCharacter(app, adminToken);
    return { app, upstream, logs, adminId, adminToken, character };
  } catch (error) {
    await app?.close();
    await upstream.close();
    throw error;
  }
}
async function configureFlowModel(app: INestApplication, adminId: string, url: string) {
  const upstream = await app.get(UpstreamService).create(adminId, {
    name: 'Flow HTTP upstream',
    kind: 'openai_compatible',
    baseUrl: url,
    apiKey: FLOW_KEY,
  });
  const prices = app.get(PriceService);
  const draft = await prices.createDraft(adminId, {
    versionLabel: 'flow',
    note: null,
    items: [
      {
        modelKey: FLOW_MODEL,
        unit: 'input_tokens_per_million',
        priceMicros: 2_000_000,
        costMicros: 1_000_000,
        band: null,
      },
      {
        modelKey: FLOW_MODEL,
        unit: 'output_tokens_per_million',
        priceMicros: 8_000_000,
        costMicros: 4_000_000,
        band: null,
      },
    ],
  });
  await prices.activate(adminId, draft.priceVersionId, null);
  await app.get(CatalogService).upsert(adminId, FLOW_MODEL, {
    modelKey: FLOW_MODEL,
    displayName: 'Flow',
    vendorName: 'HTTP fixture',
    upstreamId: upstream.upstreamId,
    upstreamModelId: 'flow-http',
    capabilities: [],
    tags: [],
    leaderboardRank: null,
    sortOrder: 0,
    defaultFor: ['chat'],
    enabled: true,
  });
}
async function createFlowCharacter(app: INestApplication, token: string) {
  const sample = JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, '../../../../docs/ai/samples/S-01-cheng-che.md'),
      'utf8',
    ).match(/```json\s*([\s\S]*?)```/)![1]!,
  ) as { card: unknown };
  const body = AdminCharacterWrite.parse({
    name: '整链路角色',
    tagline: '真实工作者回复',
    intro: '原创成年角色',
    categoryId: 'original',
    avatar: {
      imageMediaId: null,
      display: { supportColors: [], avatarText: null, avatarPattern: 'star', themeColor: null },
    },
    birthday: '2000-01-02',
    fanName: null,
    classification: {
      basis: 'original',
      realPersonKind: null,
      ageSetting: 'adult',
      childAppearance: false,
    },
    fallbackGreetings: ['备用开场，不是模型生成证明'],
    card: CharacterCard.parse(sample.card),
  });
  return AdminCharacter.parse(
    (
      await request(app.getHttpServer())
        .post('/api/v1/admin/characters')
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(201)
    ).body,
  );
}
