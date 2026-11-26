#Requires -Version 5.1
<#
.SYNOPSIS
    Instala, atualiza e abre a Estação-ai localmente neste dispositivo com um único comando.
.DESCRIPTION
    Execute no PowerShell:
        .\iniciar.ps1
    Ou, após a primeira execução, de qualquer pasta:
        estacao
#>
param(
    [switch]$Recompilar,
    [switch]$NaoAbrirNavegador,
    [switch]$SemAuth
)

$ErrorActionPreference = "Stop"
$RepoDir = $PSScriptRoot
$InstallDir = Join-Path $env:LOCALAPPDATA "Programs\estacao-ai"
$DataDir = Join-Path $env:LOCALAPPDATA "estacao-ai"
$InstalledExe = Join-Path $InstallDir "estacao-ai.exe"
$UrlChat = "http://127.0.0.1:49374/web/chat"

function Write-Passo([string]$msg) {
    Write-Host "▸ $msg" -ForegroundColor Cyan
}

function Write-Ok([string]$msg) {
    Write-Host "✓ $msg" -ForegroundColor Green
}

# 1. Garante que ferramentas instaladas neste dispositivo estejam visíveis no PATH da sessão
$ExtraPaths = @(
    (Join-Path $env:USERPROFILE ".cargo\bin"),
    (Join-Path $env:LOCALAPPDATA "agy\bin"),
    (Join-Path $env:LOCALAPPDATA "Programs\OpenAI\Codex\bin"),
    (Join-Path $env:APPDATA "npm"),
    "C:\Program Files\Git\bin",
    "C:\Program Files\Git\usr\bin"
)
$WinLibs = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\BrechtSanders.WinLibs*" -Recurse -Filter "gcc.exe" -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty DirectoryName
if ($WinLibs) { $ExtraPaths += $WinLibs }
foreach ($p in $ExtraPaths) {
    if ((Test-Path -LiteralPath $p) -and (($env:Path -split ';') -notcontains $p)) {
        $env:Path = "$p;$env:Path"
    }
}

# 2. Localiza ou compila o binário estacao-ai.exe localmente
$SourceExe = Join-Path $RepoDir "target\release\estacao-ai.exe"
if ($Recompilar -or (-not (Test-Path -LiteralPath $SourceExe) -and -not (Test-Path -LiteralPath $InstalledExe))) {
    if (-not (Test-Path -LiteralPath (Join-Path $RepoDir "Cargo.toml"))) {
        throw "Binário não encontrado e Cargo.toml ausente em $RepoDir."
    }
    Write-Passo "Compilando a Estação-ai neste dispositivo (modo release)..."
    Push-Location $RepoDir
    try {
        cargo build --locked --release -p ai-memory-cli
        if ($LASTEXITCODE -ne 0) { throw "Falha na compilação do estacao-ai." }
    } finally {
        Pop-Location
    }
} elseif (Test-Path -LiteralPath $SourceExe) {
    $ExeTime = (Get-Item -LiteralPath $SourceExe).LastWriteTimeUtc
    $MaisNovo = Get-ChildItem -Path (Join-Path $RepoDir "crates") -Recurse -File -Include *.rs,*.js,*.css,*.html -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTimeUtc -gt $ExeTime } |
        Select-Object -First 1
    if ($MaisNovo) {
        Write-Host "! Aviso: há alterações locais mais recentes que o binário compilado. Use '.\iniciar.ps1 -Recompilar' para aplicá-las." -ForegroundColor Yellow
    }
}

# 3. Instala/atualiza em %LOCALAPPDATA%\Programs\estacao-ai e registra o comando `estacao` no PATH
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
if (Test-Path -LiteralPath $SourceExe) {
    $PrecisaCopiar = $true
    if (Test-Path -LiteralPath $InstalledExe) {
        $h1 = (Get-FileHash -LiteralPath $SourceExe -Algorithm SHA256).Hash
        $h2 = (Get-FileHash -LiteralPath $InstalledExe -Algorithm SHA256).Hash
        $PrecisaCopiar = ($h1 -ne $h2)
    }
    if ($PrecisaCopiar) {
        Write-Passo "Atualizando binário local em $InstallDir..."
        if (Test-Path -LiteralPath $DataDir) {
            Set-Content -LiteralPath (Join-Path $DataDir "service-host.stop") -Value "stop" -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
        }
        Get-Process estacao-ai -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 500
        Copy-Item -LiteralPath $SourceExe -Destination $InstalledExe -Force
    }
}

