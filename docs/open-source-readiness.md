# Secret and dependency audit

How to check this repository for leaked secrets and review its dependencies before publishing source
or an installer. CI runs a full `npm audit` on every push and pull request, and GitHub secret scanning
with push protection guards new pushes. The steps below are a deeper manual check, for example before
a release.

## Secret scan

GitHub secret scanning covers supported token formats. For a broader manual audit, install
[Gitleaks](https://github.com/gitleaks/gitleaks) from its official release, verify the archive against
the release checksum file, then fetch every ref and scan history, reflogs and commit metadata:

```bash
git fetch origin --tags '+refs/heads/*:refs/remotes/origin/*' '+refs/pull/*/head:refs/remotes/origin/pull/*'
gitleaks git . --log-opts='--all --reflog --full-history --diff-merges=separate' --redact=100 --no-banner
git log --all --reflog --format=fuller | gitleaks stdin --redact=100 --no-banner
```

Also scan the files that would be committed. Copy the output of
`git ls-files --cached --others --exclude-standard` to a temporary snapshot directory (without `.git`,
dependencies, build output or ignored local state) and run
`gitleaks dir <snapshot> --redact=100 --no-banner`. Keep raw scanner output out of tracked files;
`gitleaks*.json` and `gitleaks*.sarif` are ignored for this reason.

A finding needs manual review. A clean result is not proof that no secrets or private data exist:
the scan does not cover GitHub Actions logs/artifacts, issues, external forks or clones, deleted remote
refs or unreachable Git objects, and it does not recognise every kind of private information such as
internal hostnames or screenshots. It is not a penetration test.

If a real credential is found, revoke or rotate it first, then decide whether history cleanup is needed.

## Dependency and asset review

The project is MIT licensed; dependencies keep their upstream licenses, recorded in
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). Before an installer release:

- Run `npm audit` against the release lockfile and triage every finding rather than forcing upgrades.
  Renderer libraries listed under devDependencies are bundled into the app, so they count too.
- Check new dependencies' license metadata. Some older packages (`buildcheck`, `cpu-features`,
  `ssh2`) use the legacy `licenses` field instead of `license`; their bundled license files declare MIT.
- Inspect the packaged output, not just the dependency graph: the installer should contain the
  root license, third-party notices, `licenses/`, the generated `THIRD_PARTY_LICENSES.md` reports and
  Electron's own license files.
- When updating the copied shadcn stylesheet, record its new source version and SHA-256 in the notices.

The npm override that pins `app-builder-lib`'s `@electron/get` to 5.x removes a vulnerable downloader
chain from electron-builder. Re-check it whenever electron-builder is upgraded; drop it once
electron-builder depends on a fixed version itself.
