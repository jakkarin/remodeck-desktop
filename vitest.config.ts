import { defineConfig } from 'vitest/config'

const include = (globs: string[]) => globs.flatMap((g) => [`${g}.test.ts`, `${g}.test.tsx`])

export default defineConfig({
  test: {
    testTimeout: 30000,
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/smoke.test.ts', ...include(['tests/main/**/*'])],
          testTimeout: 30000
        }
      },
      {
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: include(['tests/renderer/**/*']),
          testTimeout: 30000
        }
      }
    ]
  }
})
