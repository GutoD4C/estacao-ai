---
tags: [estacao-ai, agentes]
data-base: 23/11/2026
---
# Agentes

Na tela **Modelos de IA** (rotas `/web/agentes` e `/web/modelos`) você monta a equipe: escolhe a ferramenta (Claude Code, Codex, Antigravity, OpenCode…), o modelo e o **papel** de cada agente.

## Papéis pré-definidos
Cada papel traz uma legenda (mostrada na tela) e instruções fixas que entram no prompt do agente. Eles se dividem em dois grupos.

### Projetos
| Papel | O que faz |
|---|---|
| Pensador (coordenador) | Único que responde no chat geral a perguntas e à estruturação inicial. Quebra o pedido em passos, delega com `@Nome` e acompanha o que os demais fazem, sugerindo mudanças e melhorias. Não escreve código. |
| Desenvolvedor | Escreve e altera o código seguindo os padrões do projeto, com a menor mudança completa. Não faz commit. |
| Testador | Escreve e roda testes, reproduz bugs e relata o que passou e o que falhou. |
| QA e Segurança | Revisa lógica, casos de borda, segredos, permissões, dependências e dados pessoais (LGPD). Só revisa, não altera. |
| Documentador | Mantém README, guias, CHANGELOG e comentários em dia. |
| Publicador (Git e PRs) | Faz commits numa branch própria, envia com `git push` e abre o PR com `gh pr create`. Nunca usa a main direto nem força push; só publica quando o Operador ou o Pensador pedem. |

### Chat
Para conversa do dia a dia e testes, não para projetos. O prompt é leve: sem quadro de tarefas e sem memória do projeto.

| Papel | O que faz |
|---|---|
| Filósofo | Ajuda a pensar, organizar ideias e decisões pessoais. |
| Pessoa | Conversa simples, como uma pessoa comum, com várias emoções. |
| Cético | Em debates, questiona, pede evidências e aponta riscos. |
| Otimista | Em debates, defende as possibilidades e os lados positivos. |
| Mediador | Em debates, resume os lados e propõe uma síntese. |

## Como criar
- **⚡ Configurar automático (1 clique)**: detecta as CLIs instaladas na máquina e monta apenas a aba ativa (**Projetos** ou **Chat**). No grupo Chat, quando o Codex oferece `gpt-6-luna`, a Estação seleciona esse perfil leve por padrão.
- **+ Criar** ao lado de um papel: escolhe a ferramenta e o modelo; o nome já vem com o nome do papel (ex.: `Desenvolvedor`, `Pensador`).
- **Montar equipe**: cria um agente para cada papel do grupo com o mesmo modelo. No grupo Chat, se você não escolher uma sala, a Estação cria a sala **Conversa Rápida** com eles.
- **+ Adicionar modelo**: agente avulso, com papel opcional.
- **⚡ Testar**: valida ao vivo no cartão do agente se a CLI instalada responde corretamente.

| Campo | Para que serve |
|---|---|
| Nome | Como o agente aparece nos canais, no quadro e nos chats (use em `@Nome`) |
| Papel na equipe | Um dos papéis acima (ou nenhum) |
| Especialidade | Texto livre opcional (ex.: `Backend Rust`) |
| Comando | CLI executada pelo servidor (o prompt chega pela entrada padrão) |

> [!warning] Permissões
> No modo sem tela (`claude -p`), a CLI não consegue pedir confirmação interativa. Para os papéis do grupo **Projetos**, a Estação configura `--permission-mode bypassPermissions` para que os agentes possam editar, testar e publicar na pasta do projeto sem travar; papéis do grupo **Chat** rodam sem permissões de edição de projeto. O comando fica visível em "Avançado" e pode ser ajustado. Nas outras CLIs, configure a permissão na própria ferramenta e use o [[Chats e orquestração#Terminal|terminal]] para conferir `gh auth status` e permissões de arquivos.

> [!note] Segurança
> Cadastrar ou executar agentes exige permissão de administrador no servidor, porque o comando roda no seu computador.

Relacionadas: [[Projetos e tarefas]], [[Chats e orquestração]].
