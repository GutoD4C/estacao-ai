use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Duration;

use tokio::io::AsyncWriteExt;

use super::estado::Agente;

pub(super) const TEMPO_MAXIMO: Duration = Duration::from_secs(30 * 60);
const MAX_SAIDA: usize = 60_000;

/// Resposta de uma execução: texto para o chat e tokens, quando a CLI informa.
#[derive(Debug, Default, PartialEq)]
pub(super) struct Saida {
    pub(super) texto: String,
    pub(super) uso: Option<(u64, u64)>,
}

/// Remove sequências de escape ANSI/VT e caracteres de controle da saída de CLIs,
/// preservando acentuação UTF-8, quebras de linha e tabulações.
pub(super) fn limpar_texto_cli(bruta: &str) -> String {
    let normalizada = bruta.replace("\r\n", "\n");
    let mut sem_ansi = String::with_capacity(normalizada.len());
    let mut chars = normalizada.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            match chars.peek().copied() {
                // CSI: ESC [ ... byte final (0x40..=0x7E)
                Some('[') => {
                    chars.next();
                    for ch in chars.by_ref() {
                        if ('@'..='~').contains(&ch) {
                            break;
                        }
                    }
                }
                // OSC: ESC ] ... BEL (\x07) ou ST (ESC \)
                Some(']') => {
                    chars.next();
                    while let Some(ch) = chars.next() {
                        if ch == '\x07' {
                            break;
                        }
                        if ch == '\x1b' && chars.peek() == Some(&'\\') {
                            chars.next();
                            break;
                        }
                    }
                }
                // Outra sequência ESC de 2 caracteres
                Some(_) => {
                    chars.next();
                }
                None => {}
            }
            continue;
        }
        if c == '\r' || c == '\n' || c == '\t' || (!c.is_control() && c != '\x7f') {
            sem_ansi.push(c);
        }
    }
    let mut out = String::with_capacity(sem_ansi.len());
    for (i, linha) in sem_ansi.split('\n').enumerate() {
        if i > 0 {
            out.push('\n');
        }
        if let Some((_, ultima)) = linha.rsplit_once('\r') {
            out.push_str(if ultima.is_empty() {
                linha.trim_end_matches('\r')
            } else {
                ultima
            });
        } else {
            out.push_str(linha);
        }
    }
    out.trim().to_owned()
}

/// Lê a saída JSON de `claude -p --output-format json` (`result`) e de
/// `agy --output-format json` (`response`); qualquer outra saída passa como texto.
pub(super) fn interpretar_saida(bruta: &str) -> Saida {
    let limpa = bruta.trim();
    let Ok(v) = serde_json::from_str::<serde_json::Value>(limpa) else {
        return Saida {
            texto: limpar_texto_cli(limpa),
            uso: None,
        };
    };
    let Some(texto) = ["result", "response"]
        .iter()
        .find_map(|k| v.get(*k).and_then(serde_json::Value::as_str))
    else {
        return Saida {
            texto: limpar_texto_cli(limpa),
            uso: None,
        };
    };
    let n =
        |u: &serde_json::Value, k: &str| u.get(k).and_then(serde_json::Value::as_u64).unwrap_or(0);
    let uso = v.get("usage").map(|u| {
        (
            n(u, "input_tokens") + n(u, "cache_creation_input_tokens"),
            n(u, "output_tokens") + n(u, "thinking_tokens"),
        )
    });
    Saida {
        texto: limpar_texto_cli(texto),
        uso,
    }
}

pub(super) fn cortar_saida(texto: &mut String) {
    if texto.len() > MAX_SAIDA {
        let mut corte = MAX_SAIDA;
        while !texto.is_char_boundary(corte) {
            corte -= 1;
        }
        texto.truncate(corte);
        texto.push_str("\n…(saída cortada)");
    }
}

/// Execuções em andamento: id da mensagem → (projeto, modelo, grupo de processos).
type Registro = HashMap<String, (String, String, u32)>;

pub(super) fn em_andamento() -> &'static std::sync::Mutex<Registro> {
    static R: std::sync::OnceLock<std::sync::Mutex<Registro>> = std::sync::OnceLock::new();
    R.get_or_init(Default::default)
}

/// Mensagens cujas execuções o operador mandou parar.
pub(super) fn paradas() -> &'static std::sync::Mutex<HashSet<String>> {
    static P: std::sync::OnceLock<std::sync::Mutex<HashSet<String>>> = std::sync::OnceLock::new();
    P.get_or_init(Default::default)
}

