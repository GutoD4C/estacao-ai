use std::collections::HashSet;
use std::sync::Arc;

use serde::Deserialize;

use super::estado::{
    Agente, AvaliacaoAgente, Estacao, Estado, Mensagem, Projeto, Tarefa, UsoExecucao,
    agente_online_no_projeto, agora, eh_conversa,
};
use super::memoria::{
    MAX_HISTORICO, MemoriaPrompt, memoria_do_projeto, montar_prompt, resumir_corpo,
};
use super::processo::{TEMPO_MAXIMO, executar_comando, paradas};
use crate::state::WebState;

/// Rodadas máximas de um debate (cada rodada = cada participante fala uma vez).
const MAX_RODADAS_DEBATE: usize = 5;

/// Um debate em andamento: tema, ordem de fala e quantas falas ainda faltam.
#[derive(Clone)]
pub(super) struct Debate {
    pub(super) tema: String,
    pub(super) ordem: Vec<String>,
    pub(super) restantes: usize,
}

/// Uma execução de agente pendente: quem, onde, com que prompt e onde responder.
pub(super) struct Execucao {
    pub(super) agente: Agente,
    pasta: String,
    pub(super) prompt: String,
    pub(super) mensagem: String,
    canal: String,
    tarefa: Option<String>,
    memoria: Arc<MemoriaPrompt>,
    trabalho: Option<Trabalho>,
    debate: Option<Debate>,
    eh_avaliacao: bool,
}

/// Contexto da entrega que acompanha as trocas de agente, mesmo após a poda do chat.
#[derive(Clone)]
struct Trabalho {
    objetivo: String,
    etapa: String,
    corrigir_formato: bool,
    coordenador: Option<String>,
}

impl Execucao {
    fn com_trabalho(mut self, trabalho: Trabalho) -> Self {
        self.prompt.push_str(&format!(
            "\n## Entrega em andamento\nPedido original do operador: {}\nEtapa atual: {}\n",
            trabalho.objetivo, trabalho.etapa
        ));
        self.prompt.push_str("Execute a etapa agora, aproveitando os arquivos existentes. Verifique o resultado. Se houver trabalho possível, avance sem pedir um ‘continue’. Para uma pergunta, basta responder. Relate o resultado e termine com uma linha de controle isolada: ENTREGUE quando sua etapa estiver atendida e verificada, CONTINUAR quando houver um próximo passo seu, ou BLOQUEADO se precisar de intervenção externa (explique o motivo acima).");
        if self.agente.funcao == "pensador" {
            self.prompt.push_str(" Como coordenador e único porta-voz no chat do projeto, só declare ENTREGUE quando todo o pedido estiver atendido. Para delegar trabalho aos demais agentes na lista TAREFAS, adicione uma ou mais linhas isoladas no formato `@Nome: ação concreta` no final da resposta (use nomes exatos da equipe). Os agentes executarão nos bastidores atualizando a lista lateral TAREFAS e devolverão o resultado para você revisar.");
        }
        self.trabalho = Some(trabalho);
        self
    }
}

/// Quem responde no chat geral:
/// - Em **Projetos** (`!eh_conversa(p)`): se houver Pensador na equipe, APENAS o Pensador fala no chat e delega tarefas aos demais.
/// - Em **Chats** (`eh_conversa(p)`): @citados, ou todos os participantes online.
pub(super) fn destinos_chat_geral(p: &Projeto, equipe: &[Agente], texto: &str) -> Vec<Agente> {
    if !eh_conversa(p) {
        let pensadores: Vec<Agente> = equipe
            .iter()
            .filter(|a| a.funcao == "pensador")
            .cloned()
            .collect();
        if !pensadores.is_empty() {
            return pensadores;
        }
    }
    let citados: Vec<Agente> = equipe
        .iter()
        .filter(|a| texto.contains(&format!("@{}", a.nome)))
        .cloned()
        .collect();
    if !citados.is_empty() {
        return citados;
    }
    // Em salas de Chat com Mediador + outros participantes, os falantes respondem primeiro;
    // quando todos terminam, o Mediador entra automaticamente para sintetizar e dar nota para todos!
    if eh_conversa(p) {
        let nao_mediadores: Vec<Agente> = equipe
            .iter()
            .filter(|a| a.funcao != "mediador")
            .cloned()
            .collect();
        if !nao_mediadores.is_empty() {
            return nao_mediadores;
        }
    }
    equipe.to_vec()
}

fn equipe_do_projeto(e: &Estado, p: &Projeto) -> Vec<Agente> {
    p.agentes
        .iter()
        .filter_map(|id| e.agente(id).cloned())
        .filter(|a| agente_online_no_projeto(e, p, a))
        .collect()
}

/// Cria a mensagem "pensando" do agente e devolve a execução correspondente.
#[allow(clippy::too_many_arguments)]
pub(super) fn agendar(
    e: &mut Estado,
    p: &Projeto,
    canal: &str,
    agente: Agente,
    memoria: &Arc<MemoriaPrompt>,
    pedido: Option<String>,
    debate: Option<Debate>,
) -> Execucao {
    let prompt = montar_prompt(e, p, &agente, canal, memoria, None, pedido.as_deref());
    let id = e.novo_id("m");
    e.mensagens.push(Mensagem {
        id: id.clone(),
        projeto: p.id.clone(),
        canal: canal.to_owned(),
        autor: agente.id.clone(),
        texto: String::new(),
        em: agora(),
        estado: "pensando".into(),
    });
    Execucao {
        agente,
        pasta: p.pasta.clone(),
        prompt,
        mensagem: id,
        canal: canal.to_owned(),
        tarefa: None,
        memoria: memoria.clone(),
        trabalho: None,
        debate,
        eh_avaliacao: false,
    }
}

#[allow(dead_code)]
pub(super) fn pedido_debate(d: &Debate) -> String {
    pedido_debate_turno(d, None, None, d.restantes == 0)
}

