//! Desktop application launcher (`estacao-ai app`).
//!
//! Zero-command turnkey desktop experience for `.deb`, `.AppImage`, and
//! Windows 10 & 11 `.exe`:
//! 1. On Windows, if launched from outside `%LOCALAPPDATA%\Programs\estacao-ai`
//!    (e.g. double-clicked directly from `Downloads`), self-installs the
//!    binary, adds it to the user `PATH`, and creates Desktop & Start Menu
//!    shortcuts (`Estação-ai.lnk`).
//! 2. On first launch on any OS, automatically runs `estacao-ai setup --yes`
//!    to initialize the database, wiki, MCP servers, hooks, skills, and the
//!    per-user background service without requiring any terminal commands.
//! 3. Ensures the local server (`serve --transport http --enable-web`) is
//!    running, auto-configures the detected AI models (Projetos + Chat +
//!    default "Conversas" room) if none exist yet, and opens the standalone
//!    desktop application window.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use anyhow::Result;

use crate::cli::{AppArgs, Command as CliCommand};
use crate::config::Config;

const AUTO_SETUP_MARKER: &str = ".auto-setup-v1";

pub async fn run(config: &Config, args: AppArgs, config_path: Option<&Path>) -> Result<()> {
    let _ = std::fs::create_dir_all(&config.data_dir);

    #[cfg(windows)]
    let exe_path = ensure_windows_self_install();
    #[cfg(not(windows))]
    let exe_path = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("estacao-ai"));

    ensure_first_run_setup(&exe_path, &config.data_dir);

    let base_url = crate::http_client::display_url(&config.server_url)
        .trim_end_matches('/')
        .to_owned();
    let base_url = if base_url.is_empty() {
        "http://127.0.0.1:49374".to_owned()
    } else {
        base_url
    };
    let page = args
        .page
        .as_deref()
        .unwrap_or("chat")
        .trim_start_matches('/');
    let app_url = format!("{base_url}/web/{page}");
    let health_url = format!("{base_url}/healthz");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(1200))
        .no_proxy()
        .build()?;

    let already_running = client
        .get(&health_url)
        .send()
        .await
        .is_ok_and(|r| r.status().is_success());

    if already_running {
        if !args.no_open {
            launch_desktop_shell_or_restore(&app_url, &config.data_dir, &exe_path, config_path);
        }
        println!("Estação-ai ativa em: {app_url}");
        return Ok(());
    }

    if !args.no_open && start_windows_service_host(&exe_path, &config.data_dir) {
        for _ in 0..60 {
            tokio::time::sleep(Duration::from_millis(250)).await;
            if client
                .get(&health_url)
                .send()
                .await
                .is_ok_and(|r| r.status().is_success())
            {
                launch_desktop_shell_or_restore(&app_url, &config.data_dir, &exe_path, config_path);
                println!("Estação-ai ativa em: {app_url}");
                return Ok(());
            }
        }
    }

    let poll_client = client.clone();
    let poll_health = health_url.clone();
    let launch_url = app_url.clone();
    let data_dir = config.data_dir.clone();
    let tray_exe = exe_path.clone();
    let tray_cfg = config_path.map(Path::to_path_buf);
    let no_open = args.no_open;
    tokio::spawn(async move {
        for _ in 0..60 {
            tokio::time::sleep(Duration::from_millis(250)).await;
            if poll_client
                .get(&poll_health)
                .send()
                .await
                .is_ok_and(|r| r.status().is_success())
            {
                if !no_open {
                    launch_desktop_shell_or_restore(
                        &launch_url,
                        &data_dir,
                        &tray_exe,
                        tray_cfg.as_deref(),
                    );
                }
                break;
            }
        }
    });

    let parsed =
        crate::cli::try_parse_from(["estacao-ai", "serve", "--transport", "http", "--enable-web"])
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;

    if let CliCommand::Serve(serve_args) = parsed.command {
        super::serve::run(config, serve_args).await
    } else {
        Ok(())
    }
}

