# remodeck

**Git & Docker on your servers, over SSH.**

English | [ภาษาไทย](README.th.md)

Desktop app (Windows, Electron + TypeScript) for managing Git repositories and Docker on this computer
and remote Linux hosts over SSH. In the default **Git Bridge** mode, GitHub credentials stay on your
Windows computer; the remote host needs no direct connection to GitHub. An optional **Git access on
this host** mode installs scoped tokens on a remote host; see the security boundary below.

**Status:** early development. Windows x64 is the supported development and packaging target.
macOS/Linux packaging scripts are experimental and are not validated in CI (the Linux job runs checks and tests, not packaging).
Try it with disposable repositories and hosts before using it with important work.

## Quick start

For local repositories, install Node.js 24 and, on Windows, Git for Windows (Linux and macOS use the
system bash), then run:

```bash
git clone https://github.com/jakkarin/remodeck-desktop.git
cd remodeck-desktop
npm ci
npm run install:electron
npm run dev
```

Select **This computer** to add an existing repository or clone one. For a remote repository, first
configure an SSH alias, then add that host in remodeck. GitHub operations use your Windows Git Credential
Manager login.

## Prerequisites

- **Windows x64** with **Git for Windows**, including Git Bash, and **Node.js 24 / npm 11**
  (`.node-version` records the Node major used in CI). Experimental on Linux and macOS: `bash` and `git`
  instead of Git for Windows.
- For remote hosts: an SSH alias in `~/.ssh/config` so that `ssh <alias>` works from Windows (key loaded in ssh-agent).
- `git` installed on Windows and each remote host.
- GitHub login on Windows through Git Credential Manager:
  ```
  git credential-manager github login
  ```
- Optional: Docker Desktop using Linux containers for local container management and Docker-based tests;
  Docker Engine on a remote host for its containers. The Builds view also needs Docker Buildx with history support.

## Run

```bash
npm ci          # use the committed lockfile
npm run install:electron # download the Electron runtime (or reuse it if installed)

npm run dev      # start the app (dev build)
npm run lint     # ESLint (existing formatting warnings are advisory)
npm run typecheck
npm test         # unit + integration tests (Vitest)
npm run build    # typecheck and build application bundles
npm run build:win # create an unsigned Windows installer in dist/; never publishes
```

See [development setup and troubleshooting](docs/development.md) for Git Bash setup and Docker tests.
CI checks lint, types and tests on Windows and Linux, plus the dependency audit and the Windows installer.
Docker end-to-end tests run separately on the supported Windows setup with an active Docker Engine.

Manual end-to-end checklist: [docs/manual-test.md](docs/manual-test.md).

UI tokens and reusable component usage: [Neutral design guidelines](docs/design-guidelines.md).

## This computer

The host list always starts with **This computer**, and the app opens on it every time. It manages repos on
this machine with no SSH: Clone, Add existing, Sync, Review, Push and PR work as on any host. Terminals open
bash in the repo, and `git push` from them still goes through the Git Bridge and the approval popup.
Containers use Docker on this machine.

- On **Windows** it requires **Git for Windows** (its `bash.exe`; WSL's bash is never used), and paths look like
  `D:/projects/app` or `D:\projects\app`. Without Git for Windows, Connect shows how to install it.
- On **Linux and macOS** (experimental) it uses `/bin/bash`, or else the first `bash` on `PATH`, and paths look like
  `~/projects/app` or `/home/me/projects/app`. Path comparison is case-sensitive on Linux and not on macOS.
- Containers require Docker Desktop (or another local Docker engine).
- This computer is not a sandbox: anything running here can already use your Git Credential Manager login.
  The approval popup only covers pushes from terminals that remodeck opens. _Git access on this host_ is
  not offered here, and This computer cannot be removed.

## Docker builds

In the Containers module, **Builds** lists the current Buildx builder's history on the selected SSH
host: name, build ID, status, creation time and duration. **Refresh** reloads the history. The host
needs Docker Buildx and a BuildKit version that supports `docker buildx history ls`; unsupported
hosts show the command error with an upgrade hint.

**Prune build cache** opens and focuses a terminal tab running `docker buildx prune --force` on that
host after confirmation (protected hosts require typing the host name). The terminal dock expands
if collapsed, and displays progress, errors and the reclaimed space directly. It removes unused
cache of the current builder. This action does not delete build history records, containers or volumes; later
builds may take longer while rebuilding the cache.

**Prune** in Images, Volumes and Networks also opens a terminal on the selected host. The list
refreshes when that terminal command ends. Each command keeps Docker's default prune scope;
volumes always require typing the host name, and protected hosts require it for images and networks too.

## Security boundary

- In the default Git Bridge mode, the GitHub token stays on Windows. Terminals opened from the app reach GitHub through the
  local **Git Bridge** (`127.0.0.1`, via an ssh remote forward) which injects the credential on the host.
- Fetch/pull through the bridge needs no approval; every push needs approval in a popup on the host
  (Allow once / for this session / always for this repo / Deny; no answer in 60 s = Deny).
- Fixed rules on the host (apply even with "always allow"; can be turned off per repo in Settings):
  no ref deletion, no pushes to protected branches (default `main`, `master`).
- The bridge cannot detect force pushes on unprotected branches; the popup shows `old → new` so you decide.
- Session isolation is a **soft boundary**: if the AI runs as the same Linux user as the app's terminal,
  other processes of that user can read its environment and use the forwarded port while the terminal
  is open. The real gates are the approval popup and the fixed rules on the host, which the sandbox
  cannot touch.
- Optional, per host and off by default: **Git access on this host** (Host settings) writes your scoped
  tokens in plain text on that host so agents there can use `git` and `gh` directly. Anything running as
  that user can read them. Terminals opened from remodeck keep using the Git Bridge and push approval, but
  bridge rules do not apply to agents pushing directly, so protection relies on each token's scope and
  expiry and on GitHub rulesets. Remove from host deletes every file again. Inside remodeck terminals,
  `gh` resolves the repo from the configured `origin` URL, not from the Git Bridge rewrite of it.
  Only if you tick it at install time, remodeck also puts `~/.local/bin` first in `PATH` from a marked
  block at the top of `~/.bashrc` (never a symlinked one); Remove from host deletes that block too.
  When another credential helper (such as `gh auth setup-git`) is configured, you can tick an option to have
  remodeck's helper asked first; the other helpers stay as fallback for repos without a remodeck token.
  It only changes remodeck's own included file and moves its `include.path` line to the end of your global git config.
  People who log in to the host as the same Linux user share one install. They can read and use each other's tokens,
  Install or Update host from another person's remodeck replaces the tokens there with their own selection, and their
  Remove from host deletes everything. Give each person their own Linux user to keep tokens apart.
- Every push (bridge or Review) is logged to `push-log.jsonl`.
- In the default bridge flow, nothing is written to the repo's working tree or commits; in the sandbox the app
  does `git init`, sets `remote origin`, and updates `refs/remotes/origin/*` and tags. Removing a
  workspace in the app never deletes anything in the sandbox.

Read [SECURITY.md](SECURITY.md) for the threat model, known limits and vulnerability reporting.

## Contributing and project information

- [Contributing](CONTRIBUTING.md): setup, checks, issues and pull requests. English and Thai are welcome.
- [Privacy policy](PRIVACY.md): no telemetry; what the app stores and connects to.
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Changelog](CHANGELOG.md)
- [Release checklist](docs/releasing.md)
- [Secret and dependency audit](docs/open-source-readiness.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

Project code is available under the [MIT License](LICENSE). Third-party code, fonts and icons keep
their respective licenses; see the notices above.
