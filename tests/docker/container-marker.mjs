/* eslint-disable @typescript-eslint/explicit-function-return-type -- Executed by Node without a TypeScript loader. */
import { readFileSync } from 'node:fs'

// Written by tests/docker/Dockerfile; keep both in sync.
const MARKER_PATH = '/etc/remodeck-test-container'
const MARKER = 'remodeck-integration-v1\n'

/** True only inside the disposable runner image; a Linux host without the marker is refused. */
export function isTestContainer() {
  if (process.platform !== 'linux') return false
  try {
    return readFileSync(MARKER_PATH, 'utf8') === MARKER
  } catch {
    return false
  }
}