/// Runs `estacao-ai setup --yes` once on first launch so MCP, hooks, skills,
/// database, wiki, and background service are configured automatically.
fn ensure_first_run_setup(exe_path: &Path, data_dir: &Path) {
    let marker = data_dir.join(AUTO_SETUP_MARKER);
    if marker.exists() {
        return;
    }

    let mut cmd = Command::new(exe_path);
    cmd.args(["--data-dir"])
        .arg(data_dir)
        .args(["setup", "--yes"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let _ = cmd.status();

    let _ = std::fs::write(&marker, b"ok\n");
}

/// On Windows 10 & 11, if the user double-clicks the standalone `.exe` from
/// `Downloads` or Desktop, automatically installs it into
/// `%LOCALAPPDATA%\Programs\estacao-ai\estacao-ai.exe` and creates Desktop &
/// Start Menu shortcuts so no installer or terminal command is needed.
#[cfg(windows)]
fn ensure_windows_self_install() -> PathBuf {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let current = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("estacao-ai.exe"));
    let Some(local_app_data) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) else {
        return current;
    };
    let install_dir = local_app_data.join("Programs").join("estacao-ai");
    let installed_exe = install_dir.join("estacao-ai.exe");

    if current != installed_exe && std::fs::create_dir_all(&install_dir).is_ok() {
        let _ = std::fs::copy(&current, &installed_exe);
    }

    let target_exe = if installed_exe.exists() {
        installed_exe
    } else {
        current
    };

    let shortcut_marker = install_dir.join(".shortcuts-v1");
    if !shortcut_marker.exists() {
        let exe_str = target_exe.display().to_string().replace('\'', "''");
        let ps_script = format!(
            "$ws = New-Object -ComObject WScript.Shell; \
             foreach ($dir in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {{ \
               if ($dir -and (Test-Path $dir)) {{ \
                 $lnk = $ws.CreateShortcut((Join-Path $dir 'Estação-ai.lnk')); \
                 $lnk.TargetPath = '{exe_str}'; \
                 $lnk.Arguments = 'app'; \
                 $lnk.IconLocation = '{exe_str},0'; \
                 $lnk.Description = 'Estação-ai — Estação Orbital de IA'; \
                 $lnk.Save(); \
               }} \
             }}"
        );
        let _ = Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                &ps_script,
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .status();
        let _ = std::fs::write(&shortcut_marker, b"ok\n");
    }

    target_exe
}

fn build_desktop_target_url(url: &str, data_dir: &Path) -> String {
    // The desktop owner can enroll a signer. Only a digest is stored on disk.
    // The fragment stays in the browser and is never sent in an HTTP URL.
    let mut target = url.to_owned();
    if let Ok(mut local) = reqwest::Url::parse(url)
        && matches!(local.scheme(), "http" | "https")
        && matches!(local.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
    {
        use sha2::{Digest, Sha256};
        use std::io::Write;
        let ticket = uuid::Uuid::new_v4().to_string();
        let result = (|| -> std::io::Result<()> {
            let mut file = tempfile::NamedTempFile::new_in(data_dir)?;
            write!(file, "{:x}", Sha256::digest(ticket.as_bytes()))?;
            file.persist(data_dir.join(".nostr-desktop"))?;
            Ok(())
        })();
        if result.is_ok() {
            local.set_fragment(Some(&format!("estacao-vinculo={ticket}")));
            target = local.to_string();
        }
    }
    target
}

fn launch_desktop_shell_or_restore(
    url: &str,
    data_dir: &Path,
    exe_path: &Path,
    config_path: Option<&Path>,
) {
    let target = build_desktop_target_url(url, data_dir);
    // 1. Prefer the native Tauri desktop binary (`estacao-ai-desktop`) when present.
    if launch_native_desktop_shell() {
        super::windows_tray::ensure_detached_tray(data_dir, exe_path, config_path);
        return;
    }
    // 2. On Linux, prefer the native GTK3 + WebKit2 desktop window integrated with the system tray.
    if super::windows_tray::launch_linux_native_app(&target, data_dir, exe_path, config_path) {
        return;
    }
    // 3. Otherwise ensure tray and restore/launch isolated frameless Chromium app window.
    super::windows_tray::ensure_detached_tray(data_dir, exe_path, config_path);
    if super::windows_tray::restore_if_running(data_dir) {
        return;
    }
    open_desktop_window(url, data_dir);
}

pub fn open_desktop_window(url: &str, data_dir: &Path) {
    let target = build_desktop_target_url(url, data_dir);
    let url = target.as_str();
    // 1. Prefer the native Tauri desktop binary (`estacao-ai-desktop`) when present.
    if launch_native_desktop_shell() {
        return;
    }
    // 2. Otherwise open an isolated frameless desktop app window (no browser tabs/address bar).
    if launch_isolated_app_window(url, data_dir) {
        return;
    }
    // 3. Final fallback if no desktop shell or Chromium app-mode binary is available.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = Command::new("cmd")
            .args(["/C", "start", "", url])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
    }

    #[cfg(target_os = "linux")]
    {
        let _ = Command::new("xdg-open")
            .arg(url)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
    }

    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("open")
            .arg(url)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
    }
}

fn launch_native_desktop_shell() -> bool {
    let bin_name = if cfg!(windows) {
        "estacao-ai-desktop.exe"
    } else {
        "estacao-ai-desktop"
    };
    let mut candidates = Vec::new();
    if let Ok(me) = std::env::current_exe()
        && let Some(dir) = me.parent()
    {
        candidates.push(dir.join(bin_name));
    }
    candidates.push(PathBuf::from(bin_name));

    for cand in candidates {
        let mut cmd = Command::new(&cand);
        cmd.stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        if cmd.spawn().is_ok() {
            return true;
        }
    }
    false
}

