use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use askama::Template;
use axum::Json;
use axum::extract::Path as UrlPath;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::response::{Html, Response};
use serde::{Deserialize, Serialize};

use super::catalogo::auto_configurar;
use super::consumo::configurar_statusline_claude;
use super::estado::{
    Agente, AvaliacaoAgente, Estacao, Mensagem, NostrContato, NostrPerfil, PAPEIS, Papel, Projeto,
    Tarefa, agente_pertence_a_projeto, agora, estacao, grupo_do_agente, limite_agentes_por_pessoa,
    papel,
};
use super::execucao::{
    avaliar_com_mediador, enviar, executar_tarefa, iniciar_debate, verificar_ideias,
};
use super::memoria::vincular_pasta;
use super::processo::{TEMPO_MAXIMO, cli_encontrada, executar_comando, paradas, parar_execucoes};
use crate::state::WebState;

#[derive(Template)]
#[template(path = "estacao.html")]
pub(crate) struct EstacaoView {
    pub i18n: ai_memory_core::i18n::Localizer,
    pub pagina: &'static str,
    pub titulo: &'static str,
    pub projeto: String,
}

fn pagina(
    i18n: ai_memory_core::i18n::Localizer,
    pagina: &'static str,
    titulo: &'static str,
    projeto: String,
) -> Response {
    match (EstacaoView {
        i18n,
        pagina,
        titulo,
        projeto,
    })
    .render()
    {
        Ok(html) => Html(html).into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

pub(crate) async fn pagina_chat(
    axum::Extension(i18n): axum::Extension<ai_memory_core::i18n::Localizer>,
) -> Response {
    pagina(i18n, "chat", "Chat", String::new())
}

pub(crate) async fn pagina_projetos(
    axum::Extension(i18n): axum::Extension<ai_memory_core::i18n::Localizer>,
) -> Response {
    pagina(i18n, "projetos", "Projetos", String::new())
}

pub(crate) async fn pagina_projeto(
    axum::Extension(i18n): axum::Extension<ai_memory_core::i18n::Localizer>,
    UrlPath(id): UrlPath<String>,
) -> Response {
    pagina(i18n, "projeto", "Projeto", id)
}

pub(crate) async fn pagina_agentes(
    axum::Extension(i18n): axum::Extension<ai_memory_core::i18n::Localizer>,
) -> Response {
    pagina(i18n, "agentes", "Modelos de IA", String::new())
}

pub(crate) async fn pagina_consumo(
    axum::Extension(i18n): axum::Extension<ai_memory_core::i18n::Localizer>,
) -> Response {
    pagina(i18n, "consumo", "Consumo e uso", String::new())
}

// ---------------------------------------------------------------- leitura

#[derive(Serialize)]
struct MensagemResposta<'a> {
    #[serde(flatten)]
    mensagem: &'a Mensagem,
    html: String,
}

#[derive(Serialize)]
struct EstadoResposta<'a> {
    agentes: &'a [Agente],
    projetos: &'a [Projeto],
    tarefas: &'a [Tarefa],
    mensagens: Vec<MensagemResposta<'a>>,
    avaliacoes: &'a [AvaliacaoAgente],
    contexto_global: &'a str,
    memorias_ocultas: &'a [String],
    ferramentas_desativadas: &'a [String],
    nostr_perfil: &'a NostrPerfil,
    nostr_contatos: &'a [NostrContato],
    presenca_salas: &'a HashMap<String, Vec<String>>,
    seq: u64,
    /// Todos os projetos que a memória conhece, ligados ou não à Estação.
    memorias: Vec<Memoria>,
    /// Modelos cuja CLI não foi encontrada no PATH do serviço.
    cli_ausente: Vec<String>,
    papeis: &'static [Papel],
}

#[derive(Serialize)]
struct Memoria {
    /// `workspace/projeto`.
    escopo: String,
    paginas: u64,
    sessoes: u64,
    abertas: u64,
    atividade: Option<String>,
    /// Pasta da sessão mais recente, para sugerir ao configurar o projeto.
    pasta: String,
}

