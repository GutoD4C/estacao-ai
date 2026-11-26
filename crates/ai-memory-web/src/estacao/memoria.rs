use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use ai_memory_core::{ActorContext, PagePath, Tier, UserId};
use ai_memory_store::{Compaction, PurgeMode, ScopeResolutionError, StoreError};
use ai_memory_wiki::{AdmissionContext, AdmissionOp, WritePageRequest};
use axum::Json;
use axum::extract::{Path as UrlPath, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};

use super::estado::{
    Agente, Estacao, Estado, Mensagem, Projeto, Tarefa, agora, eh_conversa, estacao, papel,
};
use super::http::autorizar;
use super::processo::expandir_home;
use crate::state::WebState;

/// Caracteres por mensagem do histórico no prompt (CLIs com `"$(cat)"` têm limite de argumento).
pub(super) const MAX_HISTORICO: usize = 3_000;
const ESCOPO_GLOBAL: &str = "default/_global";
const FORMATO_PACOTE_MEMORIA: &str = "estacao-ai-memoria-v1";

pub(super) fn parse_escopo(escopo: &str) -> Result<(&str, &str), String> {
    let limpo = escopo.trim();
    let Some((ws, proj)) = limpo.split_once('/') else {
        return Err("Escopo de memória inválido (esperado workspace/projeto).".into());
    };
    if ws.is_empty()
        || proj.is_empty()
        || proj.contains('/')
        || ws.contains(['\n', '\r', '\0', '\\', '"'])
        || proj.contains(['\n', '\r', '\0', '\\', '"'])
        || ws == "."
        || ws == ".."
        || proj == "."
        || proj == ".."
    {
        return Err("Escopo de memória inválido.".into());
    }
    Ok((ws, proj))
}

pub(super) async fn vincular_pasta(est: Arc<Estacao>, projeto_id: &str) -> Result<(), String> {
    let p = {
        let e = est.estado.lock().await;
        e.projeto(projeto_id)
            .cloned()
            .ok_or("Projeto inexistente.")?
    };
    let pasta_txt = p.pasta.trim();
    if pasta_txt.is_empty() {
        return Err("Configure a pasta do projeto antes de gravar o .estacao-ai.toml.".into());
    }
    let (ws, proj) = parse_escopo(&p.memoria)
        .map_err(|_| "Selecione uma memória ligada (workspace/projeto) primeiro.".to_owned())?;
    let pasta = expandir_home(pasta_txt);
    if !pasta.is_dir() {
        return Err(format!("Pasta não encontrada: {}", pasta.display()));
    }
    let conteudo = format!("workspace = \"{ws}\"\nproject = \"{proj}\"\n");
    tokio::fs::write(pasta.join(".estacao-ai.toml"), conteudo)
        .await
        .map_err(|e| format!("Não consegui gravar .estacao-ai.toml: {e}"))
}

#[derive(Clone, Serialize, Default)]
pub(super) struct PaginaMemoria {
    pub(super) path: String,
    pub(super) title: String,
    pub(super) tier: String,
    pub(super) pinned: bool,
    pub(super) resumo: String,
    pub(super) updated_at: i64,
}

#[derive(Clone, Serialize)]
struct SessaoMemoria {
    id: String,
    agent_kind: String,
    started_at: i64,
    ended: bool,
}

#[derive(Default)]
pub(super) struct MemoriaPrompt {
    pub(super) globais: Vec<PaginaMemoria>,
    pub(super) projeto: Vec<PaginaMemoria>,
}

#[derive(Serialize)]
struct ContextoProjetoResposta {
    escopo: String,
    tem_toml: bool,
    paginas_globais: Vec<PaginaMemoria>,
    paginas_projeto: Vec<PaginaMemoria>,
    sessoes_recentes: Vec<SessaoMemoria>,
}

pub(super) fn resumir_corpo(corpo: &str, max_chars: usize) -> String {
    let limpo = corpo.trim();
    if limpo.is_empty() {
        return String::new();
    }
    let mut out = String::new();
    for ch in limpo.chars().take(max_chars) {
        out.push(ch);
    }
    if limpo.chars().count() > max_chars {
        out.push('…');
    }
    out
}

async fn ler_paginas_escopo(
    state: &WebState,
    viewer: Option<ai_memory_core::UserId>,
    ws: &str,
    proj: &str,
    limite: usize,
) -> (Vec<PaginaMemoria>, Vec<SessaoMemoria>) {
    let Ok(escopo) = crate::routes::resolve_read_scope(state, viewer, ws, proj).await else {
        return (Vec::new(), Vec::new());
    };
    let (w, p) = (escopo.workspace_id, escopo.project_id);
    let paginas = state
        .reader
        .with_conn(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT path, COALESCE(title, path), tier, pinned, COALESCE(body, ''), updated_at \
                 FROM pages \
                 WHERE workspace_id=?1 AND project_id=?2 AND is_latest=1 \
                 ORDER BY (CASE \
                     WHEN path LIKE '_rules/%' THEN 0 \
                     WHEN pinned=1 THEN 1 \
                     WHEN path LIKE 'decisions/%' OR path LIKE 'gotchas/%' THEN 2 \
                     ELSE 3 END), updated_at DESC \
                 LIMIT ?3",
            )?;
            let linhas = stmt.query_map(
                rusqlite::params![w.as_bytes(), p.as_bytes(), limite as i64],
                |r| {
                    let body: String = r.get(4)?;
                    Ok(PaginaMemoria {
                        path: r.get(0)?,
                        title: r.get(1)?,
                        tier: r.get(2)?,
                        pinned: r.get::<_, i64>(3)? != 0,
                        resumo: resumir_corpo(&body, 420),
                        updated_at: r.get(5)?,
                    })
                },
            )?;
            Ok(linhas.collect::<rusqlite::Result<Vec<_>>>()?)
        })
        .await
        .unwrap_or_default();

    let sessoes = state
        .reader
        .with_conn(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT LOWER(HEX(id)), agent_kind, started_at, ended_at IS NOT NULL \
                 FROM sessions \
                 WHERE workspace_id=?1 AND project_id=?2 \
                 ORDER BY started_at DESC LIMIT 6",
            )?;
            let linhas = stmt.query_map(rusqlite::params![w.as_bytes(), p.as_bytes()], |r| {
                Ok(SessaoMemoria {
                    id: r.get(0)?,
                    agent_kind: r.get(1)?,
                    started_at: r.get(2)?,
                    ended: r.get::<_, i64>(3)? != 0,
                })
            })?;
            Ok(linhas.collect::<rusqlite::Result<Vec<_>>>()?)
        })
        .await
        .unwrap_or_default();

    (paginas, sessoes)
}

