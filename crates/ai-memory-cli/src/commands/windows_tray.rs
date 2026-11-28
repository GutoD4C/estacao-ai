//! Ícone na bandeja / área de notificação e janela nativa desktop (Windows e Linux).
//!
//! Mantém o ícone ativo enquanto a Estação I.A estiver em execução, permitindo:
//! - Abrir a Estação I.A em janela nativa própria no Linux (GTK3 + WebKit2 4.1) ou isolada;
//! - Minimizar automaticamente para a área de tarefas quando a janela for minimizada/fechada;
//! - Alternar abrir/minimizar pelo ícone ou menu de contexto (botão direito);
//! - Fechar de vez as janelas do aplicativo e o serviço em segundo plano pelo menu do botão direito.

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use anyhow::Result;
use fs2::FileExt as _;

use crate::cli::TrayArgs;
use crate::config::Config;

const LOGO_PNG: &[u8] = include_bytes!("../../../../docs/logo.png");
const TRAY_LOCK_FILE: &str = ".tray.lock";
const TRAY_RESTORE_REQ: &str = "tray-restore.req";
const TRAY_OPEN_REQ: &str = "tray-open.req";
const SERVICE_STATE_FILE: &str = "service-host.json";

#[cfg(windows)]
const TRAY_SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class EstacaoWin32 {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    public static List<IntPtr> FindProcessWindows(HashSet<uint> targetPids) {
        var list = new List<IntPtr>();
        if (targetPids == null || targetPids.Count == 0) return list;
        EnumWindows((hWnd, lParam) => {
            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);
            if (targetPids.Contains(pid)) {
                list.Add(hWnd);
            }
            return true;
        }, IntPtr.Zero);
        return list;
    }
}
"@

$exe = $env:ESTACAO_TRAY_EXE
$dataDir = $env:ESTACAO_TRAY_DATA_DIR
$cfgPath = $env:ESTACAO_TRAY_CONFIG
$stopFile = $env:ESTACAO_TRAY_STOP
$restoreFile = $env:ESTACAO_TRAY_RESTORE
$icoPath = $env:ESTACAO_TRAY_ICO
$parentPid = 0
[int]::TryParse($env:ESTACAO_TRAY_PID, [ref]$parentPid) | Out-Null

$script:hiddenHandles = New-Object System.Collections.Generic.HashSet[IntPtr]
$script:notifiedMinimize = $false

function Get-EstacaoAppPids {
    $set = New-Object System.Collections.Generic.HashSet[uint32]
    $profNeedle = (Join-Path $dataDir 'desktop-app-profile').ToLowerInvariant()
    try {
        Get-CimInstance Win32_Process | Where-Object {
            ($_.Name -in @('msedge.exe', 'chrome.exe', 'brave.exe') -and
             $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($profNeedle)) -or
            ($_.Name -eq 'estacao-ai-desktop.exe')
        } | ForEach-Object {
            [void]$set.Add([uint32]$_.ProcessId)
        }
    } catch {}
    return $set
}

function Prune-HiddenHandles {
    $stale = @()
    foreach ($h in $script:hiddenHandles) {
        if (-not [EstacaoWin32]::IsWindow($h)) { $stale += $h }
    }
    foreach ($h in $stale) { [void]$script:hiddenHandles.Remove($h) }
}

function Get-VisibleEstacaoWindows {
    $pids = Get-EstacaoAppPids
    $wins = [EstacaoWin32]::FindProcessWindows($pids)
    $vis = @()
    foreach ($h in $wins) {
        if ([EstacaoWin32]::IsWindowVisible($h)) { $vis += $h }
    }
    return $vis
}

function Minimize-EstacaoToTray {
    param([bool]$Silent = $false)
    $vis = Get-VisibleEstacaoWindows
    $hidAny = $false
    foreach ($h in $vis) {
        [void]$script:hiddenHandles.Add($h)
        [void][EstacaoWin32]::ShowWindow($h, 0)
        $hidAny = $true
    }
    if ($hidAny -and -not $Silent -and -not $script:notifiedMinimize) {
        $script:notifiedMinimize = $true
        try {
            $notify.ShowBalloonTip(2500, 'Estação I.A', 'Em execução na área de notificação. Clique direito para abrir ou fechar.', [System.Windows.Forms.ToolTipIcon]::Info)
        } catch {}
    }
}

