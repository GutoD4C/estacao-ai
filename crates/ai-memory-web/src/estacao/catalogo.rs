use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use axum::Json;
use axum::response::IntoResponse;
use axum::response::Response;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use super::estado::{
    Agente, Estacao, Estado, PAPEIS, Papel, Projeto, eh_conversa, grupo_do_agente,
};
use super::processo::{caminho_busca, cli_encontrada, codex_home_dir, localizar_binario};

#[derive(Serialize, Clone)]
pub(super) struct OpcaoModelo {
    pub(super) id: String,
    pub(super) nome: String,
}

/// Uma CLI de IA que a Estação sabe usar, com os modelos que ela oferece aqui.
#[derive(Serialize, Clone)]
pub(super) struct Provedor {
    pub(super) fornecedor: &'static str,
    pub(super) rotulo: &'static str,
    pub(super) cli: &'static str,
    pub(super) instalado: bool,
    /// `Some(false)` quando a CLI está instalada mas sem login para uso sem tela.
    pub(super) login: Option<bool>,
    pub(super) comando: &'static str,
    pub(super) modelos: Vec<OpcaoModelo>,
    /// Como o consumo deste fornecedor é acompanhado.
    pub(super) consumo: &'static str,
    /// O que fazer quando falta algo (instalar, entrar).
    pub(super) dica: String,
}

#[derive(Clone, Copy, Serialize)]
struct PerfilChat {
    modelo: &'static str,
    comando: &'static str,
}

impl Provedor {
    fn perfil_chat(&self) -> Option<PerfilChat> {
        (self.fornecedor == "codex" && self.modelos.iter().any(|m| m.id == "gpt-6-luna"))
            .then_some(PerfilChat {
                modelo: "gpt-6-luna",
                comando: "codex exec --ignore-user-config --ephemeral --sandbox read-only -c model_reasoning_effort=low --skip-git-repo-check -m {modelo} -",
            })
    }

    fn padrao_para_papel(&self, papel: &Papel) -> (String, String) {
        if papel.grupo == "chat"
            && let Some(perfil) = self.perfil_chat()
        {
            return (perfil.modelo.to_owned(), perfil.comando.to_owned());
        }
        let modelo = self
            .modelos
            .first()
            .map(|m| m.id.clone())
            .unwrap_or_default();
        let comando = if self.fornecedor == "claude"
            && !papel.permissao_claude.is_empty()
            && !self.comando.contains("bypassPermissions")
        {
            format!("{} {}", self.comando, papel.permissao_claude)
        } else {
            self.comando.to_owned()
        };
        (modelo, comando)
    }
}

fn opcoes(lista: &[(&str, &str)]) -> Vec<OpcaoModelo> {
    lista
        .iter()
        .map(|(id, nome)| OpcaoModelo {
            id: (*id).to_owned(),
            nome: (*nome).to_owned(),
        })
        .collect()
}

/// Roda uma CLI curta (listar modelos, status) com tempo limite; `None` se falhar.
async fn rodar_curto(prog: &str, args: &[&str]) -> Option<String> {
    let bin = localizar_binario(prog)?;
    let eh_script_cmd = cfg!(windows)
        && bin
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"));
    let mut cmd = if eh_script_cmd {
        let mut c = tokio::process::Command::new("cmd");
        c.arg("/C").arg(&bin).args(args);
        c
    } else {
        let mut c = tokio::process::Command::new(&bin);
        c.args(args);
        c
    };
    cmd.env("PATH", caminho_busca())
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    let saida = tokio::time::timeout(Duration::from_secs(25), cmd.output())
        .await
        .ok()?
        .ok()?;
    saida
        .status
        .success()
        .then(|| String::from_utf8_lossy(&saida.stdout).into_owned())
}

/// `agy models`: linhas `id<TAB>Nome`.
pub(super) fn modelos_por_tab(texto: &str) -> Vec<OpcaoModelo> {
    texto
        .lines()
        .filter_map(|l| l.split_once('\t'))
        .map(|(id, nome)| OpcaoModelo {
            id: id.trim().to_owned(),
            nome: nome.trim().to_owned(),
        })
        .filter(|m| !m.id.is_empty())
        .collect()
}

