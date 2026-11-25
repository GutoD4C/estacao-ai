#!/usr/bin/env bash
# Empacota a Estação-ai em formato .deb (Debian / Ubuntu / Linux Mint)
# O pacote instala o atalho; o primeiro lançamento prepara os dados do usuário.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(awk -F'"' '/^\[workspace\.package\]/{f=1} f&&/^version[[:space:]]*=/{print $2; exit}' "${REPO_DIR}/Cargo.toml")"
# Epoch 1 evita downgrade no APT para usuários vindos do .deb 3.4.9 (tag estacao-001.2).
DEB_EPOCH="${DEB_EPOCH:-1}"
DEB_VERSION="${DEB_EPOCH:+${DEB_EPOCH}:}${VERSION}"
ARCH="$(dpkg --print-architecture 2>/dev/null || echo amd64)"
BIN_PATH="${REPO_DIR}/target/release/estacao-ai"

if [ ! -f "${BIN_PATH}" ]; then
  echo "▸ Compilando estacao-ai (release)..."
  cargo build --locked --release --manifest-path "${REPO_DIR}/Cargo.toml" -p ai-memory-cli
fi

OUT_DIR="${REPO_DIR}/target/packages"
STAGE_DIR="${OUT_DIR}/deb-stage/estacao-ai_${VERSION}_${ARCH}"
rm -rf "${STAGE_DIR}"
mkdir -p \
  "${STAGE_DIR}/DEBIAN" \
  "${STAGE_DIR}/usr/bin" \
  "${STAGE_DIR}/usr/lib/estacao-ai" \
  "${STAGE_DIR}/usr/share/applications" \
  "${STAGE_DIR}/usr/share/icons/hicolor/256x256/apps" \
  "${STAGE_DIR}/usr/lib/systemd/user"

install -m 0755 "${BIN_PATH}" "${STAGE_DIR}/usr/lib/estacao-ai/estacao-ai"
cp -a "${REPO_DIR}/hooks" "${STAGE_DIR}/usr/lib/estacao-ai/hooks"
cp -a "${REPO_DIR}/scripts" "${STAGE_DIR}/usr/lib/estacao-ai/scripts"
install -m 0755 "${REPO_DIR}/packaging/desktop/instalar-atalho.sh" "${STAGE_DIR}/usr/lib/estacao-ai/instalar-atalho"
install -m 0644 "${REPO_DIR}/LICENSE" "${REPO_DIR}/NOTICE" "${STAGE_DIR}/usr/lib/estacao-ai/"
install -Dm644 "${REPO_DIR}/packaging/desktop/atalho-autostart.desktop" "${STAGE_DIR}/etc/xdg/autostart/estacao-ai-atalho.desktop"
ln -sf ../lib/estacao-ai/estacao-ai "${STAGE_DIR}/usr/bin/estacao-ai"

install -m 0644 "${REPO_DIR}/packaging/desktop/estacao-ai.desktop" "${STAGE_DIR}/usr/share/applications/estacao-ai.desktop"
install -m 0644 "${REPO_DIR}/docs/logo.png" "${STAGE_DIR}/usr/share/icons/hicolor/256x256/apps/estacao-ai.png"

cat > "${STAGE_DIR}/usr/lib/systemd/user/estacao-ai.service" <<'EOF'
[Unit]
Description=Estação-ai — Estação Orbital de Agentes e Memória
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/estacao-ai serve --transport http --enable-web
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
EOF

cat > "${STAGE_DIR}/DEBIAN/control" <<EOF
Package: estacao-ai
Version: ${DEB_VERSION}
Section: devel
Priority: optional
Architecture: ${ARCH}
Depends: xdg-utils, xdg-user-dirs, ca-certificates
Maintainer: GutoD4C <190434373+GutoD4C@users.noreply.github.com>
Homepage: https://github.com/GutoD4C/estacao-ai
Description: Estacao-ai — Aplicacao multi-agentes de IA com memoria por projeto e global
 Ambiente desktop e servidor local para orquestracao de agentes de IA (Claude,
 Codex, Gemini, OpenCode, Pi, Ollama), Lounge 3D e memoria persistente.
 Instala e configura automaticamente MCP, hooks, servico local e atalhos.
EOF

cat > "${STAGE_DIR}/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
fi

# Cria o atalho com as permissões e o diretório XDG reais de cada usuário.
getent passwd | while IFS=: read -r nome senha uid gid gecos casa shell; do
  case "$uid" in ''|*[!0-9]*) continue ;; esac
  [ "$uid" -ge 1000 ] && [ "$uid" -lt 60000 ] && [ -d "$casa" ] || continue
  runuser -u "$nome" -- env HOME="$casa" /usr/lib/estacao-ai/instalar-atalho || true
  # Após atualizar um desktop ativo, o atalho deve encontrar o servidor novo.
  if [ -n "${2:-}" ] && [ -S "/run/user/$uid/bus" ] && command -v systemctl >/dev/null 2>&1; then
    runuser -u "$nome" -- env XDG_RUNTIME_DIR="/run/user/$uid" systemctl --user try-restart estacao-ai.service || true
  fi
done
EOF
chmod 0755 "${STAGE_DIR}/DEBIAN/postinst"

DEB_FILE="${OUT_DIR}/estacao-ai_${VERSION}_${ARCH}.deb"
dpkg-deb --build --root-owner-group "${STAGE_DIR}" "${DEB_FILE}"
echo "✓ Pacote .deb auto-configurável gerado em: ${DEB_FILE}"
