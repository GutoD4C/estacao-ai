use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use axum::Json;
use axum::extract::State;
use axum::response::IntoResponse;
use axum::response::Response;
use serde::Serialize;

use super::catalogo::{cache_catalogo, montar_catalogo};
use super::estado::{agora, estacao};
use super::processo::{cli_encontrada, dirs_home};
use crate::state::WebState;

#[derive(Serialize, Default)]
struct Janela {
    /// Percentual usado (0–100), quando o fornecedor informa.
    usado: Option<f64>,
    /// Percentual livre (0–100), calculado a partir de `usado`.
    livre: Option<f64>,
    /// Quando a janela renova, em segundos Unix.
    renova: Option<i64>,
    /// Tokens do modelo medidos pelos hooks nessa janela (entrada nova + saída).
    tokens: u64,
    /// Total de tokens do fornecedor inteiro nessa janela (útil para comparar).
    tokens_fornecedor: u64,
    /// Tokens de cache (leitura + escrita) na janela.
    cache_tokens: u64,
    /// Tokens das execuções feitas pela Estação nessa janela (saída JSON da CLI).
    tokens_estacao: u64,
}

#[derive(Serialize)]
struct ConsumoAgente {
    id: String,
    nome: String,
    modelo: String,
    papel: String,
    fornecedor: String,
    execucoes: u64,
    segundos: u64,
    cli_ausente: bool,
    /// `"modelo"` quando filtrado pelo modelo cadastrado; `"fornecedor"` quando soma a CLI toda.
    escopo_tokens: String,
    cinco_horas: Janela,
    semanal: Janela,
    /// De onde vieram os percentuais, ou por que não há.
    fonte: String,
}

#[derive(Serialize)]
struct ModeloObservado {
    fornecedor: String,
    modelo: String,
    chamadas_5h: u64,
    tokens_5h: u64,
    chamadas_7d: u64,
    tokens_7d: u64,
    cache_7d: u64,
}

#[derive(Serialize)]
struct ConsumoProvedor {
    fornecedor: String,
    rotulo: String,
    instalado: bool,
    execucoes: u64,
    segundos: u64,
    modelos: Vec<String>,
    cinco_horas: Janela,
    semanal: Janela,
    fonte: String,
}

#[derive(Serialize)]
struct ConsumoResposta {
    provedores: Vec<ConsumoProvedor>,
    agentes: Vec<ConsumoAgente>,
    modelos_observados: Vec<ModeloObservado>,
    claude_statusline_ativo: bool,
    claude_statusline_snippet: String,
}

#[derive(Clone, Default)]
struct LinhaToken {
    fornecedor: String,
    modelo: String,
    chamadas_5h: u64,
    t5: u64,
    c5: u64,
    chamadas_7d: u64,
    t7: u64,
    c7: u64,
}

fn harness_fornecedor(fornecedor: &str) -> &str {
    match fornecedor {
        "claude" => "claude-code",
        "codex" => "codex",
        "gemini" => "gemini",
        "opencode" => "opencode",
        "pi" => "pi",
        "antigravity" | "antigravity-cli" => "antigravity-cli",
        outro => outro,
    }
}

pub(super) fn modelo_bate(registrado: &str, observado: &str) -> bool {
    let reg = registrado.trim().to_ascii_lowercase();
    let obs = observado.trim().to_ascii_lowercase();
    if reg.is_empty() {
        return true;
    }
    if obs.is_empty() {
        return false;
    }
    let reg_norm: String = reg.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    let obs_norm: String = obs.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    obs == reg
        || obs.contains(&reg)
        || reg.contains(&obs)
        || (!reg_norm.is_empty() && (obs_norm.contains(&reg_norm) || reg_norm.contains(&obs_norm)))
}