fn pedido_debate_turno(
    d: &Debate,
    anterior: Option<&str>,
    proximo: Option<&str>,
    eh_ultimo: bool,
) -> String {
    let mut s = format!(
        "Você está em um debate estruturado e colaborativo no chat geral sobre:\n\"{}\"\n\n",
        d.tema
    );
    if let Some(ant) = anterior {
        s.push_str(&format!(
            "- Responda e questione diretamente a fala anterior de **{ant}**: diga com o que concorda, o que contesta ou verifica como falha/risco, trazendo argumentos ou evidências concretas.\n"
        ));
    } else {
        s.push_str(
            "- Abra o debate apresentando sua tese inicial, premissas principais e possíveis pontos frágeis.\n",
        );
    }
    if eh_ultimo {
        s.push_str(
            "- Esta é a rodada final: além de responder aos argumentos anteriores, inclua ao final uma seção **`## Verificação & Síntese Final`** listando: (1) pontos verificados de consenso, (2) divergências e riscos levantados, e (3) recomendação prática.",
        );
    } else if let Some(prox) = proximo {
        s.push_str(&format!(
            "- Teste e verifique as ideias discutidas até aqui e termine fazendo **uma pergunta ou provocação direta** para **@{prox}** responder na próxima fala.",
        ));
    } else {
        s.push_str(
            "- Verifique as ideias apresentadas até aqui e termine com uma pergunta direta para os demais participantes.",
        );
    }
    s
}

/// Detecta se o usuário pediu um debate diretamente no chat (ex.: "debate: ...", "/debate ...", "vamos debater ...").
pub(super) fn detectar_pedido_debate(texto: &str) -> Option<(String, usize)> {
    let limpa = texto.trim();
    if limpa.is_empty() {
        return None;
    }
    let lower = limpa.to_ascii_lowercase();
    let gatilho = lower.starts_with("debate")
        || lower.starts_with("/debate")
        || lower.starts_with("debatam")
        || lower.starts_with("debater")
        || lower.contains("vamos debater")
        || lower.contains("façam um debate")
        || lower.contains("facam um debate")
        || lower.contains("iniciar debate")
        || lower
            .split(|c: char| !c.is_alphanumeric())
            .any(|w| matches!(w, "debate" | "debatam" | "debater"));
    if !gatilho {
        return None;
    }
    let tema = limpa
        .strip_prefix("/debate")
        .or_else(|| limpa.strip_prefix("debate:"))
        .or_else(|| limpa.strip_prefix("Debate:"))
        .unwrap_or(limpa)
        .trim_start_matches([':', '-', ' '])
        .trim();
    let tema = if tema.is_empty() { limpa } else { tema };
    Some((tema.to_owned(), 2))
}

/// Escolhe participantes para um debate acionado pelo chat, priorizando diversidade de provedores e papéis de debate.
fn selecionar_participantes_debate(equipe: &[Agente], texto: &str) -> Vec<String> {
    let citados: Vec<String> = equipe
        .iter()
        .filter(|a| texto.contains(&format!("@{}", a.nome)))
        .map(|a| a.id.clone())
        .collect();
    if citados.len() >= 2 {
        return citados;
    }
    let mut escolhidos: Vec<String> = Vec::new();
    let mut fornecedores_vistos: HashSet<&str> = HashSet::new();
    let prioridade = [
        "cetico",
        "otimista",
        "pragmatico",
        "criativo",
        "analitico",
        "estrategista",
        "empatico",
        "advogado_diabo",
        "contador_historias",
        "pensador",
        "arquiteto",
        "qa_seguranca",
        "desenvolvedor",
        "filosofo",
        "mediador",
    ];
    // 1a passada: pega representantes com fornecedores distintos primeiro.
    for func in prioridade {
        for a in equipe.iter().filter(|a| a.funcao == func) {
            if escolhidos.len() >= 4 {
                break;
            }
            if !escolhidos.contains(&a.id) && fornecedores_vistos.insert(a.fornecedor.as_str()) {
                escolhidos.push(a.id.clone());
            }
        }
    }
    // 2a passada: garante papéis de debate/análise e provedores diretos até 4 participantes.
    for a in equipe {
        if escolhidos.len() >= 4 {
            break;
        }
        if a.funcao.is_empty()
            && !escolhidos.contains(&a.id)
            && fornecedores_vistos.insert(a.fornecedor.as_str())
        {
            escolhidos.push(a.id.clone());
        }
    }
    for func in prioridade {
        for a in equipe.iter().filter(|a| a.funcao == func) {
            if escolhidos.len() >= 4 {
                break;
            }
            if !escolhidos.contains(&a.id) {
                escolhidos.push(a.id.clone());
            }
        }
    }
    for a in equipe {
        if escolhidos.len() >= 4 {
            break;
        }
        if !escolhidos.contains(&a.id) {
            escolhidos.push(a.id.clone());
        }
    }
    escolhidos
}

/// Coleta todos os agentes (exceto Mediador) que falaram recentemente no canal.
/// Primeiro busca todas as falas desde a última mensagem do operador ou avaliação anterior do Mediador;
/// se não houver nenhuma nesse intervalo, recolhe todos os falantes distintos do canal.
fn falantes_recentes_do_canal(
    e: &Estado,
    projeto_id: &str,
    canal: &str,
    excluir_msg_id: Option<&str>,
) -> Vec<Agente> {
    let mut vistos = HashSet::new();
    let mut recentes_rev: Vec<Agente> = Vec::new();
    for m in e.mensagens.iter().rev() {
        if m.projeto != projeto_id || (!canal.is_empty() && m.canal != canal) {
            continue;
        }
        if excluir_msg_id.is_some_and(|ex| m.id == ex) {
            continue;
        }
        if m.autor == "voce" {
            if !recentes_rev.is_empty() {
                break;
            }
            continue;
        }
        if m.estado != "ok" {
            continue;
        }
        if let Some(a) = e.agente(&m.autor) {
            if a.funcao == "mediador" {
                if !recentes_rev.is_empty() {
                    break;
                }
                continue;
            }
            if vistos.insert(a.id.clone()) {
                recentes_rev.push(a.clone());
            }
        }
    }
    if recentes_rev.is_empty() {
        for m in e.mensagens.iter().rev() {
            if m.projeto != projeto_id
                || (!canal.is_empty() && m.canal != canal)
                || m.autor == "voce"
                || m.estado != "ok"
            {
                continue;
            }
            if excluir_msg_id.is_some_and(|ex| m.id == ex) {
                continue;
            }
            if let Some(a) = e.agente(&m.autor)
                && a.funcao != "mediador"
                && vistos.insert(a.id.clone())
            {
                recentes_rev.push(a.clone());
            }
        }
    }
    recentes_rev.reverse();
    recentes_rev
}

