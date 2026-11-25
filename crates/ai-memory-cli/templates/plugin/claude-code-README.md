# estacao-ai for Claude Code

Long-term memory across sessions and coding agents, backed by your own
[estacao-ai](https://github.com/akitaonrails/ai-memory) server. Quit Claude
Code mid-task, open another agent in the same directory, and continue without
re-explaining the context.

This plugin is generated from the estacao-ai repository
(`estacao-ai render-plugins`); do not edit it by hand.

## Requirements

The plugin does not contain estacao-ai. Install the binary once, separately,
and run `estacao-ai setup` (install script, Homebrew, AUR, RPM, the Docker
wrapper or the macOS app; see the
[install guide](https://github.com/akitaonrails/ai-memory#install)). Without
the binary the plugin captures nothing: it says so once at session start and
never blocks Claude.

The plugin needs estacao-ai 3.0 or later. With an older binary the hooks
fall back to `http://127.0.0.1:49374` and print an upgrade hint, and the
memory tools do not connect while `server_url` is empty.

## Install

```text
/plugin marketplace add akitaonrails/ai-memory
/plugin install estacao-ai@estacao-ai
```

or from a shell:

```sh
claude plugin marketplace add akitaonrails/ai-memory
claude plugin install estacao-ai@estacao-ai
```

Claude Code does not auto-update third-party marketplaces unless you turn
that on. `estacao-ai upgrade` updates the plugin along with a release-tarball
binary; after a Homebrew, AUR or RPM upgrade, run `claude plugin marketplace
update estacao-ai` and `claude plugin update estacao-ai@estacao-ai`.

## What it runs and what it sends

- Hooks: every lifecycle event (session start and end, prompts, tool
  calls, compaction, stop, subagents) runs `scripts/estacao-ai-hook`, a short
  POSIX shell script you can read in full. It finds the installed `estacao-ai`
  binary and hands it the event with `estacao-ai hook`. The binary applies
  your capture exclusions (`ignore_paths`, allowlist mode, server profiles)
  before anything is written or sent, spools the event locally, and delivers
  it only to your estacao-ai server, which sanitizes it before storage.
- MCP: the estacao-ai memory tools, through `estacao-ai mcp-bridge`.
- Skills: the estacao-ai routing skills, plus `/estacao-ai:status`, which
  runs `estacao-ai doctor` and summarizes it.

No telemetry. Nothing goes anywhere except the estacao-ai server you
configure. Hooks from a plugin run with your user permissions, outside
Claude's sandbox, like any Claude Code hook.

Sessions with no project folder (a desktop scratch workspace) are not
captured through the plugin.

## Options

All optional; the defaults match a local `estacao-ai setup` install. Set them
with `/plugin configure estacao-ai@estacao-ai`.

| Option | Default | Use |
| --- | --- | --- |
| `server_url` | empty | Empty uses the `server_url` from your estacao-ai config. Set it only to point this plugin elsewhere. |
| `ai_memory_bin` | `estacao-ai` | Absolute path to the binary when it is not on `PATH`. A relative path is ignored: it would resolve inside the checkout. |
| `data_dir` | empty | Only for an install with a non-default data directory. |

There is no token option. Hooks and the MCP bridge use the credentials the
estacao-ai CLI already stores (`estacao-ai setup`, `auth login`).

## Already using `estacao-ai install-hooks`?

If your Claude settings already carry estacao-ai hooks, those win: the plugin
skips every event they deliver, so nothing is captured twice. `estacao-ai
doctor` reports the double install and suggests keeping one. `estacao-ai
setup` leaves Claude's settings alone while the plugin is enabled.

## Platform notes

- On Windows, Claude Code runs plugin hooks through Git Bash, which it
  already requires; the launcher needs nothing else.
- With the Docker wrapper, plugin hooks need a wrapper that routes `estacao-ai
  hook` to its native client; run `estacao-ai upgrade` to get it.
- In Cowork, capture runs on your computer and needs estacao-ai installed
  there; the memory tools still work.

## Uninstall

```sh
claude plugin uninstall estacao-ai@estacao-ai
```

`estacao-ai uninstall` offers the same step.

## License

MIT, see `LICENSE`.
