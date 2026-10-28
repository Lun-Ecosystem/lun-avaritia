import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [{ test: { name: 'server', include: ['server/src/**/*.test.ts'], environment: 'node' } }],
  },
});