pub(crate) async fn api_estado(
    State(state): State<Arc<WebState>>,
    viewer: Option<axum::Extension<ai_memory_core::AuthorizedViewer>>,
) -> Response {
    let estado = estacao(&state).estado.lock().await.clone();
    let projetos = state
        .reader
        .list_projects_with_stats(viewer.map(|v| v.0.user()))
        .await
        .unwrap_or_default();
    let pastas: HashMap<String, String> = state
        .reader
        .with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT w.name || '/' || p.name, \
                 (SELECT s.cwd FROM sessions s WHERE s.project_id = p.id AND s.cwd IS NOT NULL \
                  ORDER BY s.started_at DESC LIMIT 1) \
                 FROM projects p JOIN workspaces w ON w.id = p.workspace_id",
            )?;
            let linhas = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                ))
            })?;
            Ok(linhas.collect::<rusqlite::Result<HashMap<_, _>>>()?)
        })
        .await
        .unwrap_or_default();
    let memorias = projetos
        .into_iter()
        .map(|p| {
            let escopo = format!("{}/{}", p.workspace_name, p.project_name);
            Memoria {
                pasta: pastas.get(&escopo).cloned().unwrap_or_default(),
                escopo,
                paginas: p.page_count,
                sessoes: p.session_count,
                abertas: p.open_session_count,
                atividade: p.last_activity.or(p.last_updated),
            }
        })
        .collect();
    let cli_ausente = estado
        .agentes
        .iter()
        .filter(|a| !cli_encontrada(&a.comando))
        .map(|a| a.id.clone())
        .collect();
    let mensagens = estado
        .mensagens
        .iter()
        .map(|mensagem| MensagemResposta {
            html: crate::markdown::render_chat_markdown(&mensagem.texto),
            mensagem,
        })
        .collect();
    Json(EstadoResposta {
        agentes: &estado.agentes,
        projetos: &estado.projetos,
        tarefas: &estado.tarefas,
        mensagens,
        avaliacoes: &estado.avaliacoes,
        contexto_global: &estado.contexto_global,
        memorias_ocultas: &estado.memorias_ocultas,
        ferramentas_desativadas: &estado.ferramentas_desativadas,
        nostr_perfil: &estado.nostr_perfil,
        nostr_contatos: &estado.nostr_contatos,
        presenca_salas: &estado.presenca_salas,
        seq: estado.seq,
        memorias,
        cli_ausente,
        papeis: PAPEIS,
    })
    .into_response()
}

// ---------------------------------------------------------------- escrita