/// Páginas relevantes da memória global (`default/_global`) e do projeto ligado.
pub(super) async fn memoria_do_projeto(
    state: &WebState,
    est: &Estacao,
    projeto: &str,
) -> MemoriaPrompt {
    let alvo = {
        let e = est.estado.lock().await;
        e.projeto(projeto)
            .map(|p| p.memoria.clone())
            .unwrap_or_default()
    };
    let (globais, _) = ler_paginas_escopo(state, None, "default", "_global", 6).await;
    let projeto = match alvo.split_once('/') {
        Some((ws, proj)) => ler_paginas_escopo(state, None, ws, proj, 16).await.0,
        None => Vec::new(),
    };
    MemoriaPrompt { globais, projeto }
}

pub(crate) async fn api_contexto(
    State(state): State<Arc<WebState>>,
    viewer: Option<axum::Extension<ai_memory_core::AuthorizedViewer>>,
    UrlPath(id): UrlPath<String>,
) -> Response {
    let projeto = {
        let est = estacao(&state);
        let e = est.estado.lock().await;
        e.projeto(&id).cloned()
    };
    let Some(p) = projeto else {
        return (StatusCode::NOT_FOUND, "Projeto não encontrado.").into_response();
    };
    let uid = viewer.map(|v| v.0.user());
    let (paginas_globais, _) = ler_paginas_escopo(&state, uid, "default", "_global", 10).await;
    let (paginas_projeto, sessoes_recentes) = match p.memoria.split_once('/') {
        Some((ws, proj)) => ler_paginas_escopo(&state, uid, ws, proj, 24).await,
        None => (Vec::new(), Vec::new()),
    };
    let tem_toml = !p.pasta.trim().is_empty()
        && expandir_home(p.pasta.trim())
            .join(".estacao-ai.toml")
            .is_file();
    Json(ContextoProjetoResposta {
        escopo: p.memoria,
        tem_toml,
        paginas_globais,
        paginas_projeto,
        sessoes_recentes,
    })
    .into_response()
}

fn formatar_paginas_memoria(paginas: &[PaginaMemoria], limite_com_corpo: usize) -> String {
    let mut out = String::new();
    for (idx, pg) in paginas.iter().enumerate() {
        let destaque = pg.pinned
            || pg.path.starts_with("_rules/")
            || pg.path.starts_with("decisions/")
            || pg.path.starts_with("gotchas/");
        if idx < limite_com_corpo && destaque && !pg.resumo.is_empty() {
            out += &format!(
                "- **{}** (`{}`):\n  {}\n",
                pg.title,
                pg.path,
                pg.resumo.replace('\n', "\n  ")
            );
        } else {
            out += &format!("- {} (`{}`)\n", pg.title, pg.path);
        }
    }
    out
}