fn pedido_avaliacao_mediador(alvos: &[String]) -> String {
    let nomes = if alvos.is_empty() {
        "todos os participantes que falaram".to_owned()
    } else {
        alvos.join(", ")
    };
    let exemplo_itens = if alvos.is_empty() {
        "{\"agente\":\"NomeExato1\",\"clareza\":8,\"fundamentacao\":8,\"colaboracao\":9,\"pontos_fortes\":\"texto curto\",\"melhorar\":\"o que ajustar na próxima fala\"}".to_owned()
    } else {
        alvos
            .iter()
            .map(|n| {
                format!(
                    "{{\"agente\":{},\"clareza\":8,\"fundamentacao\":8,\"colaboracao\":9,\"pontos_fortes\":\"texto curto\",\"melhorar\":\"o que ajustar na próxima fala\"}}",
                    serde_json::to_string(n).unwrap_or_else(|_| format!("\"{n}\""))
                )
            })
            .collect::<Vec<_>>()
            .join(",")
    };
    format!(
        "Como **Mediador (Posto Mais Alto)**, avalie internamente as respostas de **TODOS** os participantes que falaram: **{nomes}**.\n\nRegras obrigatórias:\n- Avalie **CADA UM** dos participantes listados acima (não avalie apenas um!).\n- Diga objetivamente os pontos fortes e o que cada participante pode melhorar na próxima fala.\n\nEstruture sua resposta em:\n1. **Síntese & Pontos a Melhorar** (um breve comentário por participante)\n2. **Ao final, em uma linha separada**, gere exatamente o bloco JSON com **UM objeto para CADA participante listado ({nomes})**:\nAVALIACAO_JSON: [{exemplo_itens}]\n(Use notas inteiras de 0 a 10 para clareza, fundamentacao e colaboracao)."
    )
}

#[derive(Deserialize)]
struct EntradaAvaliacao {
    agente: String,
    #[serde(default)]
    clareza: Option<u8>,
    #[serde(default)]
    fundamentacao: Option<u8>,
    #[serde(default)]
    colaboracao: Option<u8>,
    #[serde(default)]
    pontos_fortes: String,
    #[serde(default)]
    melhorar: String,
}

fn normalizar_chave_nome(s: &str) -> String {
    s.trim().to_lowercase()
}