#[derive(Deserialize)]
#[serde(tag = "tipo", rename_all = "snake_case")]
pub(crate) enum Acao {
    SalvarAgente {
        agente: Agente,
    },
    ExcluirAgente {
        id: String,
    },
    SalvarProjeto {
        projeto: Projeto,
    },
    ExcluirProjeto {
        id: String,
    },
    SalvarTarefa {
        tarefa: Tarefa,
    },
    ExcluirTarefa {
        id: String,
    },
    ReabrirTarefa {
        id: String,
    },
    Atribuir {
        tarefa: String,
        agente: Option<String>,
    },
    Executar {
        tarefa: String,
    },
    Enviar {
        projeto: String,
        canal: String,
        texto: String,
    },
    ContextoGlobal {
        texto: String,
    },
    VincularPasta {
        projeto: String,
    },
    /// Para as execuções em andamento do projeto (de um modelo ou de todos).
    Parar {
        projeto: String,
        agente: Option<String>,
    },
    LimparChat {
        projeto: String,
        canal: String,
    },
    OcultarMemoria {
        escopo: String,
        ocultar: bool,
    },
    /// Participantes falam em sequência sobre `tema`, por `rodadas` voltas.
    Debate {
        projeto: String,
        tema: String,
        participantes: Vec<String>,
        rodadas: usize,
    },
    /// Detecta CLIs de IA instaladas e cria automaticamente agentes (opcionalmente só de um grupo: `"projetos"` ou `"chat"`).
    AutoConfigurar {
        #[serde(default)]
        grupo: Option<String>,
        #[serde(default)]
        quantidades: Option<HashMap<String, usize>>,
    },
    /// Exclui todos os agentes pertencentes a um grupo (`"projetos"` ou `"chat"`).
    ExcluirAgentesGrupo {
        grupo: String,
    },
    /// Executa um teste rápido de conexão com um agente cadastrado.
    TestarAgente {
        id: String,
    },
    /// Solicita que outra IA revise e verifique as respostas/ideias recentes do chat.
    VerificarIdeias {
        projeto: String,
        canal: String,
        #[serde(default)]
        mensagem_id: Option<String>,
    },
    /// Solicita ao Mediador a pontuação interna dos agentes após as respostas recentes.
    AvaliarMediador {
        projeto: String,
        canal: String,
        #[serde(default)]
        mensagem_id: Option<String>,
    },
    /// Ativa ou desativa uma ferramenta/fornecedor detectado na máquina.
    AlternarFerramenta {
        fornecedor: String,
        ativa: bool,
    },
    /// Salva ou atualiza o perfil/login Nostr do operador local (npub, apelido, raça de cachorro, relay).
    SalvarPerfilNostr {
        perfil: NostrPerfil,
    },
    /// Conecta/adiciona um contato Nostr via `npub`.
    SalvarContatoNostr {
        contato: NostrContato,
    },
    /// Remove um contato Nostr da lista de conexões.
    ExcluirContatoNostr {
        npub: String,
    },
    /// Compartilha (ou torna pessoal) um projeto ou chat com contatos `npub`.
    CompartilharProjeto {
        projeto: String,
        compartilhado: bool,
        membros_npub: Vec<String>,
    },
    /// Atualiza a lista de `npub`s presentes online em um projeto/chat (controla hibernação zzz).
    AtualizarPresenca {
        projeto: String,
        npubs_online: Vec<String>,
    },
    /// Recebe/sincroniza um projeto ou chat compartilhado por outro contato Nostr.
    SincronizarSalaCompartilhada {
        projeto: Projeto,
        #[serde(default)]
        agentes_remotos: Vec<Agente>,
    },
}

/// Mesmo critério das outras escritas do painel: cabeçalho da interface, mesma
/// origem e capacidade de administrador, porque cadastrar agente executa comando.
pub(super) async fn autorizar(
    i18n: &ai_memory_core::i18n::Localizer,
    state: &WebState,
    level: Option<axum::Extension<ai_memory_core::AuthLevel>>,
    headers: &HeaderMap,
) -> Result<(), Response> {
    verificar_origem(headers).map_err(IntoResponse::into_response)?;
    crate::routes::require_admin(i18n, state, level).await
}

pub(super) fn verificar_origem(headers: &HeaderMap) -> Result<(), (StatusCode, &'static str)> {
    if headers.get("x-estacao-ui").and_then(|h| h.to_str().ok()) != Some("1") {
        return Err((
            StatusCode::FORBIDDEN,
            "Recarregue a página e tente de novo.",
        ));
    }
    if let Some(origin) = headers.get("origin").and_then(|h| h.to_str().ok()) {
        let autoridade = origin
            .parse::<axum::http::Uri>()
            .ok()
            .and_then(|u| u.authority().map(|a| a.as_str().to_owned()));
        if autoridade.as_deref() != headers.get("host").and_then(|h| h.to_str().ok()) {
            return Err((StatusCode::FORBIDDEN, "Origem não permitida."));
        }
    }
    Ok(())
}

pub(super) fn erro(msg: impl Into<String>) -> Response {
    (StatusCode::BAD_REQUEST, msg.into()).into_response()
}

