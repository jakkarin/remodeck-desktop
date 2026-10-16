# Release checklist

Preparing source, publishing a GitHub release and changing repository visibility are separate actions.
The CI workflow uploads a short-lived test installer as a workflow artifact; it never publishes a
release or changes visibility. Windows installers produced here are unsigned.

## Before making the repository public

- Confirm the right to release project code and artwork under MIT. Check any employer/client agreements
  and preserve the licenses of copied code, fonts and other assets.
- Re-run a complete secret scan after fetching all branches, tags and pull request heads; follow
  [the audit procedure](open-source-readiness.md). Scan the final working tree as well.
- Review commit author metadata, historical screenshots, internal hostnames and documents for information
  you do not intend to publish. A secret scanner does not identify all private information.
- If a real credential is found, revoke/rotate it first, then coordinate any history cleanup. Do not
  assume deleting a file from the current branch removes it from older commits or other clones.
- Confirm README installation steps and supported platforms against a fresh Windows clone.
- Review `SECURITY.md`, and enable GitHub private vulnerability reporting
  when the repository becomes public. No contact email is currently designated. GitHub currently offers
  that reporting feature for public repositories.
- Enable available GitHub secret scanning/push protection. Protect `main` with pull request review
  and required CI checks after the workflow has run and check names are available in GitHub.
- Change visibility only after an explicit decision by the repository owner. This preparation does
  not authorize that change.

## Before publishing an installer

```bash
npm ci
npm run install:electron
npm run check:native
npm run lint
npm run typecheck
npm test -- --maxWorkers=4
npm run build:win
npm audit
```

Run Docker end-to-end tests with a working Docker Engine and complete the relevant
[manual checks](manual-test.md). Review the dependency audit, including renderer libraries listed
under devDependencies because they are bundled into the application. Triage findings rather than
running a forceful dependency upgrade without reviewing compatibility.

Confirm that the installer contains the project MIT license, third-party notices, bundled dependency
license reports, font licenses and Electron's own license notices. Install on a clean Windows
machine and test launch, local repositories, SSH connection, push approval, token opt-in/removal and
uninstall. Do not test destructive operations against production resources.

Update the package version and lockfile together, move the relevant `CHANGELOG.md` entries to a
dated version, and write release notes describing supported platforms, limitations, signing status
and migration steps. Calculate SHA-256 checksums for the exact installer being released. The CI
artifact is suitable for testing; it is not a published release.

Code signing requires a separately managed certificate or signing service. Keep its credentials
in GitHub environment/repository secrets, never in this repository. Add release publishing only when
the owner explicitly authorizes it; `npm run build:win` intentionally uses `--publish never`.
