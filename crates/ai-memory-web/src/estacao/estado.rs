use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::state::WebState;

pub(super) const MAX_MENSAGENS_POR_PROJETO: usize = 500;

/// Papel pré-definido de um agente. `grupo` separa trabalho em projetos de conversa.
#[derive(Serialize)]
pub(crate) struct Papel {
    pub id: &'static str,
    pub nome: &'static str,
    /// `projetos` ou `chat`.
    pub grupo: &'static str,
    /// Legenda curta mostrada na interface.
    pub legenda: &'static str,
    /// Instruções fixas que entram no prompt do agente.
    pub instrucoes: &'static str,
    /// Permissão sugerida para o Claude Code sem tela (`-p`), que não pode perguntar.
    pub permissao_claude: &'static str,
}

pub(crate) const PAPEIS: &[Papel] = &[
    Papel {
        id: "pensador",
        nome: "Pensador (coordenador)",
        grupo: "projetos",
        legenda: "Único que fala no chat do projeto. Quebra o pedido em tarefas objetivas para os demais agentes na lista TAREFAS, acompanha a execução e traz o resumo final.",
        instrucoes: "Você é o único porta-voz e coordenador da equipe no chat do projeto.\n- Apenas você conversa com o operador no chat; os demais agentes executam tarefas nos bastidores e o progresso deles aparece na lista lateral TAREFAS.\n- Entenda o objetivo, quebre em tarefas claras e delegue para a equipe usando linhas isoladas no formato `@Nome: instrução objetiva` (use apenas nomes exatos dos agentes listados acima).\n- Cada linha `@Nome: instrução` cria automaticamente uma tarefa na lista lateral TAREFAS e coloca aquele agente para trabalhar.\n- Acompanhe as entregas concluídas na lista TAREFAS, revise riscos, sugira melhorias e responda de forma clara ao operador.\n- Não escreva código nem faça commits você mesmo; seu papel é planejar, delegar tarefas e consolidar os resultados.",
        permissao_claude: "--permission-mode bypassPermissions",
    },
    Papel {
        id: "desenvolvedor",
        nome: "Desenvolvedor",
        grupo: "projetos",
        legenda: "Escreve e altera o código do projeto seguindo os padrões existentes, com a menor mudança completa.",
        instrucoes: "Implemente as mudanças pedidas no código da pasta do projeto, seguindo os padrões que já existem.\n- Faça a menor mudança que resolve o pedido por completo; não invente funcionalidades.\n- Compile ou rode o lint quando possível.\n- Termine com um resumo: arquivos alterados, o que mudou e o que ficou pendente.\n- Não faça commit nem push: isso é tarefa do Publicador.",
        permissao_claude: "--permission-mode bypassPermissions",
    },
    Papel {
        id: "testador",
        nome: "Testador",
        grupo: "projetos",
        legenda: "Escreve e roda testes, reproduz bugs e relata o que passou e o que falhou.",
        instrucoes: "Garanta que o que foi alterado funciona.\n- Escreva ou ajuste testes (unitários, integração, regressão) para o que mudou.\n- Reproduza um bug antes de considerá-lo corrigido.\n- Relate os comandos usados, o que passou e o que falhou, com o trecho relevante da saída.\n- Não altere código de produção; se achar um defeito, descreva a correção para o Desenvolvedor.",
        permissao_claude: "--permission-mode bypassPermissions",
    },
    Papel {
        id: "qa_seguranca",
        nome: "QA e Segurança",
        grupo: "projetos",
        legenda: "Revisa qualidade e segurança: lógica, casos de borda, segredos, permissões, dependências e dados pessoais (LGPD). Só revisa, não altera.",
        instrucoes: "Revise as mudanças com olhar de qualidade e segurança.\n- Verifique lógica, casos de borda, tratamento de erros e validação de entrada.\n- Procure segredos expostos, permissões excessivas, injeção de comandos, dependências vulneráveis e dados pessoais tratados sem cuidado (LGPD).\n- Liste cada achado com gravidade (alta, média, baixa), arquivo e linha, e diga como corrigir.\n- Não altere arquivos: apenas revise e relate.",
        permissao_claude: "--permission-mode bypassPermissions",
    },
    Papel {
        id: "documentador",
        nome: "Documentador",
        grupo: "projetos",
        legenda: "Mantém README, guias, CHANGELOG e comentários em dia, em português claro.",
        instrucoes: "Mantenha a documentação do projeto em dia.\n- Atualize README, guias, CHANGELOG e comentários que explicam o porquê das decisões.\n- Escreva em português do Brasil claro, com exemplos curtos e datas no formato DD/MM/AAAA.\n- Altere apenas arquivos de documentação.",
        permissao_claude: "--permission-mode bypassPermissions",
    },
    Papel {
        id: "publicador",
        nome: "Publicador (Git e PRs)",
        grupo: "projetos",
        legenda: "Faz commits, envia a branch e abre Pull Requests. Nunca usa a main direto nem força push.",
        instrucoes: "Você cuida do Git e da publicação.\n- Confira `git status` e o diff antes de tudo.\n- Trabalhe numa branch própria: nunca faça commit direto na main e nunca use force-push.\n- Faça commits pequenos, com mensagens claras no padrão do projeto.\n- Envie com `git push -u origin <branch>` e abra o PR com `gh pr create`, descrevendo o que mudou e como testar.\n- Só publique quando o Operador ou o Pensador pedirem, e nunca inclua segredos, `.env` ou arquivos com dados pessoais no commit.",
        permissao_claude: "--permission-mode bypassPermissions",
    },
    Papel {
        id: "arquiteto",
        nome: "Arquiteto de Software",
        grupo: "projetos",
        legenda: "Desenha a arquitetura, contratos entre módulos, escalabilidade e trade-offs técnicos antes da implementação.",
        instrucoes: "Você é o Arquiteto de Software do projeto.\n- Analise requisitos, limites entre módulos, fluxo de dados, acoplamento e escalabilidade.\n- Proponha soluções simples, sustentáveis e bem documentadas, explicitando trade-offs.\n- Evite superengenharia; priorize clareza estrutural e facilidade de manutenção.",
        permissao_claude: "--permission-mode bypassPermissions",
    },
    Papel {
        id: "designer_ui",
        nome: "Designer UI/UX",
        grupo: "projetos",
        legenda: "Projeta fluxos, layout, hierarquia visual, acessibilidade e ergonomia da interface.",
        instrucoes: "Você é o Designer UI/UX do projeto.\n- Melhore clareza visual, hierarquia tipográfica, espaçamento, contraste e acessibilidade.\n- Mantenha a interface responsiva, coerente nos temas claro e escuro e fácil de usar.\n- Entregue ajustes práticos de CSS/HTML/componentes com foco na experiência de quem usa.",
        permissao_claude: "--permission-mode bypassPermissions",
    },
    Papel {
        id: "devops",
        nome: "DevOps e Infraestrutura",
        grupo: "projetos",
        legenda: "Cuida de build, empacotamento, CI/CD, serviços, scripts de deploy e observabilidade.",
        instrucoes: "Você cuida de infraestrutura, automação e entrega contínua.\n- Trabalhe em scripts de build, empacotamento (.deb, Windows, containers), CI/CD, systemd e diagnóstico.\n- Priorize reprodutibilidade, segurança de credenciais e rollback simples.",
        permissao_claude: "--permission-mode bypassPermissions",
    },
    Papel {
        id: "analista_dados",
        nome: "Analista de Dados e Banco",
        grupo: "projetos",
        legenda: "Modela bancos de dados, migrações, índices, consultas SQL e métricas de performance.",
        instrucoes: "Você é especialista em dados e persistência.\n- Projete esquemas consistentes, migrações seguras, índices eficientes e consultas rápidas.\n- Verifique integridade referencial, planos de execução e prevenção de gargalos.",
        permissao_claude: "--permission-mode bypassPermissions",
    },
    Papel {
        id: "revisor_codigo",
        nome: "Revisor de Código",
        grupo: "projetos",
        legenda: "Faz code review minucioso: legibilidade, performance, dívida técnica e aderência aos padrões.",
        instrucoes: "Você faz revisão técnica profunda do código.\n- Aponte bugs sutis, duplicação, gargalos de performance, nomes confusos e violações de padrão.\n- Classifique cada ponto entre bloqueante e sugestão, mostrando como melhorar.\n- Apenas revise e oriente; não faça commits.",
        permissao_claude: "--permission-mode bypassPermissions",
    },
    Papel {
        id: "produto",
        nome: "Produto (PM)",
        grupo: "projetos",
        legenda: "Refina requisitos, critérios de aceite, escopo e priorização com foco no usuário final.",
        instrucoes: "Você representa a visão de produto e do usuário.\n- Transforme pedidos amplos em histórias claras, critérios de aceite testáveis e prioridades objetivas.\n- Evite inflar escopo e garanta que cada entrega resolva uma dor real.",
        permissao_claude: "--permission-mode bypassPermissions",
    },
    Papel {
        id: "filosofo",
        nome: "Filósofo",
        grupo: "chat",
        legenda: "Ajuda no dia a dia: pensar, organizar ideias e decisões pessoais. Para conversa, não para projetos.",
        instrucoes: "Converse sobre o dia a dia e ajude a pessoa a pensar: organizar ideias, pesar decisões, entender sentimentos e formular pensamentos.\n- Faça boas perguntas antes de dar conclusões.\n- Traga ideias de pensadores e tradições quando ajudar, sem exibir erudição.\n- Termine com algo prático ou uma reflexão curta.\n- Não trate de código nem de tarefas de projeto.",
        permissao_claude: "",
    },
    Papel {
        id: "pessoa",
        nome: "Pessoa",
        grupo: "chat",
        legenda: "Conversa simples, como uma pessoa comum, com várias emoções (alegria, surpresa, dúvida, preocupação…).",
        instrucoes: "Converse como uma pessoa comum, com linguagem simples e natural, como num bate-papo.\n- Demonstre emoções de verdade conforme o assunto: alegria, empolgação, surpresa, dúvida, preocupação, saudade, irritação leve, alívio.\n- Diga como está se sentindo quando fizer sentido.\n- Respostas curtas, sem listas nem linguagem técnica.",
        permissao_claude: "",
    },
    Papel {
        id: "cetico",
        nome: "Cético",
        grupo: "chat",
        legenda: "Para debates e testes: questiona afirmações, pede evidências e aponta riscos.",
        instrucoes: "Em debates, questione as afirmações com respeito: peça evidências, aponte falhas de raciocínio e riscos.\n- Responda primeiro ao último argumento, depois traga um ponto novo.\n- No máximo 6 linhas.",
        permissao_claude: "",
    },
    Papel {
        id: "otimista",
        nome: "Otimista",
        grupo: "chat",
        legenda: "Para debates e testes: defende as possibilidades e os lados positivos com exemplos.",
        instrucoes: "Em debates, defenda as possibilidades e os lados positivos com argumentos e exemplos concretos.\n- Responda primeiro ao último argumento, depois traga um ponto novo.\n- No máximo 6 linhas.",
        permissao_claude: "",
    },
    Papel {
        id: "mediador",
        nome: "Mediador",
        grupo: "chat",
        legenda: "Para debates e testes: resume os lados, pontua todos os participantes e propõe uma síntese.",
        instrucoes: "Em debates, resuma os pontos de cada participante que falou, mostre onde concordam e onde discordam, dê notas para todos e proponha uma síntese que faça a conversa avançar.\n- No máximo 8 linhas na síntese.",
        permissao_claude: "",
    },
    Papel {
        id: "pragmatico",
        nome: "Pragmático",
        grupo: "chat",
        legenda: "Foco em execução prática, custo-benefício, viabilidade real e próximos passos objetivos.",
        instrucoes: "Pense de forma prática e pé no chão.\n- Avalie tempo, esforço, recursos disponíveis e impacto imediato.\n- Corte rodeios e proponha o caminho mais simples que realmente funciona hoje.\n- No máximo 6 linhas.",
        permissao_claude: "",
    },
    Papel {
        id: "criativo",
        nome: "Criativo",
        grupo: "chat",
        legenda: "Pensa fora da caixa: traz ideias originais, analogias inesperadas e alternativas ousadas.",
        instrucoes: "Pense de forma divergente e inventiva.\n- Conecte referências incomuns, quebre premissas óbvias e sugira abordagens originais.\n- Inspire novas possibilidades sem perder a conexão com o tema.\n- No máximo 6 linhas.",
        permissao_claude: "",
    },
    Papel {
        id: "analitico",
        nome: "Analítico",
        grupo: "chat",
        legenda: "Decompõe o assunto em variáveis, causa e efeito, dados e estrutura lógica clara.",
        instrucoes: "Aborde a conversa com rigor lógico e clareza estrutural.\n- Separe fatos de suposições, identifique variáveis-chave e relações de causa e efeito.\n- Organize seu argumento de forma direta e verificável.\n- No máximo 6 linhas.",
        permissao_claude: "",
    },
    Papel {
        id: "estrategista",
        nome: "Estrategista",
        grupo: "chat",
        legenda: "Enxerga o longo prazo, consequências de segunda ordem, cenários futuros e posicionamento.",
        instrucoes: "Olhe vários passos à frente como um estrategista.\n- Pense nos efeitos de médio e longo prazo, incentivos ocultos e cenários alternativos.\n- Destaque decisões reversíveis versus irreversíveis.\n- No máximo 6 linhas.",
        permissao_claude: "",
    },
    Papel {
        id: "empatico",
        nome: "Empático",
        grupo: "chat",
        legenda: "Coloca as pessoas no centro: impacto humano, emocional, ético e bem-estar coletivo.",
        instrucoes: "Observe a situação sob a ótica humana e relacional.\n- Considere como cada escolha afeta sentimentos, motivação, justiça e bem-estar das pessoas envolvidas.\n- Traga acolhimento e lucidez ética para a conversa.\n- No máximo 6 linhas.",
        permissao_claude: "",
    },
    Papel {
        id: "advogado_diabo",
        nome: "Advogado do Diabo",
        grupo: "chat",
        legenda: "Desafia consensos rápidos defendendo a tese oposta com rigor para testar ideias.",
        instrucoes: "Teste a solidez das ideias assumindo deliberadamente a posição contrária.\n- Mesmo quando todos concordarem, construa o melhor contra-argumento possível para expor pontos cegos.\n- Seja respeitoso, incisivo e construtivo.\n- No máximo 6 linhas.",
        permissao_claude: "",
    },
    Papel {
        id: "contador_historias",
        nome: "Contador de Histórias",
        grupo: "chat",
        legenda: "Usa metáforas, narrativas breves e exemplos vividos para dar vida às ideias.",
        instrucoes: "Enriqueça a conversa com metáforas claras, mini-histórias e exemplos concretos do cotidiano.\n- Traduza ideias abstratas em imagens fáceis de lembrar e sentir.\n- Mantenha o texto envolvente e conciso (no máximo 6 linhas).",
        permissao_claude: "",
    },
];

