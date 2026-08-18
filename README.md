# dsh-rollback-plugin

Conversation rollback and archive tasks as an **installable DeepSeek Harness
(dsh) plugin bundle** — a standalone workspace that never patches the dsh
codebase. It implements the original rollback spec with only the public dsh
APIs published on npm (`@deepseek-ai/dsh-*@0.1.0-rc.6`).

## What it does

- A "回滚" (rollback) action in the session header rolls the workspace and
  conversation back to before the latest completed text-only user message:
  - the file tree is restored from a private Shadow Git snapshot (its own
    `GIT_DIR`, never the user's `.git`);
  - the conversation is forked to a new Session whose seed is the complete
    event prefix before the target message — the model never sees the reverted
    prompt, the assistant reply, or the tool calls;
  - the old Session enters the Host's global archive set and disappears from
    the sidebar.
- "设置 → 归档任务" (Settings → Archive Tasks) lists every archived Session,
  offers a read-only transcript viewer, and can hide entries.
- Snapshots are captured in `agent/pre-step`; a capture failure rejects the
  step (the model never receives the prompt) and restores the original prompt
  plus a redacted technical detail into the composer draft.

## Package layout

| Package | Role |
|---|---|
| `packages/rollback-fork` | Session fork capability: exact completed-turn / before-user-message Agent branches |
| `packages/rollback-archive` | Archive capability: list, read-only view, tombstone hiding |
| `packages/rollback-undo` | Shadow-Git journal + one-generation rollback orchestration |
| `packages/client-rollback-button` | Browser: session-header rollback action (mounts its own Remote) |
| `packages/client-rollback-settings` | Browser: Archive Tasks settings page (mounts its own Remotes) |
| `packages/bundle-rollback` | Installable bundle: `cordis.patch.yml` + dependency manifest |
| `packages/typert-protocol` | Vendored `@deepseek-ai/dsh-typert-protocol` source (required by the typert generator, see below) |

## Installation

```sh
# in a profile with the dsh web surface
dsh plugin --profile web add /path/to/dsh-rollback-plugin/packages/bundle-rollback
```

Headless profiles may drop the two `client-rollback-*` rows from
`packages/bundle-rollback/cordis.patch.yml`.

Prerequisites:

- dsh `0.1.0-rc.6` (the plugin's peer range). The browser half requires the
  `dsh-web-app` surface (slots `conversation.session.header.actions` and
  `settings.section`, `ctx.remote.$mount`).

## Degradations vs the original spec

The original in-repo design relied on unpublished core APIs. This standalone
build keeps the core experience (rollback + archive visibility) and degrades
the "housekeeping" features:

| Original spec | Standalone behavior |
|---|---|
| Force-terminate the running agent | `cancel()` + quiescence wait (0.5 s grace, force-stop registered jobs/PTYs, then refuse if still busy) |
| Permanently delete logs/attachments | Tombstone hiding: the entry leaves the archive list; files stay on disk |
| Restore / undo a rollback | Dropped (dsh publishes no unarchive API) |
| Per-message rollback button | Session-header action "rollback the latest message" |
| Live `undo/admission-failed` push | Host caches the failure; the browser polls once when the turn stops and refills the composer draft |
| Steer exclusion | Best effort: the durable `delivery` field does not exist, so the source-kind + text-content check is the boundary |

## Development

```sh
pnpm install
pnpm run typecheck   # builds host artifacts (typert generation) then checks the client face
pnpm test            # vitest, 7 files / 19 tests
pnpm run build       # host lib + client bundles (lib/client.js)
```

### Why the vendored typert-protocol and the generator patch

The typert generator recognizes `Remote` / `TypertRemoteService` only when the
declaring package is workspace-registered, and it maps export targets back to
`src/`. Against npm-resolved dsh packages two things were required:

1. `packages/typert-protocol` vendors the protocol source; `pnpm-workspace.yaml`
   overrides every dsh package to resolve it (`workspace:^`), and
   `tsconfig.base.json` maps `@deepseek-ai/dsh-typert-protocol` to `src/`.
2. `patches/typert-generator-workspace-only.patch` (applied via
   `patchedDependencies`) restricts typert map/context collection to
   workspace-registered files — otherwise npm-resolved dsh twins (e.g. two
   `dsh-session` instances from circular peers) duplicate the map declarations
   and fail generation.

## License

MIT
