. "$PSScriptRoot\..\lib\estacao-ai-hook.ps1"
Invoke-AiMemoryHook -Event "session-start" -Agent "claude-code" -FetchHandoff -SessionStartEnvelope
exit 0
