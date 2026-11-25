# Kiro CLI v2 post-tool-use hook (postToolUse).
. "$PSScriptRoot\..\lib\estacao-ai-hook.ps1"
Invoke-AiMemoryHook -Event "post-tool-use" -Agent "kiro-cli"
exit 0
