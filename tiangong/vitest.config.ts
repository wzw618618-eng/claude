import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'hanyi',
    environment: 'node',
    include: ['assets/**/__tests__/**/*.test.ts'],
  },
});
