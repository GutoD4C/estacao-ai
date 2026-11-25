. "$PSScriptRoot\..\lib\estacao-ai-hook.ps1"
Invoke-AiMemoryHook -Event "pre-tool-use" -Agent "gemini-cli"
exit 0
