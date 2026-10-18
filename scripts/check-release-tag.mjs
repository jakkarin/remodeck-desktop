import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// A release tag must be `v` + the package.json version, so installers carry the version they are filed under.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- plain JS, returns string | null
export function releaseTagError(tag, version) {
  if (!tag) return 'No release tag was given (set TAG)'
  const expected = `v${version}`
  return tag === expected ? null : `Release tag ${tag} does not match package.json ${expected}`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const packageJson = new URL('../package.json', import.meta.url)
  const { version } = JSON.parse(readFileSync(packageJson, 'utf8'))
  const error = releaseTagError(process.env.TAG, version)
  if (error) {
    console.log(`::error::${error}`)
    process.exit(1)
  }
  console.log(`Release tag ${process.env.TAG} matches package.json`)
}
