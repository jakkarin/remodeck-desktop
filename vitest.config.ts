import { resolve } from 'path'
import { configDefaults, defineConfig } from 'vitest/config'
import { INTEGRATION_TEST_FILES } from './tests/docker/integration-files'

const include = (globs: string[]): string[] =>
  globs.flatMap((g) => [`${g}.test.ts`, `${g}.test.tsx`])

export default defineConfig({
  test: {
    testTimeout: 30000,
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'tests/smoke.test.ts',
            ...include(['tests/main/**/*']),
            'tests/docker/**/*.test.ts'
          ],
          // Extend, not replace, Vitest's default excludes (node_modules, dist, …).
          exclude: [...configDefaults.exclude, ...INTEGRATION_TEST_FILES],
          setupFiles: ['tests/setup/host-process-guard.ts'],
          testTimeout: 30000
        }
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: [...INTEGRATION_TEST_FILES],
          setupFiles: ['tests/setup/container-boundary.ts'],
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
          setupFiles: ['tests/setup/host-process-guard.ts', 'tests/renderer/setup.ts'],
          testTimeout: 30000
        }
      }
    ]
  }
})
