import { defineConfig } from 'vitest/config';
import { createRequire } from 'node:module';
const serverRequire = createRequire(new URL('../../../../apps/server/package.json', import.meta.url));
export default defineConfig({
  resolve: { alias: {
    '@nestjs/testing': serverRequire.resolve('@nestjs/testing'),
    'reflect-metadata': serverRequire.resolve('reflect-metadata'),
  } },
  test: {
    include: ['docs/quality/reproductions/2026-11-04-acceptance/billing-probe.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    reporters: ['verbose'],
  },
});