fn modelos_codex() -> Vec<OpcaoModelo> {
    let Ok(b) = std::fs::read(codex_home_dir().join("models_cache.json")) else {
        return Vec::new();
    };
    let Ok(v) = serde_json::from_slice::<serde_json::Value>(&b) else {
        return Vec::new();
    };
    v.get("models")
        .and_then(serde_json::Value::as_array)
        .map(|ms| {
            ms.iter()
                .filter_map(|m| {
                    let id = m.get("slug")?.as_str()?.to_owned();
                    let nome = m
                        .get("display_name")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or(&id)
                        .to_owned();
                    Some(OpcaoModelo { id, nome })
                })
                .collect()
        })
        .unwrap_or_default()
}

pub(super) async fn montar_catalogo() -> Vec<Provedor> {
    let mut lista = Vec::new();

    let instalado = cli_encontrada("claude");
    let login = if !instalado {
        None
    } else if std::env::var_os("CLAUDE_CODE_OAUTH_TOKEN").is_some() {
        Some(true)
    } else {
        rodar_curto("claude", &["auth", "status"])
            .await
            .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
            .and_then(|v| v.get("loggedIn").and_then(serde_json::Value::as_bool))
    };
    lista.push(Provedor {
        fornecedor: "claude",
        rotulo: "Claude Code",
        cli: "claude",
        instalado,
        login,
        comando: "claude -p --permission-mode bypassPermissions --model {modelo} --output-format json",
        modelos: opcoes(&[
            ("opus", "Claude Opus"),
            ("sonnet", "Claude Sonnet"),
            ("haiku", "Claude Haiku"),
        ]),
        consumo: "Tokens medidos pela Estação a cada execução; limites de 5 h e semanal pela linha de status do Claude Code (configurada ao adicionar).",
        dica: if !instalado {
            "Instale o Claude Code (claude.com/claude-code).".into()
        } else if login == Some(false) {
            "Sem login para uso sem tela. Rode no terminal: scripts/estacao/configurar-claude.sh".into()
        } else {
            String::new()
        },
    });

    let instalado = cli_encontrada("codex");
    let mut mod_codex = if instalado {
        modelos_codex()
    } else {
        Vec::new()
    };
    if mod_codex.is_empty() {
        mod_codex = opcoes(&[
            ("gpt-5.4", "GPT-5.4"),
            ("gpt-5.3-codex", "GPT-5.3 Codex"),
            ("o3", "OpenAI o3"),
            ("o4-mini", "OpenAI o4-mini"),
        ]);
    }
    lista.push(Provedor {
        fornecedor: "codex",
        rotulo: "Codex",
        cli: "codex",
        instalado,
        login: None,
        comando: "codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -m {modelo} -",
        modelos: mod_codex,
        consumo: "Limites de 5 h e semanal lidos automaticamente dos registros do Codex.",
        dica: if instalado {
            String::new()
        } else {
            "Instale o Codex CLI.".into()
        },
    });

    let instalado = cli_encontrada("agy");
    let mut modelos = if instalado {
        rodar_curto("agy", &["models"])
            .await
            .map(|t| modelos_por_tab(&t))
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    if modelos.is_empty() {
        modelos = opcoes(&[
            ("gemini-4-argon-medium", "Gemini 4 Argon (Medium)"),
            ("claude-sonnet-4-5", "Claude Sonnet 4.5"),
            ("gemini-2.5-pro", "Gemini 2.5 Pro"),
        ]);
    }
    lista.push(Provedor {
        fornecedor: "antigravity-cli",
        rotulo: "Antigravity",
        cli: "agy",
        instalado,
        login: None,
        comando: "agy --dangerously-skip-permissions --model {modelo} --output-format json -p \"$(cat)\"",
        modelos,
        consumo: "Tokens medidos pela Estação a cada execução (o Antigravity não expõe limites localmente).",
        dica: if instalado { String::new() } else { "Instale o Antigravity CLI (agy).".into() },
    });

    let instalado = cli_encontrada("opencode");
    let modelos = if instalado {
        rodar_curto("opencode", &["models"])
            .await
            .map(|t| {
                t.lines()
                    .map(str::trim)
                    .filter(|l| l.contains('/') && !l.contains(' '))
                    .take(80)
                    .map(|l| OpcaoModelo {
                        id: l.to_owned(),
                        nome: l.to_owned(),
                    })
                    .collect()
            })
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    lista.push(Provedor {
        fornecedor: "opencode",
        rotulo: "OpenCode",
        cli: "opencode",
        instalado,
        login: None,
        comando: "opencode run -m {modelo} \"$(cat)\"",
        modelos,
        consumo: "Tokens medidos pelos hooks de memória.",
        dica: if instalado {
            String::new()
        } else {
            "Instale o OpenCode.".into()
        },
    });

    let instalado = cli_encontrada("gemini");
    lista.push(Provedor {
        fornecedor: "gemini",
        rotulo: "Gemini CLI",
        cli: "gemini",
        instalado,
        login: None,
        comando: "gemini -y -m {modelo} -p \"$(cat)\"",
        modelos: opcoes(&[
            ("gemini-2.5-pro", "Gemini 2.5 Pro"),
            ("gemini-2.5-flash", "Gemini 2.5 Flash"),
        ]),
        consumo: "Tokens medidos pelos hooks de memória.",
        dica: if instalado {
            String::new()
        } else {
            "Instale o Gemini CLI (npm i -g @google/gemini-cli).".into()
        },
    });

    let instalado = cli_encontrada("pi");
    lista.push(Provedor {
        fornecedor: "pi",
        rotulo: "Pi",
        cli: "pi",
        instalado,
        login: None,
        comando: "pi -p --model {modelo} \"$(cat)\"",
        modelos: opcoes(&[
            ("claude-sonnet-4-5", "Claude Sonnet 4.5"),
            ("gpt-5.4", "GPT-5.4"),
        ]),
        consumo: "Tokens medidos pelos hooks de memória.",
        dica: if instalado {
            String::new()
        } else {
            "Instale o Pi Coding Agent.".into()
        },
    });

    let instalado = cli_encontrada("ollama");
    let mut mod_ollama = if instalado {
        rodar_curto("ollama", &["list"])
            .await
            .map(|t| {
                t.lines()
                    .skip(1)
                    .filter_map(|l| l.split_whitespace().next())
                    .filter(|id| !id.is_empty())
                    .map(|id| OpcaoModelo {
                        id: id.to_owned(),
                        nome: id.to_owned(),
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    if mod_ollama.is_empty() {
        mod_ollama = opcoes(&[
            ("qwen2.5-coder:7b", "Qwen 2.5 Coder 7B"),
            ("llama3.3", "Llama 3.3"),
            ("deepseek-r1:8b", "DeepSeek R1 8B"),
        ]);
    }
    lista.push(Provedor {
        fornecedor: "ollama",
        rotulo: "Ollama (Local)",
        cli: "ollama",
        instalado,
        login: None,
        comando: "ollama run {modelo}",
        modelos: mod_ollama,
        consumo: "Execução local gratuita na sua máquina (sem limite de assinatura).",
        dica: if instalado {
            String::new()
        } else {
            "Instale o Ollama (ollama.com) para rodar modelos locais.".into()
        },
    });
    lista
}

pub(super) type CacheCatalogo = Option<(std::time::Instant, Vec<Provedor>)>;

pub(super) fn cache_catalogo() -> &'static Mutex<CacheCatalogo> {
    static C: std::sync::OnceLock<Mutex<CacheCatalogo>> = std::sync::OnceLock::new();
    C.get_or_init(Default::default)
}

#[derive(Deserialize)]
pub(crate) struct CatalogoQuery {
    #[serde(default)]
    atualizar: Option<String>,
}

/// CLIs de IA instaladas aqui e os modelos de cada uma (cache de 10 min).
pub(crate) async fn api_catalogo(
    axum::extract::Query(q): axum::extract::Query<CatalogoQuery>,
) -> Response {
    let mut cache = cache_catalogo().lock().await;
    let vencido = cache
        .as_ref()
        .is_none_or(|(quando, _)| quando.elapsed() > Duration::from_secs(600));
    if vencido || q.atualizar.is_some() {
        *cache = Some((std::time::Instant::now(), montar_catalogo().await));
    }
    #[derive(Serialize)]
    struct ItemCatalogo<'a> {
        #[serde(flatten)]
        provedor: &'a Provedor,
        perfil_chat: Option<PerfilChat>,
    }
    let lista: Vec<_> = cache
        .iter()
        .flat_map(|(_, lista)| lista)
        .map(|provedor| ItemCatalogo {
            provedor,
            perfil_chat: provedor.perfil_chat(),
        })
        .collect();
    Json(lista).into_response()
}

fn escolher_provedor_para_papel<'a>(
    papel_id: &str,
    instalados: &'a [Provedor],
    indice: usize,
) -> &'a Provedor {
    let preferencias: &[&str] = match papel_id {
        "pensador" => &[
            "claude",
            "antigravity-cli",
            "gemini",
            "codex",
            "opencode",
            "pi",
            "ollama",
        ],
        "desenvolvedor" => &[
            "codex",
            "claude",
            "antigravity-cli",
            "opencode",
            "pi",
            "gemini",
            "ollama",
        ],
        "testador" => &[
            "codex",
            "antigravity-cli",
            "claude",
            "gemini",
            "opencode",
            "pi",
            "ollama",
        ],
        "qa_seguranca" => &[
            "antigravity-cli",
            "claude",
            "gemini",
            "codex",
            "opencode",
            "pi",
            "ollama",
        ],
        "documentador" => &[
            "antigravity-cli",
            "gemini",
            "claude",
            "codex",
            "opencode",
            "pi",
            "ollama",
        ],
        "publicador" => &[
            "codex",
            "claude",
            "antigravity-cli",
            "opencode",
            "pi",
            "gemini",
            "ollama",
        ],
        "filosofo" => &[
            "antigravity-cli",
            "claude",
            "gemini",
            "codex",
            "opencode",
            "pi",
            "ollama",
        ],
        "pessoa" => &[
            "codex",
            "antigravity-cli",
            "gemini",
            "claude",
            "opencode",
            "pi",
            "ollama",
        ],
        "cetico" => &[
            "codex",
            "claude",
            "antigravity-cli",
            "gemini",
            "opencode",
            "pi",
            "ollama",
        ],
        "otimista" => &[
            "antigravity-cli",
            "gemini",
            "codex",
            "claude",
            "opencode",
            "pi",
            "ollama",
        ],
        "mediador" => &[
            "claude",
            "antigravity-cli",
            "gemini",
            "codex",
            "opencode",
            "pi",
            "ollama",
        ],
        _ => &[],
    };
    if instalados.len() > 1 {
        for pref in preferencias {
            if let Some(p) = instalados.iter().find(|p| p.fornecedor == *pref) {
                return p;
            }
        }
    }
    &instalados[indice % instalados.len()]
}

pub(super) fn aplicar_auto_configuracao(
    e: &mut Estado,
    instalados: &[Provedor],
    grupo: Option<&str>,
    quantidades: Option<&HashMap<String, usize>>,
) -> Option<String> {
    let alvo = grupo
        .map(str::trim)
        .filter(|s| *s == "projetos" || *s == "chat");

    // 1. Garante um agente direto para cada CLI instalada (apenas quando sem quantidades explícitas).
    if alvo != Some("chat") && quantidades.is_none() {
        for prov in instalados {
            let ja_tem = e.agentes.iter().any(|a| {
                a.fornecedor == prov.fornecedor
                    && a.funcao.is_empty()
                    && grupo_do_agente(a) == "projetos"
            });
            if !ja_tem {
                let modelo = prov
                    .modelos
                    .first()
                    .map(|m| m.id.clone())
                    .unwrap_or_default();
                let id = e.novo_id("ag");
                e.agentes.push(Agente {
                    id,
                    nome: prov.rotulo.to_owned(),
                    modelo,
                    papel: "Assistente Geral".into(),
                    funcao: String::new(),
                    grupo: "projetos".into(),
                    fornecedor: prov.fornecedor.to_owned(),
                    comando: prov.comando.to_owned(),
                    dono_npub: e.nostr_perfil.npub.clone(),
                    ..Agente::default()
                });
            }
        }
    }

    // 2. Distribui os papéis da aba/grupo selecionado entre os provedores ativos.
    for (idx, pp) in PAPEIS
        .iter()
        .filter(|pp| alvo.is_none_or(|g| pp.grupo == g))
        .enumerate()
    {
        let nome_curto = pp
            .nome
            .split_once(" (")
            .map_or(pp.nome, |(n, _)| n)
            .to_owned();

        if let Some(qmap) = quantidades {
            let qtd = qmap.get(pp.id).copied().unwrap_or(0).min(8);
            let atuais: Vec<String> = e
                .agentes
                .iter()
                .filter(|a| a.funcao == pp.id)
                .map(|a| a.id.clone())
                .collect();
            let manter = atuais.len().min(qtd);
            if atuais.len() > qtd {
                let remover: HashSet<String> = atuais.into_iter().skip(qtd).collect();
                e.agentes.retain(|a| !remover.contains(&a.id));
                for p in &mut e.projetos {
                    p.agentes.retain(|id| !remover.contains(id));
                }
            }
            for k in manter..qtd {
                let prov = if k == 0 {
                    escolher_provedor_para_papel(pp.id, instalados, idx)
                } else {
                    &instalados[(idx + k) % instalados.len()]
                };
                let (modelo_padrao, comando) = prov.padrao_para_papel(pp);
                let nome = if qtd == 1 {
                    nome_curto.clone()
                } else {
                    format!("{nome_curto} {}", k + 1)
                };
                let id = e.novo_id("ag");
                e.agentes.push(Agente {
                    id,
                    nome,
                    modelo: modelo_padrao,
                    papel: String::new(),
                    funcao: pp.id.to_owned(),
                    grupo: pp.grupo.to_owned(),
                    fornecedor: prov.fornecedor.to_owned(),
                    comando,
                    dono_npub: e.nostr_perfil.npub.clone(),
                    ..Agente::default()
                });
            }
            continue;
        }

        let prov = escolher_provedor_para_papel(pp.id, instalados, idx);
        let (modelo_padrao, comando) = prov.padrao_para_papel(pp);
        if let Some(existente) = e.agentes.iter_mut().find(|a| a.funcao == pp.id) {
            existente.grupo = pp.grupo.to_owned();
            if instalados.len() > 1 && existente.fornecedor != prov.fornecedor {
                existente.fornecedor = prov.fornecedor.to_owned();
                existente.modelo = modelo_padrao;
                existente.comando = comando;
            }
        } else {
            let id = e.novo_id("ag");
            e.agentes.push(Agente {
                id,
                nome: nome_curto,
                modelo: modelo_padrao,
                papel: String::new(),
                funcao: pp.id.to_owned(),
                grupo: pp.grupo.to_owned(),
                fornecedor: prov.fornecedor.to_owned(),
                comando,
                dono_npub: e.nostr_perfil.npub.clone(),
                ..Agente::default()
            });
        }
    }

    // 3. Apenas quando configurando Chat (ou global), garante "Conversa Rápida" só com modelos de Chat (até 6 na sala pessoal).
    if alvo != Some("projetos") {
        let mut chat_ids: Vec<String> = e
            .agentes
            .iter()
            .filter(|a| grupo_do_agente(a) == "chat")
            .map(|a| a.id.clone())
            .collect();
        let chat_set: HashSet<String> = chat_ids.iter().cloned().collect();
        chat_ids.truncate(6);
        let chat_id = if let Some(chat) = e.projetos.iter_mut().find(|p| eh_conversa(p)) {
            chat.agentes.retain(|id| chat_set.contains(id));
            for id in &chat_ids {
                if chat.agentes.len() >= 6 {
                    break;
                }
                if !chat.agentes.contains(id) {
                    chat.agentes.push(id.clone());
                }
            }
            chat.id.clone()
        } else {
            let id = e.novo_id("pr");
            e.projetos.push(Projeto {
                id: id.clone(),
                nome: "Conversa Rápida".into(),
                descricao:
                    "Debates e conversas com os papéis de Chat distribuídos entre provedores."
                        .into(),
                pasta: String::new(),
                agentes: chat_ids,
                memoria: String::new(),
                contexto: String::new(),
                eh_chat: true,
                dono_npub: e.nostr_perfil.npub.clone(),
                ..Projeto::default()
            });
            id
        };
        Some(chat_id)
    } else {
        None
    }
}

pub(super) async fn auto_configurar(
    est: Arc<Estacao>,
    grupo: Option<String>,
    quantidades: Option<HashMap<String, usize>>,
) -> Result<Option<String>, String> {
    let catalogo = montar_catalogo().await;
    let desativadas: HashSet<String> = {
        let e = est.estado.lock().await;
        e.ferramentas_desativadas.iter().cloned().collect()
    };
    let instalados: Vec<Provedor> = catalogo
        .into_iter()
        .filter(|p| p.instalado && !desativadas.contains(p.fornecedor))
        .collect();
    if instalados.is_empty() {
        return Err(
            "Nenhuma ferramenta de IA ativa foi encontrada. Ative ao menos uma ferramenta em \"Ferramentas neste computador\"."
                .into(),
        );
    }
    est.mudar(|e| {
        let out = aplicar_auto_configuracao(e, &instalados, grupo.as_deref(), quantidades.as_ref());
        e.garantir_permissoes_projetos();
        Ok(out)
    })
    .await
}
