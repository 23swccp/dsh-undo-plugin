# dsh-undo-plugin

English | [中文](README.zh.md)

[![CI](https://github.com/23swccp/dsh-undo/actions/workflows/ci.yml/badge.svg)](https://github.com/23swccp/dsh-undo/actions/workflows/ci.yml)

## Overview

[dsh-undo-plugin](https://github.com/23swccp/dsh-undo) is a conversation-undo plugin for [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness): a single `/undo` rolls the **workspace files and the conversation together** back to before the latest completed message; rolled-back sessions land in "Settings → Archive Tasks" for management (view / restore / permanent delete / delete all). Made a mistake? The "revoke rollback" strip above the composer fully restores it.

The plugin ships as an **installable bundle**: a standalone workspace that never patches the dsh codebase and uses only the public dsh APIs published on npm (`@deepseek-ai/dsh-*@0.1.0-rc.6`). File rollback goes through a plugin-private Shadow Git snapshot (its own `GIT_DIR`, never your `.git`).

> **Note:** the repository and the packages keep the historical `rollback` name; the user-facing commands are `/undo` (revert) and `/update` (self-update).

## Features

### Conversation undo (rollback)
- **Four trigger points**: the rollback icon button in the qualified user message's actions row (the enter-key glyph, right next to Copy), the session-header rollback button, the `/undo` slash command, and the strip above the composer
- The message-level button appears only on the user message the rollback point currently targets (exact message-id match) and follows the point as it moves; disabled while running, DOM-patch injected, self-healing across React re-renders
- The file tree is restored from a private Shadow Git snapshot; the conversation is forked into a new Session whose seed is the complete event prefix *before* the target message — the model never sees the reverted prompt, reply, or tool calls
- The old Session is archived automatically (it leaves the sidebar) and the UI navigates to the child Session
- Snapshots are captured at `agent/pre-step`; a capture failure rejects the step (the model never receives the prompt) and refills the composer draft with the original prompt plus a redacted reason

### Revoke rollback
- The `↩ 已回滚 <preview> [撤回回滚]` strip appears only after a rollback and disappears once a new prompt is accepted
- A full reverse transaction: it first verifies the workspace is untouched (a diverged workspace is refused with `workspace-diverged`, never overwritten), then restores the source Session and files, and re-arms the rollback point — rollback and revoke are symmetric and repeatable
- `restoring` / `revoking` journal phases are recovered deterministically on startup

### Archive tasks (Settings → Archive Tasks)
- Lists every archived Session (title / archived time / created time / workspace) with a read-only transcript viewer
- **Restore**: fork an archived conversation back as a new Session (repeatable; the archive entry is kept)
- **Delete**: permanently removes the session's on-disk log directory; busy agents are cancelled and awaited idle first
- **Delete all**: one batch RPC with a double-confirm dialog; partial failures report "deleted X, Y failed"

### Reasoning-and-actions fold
- Every prompt turn gets its own "reasoning & actions" collapse bar: the turn's Think steps, intermediate narration, context injections, and all tool calls fold away together; **the final conclusion and the stats row never fold**
- A running turn shows a "running" hint and stays expanded; once it closes while the view is following at the bottom it auto-collapses; manual clicks always override
- Turns without a conclusion (e.g. ending on a failing tool call) never fold — errors stay visible; history loads expanded
- Pure CSS/DOM injection keyed on the renderer's stable `data-chat-flow-kind` boundaries (user / assistant-step / tool-call / turn-tail); React-owned node structure is never touched

### Tool card colors
- Every expanded tool-call card in a conversation is tinted by tool type: the **bash terminal card stays near-black** (kept dark even under the light theme), the **pwsh terminal card gets the PowerShell-window blue**, and the rest carry theme-coordinated tints (edit green / read violet / search blue / web teal / code amber)
- Pure CSS injection keyed on the stable `data-*` hooks the stock renderer already publishes (`data-tool`, `data-terminal`, `data-diff`, …) — no hashed class names, React re-renders re-apply automatically

### Self-update
- `/update` in any session runs `git pull --ff-only` → `pnpm install` → `pnpm run build` in one pass (per-step timeouts; skips install/build when already up to date); restart dsh to activate
- No background auto-update — updating always starts from an explicit user action; `--ff-only` never rewrites local commits

### Performance and reliability
- Measured on a ~7,400-file workspace: **rollback and revoke each complete in about a second** (previously 30–40 s perceived)
- Key optimizations: single-`diff-tree` path-limited restore, `untrackedCache` + `splitIndex`, fork ∥ restore parallelism, stat warm-up plus next-generation prearm
- Windows-friendly atomic writes: `EPERM` / `EBUSY` / `EACCES` renames retried with backoff; failed temp files are cleaned up

## Installation

### Prerequisites
- Node.js (`^22.19 || >=24`) and dsh `0.1.0-rc.6` / `0.1.0-rc.7`
- The browser half needs the `dsh-web-app` surface (the web profile provides it by default; headless profiles may drop the four `client-rollback-*` rows from the bundle patch)

### Install
```sh
git clone https://github.com/23swccp/dsh-undo.git
cd dsh-undo
pnpm install
pnpm run build
dsh plugin --profile web add ./packages/rollback-fork ./packages/rollback-archive ./packages/rollback-undo ./packages/client-rollback-button ./packages/client-rollback-settings ./packages/client-rollback-toolcards ./packages/client-rollback-trailfold ./packages/bundle-rollback
```

All eight packages must be linked: pnpm's `link:` protocol does not install a linked bundle's dependencies, and the dsh loader resolves plugin package names from the profile's `node_modules`, so the seven plugin packages need their own links next to the bundle.

After restarting dsh: the session header gains the rollback button, `/undo` rolls back directly, the Settings dialog gains the Archive Tasks page, every turn gains the reasoning-and-actions fold bar, and expanded tool-call cards are colored per tool type.

### Update
Run `/update` in any session (requires a git-clone install), then restart dsh. Manual equivalent:

```sh
git pull && pnpm install && pnpm run build
```


## Package layout

| Package | Role |
|---|---|
| `packages/rollback-fork` | Session fork capability: exact completed-turn / before-user-message Agent branches |
| `packages/rollback-archive` | Archive capability: list, read-only view, restore, permanent delete, delete-all |
| `packages/rollback-undo` | Shadow-Git journal + rollback/revoke orchestration + the `/undo` and `/update` commands |
| `packages/client-rollback-button` | Browser: session-header rollback action and the revoke strip (self-mounted Remotes) |
| `packages/client-rollback-settings` | Browser: Archive Tasks settings page (self-mounted Remotes) |
| `packages/client-rollback-toolcards` | Browser: per-tool-type colors for expanded tool-call cards (CSS-only injection) |
| `packages/client-rollback-trailfold` | Browser: per-turn reasoning-and-actions fold bar (DOM injection) |
| `packages/bundle-rollback` | Installable bundle: `cordis.patch.yml` + dependency manifest |
| `packages/typert-protocol` | Vendored `@deepseek-ai/dsh-typert-protocol` source (required by the typert generator, see below) |

## Development

```sh
pnpm install
pnpm run typecheck   # builds host artifacts (typert generation) then checks the client face
pnpm test            # vitest, 12 files / 65 tests
pnpm run build       # host lib + client bundles (lib/client.js)
```

### Why the vendored typert-protocol and the generator patch

The typert generator recognizes `Remote` / `TypertRemoteService` only when the declaring package is workspace-registered, and it maps export targets back to `src/`. Against npm-resolved dsh packages two things were required:

1. `packages/typert-protocol` vendors the protocol source; `pnpm-workspace.yaml` overrides every dsh package to resolve it (`workspace:^`), and `tsconfig.base.json` maps `@deepseek-ai/dsh-typert-protocol` to `src/`.
2. `patches/typert-generator-workspace-only.patch` (applied via `patchedDependencies`) restricts typert map/context collection to workspace-registered files — otherwise npm-resolved dsh twins (e.g. two `dsh-session` instances from circular peers) duplicate the map declarations and fail generation.

## Limitations

- Rollback restores files inside the session workspace only (the git worktree boundary); agent writes outside the workspace are not covered.
- Steer-message exclusion is best-effort: the durable side has no `delivery` field in rc.6, so the source-kind + text-content check is the boundary.
- Admission failures are surfaced by polling once when the turn stops (the rc.6 api-remotes allowlist cannot forward push events).

## License

[MIT](LICENSE)
