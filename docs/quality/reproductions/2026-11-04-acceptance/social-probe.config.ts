import { defineConfig } from 'vitest/config';
import base from './billing-probe.config.js';
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['docs/quality/reproductions/2026-11-04-acceptance/social-probe.test.ts'],
  },
});
