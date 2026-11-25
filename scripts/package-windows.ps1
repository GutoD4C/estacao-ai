#Requires -Version 5.1
<#
.SYNOPSIS
    Compila e empacota a aplicação Estação-ai para Windows 10 e Windows 11 (.exe standalone, .zip portátil e instalador Setup .exe).
#>
param(
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$RepoDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$OutDir = Join-Path $RepoDir "target\packages"
$WinPkgDir = Join-Path $RepoDir "packaging\windows"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# 1. Converte docs\logo.png para packaging\windows\estacao-ai.ico (formato PNG-in-ICO nativo do Windows 10/11)
$LogoPng = Join-Path $RepoDir "docs\logo.png"
$IcoPath = Join-Path $WinPkgDir "estacao-ai.ico"
if (Test-Path -LiteralPath $LogoPng) {
    $pngBytes = [System.IO.File]::ReadAllBytes($LogoPng)
    $ms = New-Object System.IO.MemoryStream
    $bw = New-Object System.IO.BinaryWriter($ms)
    # Cabeçalho ICONDIR (0, 1=ICO, 1 imagem)
    $bw.Write([UInt16]0)
    $bw.Write([UInt16]1)
    $bw.Write([UInt16]1)
    # ICONDIRENTRY (256x256 -> 0, 0, 0, 0, 1 plane, 32bpp, size, offset=22)
    $bw.Write([Byte]0)
    $bw.Write([Byte]0)
    $bw.Write([Byte]0)
    $bw.Write([Byte]0)
    $bw.Write([UInt16]1)
    $bw.Write([UInt16]32)
    $bw.Write([UInt32]$pngBytes.Length)
    $bw.Write([UInt32]22)
    $bw.Write($pngBytes)
    $bw.Flush()
    [System.IO.File]::WriteAllBytes($IcoPath, $ms.ToArray())
    $bw.Close()
}

# 2. Compila estacao-ai.exe (release)
$ReleaseExe = Join-Path $RepoDir "target\release\estacao-ai.exe"
if (-not $SkipBuild) {
    Write-Host "▸ Compilando estacao-ai.exe (Windows 10/11 x64 release)..." -ForegroundColor Cyan
    Push-Location $RepoDir
    try {
        cargo build --locked --release -p ai-memory-cli
        if ($LASTEXITCODE -ne 0) { throw "Falha na compilação do estacao-ai.exe" }
    } finally {
        Pop-Location
    }
}

# 3. Copia o executável standalone (duplo-clique abre direto a aplicação no Windows 10/11)
$StandaloneExe = Join-Path $OutDir "Estacao-ai-win10-11-x64.exe"
Copy-Item -LiteralPath $ReleaseExe -Destination $StandaloneExe -Force
Write-Host "✓ Executável standalone gerado em: $StandaloneExe" -ForegroundColor Green

# 4. Se o Inno Setup (ISCC.exe) estiver instalado, gera também o instalador Estacao-ai-Setup-win10-11-x64.exe
$IsccCandidates = @(
    "ISCC.exe",
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles}\Inno Setup 6\ISCC.exe",
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
)
$Iscc = $IsccCandidates | Where-Object { Get-Command $_ -ErrorAction SilentlyContinue } | Select-Object -First 1
if ($Iscc) {
    Write-Host "▸ Gerando instalador Windows 10/11 via Inno Setup..." -ForegroundColor Cyan
    $Version = (& $ReleaseExe --version) -replace '^estacao-ai\s+', ''
    if ($LASTEXITCODE -ne 0 -or $Version -notmatch '^\d+\.\d+\.\d+$') { throw "Não foi possível obter a versão do binário." }
    & $Iscc "/DMyAppVersion=$Version" (Join-Path $WinPkgDir "installer.iss")
    if ($LASTEXITCODE -ne 0) { throw "Falha ao gerar o instalador com Inno Setup." }
    Write-Host "✓ Instalador gerado em: $(Join-Path $OutDir 'Estacao-ai-Setup-win10-11-x64.exe')" -ForegroundColor Green
} else {
    Write-Host "ℹ Inno Setup (ISCC.exe) não encontrado; o executável standalone '$StandaloneExe' já está pronto para uso direto no Windows 10 e 11." -ForegroundColor Yellow
}
