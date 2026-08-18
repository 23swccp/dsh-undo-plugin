# dsh-rollback-plugin

English | [中文](README.zh.md)

Conversation rollback and archive-task management for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`), delivered as an **installable plugin bundle** — a standalone workspace that never patches the dsh codebase and uses only the public dsh APIs published on npm (`@deepseek-ai/dsh-*@0.1.0-rc.6`).

## Features

### Conversation rollback

Three trigger points: the session-header rollback button, the `/undo` slash command, and rolling back from the revoke strip described below. A rollback:

- restores the file tree from a plugin-private Shadow Git snapshot (its own `GIT_DIR`, never the user's `.git`);
- forks the conversation into a new Session seeded with the complete event prefix *before* the target message — the model never sees the reverted prompt, reply, or tool calls;
- archives the old Session (it leaves the sidebar) and automatically navigates the UI to the child Session;
- captures snapshots at `agent/pre-step`; a capture failure rejects the step (the model never receives the prompt) and refills the composer draft with the original prompt plus a redacted technical detail.

### Revoke rollback

After a rollback, a strip above the composer shows `↩ 已回滚 <prompt preview> [撤回回滚]`. It appears only while the rollback pair exists and disappears once a new prompt is accepted. Revoking is a full reverse transaction:

- verifies the workspace tree still equals the pre-rollback tree first — a diverged workspace is refused (`workspace-diverged`) instead of being overwritten;
- forks the archived source Session back as a visible Session, restores the files, and re-arms the rollback point, so rollback and revoke are symmetric and repeatable;
- journals `restoring` / `revoking` phases are recovered deterministically on startup.

### Archive tasks (Settings → Archive Tasks)

- Lists every archived Session with title, times, and workspace.
- Read-only transcript viewer.
- **Restore**: fork an archived conversation back as a new Session (repeatable; the archive entry is kept).
- **Delete**: permanently removes the session's on-disk log directory; busy agents are cancelled and awaited idle first.
- **Delete all**: one batch RPC with a double-confirm dialog; partial failures report "deleted X, Y failed".

### Self-update

`/update` in any session pulls the latest source (`--ff-only`, local commits are never rewritten), reinstalls dependencies, and rebuilds the plugin in one pass; restart dsh to activate. There is no background auto-update — updating always starts from an explicit user action.

### Performance

Measured on a ~7,400-file workspace (before → after):

- Path-limited restore driven by a single `git diff-tree --name-status` (full `checkout-index --all` ≈ 9.7 s → changed paths only).
- Shadow repo `core.untrackedCache` + `core.splitIndex` (warm `git add --all` 5.8 s → 0.3 s).
- Background stat warmer plus next-generation prearm: the first message on a fresh rollback branch no longer pays the ~31 s cold snapshot.
- Fork ∥ restore parallelism and a per-workspace assert cache on every arm.
- Net effect: rollback and revoke each complete in roughly a second (previously 30–40 s perceived).

### Reliability

- Windows-friendly atomic writes: `EPERM` / `EBUSY` / `EACCES` renames are retried with exponential backoff and failed temp files are cleaned up.
- The bundle patch disables the base bundle's `session-archive` / `ui-settings-archive` rows so this plugin fully owns the `sessionArchive` namespace.

## Package layout

| Package | Role |
|---|---|
| `packages/rollback-fork` | Session fork capability: exact completed-turn / before-user-message Agent branches |
| `packages/rollback-archive` | Archive capability: list, read-only view, restore, permanent delete, delete-all |
| `packages/rollback-undo` | Shadow-Git journal + rollback/revoke orchestration + the `/undo` command |
| `packages/client-rollback-button` | Browser: session-header rollback action and the revoke strip (self-mounted Remotes) |
| `packages/client-rollback-settings` | Browser: Archive Tasks settings page (self-mounted Remotes) |
| `packages/bundle-rollback` | Installable bundle: `cordis.patch.yml` + dependency manifest |
| `packages/typert-protocol` | Vendored `@deepseek-ai/dsh-typert-protocol` source (required by the typert generator, see below) |

## Installation

```sh
# in a profile with the dsh web surface
dsh plugin --profile web add /path/to/dsh-rollback-plugin/packages/bundle-rollback
```

Prerequisites: dsh `0.1.0-rc.6` (the plugin's peer range); the browser half needs the `dsh-web-app` surface (slots `conversation.session.header.actions`, `conversation.input.dock`, and `settings.section`, plus `ctx.remote.$mount`). Headless profiles may drop the two `client-rollback-*` rows from `packages/bundle-rollback/cordis.patch.yml`.

Windows note: `link:` installs from a path containing spaces get split by pnpm — install through a junction without spaces.

## Updating an existing installation

Run the `/update` command in any session (requires a git clone of this repository): it executes `git pull --ff-only` → `pnpm install` → `pnpm run build` with per-step timeouts, reports "already up to date" when HEAD did not move, and skips install/build in that case. Restart dsh afterwards — link-installed profiles pick up the rebuilt `lib/` automatically.

Manual equivalent:

```sh
git pull
pnpm install        # only needed when dependencies changed
pnpm run build
# restart dsh
```

There is no background auto-update; updating always starts from an explicit user action.

## Development

```sh
pnpm install
pnpm run typecheck   # builds host artifacts (typert generation) then checks the client face
pnpm test            # vitest, 8 files / 35 tests
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
