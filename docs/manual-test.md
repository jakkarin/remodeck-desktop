# Manual End-to-End Test Checklist

Date: 2026-10-03  
Version: Task 19 Manual verification

## Setup

Have the following ready before testing:

- **SSH access**: `ssh <alias>` works from a Windows terminal, with the SSH key loaded in ssh-agent
- **Git installed**: on both Windows and the sandbox
- **GitHub Credential Manager**: installed, and logged in with `git credential-manager github login` on Windows
- **Node.js and npm**: installed
- **Electron binary**: if missing, run `npm install && node node_modules/electron/install.js`
- **Development server**: run `npm run dev` to start the app

## Test Cases

### 1. Spec §9 Main Flow — Add Host → Connect → Clone → Commit → Sync → Review → Push → PR → Merge → Sync

| Step | Action | Result |
|---|---|---|
| 1.1 | Open the app → the sidebar shows no hosts (disconnected) | ☐ |
| 1.2 | Click Add Host → enter the SSH alias and label, save | ☐ |
| 1.3 | Select the host → click Connect → preflight checks for `git` on the sandbox | ☐ |
| 1.4 | If git is missing → an install message and a Reload button are shown | ☐ |
| 1.5 | The host reaches the `connected` state | ☐ |
| 1.6 | Click Clone → pick a repo from GitHub (search or paste a URL) | ☐ |
| 1.7 | Enter the sandbox path (default `~/repos/<repo>`) → Clone | ☐ |
| 1.8 | The mirror is created and fetches origin; the sandbox is initialised and checks out the default branch | ☐ |
| 1.9 | In a plain SSH session (`ssh <host>` from the system terminal) → `cd ~/repos/<repo>` and `git checkout -b feat-a` | ☐ |
| 1.10 | Create a new file + commit (any message) | ☐ |
| 1.11 | Click Refresh / Sync → branch `feat-a` appears in the Workspace view with its ahead count | ☐ |
| 1.12 | Select `feat-a` → the review panel shows the log + diff | ☐ |
| 1.13 | Click Push to GitHub → the push succeeds | ☐ |
| 1.14 | On GitHub.com → open the draft PR from the app's "Open PR" button | ☐ |
| 1.15 | Fill in the PR and merge it ("Squash and merge" or "Create a merge commit") | ☐ |
| 1.16 | Back in the app → click Sync | ☐ |
| 1.17 | The sandbox's `origin/main` has the new commit from the merged PR | ☐ |
| 1.18 | The local main branch is still at its old commit (unchanged) | ☐ |

### 2. Terminal from App — Git Push with Popup Authentication