/// Encerra o grupo inteiro: a CLI de IA é neta do `sh` e continuaria gastando cota.
pub(super) fn matar_grupo(pgid: u32) {
    #[cfg(windows)]
    let _ = std::process::Command::new("taskkill")
        .args(["/T", "/F", "/PID", &pgid.to_string()])
        .status();
    #[cfg(not(windows))]
    let _ = std::process::Command::new("kill")
        .args(["-TERM", "--", &format!("-{pgid}")])
        .status();
}

/// Para as execuções que `filtro(projeto, modelo)` aceitar; devolve quantas.
pub(super) fn parar_execucoes(filtro: impl Fn(&str, &str) -> bool) -> usize {
    let alvos: Vec<(String, u32)> = em_andamento()
        .lock()
        .map(|r| {
            r.iter()
                .filter(|(_, (proj, ag, _))| filtro(proj, ag))
                .map(|(msg, (_, _, pgid))| (msg.clone(), *pgid))
                .collect()
        })
        .unwrap_or_default();
    for (msg, pgid) in &alvos {
        if let Ok(mut p) = paradas().lock() {
            p.insert(msg.clone());
        }
        matar_grupo(*pgid);
    }
    alvos.len()
}

/// Remove a execução do registro ao terminar, inclusive em erro.
struct Inscricao(Option<String>);

impl Drop for Inscricao {
    fn drop(&mut self) {
        if let (Some(msg), Ok(mut r)) = (self.0.take(), em_andamento().lock()) {
            r.remove(&msg);
        }
    }
}

/// Resolve `{modelo}` no comando sem quebrar CLIs quando o campo modelo estiver vazio.
pub(super) fn resolver_comando(comando: &str, modelo: &str) -> String {
    let modelo = modelo.trim();
    if modelo.is_empty() {
        return comando
            .replace(" --model {modelo}", "")
            .replace(" -m {modelo}", "")
            .replace("--model={modelo}", "")
            .replace("-m={modelo}", "")
            .replace("{modelo}", "")
            .trim()
            .to_owned();
    }
    let seguro = if modelo
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/' | ':'))
    {
        modelo.to_owned()
    } else {
        format!("'{}'", modelo.replace('\'', "'\\''"))
    };
    comando.replace("{modelo}", &seguro)
}

/// Divide uma linha de comando em tokens simples respeitando aspas simples e duplas.
/// Retorna `None` se houver operadores de shell (`|`, `&`, `;`, `>`, `<`).
pub(super) fn dividir_tokens_comando(comando: &str) -> Option<Vec<String>> {
    let mut tokens = Vec::new();
    let mut atual = String::new();
    let mut em_token = false;
    let mut aspa: Option<char> = None;
    let mut chars = comando.chars().peekable();
    while let Some(c) = chars.next() {
        match aspa {
            Some(q) if c == q => {
                aspa = None;
                em_token = true;
            }
            Some(_) => {
                atual.push(c);
                em_token = true;
            }
            None => match c {
                '\'' | '"' => {
                    aspa = Some(c);
                    em_token = true;
                }
                c if c.is_whitespace() => {
                    if em_token {
                        tokens.push(std::mem::take(&mut atual));
                        em_token = false;
                    }
                }
                '|' | '&' | ';' | '>' | '<' => return None,
                '\\' if cfg!(not(windows)) => {
                    if let Some(prox) = chars.next() {
                        atual.push(prox);
                    }
                    em_token = true;
                }
                _ => {
                    atual.push(c);
                    em_token = true;
                }
            },
        }
    }
    if aspa.is_some() {
        return None;
    }
    if em_token {
        tokens.push(atual);
    }
    (!tokens.is_empty()).then_some(tokens)
}

