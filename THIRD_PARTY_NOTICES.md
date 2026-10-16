# Third-party notices

The root [MIT License](LICENSE) applies to remodeck's project code. Third-party software and assets
retain their own copyright and license terms; they are not relicensed by the root license.

## Copied source and bundled assets

| Material                                                                         | Source                                                                                         | License and retained text                                                 |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| shadcn/ui components in `src/renderer/src/components/ui/` and CSS                | [shadcn-ui/ui](https://github.com/shadcn-ui/ui)                                                | MIT, copyright 2023 shadcn; [license](licenses/shadcn-MIT.txt)            |
| Geist variable fonts                                                             | [Geist](https://github.com/vercel/geist-font), installed via `@fontsource-variable/geist`      | SIL Open Font License 1.1; [license](licenses/geist-OFL-1.1.txt)          |
| Geist Mono variable fonts                                                        | [Geist](https://github.com/vercel/geist-font), installed via `@fontsource-variable/geist-mono` | SIL Open Font License 1.1; [license](licenses/geist-mono-OFL-1.1.txt)     |
| Lucide icons, including upstream Feather-derived icons identified in the license | [Lucide](https://github.com/lucide-icons/lucide)                                               | ISC and retained upstream notices; [license](licenses/lucide-LICENSE.txt) |
| Class Variance Authority used by UI components                                   | [CVA](https://github.com/joe-bell/cva)                                                         | Apache-2.0; [license](licenses/class-variance-authority-Apache-2.0.txt)   |

Additional CSS-only assets retain their full notices separately because they are not included in
the generated JavaScript dependency report:

- [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss): MIT, [license](licenses/tailwindcss-MIT.txt).
- [tw-animate-css](https://github.com/Wombosvideo/tw-animate-css): MIT, [license](licenses/tw-animate-css-MIT.txt).

The `react-remove-scroll-bar` **2.3.8** package declares MIT but omits a license file, so the generated
report has an empty license-text section for it. A supplemental [MIT notice](licenses/react-remove-scroll-bar-MIT.txt)
is retained from the author's upstream repository at
[revision 8ca9ba5](https://github.com/theKashey/react-remove-scroll-bar/blob/8ca9ba5ea52de03308fe8ced94f7b159a44d28ff/LICENSE).
The npm `gitHead` for 2.3.8 could not be resolved in that upstream repository; the retained notice
is identified as a supplemental upstream notice rather than claimed to come from that missing revision.

The shadcn stylesheet at `src/renderer/src/assets/shadcn.css` is a verbatim copy of
`shadcn@4.21.4/dist/tailwind.css`, retained under [shadcn's MIT license](licenses/shadcn-MIT.txt).
Its SHA-256 is `4c371f7a1ff5d219ae2f7ff28bd256b4346fd546fe46fbae22092e57db2f0fae`.
The shadcn CLI package has been removed from the build dependency tree; copied components and styles
remain covered by the upstream notice above. Review and record provenance if updating this copy.

Font license files include the font authors' copyright notices and the full OFL conditions.
Keep these notices with redistributions containing the fonts. The retained texts above come from
the installed packages or pinned copied sources described above; update them when those assets or copied sources change.

## Application dependencies

remodeck uses Electron, React, Base UI, Radix UI, xterm.js, node-pty, Motion, Tailwind CSS and their
dependencies. `npm run build` generates `THIRD_PARTY_LICENSES.md` inside each of `out/main/`,
`out/preload/` and `out/renderer/` for bundled JavaScript dependencies. Electron-builder packages
these reports, this notice, the root license and `licenses/` with the app. External production
dependencies also retain their package license files. Electron distributions carry separate
Electron/Chromium notices, including `LICENSE.electron.txt` and `LICENSES.chromium.html` on Windows;
do not remove them from redistributed application files.

`package-lock.json` is the complete dependency inventory for development and builds. A package
declared under devDependencies can still contribute code, CSS or fonts to the shipped renderer.
Review actual output as well as the dependency graph before distributing an installer.

At the preparation audit, `buildcheck`, `cpu-features` and `ssh2` lacked a `license` field in the
lockfile. Their installed package metadata uses the older `licenses` field, and their included
license files declare MIT. They were not treated as unlicensed solely because that lockfile field
was absent. This inventory records observed metadata; it is not a blanket legal clearance for future
dependencies or assets.
