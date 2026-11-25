. "$PSScriptRoot\..\lib\estacao-ai-hook.ps1"
Invoke-AiMemoryHook -Event "pre-tool-use" -Agent "grok"
exit 0
