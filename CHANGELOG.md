# Changelog

Todas as mudanças relevantes da **Estação I.A** são documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) e o projeto adota [Versionamento Semântico](https://semver.org/spec/v2.0.0.html).

> A Estação I.A é baseada no projeto [ai-memory](https://github.com/akitaonrails/ai-memory), criado por **Fabio Akita** sob a **Licença MIT** (`Copyright (c) 2026 Fabio Akita`). Veja [`LICENSE`](LICENSE), [`NOTICE`](NOTICE) e [`docs/Estação-ai/Créditos e Licença.md`](docs/Estação-ai/Créditos%20e%20Licença.md).

## [Unreleased]

## [1.7.5] — 2026-11-27

### Changed

- Movida a central de exportação, inspeção e importação de memória da aba **Projetos** para **Grafo de conhecimento** e **Revisão de aprendizado** (`/web/graph` e `/web/pending`), via componente dedicado [`estacao-memoria.js`](crates/ai-memory-web/static/estacao-memoria.js), com resumo detalhado (`/estacao/api/memorias/resumo`), exportação completa em 1 clique (`{"tudo": true}` incluindo entidades, relações do grafo, revisões de aprendizado pendentes e aprendizados da Estação), importação em lotes acima de 8 MiB e limite HTTP ampliado para 128 MiB.

### Fixed

- Corrigido o rastreamento de alterações no modal **Conta Nostr & Contatos** (`abrirModalNostr`) e no contexto de projeto para não exibir `"Descartar alterações?"` após salvar o perfil ou conectar um contato `npub`.
- Eliminados recarregamentos indesejados da página (`location.reload()`) ao perder sessão em abas abertas, em atualizações do cofre em outra aba via `storage`, durante abertura de modais em `carregar()` e em abas ocultas (`document.hidden`), além de estabilizar a ordenação de `presenca_salas` e `memorias` em `/estacao/api/estado`.
- Validado o `frontmatter` antes de purgar o escopo no modo `substituir` da importação de memórias, evitando perda de dados em pacotes inválidos.

## [1.7.4] — 2026-11-26

### Fixed

- Corrigida a persistência do login Nostr por 30 dias, com expiração explícita do cookie, restauração pelo dispositivo e vínculo local de uso único sem renovar o prazo original.
- Adicionado o controle do serviço em segundo plano pela bandeja do Windows, com opções de abrir e encerrar o aplicativo.
- Corrigida a atualização no Windows para encerrar o supervisor e o servidor antes da troca dos arquivos; removido o encerramento indiscriminado de processos pelo nome no instalador.
- Removido o corte de 10.000 páginas na exportação de conhecimento e utilizada a gravação em lote por projeto na importação. Verificada a reconstrução de entidades e relações entre projetos em uma base vazia.
- Corrigida a compilação em Linux/CI com `-D warnings` ao expor `WebState::request_shutdown` na API de encerramento.
- Removida a seção de histórico de versões do `README.md` (mantendo o histórico completo em `CHANGELOG.md`) e atualizados os links e documentos da Estação para a versão `1.7.4`.

## [1.7.3] — 2026-11-25

### Added

- **Gestão completa de Memória dos Projetos (`/web/projetos`)**: adicionados endpoints protegidos (`GET /estacao/api/memorias/inspecionar`, `POST /estacao/api/memorias/exportar`, `POST /estacao/api/memorias/importar` com limite de 16 MiB e `Acao::ExcluirMemoria`) e interface completa com seleção total ou individual, exportação em pacote portátil `estacao-ai-memoria-v1` (`.json`), importação seletiva com pré-visualização por projeto (modos **Mesclar** e **Substituir**), inspeção detalhada de páginas e sessões e exclusão individual com proteção da memória global (`default/_global`).
- **Documentação ampliada no `README.md`**: nova seção **Novas versões** logo no início do README e guia detalhado explicando para que serve e como utilizar todas as funções da Estação I.A (incluindo Memória dos Projetos, Chats/Chalé 3D, Projetos 2D, Modelos de IA, Consumo e Nostr).

### Fixed

- **Detecção do Codex CLI e ferramentas no Windows**: ampliado o `caminho_busca()` em `estacao/processo.rs` para incluir `USERPROFILE`/`LOCALAPPDATA`/`APPDATA`/`ProgramFiles`, `WindowsApps` (aliases MSIX com reparse point) e `CODEX_HOME` no catálogo e painel de consumo; corrigida a resolução de `codex` e normalização `\\?\` em `codex_hook_trust` (`doctor`/`setup`), e evitado que falhas transitórias em `carregarCatalogo()` deixem a lista de ferramentas presa em `[]`.

## [1.7.2] — 2026-11-25

### Security

- **Dependências (`libz-sys 1.1.33`, `url 2.5.9`, `rustix 1.1.6`)**: atualizados os lockfiles do workspace e dos companions para encerrar `RUSTSEC-2026-0544` (`libz-sys`), `RUSTSEC-2026-0592` (`url`) e `RUSTSEC-2026-0486` (`rustix`).

### Fixed

- **Smart TV 3D (YouTube)**: alinhada a leitura da busca no Chalé 3D ao formato `{ results, title, channel, duration }` retornado por `/estacao/api/youtube`.
- **Abertura em modo aplicativo no Windows (`estacao-ai app` / `iniciar.ps1`)**: corrigida a descoberta do Edge/Chrome/Brave nos diretórios padrão de instalação do Windows (`ProgramFiles`, `ProgramFiles(x86)`, `LOCALAPPDATA` e `Last Browser` em `desktop-app-profile`) para abrir janela isolada `--app=` mesmo fora do `PATH`, com inicialização em segundo plano via `service-host` sem deixar console aberto, e atualizado o `iniciar.ps1` para chamar `estacao-ai app`.
- **Primeiro carregamento sem CLI & Statusline multiplataforma**: corrigido travamento em `"Carregando…"` quando `auto_configurar` encontra zero ferramentas ativas, removido caminho pessoal fixo da aba Consumo e adicionado `scripts/estacao/statusline-limites.ps1` para Windows.
- **Orquestração, parser de avaliações e instalador Windows**: corrigida colisão de prefixo em menções `@Nome`, parsing balanceado de `AVALIACAO_JSON:` ignorando colchetes posteriores e fechamento seguro de `estacao-ai.exe` via `CloseApplications` no Inno Setup.
- **CI, companions, plugins, CodeQL e Nix**: corrigidos erros de `clippy`/`rustfmt`, imports `estacao_ai_*` nos companions, `Cargo.lock` do `estacao-ai-desktop`, manifests e testes E2E de `plugins/` e relay (`--estacao-ai-bin` e versão `1.7.2`), asserções `pt-BR` do console de gerenciamento em `ai-memory-mcp`, `upload-sarif` v4.39.4 no CodeQL, `flake.nix` sem hash órfão de `zip-8.6.0` e `scripts/check-dashboard-core-mutations.py`.

### Changed

- **Design System e acessibilidade**: *focus trap* e confirmação segura em modais/diálogos, barra indeterminada quando provedor não informa `%` livre, cores completas por provedor em `.dc-msg-name` e renderização de Markdown no feed e diálogo do Chalé 3D.

## [1.7.1] — 2026-11-25

### Security

- **Dependências (`zip 9.8.2` + `candle 0.11.1`)**: atualizada toda a árvore do workspace para `zip 9.8.2`, encerrando os 5 CVEs do `zip 8.6` (incluindo o crítico `CVE-2026-115905`).
- **Blindagem de salas compartilhadas Nostr (`SincronizarSalaCompartilhada`)**: comandos shell vindos de payloads remotos são sempre ignorados (`echo '(agente remoto Nostr)'`), `pasta`/`memoria` externos são zerados, agentes do operador local nunca são sobrescritos e `testar_agente` recusa executar agentes remotos.
- **Hardening do auto-atualizador**: `POST /estacao/api/atualizacao/aplicar` agora exige cabeçalho CSRF (`x-estacao-ui: 1`), validação `Origin == Host`, permissão de administrador, verificação **obrigatória** (*fail-closed*) de `SHA256SUMS.txt` e sanitização estrita de nome de arquivo contra *path traversal*.
- **Limites na busca do YouTube**: aplicados teto de 200 caracteres na query e limite de 4 MiB na leitura do HTML de resposta.

### Fixed

- **Hibernação (`zzz`) de agentes em chats e projetos compartilhados**: corrigido o cálculo de presença (backend e frontend) para que os agentes pertencentes ao operador local estejam **sempre acordados e prontos para receber tarefas/mensagens**, mesmo quando a lista de presença ainda não inclui seu `npub` ou após troca de conta Nostr; apenas agentes pertencentes a outra pessoa ficam adormecidos quando ela está offline.

### Added

- **Instalador Windows pronto (.exe)**: workflow automatizado `windows-installer.yml` com Inno Setup 6 gerando e publicando `Estacao-ai-Setup-win10-11-x64.exe` e `Estacao-ai-win10-11-x64.exe` diretamente nas releases.

## [1.7.0] — 2026-11-25

### Added

- **Novos papéis e estilos de pensamento para Agentes**: adicionados 7 novos estilos em **Chat** (*Pragmático*, *Criativo*, *Analítico*, *Estrategista*, *Empático*, *Advogado do Diabo* e *Contador de Histórias*) e 6 novos especialistas em **Projetos** (*Arquiteto de Software*, *Designer UI/UX*, *DevOps e Infraestrutura*, *Analista de Dados e Banco*, *Revisor de Código* e *Produto/PM*).
- **10 modelos 3D de cachorros com pelagem natural**: adicionadas 5 novas raças no Chalé 3D (**Husky Siberiano**, **Golden Retriever**, **Dálmata**, **Corgi** e **Shiba Inu**) e seletor de raça individual para cada agente; todos os cachorros mantêm suas cores naturais originais sem tingimento artificial por cor de IA.
- **Estante de Conhecimento interativa no Chalé 3D** (`GET /estacao/api/estante`): biblioteca de livros com busca, filtros (*Todos*, *Concluídos*, *Memória*, *Debates*) e leitor completo para consultar tarefas concluídas, páginas de memória e cadernos de debate.
- **Projetos 2D mais dinâmicos**: barra de progresso ao vivo no painel lateral **TAREFAS** (`concluídas / total (%)`), botão **▶ Rodar próxima** e atalhos rápidos de comando para o **Pensador**.
- **Documentação de Créditos e Licença MIT**: página dedicada atribuindo a base `ai-memory` a Fabio Akita (`Copyright (c) 2026 Fabio Akita`).

### Changed

- Repositório oficial migrado para `GutoD4C/estacao-ai` com histórico limpo (sem dados históricos antigos do `ai-memory`).
- Polimento visual geral em toda a interface da Estação e capturas de tela atualizadas no `README.md` e na documentação.
- Removidas menções externas a `Herdr` e `Buzz Agents` do Multi-Terminal, cabeçalhos e guias.
- **Grafo de Conhecimento** (`/web/graph`) e **Revisão de Aprendizado** (`/web/pending`) passam a exibir dados vivos da Estação (projetos, chats, agentes, tarefas concluídas, avaliações do Mediador e páginas recentes da memória).

### Fixed

- **Mediador pontuando todos os falantes**: em salas de Chat, o Mediador aguarda todos os participantes terminarem antes de sintetizar e garante a pontuação completa de cada agente que falou.
- **Abertura de Memória dos projetos (`/web`)**: corrigido o `Path` do cookie `estacao_operador` de `/web/` para `/web` (RFC 6265) com migração automática da sessão ativa.

## [1.6.0] — 2026-11-24

### Added

- **Atualização automática direto do GitHub**: verificação de novas releases com banner **Atualizar agora**, validação de `SHA256SUMS.txt` e aplicação automática.
- **Janela desktop dedicada**: `estacao-ai app` abre a Estação I.A em janela isolada sem barra de navegador.

## [1.5.0] — 2026-11-24

### Added

- Lançamento inicial da linha **Estação I.A** com Chalé 3D, personagens caninos, salas compartilhadas via Nostr (NIP-46/NIP-07), Projetos 2D coordenados pelo Pensador, quadro de TAREFAS e Multi-Terminal.