pub(super) fn registrar_avaliacoes_mediador(
    e: &mut Estado,
    projeto_id: &str,
    mensagem_id: &str,
    texto: &mut String,
    forcar_fallback: bool,
) -> usize {
    let equipe_proj: Vec<Agente> = e
        .projeto(projeto_id)
        .map(|p| equipe_do_projeto(e, p))
        .unwrap_or_default();
    let todos_agentes = e.agentes.clone();
    let achar_agente = |nome_ou_id: &str| -> Option<Agente> {
        let q = normalizar_chave_nome(nome_ou_id);
        todos_agentes
            .iter()
            .filter(|a| equipe_proj.is_empty() || equipe_proj.iter().any(|x| x.id == a.id))
            .find(|a| {
                normalizar_chave_nome(&a.nome) == q
                    || normalizar_chave_nome(&a.id) == q
                    || normalizar_chave_nome(&a.nome).starts_with(&q)
            })
            .cloned()
    };

    let mut registradas = Vec::new();
    let mut ja_avaliados: HashSet<String> = HashSet::new();
    let mut texto_limpo = texto.clone();
    if let Some(pos) = texto.find("AVALIACAO_JSON:") {
        let apos = texto[pos + "AVALIACAO_JSON:".len()..].trim();
        let json_trecho = if let (Some(ini), Some(fim)) = (apos.find('['), apos.rfind(']')) {
            if fim >= ini {
                Some(&apos[ini..=fim])
            } else {
                None
            }
        } else if let (Some(ini), Some(fim)) = (apos.find('{'), apos.rfind('}')) {
            if fim >= ini {
                Some(&apos[ini..=fim])
            } else {
                None
            }
        } else {
            None
        };
        let itens_parsed = json_trecho.and_then(|raw| {
            serde_json::from_str::<Vec<EntradaAvaliacao>>(raw)
                .ok()
                .or_else(|| serde_json::from_str::<EntradaAvaliacao>(raw).ok().map(|x| vec![x]))
        });
        if let Some(itens) = itens_parsed {
            for item in itens {
                let ag = achar_agente(&item.agente);
                let (ag_id, ag_nome) = match ag {
                    Some(a) => (a.id, a.nome),
                    None => (item.agente.trim().to_owned(), item.agente.trim().to_owned()),
                };
                if ag_nome.is_empty() || !ja_avaliados.insert(ag_id.clone()) {
                    continue;
                }
                let c = item.clareza.unwrap_or(7).min(10);
                let f = item.fundamentacao.unwrap_or(7).min(10);
                let col = item.colaboracao.unwrap_or(7).min(10);
                let media =
                    ((f32::from(c) + f32::from(f) + f32::from(col)) / 3.0 * 10.0).round() / 10.0;
                registradas.push(AvaliacaoAgente {
                    id: e.novo_id("av"),
                    projeto: projeto_id.to_owned(),
                    mensagem_id: mensagem_id.to_owned(),
                    agente_id: ag_id,
                    agente_nome: ag_nome,
                    nota_clareza: c,
                    nota_fundamentacao: f,
                    nota_colaboracao: col,
                    media,
                    pontos_fortes: item.pontos_fortes.trim().to_owned(),
                    melhorar: item.melhorar.trim().to_owned(),
                    em: agora(),
                });
            }
            let prefixo = texto[..pos]
                .trim_end()
                .trim_end_matches("```json")
                .trim_end_matches("```")
                .trim_end();
            texto_limpo = prefixo.to_owned();
        }
    }

    // Garante que TODOS os participantes que falaram recebam nota — mesmo que o modelo
    // tenha omitido alguns no JSON ou retornado apenas o primeiro.
    if forcar_fallback {
        let canal_msg = e
            .mensagens
            .iter()
            .find(|m| m.id == mensagem_id)
            .map(|m| m.canal.clone())
            .unwrap_or_else(|| "geral".into());
        let recentes = falantes_recentes_do_canal(e, projeto_id, &canal_msg, Some(mensagem_id));
        let resumo_critica = resumir_corpo(&texto_limpo, 180);
        for a in recentes {
            if !ja_avaliados.insert(a.id.clone()) {
                continue;
            }
            registradas.push(AvaliacaoAgente {
                id: e.novo_id("av"),
                projeto: projeto_id.to_owned(),
                mensagem_id: mensagem_id.to_owned(),
                agente_id: a.id,
                agente_nome: a.nome,
                nota_clareza: 7,
                nota_fundamentacao: 7,
                nota_colaboracao: 8,
                media: 7.3,
                pontos_fortes: "Participação relevante na discussão.".into(),
                melhorar: if resumo_critica.is_empty() {
                    "Aprofundar argumentos com exemplos práticos na próxima fala.".into()
                } else {
                    resumo_critica.clone()
                },
                em: agora(),
            });
        }
    }

    let qtd = registradas.len();
    if qtd > 0 {
        let mut tabela = String::from("\n\n---\n⚖️ **Pontuação Interna do Mediador**\n");
        for av in &registradas {
            tabela.push_str(&format!(
                "- **{}** — **Média {:.1}/10** _(Clareza {} · Fundamentação {} · Colaboração {})_",
                av.agente_nome,
                av.media,
                av.nota_clareza,
                av.nota_fundamentacao,
                av.nota_colaboracao
            ));
            if !av.melhorar.is_empty() {
                tabela.push_str(&format!(" → *Melhorar:* {}", av.melhorar));
            }
            tabela.push('\n');
        }
        if texto_limpo.is_empty() {
            texto_limpo = tabela.trim_start().to_owned();
        } else {
            texto_limpo.push_str(&tabela);
        }
        *texto = texto_limpo;
        e.avaliacoes.extend(registradas);
        // Mantém no máximo as 80 avaliações mais recentes por projeto.
        let total_proj = e
            .avaliacoes
            .iter()
            .filter(|a| a.projeto == projeto_id)
            .count();
        if total_proj > 80 {
            let mut remover = total_proj - 80;
            e.avaliacoes.retain(|a| {
                if a.projeto == projeto_id && remover > 0 {
                    remover -= 1;
                    false
                } else {
                    true
                }
            });
        }
    }
    qtd
}

/// Agenda a próxima fala do debate ou a avaliação do Mediador no chat.
pub(super) fn proximos(e: &mut Estado, p: &Projeto, ex: &Execucao) -> Vec<Execucao> {
    let equipe = equipe_do_projeto(e, p);
    let mut fila = Vec::new();
    let agendar_avaliacao_mediador = |e: &mut Estado,
                                      fila: &mut Vec<Execucao>,
                                      alvos: Vec<String>| {
        let Some(med) = equipe
            .iter()
            .find(|a| a.funcao == "mediador" && a.id != ex.agente.id)
            .cloned()
        else {
            return;
        };
        let med_ocupado = e.mensagens.iter().any(|m| {
            m.projeto == p.id && m.canal == ex.canal && m.autor == med.id && m.estado == "pensando"
        });
        if med_ocupado {
            return;
        }
        let pedido = pedido_avaliacao_mediador(&alvos);
        let mut ex_av = agendar(e, p, &ex.canal, med, &ex.memoria, Some(pedido), None);
        ex_av.eh_avaliacao = true;
        fila.push(ex_av);
    };
    if let Some(d) = &ex.debate {
        if d.restantes > 0 && !d.ordem.is_empty() {
            let pos = d
                .ordem
                .iter()
                .position(|id| *id == ex.agente.id)
                .unwrap_or(0);
            let prox_idx = (pos + 1) % d.ordem.len();
            let prox = &d.ordem[prox_idx];
            let depois = d
                .ordem
                .get((prox_idx + 1) % d.ordem.len())
                .and_then(|id| equipe.iter().find(|a| &a.id == id).map(|a| a.nome.as_str()));
            if let Some(a) = equipe.iter().find(|a| &a.id == prox).cloned() {
                let d2 = Debate {
                    restantes: d.restantes - 1,
                    ..d.clone()
                };
                let pedido =
                    pedido_debate_turno(&d2, Some(&ex.agente.nome), depois, d2.restantes == 0);
                fila.push(agendar(
                    e,
                    p,
                    "geral",
                    a,
                    &ex.memoria,
                    Some(pedido),
                    Some(d2),
                ));
            }
        } else if d.restantes == 0 && ex.agente.funcao != "mediador" {
            let mut alvos: Vec<String> = d
                .ordem
                .iter()
                .filter_map(|id| {
                    equipe
                        .iter()
                        .find(|a| &a.id == id && a.funcao != "mediador")
                        .map(|a| a.nome.clone())
                })
                .collect();
            if alvos.is_empty() {
                alvos = falantes_recentes_do_canal(e, &p.id, &ex.canal, None)
                    .into_iter()
                    .map(|a| a.nome)
                    .collect();
            }
            agendar_avaliacao_mediador(e, &mut fila, alvos);
        }
        return fila;
    }
    if !ex.eh_avaliacao && ex.canal == "geral" && ex.agente.funcao != "mediador" && eh_conversa(p) {
        // Só aciona o Mediador depois que TODOS os outros agentes que estavam respondendo terminarem,
        // assim ele dá nota para todos que falaram — e não apenas para o primeiro que terminou!
        let outros_pensando = e.mensagens.iter().any(|m| {
            m.projeto == p.id
                && m.canal == ex.canal
                && m.id != ex.mensagem
                && m.autor != "voce"
                && m.estado == "pensando"
                && e.agente(&m.autor).is_some_and(|a| a.funcao != "mediador")
        });
        if !outros_pensando {
            let mut alvos: Vec<String> = falantes_recentes_do_canal(e, &p.id, &ex.canal, None)
                .into_iter()
                .map(|a| a.nome)
                .collect();
            if alvos.is_empty() {
                alvos.push(ex.agente.nome.clone());
            }
            agendar_avaliacao_mediador(e, &mut fila, alvos);
        }
    }
    fila
}

