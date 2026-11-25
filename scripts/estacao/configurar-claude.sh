#!/bin/sh
# Deixa o Claude Code autenticado para o serviço da Estação-ai sem pedir login de novo.
#
# O login comum do `claude` expira; para execução sem tela a Anthropic oferece
# `claude setup-token`, que gera um token de longa duração. Este script roda o
# setup-token, pede para colar o token (sem mostrar na tela) e grava em
# ~/.config/estacao-ai/env (só o seu usuário lê), que o serviço já carrega.
set -eu

ENV_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/estacao-ai"
ENV_FILE="$ENV_DIR/env"

echo "1/3  Abrindo o 'claude setup-token' (vai pedir para entrar pelo navegador)…"
claude setup-token

echo
printf '2/3  Cole aqui o token que apareceu acima (começa com sk-ant-oat) e tecle Enter: '
stty -echo 2>/dev/null || true
read -r TOKEN
stty echo 2>/dev/null || true
echo
case "$TOKEN" in
  sk-ant-*) ;;
  *) echo "Isso não parece um token do Claude (deve começar com sk-ant-). Nada foi gravado." >&2; exit 1 ;;
esac

umask 077
mkdir -p "$ENV_DIR"
TMP="$ENV_FILE.tmp.$$"
# Mantém outras variáveis já gravadas e troca só a do Claude.
if [ -f "$ENV_FILE" ]; then grep -v '^CLAUDE_CODE_OAUTH_TOKEN=' "$ENV_FILE" > "$TMP" || true; else : > "$TMP"; fi
printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$TOKEN" >> "$TMP"
mv "$TMP" "$ENV_FILE"
chmod 600 "$ENV_FILE"
unset TOKEN

echo "3/3  Reiniciando o serviço da Estação-ai…"
systemctl --user restart estacao-ai
echo "Pronto: os modelos Claude da Estação-ai usam esse token (válido por cerca de 1 ano)."
