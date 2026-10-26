import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'admin',
    include: ['src/**/*.test.ts'],
  },
});