pub(super) fn montar_prompt(
    e: &Estado,
    p: &Projeto,
    agente: &Agente,
    canal: &str,
    memoria: &MemoriaPrompt,
    tarefa: Option<&Tarefa>,
    pedido: Option<&str>,
) -> String {
    let nomes: HashMap<&str, &str> = e
        .agentes
        .iter()
        .map(|a| (a.id.as_str(), a.nome.as_str()))
        .collect();
    let nome = |id: &str| match id {
        "voce" => "Operador".to_owned(),
        outro => nomes
            .get(outro)
            .map_or_else(|| outro.to_owned(), |n| (*n).to_owned()),
    };
    let meu_papel = papel(&agente.funcao);
    let equipe: Vec<String> = p
        .agentes
        .iter()
        .map(|id| match e.agente(id).and_then(|a| papel(&a.funcao)) {
            Some(pp) => format!("{} ({})", nome(id), pp.nome),
            None => nome(id),
        })
        .collect();
    let conversa: Vec<&Mensagem> = e
        .mensagens
        .iter()
        .filter(|m| m.projeto == p.id && m.canal == canal && m.estado != "pensando")
        .collect();
    let inicio = conversa.len().saturating_sub(20);
    let minha_avaliacao = e
        .avaliacoes
        .iter()
        .rev()
        .find(|av| av.projeto == p.id && av.agente_id == agente.id);
    let fecho = |s: &mut String| {
        if let Some(av) = minha_avaliacao {
            *s += &format!(
                "\n## Sua Pontuação Interna do Mediador (use para melhorar agora)\nMédia recente: {:.1}/10 (Clareza {}/10 · Fundamentação {}/10 · Colaboração {}/10)\n",
                av.media, av.nota_clareza, av.nota_fundamentacao, av.nota_colaboracao
            );
            if !av.pontos_fortes.is_empty() {
                *s += &format!("- Pontos fortes: {}\n", av.pontos_fortes);
            }
            if !av.melhorar.is_empty() {
                *s += &format!("- O que melhorar nesta resposta: {}\n", av.melhorar);
            }
        }
        if let Some(pd) = pedido {
            *s += &format!("\n## Pedido agora\n{pd}\n");
        }
        *s += "\nResponda à mensagem mais recente dirigida a você (do Operador ou de outro participante), em português, de forma direta.\n";
    };
    // Sessões da aba Chat ou papéis de conversa: prompt conversacional sem quadro de tarefas.
    if eh_conversa(p) || meu_papel.is_some_and(|pp| pp.grupo == "chat") {
        let mut s = format!(
            "Você é {} (modelo {}), participante da conversa \"{}\" na Estação-ai.\nParticipantes: {}.\n",
            agente.nome,
            if agente.modelo.is_empty() {
                "padrão"
            } else {
                &agente.modelo
            },
            p.nome,
            equipe.join(", "),
        );
        if !p.descricao.trim().is_empty() {
            s += &format!("Assunto da conversa: {}\n", p.descricao.trim());
        }
        if let Some(pp) = meu_papel {
            if pp.grupo == "chat" {
                s += &format!("\n## Como você age ({})\n{}\n", pp.nome, pp.instrucoes);
            } else {
                s += &format!(
                    "\n## Perfil\nSeu papel habitual é {}; nesta sessão de Chat você está apenas conversando sobre o assunto acima (não altere arquivos nem execute tarefas de repositório, apenas responda e converse).\n",
                    pp.nome
                );
            }
        }
        if !agente.papel.trim().is_empty() {
            s += &format!("Especialidade: {}\n", agente.papel.trim());
        }
        if !e.contexto_global.trim().is_empty() {
            s += &format!("\n## Contexto global\n{}\n", e.contexto_global.trim());
        }
        if !p.contexto.trim().is_empty() {
            s += &format!("\n## Instruções desta conversa\n{}\n", p.contexto.trim());
        }
        s += "\n## Ambiente 3D (Chalé da Estação)\nVocê e os demais participantes estão presentes fisicamente no Chalé 3D com área interna (Lareira/Roda Central, Balcão de Café, Cantinho da TV, Mesa de Trabalho, Biblioteca) e área externa (Varanda/Deck, Fogueira Externa, Gazebo/Jardim). Quando o Operador pedir para ir a algum desses locais ou se aproximar, confirme naturalmente que está indo e interagindo com o espaço.\n";
        s += "\n## Conversa (mais recentes por último)\n";
        for m in &conversa[inicio..] {
            s += &format!(
                "{}: {}\n",
                nome(&m.autor),
                resumir_corpo(&m.texto, MAX_HISTORICO)
            );
        }
        fecho(&mut s);
        return s;
    }
    let mut s = format!(
        "Você é {} (modelo {}{}), um dos modelos de IA da Estação-ai no projeto \"{}\".\n",
        agente.nome,
        if agente.modelo.is_empty() {
            "padrão"
        } else {
            &agente.modelo
        },
        if agente.papel.trim().is_empty() {
            String::new()
        } else {
            format!(", especialidade: {}", agente.papel.trim())
        },
        p.nome
    );
    if let Some(pp) = meu_papel {
        s += &format!("\n## Seu papel: {}\n{}\n\n", pp.nome, pp.instrucoes);
    }
    if !p.descricao.is_empty() {
        s += &format!("Descrição do projeto: {}\n", p.descricao);
    }
    s += &format!("Equipe do projeto: {}.\n", equipe.join(", "));
    if !e.contexto_global.trim().is_empty() {
        s += &format!("\n## Contexto global\n{}\n", e.contexto_global.trim());
    }
    if !memoria.globais.is_empty() {
        s += "\n## Regras e preferências globais\n";
        s += &formatar_paginas_memoria(&memoria.globais, 4);
    }
    if !p.contexto.trim().is_empty() {
        s += &format!("\n## Contexto do projeto\n{}\n", p.contexto.trim());
    }
    if let Some((ws, proj)) = p.memoria.split_once('/') {
        s += &format!(
            "\n## Memória do projeto\nUse as ferramentas memory_* da Estação-ai com workspace=\"{ws}\" e project=\"{proj}\" para consultar decisões, regras e histórico, e registre aprendizados duráveis quando útil.\n"
        );
        if !memoria.projeto.is_empty() {
            s += "Contexto recuperado da memória:\n";
            s += &formatar_paginas_memoria(&memoria.projeto, 6);
        }
    }
    let tarefas: Vec<String> = e
        .tarefas
        .iter()
        .filter(|t| t.projeto == p.id)
        .map(|t| {
            format!(
                "- [{}] {} → {}",
                t.status,
                t.titulo,
                t.agente
                    .as_deref()
                    .map_or_else(|| "sem modelo".to_owned(), nome)
            )
        })
        .collect();
    if !tarefas.is_empty() {
        s += &format!("\n## Quadro de tarefas\n{}\n", tarefas.join("\n"));
    }
    if let Some(t) = tarefa {
        s += &format!(
            "\n## Sua tarefa agora\n{}\n{}\nExecute a tarefa e termine com um resumo curto do que foi feito.\n",
            t.titulo, t.descricao
        );
        return s;
    }
    s += if canal == "geral" {
        "\n## Chat geral do projeto (mais recentes por último)\n"
    } else {
        "\n## Chat individual com o operador (mais recentes por último)\n"
    };
    for m in &conversa[inicio..] {
        s += &format!(
            "{}: {}\n",
            nome(&m.autor),
            resumir_corpo(&m.texto, MAX_HISTORICO)
        );
    }
    fecho(&mut s);
    s
}

#[derive(Clone, Serialize)]
pub(crate) struct LivroEstante {
    pub id: String,
    /// `tarefa`, `memoria` ou `debate`
    pub categoria: String,
    pub titulo: String,
    pub subtitulo: String,
    pub autor: String,
    pub projeto: String,
    pub cor: String,
    pub data: i64,
    pub conteudo: String,
    pub link: String,
}

#[derive(Serialize)]
struct EstanteResposta {
    livros: Vec<LivroEstante>,
}