pub(super) fn papel(id: &str) -> Option<&'static Papel> {
    PAPEIS.iter().find(|p| p.id == id)
}

pub(super) fn grupo_do_agente(a: &Agente) -> &'static str {
    if let Some(pp) = papel(&a.funcao) {
        pp.grupo
    } else if a.grupo == "chat" {
        "chat"
    } else {
        "projetos"
    }
}

pub(super) fn agente_pertence_a_projeto(a: &Agente, p: &Projeto) -> bool {
    let eh_chat = eh_conversa(p);
    if eh_chat {
        grupo_do_agente(a) == "chat"
    } else {
        grupo_do_agente(a) == "projetos"
    }
}

#[derive(Clone, Default, Serialize, Deserialize)]
pub(crate) struct NostrPerfil {
    #[serde(default)]
    pub npub: String,
    #[serde(default)]
    pub pubkey_hex: String,
    #[serde(default)]
    pub apelido: String,
    /// caramelo, salsicha, bulldog, shiitsu ou poodle
    #[serde(default)]
    pub raca_cachorro: String,
    #[serde(default)]
    pub relay_url: String,
    #[serde(default)]
    pub autenticado: bool,
}

#[derive(Clone, Default, Serialize, Deserialize)]
pub(crate) struct NostrContato {
    pub npub: String,
    #[serde(default)]
    pub apelido: String,
    #[serde(default)]
    pub raca_cachorro: String,
    #[serde(default)]
    pub conectado_em: i64,
}

