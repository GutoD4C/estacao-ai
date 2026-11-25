. "$PSScriptRoot\..\lib\estacao-ai-hook.ps1"
Invoke-AiMemoryHook -Event "post-tool-use" -Agent "claude-code"
exit 0