function Restore-EstacaoWindows {
    Prune-HiddenHandles
    $restored = $false
    $toRestore = New-Object System.Collections.Generic.HashSet[IntPtr]
    foreach ($h in $script:hiddenHandles) { [void]$toRestore.Add($h) }
    foreach ($h in (Get-VisibleEstacaoWindows)) { [void]$toRestore.Add($h) }

    foreach ($h in $toRestore) {
        if ([EstacaoWin32]::IsWindow($h)) {
            [void][EstacaoWin32]::ShowWindow($h, 5)
            [void][EstacaoWin32]::ShowWindow($h, 9)
            [void][EstacaoWin32]::SetForegroundWindow($h)
            [void]$script:hiddenHandles.Remove($h)
            $restored = $true
        }
    }
    return $restored
}

function Open-EstacaoApp {
    if (Restore-EstacaoWindows) { return }
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
            ($_.Name -in @('msedge.exe', 'chrome.exe', 'brave.exe') -and
             $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($profNeedle)) -or
            ($_.Name -eq 'estacao-ai-desktop.exe')
        } | ForEach-Object {
            try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
        }
    } catch {}
}

function Stop-EstacaoServer {
    if ($stopFile) {
        try { [System.IO.File]::WriteAllText($stopFile, 'stop') } catch {}
    }
    $holderPath = Join-Path $dataDir '.serve.lock.holder'
    if (Test-Path -LiteralPath $holderPath) {
        try {
            $txt = Get-Content -LiteralPath $holderPath -Raw
            if ($txt -match 'pid=(\d+)') {
                $srvPid = [int]$Matches[1]
                $proc = Get-Process -Id $srvPid -ErrorAction SilentlyContinue
                if ($proc -and $proc.ProcessName -like 'estacao-ai*') {
                    Stop-Process -Id $srvPid -ErrorAction SilentlyContinue
                }
            }
        } catch {}
    }
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

$itemMinimizar = $menu.Items.Add('Minimizar para a área de tarefas')
$itemMinimizar.add_Click({ Minimize-EstacaoToTray -Silent $true })

[void]$menu.Items.Add('-')
$itemFechar = $menu.Items.Add('Fechar Estação I.A de vez')
$itemFechar.add_Click({
    Stop-EstacaoServer
    Close-IsolatedWindows
    $notify.Visible = $false
    $notify.Dispose()
    $ctx.ExitThread()
})

$menu.add_Opening({
    Prune-HiddenHandles
    $vis = Get-VisibleEstacaoWindows
    $itemMinimizar.Enabled = ($vis.Count -gt 0)
})

$notify.ContextMenuStrip = $menu
$notify.add_MouseClick({
    param($s, $e)
    if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
        $vis = Get-VisibleEstacaoWindows
        $algumaAtiva = $false
        foreach ($h in $vis) {
            if (-not [EstacaoWin32]::IsIconic($h)) { $algumaAtiva = $true; break }
        }
        if ($algumaAtiva) {
            Minimize-EstacaoToTray -Silent $true
        } else {
            Open-EstacaoApp
        }
    }
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 350
$timer.add_Tick({
    $parentGone = ($parentPid -gt 0) -and (-not (Get-Process -Id $parentPid -ErrorAction SilentlyContinue))
    if ($parentGone -or ($stopFile -and (Test-Path -LiteralPath $stopFile))) {
        $timer.Stop()
        Close-IsolatedWindows
        $notify.Visible = $false
        $notify.Dispose()
        $ctx.ExitThread()
        return
    }
    if ($restoreFile -and (Test-Path -LiteralPath $restoreFile)) {
        try { Remove-Item -LiteralPath $restoreFile -Force -ErrorAction SilentlyContinue } catch {}
        [void](Restore-EstacaoWindows)
    }
    Prune-HiddenHandles
    foreach ($h in (Get-VisibleEstacaoWindows)) {
        if ([EstacaoWin32]::IsIconic($h)) {
            [void]$script:hiddenHandles.Add($h)
            [void][EstacaoWin32]::ShowWindow($h, 0)
            if (-not $script:notifiedMinimize) {
                $script:notifiedMinimize = $true
                try {
                    $notify.ShowBalloonTip(2500, 'Estação I.A', 'Minimizou para a área de notificação. Clique direito para abrir ou fechar.', [System.Windows.Forms.ToolTipIcon]::Info)
                } catch {}
            }
        }
    }
})
$timer.Start()

[System.Windows.Forms.Application]::Run($ctx)
"#;

#[cfg(any(target_os = "linux", test))]
const LINUX_TRAY_SCRIPT: &str = r###"
import fcntl
import os
import shutil
import signal
import subprocess
import sys
from urllib.parse import urlparse

try:
    import gi
    gi.require_version("Gtk", "3.0")
    from gi.repository import Gdk, GLib, Gtk
except Exception:
    sys.exit(0)

WebKit2 = None
HAS_WEBKIT = False
for _wk_ver in ("4.1", "4.0"):
    try:
        gi.require_version("WebKit2", _wk_ver)
        from gi.repository import WebKit2 as _wk
        WebKit2 = _wk
        HAS_WEBKIT = True
        break
    except Exception:
        continue

HAS_INDICATOR = False
AppIndicator3 = None
for _ns in ("AyatanaAppIndicator3", "AppIndicator3"):
    try:
        gi.require_version(_ns, "0.1")
        AppIndicator3 = getattr(__import__("gi.repository", fromlist=[_ns]), _ns)
        HAS_INDICATOR = True
        break
    except Exception:
        continue

EXE = os.environ.get("ESTACAO_TRAY_EXE", "estacao-ai")
DATA_DIR = os.environ.get("ESTACAO_TRAY_DATA_DIR", "")
CFG_PATH = os.environ.get("ESTACAO_TRAY_CONFIG", "")
STOP_FILE = os.environ.get("ESTACAO_TRAY_STOP", "")
RESTORE_FILE = os.environ.get("ESTACAO_TRAY_RESTORE", "")
OPEN_FILE = os.environ.get("ESTACAO_TRAY_OPEN_REQ", "")
INITIAL_URL = os.environ.get("ESTACAO_TRAY_URL", "")
ICON_PATH = os.environ.get("ESTACAO_TRAY_PNG", "")
PARENT_PID = 0
try:
    PARENT_PID = int(os.environ.get("ESTACAO_TRAY_PID", "0") or "0")
except Exception:
    PARENT_PID = 0

LOCK_FILE = os.path.join(DATA_DIR, ".tray.lock") if DATA_DIR else ""
SKIP_LOCK = os.environ.get("ESTACAO_TRAY_SKIP_LOCK", "") == "1"
lock_handle = None
if LOCK_FILE and not SKIP_LOCK:
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        lock_handle = open(LOCK_FILE, "a+")
        fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except Exception:
        sys.exit(0)

HAS_WMCTRL = shutil.which("wmctrl") is not None
HAS_XDOTOOL = shutil.which("xdotool") is not None
HAS_XPROP = shutil.which("xprop") is not None
hidden_xids = set()

native_window = None
native_webview = None
restoring_native = False


def _profile_needle():
    return os.path.join(DATA_DIR, "desktop-app-profile") if DATA_DIR else "desktop-app-profile"


def _is_loopback_http(uri):
    try:
        parsed = urlparse(uri)
        return parsed.scheme in ("http", "https") and parsed.hostname in ("127.0.0.1", "localhost", "::1")
    except Exception:
        return False


def _open_external(uri):
    try:
        parsed = urlparse(uri)
        if parsed.scheme in ("http", "https"):
            subprocess.Popen(["xdg-open", uri], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass


def _resolve_download_path(suggested_name):
    dl_dir = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD) or os.path.expanduser("~/Downloads")
    os.makedirs(dl_dir, exist_ok=True)
    safe_name = os.path.basename(suggested_name or "estacao-download.json").strip() or "estacao-download.json"
    candidate = os.path.join(dl_dir, safe_name)
    if not os.path.exists(candidate):
        return candidate
    stem, ext = os.path.splitext(safe_name)
    idx = 1
    while True:
        alt = os.path.join(dl_dir, f"{stem} ({idx}){ext}")
        if not os.path.exists(alt):
            return alt
        idx += 1


def _build_native_window(target_url):
    global native_window, native_webview
    if not HAS_WEBKIT:
        return None
    if native_window is not None:
        return native_window

    wk_base = os.path.join(DATA_DIR, "webkit-app-data") if DATA_DIR else os.path.expanduser("~/.local/share/estacao-ai/webkit-app-data")
    wk_cache = os.path.join(DATA_DIR, "webkit-app-cache") if DATA_DIR else os.path.expanduser("~/.cache/estacao-ai/webkit-app-cache")
    os.makedirs(wk_base, exist_ok=True)
    os.makedirs(wk_cache, exist_ok=True)

    data_mgr = WebKit2.WebsiteDataManager(base_data_directory=wk_base, base_cache_directory=wk_cache)
    cookie_mgr = data_mgr.get_cookie_manager()
    cookie_mgr.set_persistent_storage(os.path.join(wk_base, "cookies.sqlite"), WebKit2.CookiePersistentStorage.SQLITE)
    web_ctx = WebKit2.WebContext.new_with_website_data_manager(data_mgr)

    def on_download_started(_ctx, download):
        def on_decide_dest(dl, suggested_filename):
            dest = _resolve_download_path(suggested_filename)
            dl.set_destination(f"file://{dest}")
            return True
        download.connect("decide-destination", on_decide_dest)

    web_ctx.connect("download-started", on_download_started)

    wv = WebKit2.WebView.new_with_context(web_ctx)
    settings = wv.get_settings()
    settings.set_enable_webgl(True)
    settings.set_javascript_can_access_clipboard(True)
    settings.set_enable_smooth_scrolling(True)

    def on_decide_policy(_view, decision, decision_type):
        if decision_type in (WebKit2.PolicyDecisionType.NAVIGATION_ACTION, WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION):
            try:
                action = decision.get_navigation_action()
                uri = action.get_request().get_uri()
            except Exception:
                return False
            if uri and not _is_loopback_http(uri) and not uri.startswith(("blob:", "data:", "about:")):
                decision.ignore()
                _open_external(uri)
                return True
        return False

    def on_create(_view, action):
        try:
            uri = action.get_request().get_uri()
        except Exception:
            return None
        if uri and _is_loopback_http(uri):
            wv.load_uri(uri)
        elif uri:
            _open_external(uri)
        return None

    wv.connect("decide-policy", on_decide_policy)
    wv.connect("create", on_create)

    win = Gtk.Window(title="Estação I.A")
    try:
        win.set_wmclass("EstacaoAI", "EstacaoAI")
    except Exception:
        pass
    win.set_default_size(1360, 860)
    if ICON_PATH and os.path.isfile(ICON_PATH):
        try:
            win.set_icon_from_file(ICON_PATH)
        except Exception:
            pass
    win.add(wv)

    def on_delete(_win, _ev):
        _win.hide()
        return True

    def on_window_state(_win, ev):
        if not restoring_native and (ev.new_window_state & Gdk.WindowState.ICONIFIED):
            GLib.idle_add(lambda: (_win.hide(), False)[1])
        return False

    win.connect("delete-event", on_delete)
    win.connect("window-state-event", on_window_state)

    def sync_title(view, _pspec):
        t = view.get_title()
        if t:
            win.set_title(t)

    wv.connect("notify::title", sync_title)
    wv.load_uri(target_url or "http://127.0.0.1:49374/web/chat")

    native_window = win
    native_webview = wv
    return win


def show_native_window(target_url=None):
    global restoring_native
    win = _build_native_window(target_url)
    if win is None:
        return False
    restoring_native = True
    try:
        win.deiconify()
        win.show_all()
        win.present()
        if target_url and "#estacao-vinculo=" in target_url and native_webview is not None:
            cur = native_webview.get_uri() or ""
            if not cur or cur == "about:blank":
                native_webview.load_uri(target_url)
    finally:
        GLib.timeout_add(300, lambda: (_clear_restoring(), False)[1])
    return True


def _clear_restoring():
    global restoring_native
    restoring_native = False


def find_app_pids():
    needle = _profile_needle()
    pids = set()
    try:
        out = subprocess.check_output(["pgrep", "-f", needle], text=True, stderr=subprocess.DEVNULL)
        for line in out.splitlines():
            line = line.strip()
            if line.isdigit():
                pids.add(int(line))
    except Exception:
        pass
    try:
        out = subprocess.check_output(["pgrep", "-x", "estacao-ai-desktop"], text=True, stderr=subprocess.DEVNULL)
        for line in out.splitlines():
            line = line.strip()
            if line.isdigit():
                pids.add(int(line))
    except Exception:
        pass
    return pids


def find_x11_windows():
    wids = []
    if HAS_XDOTOOL:
        for flag, val in [("--class", "EstacaoAI"), ("--class", "Estacao-ai"), ("--name", "Estação")]:
            try:
                out = subprocess.check_output(["xdotool", "search", flag, val], text=True, stderr=subprocess.DEVNULL)
                for line in out.splitlines():
                    w = line.strip()
                    if w and w not in wids:
                        wids.append(w)
            except Exception:
                pass
    if not wids and HAS_WMCTRL:
        pids = find_app_pids()
        try:
            out = subprocess.check_output(["wmctrl", "-lp"], text=True, stderr=subprocess.DEVNULL)
            for line in out.splitlines():
                parts = line.split(None, 4)
                if len(parts) < 5:
                    continue
                wid, _, pid_str, _, title = parts
                if (pid_str.isdigit() and int(pid_str) in pids) or ("Estação" in title or "estacao-ai" in title):
                    if wid not in wids:
                        wids.append(wid)
        except Exception:
            pass
    return wids


def is_x11_hidden(wid):
    if not HAS_XPROP:
        return False
    try:
        out = subprocess.check_output(["xprop", "-id", wid, "_NET_WM_STATE"], text=True, stderr=subprocess.DEVNULL)
        return "_NET_WM_STATE_HIDDEN" in out
    except Exception:
        return False


def minimize_to_tray(*_args):
    if native_window is not None:
        native_window.hide()
        return
    wids = find_x11_windows()
    for w in wids:
        hidden_xids.add(w)
        if HAS_XDOTOOL:
            subprocess.call(["xdotool", "windowminimize", w], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            subprocess.call(["xdotool", "windowunmap", w], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        elif HAS_WMCTRL:
            subprocess.call(["wmctrl", "-i", "-r", w, "-b", "add,hidden,skip_taskbar"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def restore_windows():
    if native_window is not None:
        return show_native_window(None)
    wids = list(dict.fromkeys(list(hidden_xids) + find_x11_windows()))
    restored = False
    for w in wids:
        if HAS_XDOTOOL:
            subprocess.call(["xdotool", "windowmap", w], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            subprocess.call(["xdotool", "windowactivate", w], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            restored = True
        elif HAS_WMCTRL:
            subprocess.call(["wmctrl", "-i", "-r", w, "-b", "remove,hidden,skip_taskbar"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            subprocess.call(["wmctrl", "-i", "-a", w], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            restored = True
    hidden_xids.clear()
    return restored


def open_or_restore(*_args):
    if HAS_WEBKIT and show_native_window(INITIAL_URL or "http://127.0.0.1:49374/web/chat"):
        return
    if restore_windows():
        return
    cmd = [EXE, "--data-dir", DATA_DIR] if DATA_DIR else [EXE]
    if CFG_PATH:
        cmd.extend(["--config", CFG_PATH])
    cmd.append("app")
    subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def close_all(*_args):
    global native_window
    if native_window is not None:
        try:
            native_window.destroy()
        except Exception:
            pass
        native_window = None
    for pid in find_app_pids():
        try:
            os.kill(pid, signal.SIGTERM)
        except Exception:
            pass
    if STOP_FILE:
        try:
            with open(STOP_FILE, "w", encoding="utf-8") as fp:
                fp.write("stop")
        except Exception:
            pass
    try:
        subprocess.call(["systemctl", "--user", "stop", "estacao-ai.service"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass
    holder = os.path.join(DATA_DIR, ".serve.lock.holder") if DATA_DIR else ""
    if holder and os.path.isfile(holder):
        try:
            txt = open(holder, "r", encoding="utf-8").read()
            for token in txt.replace("\n", " ").split():
                if token.startswith("pid=") and token[4:].isdigit():
                    srv_pid = int(token[4:])
                    if srv_pid > 1 and srv_pid != os.getpid():
                        os.kill(srv_pid, signal.SIGTERM)
        except Exception:
            pass
    Gtk.main_quit()


def build_menu():
    menu = Gtk.Menu()
    item_open = Gtk.MenuItem(label="Abrir Estação I.A")
    item_open.connect("activate", open_or_restore)
    menu.append(item_open)

    item_min = Gtk.MenuItem(label="Minimizar para a área de tarefas")
    item_min.connect("activate", minimize_to_tray)
    menu.append(item_min)

    menu.append(Gtk.SeparatorMenuItem())

    item_close = Gtk.MenuItem(label="Fechar Estação I.A de vez")
    item_close.connect("activate", close_all)
    menu.append(item_close)
    menu.show_all()
    return menu


menu = build_menu()
icon_name = ICON_PATH if (ICON_PATH and os.path.isfile(ICON_PATH)) else "applications-internet"

if HAS_INDICATOR:
    indicator = AppIndicator3.Indicator.new(
        "estacao-ai-tray",
        icon_name,
        AppIndicator3.IndicatorCategory.APPLICATION_STATUS,
    )
    indicator.set_status(AppIndicator3.IndicatorStatus.ACTIVE)
    indicator.set_title("Estação I.A")
    indicator.set_menu(menu)
else:
    status_icon = Gtk.StatusIcon()
    if os.path.isfile(icon_name):
        status_icon.set_from_file(icon_name)
    else:
        status_icon.set_from_icon_name(icon_name)
    status_icon.set_tooltip_text("Estação I.A — Em execução")
    status_icon.set_visible(True)
    status_icon.connect("activate", lambda _icon: open_or_restore())
    status_icon.connect("popup-menu", lambda icon, btn, t: menu.popup(None, None, Gtk.StatusIcon.position_menu, icon, btn, t))

if INITIAL_URL and HAS_WEBKIT:
    show_native_window(INITIAL_URL)


def tick():
    if PARENT_PID > 0:
        try:
            os.kill(PARENT_PID, 0)
        except OSError:
            Gtk.main_quit()
            return False
    if STOP_FILE and os.path.exists(STOP_FILE):
        Gtk.main_quit()
        return False
    if OPEN_FILE and os.path.exists(OPEN_FILE):
        req_url = None
        try:
            with open(OPEN_FILE, "r", encoding="utf-8") as fp:
                req_url = fp.read().strip()
            os.remove(OPEN_FILE)
        except Exception:
            pass
        if HAS_WEBKIT:
            show_native_window(req_url or INITIAL_URL or "http://127.0.0.1:49374/web/chat")
        else:
            restore_windows()
    if RESTORE_FILE and os.path.exists(RESTORE_FILE):
        try:
            os.remove(RESTORE_FILE)
        except Exception:
            pass
        restore_windows()
    if native_window is None:
        for w in find_x11_windows():
            if w not in hidden_xids and is_x11_hidden(w):
                hidden_xids.add(w)
                if HAS_XDOTOOL:
                    subprocess.call(["xdotool", "windowunmap", w], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return True


GLib.timeout_add(300, tick)
signal.signal(signal.SIGINT, lambda *_: Gtk.main_quit())
signal.signal(signal.SIGTERM, lambda *_: Gtk.main_quit())
Gtk.main()
"###;

/// Garante o arquivo PNG do ícone dentro de `data_dir` para uso na bandeja Linux.
#[cfg(any(target_os = "linux", test))]
pub(crate) fn ensure_tray_icon_png(data_dir: &Path) -> PathBuf {
    let icon_path = data_dir.join("estacao-ai.png");
    if !icon_path.is_file() {
        let _ = std::fs::create_dir_all(data_dir);
        let _ = std::fs::write(&icon_path, LOGO_PNG);
    }
    icon_path
}

/// Verifica se o Linux possui `python3` com GTK 3.0 e WebKit2 (4.1 ou 4.0) para janela nativa.
#[cfg(target_os = "linux")]
pub(crate) fn linux_supports_native_webkit() -> bool {
    if !tray_supported_in_environment() {
        return false;
    }
    Command::new("python3")
        .args([
            "-c",
            "import gi; gi.require_version('Gtk','3.0'); gi.require_version('WebKit2','4.1')",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

/// Abre ou restaura a janela desktop nativa GTK3 + WebKit2 no Linux integrada à bandeja.
/// Retorna `true` se o aplicativo nativo assumiu a janela sem precisar de navegador externo.
#[cfg(target_os = "linux")]
pub(crate) fn launch_linux_native_app(
    url: &str,
    data_dir: &Path,
    exe: &Path,
    config_path: Option<&Path>,
) -> bool {
    if !linux_supports_native_webkit() {
        return false;
    }

    if tray_is_running(data_dir) {
        let req = data_dir.join(TRAY_OPEN_REQ);
        if std::fs::write(&req, url.as_bytes()).is_ok() {
            for _ in 0..12 {
                if !req.exists() {
                    return true;
                }
                std::thread::sleep(Duration::from_millis(75));
            }
            let _ = std::fs::remove_file(&req);
        }
        // Processo tray anterior sem suporte a `tray-open.req`: abre janela WebKit2 direta sem competir pelo lock.
        let mut cmd = Command::new("python3");
        let png_path = ensure_tray_icon_png(data_dir);
        cmd.args(["-c", LINUX_TRAY_SCRIPT])
            .env("ESTACAO_TRAY_EXE", exe)
            .env("ESTACAO_TRAY_DATA_DIR", data_dir)
            .env("ESTACAO_TRAY_SKIP_LOCK", "1")
            .env(
                "ESTACAO_TRAY_CONFIG",
                config_path
                    .map(|p| p.as_os_str().to_os_string())
                    .unwrap_or_default(),
            )
            .env("ESTACAO_TRAY_URL", url)
            .env("ESTACAO_TRAY_PNG", &png_path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        return cmd.spawn().is_ok();
    }

    spawn_detached_tray_with_url(data_dir, exe, config_path, Some(url))
}

#[cfg(not(target_os = "linux"))]
pub(crate) fn launch_linux_native_app(
    _url: &str,
    _data_dir: &Path,
    _exe: &Path,
    _config_path: Option<&Path>,
) -> bool {
    false
}

/// Adquire o lock exclusivo da bandeja para evitar ícones duplicados por `data_dir`.
pub(crate) fn try_acquire_tray_lock(data_dir: &Path) -> Option<std::fs::File> {
    let _ = std::fs::create_dir_all(data_dir);
    let file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(data_dir.join(TRAY_LOCK_FILE))
        .ok()?;
    match file.try_lock_exclusive() {
        Ok(()) => Some(file),
        Err(_) => None,
    }
}

/// Verifica se existe alguma bandeja ativa segurando `.tray.lock`.
pub(crate) fn tray_is_running(data_dir: &Path) -> bool {
    let lock_path = data_dir.join(TRAY_LOCK_FILE);
    if !lock_path.exists() {
        return false;
    }
    let Ok(file) = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&lock_path)
    else {
        return false;
    };
    file.try_lock_exclusive().is_err()
}

/// Inicia a bandeja em processo residente caso ainda não esteja rodando para `data_dir`.
pub(crate) fn ensure_detached_tray(data_dir: &Path, exe: &Path, config_path: Option<&Path>) {
    if !tray_supported_in_environment() || tray_is_running(data_dir) {
        return;
    }
    let _ = spawn_detached_tray_with_url(data_dir, exe, config_path, None);
}

fn spawn_detached_tray_with_url(
    data_dir: &Path,
    exe: &Path,
    config_path: Option<&Path>,
    initial_url: Option<&str>,
) -> bool {
    let mut cmd = Command::new(exe);
    cmd.arg("--data-dir").arg(data_dir);
    if let Some(cfg) = config_path {
        cmd.arg("--config").arg(cfg);
    }
    cmd.arg("tray");
    if let Some(url) = initial_url {
        cmd.arg("--url").arg(url);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        cmd.creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS);
    }

    cmd.spawn().is_ok()
}

/// Restaura uma janela existente da Estação I.A (inclusive minimizada para a bandeja).
/// Retorna `true` se encontrou e restaurou uma janela ativa, evitando duplicação.
pub(crate) fn restore_if_running(data_dir: &Path) -> bool {
    let has_running_app_window = has_active_app_window(data_dir);
    if !has_running_app_window {
        return false;
    }

    if tray_is_running(data_dir) {
        let req = data_dir.join(TRAY_RESTORE_REQ);
        let _ = std::fs::write(&req, b"restore");
        for _ in 0..8 {
            if !req.exists() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(75));
        }
        return true;
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(status) = Command::new("wmctrl")
            .args(["-a", "Estação"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            && status.success()
        {
            return true;
        }
    }

    true
}

fn has_active_app_window(data_dir: &Path) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let prof_needle = data_dir
            .join("desktop-app-profile")
            .display()
            .to_string()
            .replace('\'', "''");
        let ps = format!(
            "$p = Get-CimInstance Win32_Process | Where-Object {{ \
             (($_.Name -in @('msedge.exe','chrome.exe','brave.exe')) -and \
              $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains('{prof_needle}'.ToLowerInvariant())) -or \
             ($_.Name -eq 'estacao-ai-desktop.exe') }}; \
             if ($p) {{ exit 0 }} else {{ exit 1 }}"
        );
        Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle",
                "Hidden",
                "-Command",
                &ps,
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success())
    }
    #[cfg(target_os = "linux")]
    {
        let prof_needle = data_dir.join("desktop-app-profile").display().to_string();
        Command::new("pgrep")
            .args(["-f", &prof_needle])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success())
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        let _ = data_dir;
        false
    }
}

fn tray_supported_in_environment() -> bool {
    if std::env::var_os("AI_MEMORY_NO_TRAY").is_some() {
        return false;
    }
    #[cfg(windows)]
    {
        true
    }
    #[cfg(target_os = "linux")]
    {
        std::env::var_os("DISPLAY").is_some() || std::env::var_os("WAYLAND_DISPLAY").is_some()
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        false
    }
}

/// Ponto de entrada do subcomando oculto `estacao-ai tray`.
pub(crate) fn run_tray(config: &Config, args: &TrayArgs, config_path: Option<&Path>) -> Result<()> {
    if !tray_supported_in_environment() {
        return Ok(());
    }
    let Some(_lock) = try_acquire_tray_lock(&config.data_dir) else {
        if let Some(url) = args.url.as_deref() {
            let _ = std::fs::write(config.data_dir.join(TRAY_OPEN_REQ), url.as_bytes());
        }
        return Ok(());
    };
    let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("estacao-ai"));
    let stop_file = args.stop_file.clone().unwrap_or_else(|| {
        config
            .data_dir
            .join(SERVICE_STATE_FILE)
            .with_extension("stop")
    });
    drop(_lock);
    let mut guard = spawn_tray_process(
        &config.data_dir,
        &exe,
        config_path,
        &stop_file,
        args.parent_pid.unwrap_or(0),
        args.url.as_deref(),
    );
    if let Some(ref mut child) = guard.child {
        let _ = child.wait();
    }
    guard.child = None;
    Ok(())
}

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
        if !tray_supported_in_environment() || tray_is_running(data_dir) {
            return Self { child: None };
        }
        spawn_tray_process(
            data_dir,
            exe,
            config_path,
            stop_request,
            std::process::id(),
            None,
        )
    }
}

fn spawn_tray_process(
    data_dir: &Path,
    exe: &Path,
    config_path: Option<&Path>,
    stop_request: &Path,
    parent_pid: u32,
    initial_url: Option<&str>,
) -> TrayGuard {
    let restore_file = data_dir.join(TRAY_RESTORE_REQ);
    let open_file = data_dir.join(TRAY_OPEN_REQ);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = (open_file, initial_url);

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
        .env("ESTACAO_TRAY_RESTORE", &restore_file)
        .env("ESTACAO_TRAY_ICO", &ico_path)
        .env("ESTACAO_TRAY_PID", parent_pid.to_string())
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

        TrayGuard {
            child: cmd.spawn().ok(),
        }
    }
    #[cfg(target_os = "linux")]
    {
        let png_path = ensure_tray_icon_png(data_dir);
        let mut cmd = Command::new("python3");
        cmd.args(["-c", LINUX_TRAY_SCRIPT])
            .env("ESTACAO_TRAY_EXE", exe)
            .env("ESTACAO_TRAY_DATA_DIR", data_dir)
            .env(
                "ESTACAO_TRAY_CONFIG",
                config_path
                    .map(|p| p.as_os_str().to_os_string())
                    .unwrap_or_default(),
            )
            .env("ESTACAO_TRAY_STOP", stop_request)
            .env("ESTACAO_TRAY_RESTORE", &restore_file)
            .env("ESTACAO_TRAY_OPEN_REQ", &open_file)
            .env("ESTACAO_TRAY_URL", initial_url.unwrap_or_default())
            .env("ESTACAO_TRAY_PNG", &png_path)
            .env("ESTACAO_TRAY_PID", parent_pid.to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        TrayGuard {
            child: cmd.spawn().ok(),
        }
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        let _ = (
            data_dir,
            exe,
            config_path,
            stop_request,
            parent_pid,
            restore_file,
            open_file,
            initial_url,
        );
        TrayGuard { child: None }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tray_lock_prevents_duplicate_instances_per_data_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let first = try_acquire_tray_lock(tmp.path());
        assert!(first.is_some());
        assert!(tray_is_running(tmp.path()));

        let second = try_acquire_tray_lock(tmp.path());
        assert!(second.is_none());

        drop(first);
        assert!(!tray_is_running(tmp.path()));
        assert!(try_acquire_tray_lock(tmp.path()).is_some());
    }

    #[test]
    fn ensure_tray_icon_png_writes_valid_png_signature() {
        let tmp = tempfile::tempdir().unwrap();
        let path = ensure_tray_icon_png(tmp.path());
        let bytes = std::fs::read(&path).unwrap();
        assert!(bytes.starts_with(&[0x89, b'P', b'N', b'G']));
    }

    #[test]
    fn linux_tray_script_has_valid_python_syntax() {
        let output = Command::new("python3")
            .args(["-c", "import ast, sys; ast.parse(sys.stdin.read())"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn();
        if let Ok(mut child) = output {
            use std::io::Write as _;
            child
                .stdin
                .as_mut()
                .unwrap()
                .write_all(LINUX_TRAY_SCRIPT.as_bytes())
                .unwrap();
            let res = child.wait_with_output().unwrap();
            assert!(
                res.status.success(),
                "LINUX_TRAY_SCRIPT syntax invalid: {}",
                String::from_utf8_lossy(&res.stderr)
            );
        }
    }

    #[cfg(windows)]
    #[test]
    fn windows_tray_script_includes_minimize_restore_and_context_menu() {
        assert!(TRAY_SCRIPT.contains("Abrir Estação I.A"));
        assert!(TRAY_SCRIPT.contains("Minimizar para a área de tarefas"));
        assert!(TRAY_SCRIPT.contains("Fechar Estação I.A de vez"));
        assert!(TRAY_SCRIPT.contains("IsIconic"));
        assert!(TRAY_SCRIPT.contains("Minimize-EstacaoToTray"));
        assert!(TRAY_SCRIPT.contains("Restore-EstacaoWindows"));
    }
}