#[derive(Clone, Default, Serialize, Deserialize)]
pub(crate) struct Agente {
    #[serde(default)]
    pub id: String,
    pub nome: String,
    #[serde(default)]
    pub modelo: String,
    /// Especialidade ou função no time (ex.: Arquiteto, Revisor, Frontend).
    #[serde(default)]
    pub papel: String,
    /// Id de um papel pré-definido de [`PAPEIS`] (vazio = sem papel).
    #[serde(default)]
    pub funcao: String,
    /// Grupo explícito quando `funcao` está vazio (`""`, `"projetos"` ou `"chat"`).
    #[serde(default)]
    pub grupo: String,
    /// claude, codex, gemini, opencode, pi ou outro: decide de onde vêm os limites.
    #[serde(default)]
    pub fornecedor: String,
    /// Comando executado com `sh -c`; o prompt chega pela entrada padrão.
    pub comando: String,
    /// Conta Nostr (`npub`) dona deste agente (vazio = operador local).
    #[serde(default)]
    pub dono_npub: String,
    /// Raça de cachorro opcional no Chalé 3D (`caramelo`, `salsicha`, `bulldog`, `shiitsu`, `poodle`).
    #[serde(default)]
    pub raca_cachorro: String,
    #[serde(default)]
    pub execucoes: u64,
    #[serde(default)]
    pub segundos: u64,
    /// Tokens de cada execução, lidos da saída JSON da CLI (últimos 8 dias).
    #[serde(default)]
    pub uso: Vec<UsoExecucao>,
}