/// `GET /estacao/api/estante`: livros da Estante de Conhecimento do Chalé 3D
/// (tarefas concluídas, páginas na memória e sínteses de debates).
pub(crate) async fn api_estante(
    State(state): State<Arc<WebState>>,
    viewer: Option<axum::Extension<ai_memory_core::AuthorizedViewer>>,
) -> Response {
    let viewer_id = viewer.map(|axum::Extension(v)| v.user());
    let est = estacao(&state);
    let mut livros: Vec<LivroEstante> = Vec::new();

    {
        let e = est.estado.lock().await;
        let nome_ag = |id: &str| -> String {
            e.agente(id)
                .map(|a| a.nome.clone())
                .unwrap_or_else(|| "Equipe".into())
        };
        let nome_proj = |id: &str| -> String {
            e.projeto(id)
                .map(|p| p.nome.clone())
                .unwrap_or_else(|| "Projeto".into())
        };
        let cores_tarefa = ["#3d6b59", "#4f5d75", "#7c583c", "#5b4b7a", "#3a6678"];
        let mut concluidas: Vec<&Tarefa> = e
            .tarefas
            .iter()
            .filter(|t| t.status == "concluida")
            .collect();
        concluidas.sort_by_key(|t| std::cmp::Reverse(t.atualizado));
        for (i, t) in concluidas.into_iter().take(40).enumerate() {
            let mut corpo = String::new();
            if !t.descricao.trim().is_empty() {
                corpo.push_str(&format!("Objetivo:\n{}\n\n", t.descricao.trim()));
            }
            if !t.resultado.trim().is_empty() {
                corpo.push_str(&format!("Entrega concluída:\n{}\n", t.resultado.trim()));
            } else if !t.progresso.trim().is_empty() {
                corpo.push_str(&format!("Resumo:\n{}\n", t.progresso.trim()));
            } else {
                corpo.push_str("Tarefa concluída com sucesso pela equipe do projeto.");
            }
            let autor = t
                .agente
                .as_deref()
                .map(&nome_ag)
                .unwrap_or_else(|| "Equipe".into());
            let proj_nome = nome_proj(&t.projeto);
            livros.push(LivroEstante {
                id: format!("tf:{}", t.id),
                categoria: "tarefa".into(),
                titulo: t.titulo.clone(),
                subtitulo: format!("Concluída em {proj_nome}"),
                autor,
                projeto: proj_nome,
                cor: cores_tarefa[i % cores_tarefa.len()].into(),
                data: t.atualizado,
                conteudo: corpo.trim().to_owned(),
                link: format!("projetos/{}", crate::templates::encode_segment(&t.projeto)),
            });
        }

        // Livros de debates e avaliações do Mediador
        let mut por_sala: HashMap<String, Vec<&super::estado::AvaliacaoAgente>> = HashMap::new();
        for av in &e.avaliacoes {
            por_sala.entry(av.projeto.clone()).or_default().push(av);
        }
        let cores_debate = ["#7c4a3a", "#6e4c6b", "#8a5a36", "#5c4d3c"];
        let mut salas_debate: Vec<(String, Vec<&super::estado::AvaliacaoAgente>)> =
            por_sala.into_iter().collect();
        salas_debate.sort_by(|a, b| {
            let max_a = a.1.iter().map(|x| x.em).max().unwrap_or(0);
            let max_b = b.1.iter().map(|x| x.em).max().unwrap_or(0);
            max_b.cmp(&max_a)
        });
        for (i, (pid, mut avs)) in salas_debate.into_iter().take(20).enumerate() {
            avs.sort_by_key(|av| std::cmp::Reverse(av.em));
            let proj_nome = nome_proj(&pid);
            let data = avs.first().map(|a| a.em).unwrap_or(0);
            let mut corpo =
                format!("Síntese de avaliações registradas na sala \"{proj_nome}\":\n\n");
            for av in avs.iter().take(12) {
                corpo.push_str(&format!(
                    "• {} — Média {:.1}/10 (Clareza {}, Fundamentação {}, Colaboração {})\n",
                    av.agente_nome,
                    av.media,
                    av.nota_clareza,
                    av.nota_fundamentacao,
                    av.nota_colaboracao
                ));
                if !av.pontos_fortes.is_empty() {
                    corpo.push_str(&format!("  Pontos fortes: {}\n", av.pontos_fortes));
                }
                if !av.melhorar.is_empty() {
                    corpo.push_str(&format!("  Próximo ajuste: {}\n", av.melhorar));
                }
                corpo.push('\n');
            }
            livros.push(LivroEstante {
                id: format!("deb:{pid}"),
                categoria: "debate".into(),
                titulo: format!("Caderno de Debate: {proj_nome}"),
                subtitulo: format!("{} avaliação(ões) do Mediador", avs.len()),
                autor: "Mediador".into(),
                projeto: proj_nome,
                cor: cores_debate[i % cores_debate.len()].into(),
                data,
                conteudo: corpo.trim().to_owned(),
                link: "chat".into(),
            });
        }
    }

    // Livros da Memória / Wiki (páginas gravadas no SQLite)
    if viewer_id.is_none() {
        let paginas_wiki: Vec<(String, String, String, String, String, i64)> = state
            .reader
            .with_conn(|conn| {
                let mut stmt = conn.prepare(
                    "SELECT w.name, pr.name, p.path, COALESCE(p.title, p.path), COALESCE(p.body, ''), p.updated_at \
                     FROM pages p \
                     JOIN workspaces w ON w.id = p.workspace_id \
                     JOIN projects pr ON pr.id = p.project_id \
                     WHERE p.is_latest = 1 \
                     ORDER BY p.pinned DESC, p.updated_at DESC \
                     LIMIT 30",
                )?;
                let rows = stmt.query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, i64>(5)?,
                    ))
                })?;
                Ok(rows.filter_map(Result::ok).collect())
            })
            .await
            .unwrap_or_default();
        let cores_mem = ["#335c7d", "#2d6a6a", "#4a5d8a", "#5c6b3d", "#6d5044"];
        for (i, (ws, proj, path, title, body, updated_at)) in paginas_wiki.into_iter().enumerate() {
            livros.push(LivroEstante {
                id: format!("mem:{ws}/{proj}/{path}"),
                categoria: "memoria".into(),
                titulo: title,
                subtitulo: format!("Memória · {ws}/{proj}"),
                autor: "Memória da Estação".into(),
                projeto: format!("{ws}/{proj}"),
                cor: cores_mem[i % cores_mem.len()].into(),
                data: updated_at / 1_000_000,
                conteudo: resumir_corpo(&body, 3200),
                link: crate::templates::page_href(&ws, &proj, &path),
            });
        }
    }

    livros.sort_by_key(|lv| std::cmp::Reverse(lv.data));
    (
        [("cache-control", "no-store")],
        Json(EstanteResposta { livros }),
    )
        .into_response()
}

