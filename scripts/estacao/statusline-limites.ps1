# Linha de status do Claude Code para a Estação-ai (Windows PowerShell).
# O Claude Code entrega um JSON pela entrada padrão (inclui rate_limits de 5 h e
# semanal em planos de assinatura). Guardamos o JSON para a aba "Consumo e uso".
$ErrorActionPreference = 'SilentlyContinue'
$base = if ($env:AI_MEMORY_DATA_DIR) {
  $env:AI_MEMORY_DATA_DIR
} elseif ($env:LOCALAPPDATA) {
  Join-Path $env:LOCALAPPDATA 'estacao-ai'
} else {
  Join-Path $HOME '.local\share\estacao-ai'
}
$dir = Join-Path $base 'estacao\limites'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$entrada = [Console]::In.ReadToEnd()
if ($entrada) {
  $tmp = Join-Path $dir ("claude.json.{0}" -f $PID)
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($tmp, $entrada, $utf8)
  Move-Item -Force -Path $tmp -Destination (Join-Path $dir 'claude.json')
}
Write-Output 'Estação-ai'
