. "$PSScriptRoot\..\lib\estacao-ai-hook.ps1"
Invoke-AiMemoryHook -Event "post-tool-use" -Agent "command-code"
exit 0