| Step | Action | Result |
|---|---|---|
| 2.1 | Workspace → click Open Terminal → an xterm.js tab opens with the prompt in `<path>` | ☐ |
| 2.2 | In the terminal: `git checkout -b feat-b` | ☐ |
| 2.3 | Create a new file + `git add` + `git commit -m "feat-b"` | ☐ |
| 2.4 | `git push origin feat-b` | ☐ |
| 2.5 | An approval popup appears in the app | ☐ |
| 2.6 | It shows the repo name, ref (`feat-b`), old→new sha (short) and the originating terminal tab | ☐ |
| 2.7 | "Allow once" → the push goes through and the terminal prints success | ☐ |
| 2.8 | Close the popup → in a plain SSH session, `git push origin feat-b` fails for lack of credentials | ☐ |
| 2.9 | The GitHub token is never written to any file in the sandbox → (a) search for the real token from `git credential fill` on Windows, passed over stdin (so the token never reaches the sandbox's disk/argv/history) — in Git Bash on Windows: `printf 'protocol=https\nhost=github.com\n\n' \| git credential fill \| sed -n 's/^password=//p' \| ssh <alias> 'grep -rlF -f - ~/ 2>/dev/null'` must print no file names (b) in the sandbox: `grep -rlE "gho_\|ghp_\|github_pat_" ~/ 2>/dev/null` must be empty | ☐ |

### 3. Protected Branch Blocking

| Step | Action | Result |
|---|---|---|
| 3.1 | In the app terminal: `git checkout main` (or the default branch) | ☐ |
| 3.2 | Make a change + commit | ☐ |
| 3.3 | `git push origin main` → the bridge's preflight rejects it (403) | ☐ |
| 3.4 | The terminal shows that the push was rejected (protected branch) | ☐ |
| 3.5 | Plain SSH session: `git push origin main` fails the same way (no token) | ☐ |

### 4. No-Git Host — Install Message and Reload

| Step | Action | Result |
|---|---|---|
| 4.1 | Add a host without git installed (or a test machine, or temporarily alter PATH) | ☐ |
| 4.2 | Click Connect → preflight reports "git not found" and shows the install command | ☐ |
| 4.3 | The host button shows a red (error) state | ☐ |
| 4.4 | Install git on the sandbox: `apt install git` (or `dnf install git`) | ☐ |
| 4.5 | In the app → click Reload (preflight again) | ☐ |
| 4.6 | git is detected → the host becomes connected | ☐ |
| 4.7 | That host's workspaces are usable (Clone, Sync) | ☐ |

### 5. Disconnect Closes Terminals

| Step | Action | Result |
|---|---|---|
| 5.1 | A connected host with 2 terminal tabs open | ☐ |
| 5.2 | Click Disconnect | ☐ |
| 5.3 | Both terminal tabs close (or show a "disconnected" message) | ☐ |
| 5.4 | The host is disconnected | ☐ |

### 6. Two Workspaces Same Branch Name

| Step | Action | Result |
|---|---|---|
| 6.1 | Create a second workspace of the same repo on another host (or another path) | ☐ |
| 6.2 | Clone finishes; workspace 2 creates a branch with the same name as workspace 1 (`feat-a`) | ☐ |
| 6.3 | Sync both workspaces → their refs stay separate in the mirror (`ws-<id1>/feat-a`, `ws-<id2>/feat-a`) | ☐ |
| 6.4 | The review screen shows the originating workspace (so it is clear which machine a push came from) | ☐ |

### 7. Rebuild Mirror

| Step | Action | Result |
|---|---|---|
| 7.1 | Settings → the Rebuild Mirror button for a repo | ☐ |
| 7.2 | The old mirror is deleted and recreated | ☐ |
| 7.3 | The rebuild succeeds; the workspace can still Sync | ☐ |

### 8. Add Existing Repo

| Step | Action | Result |
|---|---|---|
| 8.1 | The sandbox has a repo you cloned yourself (origin pointing to GitHub) with an unpushed branch and uncommitted files; note `git rev-parse HEAD`, `git status --porcelain` and `cat .git/config` | ☐ |
| 8.2 | Host connected → open the Switcher → click "＋ Add existing repo…" → enter the path (e.g. `~/work/my-app`) → Check → you see "This workspace will be linked to github.com/<owner>/<name>" (nothing fetched or added yet) → confirm it is the intended repo, then click Confirm & Add | ☐ |
| 8.2a | Check a repo never used in remodeck → warning "This repo has not been used in remodeck before"; Check a repo with Always allow push → warning "This repo has Always allow push on"; click Back or change the path/host → returns to the Check step | ☐ |
| 8.2b | After Check, in the sandbox run `git remote set-url origin https://github.com/other/repo.git` → click Confirm & Add → error "The repo origin changed since confirmation (now points to other/repo) — please check again"; no workspace/repo/mirror is added | ☐ |
| 8.3 | The new workspace is selected automatically; sandbox-only branches appear in the branch list and can be reviewed | ☐ |
| 8.4 | In the sandbox: `git rev-parse HEAD`, `git status --porcelain` and `.git/config` match your notes byte for byte (no checkout, origin unchanged) | ☐ |
| 8.5 | Add the same path again → "This workspace already exists" | ☐ |
| 8.6 | A missing path / not a git repo / bare repo / repo subdirectory / repo without origin / non-GitHub origin → the matching error message is shown and no workspace is added | ☐ |
| 8.7 | An origin of the form `git@github.com:o/r.git` or `ssh://git@github.com/o/r.git` can be added too, and `git fetch`/`git push` in the app's Open Terminal go through the bridge (the push approval popup appears) | ☐ |

### 9. Host Context

| Step | Action | Result |
|---|---|---|
| 9.1 | Add a host without git and Connect → the Git module says git was not found on that host (no stuck error) | ☐ |
| 9.2 | Open several terminal tabs on host A, switch to host B and back → host A's terminals are still there, not closed | ☐ |
| 9.3 | Host settings → tick Protected host → Save → a thin red bar appears at the top of the window and a protected badge (lock icon) next to the host name in the HostSelector (button and list); switch to a normal host and the bar disappears | ☐ |
| 9.4 | Quit and reopen the app → the selected host and workspace are restored (including protected state) | ☐ |

## Automated Results

### npx vitest run
```
Test Files  26 passed (26)
Tests  168 passed (168)
```

✓ All tests passing

### npm run typecheck
```
✓ Passed - No TypeScript errors
```

### npm run build
```
✓ Passed
Main: 54.33 kB
Preload: 3.00 kB
Renderer: 1,088.53 kB + 13.18 kB CSS
```

---

**Test date:** [fill in when testing starts]  
**Overall result:** [passed / total]  
**Notes:** 


### npm run test:e2e (Docker)

`tests/e2e/sandbox.e2e.test.ts` starts 3 real Linux sandboxes (Debian + sshd + git, `tests/e2e/sandbox/Dockerfile`), drives the API from `createApp` the way the renderer does, and uses a local `git http-backend` in place of GitHub. 19/19 passed, 3 runs in a row.

Covered automatically: cases 1 (except opening the PR on GitHub and merging), 2, 3, 4, 5 and 6 above. It also checks:
- Clone refuses a path that is not empty.
- Tags created by the AI never reach GitHub.
- A history rewrite is flagged.
- Worktrees are listed.
- The GitHub token never enters the sandbox.
- A session not opened by the app has no route to GitHub.

Still manual:
- Windows OpenSSH (`C:/Windows/System32/OpenSSH/ssh.exe`). The test uses Git for Windows' ssh so it can use a throwaway `~/.ssh/config`.
- How the Electron UI renders (xterm, the popup, the buttons).
- Real GitHub (credential manager, opening the PR) and case 7.


### UI redesign (manual)

Check in real Electron, after the move to the three-column workspace:
- Light/dark theme follows the OS (including the terminal) — switch the OS theme and the screen and terminal follow
- Drag the dividers to resize, then quit and reopen the app; the sizes are kept
- When the AI commits in the terminal without pressing Sync, a ● dot appears on the branch within a few seconds (light sync after the terminal is idle for 3 seconds)
- The Sync button turns yellow when the host loses its connection


### Containers (manual)

| Step | Action | Result |
|---|---|---|
| C.1 | Host without docker → the Containers module says docker was not found | ☐ |
| C.2 | User not in the docker group → a message explains the missing permission | ☐ |
| C.3 | Start a container from a shell on the sandbox → the list updates by itself within a few seconds | ☐ |
| C.4 | Remove on a protected host → you must type the host name exactly before the Remove button is enabled | ☐ |
| C.5 | Click Logs on a container → a new terminal tab for that host opens and streams the log; Shell on a stopped container → the button is disabled | ☐ |
| C.6 | Click Shell on a running container → you get a shell inside the container (try `ls`, `exit`) | ☐ |
| C.7 | Compose Up / Pull / Restart on a normal host → runs immediately in a terminal; Down → a confirm dialog asks for a click | ☐ |
| C.8 | Compose Up / Down on a protected host → Up needs a click confirm, Down needs the host name typed exactly | ☐ |
| C.9 | When a terminal command ends → a line shows the exit code; a compose project without a path → the tooltip says "Compose project path unknown" | ☐ |
| C.10 | Open the Containers page → running containers show CPU / RAM, updating every ~5 seconds; switch to another page and CPU / RAM stop updating (and resume when you come back) | ☐ |
| C.11 | Click a container name → the details panel opens on the right (Overview / Env / JSON); click the same name again or the close button → the panel closes; below 720px wide the panel moves under the list | ☐ |
| C.12 | Env tab → every value shows `••••••`; click the eye button on one row → only that row is revealed (no reveal-all button); select another container → revealed values are hidden again | ☐ |
| C.13 | JSON tab → read-only raw inspect output, with `Env` shown as `<hidden: N vars>` and no real env values | ☐ |
| C.14 | A container list taller than the window → scroll down and click a container name → the details panel is visible straight away (not off-screen), both wide and below 720px | ☐ |
| C.15 | Images tab → image list (tag, size, created) with an `in use` badge on images a container uses; the Volumes and Networks tabs show lists and badges too; switching tabs clears the filter; the Containers \| Images \| Volumes \| Networks bar sits above the toolbar, styled like the Terminal tab bar, and stays visible while loading and on error | ☐ |
| C.16 | Click Remove on an image a container uses → confirm dialog (a click is enough on a normal host) → the error banner says "This image is in use by a container — remove that container first" and the list reloads; repeat with an in-use volume and network | ☐ |
| C.17 | Click Prune on the Images tab on a normal host → click-confirm dialog; on a protected host → the host name must be typed exactly; on success a line reads "Removed N items · reclaimed …" and the list reloads (Networks shows no reclaimed size) | ☐ |
| C.18 | Remove volume and Prune volumes → always require typing the host name, even on a normal host | ☐ |
| C.19 | Networks tab → built-in networks (bridge / host / none) have no Remove button, and the Remove buttons of other networks stay in place | ☐ |
| C.20 | A list taller than the window scrolls under the tab bar (Containers, Images, Volumes and Networks); compose project names sit at the left edge | ☐ |
| C.21 | Click the terminal collapse button → the terminal folds down to its tab bar at the bottom of the window and expands again; drag the bar above the terminal to resize it → switch to the Git page and back → both pages keep the same terminal height, also after restarting the app | ☐ |
| C.22 | Open a container's details → drag the bar between the list and the panel → the panel resizes (no narrower than 280px, and the list keeps at least 320px); close and reopen the panel or restart the app → the width is kept; below 720px wide the bar disappears | ☐ |

### Git access on target hosts (manual)

Use one real host with `git`, `gh` and Claude Code or Codex. Create fine-grained tokens (Contents RW, Pull requests RW, short expiry) for org A, org B and one repo of org A (the override).

| # | Step | Result |
| --- | --- | --- |
| G.1 | Settings → Git tokens: add a token for org A, one for org B and one for a single repo of org A → the repo override is listed under org A | ☐ |
| G.2 | Host settings → enable Git access on this host → the plain-text warning shows; select all three tokens, Install, confirm → status shows helper, include and gh wrapper active (login and non-login shell) | ☐ |
| G.3 | On the host, open a plain SSH session (not a remodeck terminal) and have Claude Code or Codex clone, commit, push a branch and open a PR in a repo of org A, a repo of org B, and the override repo → all three succeed, each with its own token | ☐ |
| G.4 | Open a terminal from remodeck on the same host and push → it still goes through the Git Bridge and asks for approval | ☐ |
| G.5 | Replace one token in Settings → reopen Host settings → the row shows "Changed since install"; Update host clears it | ☐ |
| G.6 | Remove from host and confirm → push and `gh pr create` from the same repos now fail, and `~/.config/remodeck/git-access`, `~/.local/bin/gh` (ours) and the `include.path` line in `~/.gitconfig` are gone | ☐ |

| G.7 | On a host where `gh auth setup-git` was already run, enable Git access and Install → the status list warns that credential helper "gh" for github.com is asked before remodeck's and may answer with its own login | ☐ |
| G.8 | On a host without git, Install → it fails, the error ends with "Try Update host again or Remove from host.", and Remove from host is offered and works | ☐ |
| G.9 | Try to remove a host (Settings → Hosts) that still has git access → refused with "Remove git access from this host first"; after Remove from host the host can be removed | ☐ |
| G.10 | In a remodeck terminal on a host with git access, run `gh pr list` in a repo whose `origin` is a github.com URL of org A → it uses the token for org A (the repo comes from the configured origin) | ☐ |
| G.11 | On a host where status says "Not active in non-login shells", tick "Add ~/.local/bin to PATH in ~/.bashrc…" and Update host → the top of `~/.bashrc` has the remodeck block, status shows "Active in non-login shells" and "PATH line in ~/.bashrc added by remodeck"; Update host again does not add a second block | ☐ |
| G.12 | Leave the PATH box unticked and Install → `~/.bashrc` is byte-for-byte unchanged | ☐ |
| G.13 | Remove from host after G.11 → the block is gone and the rest of `~/.bashrc` is unchanged | ☐ |