/// Roda o comando do agente com o prompt na entrada padrão (ou substituindo `$(cat)`).
pub(super) async fn executar_comando(
    agente: &Agente,
    pasta: &str,
    prompt: &str,
    registro: Option<(&str, &str)>,
    limite: Option<Duration>,
) -> Result<Saida, String> {
    let comando = resolver_comando(&agente.comando, &agente.modelo);
    let mut enviar_stdin = true;
    let mut cmd = if cfg!(windows) {
        if let Some(tokens) = dividir_tokens_comando(&comando)
            && let Some(bin) = localizar_binario(&tokens[0])
        {
            let mut usou_arg = false;
            let args: Vec<String> = tokens[1..]
                .iter()
                .map(|t| {
                    if t == "$(cat)" {
                        usou_arg = true;
                        prompt.to_owned()
                    } else {
                        t.clone()
                    }
                })
                .collect();
            if usou_arg {
                enviar_stdin = false;
            }
            let eh_cmd = bin
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"));
            if eh_cmd {
                let mut c = tokio::process::Command::new("cmd");
                c.arg("/C").arg(&bin).args(args);
                c
            } else {
                let mut c = tokio::process::Command::new(&bin);
                c.args(args);
                c
            }
        } else {
            let mut c = tokio::process::Command::new("powershell");
            let ps_cmd = if comando.contains("$(cat)") {
                enviar_stdin = false;
                let escaped = prompt.replace('\'', "''");
                comando
                    .replace("\"$(cat)\"", &format!("'{escaped}'"))
                    .replace("$(cat)", &format!("'{escaped}'"))
            } else {
                comando.clone()
            };
            c.args(["-NoProfile", "-NonInteractive", "-Command", &ps_cmd]);
            c
        }
    } else {
        let mut c = tokio::process::Command::new("sh");
        c.arg("-c").arg(&comando);
        c
    };
    cmd.env("PATH", caminho_busca())
        .stdin(if enviar_stdin {
            std::process::Stdio::piped()
        } else {
            std::process::Stdio::null()
        })
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    cmd.process_group(0);
    if !pasta.trim().is_empty() {
        let pasta = expandir_home(pasta.trim());
        if !pasta.is_dir() {
            return Err(format!(
                "Pasta do projeto não encontrada: {}",
                pasta.display()
            ));
        }
        cmd.current_dir(pasta);
    }
    if registro.is_some_and(|(msg, _)| paradas().lock().is_ok_and(|p| p.contains(msg))) {
        return Err("Parado pelo operador.".into());
    }
    let mut filho = cmd
        .spawn()
        .map_err(|e| format!("Não consegui iniciar o modelo: {e}"))?;
    let pgid = filho.id();
    let _inscricao = Inscricao(match (registro, pgid) {
        (Some((msg, proj)), Some(pid)) => {
            if let Ok(mut r) = em_andamento().lock() {
                r.insert(msg.to_owned(), (proj.to_owned(), agente.id.clone(), pid));
            }
            Some(msg.to_owned())
        }
        _ => None,
    });
    if let Some((msg, _)) = registro
        && paradas().lock().is_ok_and(|p| p.contains(msg))
        && let Some(pid) = pgid
    {
        matar_grupo(pid);
    }
    if enviar_stdin && let Some(mut entrada) = filho.stdin.take() {
        let _ = entrada.write_all(prompt.as_bytes()).await;
    }
    let espera = filho.wait_with_output();
    let saida = if let Some(limite) = limite {
        match tokio::time::timeout(limite, espera).await {
            Ok(r) => r,
            Err(_) => {
                if let Some(pid) = pgid {
                    matar_grupo(pid);
                }
                return Err("O modelo passou de 30 minutos e foi interrompido.".into());
            }
        }
    } else {
        espera.await
    }
    .map_err(|e| format!("Falha ao aguardar o modelo: {e}"))?;
    let lida = interpretar_saida(&String::from_utf8_lossy(&saida.stdout));
    let uso = lida.uso;
    let mut texto = lida.texto;
    if !saida.status.success() {
        let erro_limpo = limpar_texto_cli(&String::from_utf8_lossy(&saida.stderr));
        if !erro_limpo.is_empty() {
            if !texto.is_empty() {
                texto.push_str("\n\n");
            }
            texto.push_str(&erro_limpo);
        }
    }
    // A decisão de execução está na última linha, inclusive em relatórios longos.
    let controle = (texto.len() > MAX_SAIDA)
        .then(|| texto.trim_end().lines().last().unwrap_or("").trim())
        .filter(|linha| linha.len() <= 1024)
        .map(str::to_owned);
    cortar_saida(&mut texto);
    if let Some(linha) = controle {
        texto.push('\n');
        texto.push_str(&linha);
    }
    if saida.status.success() {
        Ok(Saida {
            texto: texto.trim().to_owned(),
            uso,
        })
    } else {
        Err(texto.trim().to_owned())
    }
}