// ------------------------------------------------ gestão (inspecionar, exportar, importar, excluir)

#[derive(Deserialize)]
pub(crate) struct InspecionarQuery {
    escopo: String,
}

#[derive(Serialize)]
struct PaginaInspecionada {
    path: String,
    title: String,
    tier: String,
    kind: String,
    pinned: bool,
    resumo: String,
    body: String,
    updated_at: i64,
}

#[derive(Serialize)]
struct SessaoInspecionada {
    id: String,
    agent_kind: String,
    started_at: i64,
    ended: bool,
    cwd: String,
}

#[derive(Serialize)]
struct ProjetoVinculadoResumo {
    id: String,
    nome: String,
}

#[derive(Serialize)]
struct InspecionarMemoriaResposta {
    escopo: String,
    pasta: String,
    tem_toml: bool,
    oculta: bool,
    projetos_vinculados: Vec<ProjetoVinculadoResumo>,
    total_paginas: u64,
    total_sessoes: u64,
    abertas: u64,
    paginas: Vec<PaginaInspecionada>,
    sessoes: Vec<SessaoInspecionada>,
}

#[derive(Deserialize)]
pub(crate) struct ExportarMemoriasReq {
    #[serde(default)]
    escopos: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct PacoteMemoria {
    pub versao: u32,
    pub formato: String,
    #[serde(default)]
    pub exportado_em: i64,
    #[serde(default)]
    pub versao_app: String,
    pub projetos: Vec<MemoriaExportada>,
}

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct MemoriaExportada {
    pub escopo: String,
    #[serde(default)]
    pub pasta: String,
    #[serde(default)]
    pub sessoes_registradas: u64,
    pub paginas: Vec<PaginaExportada>,
}

fn tier_semantic() -> String {
    "semantic".into()
}

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct PaginaExportada {
    pub path: String,
    #[serde(default)]
    pub title: String,
    #[serde(default = "tier_semantic")]
    pub tier: String,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub frontmatter: serde_json::Value,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub updated_at: i64,
}

#[derive(Deserialize)]
pub(crate) struct ImportarMemoriasReq {
    pacote: PacoteMemoria,
    #[serde(default)]
    selecionar: Vec<String>,
    #[serde(default)]
    modo: Option<String>,
}

#[derive(Serialize)]
struct DetalheImportacao {
    escopo: String,
    paginas: usize,
    substituida: bool,
}

#[derive(Serialize)]
struct ImportarMemoriasResposta {
    projetos_importados: usize,
    paginas_importadas: usize,
    detalhes: Vec<DetalheImportacao>,
}

struct PaginaArmazenada {
    path: String,
    title: String,
    tier: String,
    kind: String,
    pinned: bool,
    frontmatter: serde_json::Value,
    body: String,
    updated_at: i64,
}

struct EscopoDetalhe {
    paginas: Vec<PaginaArmazenada>,
    sessoes: Vec<SessaoInspecionada>,
    total_paginas: u64,
    total_sessoes: u64,
    abertas: u64,
    pasta: String,
}

fn kind_da_pagina(path: &str, frontmatter: &serde_json::Value) -> String {
    if let Some(k) = frontmatter.get("kind").and_then(|v| v.as_str()) {
        let limpo = k.trim();
        if !limpo.is_empty() {
            return limpo.to_owned();
        }
    }
    if path.starts_with("_rules/") {
        "rule".into()
    } else if path.starts_with("decisions/") {
        "decision".into()
    } else if path.starts_with("gotchas/") {
        "gotcha".into()
    } else if path.starts_with("concepts/") {
        "concept".into()
    } else if path.starts_with("procedures/") {
        "procedure".into()
    } else if path.starts_with("sessions/") {
        "session".into()
    } else if path.starts_with("_lint/") {
        "lint".into()
    } else {
        "note".into()
    }
}

fn classificar_erro_escopo(err: ScopeResolutionError, escopo: &str) -> (StatusCode, String) {
    match err {
        ScopeResolutionError::WorkspaceNotFound { .. }
        | ScopeResolutionError::ProjectNotFoundInWorkspace { .. } => (
            StatusCode::NOT_FOUND,
            format!("Memória não encontrada: {escopo}"),
        ),
        ScopeResolutionError::Forbidden(_) => (
            StatusCode::FORBIDDEN,
            "Sem permissão para acessar esta memória.".into(),
        ),
        other => (
            StatusCode::BAD_REQUEST,
            format!("Falha ao resolver memória {escopo}: {other}"),
        ),
    }
}

async fn resolver_escopo_leitura(
    state: &WebState,
    uid: Option<UserId>,
    ws: &str,
    proj: &str,
    escopo: &str,
) -> Result<ai_memory_store::ResolvedScope, (StatusCode, String)> {
    crate::routes::resolve_read_scope(state, uid, ws, proj)
        .await
        .map_err(|e| classificar_erro_escopo(e, escopo))
}

async fn ler_escopo_detalhado(
    state: &WebState,
    scope: ai_memory_store::ResolvedScope,
    limite_paginas: usize,
    limite_sessoes: usize,
) -> Result<EscopoDetalhe, String> {
    let (w, p) = (scope.workspace_id, scope.project_id);
    state
        .reader
        .with_conn(move |conn| {
            let total_paginas: u64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM pages WHERE workspace_id=?1 AND project_id=?2 AND is_latest=1",
                    rusqlite::params![w.as_bytes(), p.as_bytes()],
                    |r| Ok(r.get::<_, i64>(0)?.max(0) as u64),
                )
                .unwrap_or(0);
            let total_sessoes: u64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sessions WHERE workspace_id=?1 AND project_id=?2",
                    rusqlite::params![w.as_bytes(), p.as_bytes()],
                    |r| Ok(r.get::<_, i64>(0)?.max(0) as u64),
                )
                .unwrap_or(0);
            let abertas: u64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sessions WHERE workspace_id=?1 AND project_id=?2 AND ended_at IS NULL",
                    rusqlite::params![w.as_bytes(), p.as_bytes()],
                    |r| Ok(r.get::<_, i64>(0)?.max(0) as u64),
                )
                .unwrap_or(0);
            let pasta: String = conn
                .query_row(
                    "SELECT cwd FROM sessions WHERE workspace_id=?1 AND project_id=?2 AND cwd IS NOT NULL ORDER BY started_at DESC LIMIT 1",
                    rusqlite::params![w.as_bytes(), p.as_bytes()],
                    |r| r.get::<_, String>(0),
                )
                .unwrap_or_default();

