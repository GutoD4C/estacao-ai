#!/usr/bin/env bash
# Manual native Linux integration test for the Arch/AUR install path.
#
# This is intentionally not part of CI. It creates a disposable Arch distrobox,
# installs the current working tree into native filesystem locations, then tests
# the packaged systemd assets against a real system manager where distrobox
# supports `--init`.

set -euo pipefail

BOX_NAME="${AI_MEMORY_NATIVE_TEST_BOX:-estacao-ai-native-systemd-test}"
IMAGE="${AI_MEMORY_NATIVE_TEST_IMAGE:-docker.io/library/archlinux:latest}"
KEEP_BOX="${AI_MEMORY_NATIVE_TEST_KEEP_BOX:-0}"
HOST_TEST_HOME=""

log() {
  printf '\n==> %s\n' "$*"
}

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

assert_inside_container() {
  if [ -f /.dockerenv ] || [ -f /run/.containerenv ] || [ -n "${container:-}" ]; then
    return 0
  fi
  if command -v systemd-detect-virt >/dev/null 2>&1 \
    && systemd-detect-virt --container --quiet; then
    return 0
  fi
  fail "refusing to run destructive native install test outside a container/distrobox"
}

repo_root() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  cd "${script_dir}/.." && pwd
}

wait_for_http() {
  local url="$1"
  local unit="$2"
  for _ in $(seq 1 80); do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  journalctl -u "${unit}" --no-pager -n 120 >&2 || true
  fail "timed out waiting for ${url}"
}

run_inside() {
  assert_inside_container

  cd /work/estacao-ai

  log "Installing Arch build/runtime dependencies"
  sudo pacman -Syu --noconfirm --needed \
    base-devel \
    ca-certificates \
    curl \
    git \
    pkgconf \
    rustup \
    systemd

  log "Installing Rust 1.95 toolchain"
  rustup toolchain install 1.95 --profile minimal --component rustfmt --component clippy
  rustup default 1.95

  log "Checking package metadata syntax"
  bash -n packaging/aur/PKGBUILD
  bash -n packaging/aur/PKGBUILD-bin
  (cd packaging/aur && makepkg --printsrcinfo -p PKGBUILD) >/tmp/estacao-ai.PKGBUILD.SRCINFO
  (cd packaging/aur && makepkg --printsrcinfo -p PKGBUILD-bin) >/tmp/estacao-ai-bin.PKGBUILD.SRCINFO

  log "Building estacao-ai release binary from current working tree"
  cargo build --release -p ai-memory-cli

  log "Installing native package layout into the disposable distrobox"
  sudo install -Dm0755 target/release/estacao-ai /usr/bin/estacao-ai
  sudo rm -rf /usr/share/estacao-ai/hooks
  sudo install -dm0755 /usr/share/estacao-ai
  sudo cp -a hooks /usr/share/estacao-ai/
  sudo install -Dm0644 crates/ai-memory-cli/templates/config.default.toml /etc/estacao-ai/config.toml
  sudo install -Dm0640 packaging/env/estacao-ai.env /etc/estacao-ai/env
  sudo install -Dm0644 packaging/systemd/estacao-ai.service /usr/lib/systemd/system/estacao-ai.service
  sudo install -Dm0644 packaging/systemd/estacao-ai-user.service /usr/lib/systemd/user/estacao-ai.service
  sudo install -Dm0644 packaging/sysusers/estacao-ai.conf /usr/lib/sysusers.d/estacao-ai.conf
  sudo install -Dm0644 packaging/tmpfiles/estacao-ai.conf /usr/lib/tmpfiles.d/estacao-ai.conf

  log "Verifying systemd unit files"
  systemd-analyze verify /usr/lib/systemd/system/estacao-ai.service
  systemd-analyze --user verify /usr/lib/systemd/user/estacao-ai.service

  log "Creating system service user and state directory"
  sudo systemd-sysusers /usr/lib/sysusers.d/estacao-ai.conf
  sudo systemd-tmpfiles --create /usr/lib/tmpfiles.d/estacao-ai.conf
  test -d /var/lib/estacao-ai
  test "$(stat -c '%U:%G' /var/lib/estacao-ai)" = "estacao-ai:estacao-ai"

  log "Initializing system-service data with explicit /var + /etc paths"
  sudo -u estacao-ai /usr/bin/estacao-ai \
    --data-dir /var/lib/estacao-ai \
    --config /etc/estacao-ai/config.toml \
    init
  sudo test -d /var/lib/estacao-ai/wiki
  sudo test -d /var/lib/estacao-ai/db

  if ! systemctl list-units --type=service --no-pager >/dev/null 2>&1; then
    fail "systemd is not reachable inside this distrobox. Recreate with distrobox --init, or use a provider that supports systemd containers."
  fi

  log "Starting packaged system service with real systemctl"
  sudo systemctl daemon-reload
  sudo systemctl restart estacao-ai.service
  wait_for_http http://127.0.0.1:49374/web estacao-ai.service
  sudo -u estacao-ai /usr/bin/estacao-ai \
    --data-dir /var/lib/estacao-ai \
    --config /etc/estacao-ai/config.toml \
    status --json >/tmp/estacao-ai-system-status.json
  sudo systemctl stop estacao-ai.service

  log "Initializing user profile paths"
  mkdir -p "${HOME}/.config/estacao-ai" "${HOME}/.local/share/estacao-ai"
  /usr/bin/estacao-ai \
    --data-dir "${HOME}/.local/share/estacao-ai" \
    --config "${HOME}/.config/estacao-ai/config.toml" \
    init
  sed -i 's/127\.0\.0\.1:49374/127.0.0.1:49375/' "${HOME}/.config/estacao-ai/config.toml"

  log "Starting user-profile command under transient systemd supervision"
  sudo systemd-run \
    --unit estacao-ai-user-profile-smoke \
    --collect \
    --uid "$(id -u)" \
    --gid "$(id -g)" \
    --setenv "HOME=${HOME}" \
    /usr/bin/estacao-ai \
      --data-dir "${HOME}/.local/share/estacao-ai" \
      --config "${HOME}/.config/estacao-ai/config.toml" \
      serve --transport http --enable-web
  wait_for_http http://127.0.0.1:49375/web estacao-ai-user-profile-smoke.service
  sudo systemctl stop estacao-ai-user-profile-smoke.service

  log "Verifying packaged hook source lookup and agent config writes"
  /usr/bin/estacao-ai install-mcp --client claude-code --apply --server-url http://127.0.0.1:49375/mcp
  /usr/bin/estacao-ai install-hooks --agent claude-code --apply --server-url http://127.0.0.1:49375
  test -x "${HOME}/.local/share/estacao-ai/hooks/claude-code/session-start.sh"
  test -f "${HOME}/.claude.json"

  log "Native Arch systemd integration passed"
}

