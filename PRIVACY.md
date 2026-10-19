# Privacy policy

[ภาษาไทย](PRIVACY.th.md)

Last updated: 2026-10-19

remodeck is a desktop app that runs on your computer. The project has no server and does not
collect, receive or sell your data. The app has no analytics, telemetry, crash reporting, ads or
automatic update checks.

## Data stored on your computer

remodeck keeps its data in the `remodeck` folder under your user application data directory
(`%APPDATA%\remodeck` on Windows, `~/Library/Application Support/remodeck` on macOS and
`~/.config/remodeck` on Linux):

- **Settings** (`config.json`): hosts, host paths, repository metadata and approval rules.
- **Push log** (`push-log.jsonl`): records of push approvals and pushes made through remodeck.
- **Token secrets** (`secrets.json`): GitHub tokens you add in Settings, encrypted with Electron
  `safeStorage`. Encryption at rest does not protect them from other programs running as your user.
- **Repository mirrors** used by the Git Bridge.

This data stays on your computer until you delete it. Uninstalling the app may not remove this
folder; delete it yourself to remove all remodeck data. Do not attach it to issues, as it may
contain private information.

## Connections the app makes

remodeck connects only to services you use through it:

- **GitHub** (`github.com`, `api.github.com`): to list your repositories, check token access and
  run Git operations. These requests use your own credentials, from Git Credential Manager or a
  token you added. GitHub's [privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement)
  applies to that data.
- **SSH hosts you configure**: remodeck runs terminals, Git and Docker commands on them with the
  account you choose.
- **Links you open**: some actions, such as comparing branches, open a page in your web browser.

If you enable **Git access on this host**, the selected tokens are copied to that Linux host as
plaintext files. See [SECURITY.md](SECURITY.md) for the risks and how to remove them.

## Reporting issues

GitHub issues and pull requests are public. Do not include tokens, private keys, host names or
application data you do not want published. Report security problems privately as described in
[SECURITY.md](SECURITY.md).

## Changes

Changes to this policy are made in this file and recorded in the repository history.
Questions can be asked in [GitHub issues](https://github.com/jakkarin/remodeck-desktop/issues).
