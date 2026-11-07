import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'zongmen',
    environment: 'node',
    include: ['tests/**/*.test.ts', 'assets/**/__tests__/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