fn start_windows_service_host(exe_path: &Path, data_dir: &Path) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut cmd = Command::new(exe_path);
        cmd.arg("--data-dir").arg(data_dir);
        let config_file = data_dir.join("config.toml");
        if config_file.is_file() {
            cmd.arg("--config").arg(&config_file);
        }
        cmd.arg("service-host")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW);
        cmd.spawn().is_ok()
    }
    #[cfg(not(windows))]
    {
        let _ = (exe_path, data_dir);
        false
    }
}

fn launch_isolated_app_window(url: &str, data_dir: &Path) -> bool {
    let profile_dir = data_dir.join("desktop-app-profile");
    let _ = std::fs::create_dir_all(&profile_dir);
    let app_arg = format!("--app={url}");
    let profile_arg = format!("--user-data-dir={}", profile_dir.display());

    let browsers = isolated_app_browser_candidates(&profile_dir);
    for bin in browsers {
        let mut cmd = Command::new(&bin);
        cmd.args([
            app_arg.as_str(),
            profile_arg.as_str(),
            "--class=EstacaoAI",
            "--no-first-run",
            "--no-default-browser-check",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        if cmd.spawn().is_ok() {
            return true;
        }
    }
    false
}

fn isolated_app_browser_candidates(profile_dir: &Path) -> Vec<OsString> {
    #[cfg(target_os = "linux")]
    {
        let _ = profile_dir;
        [
            "google-chrome",
            "google-chrome-stable",
            "chromium",
            "chromium-browser",
            "brave-browser",
            "microsoft-edge",
        ]
        .into_iter()
        .map(OsString::from)
        .collect()
    }
    #[cfg(windows)]
    {
        let env_roots = [
            std::env::var_os("ProgramFiles(x86)").map(PathBuf::from),
            std::env::var_os("ProgramFiles").map(PathBuf::from),
            std::env::var_os("LOCALAPPDATA").map(PathBuf::from),
        ];
        windows_chromium_candidates(profile_dir, &env_roots)
    }
    #[cfg(target_os = "macos")]
    {
        let _ = profile_dir;
        [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        ]
        .into_iter()
        .map(OsString::from)
        .collect()
    }
}

#[cfg(any(windows, test))]
fn windows_chromium_candidates(profile_dir: &Path, roots: &[Option<PathBuf>]) -> Vec<OsString> {
    let mut out: Vec<OsString> = Vec::new();
    let mut push_unique = |cand: OsString| {
        if !out.contains(&cand) {
            out.push(cand);
        }
    };

    // Preserve the Chromium binary that already owns `desktop-app-profile` when present.
    if let Ok(raw) = std::fs::read_to_string(profile_dir.join("Last Browser")) {
        let recorded = raw.trim_matches(|c: char| c.is_whitespace() || c == '\0');
        if !recorded.is_empty() {
            let path = PathBuf::from(recorded);
            if path.is_file() {
                push_unique(path.into_os_string());
            }
        }
    }

    let relative_bins = [
        r"Microsoft\Edge\Application\msedge.exe",
        r"Google\Chrome\Application\chrome.exe",
        r"BraveSoftware\Brave-Browser\Application\brave.exe",
    ];
    for rel in relative_bins {
        for root in roots.iter().flatten() {
            let cand = root.join(rel);
            if cand.is_file() {
                push_unique(cand.into_os_string());
            }
        }
    }

    for bare in ["msedge.exe", "chrome.exe", "brave.exe"] {
        push_unique(OsString::from(bare));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::windows_chromium_candidates;
    use std::ffi::OsString;
    use std::path::PathBuf;

    #[test]
    fn windows_candidates_discover_full_paths_and_last_browser() {
        let tmp = tempfile::tempdir().unwrap();
        let pf86 = tmp.path().join("pf86");
        let pf = tmp.path().join("pf");
        let profile = tmp.path().join("desktop-app-profile");
        std::fs::create_dir_all(&profile).unwrap();

        let edge = pf86.join(r"Microsoft\Edge\Application\msedge.exe");
        let chrome = pf.join(r"Google\Chrome\Application\chrome.exe");
        std::fs::create_dir_all(edge.parent().unwrap()).unwrap();
        std::fs::create_dir_all(chrome.parent().unwrap()).unwrap();
        std::fs::write(&edge, b"").unwrap();
        std::fs::write(&chrome, b"").unwrap();

        std::fs::write(
            profile.join("Last Browser"),
            format!("{}\0", chrome.display()),
        )
        .unwrap();

        let found = windows_chromium_candidates(&profile, &[Some(pf86), Some(pf), None]);
        assert_eq!(found[0], chrome.as_os_str());
        assert_eq!(found[1], edge.as_os_str());
        assert_eq!(
            found
                .iter()
                .filter(|entry| *entry == chrome.as_os_str())
                .count(),
            1
        );
        assert!(found.contains(&OsString::from("msedge.exe")));
        assert!(found.contains(&OsString::from("chrome.exe")));
        assert!(found.contains(&OsString::from("brave.exe")));
        assert!(!found.contains(&PathBuf::from("nonexistent.exe").into_os_string()));
    }
}