            let mut stmt_p = conn.prepare(
                "SELECT path, COALESCE(title, path), tier, pinned, COALESCE(frontmatter_json, '{}'), COALESCE(body, ''), updated_at \
                 FROM pages \
                 WHERE workspace_id=?1 AND project_id=?2 AND is_latest=1 \
                 ORDER BY pinned DESC, updated_at DESC, path ASC \
                 LIMIT ?3",
            )?;
            let paginas = stmt_p
                .query_map(
                    rusqlite::params![w.as_bytes(), p.as_bytes(), limite_paginas as i64],
                    |r| {
                        let path: String = r.get(0)?;
                        let fm_raw: String = r.get(4)?;
                        let frontmatter = serde_json::from_str::<serde_json::Value>(&fm_raw)
                            .unwrap_or(serde_json::Value::Null);
                        let kind = kind_da_pagina(&path, &frontmatter);
                        Ok(PaginaArmazenada {
                            path,
                            title: r.get(1)?,
                            tier: r.get(2)?,
                            kind,
                            pinned: r.get::<_, i64>(3)? != 0,
                            frontmatter,
                            body: r.get(5)?,
                            updated_at: r.get(6)?,
                        })
                    },
                )?
                .collect::<rusqlite::Result<Vec<_>>>()?;

            let mut stmt_s = conn.prepare(
                "SELECT LOWER(HEX(id)), agent_kind, started_at, ended_at IS NOT NULL, COALESCE(cwd, '') \
                 FROM sessions \
                 WHERE workspace_id=?1 AND project_id=?2 \
                 ORDER BY started_at DESC LIMIT ?3",
            )?;
            let sessoes = stmt_s
                .query_map(
                    rusqlite::params![w.as_bytes(), p.as_bytes(), limite_sessoes as i64],
                    |r| {
                        Ok(SessaoInspecionada {
                            id: r.get(0)?,
                            agent_kind: r.get(1)?,
                            started_at: r.get(2)?,
                            ended: r.get::<_, i64>(3)? != 0,
                            cwd: r.get(4)?,
                        })
                    },
                )?
                .collect::<rusqlite::Result<Vec<_>>>()?;

            Ok(EscopoDetalhe {
                paginas,
                sessoes,
                total_paginas,
                total_sessoes,
                abertas,
                pasta,
            })
        })
        .await
        .map_err(|e| format!("Falha ao consultar memória: {e}"))
}

/// Inspeciona detalhadamente páginas e sessões de uma memória de projeto.
pub(crate) async fn api_inspecionar_memoria(
    State(state): State<Arc<WebState>>,
    viewer: Option<axum::Extension<ai_memory_core::AuthorizedViewer>>,
    Query(query): Query<InspecionarQuery>,
) -> Response {
    let escopo = query.escopo.trim().to_owned();
    let (ws, proj) = match parse_escopo(&escopo) {
        Ok(par) => par,
        Err(msg) => return (StatusCode::BAD_REQUEST, msg).into_response(),
    };
    let uid = viewer.map(|v| v.0.user());
    let resolved = match resolver_escopo_leitura(&state, uid, ws, proj, &escopo).await {
        Ok(s) => s,
        Err((status, msg)) => return (status, msg).into_response(),
    };
    let detalhe = match ler_escopo_detalhado(&state, resolved, 500, 20).await {
        Ok(d) => d,
        Err(msg) => return (StatusCode::INTERNAL_SERVER_ERROR, msg).into_response(),
    };
    let (projetos_vinculados, oculta, tem_toml_vinculado) = {
        let est_ref = estacao(&state);
        let e = est_ref.estado.lock().await;
        let vinculados: Vec<ProjetoVinculadoResumo> = e
            .projetos
            .iter()
            .filter(|p| p.memoria == escopo)
            .map(|p| ProjetoVinculadoResumo {
                id: p.id.clone(),
                nome: p.nome.clone(),
            })
            .collect();
        let tem_toml = e
            .projetos
            .iter()
            .filter(|p| p.memoria == escopo && !p.pasta.trim().is_empty())
            .any(|p| {
                expandir_home(p.pasta.trim())
                    .join(".estacao-ai.toml")
                    .is_file()
            });
        (vinculados, e.memorias_ocultas.contains(&escopo), tem_toml)
    };
    let tem_toml = tem_toml_vinculado
        || (!detalhe.pasta.trim().is_empty()
            && expandir_home(detalhe.pasta.trim())
                .join(".estacao-ai.toml")
                .is_file());
    let paginas = detalhe
        .paginas
        .into_iter()
        .map(|pg| PaginaInspecionada {
            resumo: resumir_corpo(&pg.body, 220),
            path: pg.path,
            title: pg.title,
            tier: pg.tier,
            kind: pg.kind,
            pinned: pg.pinned,
            body: pg.body,
            updated_at: pg.updated_at,
        })
        .collect();
    (
        [("cache-control", "no-store")],
        Json(InspecionarMemoriaResposta {
            escopo,
            pasta: detalhe.pasta,
            tem_toml,
            oculta,
            projetos_vinculados,
            total_paginas: detalhe.total_paginas,
            total_sessoes: detalhe.total_sessoes,
            abertas: detalhe.abertas,
            paginas,
            sessoes: detalhe.sessoes,
        }),
    )
        .into_response()
}

