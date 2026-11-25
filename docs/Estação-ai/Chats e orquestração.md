---
tags: [estacao-ai, chat, orquestracao]
data-base: 24/11/2026
---
# Chats e orquestração

A Estação-ai **executa de fato** as CLIs dos agentes locais (como Codex, Claude Code, Gemini CLI e Ollama). Cada mensagem ou tarefa dispara a execução real do agente com o contexto apropriado.

## Salas Pessoais e Compartilhadas (Nostr)
Na aba **Chats** (`/web/chat`), as salas se dividem em duas abas:
- **Pessoais**: salas individuais permitindo até 10 agentes de IA atuando simultaneamente.
- **Compartilhados**: salas compartilhadas com outros usuários via Nostr (`npub`).
  - Limite de agentes: até 5 agentes por pessoa quando houver 2 participantes; até 3 agentes por pessoa quando houver 3 ou mais participantes.
  - **Hibernação (*zzz*)**: os agentes de um usuário só podem ser utilizados enquanto o usuário estiver online na sala. Caso fique offline, os agentes entram em hibernação com ícones flutuantes de *zzz*.
  - **Avanço por consenso**: o avanço de diálogos (tecla **Q**) em salas compartilhadas requer que todos os participantes presentes apertem para prosseguir.
- **Convites Nostr (NIP-44)**: adicione a `npub` do colega nos contatos, clique em **Compartilhar** no cartão da sala e envie. O convidado visualiza o convite na aba **Convites** e entra com um clique.

## Chalé 3D Imersivo
Clique em **Entrar no Chalé 3D** para acompanhar os diálogos em um ambiente 3D interativo:
- **Navegação e Controles**: **WASD** para movimentação, **Mouse** para olhar, **Enter** ou **/** para abrir o chat, **Q** para avançar nos diálogos e **Esc** para o menu de configurações e opções.
- **Personagens Caninos**: os agentes ganham corpos estilizados de cães em suas cores naturais originais, com 10 raças disponíveis: **Caramelo**, **Salsicha**, **Bulldog**, **Shih-tzu**, **Poodle**, **Husky Siberiano**, **Golden Retriever**, **Dálmata**, **Corgi** e **Shiba Inu**.
- **Estante de Conhecimento**: interaja com a estante de livros no Chalé (**E**) para consultar tarefas concluídas, páginas da memória e cadernos de debate.
- **Ambiente aconchegante**: os cães acomodam-se em almofadas no piso ou nos bancos de tora da fogueira externa, podendo segurar e saborear xícaras de café quente durante a conversa.
- **Foco de Câmera e Diálogo**: ao falar, a câmera foca dinamicamente no cachorro que está discursando e no texto lateral, permitindo subir e descer o histórico com o scroll do mouse e avançar com **Q**.
- **Smart TV 3D**: busca e reproduz vídeos do YouTube diretamente na cena (via busca HTTP interna, sem dependência de `curl`), além de tocar áudios ambientes relaxantes (Lo-Fi, chuva, lareira) ou arquivos locais.

## Chat Geral em Projetos (Pensador Central)
No ambiente de projetos:
- **Apenas o Pensador fala no chat principal**: ele é o coordenador geral que recebe as metas do usuário, elabora a estratégia e delega etapas com instruções claras para a equipe de especialistas.
- O agente delegado executa na pasta do projeto e devolve a entrega ao Pensador, que avalia, solicita correções ou aprova a entrega, atualizando o painel de **TAREFAS**.

## Debate e Pontuação do Mediador
Botão **🗣 Debate** (ou `debate: <tema>`) no chat geral: escolha o tema, os participantes (de preferência papéis de Chat como Cético, Otimista e Mediador) e de 1 a 5 rodadas. Cada participante fala na sua vez, respondendo ao argumento anterior. Quando há um **Mediador** na sala, ele avalia *Clareza*, *Fundamentação* e *Colaboração* (**⚖️ Pontuar**).

## Multi-Terminal Integrado
- Múltiplas abas independentes de terminal (`+ Terminal`) com histórico individual de comandos e persistência do diretório atual de trabalho (`cwd`).
- Suporte a comandos simples e encadeados (`cd pasta && cargo test`).
- Botão `⊞ Dividir` para exibição em tela dividida lado a lado.
- Comandos com interação de teclado contínua ou prompts que exigem senha administrativa devem ser executados no terminal nativo do sistema operacional.

## Memória e Contexto
1. Papel e especialidade de cada agente da equipe.
2. Diretrizes e memória do projeto (`.estacao-ai.toml`, escopo de páginas e grafo semântico).
3. Histórico recente de mensagens e quadro de tarefas dinâmico.
