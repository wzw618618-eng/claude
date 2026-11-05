import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'qingming',
    environment: 'node',
    include: ['assets/**/__tests__/**/*.test.ts'],
  },
});