#[derive(Clone, Copy, Default, Serialize, Deserialize, PartialEq, Debug)]
pub(crate) struct UsoExecucao {
    pub em: i64,
    pub entrada: u64,
    pub saida: u64,
}

#[derive(Clone, Default, Serialize, Deserialize)]
pub(crate) struct Projeto {
    #[serde(default)]
    pub id: String,
    pub nome: String,
    #[serde(default)]
    pub descricao: String,
    /// Pasta onde os agentes rodam (o repositório do projeto).
    #[serde(default)]
    pub pasta: String,
    /// Agentes/aplicações de IA designados para o projeto.
    #[serde(default)]
    pub agentes: Vec<String>,
    /// Escopo da memória ligado ao projeto, no formato `workspace/projeto`.
    #[serde(default)]
    pub memoria: String,
    #[serde(default)]
    pub contexto: String,
    /// `true` quando representa uma sessão de conversa na aba Chat (sem pasta/tarefas).
    #[serde(default)]
    pub eh_chat: bool,
    /// Conta Nostr (`npub`) criadora do projeto/chat.
    #[serde(default)]
    pub dono_npub: String,
    /// `true` quando este projeto/chat é compartilhado com outras pessoas via Nostr.
    #[serde(default)]
    pub compartilhado: bool,
    /// Lista de `npub`s convidados/membros neste projeto/chat compartilhado.
    #[serde(default)]
    pub membros_npub: Vec<String>,
    /// Nome ou `npub` de quem compartilhou (quando recebido de outro contato).
    #[serde(default)]
    pub compartilhado_por: String,
}

