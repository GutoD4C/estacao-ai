//! Ícone na bandeja do sistema (área de notificação da barra de tarefas) no Windows.
//!
//! Executa um host STA leve sem janela de console enquanto `service-host --supervise`
//! mantém o servidor ativo em segundo plano, permitindo:
//! - Abrir/restaurar a janela da Estação I.A com um clique ou pelo menu;
//! - Fechar de vez o serviço em segundo plano e as janelas isoladas do app.

use std::path::Path;
use std::process::Child;
#[cfg(windows)]
use std::{
    path::PathBuf,
    process::{Command, Stdio},
};

#[cfg(windows)]
const TRAY_SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$exe = $env:ESTACAO_TRAY_EXE
$dataDir = $env:ESTACAO_TRAY_DATA_DIR
$cfgPath = $env:ESTACAO_TRAY_CONFIG
$stopFile = $env:ESTACAO_TRAY_STOP
$icoPath = $env:ESTACAO_TRAY_ICO
$parentPid = 0
[int]::TryParse($env:ESTACAO_TRAY_PID, [ref]$parentPid) | Out-Null

function Open-EstacaoApp {
    $argsList = @('--data-dir', $dataDir)
    if ($cfgPath) { $argsList += @('--config', $cfgPath) }
    $argsList += 'app'
    $quotedArgs = ($argsList | ForEach-Object { '"' + $_ + '"' }) -join ' '
    Start-Process -FilePath $exe -ArgumentList $quotedArgs -WindowStyle Hidden | Out-Null
}

function Close-IsolatedWindows {
    $profNeedle = (Join-Path $dataDir 'desktop-app-profile').ToLowerInvariant()
    try {
        Get-CimInstance Win32_Process | Where-Object {
            $_.Name -in @('msedge.exe', 'chrome.exe', 'brave.exe') -and
            $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($profNeedle)
        } | ForEach-Object {
            try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
        }
    } catch {}
}

$ctx = New-Object System.Windows.Forms.ApplicationContext
$notify = New-Object System.Windows.Forms.NotifyIcon
if ($icoPath -and (Test-Path -LiteralPath $icoPath)) {
    try { $notify.Icon = New-Object System.Drawing.Icon($icoPath) } catch {}
}
if (-not $notify.Icon -and $exe -and (Test-Path -LiteralPath $exe)) {
    try { $notify.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon($exe) } catch {}
}
if (-not $notify.Icon) {
    $notify.Icon = [System.Drawing.SystemIcons]::Application
}
$notify.Text = 'Estação I.A — Em execução'
$notify.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$itemAbrir = $menu.Items.Add('Abrir Estação I.A')
$itemAbrir.Font = New-Object System.Drawing.Font($itemAbrir.Font, [System.Drawing.FontStyle]::Bold)
$itemAbrir.add_Click({ Open-EstacaoApp })

[void]$menu.Items.Add('-')
$itemFechar = $menu.Items.Add('Fechar Estação I.A de vez')
$itemFechar.add_Click({
    try { [System.IO.File]::WriteAllText($stopFile, 'stop') } catch {}
    Close-IsolatedWindows
    $notify.Visible = $false
    $notify.Dispose()
    $ctx.ExitThread()
})

$notify.ContextMenuStrip = $menu
$notify.add_MouseClick({
    param($s, $e)
    if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
        Open-EstacaoApp
    }
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 500
$timer.add_Tick({
    $parentGone = ($parentPid -gt 0) -and (-not (Get-Process -Id $parentPid -ErrorAction SilentlyContinue))
    if ($parentGone -or ($stopFile -and (Test-Path -LiteralPath $stopFile))) {
        $timer.Stop()
        Close-IsolatedWindows
        $notify.Visible = $false
        $notify.Dispose()
        $ctx.ExitThread()
    }
})
$timer.Start()

[System.Windows.Forms.Application]::Run($ctx)
"#;

/// Mantém o ícone da bandeja ativo enquanto o supervisor estiver vivo.
pub(crate) struct TrayGuard {
    child: Option<Child>,
}

impl TrayGuard {
    pub(crate) fn spawn(
        data_dir: &Path,
        exe: &Path,
        config_path: Option<&Path>,
        stop_request: &Path,
    ) -> Self {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt as _;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;

            let ico_path = exe
                .parent()
                .map(|dir| dir.join("estacao-ai.ico"))
                .filter(|p| p.is_file())
                .unwrap_or_else(|| PathBuf::from("estacao-ai.ico"));

            let mut cmd = Command::new("powershell");
            cmd.args([
                "-NoProfile",
                "-NonInteractive",
                "-STA",
                "-WindowStyle",
                "Hidden",
                "-Command",
                TRAY_SCRIPT,
            ])
            .env("ESTACAO_TRAY_EXE", exe)
            .env("ESTACAO_TRAY_DATA_DIR", data_dir)
            .env(
                "ESTACAO_TRAY_CONFIG",
                config_path
                    .map(|p| p.as_os_str().to_os_string())
                    .unwrap_or_default(),
            )
            .env("ESTACAO_TRAY_STOP", stop_request)
            .env("ESTACAO_TRAY_ICO", &ico_path)
            .env("ESTACAO_TRAY_PID", std::process::id().to_string())
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

            Self {
                child: cmd.spawn().ok(),
            }
        }
        #[cfg(not(windows))]
        {
            let _ = (data_dir, exe, config_path, stop_request);
            Self { child: None }
        }
    }
}

impl Drop for TrayGuard {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