/// Extrai linhas de delegação `@Nome: instrução` da resposta do Pensador.
pub(super) fn extrair_delegacoes(
    equipe: &[Agente],
    autor_id: &str,
    resposta: &str,
) -> Vec<(Agente, String)> {
    let mut saida = Vec::new();
    for linha in resposta.lines() {
        let limpa = linha
            .trim()
            .trim_start_matches(['-', '*', '•', ' '])
            .trim_start_matches("TAREFA:")
            .trim_start_matches("TAREFA")
            .trim();
        let Some(resto) = limpa.strip_prefix('@') else {
            continue;
        };
        let Some((nome, etapa)) = resto.split_once(':') else {
            continue;
        };
        let etapa = etapa.trim();
        if etapa.is_empty() {
            continue;
        }
        let nome_q = normalizar_chave_nome(nome);
        if let Some(ag) = equipe
            .iter()
            .find(|a| a.id != autor_id && normalizar_chave_nome(&a.nome) == nome_q)
        {
            saida.push((ag.clone(), etapa.to_owned()));
        }
    }
    saida
}

/// Decide as próximas etapas desta entrega:
/// - Quando o Pensador delega `@Nome: ação`, cria automaticamente tarefas na lista TAREFAS
///   e executa os agentes em canais internos silenciosos (`tarefa:<id>`), sem poluir o chat!
/// - Quando um agente conclui (`ENTREGUE`), atualiza a tarefa e devolve o resumo ao Pensador no chat geral.
fn continuar_trabalho(
    e: &mut Estado,
    p: &Projeto,
    ex: &Execucao,
    trabalho: &Trabalho,
    resposta: &str,
) -> Result<Vec<Execucao>, String> {
    let equipe = equipe_do_projeto(e, p);
    let controle = resposta.trim_end().lines().last().unwrap_or("").trim();
    let mut proximo = trabalho.clone();
    proximo.corrigir_formato = false;

    // 1. Se for o Pensador e houver delegações `@Nome: tarefa`, cria cada Tarefa e dispara os agentes silenciosamente.
    if ex.agente.funcao == "pensador" {
        let delegacoes = extrair_delegacoes(&equipe, &ex.agente.id, resposta);
        if !delegacoes.is_empty() {
            let mut fila = Vec::new();
            for (agente_alvo, etapa) in delegacoes {
                let tid = e.novo_id("tf");
                let titulo = resumir_corpo(&etapa, 76);
                e.tarefas.push(Tarefa {
                    id: tid.clone(),
                    projeto: p.id.clone(),
                    titulo,
                    descricao: etapa.clone(),
                    agente: Some(agente_alvo.id.clone()),
                    status: "executando".into(),
                    progresso: format!(
                        "{} iniciou esta tarefa delegada pelo Pensador…",
                        agente_alvo.nome
                    ),
                    resultado: String::new(),
                    atualizado: agora(),
                });
                let canal_interno = format!("tarefa:{tid}");
                let pedido = format!(
                    "Tarefa delegada pelo Pensador ({}):\n{}\n\nExecute agora no projeto e entregue um resumo objetivo do que foi feito e verificado.",
                    ex.agente.nome, etapa
                );
                let mut tr_worker = trabalho.clone();
                tr_worker.coordenador = Some(ex.agente.id.clone());
                tr_worker.etapa = etapa;
                tr_worker.corrigir_formato = false;
                let mut prox = agendar(
                    e,
                    p,
                    &canal_interno,
                    agente_alvo,
                    &ex.memoria,
                    Some(pedido),
                    None,
                )
                .com_trabalho(tr_worker);
                prox.tarefa = Some(tid);
                fila.push(prox);
            }
            return Ok(fila);
        }
    }

    let (agente, canal_destino) = match controle {
        "ENTREGUE" => {
            if (ex.tarefa.is_none() && trabalho.coordenador.is_none())
                || ex.agente.funcao == "pensador"
            {
                return Ok(Vec::new());
            }
            let Some(revisor) = equipe.iter().find(|a| {
                a.funcao == "pensador" && trabalho.coordenador.as_ref().is_none_or(|id| id == &a.id)
            }) else {
                return Ok(Vec::new());
            };
            proximo.etapa = format!(
                "O agente {} concluiu a tarefa na lista TAREFAS. Resuma o avanço para o operador no chat e, se faltar algo, delegue a próxima etapa com `@Nome: ação`; caso contrário finalize com ENTREGUE.",
                ex.agente.nome
            );
            (revisor.clone(), "geral".to_owned())
        }
        "BLOQUEADO" => {
            return Err("Execução bloqueada. Confira o impedimento relatado pelo agente.".into());
        }
        "CONTINUAR" => (ex.agente.clone(), ex.canal.clone()),
        _ => {
            if trabalho.corrigir_formato {
                return Err("O agente não informou uma decisão de execução válida após a solicitação de correção.".into());
            }
            proximo.corrigir_formato = true;
            (ex.agente.clone(), ex.canal.clone())
        }
    };
    let pedido = format!(
        "Resultado da etapa anterior ({}):\n{}\n{}",
        ex.agente.nome,
        resumir_corpo(resposta, MAX_HISTORICO),
        if proximo.corrigir_formato {
            "Confira o trabalho já feito e corrija a linha de controle final (ENTREGUE, CONTINUAR, BLOQUEADO ou @Nome: tarefa)."
        } else {
            "Prossiga a partir deste resultado."
        }
    );
    let mut prox = agendar(
        e,
        p,
        &canal_destino,
        agente,
        &ex.memoria,
        Some(pedido),
        None,
    )
    .com_trabalho(proximo);
    if canal_destino != "geral" {
        prox.tarefa.clone_from(&ex.tarefa);
    }
    Ok(vec![prox])
}

