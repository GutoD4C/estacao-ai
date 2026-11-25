use std::collections::HashSet;

#[test]
fn modelo_001_le_estado_anterior_sem_perder_projetos_e_mensagens() {
    let antigo = serde_json::json!({
        "projetos": [{"id": "p1", "nome": "Projeto existente"}],
        "mensagens": [{"id": "m1", "projeto": "p1", "texto": "Histórico existente",
            "canal": "geral", "autor": "voce", "em": 1, "estado": "ok"}],
        "contexto_global": "Contexto existente", "seq": 42
    });
    let estado: super::estado::Estado = serde_json::from_value(antigo).unwrap();
    assert_eq!(estado.projetos[0].nome, "Projeto existente");
    assert_eq!(estado.mensagens[0].texto, "Histórico existente");
    assert_eq!(estado.contexto_global, "Contexto existente");
    assert_eq!(estado.seq, 42);
    assert!(!estado.nostr_perfil.autenticado);
}
use std::sync::Arc;
#[cfg(unix)]
use std::time::Duration;

use super::catalogo::{OpcaoModelo, Provedor, aplicar_auto_configuracao, modelos_por_tab};
use super::consumo::{janela_json, modelo_bate};
use super::estado::{
    Agente, Estacao, Estado, MAX_MENSAGENS_POR_PROJETO, Mensagem, NostrPerfil, PAPEIS, Projeto,
    Tarefa, agente_online_no_projeto, grupo_do_agente, limite_agentes_por_pessoa, papel,
};
use super::execucao::{
    Debate, agendar, destinos_chat_geral, detectar_pedido_debate, extrair_delegacoes,
    pedido_debate, proximos, registrar_avaliacoes_mediador,
};
use super::http::Acao;
use super::memoria::{MemoriaPrompt, PaginaMemoria, montar_prompt};
use super::processo::{
    Saida, dividir_tokens_comando, interpretar_saida, limpar_texto_cli, resolver_comando,
};
#[cfg(unix)]
use super::processo::{
    TEMPO_MAXIMO, cli_encontrada, em_andamento, executar_comando, paradas, parar_execucoes,
};
use super::terminal::rodar_terminal;
use super::youtube::extrair_resultados_youtube;

#[test]
fn abrir_libera_execucoes_e_preserva_estado_ilegivel() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("estacao");
    std::fs::create_dir_all(&dir).unwrap();
    let mut e = Estado::default();
    e.tarefas.push(Tarefa {
        status: "executando".into(),
        ..Tarefa::default()
    });
    e.mensagens.push(Mensagem {
        estado: "pensando".into(),
        ..Mensagem::default()
    });
    std::fs::write(dir.join("estado.json"), serde_json::to_vec(&e).unwrap()).unwrap();
    let est = Estacao::abrir(tmp.path());
    let e = est.estado.try_lock().unwrap();
    assert_eq!(e.tarefas[0].status, "erro");
    assert_eq!(e.mensagens[0].estado, "erro");
    drop(e);

    std::fs::write(dir.join("estado.json"), b"{quebrado").unwrap();
    let est = Estacao::abrir(tmp.path());
    assert!(est.estado.try_lock().unwrap().tarefas.is_empty());
    let copias = std::fs::read_dir(&dir)
        .unwrap()
        .filter(|f| {
            f.as_ref()
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with("estado.json.ilegivel-")
        })
        .count();
    assert_eq!(
        copias, 1,
        "o arquivo ilegível deve ser guardado, não perdido"
    );
}