pub(crate) async fn api_consumo(State(state): State<Arc<WebState>>) -> Response {
    let agentes = estacao(&state).estado.lock().await.agentes.clone();
    let agora_us = jiff::Timestamp::now().as_microsecond();
    let linhas_tokens: Vec<LinhaToken> = state
        .reader
        .with_conn(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT s.agent_kind, COALESCE(c.model, ''), \
                 COALESCE(SUM(CASE WHEN c.observed_at>=?1 THEN 1 END), 0), \
                 COALESCE(SUM(CASE WHEN c.observed_at>=?1 THEN c.input_tokens+c.output_tokens END), 0), \
                 COALESCE(SUM(CASE WHEN c.observed_at>=?1 THEN c.cache_read_tokens+c.cache_write_tokens END), 0), \
                 COUNT(*), \
                 COALESCE(SUM(c.input_tokens+c.output_tokens), 0), \
                 COALESCE(SUM(c.cache_read_tokens+c.cache_write_tokens), 0) \
                 FROM token_calls c JOIN sessions s ON s.id=c.session_id \
                 WHERE c.observed_at>=?2 \
                 GROUP BY s.agent_kind, COALESCE(c.model, '') \
                 ORDER BY 7 DESC",
            )?;
            let linhas = stmt.query_map(
                rusqlite::params![agora_us - 5 * 3600 * 1_000_000, agora_us - 7 * 86400 * 1_000_000],
                |r| {
                    Ok(LinhaToken {
                        fornecedor: r.get(0)?,
                        modelo: r.get(1)?,
                        chamadas_5h: u64::try_from(r.get::<_, i64>(2)?).unwrap_or(0),
                        t5: u64::try_from(r.get::<_, i64>(3)?).unwrap_or(0),
                        c5: u64::try_from(r.get::<_, i64>(4)?).unwrap_or(0),
                        chamadas_7d: u64::try_from(r.get::<_, i64>(5)?).unwrap_or(0),
                        t7: u64::try_from(r.get::<_, i64>(6)?).unwrap_or(0),
                        c7: u64::try_from(r.get::<_, i64>(7)?).unwrap_or(0),
                    })
                },
            )?;
            Ok(linhas.collect::<rusqlite::Result<Vec<_>>>()?)
        })
        .await
        .unwrap_or_default();

    let dir = state.wiki.data_dir().join("estacao").join("limites");
    let codex = tokio::task::spawn_blocking(limites_codex)
        .await
        .ok()
        .flatten();
    let claude = std::fs::read(dir.join("claude.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok());
    let claude_statusline_ativo = claude.is_some();

    let catalogo = {
        let mut cache = cache_catalogo().lock().await;
        let vencido = cache
            .as_ref()
            .is_none_or(|(quando, _)| quando.elapsed() > Duration::from_secs(600));
        if vencido {
            *cache = Some((std::time::Instant::now(), montar_catalogo().await));
        }
        cache.as_ref().map(|(_, l)| l.clone()).unwrap_or_default()
    };

    let preencher_limites = |forn: &str, cinco: &mut Janela, semana: &mut Janela| -> String {
        let fonte = match forn {
            "codex" => match &codex {
                Some(l) => {
                    (cinco.usado, cinco.renova) = l.0;
                    (semana.usado, semana.renova) = l.1;
                    "Último registro de limites nas sessões do Codex (~/.codex/sessions).".into()
                }
                None => "Nenhuma sessão do Codex com limites encontrada ainda.".into(),
            },
            "claude" | "claude-code" => match &claude {
                Some(v) => {
                    let rl = v.get("rate_limits").unwrap_or(v);
                    (cinco.usado, cinco.renova) = janela_json(rl.get("five_hour"));
                    (semana.usado, semana.renova) = janela_json(rl.get("seven_day"));
                    "Linha de status do Claude Code (compartilhada pela assinatura).".into()
                }
                None => "Ative a linha de status da Estação-ai no Claude Code para ver os limites."
                    .into(),
            },
            _ => "Tokens medidos pelos hooks de memória e pelas execuções na Estação.".into(),
        };
        let agora_s = agora();
        for j in [cinco, semana] {
            if j.renova.is_some_and(|r| r <= agora_s) {
                j.usado = Some(0.0);
                j.renova = None;
            }
            j.livre = j.usado.map(|u| (100.0 - u).clamp(0.0, 100.0));
        }
        fonte
    };

    let mut provedores: Vec<ConsumoProvedor> = Vec::new();
    let mut vistos_forn: HashSet<String> = HashSet::new();
    let mut todos_forn: Vec<(String, String, bool)> = catalogo
        .iter()
        .map(|p| (p.fornecedor.to_owned(), p.rotulo.to_owned(), p.instalado))
        .collect();
    for a in &agentes {
        if !todos_forn.iter().any(|(f, _, _)| f == &a.fornecedor) {
            todos_forn.push((
                a.fornecedor.clone(),
                a.fornecedor.clone(),
                cli_encontrada(&a.comando),
            ));
        }
    }
    for row in &linhas_tokens {
        let forn = match row.fornecedor.as_str() {
            "claude-code" => "claude",
            outro => outro,
        };
        if !todos_forn.iter().any(|(f, _, _)| f == forn) {
            todos_forn.push((forn.to_owned(), row.fornecedor.clone(), false));
        }
    }

    for (forn, rotulo, instalado) in todos_forn {
        if !vistos_forn.insert(forn.clone()) {
            continue;
        }
        let harness = harness_fornecedor(&forn);
        let mut t5 = 0u64;
        let mut t7 = 0u64;
        let mut c5 = 0u64;
        let mut c7 = 0u64;
        let mut modelos_set: HashSet<String> = HashSet::new();
        for row in linhas_tokens
            .iter()
            .filter(|l| l.fornecedor == harness || l.fornecedor == forn)
        {
            t5 = t5.saturating_add(row.t5);
            t7 = t7.saturating_add(row.t7);
            c5 = c5.saturating_add(row.c5);
            c7 = c7.saturating_add(row.c7);
            if !row.modelo.trim().is_empty() {
                modelos_set.insert(row.modelo.clone());
            }
        }
        let agora_e = agora();
        let mut e5 = 0u64;
        let mut e7 = 0u64;
        let mut execucoes = 0u64;
        let mut segundos = 0u64;
        for a in agentes.iter().filter(|a| a.fornecedor == forn) {
            execucoes = execucoes.saturating_add(a.execucoes);
            segundos = segundos.saturating_add(a.segundos);
            if !a.modelo.trim().is_empty() {
                modelos_set.insert(a.modelo.clone());
            }
            for u in &a.uso {
                if u.em >= agora_e - 5 * 3600 {
                    e5 = e5.saturating_add(u.entrada + u.saida);
                }
                if u.em >= agora_e - 7 * 86_400 {
                    e7 = e7.saturating_add(u.entrada + u.saida);
                }
            }
        }
        // Mostra provedor se estiver instalado, tiver agentes cadastrados, ou tiver tokens registrados.
        if !instalado && execucoes == 0 && t7 == 0 && e7 == 0 && modelos_set.is_empty() {
            continue;
        }
        let mut cinco = Janela {
            tokens_estacao: e5,
            tokens: t5,
            tokens_fornecedor: t5,
            cache_tokens: c5,
            ..Janela::default()
        };
        let mut semana = Janela {
            tokens_estacao: e7,
            tokens: t7,
            tokens_fornecedor: t7,
            cache_tokens: c7,
            ..Janela::default()
        };
        let fonte = preencher_limites(&forn, &mut cinco, &mut semana);
        let mut modelos: Vec<String> = modelos_set.into_iter().collect();
        modelos.sort();
        provedores.push(ConsumoProvedor {
            fornecedor: forn,
            rotulo,
            instalado,
            execucoes,
            segundos,
            modelos,
            cinco_horas: cinco,
            semanal: semana,
            fonte,
        });
    }

    let lista: Vec<ConsumoAgente> = agentes
        .into_iter()
        .map(|a| {
            let harness = harness_fornecedor(&a.fornecedor);
            let mut t5_forn = 0u64;
            let mut t7_forn = 0u64;
            let mut t5_mod = 0u64;
            let mut t7_mod = 0u64;
            let mut c5_mod = 0u64;
            let mut c7_mod = 0u64;
            let tem_modelo = !a.modelo.trim().is_empty();
            for row in linhas_tokens.iter().filter(|l| l.fornecedor == harness) {
                t5_forn = t5_forn.saturating_add(row.t5);
                t7_forn = t7_forn.saturating_add(row.t7);
                if !tem_modelo || modelo_bate(&a.modelo, &row.modelo) {
                    t5_mod = t5_mod.saturating_add(row.t5);
                    t7_mod = t7_mod.saturating_add(row.t7);
                    c5_mod = c5_mod.saturating_add(row.c5);
                    c7_mod = c7_mod.saturating_add(row.c7);
                }
            }
            let agora_e = agora();
            let soma = |desde: i64| -> u64 {
                a.uso
                    .iter()
                    .filter(|u| u.em >= desde)
                    .map(|u| u.entrada + u.saida)
                    .sum()
            };
            let (e5, e7) = (soma(agora_e - 5 * 3600), soma(agora_e - 7 * 86_400));
            let mut cinco = Janela {
                tokens_estacao: e5,
                tokens: t5_mod,
                tokens_fornecedor: t5_forn,
                cache_tokens: c5_mod,
                ..Janela::default()
            };
            let mut semana = Janela {
                tokens_estacao: e7,
                tokens: t7_mod,
                tokens_fornecedor: t7_forn,
                cache_tokens: c7_mod,
                ..Janela::default()
            };
            let fonte = match a.fornecedor.as_str() {
                "codex" => match &codex {
                    Some(l) => {
                        (cinco.usado, cinco.renova) = l.0;
                        (semana.usado, semana.renova) = l.1;
                        "Último registro de limites nas sessões do Codex (~/.codex/sessions)."
                            .into()
                    }
                    None => "Nenhuma sessão do Codex com limites encontrada ainda.".into(),
                },
                "claude" => match &claude {
                    Some(v) => {
                        let rl = v.get("rate_limits").unwrap_or(v);
                        (cinco.usado, cinco.renova) = janela_json(rl.get("five_hour"));
                        (semana.usado, semana.renova) = janela_json(rl.get("seven_day"));
                        "Linha de status do Claude Code (compartilhada pela assinatura).".into()
                    }
                    None => {
                        "Ative a linha de status da Estação-ai no Claude Code para ver os limites."
                            .into()
                    }
                },
                _ => {
                    "Este fornecedor não expõe limites localmente; mostra os tokens medidos.".into()
                }
            };
            let agora_s = agora();
            for j in [&mut cinco, &mut semana] {
                // Registro antigo: a janela já renovou e não houve uso registrado depois.
                if j.renova.is_some_and(|r| r <= agora_s) {
                    j.usado = Some(0.0);
                    j.renova = None;
                }
                j.livre = j.usado.map(|u| (100.0 - u).clamp(0.0, 100.0));
            }
            ConsumoAgente {
                cli_ausente: !cli_encontrada(&a.comando),
                escopo_tokens: if tem_modelo {
                    "modelo".into()
                } else {
                    "fornecedor".into()
                },
                id: a.id,
                nome: a.nome,
                modelo: a.modelo,
                papel: a.papel,
                fornecedor: a.fornecedor,
                execucoes: a.execucoes,
                segundos: a.segundos,
                cinco_horas: cinco,
                semanal: semana,
                fonte,
            }
        })
        .collect();

    let modelos_observados = linhas_tokens
        .into_iter()
        .map(|l| ModeloObservado {
            fornecedor: l.fornecedor,
            modelo: if l.modelo.is_empty() {
                "(padrão)".into()
            } else {
                l.modelo
            },
            chamadas_5h: l.chamadas_5h,
            tokens_5h: l.t5,
            chamadas_7d: l.chamadas_7d,
            tokens_7d: l.t7,
            cache_7d: l.c7,
        })
        .collect();

    Json(ConsumoResposta {
        provedores,
        agentes: lista,
        modelos_observados,
        claude_statusline_ativo,
        claude_statusline_snippet: format!(
            "\"statusLine\": {{ \"type\": \"command\", \"command\": {} }}",
            serde_json::to_string(&comando_statusline_claude()).unwrap_or_default()
        ),
    })
    .into_response()
}

fn script_statusline_claude() -> Option<PathBuf> {
    #[cfg(windows)]
    let rel = "scripts/estacao/statusline-limites.ps1";
    #[cfg(not(windows))]
    let rel = "scripts/estacao/statusline-limites.sh";

    std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(|d| d.join(rel)))
        .filter(|p| p.is_file())
}

