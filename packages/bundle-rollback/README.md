# dsh-undo-plugin

Conversation undo/rollback plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`).

- **Message-level rollback** — the enter-key icon under a sent prompt, the session-header rollback button, the `/undo` command, or the composer strip: restores the file tree from a plugin-private Shadow Git snapshot (never touches your `.git`) and forks the conversation, so the model never sees the reverted prompt, reply, or tool calls
- **Archive tasks** — list, restore, and hide archived sessions from Settings
- **Tool cards** — per-tool colored cards and the reasoning-and-actions fold in the dsh web conversation trail

## Install

```sh
dsh plugin --profile web add dsh-undo-plugin
```

Requires `dsh` 0.1.0-rc.6 or newer. Restart `dsh web` after installing.

Full documentation: [中文](https://github.com/23swccp/dsh-undo#readme) | [English](https://github.com/23swccp/dsh-undo/blob/HEAD/README.en.md)

## License

MIT
