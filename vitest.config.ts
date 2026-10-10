import { resolve } from 'path'
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
        esbuild: { jsx: 'automatic' },
        resolve: { alias: { '@renderer': resolve('src/renderer/src') } },
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: include(['tests/renderer/**/*']),
          setupFiles: ['tests/renderer/setup.ts'],
          testTimeout: 30000
        }
      }
    ]
  }
})