#[tokio::test]
async fn gravar_atomico_sem_sobra_tmp_e_com_permissoes_restritas() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("estacao");
    let est = Estacao::abrir(tmp.path());

    est.mudar(|e| {
        e.contexto_global = "estado inicial".into();
        e.seq = 7;
        Ok(())
    })
    .await
    .unwrap();

    let arquivo = dir.join("estado.json");
    let lido: Estado = serde_json::from_slice(&std::fs::read(&arquivo).unwrap()).unwrap();
    assert_eq!(lido.contexto_global, "estado inicial");
    assert_eq!(lido.seq, 7);

    let sobras_tmp = std::fs::read_dir(&dir)
        .unwrap()
        .filter(|entry| {
            entry
                .as_ref()
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains(".tmp")
        })
        .count();
    assert_eq!(
        sobras_tmp, 0,
        "não deve sobrar arquivo temporário após gravar"
    );

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        let dir_mode = std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777;
        let file_mode = std::fs::metadata(&arquivo).unwrap().permissions().mode() & 0o777;
        assert_eq!(
            dir_mode, 0o700,
            "diretório estacao deve ter permissão 0o700"
        );
        assert_eq!(file_mode, 0o600, "estado.json deve ter permissão 0o600");
    }

    // Nova gravação substitui atomicamente mantendo permissões e sem sobras `.tmp`.
    est.mudar(|e| {
        e.contexto_global = "estado atualizado".into();
        Ok(())
    })
    .await
    .unwrap();
    let atualizado: Estado = serde_json::from_slice(&std::fs::read(&arquivo).unwrap()).unwrap();
    assert_eq!(atualizado.contexto_global, "estado atualizado");
    let sobras_tmp_apos = std::fs::read_dir(&dir)
        .unwrap()
        .filter(|entry| {
            entry
                .as_ref()
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains(".tmp")
        })
        .count();
    assert_eq!(sobras_tmp_apos, 0);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        let file_mode = std::fs::metadata(&arquivo).unwrap().permissions().mode() & 0o777;
        assert_eq!(file_mode, 0o600);
    }

    // Se o rename falhar (destino ocupado por diretório), o temporário deve ser limpo e a memória preservada.
    let falha_tmp = tempfile::tempdir().unwrap();
    let falha_dir = falha_tmp.path().join("estacao");
    std::fs::create_dir_all(falha_dir.join("estado.json")).unwrap();
    let est_falha = Estacao::abrir(falha_tmp.path());
    let err = est_falha
        .mudar(|e| {
            e.contexto_global = "nao deve persistir".into();
            Ok(())
        })
        .await;
    assert!(err.is_err());
    assert!(est_falha.estado.lock().await.contexto_global.is_empty());
    let sobras_falha = std::fs::read_dir(&falha_dir)
        .unwrap()
        .filter(|entry| {
            entry
                .as_ref()
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains(".tmp")
        })
        .count();
    assert_eq!(
        sobras_falha, 0,
        "arquivo temporário deve ser removido quando rename falha"
    );
}

#[test]
fn abrir_estado_corrompido_cria_backup_ilegivel_com_conteudo_original() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("estacao");
    std::fs::create_dir_all(&dir).unwrap();
    let corrompido = b"{json-corrompido-sem-fechamento";
    std::fs::write(dir.join("estado.json"), corrompido).unwrap();

    let est = Estacao::abrir(tmp.path());
    let estado = est.estado.try_lock().unwrap();
    assert!(estado.projetos.is_empty());
    assert_eq!(estado.seq, 0);
    assert!(!dir.join("estado.json").exists());

    let backups: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .filter_map(|entry| {
            let entry = entry.unwrap();
            let nome = entry.file_name().to_string_lossy().into_owned();
            nome.starts_with("estado.json.ilegivel-")
                .then_some(entry.path())
        })
        .collect();
    assert_eq!(backups.len(), 1);
    assert_eq!(std::fs::read(&backups[0]).unwrap(), corrompido);
}

fn ag(id: &str, nome: &str, funcao: &str) -> Agente {
    Agente {
        id: id.into(),
        nome: nome.into(),
        funcao: funcao.into(),
        comando: "cat".into(),
        ..Agente::default()
    }
}

#[test]
fn papeis_tem_ids_unicos_e_grupos_validos() {
    let ids: HashSet<_> = PAPEIS.iter().map(|p| p.id).collect();
    assert_eq!(ids.len(), PAPEIS.len());
    assert!(
        PAPEIS
            .iter()
            .all(|p| p.grupo == "projetos" || p.grupo == "chat")
    );
    for id in [
        "pensador",
        "desenvolvedor",
        "testador",
        "qa_seguranca",
        "documentador",
        "publicador",
        "filosofo",
        "pessoa",
    ] {
        assert!(papel(id).is_some(), "faltou o papel {id}");
    }
}

#[test]
fn chat_geral_vai_ao_pensador_salvo_mencao() {
    let pz = ag("a1", "Pensador", "pensador");
    let dev = ag("a2", "Dev", "desenvolvedor");
    let qa = ag("a3", "QA", "qa_seguranca");
    let proj = Projeto::default();
    let com = vec![pz.clone(), dev.clone(), qa.clone()];
    let ids = |v: Vec<Agente>| v.into_iter().map(|a| a.id).collect::<Vec<_>>();
    // Em Projetos com Pensador, APENAS o Pensador responde no chat e delega tarefas aos demais.
    assert_eq!(
        ids(destinos_chat_geral(&proj, &com, "como estruturar o login?")),
        ["a1"]
    );
    assert_eq!(
        ids(destinos_chat_geral(&proj, &com, "@Dev corrige o botão")),
        ["a1"]
    );
    // Sem Pensador: todos (ou citados).
    let sem = vec![dev.clone(), qa.clone()];
    assert_eq!(ids(destinos_chat_geral(&proj, &sem, "oi")), ["a2", "a3"]);
    assert_eq!(ids(destinos_chat_geral(&proj, &sem, "@QA revisa")), ["a3"]);
    // Sessão da aba Chat (`eh_chat: true`): sem @menção vai para todos os modelos da conversa.
    let sessao_chat = Projeto {
        eh_chat: true,
        ..Projeto::default()
    };
    assert_eq!(
        ids(destinos_chat_geral(
            &sessao_chat,
            &com,
            "vamos conversar sobre arquitetura"
        )),
        ["a1", "a2", "a3"]
    );
    assert_eq!(
        ids(destinos_chat_geral(&sessao_chat, &com, "@Dev o que acha?")),
        ["a2"]
    );

    // Delegações extraídas da resposta do Pensador viram tarefas para a equipe.
    let dels = extrair_delegacoes(
        &com,
        "a1",
        "Vou dividir em duas frentes:\n- @Dev: Criar endpoint de login\n@QA: Validar segurança do token",
    );
    assert_eq!(dels.len(), 2);
    assert_eq!(dels[0].0.id, "a2");
    assert_eq!(dels[0].1, "Criar endpoint de login");
    assert_eq!(dels[1].0.id, "a3");
    assert_eq!(dels[1].1, "Validar segurança do token");
}