fn comando_statusline_claude() -> String {
    #[cfg(windows)]
    let path_str = script_statusline_claude()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| {
            "%LOCALAPPDATA%\\Programs\\estacao-ai\\scripts\\estacao\\statusline-limites.ps1".into()
        });
    #[cfg(windows)]
    {
        format!("powershell -NoProfile -ExecutionPolicy Bypass -File \"{path_str}\"")
    }
    #[cfg(not(windows))]
    {
        let path_str = script_statusline_claude()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| {
                "$HOME/.local/share/estacao-ai/scripts/estacao/statusline-limites.sh".into()
            });
        format!("\"{path_str}\"")
    }
}

/// Liga a linha de status da Estação no Claude Code, para ler os limites de
/// 5 h e semanal. Não mexe numa linha de status que já exista.
pub(super) fn configurar_statusline_claude() -> Result<bool, String> {
    let _script = script_statusline_claude()
        .ok_or("Script da linha de status não instalado ao lado do binário.")?;
    let arquivo = dirs_home().join(".claude/settings.json");
    let mut v: serde_json::Value = match std::fs::read(&arquivo) {
        Ok(b) => serde_json::from_slice(&b).map_err(|e| format!("settings.json ilegível: {e}"))?,
        Err(_) => serde_json::json!({}),
    };
    let obj = v
        .as_object_mut()
        .ok_or("settings.json não é um objeto JSON.")?;
    if obj.contains_key("statusLine") {
        return Ok(false);
    }
    obj.insert(
        "statusLine".into(),
        serde_json::json!({ "type": "command", "command": comando_statusline_claude() }),
    );
    if arquivo.is_file() {
        let copia = arquivo.with_extension("json.antes-estacao-ai");
        if !copia.exists() {
            std::fs::copy(&arquivo, &copia).map_err(|e| e.to_string())?;
        }
    }
    let corpo = serde_json::to_vec_pretty(&v).map_err(|e| e.to_string())?;
    let tmp = arquivo.with_extension("json.tmp-estacao");
    std::fs::write(&tmp, corpo).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &arquivo).map_err(|e| e.to_string())?;
    Ok(true)
}

