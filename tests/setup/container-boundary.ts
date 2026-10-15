import { vi } from 'vitest'
import { isTestContainer } from '../docker/container-marker.mjs'

// These Node suites inject their own Encryptor; no desktop keychain exists in the runner.
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: () => {
      throw new Error('Inject a test Encryptor instead of using the desktop keychain')
    },
    decryptString: () => {
      throw new Error('Inject a test Encryptor instead of using the desktop keychain')
    }
  }
}))

// Run before importing test modules, including their top-level fixture setup.
if (!isTestContainer()) {
  throw new Error(
    'Filesystem/subprocess tests must run inside the Testcontainers runner. Use npm run test:integration or npm run test:e2e; host execution is refused.'
  )
}
