. "$PSScriptRoot\..\lib\estacao-ai-hook.ps1"
Invoke-AiMemoryHook -Event "session-end" -Agent "gemini-cli"
exit 0