type Limite = (Option<f64>, Option<i64>);

pub(super) fn janela_json(v: Option<&serde_json::Value>) -> Limite {
    let Some(v) = v else { return (None, None) };
    let usado = ["used_percentage", "used_percent", "utilization"]
        .iter()
        .find_map(|k| v.get(*k).and_then(serde_json::Value::as_f64));
    let renova = v.get("resets_at").and_then(|r| {
        r.as_i64().or_else(|| {
            r.as_str()
                .and_then(|s| s.parse::<jiff::Timestamp>().ok())
                .map(|t| t.as_second())
        })
    });
    (usado, renova)
}

/// Limites (5 h, semanal) do registro mais recente do Codex.
fn limites_codex() -> Option<(Limite, Limite)> {
    let raiz = dirs_home().join(".codex").join("sessions");
    let mut arquivos = Vec::new();
    // sessions/AAAA/MM/DD/*.jsonl: basta olhar os dias mais recentes.
    for ano in ordenados(&raiz).into_iter().rev().take(2) {
        for mes in ordenados(&ano).into_iter().rev().take(2) {
            for dia in ordenados(&mes).into_iter().rev().take(7) {
                arquivos.extend(ordenados(&dia));
            }
        }
    }
    arquivos.sort_by_key(|f| std::fs::metadata(f).and_then(|m| m.modified()).ok());
    for arquivo in arquivos.iter().rev().take(10) {
        let Ok(texto) = std::fs::read_to_string(arquivo) else {
            continue;
        };
        for linha in texto.lines().rev() {
            if !linha.contains("\"rate_limits\"") {
                continue;
            }
            let Ok(v) = serde_json::from_str::<serde_json::Value>(linha) else {
                continue;
            };
            let Some(rl) = buscar(&v, "rate_limits") else {
                continue;
            };
            let mut cinco = (None, None);
            let mut semana = (None, None);
            for chave in ["primary", "secondary"] {
                let Some(j) = rl.get(chave).filter(|j| !j.is_null()) else {
                    continue;
                };
                let valor = (
                    j.get("used_percent").and_then(serde_json::Value::as_f64),
                    j.get("resets_at").and_then(serde_json::Value::as_i64),
                );
                match j.get("window_minutes").and_then(serde_json::Value::as_i64) {
                    Some(m) if m <= 300 => cinco = valor,
                    _ => semana = valor,
                }
            }
            return Some((cinco, semana));
        }
    }
    None
}

fn ordenados(dir: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|it| it.filter_map(|e| e.ok().map(|e| e.path())).collect())
        .unwrap_or_default();
    v.sort();
    v
}

fn buscar<'a>(v: &'a serde_json::Value, chave: &str) -> Option<&'a serde_json::Value> {
    match v {
        serde_json::Value::Object(m) => m
            .get(chave)
            .or_else(|| m.values().find_map(|x| buscar(x, chave))),
        _ => None,
    }
}
