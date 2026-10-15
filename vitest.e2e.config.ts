import { defineConfig } from 'vitest/config'

// The Testcontainers runner provisions isolated SSH fixtures; direct host execution is refused.
export default defineConfig({
  test: {
    name: 'e2e',
    environment: 'node',
    include: ['tests/e2e/**/*.e2e.test.ts'],
    setupFiles: ['tests/setup/container-boundary.ts'],
    testTimeout: 120_000,
    hookTimeout: 900_000
  }
})
