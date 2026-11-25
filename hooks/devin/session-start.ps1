. "$PSScriptRoot\..\lib\estacao-ai-hook.ps1"
Invoke-AiMemoryHook -Event "session-start" -Agent "devin" -FetchHandoff -SessionStartEnvelope
exit 0
