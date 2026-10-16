# Contributing to remodeck

Issues and pull requests in English or Thai are welcome. remodeck is in early development, and
maintenance is best effort. Discuss substantial changes in an issue before implementing them so
the intended behavior and security boundary can be agreed on.

## Set up

Use Windows x64, Git for Windows, Node.js 24 and npm 11. Follow
[the development guide](docs/development.md), including `npm ci` and `npm run install:electron`, then
run `npm run dev`.
The normal test suite uses local fixtures; it does not need a real GitHub token or SSH server.
Docker end-to-end tests have separate requirements and are not part of `npm test`.

Fork the repository and create a branch for your change. Keep pull requests focused and include a
description of the problem, resulting behavior and validation performed.

## Before opening a pull request

```bash
npm run lint
npm audit
npm run typecheck
npm test -- --maxWorkers=4
npm run build
```

Format only the files you changed with `npx prettier --write <files>`. The existing repository has
formatting warnings; avoid unrelated formatting churn. Add meaningful regression coverage for
behavior changes. Documentation-only changes can be checked by reviewing links, examples and formatting.
For packaging changes, also run `npm run build:win`. For SSH, credential helper or bridge changes,
run the relevant Docker tests and [manual checks](docs/manual-test.md) when those facilities are available.
State any checks you could not run and why.

Preserve the distinction between Git Bridge mode and optional token installation on a remote host.
Review untrusted repository content, IPC inputs, command arguments and credential handling carefully.
Do not include real tokens, private keys, host configuration, application state, or unredacted logs
and screenshots in commits or issues. Use unmistakably fake test credentials and disposable repositories.

## Reporting bugs and proposing features

Include the Windows/app version, relevant Git/SSH/Docker versions, exact steps, expected and actual
behavior, and sanitized logs. Explain the use case for a feature, especially when it changes permissions
or destructive actions. Follow [SECURITY.md](SECURITY.md) for suspected vulnerabilities; do not disclose
them in public issues.

## Licensing and attribution

By submitting a contribution, you confirm you have the right to submit it under this project's
[MIT License](LICENSE). Preserve third-party copyright and license notices. Describe the source and
license of copied code, icons, fonts or other assets in your pull request and update
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) when needed. No contributor license agreement or
mandatory commit sign-off is currently required.

Follow the [Code of Conduct](CODE_OF_CONDUCT.md) in project discussions.
