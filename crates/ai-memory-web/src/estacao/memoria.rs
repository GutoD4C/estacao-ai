use std::collections::HashMap;
use std::sync::Arc;

use axum::Json;
use axum::extract::Path as UrlPath;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::response::Response;
use serde::Serialize;

use super::estado::{
    Agente, Estacao, Estado, Mensagem, Projeto, Tarefa, eh_conversa, estacao, papel,
};
use super::processo::expandir_home;
use crate::state::WebState;

/// Caracteres por mensagem do histórico no prompt (CLIs com `"$(cat)"` têm limite de argumento).
pub(super) const MAX_HISTORICO: usize = 3_000;

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
    let Some((ws, proj)) = p.memoria.split_once('/') else {
        return Err("Selecione uma memória ligada (workspace/projeto) primeiro.".into());
    };
    if ws.is_empty()
        || proj.is_empty()
        || ws.contains(['\n', '\r', '"'])
        || proj.contains(['\n', '\r', '"'])
    {
        return Err("Escopo de memória inválido.".into());
    }
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
        concluidas.sort_by(|a, b| b.atualizado.cmp(&a.atualizado));
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
            avs.sort_by(|a, b| b.em.cmp(&a.em));
            let proj_nome = nome_proj(&pid);
            let data = avs.first().map(|a| a.em).unwrap_or(0);
            let mut corpo = format!("Síntese de avaliações registradas na sala \"{proj_nome}\":\n\n");
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

    livros.sort_by(|a, b| b.data.cmp(&a.data));
    ([("cache-control", "no-store")], Json(EstanteResposta { livros })).into_response()
}
