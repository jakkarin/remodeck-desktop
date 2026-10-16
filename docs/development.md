# Development

## Supported setup

The supported desktop development and packaging target is Windows x64. Use Node.js 24 and npm 11;
`.node-version` and `package.json` record these requirements. Install Git for Windows with Git Bash.
SSH hosts run Linux and need their own Git installation. macOS/Linux packaging configurations exist
but are experimental; their presence does not imply tested desktop support.

```bash
npm ci
npm run install:electron
npm run dev
```

`npm ci` uses `package-lock.json`. Dependency installation scripts select node-pty's available
Node-API prebuilt binary. Electron 44 downloads its runtime on first use; `npm run install:electron`
performs that download explicitly before development or CI. CI runs `npm run check:native` inside Electron and
checks that it can open a terminal. The app does not force an additional native source rebuild.
It can need network access for npm packages, Electron and native build assets. If the Electron
download was interrupted, run `npm run install:electron`, then retry.
Installation lifecycle scripts must be enabled. If your npm configuration has `ignore-scripts=true`,
review the dependency scripts and run `npm ci --ignore-scripts=false`; CI explicitly enables them.
Skipping those scripts can leave native modules unprepared even if a TypeScript build succeeds.
If a native module must compile from source on Windows, install Visual Studio Build Tools with the
Desktop development with C++ workload, Spectre-mitigated libraries for the selected toolset and
architecture, and Python supported by node-gyp.

## Git Bash in tests

Some integration tests invoke `bash` by name. Run tests from Git Bash, or ensure Git for Windows'
`bin` directory precedes Windows/WSL's `bash.exe` in your process's PATH. In PowerShell, for the
current session only:

```powershell
$env:PATH = "$env:ProgramFiles\Git\bin;$env:ProgramFiles\Git\usr\bin;$env:PATH"
npm test -- --maxWorkers=4
```

This is also how the Windows CI job selects Git Bash. No change to your global PATH is required.
Tests need permission to launch Git/Bash and listen on loopback ports. A restricted sandbox may
deny those operations even when the app works outside that sandbox.

## Checks and builds

| Command                              | Purpose                                                                            |
| ------------------------------------ | ---------------------------------------------------------------------------------- |
| `npm run lint`                       | Check application and test sources with ESLint; formatting warnings are advisory   |
| `npm run typecheck`                  | Check main/preload and renderer TypeScript                                         |
| `npm test -- --maxWorkers=4`         | Unit, renderer and local integration tests; no real credentials                    |
| `npm run build`                      | Typecheck and build the application bundles and bundled dependency license reports |
| `npm run build:win`                  | Build an unsigned Windows installer in `dist/` without publishing                  |
| `npm run test:e2e -- --maxWorkers=2` | Docker-backed SSH integration tests                                                |

`out/`, `dist/`, local state and scanner reports must not be committed. For a targeted test, append
its path to `npm test --`, for example `npm test -- tests/main/bridge/gitBridge.test.ts`.

Run `npm run check:native` after installation or native dependency changes to verify a real terminal
in the Electron runtime used by the application.

## Dependency security and copied styles

Run `npm audit` against the complete lockfile, including devDependencies: renderer libraries and build
tools live there. CI fails when the audit reports any vulnerabilities.

Electron is on the 44.x line. A scoped npm override supplies `@electron/get` 5.x to `app-builder-lib`
until electron-builder updates its downloader dependency. That release uses native fetch instead of
the vulnerable got/global-agent dependency chain. Builds are validated with a fresh cache. If your
network requires a proxy, set `ELECTRON_GET_USE_PROXY=1` together with the standard
`HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` variables. Proxy support also requires the optional `undici`
dependency, which a normal `npm ci` installs; do not omit optional dependencies for proxy builds.

The app uses copied shadcn/ui components and a pinned copy of the 4.21.4 stylesheet at
`src/renderer/src/assets/shadcn.css`; it does not need the shadcn generator CLI to build or run.
The stylesheet is kept verbatim and is covered by the retained shadcn MIT license. Any future
component-generation tooling should be reviewed separately before adding it to this dependency tree.

## Docker end-to-end tests

On Windows, start Docker Desktop with Linux containers. The tests build
`tests/e2e/sandbox/Dockerfile`, run disposable SSH servers, create temporary SSH keys and use a fake
GitHub HTTP backend. They require network access to pull Debian and install packages, free loopback
ports, and permission to launch SSH. They do not need your production servers or GitHub credentials.

```bash
docker info
npm run test:e2e -- --maxWorkers=2
```

The normal CI job checks Windows unit, renderer and local integration tests. Docker end-to-end tests
are a separate manual release check on Windows. Their temporary SSH HOME setup relies on Git for
Windows; running these fixtures on Linux needs an explicit SSH configuration path before it can
be supported in CI.
Use [the manual checklist](manual-test.md) for application UI and real-host verification.

## Source map

- `src/main/`: Electron main process, SSH/local commands, Git Bridge, GitHub and Docker services.
- `src/main/gitAccess/`: scoped token storage and the optional remote credential installation.
- `src/preload/` and `src/shared/`: the renderer API, IPC contracts and shared types.
- `src/renderer/`: React UI, terminal display and styles.
- `tests/main/`, `tests/renderer/`, `tests/e2e/`: the corresponding automated checks.

Read [design guidelines](design-guidelines.md) for UI changes. Documents in `docs/superpowers/`
record earlier designs and implementation plans; current source, tests and user documentation take
precedence when an older plan differs from implemented behavior.

## Application data

On Windows, application data lives under `%APPDATA%\remodeck`. It can include host/repository
metadata, mirrors, push logs and token ciphertext protected by Electron `safeStorage`. Treat the
entire directory as private; encryption does not make the surrounding metadata safe to publish.
Never attach it wholesale to an issue. Optional remote Git access also writes plaintext tokens on
the selected Linux host; see [SECURITY.md](../SECURITY.md).
