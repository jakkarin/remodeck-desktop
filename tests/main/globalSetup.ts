import { BASH_MISSING, resolveBashPath } from '../../src/main/proc/bashPath'

/**
 * Integration tests run shell scripts that write into their HOME. Stop before any of them run unless Git for
 * Windows' bash is available: another bash (WSL's) ignores the test HOME and writes into a real home directory.
 */
export default function setup(): void {
  if (resolveBashPath() === null) throw new Error(`${BASH_MISSING} (needed by the integration tests)`)
}
