# Changelog

Todas as mudanças relevantes da **Estação I.A** são documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) e o projeto adota [Versionamento Semântico](https://semver.org/spec/v2.0.0.html).

> A Estação I.A é baseada no projeto [ai-memory](https://github.com/akitaonrails/ai-memory), criado por **Fabio Akita** sob a **Licença MIT** (`Copyright (c) 2026 Fabio Akita`). Veja [`LICENSE`](LICENSE), [`NOTICE`](NOTICE) e [`docs/Estação-ai/Créditos e Licença.md`](docs/Estação-ai/Créditos%20e%20Licença.md).

## [Unreleased]

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