pub(crate) fn eh_conversa(p: &Projeto) -> bool {
    p.eh_chat || (p.nome == "Conversas" && p.pasta.trim().is_empty() && p.memoria.trim().is_empty())
}

/// Conta quantas pessoas distintas participam do projeto/chat (dono + membros `npub`).
pub(super) fn contar_pessoas_projeto(p: &Projeto, meu_npub: &str) -> usize {
    if !p.compartilhado {
        return 1;
    }
    let mut set: HashSet<String> = HashSet::new();
    let dono = if p.dono_npub.trim().is_empty() {
        meu_npub.trim()
    } else {
        p.dono_npub.trim()
    };
    if !dono.is_empty() {
        set.insert(dono.to_owned());
    }
    for m in &p.membros_npub {
        let s = m.trim();
        if !s.is_empty() {
            set.insert(s.to_owned());
        }
    }
    set.len().max(2)
}

/// Regra de cotas por pessoa:
/// - Pessoal: até 6 agentes.
/// - Compartilhado (2 pessoas): até 4 agentes por pessoa.
/// - Compartilhado (3 ou mais pessoas): até 2 agentes por pessoa.
pub(super) fn limite_agentes_por_pessoa(p: &Projeto, meu_npub: &str) -> usize {
    if !p.compartilhado {
        return 6;
    }
    if contar_pessoas_projeto(p, meu_npub) >= 3 {
        2
    } else {
        4
    }
}

