use std::sync::Arc;
use std::time::Duration;

use axum::Json;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::IntoResponse;
use axum::response::Response;
use serde::{Deserialize, Serialize};

use super::http::{autorizar, erro};
use super::processo::{caminho_busca, cortar_saida, dirs_home, expandir_home, matar_grupo};
use crate::state::WebState;

/// Comandos do terminal da Estação param depois disso.
const TEMPO_TERMINAL: Duration = Duration::from_secs(5 * 60);

#[derive(Deserialize)]
pub(crate) struct PedidoTerminal {
    /// Pasta atual do terminal (vazia = pasta pessoal).
    #[serde(default)]
    pasta: String,
    comando: String,
}

#[derive(Serialize, Debug)]
pub(crate) struct RespostaTerminal {
    /// Pasta depois do comando (muda só com `cd`).
    pub(super) pasta: String,
    pub(super) saida: String,
    pub(super) codigo: Option<i32>,
}

/// Terminal da Estação: um comando por vez, na pasta escolhida, com o shell do
/// sistema (`sh` no Linux/macOS, PowerShell no Windows).
///
/// shortcut: sem PTY, comandos que pedem senha ou interação (sudo, login das
/// CLIs, editores) não funcionam; trocar por um PTY + xterm.js se isso fizer falta.
pub(crate) async fn api_terminal(
    axum::Extension(i18n): axum::Extension<ai_memory_core::i18n::Localizer>,
    State(state): State<Arc<WebState>>,
    level: Option<axum::Extension<ai_memory_core::AuthLevel>>,
    headers: HeaderMap,
    Json(pedido): Json<PedidoTerminal>,
) -> Response {
    if let Err(recusa) = autorizar(&i18n, &state, level, &headers).await {
        return recusa;
    }
    match rodar_terminal(&pedido.pasta, &pedido.comando).await {
        Ok(r) => Json(r).into_response(),
        Err(msg) => erro(msg),
    }
}

pub(super) async fn rodar_terminal(pasta: &str, comando: &str) -> Result<RespostaTerminal, String> {
    let pasta = if pasta.trim().is_empty() {
        dirs_home()
    } else {
        expandir_home(pasta.trim())
    };
    if !pasta.is_dir() {
        return Err(format!("Pasta não encontrada: {}", pasta.display()));
    }
    let comando = comando.trim();
    if comando.is_empty() {
        return Err("Digite um comando.".into());
    }
    // Cada comando roda num processo novo, então `cd` isolado é resolvido aqui e a pasta volta ao navegador.
    // Comandos compostos (`cd sub && ...`, `cd sub; ...`) seguem para o shell normalmente.
    let cd_composto = comando.contains("&&")
        || comando.contains("||")
        || comando.contains(';')
        || comando.contains('|')
        || comando.contains('\n');
    if !cd_composto && (comando == "cd" || comando.starts_with("cd ")) {
        let alvo = comando[2..].trim().trim_matches(|c| c == '"' || c == '\'');
        let destino = if alvo.is_empty() || alvo == "~" {
            dirs_home()
        } else {
            pasta.join(expandir_home(alvo))
        };
        return Ok(match std::fs::canonicalize(&destino) {
            Ok(d) if d.is_dir() => RespostaTerminal {
                pasta: d.display().to_string(),
                saida: String::new(),
                codigo: Some(0),
            },
            _ => RespostaTerminal {
                pasta: pasta.display().to_string(),
                saida: format!("cd: pasta não encontrada: {alvo}"),
                codigo: Some(1),
            },
        });
    }
    #[cfg(windows)]
    let mut cmd = {
        let mut c = tokio::process::Command::new("powershell");
        c.args(["-NoProfile", "-NonInteractive", "-Command", comando]);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = tokio::process::Command::new("sh");
        c.args(["-c", comando]);
        c
    };
    cmd.current_dir(&pasta)
        .env("PATH", caminho_busca())
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    cmd.process_group(0);
    let filho = cmd
        .spawn()
        .map_err(|e| format!("Não consegui iniciar o shell: {e}"))?;
    let pid = filho.id();
    let saida = match tokio::time::timeout(TEMPO_TERMINAL, filho.wait_with_output()).await {
        Ok(Ok(s)) => s,
        Ok(Err(e)) => return Err(format!("Falha ao aguardar o comando: {e}")),
        Err(_) => {
            if let Some(pid) = pid {
                matar_grupo(pid);
            }
            return Err("O comando passou de 5 minutos e foi interrompido.".into());
        }
    };
    let mut texto = String::from_utf8_lossy(&saida.stdout).into_owned();
    texto.push_str(&String::from_utf8_lossy(&saida.stderr));
    cortar_saida(&mut texto);
    Ok(RespostaTerminal {
        pasta: pasta.display().to_string(),
        saida: texto,
        codigo: saida.status.code(),
    })
}
