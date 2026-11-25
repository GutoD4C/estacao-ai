#!/bin/sh
set -eu
desktop=$(xdg-user-dir DESKTOP) || exit 0
[ -n "$desktop" ] && [ "$desktop" != "$HOME" ] || exit 0
marker="${XDG_DATA_HOME:-$HOME/.local/share}/estacao-ai/.atalho-desktop-v1"
[ ! -e "$marker" ] || exit 0
mkdir -p -- "$desktop"
dest="$desktop/estacao-ai.desktop"
if [ ! -e "$dest" ]; then
  install -m 0755 /usr/share/applications/estacao-ai.desktop "$dest"
  if command -v gio >/dev/null 2>&1; then
    gio set "$dest" metadata::trusted true 2>/dev/null || true
  fi
fi
mkdir -p -- "$(dirname "$marker")"
touch "$marker"
