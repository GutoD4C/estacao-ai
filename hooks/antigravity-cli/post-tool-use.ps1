. "$PSScriptRoot\..\lib\estacao-ai-hook.ps1"
Invoke-AiMemoryHook -Event "post-tool-use" -Agent "antigravity-cli"
[Console]::Out.WriteLine("{}")
exit 0
