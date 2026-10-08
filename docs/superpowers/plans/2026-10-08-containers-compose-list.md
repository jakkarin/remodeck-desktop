# Containers Compose list implementation

Goal: Implement the approved Compose list in Containers, retaining the existing app layout and behavior.

Architecture: Stateless GroupPanel and ItemRow patterns compose a domain ContainerItem. ContainersView retains host, filtering, collapse, actions and confirmation ownership.

Tech stack: React, TypeScript, existing CSS tokens, Vitest / Testing Library.

Spec: ../specs/2026-10-08-containers-compose-list-design.md

Global constraints: No publishing, table or row hover fill. Preserve terminal ownership, filters, live updates and danger policy. Work in the user-requested codex/containers-compose-list branch.

Review focus: Accessible group labels, long metadata wrapping, fixed action slots, collapse and action regressions.

## Task 1: Compose the grouped lists

- [x] Add meaningful tests for group-scoped content and empty ports; observe failure.
- [x] Add reusable list patterns and ContainerItem; integrate with ContainersView.
- [x] Style bordered groups, inset dividers, metadata and responsive action slots using existing tokens.
- [x] Run renderer tests, full suite, typecheck and lint; review the final diff.

User authorized implementation with “แก้ไขได้เลย”; no additional design approval is needed.

## Verification

- Renderer: 24 files / 253 tests pass, including 16 ContainersView tests.
- Typecheck and Electron production build pass.
- ESLint passes for all changed TypeScript files; diff whitespace check passes.
- Full test run: 541 pass / 61 fail in unchanged main-process shell/path integration tests. LocalTarget creates paths through Bash which the Windows filesystem assertions cannot find; sync fixtures subsequently report missing repositories. No main-process code was changed.
- Repository-wide lint also scans an existing nested .claude/worktrees checkout and reports unrelated errors in existing tests/configuration. These were not expanded into the UI task.
- Fresh reviewer identified one toolbar selector specificity issue; fixed. No other reported regressions.
- Electron visual inspection of actual host data remains outstanding; wrapping and themes are implemented with shared tokens and container queries, not confirmed by a screenshot.
