# Remote git backup example

Sample scripts + unit files that push an estacao-ai install to a remote git
repository on a daily cadence, keeping an online `estacao-ai backup` snapshot
on a second location for the SQLite state that the mirror repo deliberately
excludes. Models remain redownloadable and are not backed up.

See [`docs/backup.md`](../../backup.md) for the walkthrough. The pieces in this
directory are:

- `estacao-ai-snapshot.sh`: the rsync + git push + tarball loop, configurable
  through six environment variables (`REPO_DIR`, `DATA_SRC`, `CFG_SRC`,
  `TARBALL_DIR`, `LOG_DIR`, `SECRET_EXCLUDES`) with sensible defaults for a
  single-user Linux/WSL/macOS install.
- `estacao-ai-backup.service`: a `systemd --user` oneshot that runs the
  script. `%h` expands to the user's home directory.
- `estacao-ai-backup.timer`: a daily user timer with a small randomised delay
  and `Persistent=true` so the missed run after a reboot still fires.
- `.gitignore`: the exclusion list to drop into the root of the mirror
  repository, as a second layer behind the rsync/tar exclude lists in the
  script itself.

## Quickstart

```bash
# 1. Create a private repository on your git host (e.g. github.com), then:
mkdir -p ~/estacao-ai-backup
cd ~/estacao-ai-backup
git init
git remote add origin git@github.com:<you>/estacao-ai-backup.git
cp .../docs/examples/backup/.gitignore .
git add .gitignore
git commit -m "initial: ignore secrets, DB, models, logs"
git branch -M main
# push once so `snapshot.sh` has a remote to push to
git push -u origin main

# 2. Drop the snapshot script somewhere on $PATH.
install -Dm755 \
    .../docs/examples/backup/estacao-ai-snapshot.sh \
    ~/.local/bin/estacao-ai-snapshot.sh

# 3. Install the unit files.
install -Dm644 \
    .../docs/examples/backup/estacao-ai-backup.service \
    ~/.config/systemd/user/estacao-ai-backup.service
install -Dm644 \
    .../docs/examples/backup/estacao-ai-backup.timer \
    ~/.config/systemd/user/estacao-ai-backup.timer

# 4. Enable + start.
systemctl --user daemon-reload
systemctl --user enable --now estacao-ai-backup.timer

# 5. Trigger one snapshot to confirm the plumbing works.
systemctl --user start estacao-ai-backup.service
journalctl --user -u estacao-ai-backup.service --since '5 minutes ago'
```

## Non-systemd equivalents

The script is a plain bash program; anything that runs a shell command on a
schedule can drive it:

- **macOS launchd:** wrap `estacao-ai-snapshot.sh` in a `.plist` under
  `~/Library/LaunchAgents/` with a `StartCalendarInterval` block.
- **Windows Task Scheduler:** run the script inside WSL via `wsl -e bash -lc
  'estacao-ai-snapshot.sh'` on a daily trigger. On native Windows use the
  PowerShell equivalent of the rsync + `git add/commit/push` + tar sequence.
- **Docker sidecar:** a small cron container mounted at the estacao-ai data
  volume, running the same script.

## Security note

The remote is your own channel, not estacao-ai's. Follow the existing
[`SECURITY.md`](../../../SECURITY.md) guidance ("Remote sync security"): use a
private repository, a fine-grained token scoped to that one repo (or an SSH
deploy key), and rotate credentials the same way you rotate any other
long-lived push credential. The script never commits files matched by
`SECRET_EXCLUDES` (default: `*.env`, `auth.json`, `.secrets`, `*.pem`, `*.key`, `*.crt`); the mirror
repo's `.gitignore` catches anything the rsync exclude missed. The separate
online snapshot may include `<data_dir>/config.toml`, including secrets stored
inline there, and always contains private memory data. The git mirror can also
include inline secrets from the copied config directory because filename globs
cannot redact TOML values. Inspect or encrypt both outputs and protect them as
secret-bearing artifacts.