/// Exporta uma ou várias memórias selecionadas em formato portátil `estacao-ai-memoria-v1`.
pub(crate) async fn api_exportar_memorias(
    axum::Extension(i18n): axum::Extension<ai_memory_core::i18n::Localizer>,
    State(state): State<Arc<WebState>>,
    level: Option<axum::Extension<ai_memory_core::AuthLevel>>,
    viewer: Option<axum::Extension<ai_memory_core::AuthorizedViewer>>,
    headers: HeaderMap,
    Json(req): Json<ExportarMemoriasReq>,
) -> Response {
    if let Err(recusa) = autorizar(&i18n, &state, level, &headers).await {
        return recusa;
    }
    let mut vistoria = HashSet::new();
    let mut alvos = Vec::new();
    for raw in req.escopos {
        let limpo = raw.trim().to_owned();
        if !limpo.is_empty() && vistoria.insert(limpo.clone()) {
            alvos.push(limpo);
        }
    }
    if alvos.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            "Selecione ao menos uma memória para exportar.",
        )
            .into_response();
    }
    let uid = viewer.map(|v| v.0.user());
    let mut projetos = Vec::with_capacity(alvos.len());
    for escopo in alvos {
        let (ws, proj) = match parse_escopo(&escopo) {
            Ok(par) => par,
            Err(msg) => return (StatusCode::BAD_REQUEST, msg).into_response(),
        };
        let resolved = match resolver_escopo_leitura(&state, uid, ws, proj, &escopo).await {
            Ok(s) => s,
            Err((status, msg)) => return (status, msg).into_response(),
        };
        let detalhe = match ler_escopo_detalhado(&state, resolved, 10_000, 1).await {
            Ok(d) => d,
            Err(msg) => return (StatusCode::INTERNAL_SERVER_ERROR, msg).into_response(),
        };
        let paginas = detalhe
            .paginas
            .into_iter()
            .map(|pg| PaginaExportada {
                path: pg.path,
                title: pg.title,
                tier: pg.tier,
                pinned: pg.pinned,
                frontmatter: pg.frontmatter,
                body: pg.body,
                updated_at: pg.updated_at,
            })
            .collect();
        projetos.push(MemoriaExportada {
            escopo,
            pasta: detalhe.pasta,
            sessoes_registradas: detalhe.total_sessoes,
            paginas,
        });
    }
    Json(PacoteMemoria {
        versao: 1,
        formato: FORMATO_PACOTE_MEMORIA.into(),
        exportado_em: agora(),
        versao_app: env!("CARGO_PKG_VERSION").into(),
        projetos,
    })
    .into_response()
}

// Operações explícitas de gestão de memória da Estação-ai, protegidas por
// sessão Nostr (`exigir_sessao`), CSRF/Origin (`X-Estacao-UI`) e `require_admin`.
#[allow(clippy::disallowed_methods)]
async fn purgar_escopo(
    state: &WebState,
    resolved: ai_memory_store::ResolvedScope,
    escopo: &str,
    uid: Option<UserId>,
    actor: &ActorContext,
) -> Result<ai_memory_store::PurgeSummary, String> {
    let (ws, proj) = parse_escopo(escopo)?;
    let purge_ctx = AdmissionContext {
        workspace: ws.to_owned(),
        project: proj.to_owned(),
        op: AdmissionOp::PurgeProject,
        actor: actor.clone(),
        ..Default::default()
    };
    state
        .wiki
        .admit_purge_project(resolved.workspace_id, resolved.project_id, Some(purge_ctx))
        .await
        .map_err(|e| format!("Exclusão bloqueada pela política da wiki: {e}"))?;
    let summary = state
        .wiki
        .writer()
        .purge_project(
            resolved.workspace_id,
            resolved.project_id,
            escopo,
            uid,
            false,
            Compaction::Skip,
            PurgeMode::Commit,
        )
        .await
        .map_err(|e| match e {
            StoreError::ManagedRunActive { .. } => {
                "Há uma execução ativa vinculada a esta memória; aguarde terminar antes de excluir."
                    .to_owned()
            }
            other => format!("Não consegui excluir a memória {escopo}: {other}"),
        })?;
    if let Err(e) = state
        .wiki
        .remove_project_dir(resolved.workspace_id, resolved.project_id)
        .await
    {
        tracing::warn!(erro = %e, escopo, "falha parcial ao limpar diretório wiki após exclusão no banco");
    }
    Ok(summary)
}

/// Exclui permanentemente a memória de um projeto e desvincula projetos locais que apontavam para ela.
pub(super) async fn excluir_memoria(
    state: &WebState,
    est: Arc<Estacao>,
    escopo: &str,
    uid: Option<UserId>,
    actor: ActorContext,
) -> Result<Option<String>, String> {
    let limpo = escopo.trim();
    if limpo == ESCOPO_GLOBAL {
        return Err("A memória global (default/_global) não pode ser excluída.".into());
    }
    let (ws, proj) = parse_escopo(limpo)?;
    let resolved = resolver_escopo_leitura(state, uid, ws, proj, limpo)
        .await
        .map_err(|(_, msg)| msg)?;
    let summary = purgar_escopo(state, resolved, limpo, uid, &actor).await?;
    est.mudar(|e| {
        e.memorias_ocultas.retain(|x| x != limpo);
        for p in &mut e.projetos {
            if p.memoria == limpo {
                p.memoria.clear();
            }
        }
        Ok(())
    })
    .await?;
    Ok(Some(format!(
        "Memória {limpo} excluída ({} página(s), {} sessão(ões)).",
        summary.pages_deleted, summary.sessions_deleted
    )))
}

struct PaginaValidada {
    path: PagePath,
    tier: Tier,
    pinned: bool,
    title: Option<String>,
    frontmatter: serde_json::Value,
    body: String,
}

struct ProjetoImportadoValidado {
    escopo: String,
    ws: String,
    proj: String,
    pasta: Option<String>,
    paginas: Vec<PaginaValidada>,
}