pub(crate) async fn api_acao(
    axum::Extension(i18n): axum::Extension<ai_memory_core::i18n::Localizer>,
    State(state): State<Arc<WebState>>,
    level: Option<axum::Extension<ai_memory_core::AuthLevel>>,
    headers: HeaderMap,
    Json(acao): Json<Acao>,
) -> Response {
    if let Err(recusa) = autorizar(&i18n, &state, level, &headers).await {
        return recusa;
    }
    let est = estacao(&state);
    let resultado: Result<Option<String>, String> = match acao {
        Acao::SalvarAgente { mut agente } => {
            if agente.fornecedor == "claude" {
                match tokio::task::spawn_blocking(configurar_statusline_claude).await {
                    Ok(Ok(true)) => {
                        tracing::info!("linha de status da Estação-ai ligada no Claude Code")
                    }
                    Ok(Ok(false)) => {}
                    Ok(Err(e)) => {
                        tracing::warn!(erro = %e, "não consegui ligar a linha de status do Claude Code")
                    }
                    Err(_) => {}
                }
            }
            est.mudar(|e| {
                agente.nome = agente.nome.trim().to_owned();
                agente.modelo = agente.modelo.trim().to_owned();
                agente.papel = agente.papel.trim().to_owned();
                agente.funcao = agente.funcao.trim().to_owned();
                if !agente.funcao.is_empty() {
                    let pp = papel(&agente.funcao).ok_or("Papel desconhecido.")?;
                    agente.grupo = pp.grupo.to_owned();
                } else if agente.grupo != "chat" {
                    agente.grupo = "projetos".to_owned();
                }
                agente.fornecedor = agente.fornecedor.trim().to_owned();
                agente.comando = agente.comando.trim().to_owned();
                if agente.nome.is_empty() || agente.comando.is_empty() {
                    return Err("Informe nome e comando do modelo.".into());
                }
                if agente.dono_npub.trim().is_empty() && !e.nostr_perfil.npub.trim().is_empty() {
                    agente.dono_npub = e.nostr_perfil.npub.trim().to_owned();
                }
                if let Some(atual) = e.agentes.iter_mut().find(|a| a.id == agente.id) {
                    agente.execucoes = atual.execucoes;
                    agente.segundos = atual.segundos;
                    agente.uso = atual.uso.clone();
                    if agente.dono_npub.trim().is_empty() {
                        agente.dono_npub = atual.dono_npub.clone();
                    }
                    *atual = agente.clone();
                } else {
                    agente.id = e.novo_id("ag");
                    agente.execucoes = 0;
                    agente.segundos = 0;
                    agente.uso.clear();
                    e.agentes.push(agente.clone());
                }
                Ok(Some(agente.id))
            })
            .await
        }
        Acao::ExcluirAgente { id } => {
            est.mudar(|e| {
                e.agentes.retain(|a| a.id != id);
                for p in &mut e.projetos {
                    p.agentes.retain(|a| *a != id);
                }
                for t in &mut e.tarefas {
                    if t.agente.as_deref() == Some(&id) {
                        t.agente = None;
                    }
                }
                Ok(None)
            })
            .await
        }
        Acao::SalvarProjeto { mut projeto } => {
            est.mudar(|e| {
                projeto.nome = projeto.nome.trim().to_owned();
                projeto.pasta = projeto.pasta.trim().to_owned();
                projeto.memoria = projeto.memoria.trim().to_owned();
                if projeto.nome.is_empty() {
                    return Err("Informe o nome do projeto.".into());
                }
                let meu_npub = e.nostr_perfil.npub.trim().to_owned();
                if let Some(atual) = e.projetos.iter().find(|p| p.id == projeto.id).cloned() {
                    if projeto.dono_npub.trim().is_empty() {
                        projeto.dono_npub = atual.dono_npub;
                    }
                    if projeto.membros_npub.is_empty() && atual.compartilhado && projeto.compartilhado {
                        projeto.membros_npub = atual.membros_npub;
                    }
                    if projeto.compartilhado_por.is_empty() {
                        projeto.compartilhado_por = atual.compartilhado_por;
                    }
                }
                if projeto.dono_npub.trim().is_empty() && !meu_npub.is_empty() {
                    projeto.dono_npub = meu_npub.clone();
                }
                projeto.membros_npub = projeto
                    .membros_npub
                    .into_iter()
                    .map(|m| m.trim().to_owned())
                    .filter(|m| !m.is_empty() && m != &projeto.dono_npub)
                    .collect();
                projeto.membros_npub.sort();
                projeto.membros_npub.dedup();
                if !projeto.membros_npub.is_empty() {
                    projeto.compartilhado = true;
                }
                let validos: HashSet<_> = e
                    .agentes
                    .iter()
                    .filter(|a| agente_pertence_a_projeto(a, &projeto))
                    .map(|a| a.id.clone())
                    .collect();
                projeto.agentes.retain(|a| validos.contains(a));
                // Cota de agentes por pessoa: 6 (pessoal), 4 (2 pessoas), 2 (3+ pessoas).
                let limite = limite_agentes_por_pessoa(&projeto, &meu_npub);
                let mut contagem_por_dono: HashMap<String, usize> = HashMap::new();
                for ag_id in &projeto.agentes {
                    if let Some(ag) = e.agente(ag_id) {
                        let dono = if ag.dono_npub.trim().is_empty() {
                            meu_npub.clone()
                        } else {
                            ag.dono_npub.trim().to_owned()
                        };
                        let c = contagem_por_dono.entry(dono).or_insert(0);
                        *c += 1;
                        if *c > limite {
                            return Err(format!(
                                "Limite de {limite} agente(s) por pessoa atingido nesta sala ({}). Remova agentes extras para continuar.",
                                if projeto.compartilhado { "compartilhada" } else { "pessoal" }
                            ));
                        }
                    }
                }
                if let Some(atual) = e.projetos.iter_mut().find(|p| p.id == projeto.id) {
                    *atual = projeto.clone();
                } else {
                    projeto.id = e.novo_id("pr");
                    e.projetos.push(projeto.clone());
                }
                Ok(Some(projeto.id))
            })
            .await
        }
        Acao::ExcluirProjeto { id } => {
            est.mudar(|e| {
                e.projetos.retain(|p| p.id != id);
                e.tarefas.retain(|t| t.projeto != id);
                e.mensagens.retain(|m| m.projeto != id);
                e.avaliacoes.retain(|a| a.projeto != id);
                e.presenca_salas.remove(&id);
                Ok(None)
            })
            .await
        }
        Acao::SalvarTarefa { mut tarefa } => {
            est.mudar(|e| {
                tarefa.titulo = tarefa.titulo.trim().to_owned();
                if tarefa.titulo.is_empty() || e.projeto(&tarefa.projeto).is_none() {
                    return Err("Informe o título e um projeto existente.".into());
                }
                if let Some(ref ag) = tarefa.agente
                    && e.agente(ag).is_none()
                {
                    return Err("Modelo inexistente.".into());
                }
                tarefa.atualizado = agora();
                if let Some(atual) = e.tarefas.iter_mut().find(|t| t.id == tarefa.id) {
                    tarefa.status = atual.status.clone();
                    *atual = tarefa.clone();
                } else {
                    tarefa.id = e.novo_id("tf");
                    tarefa.status = "a_fazer".into();
                    e.tarefas.push(tarefa.clone());
                }
                Ok(Some(tarefa.id))
            })
            .await
        }
        Acao::ExcluirTarefa { id } => {
            est.mudar(|e| {
                e.tarefas.retain(|t| t.id != id);
                Ok(None)
            })
            .await
        }
        Acao::ReabrirTarefa { id } => {
            est.mudar(|e| {
                let t = e
                    .tarefas
                    .iter_mut()
                    .find(|t| t.id == id)
                    .ok_or("Tarefa inexistente.")?;
                if t.status == "executando" {
                    return Err("A tarefa está em execução; aguarde terminar.".into());
                }
                t.status = "a_fazer".into();
                t.atualizado = agora();
                Ok(None)
            })
            .await
        }
        Acao::Atribuir { tarefa, agente } => {
            est.mudar(|e| {
                if let Some(a) = &agente
                    && e.agente(a).is_none()
                {
                    return Err("Modelo inexistente.".into());
                }
                let t = e
                    .tarefas
                    .iter_mut()
                    .find(|t| t.id == tarefa)
                    .ok_or("Tarefa inexistente.")?;
                if t.status == "executando" {
                    return Err("A tarefa está em execução; aguarde terminar.".into());
                }
                t.agente = agente;
                t.atualizado = agora();
                Ok(None)
            })
            .await
        }
        Acao::Executar { tarefa } => executar_tarefa(&state, est, tarefa).await.map(|()| None),
        Acao::Enviar {
            projeto,
            canal,
            texto,
        } => enviar(&state, est, projeto, canal, texto)
            .await
            .map(|()| None),
        Acao::ContextoGlobal { texto } => {
            est.mudar(|e| {
                e.contexto_global = texto;
                Ok(None)
            })
            .await
        }
        Acao::VincularPasta { projeto } => vincular_pasta(est, &projeto).await.map(|()| None),
        Acao::Parar { projeto, agente } => {
            let estado = est.estado.lock().await;
            let mut encontrou = false;
            if let Ok(mut marcadas) = paradas().lock() {
                for m in &estado.mensagens {
                    if m.estado == "pensando"
                        && m.projeto == projeto
                        && agente.as_ref().is_none_or(|id| id == &m.autor)
                    {
                        marcadas.insert(m.id.clone());
                        encontrou = true;
                    }
                }
            }
            parar_execucoes(|proj, ag| {
                proj == projeto && agente.as_deref().is_none_or(|a| a == ag)
            });
            if !encontrou {
                Err("Nada em execução para parar.".into())
            } else {
                Ok(None)
            }
        }
        Acao::LimparChat { projeto, canal } => {
            est.mudar(|e| {
                e.mensagens
                    .retain(|m| m.projeto != projeto || m.canal != canal || m.estado == "pensando");
                Ok(None)
            })
            .await
        }
        Acao::Debate {
            projeto,
            tema,
            participantes,
            rodadas,
        } => iniciar_debate(&state, est, projeto, tema, participantes, rodadas)
            .await
            .map(|()| None),
        Acao::OcultarMemoria { escopo, ocultar } => {
            est.mudar(|e| {
                e.memorias_ocultas.retain(|x| *x != escopo);
                if ocultar {
                    e.memorias_ocultas.push(escopo);
                }
                Ok(None)
            })
            .await
        }
        Acao::AutoConfigurar { grupo, quantidades } => {
            auto_configurar(est, grupo, quantidades).await
        }
        Acao::ExcluirAgentesGrupo { grupo } => {
            let alvo = grupo.trim().to_owned();
            if alvo != "projetos" && alvo != "chat" {
                return erro("Grupo inválido.");
            }
            est.mudar(|e| {
                let removidos: HashSet<String> = e
                    .agentes
                    .iter()
                    .filter(|a| grupo_do_agente(a) == alvo)
                    .map(|a| a.id.clone())
                    .collect();
                e.agentes.retain(|a| !removidos.contains(&a.id));
                for p in &mut e.projetos {
                    p.agentes.retain(|id| !removidos.contains(id));
                }
                Ok(None)
            })
            .await
        }
        Acao::TestarAgente { id } => testar_agente(est, &id).await,
        Acao::VerificarIdeias {
            projeto,
            canal,
            mensagem_id,
        } => verificar_ideias(&state, est, projeto, canal, mensagem_id)
            .await
            .map(|()| None),
        Acao::AvaliarMediador {
            projeto,
            canal,
            mensagem_id,
        } => avaliar_com_mediador(&state, est, projeto, canal, mensagem_id)
            .await
            .map(|()| None),
        Acao::AlternarFerramenta { fornecedor, ativa } => {
            let forn = fornecedor.trim().to_owned();
            if forn.is_empty() {
                return erro("Fornecedor inválido.");
            }
            est.mudar(|e| {
                e.ferramentas_desativadas.retain(|x| *x != forn);
                if !ativa {
                    e.ferramentas_desativadas.push(forn);
                }
                Ok(None)
            })
            .await
        }
        Acao::SalvarPerfilNostr { mut perfil } => {
            est.mudar(|e| {
                perfil.npub = perfil.npub.trim().to_owned();
                perfil.pubkey_hex = perfil.pubkey_hex.trim().to_owned();
                perfil.apelido = perfil.apelido.trim().to_owned();
                perfil.relay_url = perfil.relay_url.trim().to_owned();
                if perfil.raca_cachorro.trim().is_empty() {
                    perfil.raca_cachorro = "caramelo".into();
                }
                if !perfil.autenticado
                    || perfil.npub != e.nostr_perfil.npub
                    || perfil.pubkey_hex != e.nostr_perfil.pubkey_hex
                {
                    return Err("Entre com a chave privada para trocar de conta.".into());
                }
                e.nostr_perfil = perfil;
                Ok(None)
            })
            .await
        }
        Acao::SalvarContatoNostr { mut contato } => {
            est.mudar(|e| {
                contato.npub = contato.npub.trim().to_owned();
                contato.apelido = contato.apelido.trim().to_owned();
                use nostr::{FromBech32, PublicKey, ToBech32};
                let Ok(pk) = PublicKey::from_bech32(&contato.npub) else {
                    return Err("Informe um endereço npub válido (ex.: npub1...).".into());
                };
                contato.npub = pk.to_bech32().expect("fixed length public key");
                if contato.npub == e.nostr_perfil.npub.trim() {
                    return Err("Você não precisa adicionar seu próprio npub como contato.".into());
                }
                if contato.apelido.is_empty() {
                    contato.apelido = format!(
                        "{}…{}",
                        &contato.npub[..10],
                        &contato.npub[contato.npub.len() - 6..]
                    );
                }
                if contato.raca_cachorro.trim().is_empty() {
                    contato.raca_cachorro = "caramelo".into();
                }
                contato.conectado_em = agora();
                if let Some(atual) = e.nostr_contatos.iter_mut().find(|c| c.npub == contato.npub) {
                    *atual = contato;
                } else {
                    e.nostr_contatos.push(contato);
                }
                Ok(None)
            })
            .await
        }
        Acao::ExcluirContatoNostr { npub } => {
            let alvo = npub.trim().to_owned();
            est.mudar(|e| {
                e.nostr_contatos.retain(|c| c.npub != alvo);
                Ok(None)
            })
            .await
        }
        Acao::CompartilharProjeto {
            projeto,
            compartilhado,
            membros_npub,
        } => {
            est.mudar(|e| {
                let meu_npub = e.nostr_perfil.npub.trim().to_owned();
                let mut membros: Vec<String> = membros_npub
                    .into_iter()
                    .map(|m| m.trim().to_owned())
                    .filter(|m| m.starts_with("npub1") && m != &meu_npub)
                    .collect();
                membros.sort();
                membros.dedup();
                let ativo = compartilhado || !membros.is_empty();
                let ag_donos: HashMap<String, String> = e
                    .agentes
                    .iter()
                    .map(|a| {
                        let d = if a.dono_npub.trim().is_empty() {
                            meu_npub.clone()
                        } else {
                            a.dono_npub.trim().to_owned()
                        };
                        (a.id.clone(), d)
                    })
                    .collect();
                let Some(p) = e.projetos.iter_mut().find(|p| p.id == projeto) else {
                    return Err("Projeto ou chat inexistente.".into());
                };
                p.compartilhado = ativo;
                p.membros_npub = if ativo { membros } else { Vec::new() };
                if p.dono_npub.trim().is_empty() && !meu_npub.is_empty() {
                    p.dono_npub = meu_npub.clone();
                }
                // Ajusta agentes excedentes automaticamente para respeitar a cota (4 para 2 pessoas, 2 para 3+).
                let limite = limite_agentes_por_pessoa(p, &meu_npub);
                let mut contagem: HashMap<String, usize> = HashMap::new();
                p.agentes.retain(|ag_id| {
                    let dono = ag_donos.get(ag_id).cloned().unwrap_or_default();
                    let c = contagem.entry(dono).or_insert(0);
                    *c += 1;
                    *c <= limite
                });
                Ok(None)
            })
            .await
        }
        Acao::AtualizarPresenca {
            projeto,
            npubs_online,
        } => {
            est.mudar(|e| {
                let mut lista: Vec<String> = npubs_online
                    .into_iter()
                    .map(|n| n.trim().to_owned())
                    .filter(|n| !n.is_empty())
                    .collect();
                lista.sort();
                lista.dedup();
                e.presenca_salas.insert(projeto, lista);
                Ok(None)
            })
            .await
        }
        Acao::SincronizarSalaCompartilhada {
            mut projeto,
            agentes_remotos,
        } => {
            est.mudar(|e| {
                projeto.nome = projeto.nome.trim().to_owned();
                if projeto.nome.is_empty() {
                    return Err("Sala compartilhada sem nome.".into());
                }
                projeto.compartilhado = true;
                for mut ag in agentes_remotos {
                    if ag.id.trim().is_empty() || ag.nome.trim().is_empty() {
                        continue;
                    }
                    if let Some(atual) = e.agentes.iter_mut().find(|a| a.id == ag.id) {
                        atual.nome = ag.nome;
                        atual.fornecedor = ag.fornecedor;
                        atual.modelo = ag.modelo;
                        atual.funcao = ag.funcao;
                        atual.grupo = ag.grupo;
                        atual.dono_npub = ag.dono_npub;
                        atual.raca_cachorro = ag.raca_cachorro;
                    } else {
                        if ag.comando.trim().is_empty() {
                            ag.comando = "echo '(agente remoto Nostr)'".into();
                        }
                        e.agentes.push(ag);
                    }
                }
                if let Some(atual) = e.projetos.iter_mut().find(|p| p.id == projeto.id) {
                    atual.nome = projeto.nome;
                    atual.descricao = projeto.descricao;
                    atual.compartilhado = true;
                    atual.membros_npub = projeto.membros_npub;
                    atual.compartilhado_por = projeto.compartilhado_por;
                    atual.dono_npub = projeto.dono_npub;
                    for ag_id in projeto.agentes {
                        if !atual.agentes.contains(&ag_id) {
                            atual.agentes.push(ag_id);
                        }
                    }
                    Ok(Some(atual.id.clone()))
                } else {
                    if projeto.id.trim().is_empty() {
                        projeto.id = e.novo_id("sh");
                    }
                    let id = projeto.id.clone();
                    e.projetos.push(projeto);
                    Ok(Some(id))
                }
            })
            .await
        }
    };
    match resultado {
        Ok(Some(id)) => Json(serde_json::json!({ "id": id })).into_response(),
        Ok(None) => StatusCode::NO_CONTENT.into_response(),
        Err(msg) => erro(msg),
    }
}

async fn testar_agente(est: Arc<Estacao>, id: &str) -> Result<Option<String>, String> {
    let ag = {
        let e = est.estado.lock().await;
        e.agente(id).cloned().ok_or("Modelo inexistente.")?
    };
    if !cli_encontrada(&ag.comando) {
        return Err(format!(
            "CLI não encontrada no sistema para o comando: {}",
            ag.comando
        ));
    }
    let saida = executar_comando(
        &ag,
        "",
        "Responda apenas com uma frase curta em português confirmando que você está online.",
        None,
        Some(TEMPO_MAXIMO),
    )
    .await?;
    Ok(Some(if saida.texto.trim().is_empty() {
        "Conectado com sucesso (sem texto de saída).".into()
    } else {
        saida.texto
    }))
}