foreach ($item in @("hooks", "scripts", "LICENSE", "NOTICE", "README.md")) {
    $orig = Join-Path $RepoDir $item
    if (Test-Path -LiteralPath $orig) {
        Copy-Item -LiteralPath $orig -Destination $InstallDir -Recurse -Force
    }
}
if ($PSCommandPath -and (Test-Path -LiteralPath $PSCommandPath)) {
    Copy-Item -LiteralPath $PSCommandPath -Destination (Join-Path $InstallDir "iniciar.ps1") -Force
}

$AtalhoCmd = Join-Path $InstallDir "estacao.cmd"
Set-Content -LiteralPath $AtalhoCmd -Encoding ASCII -Value "@echo off`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"%~dp0iniciar.ps1`" %*"

$EnvKey = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("Environment")
try {
    $UserPath = $EnvKey.GetValue("Path", "", "DoNotExpandEnvironmentNames")
    $Entries = if ($UserPath) { $UserPath -split ';' | Where-Object { $_ } } else { @() }
    $Expanded = $Entries | ForEach-Object { [Environment]::ExpandEnvironmentVariables($_) }
    if ($Expanded -notcontains $InstallDir) {
        $EnvKey.SetValue("Path", ((@($Entries) + $InstallDir) -join ';'), "ExpandString")
        [Environment]::SetEnvironmentVariable("estacao-ai-path-notify", [NullString]::Value, "User")
    }
} finally {
    $EnvKey.Dispose()
}
if (($env:Path -split ';') -notcontains $InstallDir) {
    $env:Path = "$InstallDir;$env:Path"
}

# 4. Integra MCP/Hooks e inicia o serviço local (preservando autenticação se configurada, salvo com -SemAuth)
Write-Passo "Iniciando serviço local e verificando integrações..."
$env:RUST_LOG = "error"
$ConfigFile = Join-Path $DataDir "config.toml"
& $InstalledExe setup --yes --no-service | Out-Host
$ConfigAlterada = $false
if ($SemAuth -and (Test-Path -LiteralPath $ConfigFile)) {
    $Linhas = Get-Content -LiteralPath $ConfigFile -Encoding UTF8
    $Novas = foreach ($l in $Linhas) {
        if ($l -match '^\s*(bearer_token_file|bearer_token)\s*=') {
            $ConfigAlterada = $true
            "# $l"
        } else {
            $l
        }
    }
    if ($ConfigAlterada) {
        Set-Content -LiteralPath $ConfigFile -Encoding UTF8 -Value $Novas
        if (Test-Path -LiteralPath $DataDir) {
            Set-Content -LiteralPath (Join-Path $DataDir "service-host.stop") -Value "stop" -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
        }
        Get-Process estacao-ai -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 400
    }
}

$Rodando = $false
if (-not $ConfigAlterada) {
    try {
        $resp = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:49374/web/chat" -TimeoutSec 2 -ErrorAction Stop
        if ($resp.StatusCode -eq 200) { $Rodando = $true }
    } catch {}
}

if (-not $Rodando) {
    Start-Process -FilePath $InstalledExe -ArgumentList @("--data-dir", $DataDir, "--config", $ConfigFile, "service-host") -WindowStyle Hidden
    for ($i = 0; $i -lt 15; $i++) {
        Start-Sleep -Milliseconds 400
        try {
            $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:49374/healthz" -TimeoutSec 1 -ErrorAction Stop
            if ($r.StatusCode -eq 200) { break }
        } catch {}
    }
}
if ($ConfigAlterada) {
    & $InstalledExe setup --yes --no-service | Out-Host
}

Write-Host ""
Write-Ok "Estação-ai rodando localmente em: $UrlChat"
Write-Host "  (Acesso direto sem login — cada dispositivo possui seus próprios projetos e modelos locais)" -ForegroundColor Gray
Write-Host "  Em qualquer terminal futuro, basta digitar: estacao" -ForegroundColor Gray
Write-Host ""

if (-not $NaoAbrirNavegador) {
    & $InstalledExe --data-dir $DataDir --config $ConfigFile app
}