#[test]
fn cotas_por_pessoa_e_hibernacao() {
    let meu = "npub1meupessoal000000000000000000000000000000000000000000000";
    let amigo1 = "npub1amigo0001000000000000000000000000000000000000000000000";
    let amigo2 = "npub1amigo0002000000000000000000000000000000000000000000000";

    let pessoal = Projeto {
        id: "p1".into(),
        dono_npub: meu.into(),
        compartilhado: false,
        ..Projeto::default()
    };
    assert_eq!(limite_agentes_por_pessoa(&pessoal, meu), 6);

    let comp2 = Projeto {
        id: "p2".into(),
        dono_npub: meu.into(),
        compartilhado: true,
        membros_npub: vec![amigo1.into()],
        ..Projeto::default()
    };
    assert_eq!(limite_agentes_por_pessoa(&comp2, meu), 4);

    let comp3 = Projeto {
        id: "p3".into(),
        dono_npub: meu.into(),
        compartilhado: true,
        membros_npub: vec![amigo1.into(), amigo2.into()],
        ..Projeto::default()
    };
    assert_eq!(limite_agentes_por_pessoa(&comp3, meu), 2);

    // Hibernação: agente de dono offline fica inativo na sala compartilhada.
    let mut e = Estado {
        nostr_perfil: NostrPerfil {
            npub: meu.into(),
            autenticado: true,
            ..NostrPerfil::default()
        },
        ..Estado::default()
    };
    e.presenca_salas.insert("p2".into(), vec![meu.into()]);
    let meu_ag = Agente {
        dono_npub: meu.into(),
        ..ag("a1", "Meu Agente", "pensador")
    };
    let amigo_ag = Agente {
        dono_npub: amigo1.into(),
        ..ag("a2", "Agente Amigo", "desenvolvedor")
    };
    assert!(agente_online_no_projeto(&e, &comp2, &meu_ag));
    assert!(!agente_online_no_projeto(&e, &comp2, &amigo_ag));

    // Mesmo se a presença da sala tiver apenas o outro participante ou estiver vazia,
    // os agentes do operador local (com meu npub ou sem dono_npub) continuam prontos.
    let meu_sem_dono = ag("a3", "Local Sem Dono", "desenvolvedor");
    e.presenca_salas.insert("p2".into(), vec![amigo2.into()]);
    assert!(agente_online_no_projeto(&e, &comp2, &meu_ag));
    assert!(agente_online_no_projeto(&e, &comp2, &meu_sem_dono));
    assert!(!agente_online_no_projeto(&e, &comp2, &amigo_ag));

    e.presenca_salas.remove("p2");
    assert!(agente_online_no_projeto(&e, &comp2, &meu_ag));
    assert!(!agente_online_no_projeto(&e, &comp2, &amigo_ag));

    // Quando o amigo entra online na sala, o agente dele acorda!
    e.presenca_salas
        .insert("p2".into(), vec![meu.into(), amigo1.into()]);
    assert!(agente_online_no_projeto(&e, &comp2, &amigo_ag));
}

fn cenario() -> (Estado, Projeto, Arc<MemoriaPrompt>) {
    let mut e = Estado {
        agentes: vec![
            ag("a1", "Pensador", "pensador"),
            ag("a2", "Dev", "desenvolvedor"),
            ag("a3", "Cético", "cetico"),
            ag("a4", "Otimista", "otimista"),
        ],
        ..Estado::default()
    };
    let p = Projeto {
        id: "p1".into(),
        nome: "Site".into(),
        agentes: vec!["a1".into(), "a2".into(), "a3".into(), "a4".into()],
        ..Projeto::default()
    };
    e.projetos.push(p.clone());
    (e, p, Arc::new(MemoriaPrompt::default()))
}