pub(super) async fn enviar(
    state: &WebState,
    est: Arc<Estacao>,
    projeto: String,
    canal: String,
    texto: String,
) -> Result<(), String> {
    let texto = texto.trim().to_owned();
    if texto.is_empty() {
        return Err("Mensagem vazia.".into());
    }
    if canal == "geral"
        && let Some((tema, rodadas)) = detectar_pedido_debate(&texto)
    {
        let participantes = {
            let e = est.estado.lock().await;
            let p = e.projeto(&projeto).ok_or("Projeto inexistente.")?;
            let equipe = equipe_do_projeto(&e, p);
            selecionar_participantes_debate(&equipe, &texto)
        };
        if participantes.len() >= 2 {
            return iniciar_debate(state, est, projeto, tema, participantes, rodadas).await;
        }
    }
    let memoria = Arc::new(memoria_do_projeto(state, &est, &projeto).await);
    let execucoes = est
        .mudar(|e| {
            let p = e.projeto(&projeto).cloned().ok_or("Projeto inexistente.")?;
            let destinos = if canal == "geral" {
                destinos_chat_geral(&p, &equipe_do_projeto(e, &p), &texto)
            } else {
                if !p.agentes.contains(&canal) {
                    return Err("Esse agente não faz parte do projeto.".into());
                }
                e.agente(&canal).cloned().into_iter().collect()
            };
            let id = e.novo_id("m");
            e.mensagens.push(Mensagem {
                id,
                projeto: projeto.clone(),
                canal: canal.clone(),
                autor: "voce".into(),
                texto: texto.clone(),
                em: agora(),
                estado: "ok".into(),
            });
            let fila: Vec<Execucao> = destinos
                .into_iter()
                .map(|a| {
                    let ex = agendar(e, &p, &canal, a, &memoria, None, None);
                    if eh_conversa(&p) {
                        ex
                    } else {
                        ex.com_trabalho(Trabalho {
                            objetivo: texto.clone(),
                            etapa: "Atenda ao pedido do operador.".into(),
                            corrigir_formato: false,
                            coordenador: None,
                        })
                    }
                })
                .collect();
            e.podar_mensagens(&projeto);
            Ok(fila)
        })
        .await?;
    for ex in execucoes {
        tokio::spawn(rodar(est.clone(), ex));
    }
    Ok(())
}

pub(super) async fn verificar_ideias(
    state: &WebState,
    est: Arc<Estacao>,
    projeto: String,
    canal: String,
    mensagem_id: Option<String>,
) -> Result<(), String> {
    let memoria = Arc::new(memoria_do_projeto(state, &est, &projeto).await);
    let ex = est
        .mudar(|e| {
            let p = e.projeto(&projeto).cloned().ok_or("Projeto inexistente.")?;
            let equipe = equipe_do_projeto(e, &p);
            if equipe.is_empty() {
                return Err("Adicione pelo menos um modelo antes de verificar respostas.".into());
            }
            let alvo_msg = mensagem_id
                .as_deref()
                .and_then(|mid| e.mensagens.iter().find(|m| m.id == mid && m.projeto == p.id))
                .or_else(|| {
                    e.mensagens
                        .iter()
                        .rev()
                        .find(|m| m.projeto == p.id && m.canal == canal && m.autor != "voce" && m.estado == "ok")
                })
                .cloned();
            let ultimo_autor = alvo_msg.as_ref().map(|m| m.autor.as_str()).unwrap_or("");
            let ultimo_forn = e
                .agente(ultimo_autor)
                .map(|a| a.fornecedor.as_str())
                .unwrap_or("");
            // Prefere um revisor de outro provedor ou com papel crítico (QA, Cético, Pensador, Mediador).
            let revisor = equipe
                .iter()
                .find(|a| {
                    a.id != ultimo_autor
                        && a.fornecedor != ultimo_forn
                        && matches!(a.funcao.as_str(), "qa_seguranca" | "cetico" | "pensador" | "mediador")
                })
                .or_else(|| equipe.iter().find(|a| a.id != ultimo_autor && a.fornecedor != ultimo_forn))
                .or_else(|| equipe.iter().find(|a| a.id != ultimo_autor))
                .or_else(|| equipe.first())
                .cloned()
                .ok_or("Nenhum modelo disponível para verificação.")?;

            let pedido = if let Some(msg) = &alvo_msg {
                let autor_nome = e
                    .agente(&msg.autor)
                    .map_or(msg.autor.as_str(), |a| a.nome.as_str());
                format!(
                    "Audite e verifique criticamente a resposta de **{autor_nome}** e as ideias recentes desta conversa:\n\n> {}\n\nEstruture sua verificação em:\n1. **O que está sólido/correto**\n2. **Falhas, lacunas ou riscos encontrados**\n3. **Melhoria ou correção recomendada**",
                    resumir_corpo(&msg.texto, 1200).replace('\n', "\n> ")
                )
            } else {
                "Revise e verifique criticamente todas as respostas e ideias recentes desta conversa, apontando acertos, riscos/falhas e próximos passos práticos.".into()
            };

            let mid = e.novo_id("m");
            e.mensagens.push(Mensagem {
                id: mid,
                projeto: p.id.clone(),
                canal: canal.clone(),
                autor: "voce".into(),
                texto: format!("🔍 Solicitando verificação das ideias por **{}**…", revisor.nome),
                em: agora(),
                estado: "ok".into(),
            });
            let ex = agendar(e, &p, &canal, revisor, &memoria, Some(pedido), None);
            e.podar_mensagens(&p.id);
            Ok(ex)
        })
        .await?;
    tokio::spawn(rodar(est, ex));
    Ok(())
}

