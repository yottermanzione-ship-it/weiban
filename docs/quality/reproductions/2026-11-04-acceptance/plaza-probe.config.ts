import base from './billing-probe.config.js';
export default {
  ...base,
  test: {
    ...base.test,
    include: ['docs/quality/reproductions/2026-11-04-acceptance/plaza-probe.test.ts'],
  },
};
