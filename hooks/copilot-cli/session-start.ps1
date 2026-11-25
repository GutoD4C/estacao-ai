. "$PSScriptRoot\..\lib\estacao-ai-hook.ps1"
Invoke-AiMemoryHook -Event "session-start" -Agent "copilot-cli" -FetchHandoff -CopilotCliSessionStartOutput
exit 0
