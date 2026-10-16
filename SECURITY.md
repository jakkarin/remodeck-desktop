# Security policy

remodeck handles SSH sessions, GitHub credentials and commands that can modify repositories and
Docker resources. It is in early development. Security fixes target the current `main` branch;
older commits and installers have no guaranteed backport or response schedule.

## Report a vulnerability privately

Use GitHub private vulnerability reporting:
[Report a vulnerability](https://github.com/jakkarin/remodeck-desktop/security/advisories/new).
Do not post vulnerability details in a public issue, discussion or pull request. If the reporting
button is unavailable, open an issue asking for a private contact channel without including any
exploit details.

Include the affected commit/version, platform, prerequisites, expected impact and minimal reproduction
using fake credentials and disposable resources. Do not send production tokens, private keys or a full
copy of your application data. Do not disclose an unpatched vulnerability in a public issue or pull request.
The maintainer will investigate and coordinate a fix and disclosure on a best-effort basis.

For ordinary bugs and feature requests, use the issue templates instead.

## Credential and trust boundaries

- **Default Git Bridge mode:** GitHub credentials are obtained and used on the Windows computer.
  Remote terminals use an SSH-forwarded loopback Git Bridge; the bridge injects the GitHub credential
  on Windows. The GitHub token is not installed on the remote Linux host in this mode.
- **Push approval:** fetch/pull through the bridge needs no approval. Push requires the host-side
  approval policy; protected-branch and ref-deletion rules apply when enabled. These rules cover
  remodeck's bridge/review flows, not arbitrary Git processes with their own credentials.
- **Optional remote Git access:** enabling **Git access on this host** installs selected tokens as
  plaintext on that Linux host. Processes running as the same user can read and use them without
  bridge push approval. Limit token scope, repository access and expiry; enforce remote GitHub rulesets
  independently. Removing the installation deletes its managed files but does not revoke an exposed
  token at GitHub. Rotate or revoke credentials at the provider when necessary.
- **Shared Linux users:** other processes running as the terminal's Linux user can inspect its
  environment and use its forwarded bridge while it is open. People sharing that user also share
  the optional token installation. Use separate Linux accounts when separate trust is required.
- **This computer:** it is your Windows host, not an isolated sandbox. Programs running as your user
  may already access Git Credential Manager. Push approval covers terminals opened by remodeck and
  remodeck's own push flows, not every process on Windows.
- **Local persistence:** optional token secrets are encrypted through Electron `safeStorage` and
  stored under `%APPDATA%\remodeck`; host paths, repository metadata, mirrors and push logs are also
  private. Do not publish or attach that directory to an issue. Encryption at rest is not protection
  from arbitrary code running as your logged-in user.

## Application limits

The renderer uses context isolation and a preload API, but Electron renderer process sandboxing is
currently disabled (`sandbox: false` in `src/main/index.ts`). Packaged content is loaded locally and
navigation is restricted. These settings are not a claim that malicious repositories, compromised
hosts or hostile renderer content are harmless. Security-sensitive changes should review IPC sender
validation, shell argument handling, untrusted content rendering and Electron's current security guidance.

remodeck can run commands and destructive Docker operations with the permissions of the selected
account. Confirm the host and scope before approving an operation. Windows artifacts produced by
CI are unsigned and have not undergone an independent security assessment. CI fails on any
`npm audit` finding; repeat the audit for each release as described in
[the release checklist](docs/releasing.md).

## Secret handling in this repository

Keep credentials and application state out of Git, including historical commits, fixtures, logs and
screenshots. GitHub secret scanning and push protection guard new pushes.
For a manual history scan and its limitations, see [docs/open-source-readiness.md](docs/open-source-readiness.md).

If a real secret is committed, revoke/rotate it first, assess its access and coordinate any history
cleanup with the maintainer. Deleting a file or making a repository private does not invalidate
existing credentials or remove other copies.
