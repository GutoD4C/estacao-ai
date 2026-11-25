//! The desktop installer's window. It finds or installs `estacao-ai` (see the
//! library), runs `estacao-ai setup --web --no-open`, and shows the page that
//! command serves. Closing the window stops that command; finishing on the
//! page closes the window.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, PoisonError};

use ai_memory_desktop::{
    Choice, EXE_NAME, Layout, choose, find_on_path, install_bundled, package_manager_dirs,
};
use anyhow::{Context as _, Result};
use tauri::{AppHandle, Manager as _, RunEvent, WebviewWindow};

type Running = Arc<Mutex<Option<Child>>>;

fn main() {
    let running: Running = Arc::new(Mutex::new(None));
    let for_setup = Arc::clone(&running);
    let app = tauri::Builder::default()
        .setup(move |app| {
            let window = app
                .get_webview_window("main")
                .context("the main window is missing")?;
            let handle = app.handle().clone();
            let running = Arc::clone(&for_setup);
            std::thread::spawn(move || {
                if let Err(error) = run(&handle, &window, &running) {
                    show(&window, "error", &format!("{error:#}"));
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!());
    let app = match app {
        Ok(app) => app,
        Err(error) => {
            eprintln!("estacao-ai setup: could not open its window: {error}");
            std::process::exit(1);
        }
    };
    app.run(move |_, event| {
        if let RunEvent::Exit = event {
            stop(&running);
        }
    });
}

/// Show a status line on the local loading page.
fn show(window: &WebviewWindow, kind: &str, message: &str) {
    let call = format!(
        "window.showStatus && window.showStatus({}, {})",
        serde_json::Value::from(kind),
        serde_json::Value::from(message)
    );
    let _ = window.eval(&call);
}

fn stop(running: &Running) {
    let mut slot = running.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(mut child) = slot.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn run(app: &AppHandle, window: &WebviewWindow, running: &Running) -> Result<()> {
    let paths = app.path();
    let home = paths.home_dir().context("locating your home directory")?;
    let layout = Layout::for_platform(&home, paths.local_data_dir().ok().as_deref());
    let search = std::env::join_paths(
        std::env::var_os("PATH")
            .map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
            .unwrap_or_default()
            .into_iter()
            .chain(package_manager_dirs(&home)),
    )
    .ok();
    let exe = match choose(&layout, find_on_path(search)) {
        Choice::Existing(exe) => {
            show(
                window,
                "info",
                &format!("Using estacao-ai at {}", exe.display()),
            );
            exe
        }
        Choice::InstallBundled => {
            let bundled = bundled_exe()?;
            let hooks = paths.resource_dir().ok().map(|dir| dir.join("hooks"));
            show(
                window,
                "info",
                &format!("Installing estacao-ai to {}", layout.lib_dir.display()),
            );
            let installed = install_bundled(&layout, &bundled, hooks.as_deref())?;
            if cfg!(windows) {
                add_to_user_path(&layout.lib_dir)?;
            }
            installed
        }
    };
    show(window, "info", "Iniciando serviço local da Estação I.A…");
    let addr = "127.0.0.1:49374";
    if !servidor_local_ativo(addr) {
        let child = app_daemon_command(&exe)
            .spawn()
            .with_context(|| format!("iniciando {} app --no-open", exe.display()))?;
        *running.lock().unwrap_or_else(PoisonError::into_inner) = Some(child);
        for _ in 0..80 {
            if servidor_local_ativo(addr) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(250));
        }
    }
    if !servidor_local_ativo(addr) {
        anyhow::bail!(
            "O serviço local da Estação I.A não respondeu em http://{addr}. Verifique os logs em ~/.local/share/estacao-ai/logs."
        );
    }
    let url = format!("http://{addr}/web/chat");
    window
        .navigate(url.parse().context("lendo endereço local da Estação I.A")?)
        .context("abrindo a interface desktop da Estação I.A")?;
    Ok(())
}

fn servidor_local_ativo(addr: &str) -> bool {
    let Ok(sock) = addr.parse::<std::net::SocketAddr>() else {
        return false;
    };
    std::net::TcpStream::connect_timeout(&sock, std::time::Duration::from_millis(300)).is_ok()
}

fn app_daemon_command(exe: &Path) -> Command {
    let mut command = Command::new(exe);
    command
        .args(["app", "--no-open"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// The `estacao-ai` the bundle carries, which Tauri places beside this
/// executable.
fn bundled_exe() -> Result<PathBuf> {
    let me = std::env::current_exe().context("locating this app")?;
    let bundled = me
        .parent()
        .map(|dir| dir.join(EXE_NAME))
        .filter(|path| path.is_file())
        .context(
            "this build carries no estacao-ai binary; install it from \
             https://github.com/GutoD4C/estacao-ai/releases and open this app again",
        )?;
    Ok(bundled)
}

/// Add the install directory to the user `PATH` the way `install.ps1` does.
/// The registry value is read and written as is, so it stays `REG_EXPAND_SZ`
/// with its `%VAR%` entries unexpanded (#1509), and removing a variable that
/// does not exist makes .NET tell open Explorer windows about the change. Any
/// failure stops the script, so its exit status reports it. The directory
/// reaches the script as an environment variable, never as script text.
fn add_to_user_path(dir: &Path) -> Result<()> {
    const SCRIPT: &str = "$ErrorActionPreference = 'Stop'; \
        $d = $env:AI_MEMORY_DESKTOP_DIR; \
        $k = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment'); \
        try { \
          $p = $k.GetValue('Path', '', 'DoNotExpandEnvironmentNames'); \
          $e = @(); if ($p) { $e = @($p -split ';' | Where-Object { $_ }) }; \
          $have = $e | ForEach-Object { \
            [Environment]::ExpandEnvironmentVariables($_).TrimEnd('\\').ToLowerInvariant() }; \
          if ($have -notcontains $d.TrimEnd('\\').ToLowerInvariant()) { \
            $k.SetValue('Path', (@($e) + $d) -join ';', 'ExpandString'); \
            $n = 'estacao-ai-desktop-' + [Guid]::NewGuid().ToString('N'); \
            [Environment]::SetEnvironmentVariable($n, [NullString]::Value, 'User') } \
        } finally { $k.Dispose() }";
    let mut command = Command::new("powershell");
    command
        .args(["-NoProfile", "-NonInteractive", "-Command", SCRIPT])
        .env("AI_MEMORY_DESKTOP_DIR", dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let status = command
        .status()
        .context("running powershell to update PATH")?;
    if !status.success() {
        anyhow::bail!("could not add {} to your PATH", dir.display());
    }
    Ok(())
}