/// PATH do serviço mais as pastas onde as CLIs de IA costumam ficar
/// (no Linux/systemd e no Windows nativo).
pub(super) fn caminho_busca() -> std::ffi::OsString {
    let mut pastas: Vec<PathBuf> = Vec::new();
    let mut push_unique = |p: PathBuf| {
        if !p.as_os_str().is_empty() && !pastas.contains(&p) {
            pastas.push(p);
        }
    };

    let mut homes: Vec<PathBuf> = Vec::new();
    for key in if cfg!(windows) {
        ["USERPROFILE", "HOME"]
    } else {
        ["HOME", "USERPROFILE"]
    } {
        if let Some(v) = std::env::var_os(key) {
            let p = PathBuf::from(v);
            if !p.as_os_str().is_empty() && !homes.contains(&p) {
                homes.push(p);
            }
        }
    }
    if homes.is_empty() {
        homes.push(dirs_home());
    }

    let sufixos_home = [
        ".local/bin",
        ".opencode/bin",
        ".pi/agent/bin",
        ".cargo/bin",
        ".bun/bin",
        ".npm-global/bin",
        "scoop/shims",
        ".volta/bin",
        "AppData/Local/agy/bin",
        "AppData/Local/Programs/antigravity/bin",
        "AppData/Local/Programs/OpenAI/Codex/bin",
        "AppData/Local/Programs/estacao-ai",
        "AppData/Local/Programs/claude-code",
        "AppData/Local/Programs/Ollama",
        "AppData/Local/Microsoft/WinGet/Links",
        "AppData/Local/Microsoft/WindowsApps",
        "AppData/Roaming/npm",
    ];
    for home in &homes {
        for rel in sufixos_home {
            push_unique(home.join(rel));
        }
    }

    if cfg!(windows) {
        if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
            for rel in [
                r"Programs\OpenAI\Codex\bin",
                r"Programs\OpenAI\Codex\resources\bin",
                r"agy\bin",
                r"Programs\antigravity\bin",
                r"Programs\estacao-ai",
                r"Programs\claude-code",
                r"Programs\Ollama",
                r"Microsoft\WinGet\Links",
                r"Microsoft\WindowsApps",
            ] {
                push_unique(local.join(rel));
            }
        }
        if let Some(roaming) = std::env::var_os("APPDATA").map(PathBuf::from) {
            push_unique(roaming.join("npm"));
        }
        for key in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Some(pf) = std::env::var_os(key).map(PathBuf::from) {
                push_unique(pf.join(r"OpenAI\Codex\bin"));
                push_unique(pf.join("nodejs"));
                push_unique(pf.join(r"Git\bin"));
                push_unique(pf.join(r"Git\usr\bin"));
            }
        }
        if let Some(nvm) = std::env::var_os("NVM_SYMLINK").map(PathBuf::from) {
            push_unique(nvm);
        }
        if let Some(volta) = std::env::var_os("VOLTA_HOME").map(PathBuf::from) {
            push_unique(volta.join("bin"));
        }
        push_unique(PathBuf::from(r"C:\Program Files\Git\bin"));
        push_unique(PathBuf::from(r"C:\Program Files\Git\usr\bin"));
    }

    if let Some(atual) = std::env::var_os("PATH") {
        for p in std::env::split_paths(&atual) {
            push_unique(p);
        }
    }
    std::env::join_paths(pastas).unwrap_or_default()
}

fn is_executable_file(path: &Path) -> bool {
    if path.is_file() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
        if let Ok(meta) = std::fs::symlink_metadata(path) {
            return !meta.is_dir() && (meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT) != 0;
        }
    }
    false
}

/// Localiza o executável de `prog` no `caminho_busca()`, considerando extensões do Windows.
pub(super) fn localizar_binario(prog: &str) -> Option<PathBuf> {
    let prog = prog.trim().trim_matches(|c| c == '"' || c == '\'');
    if prog.is_empty() {
        return None;
    }
    let caminho = expandir_home(prog);
    let sufixos: &[&str] = if cfg!(windows) && caminho.extension().is_none() {
        &["", ".exe", ".cmd", ".bat"]
    } else {
        &[""]
    };
    let testar = |base: &Path| -> Option<PathBuf> {
        for ext in sufixos {
            let candidato = if ext.is_empty() {
                base.to_path_buf()
            } else {
                let mut s = base.as_os_str().to_os_string();
                s.push(ext);
                PathBuf::from(s)
            };
            if is_executable_file(&candidato) {
                return Some(candidato);
            }
        }
        None
    };
    if caminho.components().count() > 1 {
        return testar(&caminho);
    }
    std::env::split_paths(&caminho_busca()).find_map(|d| testar(&d.join(&caminho)))
}

/// A primeira palavra do comando existe no PATH (ou é um caminho executável)?
pub(super) fn cli_encontrada(comando: &str) -> bool {
    comando
        .split_whitespace()
        .next()
        .and_then(localizar_binario)
        .is_some()
}

pub(super) fn expandir_home(caminho: &str) -> PathBuf {
    match caminho.strip_prefix("~/") {
        Some(resto) => dirs_home().join(resto),
        None => PathBuf::from(caminho),
    }
}

pub(super) fn dirs_home() -> PathBuf {
    if cfg!(windows) {
        std::env::var_os("USERPROFILE")
            .or_else(|| std::env::var_os("HOME"))
            .map_or_else(|| PathBuf::from("C:\\"), PathBuf::from)
    } else {
        std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map_or_else(|| PathBuf::from("/"), PathBuf::from)
    }
}

pub(super) fn codex_home_dir() -> PathBuf {
    std::env::var_os("CODEX_HOME")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| dirs_home().join(".codex"))
}