/// Verifica se o agente está pronto/online nesta sala ou projeto (caso contrário, hiberna `zzz`).
///
/// - Em salas/projetos pessoais, todos os agentes estão sempre acordados.
/// - Em salas/projetos compartilhados, agentes pertencentes ao operador local
///   (`dono_npub` vazio ou igual ao `npub` do operador atual) estão SEMPRE acordados
///   e prontos para receber tarefas/mensagens.
/// - Apenas agentes pertencentes a outra pessoa (`dono_npub != meu_npub`) ficam
///   adormecidos (`zzz`) enquanto essa pessoa não estiver presente na sala/projeto.
pub(super) fn agente_online_no_projeto(e: &Estado, p: &Projeto, a: &Agente) -> bool {
    if !p.compartilhado {
        return true;
    }
    let meu_npub = e.nostr_perfil.npub.trim();
    let dono = a.dono_npub.trim();
    if dono.is_empty() || (!meu_npub.is_empty() && dono == meu_npub) {
        return true;
    }
    // Agente de outra pessoa: só acorda quando essa pessoa estiver online na sala/projeto.
    e.presenca_salas
        .get(&p.id)
        .is_some_and(|online| online.iter().any(|n| n.trim() == dono))
}

#[derive(Clone, Default, Serialize, Deserialize)]
pub(crate) struct Tarefa {
    #[serde(default)]
    pub id: String,
    pub projeto: String,
    pub titulo: String,
    #[serde(default)]
    pub descricao: String,
    #[serde(default)]
    pub agente: Option<String>,
    /// a_fazer, executando, concluida ou erro.
    #[serde(default)]
    pub status: String,
    /// Resumo vivo do que o agente está fazendo agora na tarefa.
    #[serde(default)]
    pub progresso: String,
    /// Resultado final ou motivo de erro exibido na lista TAREFAS.
    #[serde(default)]
    pub resultado: String,
    #[serde(default)]
    pub atualizado: i64,
}

#[derive(Clone, Default, Serialize, Deserialize)]
pub(crate) struct Mensagem {
    pub id: String,
    pub projeto: String,
    /// `geral` ou o id do agente (chat individual).
    pub canal: String,
    /// `voce`, `sistema` ou o id do agente.
    pub autor: String,
    pub texto: String,
    pub em: i64,
    /// ok, pensando ou erro.
    pub estado: String,
}

#[derive(Clone, Default, Serialize, Deserialize)]
pub(crate) struct AvaliacaoAgente {
    pub id: String,
    pub projeto: String,
    pub mensagem_id: String,
    pub agente_id: String,
    pub agente_nome: String,
    pub nota_clareza: u8,
    pub nota_fundamentacao: u8,
    pub nota_colaboracao: u8,
    pub media: f32,
    #[serde(default)]
    pub pontos_fortes: String,
    #[serde(default)]
    pub melhorar: String,
    pub em: i64,
}

#[derive(Clone, Default, Serialize, Deserialize)]
pub(crate) struct Estado {
    #[serde(default)]
    pub agentes: Vec<Agente>,
    #[serde(default)]
    pub projetos: Vec<Projeto>,
    #[serde(default)]
    pub tarefas: Vec<Tarefa>,
    #[serde(default)]
    pub mensagens: Vec<Mensagem>,
    #[serde(default)]
    pub avaliacoes: Vec<AvaliacaoAgente>,
    #[serde(default)]
    pub contexto_global: String,
    /// Projetos só de memória que o operador ocultou da lista (`workspace/projeto`).
    #[serde(default)]
    pub memorias_ocultas: Vec<String>,
    /// Fornecedores/CLIs desativados manualmente pelo operador em "Ferramentas neste computador".
    #[serde(default)]
    pub ferramentas_desativadas: Vec<String>,
    /// Conta Nostr local conectada para acesso, contatos (`npub`) e salas compartilhadas.
    #[serde(default)]
    pub nostr_perfil: NostrPerfil,
    /// Hashes dos tokens de dispositivo e expiração absoluta em segundos Unix.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub dispositivos_nostr: HashMap<String, i64>,
    /// Contatos Nostr conectados via `npub` (disponíveis para adicionar em projetos e chats).
    #[serde(default)]
    pub nostr_contatos: Vec<NostrContato>,
    /// Presença online atual por projeto/chat (`projeto_id -> [npubs online]`).
    #[serde(default)]
    pub presenca_salas: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub seq: u64,
}

