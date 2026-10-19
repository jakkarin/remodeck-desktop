# Changelog

User-facing release notes will be recorded here. The package version alone does not indicate that
a public release or installer has been published.

## Unreleased

## 0.1.0 - 2026-10-19

First pre-release. Installers for Windows, macOS and Linux are unsigned, and the macOS build is not
notarized.

- Build Windows (`-setup.exe`), macOS (`.dmg`, `.zip`) and Linux (`.AppImage`, `.deb`) installers
  when a GitHub release is published, and attach them with `SHA256SUMS.txt`.
- Support the local host on Linux and macOS using the system bash.
- Run lint, type checks and tests on Linux in CI.
- Upgrade Electron from 39.8.10 to 44.8.0 and migrate clipboard image paste to its asynchronous API.
- Resolve the 18 dependency advisory entries, preserve shadcn styles as copied MIT source, and gate CI on a full dependency audit.
- Add explicit Electron runtime installation and clipboard regression tests for the upgraded runtime.
- Adopt the MIT License and preserve third-party license notices.
- Document development, contribution, security boundaries and release preparation.
- Delay new dependency versions by seven days in npm to reduce supply-chain risk.
- Add CI for Windows lint, type checks, tests and unsigned installer builds.

Current functionality includes local and SSH Git workspaces, Git Bridge push approvals, optional
scoped token installation on remote hosts, and local/remote Docker management.