main() {
  if [ "${AI_MEMORY_NATIVE_TEST_INNER:-0}" = "1" ]; then
    run_inside
    return
  fi

  command -v distrobox >/dev/null 2>&1 || fail "distrobox is required"

  local repo
  repo="$(repo_root)"
  HOST_TEST_HOME="$(mktemp -d /tmp/estacao-ai-native-home.XXXXXX)"

  cleanup() {
    if [ "${KEEP_BOX}" != "1" ]; then
      distrobox rm --force "${BOX_NAME}" >/dev/null 2>&1 || true
      if [ -n "${HOST_TEST_HOME}" ]; then
        rm -rf "${HOST_TEST_HOME}"
      fi
    else
      printf 'keeping distrobox %s and home %s\n' "${BOX_NAME}" "${HOST_TEST_HOME}" >&2
    fi
  }
  trap cleanup EXIT

  log "Creating disposable Arch distrobox ${BOX_NAME}"
  distrobox rm --force "${BOX_NAME}" >/dev/null 2>&1 || true
  distrobox create \
    --yes \
    --name "${BOX_NAME}" \
    --image "${IMAGE}" \
    --init \
    --home "${HOST_TEST_HOME}" \
    --volume "${repo}:/work/estacao-ai:rw"

  log "Running native integration inside ${BOX_NAME}"
  distrobox enter "${BOX_NAME}" -- \
    env AI_MEMORY_NATIVE_TEST_INNER=1 \
    bash /work/estacao-ai/scripts/test-native-arch-systemd-distrobox.sh
}

main "$@"