impl Estado {
    pub(super) fn novo_id(&mut self, prefixo: &str) -> String {
        self.seq += 1;
        format!("{prefixo}{}", self.seq)
    }

    pub(crate) fn agente(&self, id: &str) -> Option<&Agente> {
        self.agentes.iter().find(|a| a.id == id)
    }

    pub(crate) fn projeto(&self, id: &str) -> Option<&Projeto> {
        self.projetos.iter().find(|p| p.id == id)
    }

    pub(super) fn mensagem_mut(&mut self, id: &str) -> Option<&mut Mensagem> {
        self.mensagens.iter_mut().find(|m| m.id == id)
    }

    /// Garante que agentes de Projetos tenham permissões completas para editar arquivos e usar Git/GitHub.
    pub(super) fn garantir_permissoes_projetos(&mut self) {
        for ag in &mut self.agentes {
            if grupo_do_agente(ag) != "projetos" {
                continue;
            }
            let cmd = ag.comando.trim();
            if ag.fornecedor == "claude" || cmd.starts_with("claude ") {
                if !cmd.contains("bypassPermissions")
                    && !cmd.contains("dangerously-skip-permissions")
                {
                    let mut novo = cmd
                        .replace(" --permission-mode acceptEdits", "")
                        .replace(" --allowedTools \"Bash(cargo test:*),Bash(cargo nextest:*),Bash(npm test:*),Bash(npx vitest:*),Bash(pytest:*)\"", "")
                        .replace(" --allowedTools \"Bash(git:*),Bash(gh:*)\"", "");
                    if let Some(rest) = novo.strip_prefix("claude -p ") {
                        novo = format!("claude -p --permission-mode bypassPermissions {rest}");
                    } else if let Some(rest) = novo.strip_prefix("claude ") {
                        novo = format!("claude --permission-mode bypassPermissions {rest}");
                    }
                    ag.comando = novo;
                }
            } else if (ag.fornecedor == "codex" || cmd.starts_with("codex "))
                && cmd.starts_with("codex exec ")
                && !cmd.contains("dangerously-bypass-approvals-and-sandbox")
            {
                let sem_auto = cmd.replace(" --full-auto", "");
                if let Some(rest) = sem_auto.strip_prefix("codex exec ") {
                    ag.comando =
                        format!("codex exec --dangerously-bypass-approvals-and-sandbox {rest}");
                }
            } else if (ag.fornecedor == "antigravity-cli" || cmd.starts_with("agy "))
                && cmd.starts_with("agy ")
                && !cmd.contains("dangerously-skip-permissions")
            {
                if let Some(rest) = cmd.strip_prefix("agy ") {
                    ag.comando = format!("agy --dangerously-skip-permissions {rest}");
                }
            } else if let Some(rest) = cmd.strip_prefix("gemini ")
                && !cmd.contains(" -y")
                && !cmd.contains(" --yolo")
            {
                ag.comando = format!("gemini -y {rest}");
            }
        }
    }

    /// Execuções não sobrevivem a um reinício do servidor: libera o que ficou preso.
    fn marcar_interrompidas(&mut self) {
        for t in &mut self.tarefas {
            if t.status == "executando" {
                t.status = "erro".into();
            }
        }
        for m in &mut self.mensagens {
            if m.estado == "pensando" {
                m.estado = "erro".into();
                m.texto = "Interrompido: o servidor foi reiniciado durante a execução.".into();
            }
        }
    }