#[test]
fn debate_alterna_participantes_e_termina() {
    let (mut e, p, mem) = cenario();
    let d = Debate {
        tema: "IA no trabalho".into(),
        ordem: vec!["a3".into(), "a4".into()],
        restantes: 2,
    };
    let cet = e.agente("a3").cloned().unwrap();
    let ex = agendar(
        &mut e,
        &p,
        "geral",
        cet,
        &mem,
        Some(pedido_debate(&d)),
        Some(d),
    );
    assert!(
        ex.prompt.contains("Como você age"),
        "papel de chat usa prompt leve"
    );
    assert!(!ex.prompt.contains("Quadro de tarefas"));
    let f1 = proximos(&mut e, &p, &ex);
    assert_eq!(f1[0].agente.id, "a4");
    let f2 = proximos(&mut e, &p, &f1[0]);
    assert_eq!(f2[0].agente.id, "a3");
    assert!(proximos(&mut e, &p, &f2[0]).is_empty());
}

#[cfg(unix)]
#[tokio::test]
async fn terminal_roda_comando_e_resolve_cd() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("sub")).unwrap();
    let base = dir.path().display().to_string();
    let r = rodar_terminal(&base, "echo oi; echo erro 1>&2; exit 3")
        .await
        .unwrap();
    assert_eq!(r.codigo, Some(3));
    assert!(r.saida.contains("oi") && r.saida.contains("erro"));
    let r = rodar_terminal(&base, "cd sub").await.unwrap();
    assert!(r.pasta.ends_with("sub"), "{r:?}");
    let r = rodar_terminal(&r.pasta, "pwd").await.unwrap();
    assert!(r.saida.trim().ends_with("sub"));
    let r = rodar_terminal(&base, "cd nao-existe").await.unwrap();
    assert_eq!(r.codigo, Some(1));
    assert_eq!(r.pasta, base);
    assert!(rodar_terminal(&base, "  ").await.is_err());
}

#[tokio::test]
async fn terminal_nao_intercepta_cd_composto() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("sub")).unwrap();
    let base = dir.path().display().to_string();
    let r = rodar_terminal(&base, "cd sub").await.unwrap();
    assert_eq!(r.codigo, Some(0));
    assert!(r.pasta.ends_with("sub"), "{r:?}");

    let cmd_composto = if cfg!(windows) {
        "cd sub; Write-Output ok-composto"
    } else {
        "cd sub && echo ok-composto"
    };
    let r = rodar_terminal(&base, cmd_composto).await.unwrap();
    assert_eq!(r.codigo, Some(0), "{r:?}");
    assert!(r.saida.contains("ok-composto"), "{r:?}");
}

#[cfg(unix)]
#[test]
fn cli_encontrada_resolve_path_e_caminho() {
    assert!(cli_encontrada("sh -c 'echo'"));
    assert!(!cli_encontrada("cli-que-nao-existe-xyz -p"));
    assert!(!cli_encontrada(""));
    assert!(cli_encontrada("/bin/sh"));
}