fn validar_lote_importacao(
    req: ImportarMemoriasReq,
) -> Result<(Vec<ProjetoImportadoValidado>, bool), String> {
    if req.pacote.formato != FORMATO_PACOTE_MEMORIA || req.pacote.versao != 1 {
        return Err(
            "Arquivo de backup inválido ou versão incompatível (esperado estacao-ai-memoria-v1)."
                .into(),
        );
    }
    let substituir = match req.modo.as_deref() {
        None | Some("") | Some("mesclar") => false,
        Some("substituir") => true,
        Some(_) => {
            return Err("Modo de importação inválido (use 'mesclar' ou 'substituir').".into());
        }
    };
    let filtro: Option<HashSet<String>> = (!req.selecionar.is_empty()).then(|| {
        req.selecionar
            .into_iter()
            .map(|s| s.trim().to_owned())
            .filter(|s| !s.is_empty())
            .collect()
    });
    let mut vistos = HashSet::new();
    let mut validados = Vec::new();
    for item in req.pacote.projetos {
        let escopo = item.escopo.trim().to_owned();
        if let Some(ref f) = filtro
            && !f.contains(&escopo)
        {
            continue;
        }
        if !vistos.insert(escopo.clone()) {
            continue;
        }
        let (ws, proj) = {
            let (w, p) = parse_escopo(&escopo)?;
            (w.to_owned(), p.to_owned())
        };
        if substituir && escopo == ESCOPO_GLOBAL {
            return Err(
                "O modo Substituir não é permitido em default/_global; use Mesclar.".into(),
            );
        }
        let mut paginas = Vec::with_capacity(item.paginas.len());
        for pg in item.paginas {
            let path = PagePath::new(pg.path.trim())
                .map_err(|e| format!("Caminho inválido em {escopo} ({}): {e}", pg.path))?;
            path.ensure_portable()
                .map_err(|e| format!("Caminho não portátil em {escopo} ({}): {e}", pg.path))?;
            let tier_raw = pg.tier.trim();
            let tier = if tier_raw.is_empty() {
                Tier::Semantic
            } else {
                tier_raw
                    .parse::<Tier>()
                    .map_err(|e| format!("Tier inválido em {escopo} ({}): {e}", pg.path))?
            };
            let mut fm = match pg.frontmatter {
                serde_json::Value::Object(mut map) => {
                    map.remove("last_modified_by");
                    serde_json::Value::Object(map)
                }
                _ => serde_json::Value::Null,
            };
            if let serde_json::Value::Object(ref mut map) = fm {
                map.remove("path");
            }
            let title = (!pg.title.trim().is_empty()).then(|| pg.title.trim().to_owned());
            paginas.push(PaginaValidada {
                path,
                tier,
                pinned: pg.pinned,
                title,
                frontmatter: fm,
                body: pg.body,
            });
        }
        let pasta = (!item.pasta.trim().is_empty()).then(|| item.pasta.trim().to_owned());
        validados.push(ProjetoImportadoValidado {
            escopo,
            ws,
            proj,
            pasta,
            paginas,
        });
    }
    if validados.is_empty() {
        return Err("Nenhuma memória selecionada para importar.".into());
    }
    Ok((validados, substituir))
}

/// Importa memórias (seleção total ou parcial de projetos) para SQLite e arquivos Markdown da wiki.
#[allow(clippy::disallowed_methods)]
pub(crate) async fn api_importar_memorias(
    axum::Extension(i18n): axum::Extension<ai_memory_core::i18n::Localizer>,
    State(state): State<Arc<WebState>>,
    level: Option<axum::Extension<ai_memory_core::AuthLevel>>,
    viewer: Option<axum::Extension<ai_memory_core::AuthorizedViewer>>,
    actor_ext: Option<axum::Extension<ActorContext>>,
    headers: HeaderMap,
    Json(req): Json<ImportarMemoriasReq>,
) -> Response {
    if let Err(recusa) = autorizar(&i18n, &state, level, &headers).await {
        return recusa;
    }
    let (itens, substituir) = match validar_lote_importacao(req) {
        Ok(par) => par,
        Err(msg) => return (StatusCode::BAD_REQUEST, msg).into_response(),
    };
    let uid = viewer.map(|v| v.0.user());
    let actor = actor_ext
        .map(|axum::Extension(a)| a)
        .unwrap_or_else(ActorContext::anonymous);

    let mut detalhes = Vec::with_capacity(itens.len());
    let mut total_paginas = 0usize;
    let mut importados = Vec::with_capacity(itens.len());

    for item in itens {
        let mut substituida = false;
        if substituir
            && let Ok(existing) =
                crate::routes::resolve_read_scope(&state, uid, &item.ws, &item.proj).await
        {
            if let Err(msg) = purgar_escopo(&state, existing, &item.escopo, uid, &actor).await {
                return (StatusCode::CONFLICT, msg).into_response();
            }
            substituida = true;
        }
        let ws_id = match state.wiki.writer().get_or_create_workspace(&item.ws).await {
            Ok(id) => id,
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Falha ao preparar workspace {}: {e}", item.ws),
                )
                    .into_response();
            }
        };
        let (proj_id, _) = match state
            .wiki
            .writer()
            .get_or_create_project_as(ws_id, &item.proj, item.pasta, uid)
            .await
        {
            Ok(res) => res,
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Falha ao preparar projeto {}: {e}", item.escopo),
                )
                    .into_response();
            }
        };
        let mut gravadas = 0usize;
        for pg in item.paginas {
            if let Err(e) = state
                .wiki
                .write_page(WritePageRequest {
                    workspace_id: ws_id,
                    project_id: proj_id,
                    path: pg.path,
                    frontmatter: pg.frontmatter,
                    body: pg.body,
                    tier: pg.tier,
                    pinned: pg.pinned,
                    title: pg.title,
                    admission_ctx: None,
                    author_id: uid,
                    evidence: Vec::new(),
                    actor: actor.clone(),
                })
                .await
            {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Erro ao importar página de {}: {e}", item.escopo),
                )
                    .into_response();
            }
            gravadas += 1;
        }
        total_paginas += gravadas;
        importados.push(item.escopo.clone());
        detalhes.push(DetalheImportacao {
            escopo: item.escopo,
            paginas: gravadas,
            substituida,
        });
    }

    let _ = estacao(&state)
        .mudar(|e| {
            e.memorias_ocultas.retain(|x| !importados.contains(x));
            Ok(())
        })
        .await;

    Json(ImportarMemoriasResposta {
        projetos_importados: detalhes.len(),
        paginas_importadas: total_paginas,
        detalhes,
    })
    .into_response()
}