pub(super) async fn avaliar_com_mediador(
    state: &WebState,
    est: Arc<Estacao>,
    projeto: String,
    canal: String,
    mensagem_id: Option<String>,
) -> Result<(), String> {
    let memoria = Arc::new(memoria_do_projeto(state, &est, &projeto).await);
    let ex = est
        .mudar(|e| {
            let p = e.projeto(&projeto).cloned().ok_or("Projeto inexistente.")?;
            let equipe = equipe_do_projeto(e, &p);
            let med = equipe
                .iter()
                .find(|a| a.funcao == "mediador")
                .or_else(|| equipe.iter().find(|a| a.funcao == "pensador"))
                .cloned()
                .ok_or("Adicione um agente Mediador para gerar a pontuação interna.")?;
            let alvo_nomes: Vec<String> = if let Some(mid) = &mensagem_id
                && let Some(msg) = e
                    .mensagens
                    .iter()
                    .find(|m| m.id == *mid && m.projeto == p.id)
                && let Some(ag) = e.agente(&msg.autor)
            {
                vec![ag.nome.clone()]
            } else {
                let falantes: Vec<String> = falantes_recentes_do_canal(e, &p.id, &canal, None)
                    .into_iter()
                    .filter(|a| a.id != med.id)
                    .map(|a| a.nome)
                    .collect();
                if falantes.is_empty() {
                    equipe
                        .iter()
                        .filter(|a| a.id != med.id)
                        .map(|a| a.nome.clone())
                        .collect()
                } else {
                    falantes
                }
            };
            let pedido = pedido_avaliacao_mediador(&alvo_nomes);
            let mut ex = agendar(e, &p, &canal, med, &memoria, Some(pedido), None);
            ex.eh_avaliacao = true;
            e.podar_mensagens(&p.id);
            Ok(ex)
        })
        .await?;
    tokio::spawn(rodar(est, ex));
    Ok(())
}

pub(super) async fn iniciar_debate(
    state: &WebState,
    est: Arc<Estacao>,
    projeto: String,
    tema: String,
    participantes: Vec<String>,
    rodadas: usize,
) -> Result<(), String> {
    let tema = tema.trim().to_owned();
    if tema.is_empty() {
        return Err("Informe o tema do debate.".into());
    }
    if participantes.len() < 2 {
        return Err("Escolha pelo menos dois participantes.".into());
    }
    let rodadas = rodadas.clamp(1, MAX_RODADAS_DEBATE);
    let memoria = Arc::new(memoria_do_projeto(state, &est, &projeto).await);
    let ex = est
        .mudar(|e| {
            let p = e.projeto(&projeto).cloned().ok_or("Projeto inexistente.")?;
            let equipe = equipe_do_projeto(e, &p);
            if participantes
                .iter()
                .any(|id| !equipe.iter().any(|a| &a.id == id))
            {
                return Err("Todos os participantes precisam estar no projeto.".into());
            }
            let nomes: Vec<&str> = participantes
                .iter()
                .filter_map(|id| equipe.iter().find(|a| &a.id == id).map(|a| a.nome.as_str()))
                .collect();
            let id = e.novo_id("m");
            e.mensagens.push(Mensagem {
                id,
                projeto: projeto.clone(),
                canal: "geral".into(),
                autor: "voce".into(),
                texto: format!(
                    "🗣️ **Debate iniciado:** {tema}\nParticipantes: {} · {rodadas} rodada(s)",
                    nomes.join(", ")
                ),
                em: agora(),
                estado: "ok".into(),
            });
            let primeiro = e
                .agente(&participantes[0])
                .cloned()
                .ok_or("Modelo inexistente.")?;
            let proximo_nome = participantes
                .get(1)
                .and_then(|id| equipe.iter().find(|a| &a.id == id).map(|a| a.nome.as_str()));
            let d = Debate {
                tema: tema.clone(),
                restantes: rodadas * participantes.len() - 1,
                ordem: participantes.clone(),
            };
            let pedido = pedido_debate_turno(&d, None, proximo_nome, d.restantes == 0);
            let ex = agendar(e, &p, "geral", primeiro, &memoria, Some(pedido), Some(d));
            e.podar_mensagens(&projeto);
            Ok(ex)
        })
        .await?;
    tokio::spawn(rodar(est, ex));
    Ok(())
}

