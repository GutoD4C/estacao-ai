. "$PSScriptRoot\..\lib\estacao-ai-hook.ps1"
Invoke-AiMemoryHook -Event "session-start" -Agent "antigravity-cli" -FetchHandoff -AntigravityStartOutput -AntigravityPreInvocation
exit 0