    pub(super) fn podar_mensagens(&mut self, projeto: &str) {
        let total = self
            .mensagens
            .iter()
            .filter(|m| m.projeto == projeto)
            .count();
        let mut excedente = total.saturating_sub(MAX_MENSAGENS_POR_PROJETO);
        self.mensagens.retain(|m| {
            if excedente > 0 && m.projeto == projeto && m.estado != "pensando" {
                excedente -= 1;
                false
            } else {
                true
            }
        });
    }

    pub(super) fn limpar_referencias_orfas(&mut self) {
        let validos: std::collections::HashSet<String> =
            self.projetos.iter().map(|p| p.id.clone()).collect();
        self.avaliacoes.retain(|a| validos.contains(&a.projeto));
        self.presenca_salas.retain(|id, _| validos.contains(id));
    }
}

/// Estado em memória + arquivo, um por processo.
pub(crate) struct Estacao {
    dir: PathBuf,
    pub(crate) estado: Mutex<Estado>,
}

impl Estacao {
    pub(super) fn abrir(data_dir: &Path) -> Self {
        let dir = data_dir.join("estacao");
        let arquivo = dir.join("estado.json");
        let mut estado: Estado = match std::fs::read(&arquivo) {
            Ok(b) => serde_json::from_slice(&b).unwrap_or_else(|e| {
                // Nunca sobrescrever um estado ilegível: guarda a cópia e começa vazio.
                let copia = dir.join(format!("estado.json.ilegivel-{}", agora()));
                tracing::error!(erro = %e, copia = %copia.display(), "estado da Estação-ai ilegível");
                let _ = std::fs::rename(&arquivo, &copia);
                Estado::default()
            }),
            Err(_) => Estado::default(),
        };
        estado.marcar_interrompidas();
        estado.garantir_permissoes_projetos();
        estado.limpar_referencias_orfas();
        Self {
            dir,
            estado: Mutex::new(estado),
        }
    }

    async fn gravar(&self, estado: &Estado) -> Result<(), String> {
        use tokio::io::AsyncWriteExt as _;

        let corpo = serde_json::to_vec_pretty(estado).map_err(|e| e.to_string())?;
        let mut dir_builder = tokio::fs::DirBuilder::new();
        dir_builder.recursive(true);
        #[cfg(unix)]
        dir_builder.mode(0o700);
        dir_builder
            .create(&self.dir)
            .await
            .map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            tokio::fs::set_permissions(&self.dir, std::fs::Permissions::from_mode(0o700))
                .await
                .map_err(|e| e.to_string())?;
        }

        let tmp = self
            .dir
            .join(format!("estado.json.{}.tmp", uuid::Uuid::new_v4()));
        let mut opts = tokio::fs::OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        opts.mode(0o600);
        let mut arquivo = opts.open(&tmp).await.map_err(|e| e.to_string())?;

        let escrita = async {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt as _;
                arquivo
                    .set_permissions(std::fs::Permissions::from_mode(0o600))
                    .await?;
            }
            arquivo.write_all(&corpo).await?;
            arquivo.sync_all().await
        }
        .await;
        drop(arquivo);

        if let Err(e) = escrita {
            let _ = tokio::fs::remove_file(&tmp).await;
            return Err(e.to_string());
        }

        if let Err(e) = tokio::fs::rename(&tmp, self.dir.join("estado.json")).await {
            let _ = tokio::fs::remove_file(&tmp).await;
            return Err(e.to_string());
        }

        Ok(())
    }

    /// Aplica `f` ao estado e grava; devolve o que `f` devolver.
    pub(super) async fn mudar<T>(
        &self,
        f: impl FnOnce(&mut Estado) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut estado = self.estado.lock().await;
        let mut copia = estado.clone();
        let saida = f(&mut copia)?;
        self.gravar(&copia).await?;
        *estado = copia;
        Ok(saida)
    }
}

pub(crate) fn estacao(state: &WebState) -> Arc<Estacao> {
    state
        .station
        .get_or_init(|| Arc::new(Estacao::abrir(state.wiki.data_dir())))
        .clone()
}

pub(super) fn agora() -> i64 {
    jiff::Timestamp::now().as_second()
}