pub(super) async fn executar_tarefa(
    state: &WebState,
    est: Arc<Estacao>,
    tarefa: String,
) -> Result<(), String> {
    let projeto = {
        let e = est.estado.lock().await;
        e.tarefas
            .iter()
            .find(|t| t.id == tarefa)
            .map(|t| t.projeto.clone())
            .ok_or("Tarefa inexistente.")?
    };
    let memoria = Arc::new(memoria_do_projeto(state, &est, &projeto).await);
    let ex = est
        .mudar(|e| {
            let t = e
                .tarefas
                .iter()
                .find(|t| t.id == tarefa)
                .cloned()
                .ok_or("Tarefa inexistente.")?;
            if t.status == "executando" {
                return Err("A tarefa já está em execução.".into());
            }
            let agente_id = t
                .agente
                .clone()
                .ok_or("Arraste um modelo para a tarefa antes.")?;
            let agente = e.agente(&agente_id).cloned().ok_or("Modelo inexistente.")?;
            let p = e
                .projeto(&t.projeto)
                .cloned()
                .ok_or("Projeto inexistente.")?;
            if !agente_online_no_projeto(e, &p, &agente) {
                return Err(format!(
                    "{} está hibernando (zzz) porque seu operador está offline nesta sala.",
                    agente.nome
                ));
            }
            let canal_interno = format!("tarefa:{tarefa}");
            let prompt = montar_prompt(e, &p, &agente, "geral", &memoria, Some(&t), None);
            let id = e.novo_id("m");
            e.mensagens.push(Mensagem {
                id: id.clone(),
                projeto: p.id.clone(),
                canal: canal_interno.clone(),
                autor: agente.id.clone(),
                texto: format!("Iniciando a tarefa \"{}\"…", t.titulo),
                em: agora(),
                estado: "pensando".into(),
            });
            if let Some(tt) = e.tarefas.iter_mut().find(|x| x.id == tarefa) {
                tt.status = "executando".into();
                tt.progresso = format!("{} está executando esta tarefa…", agente.nome);
                tt.atualizado = agora();
            }
            e.podar_mensagens(&p.id);
            Ok(Execucao {
                agente,
                pasta: p.pasta,
                prompt,
                mensagem: id,
                canal: canal_interno,
                tarefa: Some(tarefa.clone()),
                memoria,
                trabalho: None,
                debate: None,
                eh_avaliacao: false,
            }
            .com_trabalho(Trabalho {
                objetivo: format!("{}\n{}", t.titulo, t.descricao),
                etapa: "Execute a tarefa do quadro.".into(),
                corrigir_formato: false,
                coordenador: None,
            }))
        })
        .await?;
    tokio::spawn(rodar(est, ex));
    Ok(())
}

/// `rodar` agenda as próximas falas; a caixa quebra o tipo recursivo do future.
fn rodar_em_caixa(
    est: Arc<Estacao>,
    ex: Execucao,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> {
    Box::pin(rodar(est, ex))
}

async fn rodar(est: Arc<Estacao>, ex: Execucao) {
    let inicio = std::time::Instant::now();
    let projeto = {
        let e = est.estado.lock().await;
        let Some(mensagem) = e.mensagens.iter().find(|m| m.id == ex.mensagem) else {
            return;
        };
        mensagem.projeto.clone()
    };
    let resultado = executar_comando(
        &ex.agente,
        &ex.pasta,
        &ex.prompt,
        Some((&ex.mensagem, &projeto)),
        ex.trabalho.is_none().then_some(TEMPO_MAXIMO),
    )
    .await;
    let uso_medido = resultado.as_ref().ok().and_then(|s| s.uso);

    let segundos = inicio.elapsed().as_secs();
    let seguintes = est
        .mudar(|e| {
            let parada = paradas().lock().is_ok_and(|mut p| p.remove(&ex.mensagem));
            let (mut texto, ok) = match resultado {
                _ if parada => ("■ Parado pelo operador.".to_owned(), false),
                Ok(s) => (s.texto, true),
                Err(s) => (s, false),
            };
            if ok && ex.trabalho.is_none() && ex.agente.funcao == "mediador" {
                registrar_avaliacoes_mediador(
                    e,
                    &projeto,
                    &ex.mensagem,
                    &mut texto,
                    ex.eh_avaliacao,
                );
            }
            let resposta = texto.clone();
            if let Some(m) = e.mensagem_mut(&ex.mensagem) {
                m.texto = if texto.trim().is_empty() {
                    "(sem resposta)".into()
                } else {
                    texto
                };
                m.estado = if ok { "ok" } else { "erro" }.into();
                m.em = agora();
            }
            let mut fila = Vec::new();
            let mut concluido = ok;
            if ok && let Some(p) = e.projeto(&projeto).cloned() {
                if let Some(trabalho) = &ex.trabalho {
                    match continuar_trabalho(e, &p, &ex, trabalho, &resposta) {
                        Ok(prox) => fila.extend(prox),
                        Err(motivo) => {
                            concluido = false;
                            if let Some(m) = e.mensagem_mut(&ex.mensagem) {
                                m.estado = "erro".into();
                                m.texto.push_str(&format!("\n\n{motivo}"));
                            }
                        }
                    }
                } else {
                    fila = proximos(e, &p, &ex);
                }
                e.podar_mensagens(&p.id);
            }
            if let Some(id) = &ex.tarefa
                && let Some(t) = e.tarefas.iter_mut().find(|t| &t.id == id)
            {
                let ainda_na_mesma_tarefa = fila
                    .iter()
                    .any(|f| f.tarefa.as_deref() == Some(id.as_str()));
                // Parada volta para a fila; falha real fica marcada como erro.
                t.status = if ainda_na_mesma_tarefa {
                    "executando"
                } else if concluido {
                    "concluida"
                } else if parada {
                    "a_fazer"
                } else {
                    "erro"
                }
                .into();
                let resumo_exec = resumir_corpo(&resposta, 220);
                t.progresso = if ainda_na_mesma_tarefa {
                    format!("Em andamento: {resumo_exec}")
                } else if concluido {
                    format!("Concluído por {}: {resumo_exec}", ex.agente.nome)
                } else if parada {
                    "Interrompida pelo operador.".into()
                } else {
                    format!("Erro: {resumo_exec}")
                };
                t.resultado = resumir_corpo(&resposta, 1800);
                t.atualizado = agora();
            }
            if let Some(a) = e.agentes.iter_mut().find(|a| a.id == ex.agente.id) {
                a.execucoes += 1;
                a.segundos += segundos;
                if let Some((entrada, saida)) = uso_medido {
                    let agora_s = agora();
                    a.uso.retain(|u| u.em > agora_s - 8 * 86_400);
                    a.uso.push(UsoExecucao {
                        em: agora_s,
                        entrada,
                        saida,
                    });
                }
            }
            Ok(fila)
        })
        .await
        .unwrap_or_else(|erro| {
            tracing::error!(%erro, "Falha ao gravar o resultado da execução");
            Vec::new()
        });
    for prox in seguintes {
        tokio::spawn(rodar_em_caixa(est.clone(), prox));
    }
}
