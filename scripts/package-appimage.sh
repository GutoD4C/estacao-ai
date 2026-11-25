#!/usr/bin/env bash
# Empacota a Estação-ai em formato AppImage (Linux universal)
# Inclui hooks e scripts junto ao binário para auto-configuração no 1º clique.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(awk -F'"' '/^\[workspace\.package\]/{f=1} f&&/^version[[:space:]]*=/{print $2; exit}' "${REPO_DIR}/Cargo.toml")"
ARCH="$(uname -m)"
BIN_PATH="${REPO_DIR}/target/release/estacao-ai"

if [ ! -f "${BIN_PATH}" ]; then
  echo "▸ Compilando estacao-ai (release)..."
  cargo build --release --manifest-path "${REPO_DIR}/Cargo.toml" -p ai-memory-cli
fi

OUT_DIR="${REPO_DIR}/target/packages"
APPDIR="${OUT_DIR}/Estacao-ai.AppDir"
rm -rf "${APPDIR}"
mkdir -p \
  "${APPDIR}/usr/bin" \
  "${APPDIR}/usr/share/applications" \
  "${APPDIR}/usr/share/icons/hicolor/256x256/apps"

install -m 0755 "${BIN_PATH}" "${APPDIR}/usr/bin/estacao-ai"
cp -a "${REPO_DIR}/hooks" "${APPDIR}/usr/bin/hooks"
cp -a "${REPO_DIR}/scripts" "${APPDIR}/usr/bin/scripts"
install -m 0755 "${REPO_DIR}/packaging/appimage/AppRun" "${APPDIR}/AppRun"
install -m 0644 "${REPO_DIR}/packaging/desktop/estacao-ai.desktop" "${APPDIR}/estacao-ai.desktop"
install -m 0644 "${REPO_DIR}/packaging/desktop/estacao-ai.desktop" "${APPDIR}/usr/share/applications/estacao-ai.desktop"
install -m 0644 "${REPO_DIR}/docs/logo.png" "${APPDIR}/estacao-ai.png"
install -m 0644 "${REPO_DIR}/docs/logo.png" "${APPDIR}/.DirIcon"
install -m 0644 "${REPO_DIR}/docs/logo.png" "${APPDIR}/usr/share/icons/hicolor/256x256/apps/estacao-ai.png"

echo "✓ AppDir preparado em: ${APPDIR}"

APPIMAGE_OUT="${OUT_DIR}/Estacao-ai-${VERSION}-${ARCH}.AppImage"
TOOL=""
if command -v appimagetool >/dev/null 2>&1; then
  TOOL="appimagetool"
elif [ -x "${OUT_DIR}/appimagetool-${ARCH}.AppImage" ]; then
  TOOL="${OUT_DIR}/appimagetool-${ARCH}.AppImage"
elif [ "${1:-}" = "--download-tool" ]; then
  TOOL_URL="https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-${ARCH}.AppImage"
  echo "▸ Baixando appimagetool (${ARCH})..."
  curl -fsSL "${TOOL_URL}" -o "${OUT_DIR}/appimagetool-${ARCH}.AppImage"
  chmod +x "${OUT_DIR}/appimagetool-${ARCH}.AppImage"
  TOOL="${OUT_DIR}/appimagetool-${ARCH}.AppImage"
fi

if [ -n "${TOOL}" ]; then
  ARCH="${ARCH}" APPIMAGE_EXTRACT_AND_RUN=1 "${TOOL}" "${APPDIR}" "${APPIMAGE_OUT}"
  echo "✓ AppImage gerado em: ${APPIMAGE_OUT}"
else
  echo "ℹ Para gerar o arquivo .AppImage final, instale 'appimagetool' ou execute:"
  echo "  bash scripts/package-appimage.sh --download-tool"
fi
