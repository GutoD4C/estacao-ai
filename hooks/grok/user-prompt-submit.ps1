# Do not fetch /handoff. Grok discards allowing UserPromptSubmit stdout,
# and GET /handoff would accept the handoff anyway.
. "$PSScriptRoot\..\lib\estacao-ai-hook.ps1"
Invoke-AiMemoryHook -Event "user-prompt" -Agent "grok"
exit 0
