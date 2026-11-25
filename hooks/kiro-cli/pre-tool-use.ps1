# Kiro CLI v2 pre-tool-use hook (preToolUse).
# Fail-open by contract: exit 0 unconditionally and print nothing —
# exit code 2 would block the tool call.
. "$PSScriptRoot\..\lib\estacao-ai-hook.ps1"
Invoke-AiMemoryHook -Event "pre-tool-use" -Agent "kiro-cli"
exit 0
