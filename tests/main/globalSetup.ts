import { localPlatform } from '../../src/main/platform/localPlatform'

/**
 * Integration tests run shell scripts that write into their HOME. Stop before any of them run unless Git for
 * Windows' bash is available: another bash (WSL's) ignores the test HOME and writes into a real home directory.
 */
export default function setup(): void {
  if (localPlatform.resolveBash() === null)
    throw new Error(`${localPlatform.bashMissing} (needed by the integration tests)`)
}
