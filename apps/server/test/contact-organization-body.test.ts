import 'reflect-metadata';
import { Body, Controller, Module, Put, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { configureHttpApp } from '../src/main.js';
import { testConfig } from './support/fixtures.js';

@Controller()
class BodyFixture {
  @Put('api/v1/contacts/organization')
  receive(@Body() body: { value: string }) {
    return { length: body.value.length };
  }
}
@Module({ controllers: [BodyFixture] })
class FixtureModule {}

let app: INestApplication;
beforeAll(async () => {
  const module = await Test.createTestingModule({ imports: [FixtureModule] }).compile();
  app = module.createNestApplication({ logger: false });
  configureHttpApp(app, testConfig());
  await app.init();
});
afterAll(async () => {
  await app?.close();
});

it('only the exact organization PUT accepts a bounded complete list above the ordinary limit', async () => {
  const body = { value: 'x'.repeat(150 * 1024) };
  const http = request(app.getHttpServer());
  expect((await http.put('/api/v1/contacts/organization').send(body).expect(200)).body.length).toBe(
    body.value.length,
  );
  await http.post('/api/v1/contacts/organization').send(body).expect(413);
  await http.put('/api/v1/contacts/organization/other').send(body).expect(413);
  await http.put('/api/v1/contacts/other').send(body).expect(413);
});

it('the special route still rejects bodies exceeding its finite limit', async () => {
  await request(app.getHttpServer())
    .put('/api/v1/contacts/organization')
    .send({ value: 'x'.repeat(8 * 1024 * 1024) })
    .expect(413);
});
