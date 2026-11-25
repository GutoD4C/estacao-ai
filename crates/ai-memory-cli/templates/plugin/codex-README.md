# estacao-ai for Codex

Long-term memory across sessions and coding agents, backed by your own
[estacao-ai](https://github.com/akitaonrails/ai-memory) server.

This plugin is generated from the estacao-ai repository
(`estacao-ai render-plugins`); do not edit it by hand.

## Requirements

The plugin does not contain estacao-ai. Install the binary once, separately,
and run `estacao-ai setup` (see the
[install guide](https://github.com/akitaonrails/ai-memory#install)). Without
the binary the plugin captures nothing and never blocks Codex.

The plugin needs estacao-ai 3.0 or later. With an older binary the hooks
fall back to `http://127.0.0.1:49374` and print an upgrade hint, and the
memory tools do not start.

## Install

```sh
codex plugin marketplace add akitaonrails/ai-memory
codex plugin add estacao-ai@estacao-ai
```

Then open Codex, run `/hooks`, and trust the estacao-ai hooks. Codex runs a
plugin's hooks only after you trust them; until then it skips them without a
message and the session is not captured. `estacao-ai doctor` and the
`status` skill report hooks Codex skips.

Trust survives a plugin upgrade: Codex keys it on the hook command, and the
commands stay identical across releases. A release that has to change a
command says so in its changelog, and you trust the new command once.

## What it runs and what it sends

- Hooks: each lifecycle event runs `scripts/estacao-ai-hook`, a short POSIX
  shell script, which hands the event to the installed binary
  (`estacao-ai hook`). The binary applies your capture exclusions, spools the
  event, and delivers it only to your estacao-ai server. On Windows the hooks
  call `estacao-ai hook` directly, so `estacao-ai` must be on `PATH`; without
  it Codex reports a failed hook, and folderless sessions are captured.
- MCP: the estacao-ai memory tools, through `estacao-ai mcp-bridge
  --no-session-id`.
- Skills: the estacao-ai routing skills and a `status` skill.

No telemetry. The plugin has no settings; the server URL and credentials
come from your estacao-ai config.

## Already using `estacao-ai install-hooks --agent codex`?

Then both copies would capture each event. Keep one: `estacao-ai doctor`
reports the double install, and `estacao-ai setup` does not add settings
hooks while the plugin is installed.

## License

MIT, see `LICENSE`.
