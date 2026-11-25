#!/bin/sh
# Linha de status do Claude Code para a Estação-ai.
# O Claude Code entrega um JSON pela entrada padrão (inclui rate_limits de 5 h e
# semanal em planos de assinatura). Guardamos o JSON para a aba "Consumo e uso".
dir="${AI_MEMORY_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/estacao-ai}/estacao/limites"
mkdir -p "$dir" || exit 0
tmp="$dir/claude.json.$$"
cat > "$tmp" && mv "$tmp" "$dir/claude.json"
printf 'Estação-ai'