#[test]
fn dividir_tokens_e_debate_automatico_funcionam() {
    let tokens =
        dividir_tokens_comando(r#"agy --model gemini-4 --output-format json -p "$(cat)""#).unwrap();
    assert_eq!(
        tokens,
        [
            "agy",
            "--model",
            "gemini-4",
            "--output-format",
            "json",
            "-p",
            "$(cat)"
        ]
    );
    assert!(dividir_tokens_comando("echo a | grep a").is_none());

    assert_eq!(
        detectar_pedido_debate("debate: Rust vs Go para serviços")
            .unwrap()
            .0,
        "Rust vs Go para serviços"
    );
    assert!(detectar_pedido_debate("vamos debater sobre arquitetura").is_some());
    assert!(detectar_pedido_debate("como faço um commit?").is_none());
}

#[test]
fn auto_configurar_por_grupo_separa_projetos_e_chat() {
    let a_sem: Acao = serde_json::from_str(r#"{"tipo":"auto_configurar"}"#).unwrap();
    assert!(matches!(a_sem, Acao::AutoConfigurar { grupo: None, .. }));
    let a_proj: Acao =
        serde_json::from_str(r#"{"tipo":"auto_configurar","grupo":"projetos"}"#).unwrap();
    assert!(matches!(
        a_proj,
        Acao::AutoConfigurar { grupo: Some(ref g), .. } if g == "projetos"
    ));

    let instalados = vec![
        Provedor {
            fornecedor: "codex",
            rotulo: "Codex",
            cli: "codex",
            instalado: true,
            login: None,
            comando: "codex exec -",
            modelos: vec![
                OpcaoModelo {
                    id: "gpt-6.1-sol".into(),
                    nome: "GPT-6.1-Sol".into(),
                },
                OpcaoModelo {
                    id: "gpt-6-luna".into(),
                    nome: "GPT-6-Luna".into(),
                },
            ],
            consumo: "",
            dica: String::new(),
        },
        Provedor {
            fornecedor: "antigravity-cli",
            rotulo: "Antigravity",
            cli: "agy",
            instalado: true,
            login: None,
            comando: "agy -p",
            modelos: vec![OpcaoModelo {
                id: "gemini-4-argon-medium".into(),
                nome: "Gemini 4 Argon".into(),
            }],
            consumo: "",
            dica: String::new(),
        },
    ];

    // 1. AutoConfigurar apenas "projetos": não cria agentes de chat nem "Conversa Rápida".
    let mut est = Estado::default();
    let ret = aplicar_auto_configuracao(&mut est, &instalados, Some("projetos"), None);
    assert!(ret.is_none());
    assert!(est.projetos.is_empty());
    assert!(est.agentes.iter().all(|a| grupo_do_agente(a) == "projetos"));
    assert!(est.agentes.iter().any(|a| a.funcao == "desenvolvedor"));
    assert!(!est.agentes.iter().any(|a| a.funcao == "mediador"));

    // 2. AutoConfigurar "chat": cria papéis de chat e coloca apenas eles em "Conversa Rápida".
    let chat_id = aplicar_auto_configuracao(&mut est, &instalados, Some("chat"), None).unwrap();
    let codex_chat = est
        .agentes
        .iter()
        .find(|a| a.fornecedor == "codex" && grupo_do_agente(a) == "chat")
        .unwrap();
    assert_eq!(codex_chat.modelo, "gpt-6-luna");
    assert!(codex_chat.comando.contains("model_reasoning_effort=low"));
    assert!(
        est.agentes
            .iter()
            .filter(|a| a.fornecedor == "codex" && grupo_do_agente(a) == "projetos")
            .all(|a| a.modelo == "gpt-6.1-sol" && a.comando == "codex exec -")
    );
    assert!(est.agentes.iter().any(|a| a.funcao == "mediador"));
    let chat = est.projeto(&chat_id).unwrap();
    assert!(chat.eh_chat);
    assert!(!chat.agentes.is_empty());
    assert!(
        chat.agentes
            .iter()
            .all(|id| { est.agente(id).is_some_and(|a| grupo_do_agente(a) == "chat") })
    );
}

#[test]
fn pontuacao_mediador_e_youtube_parser_funcionam() {
    let mut e = Estado::default();
    e.agentes.push(ag("a1", "Cético", "cetico"));
    e.agentes.push(ag("a2", "Mediador", "mediador"));
    e.projetos.push(Projeto {
        id: "pr1".into(),
        nome: "Júri".into(),
        agentes: vec!["a1".into(), "a2".into()],
        eh_chat: true,
        ..Projeto::default()
    });
    let mut texto = "Boa síntese.\nAVALIACAO_JSON: [{\"agente\":\"Cético\",\"clareza\":9,\"fundamentacao\":8,\"colaboracao\":7,\"pontos_fortes\":\"Boas perguntas\",\"melhorar\":\"Citar exemplos práticos\"}]".to_owned();
    let n = registrar_avaliacoes_mediador(&mut e, "pr1", "m1", &mut texto, true);
    assert_eq!(n, 1);
    assert_eq!(e.avaliacoes.len(), 1);
    assert_eq!(e.avaliacoes[0].agente_id, "a1");
    assert!((e.avaliacoes[0].media - 8.0).abs() < 0.01);
    assert!(!texto.contains("AVALIACAO_JSON"));
    assert!(texto.contains("Pontuação Interna do Mediador"));

    let s = montar_prompt(
        &e,
        &e.projetos[0],
        &e.agentes[0],
        "geral",
        &MemoriaPrompt::default(),
        None,
        None,
    );
    assert!(s.contains("Citar exemplos práticos"));

    let html = r#"<html><script>var ytInitialData = {"contents":{"twoColumnSearchResultsRenderer":{"primaryContents":{"sectionListRenderer":{"contents":[{"itemSectionRenderer":{"contents":[{"videoRenderer":{"videoId":"jfKfPfyJRdk","title":{"runs":[{"text":"lofi hip hop radio"}]},"ownerText":{"runs":[{"text":"Lofi Girl"}]},"lengthText":{"simpleText":"AO VIVO"}}}]}}]}}}}};</script></html>"#;
    let vids = extrair_resultados_youtube(html);
    assert_eq!(vids.len(), 1);
    assert_eq!(vids[0].id, "jfKfPfyJRdk");
    assert_eq!(vids[0].title, "lofi hip hop radio");
}

#[test]
fn janela_aceita_numero_e_data() {
    let v = serde_json::json!({"used_percentage": 42.5, "resets_at": 1_800_000_000});
    assert_eq!(janela_json(Some(&v)), (Some(42.5), Some(1_800_000_000)));
    let v = serde_json::json!({"utilization": 10, "resets_at": "2026-11-16T10:00:00Z"});
    assert_eq!(janela_json(Some(&v)).0, Some(10.0));
    assert!(janela_json(Some(&v)).1.is_some());
}

#[test]
fn chat_geral_respeita_mencoes_e_poda() {
    let mut e = Estado::default();
    for i in 0..(MAX_MENSAGENS_POR_PROJETO + 3) {
        e.mensagens.push(Mensagem {
            id: i.to_string(),
            projeto: "p".into(),
            ..Mensagem::default()
        });
    }
    e.podar_mensagens("p");
    assert_eq!(e.mensagens.len(), MAX_MENSAGENS_POR_PROJETO);
    assert_eq!(e.mensagens[0].id, "3");
}

#[test]
fn prompt_traz_contextos_e_tarefa() {
    let mut e = Estado {
        contexto_global: "Responder em pt-BR".into(),
        ..Estado::default()
    };
    e.agentes.push(Agente {
        id: "ag1".into(),
        nome: "Claude".into(),
        comando: "cat".into(),
        ..Agente::default()
    });
    let p = Projeto {
        id: "pr1".into(),
        nome: "Site".into(),
        agentes: vec!["ag1".into()],
        memoria: "ws/site".into(),
        contexto: "Usa Rust".into(),
        ..Projeto::default()
    };
    let t = Tarefa {
        titulo: "Criar página".into(),
        ..Tarefa::default()
    };
    let mem = MemoriaPrompt {
        globais: vec![PaginaMemoria {
            path: "_rules/estilo.md".into(),
            title: "Regra global".into(),
            resumo: "Sem duplicar lógica.".into(),
            ..PaginaMemoria::default()
        }],
        projeto: vec![PaginaMemoria {
            path: "decisions/arquitetura.md".into(),
            title: "Arquitetura".into(),
            resumo: "Axum + Askama".into(),
            ..PaginaMemoria::default()
        }],
    };
    let s = montar_prompt(&e, &p, &e.agentes[0], "geral", &mem, Some(&t), None);
    for trecho in [
        "Responder em pt-BR",
        "Usa Rust",
        "workspace=\"ws\"",
        "Criar página",
        "Sem duplicar lógica.",
        "Axum + Askama",
    ] {
        assert!(s.contains(trecho), "faltou {trecho}");
    }
}

#[test]
fn resolver_comando_lida_com_modelo_vazio_e_preenchido() {
    assert_eq!(
        resolver_comando("claude -p --model {modelo}", ""),
        "claude -p"
    );
    assert_eq!(
        resolver_comando("codex exec --skip-git-repo-check -m {modelo} -", "  "),
        "codex exec --skip-git-repo-check -"
    );
    assert_eq!(
        resolver_comando("claude -p --model {modelo}", "claude-sonnet-4-5"),
        "claude -p --model claude-sonnet-4-5"
    );
}

#[test]
fn modelo_bate_compara_apelidos_e_ids() {
    assert!(modelo_bate("opus", "claude-opus-5-5"));
    assert!(modelo_bate("claude-opus-5-5", "claude-opus-5-5"));
    assert!(!modelo_bate("sonnet", "claude-opus-5-5"));
    assert!(!modelo_bate("sonnet", ""));
    assert!(modelo_bate("", "qualquer"));
}

#[cfg(unix)]
#[tokio::test]
async fn comando_recebe_prompt_e_reporta_erro() {
    let a = Agente {
        comando: "cat".into(),
        ..Agente::default()
    };
    assert_eq!(
        executar_comando(&a, "", "olá", None, Some(TEMPO_MAXIMO))
            .await
            .unwrap()
            .texto,
        "olá"
    );
    let a = Agente {
        comando: "echo falhou >&2; exit 3".into(),
        ..Agente::default()
    };
    assert!(
        executar_comando(&a, "", "", None, Some(TEMPO_MAXIMO))
            .await
            .unwrap_err()
            .contains("falhou")
    );
}

#[test]
fn agy_models_vira_lista() {
    let t = "Fetching available models...\ngemini-4-argon-medium\tGemini 4 Argon (Medium)\nclaude-opus-5-5-low\tClaude Opus 5.5 (Low)\n";
    let m = modelos_por_tab(t);
    assert_eq!(m.len(), 2);
    assert_eq!(m[0].id, "gemini-4-argon-medium");
    assert_eq!(m[1].nome, "Claude Opus 5.5 (Low)");
}

#[test]
fn saida_json_das_clis_vira_texto_e_tokens() {
    let claude = r#"{"type":"result","is_error":false,"result":"Oi!","usage":{"input_tokens":10,"cache_creation_input_tokens":5,"output_tokens":3}}"#;
    assert_eq!(
        interpretar_saida(claude),
        Saida {
            texto: "Oi!".into(),
            uso: Some((15, 3))
        }
    );
    let agy = r#"{"status":"SUCCESS","response":"OK\n","usage":{"input_tokens":12038,"output_tokens":32,"thinking_tokens":27}}"#;
    assert_eq!(
        interpretar_saida(agy),
        Saida {
            texto: "OK".into(),
            uso: Some((12038, 59))
        }
    );
    assert_eq!(interpretar_saida("texto simples").texto, "texto simples");
    assert_eq!(interpretar_saida(r#"{"x":1}"#).uso, None);
}

#[cfg(unix)]
#[tokio::test]
async fn parar_mata_o_grupo_inteiro_incluindo_o_neto() {
    let tmp = tempfile::tempdir().unwrap();
    let pidf = tmp.path().join("neto.pid");
    let a = Agente {
        id: "ag-parar".into(),
        comando: format!("sleep 30 & echo $! > '{}'; wait", pidf.display()),
        ..Agente::default()
    };
    let exec = tokio::spawn(async move {
        executar_comando(&a, "", "", Some(("m-parar", "pr-parar")), None).await
    });
    let mut neto = 0u32;
    for _ in 0..100 {
        if let Some(p) = std::fs::read_to_string(&pidf)
            .ok()
            .and_then(|t| t.trim().parse().ok())
        {
            neto = p;
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(neto > 0, "o neto não iniciou");
    assert_eq!(
        parar_execucoes(|proj, ag| proj == "pr-parar" && ag == "ag-parar"),
        1
    );
    let fim = tokio::time::timeout(Duration::from_secs(5), exec).await;
    assert!(fim.is_ok(), "a execução não terminou depois de parar");
    tokio::time::sleep(Duration::from_millis(200)).await;
    let vivo = std::process::Command::new("kill")
        .args(["-0", &neto.to_string()])
        .status()
        .is_ok_and(|s| s.success())
        && !std::fs::read_to_string(format!("/proc/{neto}/stat"))
            .ok()
            .and_then(|s| s.rsplit_once(") ").map(|(_, rest)| rest.starts_with('Z')))
            .unwrap_or(false);
    assert!(!vivo, "o processo neto continuou rodando");
    assert!(em_andamento().lock().unwrap().get("m-parar").is_none());
    paradas().lock().unwrap().remove("m-parar");
}

#[test]
fn limpar_texto_cli_remove_ansi_e_preserva_acentuacao() {
    let bruta = "\x1b[1;32mOlá!\x1b[0m\r\nSou o **Pensador** — ação & revisão.\r\n\x1b]0;titulo\x07Linha 1\rLinha final";
    let limpa = limpar_texto_cli(bruta);
    assert_eq!(
        limpa,
        "Olá!\nSou o **Pensador** — ação & revisão.\nLinha final"
    );
}

#[test]
fn limpar_referencias_orfas_remove_avaliacoes_e_presenca_de_projetos_excluidos() {
    let mut e = Estado::default();
    e.projetos.push(Projeto {
        id: "pr-ativo".into(),
        nome: "Ativo".into(),
        ..Projeto::default()
    });
    e.avaliacoes.push(super::estado::AvaliacaoAgente {
        id: "av1".into(),
        projeto: "pr-ativo".into(),
        mensagem_id: "m1".into(),
        agente_id: "ag1".into(),
        agente_nome: "Cético".into(),
        nota_clareza: 8,
        nota_fundamentacao: 8,
        nota_colaboracao: 8,
        media: 8.0,
        pontos_fortes: String::new(),
        melhorar: String::new(),
        em: 1,
    });
    e.avaliacoes.push(super::estado::AvaliacaoAgente {
        id: "av-orfa".into(),
        projeto: "pr-removido".into(),
        mensagem_id: "m2".into(),
        agente_id: "ag1".into(),
        agente_nome: "Cético".into(),
        nota_clareza: 7,
        nota_fundamentacao: 7,
        nota_colaboracao: 7,
        media: 7.0,
        pontos_fortes: String::new(),
        melhorar: String::new(),
        em: 2,
    });
    e.presenca_salas
        .insert("pr-ativo".into(), vec!["npub1ativo".into()]);
    e.presenca_salas
        .insert("pr-removido".into(), vec!["npub1orfao".into()]);

    e.limpar_referencias_orfas();

    assert_eq!(e.avaliacoes.len(), 1);
    assert_eq!(e.avaliacoes[0].id, "av1");
    assert_eq!(e.presenca_salas.len(), 1);
    assert!(e.presenca_salas.contains_key("pr-ativo"));
    assert!(!e.presenca_salas.contains_key("pr-removido"));
}

#[test]
fn mediador_aguarda_todos_falantes_e_pontua_todos() {
    let a1 = ag("a1", "Filósofo", "filosofo");
    let a2 = ag("a2", "Cético", "cetico");
    let a3 = ag("a3", "Pragmático", "pragmatico");
    let med = ag("a4", "Mediador", "mediador");
    let sala = Projeto {
        id: "ch1".into(),
        nome: "Roda de ideias".into(),
        agentes: vec!["a1".into(), "a2".into(), "a3".into(), "a4".into()],
        eh_chat: true,
        ..Projeto::default()
    };
    let equipe = vec![a1.clone(), a2.clone(), a3.clone(), med.clone()];

    // 1. Sem @Mediador, os 3 falantes respondem primeiro; o Mediador aguarda.
    let dest = destinos_chat_geral(&sala, &equipe, "Como melhorar o projeto?");
    let dest_ids: Vec<_> = dest.iter().map(|a| a.id.as_str()).collect();
    assert_eq!(dest_ids, ["a1", "a2", "a3"]);

    let mut e = Estado {
        agentes: equipe,
        projetos: vec![sala.clone()],
        mensagens: vec![
            Mensagem {
                id: "m0".into(),
                projeto: "ch1".into(),
                canal: "geral".into(),
                autor: "voce".into(),
                texto: "Como melhorar o projeto?".into(),
                em: 1,
                estado: "ok".into(),
            },
            Mensagem {
                id: "m1".into(),
                projeto: "ch1".into(),
                canal: "geral".into(),
                autor: "a1".into(),
                texto: "Pensando no propósito central.".into(),
                em: 2,
                estado: "ok".into(),
            },
            Mensagem {
                id: "m2".into(),
                projeto: "ch1".into(),
                canal: "geral".into(),
                autor: "a2".into(),
                texto: String::new(),
                em: 3,
                estado: "pensando".into(),
            },
            Mensagem {
                id: "m3".into(),
                projeto: "ch1".into(),
                canal: "geral".into(),
                autor: "a3".into(),
                texto: String::new(),
                em: 4,
                estado: "pensando".into(),
            },
        ],
        seq: 100,
        ..Estado::default()
    };

    let mem = Arc::new(MemoriaPrompt::default());
    let ex1 = agendar(&mut e, &sala, "geral", a1.clone(), &mem, None, None);
    // Ainda há outros falantes "pensando": Mediador NÃO deve ser disparado prematuramente.
    let p1 = proximos(&mut e, &sala, &ex1);
    assert!(p1.is_empty(), "Mediador não deve disparar antes dos outros terminarem");

    // Todos os 3 falantes concluem suas respostas.
    e.mensagens.retain(|m| m.id != ex1.mensagem);
    for m in &mut e.mensagens {
        if m.id == "m2" {
            m.texto = "Precisamos checar os riscos.".into();
            m.estado = "ok".into();
        } else if m.id == "m3" {
            m.texto = "Vamos priorizar entregas curtas.".into();
            m.estado = "ok".into();
        }
    }
    let mut ex3 = agendar(&mut e, &sala, "geral", a3.clone(), &mem, None, None);
    e.mensagens.retain(|m| m.id != ex3.mensagem);
    ex3.mensagem = "m3".into();

    let p3 = proximos(&mut e, &sala, &ex3);
    assert_eq!(p3.len(), 1, "Mediador deve disparar quando o último falante termina");
    assert_eq!(p3[0].agente.id, "a4");
    assert!(p3[0].prompt.contains("Filósofo"));
    assert!(p3[0].prompt.contains("Cético"));
    assert!(p3[0].prompt.contains("Pragmático"));

    // Mesmo se o modelo retornar JSON só para 1 dos 3, todos os 3 recebem nota!
    let mut resp_parcial = "Boa discussão!\nAVALIACAO_JSON: [{\"agente\":\"Filósofo\",\"clareza\":9,\"fundamentacao\":8,\"colaboracao\":9,\"pontos_fortes\":\"Claro\",\"melhorar\":\"Dar exemplo\"}]".to_owned();
    let qtd = registrar_avaliacoes_mediador(&mut e, "ch1", &p3[0].mensagem, &mut resp_parcial, true);
    assert_eq!(qtd, 3);
    assert_eq!(e.avaliacoes.len(), 3);
    let nomes_avaliados: HashSet<_> = e.avaliacoes.iter().map(|a| a.agente_nome.as_str()).collect();
    assert!(nomes_avaliados.contains("Filósofo"));
    assert!(nomes_avaliados.contains("Cético"));
    assert!(nomes_avaliados.contains("Pragmático"));
}
