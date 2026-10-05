import { defineConfig } from 'vitest/config'

// Needs Docker. Run with `npm run test:e2e`; not part of `npm test`.
export default defineConfig({
  test: {
    name: 'e2e',
    environment: 'node',
    include: ['tests/e2e/**/*.e2e.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 900_000
  }
})
