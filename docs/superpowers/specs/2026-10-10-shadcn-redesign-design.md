# remodeck redesign (shadcn/ui + Tailwind + Motion)

Source design: the Design canvas "remodeck redesign" (https://claude.ai/artifact/N2bYxoL3czpajvbRexDxhy).
A copy of every board is in [2026-10-10-redesign-boards/](2026-10-10-redesign-boards/). Each board is
static HTML with inline styles, so exact sizes, spacing and colors can be read straight from the file.
Board copy that also exists in the app was taken from the code; keep the app's strings.

## Goal

Every screen moves to shadcn/ui components on Tailwind v4, with the look in the boards and the motion
in `Motion.dc.html`. Behavior stays the same except for the features listed under "New in this round".

## Boards

| Board | Covers |
| --- | --- |
| `Main` | Title bar, rail, Git workspace (Branches / Changes / Diff as cards) |
| `Terminal` | Git workspace with the terminal dock open |
| `Containers` | Containers list, compose groups, details panel |
| `Images` | Images / Volumes / Networks |
| `Switchers` | Host menu and workspace menu |
| `Dialogs` | Push approval, confirm danger, toasts |
| `Clone` | Clone dialog: GitHub repo picker (filter, list, URL tab) and clone progress |
| `HostDialogs` | Add host, Add existing repo, Host settings (+ Git access), Remove workspace, Remove host |
| `Onboarding` | First run (no hosts) |
| `HostStates` | Not connected, connect failed, git not found, connected with no workspaces, banners |
| `SettingsGeneral` / `SettingsRepos` / `SettingsTokens` / `SettingsPushLog` | Settings page |
| `Motion` | Durations, springs, what animates and what never does |
| `CommandPalette` | Next round, not this one |

## Visual system

- Ground `#F4F4F5` behind cards; surface `#FFFFFF`; border `#E4E4E7`; text `#18181B`; muted `#63636B`;
  accent `#245FA8` with tint `#E8EEF7` for selection.
- Status: success `#1F7A45` / `#E6F4EA`, danger `#B42318` / `#FCE8E8`, warning `#8A5A00` / `#FDF3DC`.
- Dark: ground `#111113`, surface `#1C1C1F`, text `#ECECEE`, accent `#8AB4F8`.
- Fonts: Geist (UI) and Geist Mono (code), bundled with the app (no network font loading).
- Shell: 46px title bar, 52px rail (Git, Containers, Settings at the bottom), panes are rounded cards
  with an 8px gap on the ground color.

## Motion (from `Motion.dc.html`)

| Name | Value | Used for |
| --- | --- | --- |
| fast | 120 ms ease-out | Hover, press, focus ring, tab underline |
| enter | 180 ms, spring 520 / 40 | Dialog, popover, menu, toast in |
| exit | 120 ms ease-in | Everything that leaves |
| layout | 220 ms, spring 400 / 36 | List reorder, selection pill, panel resize |

- Dialog: opacity 0→1, scale .96→1, y 6→0. Backdrop only fades.
- Selection pill slides between rows in branch list, file list and rail.
- Toasts enter x 16→0; older toasts scale .94. Errors stay until dismissed.
- After Sync, new file rows grow in and removed rows collapse.
- Module switch: 120 ms crossfade, no slide. The terminal dock stays mounted and never moves.
- Pulse only while connecting / restarting.
- Never animate: diff lines, terminal output, scrolling, lists over 100 rows, anything during drag-resize.
- Reduced motion: transforms become 0 ms; opacity fades keep 80 ms. Springs are interruptible.

## New in this round

1. Settings is a page (rail item), not a dialog. Appearance merges into General; sections are
   General, Repositories, Git tokens, Push log.
2. Workspace menu has a "Find workspace" search field.
3. Host menu rows show status, ssh alias, a Connect / Retry button and a settings button.
4. Connect failed state has a "Host settings" button.
5. Warning banners (git HTTP / port forwarding) can be dismissed.
6. Repositories settings show the number of workspaces per repo.
7. First run screen with the three-step checklist from `Onboarding.dc.html`.
8. Ctrl+` toggles the terminal dock.
9. Error toasts stay until dismissed.

## Next round (not in this plan)

Command palette (Ctrl K and the title bar search box), Undo in toasts, inline logs viewer in the
container details panel, Split / Unified diff toggle, image disk usage summary and "Used by" names,
"Git Bridge on" indicator in the terminal header.
