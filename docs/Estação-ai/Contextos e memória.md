---
tags: [estacao-ai, memoria, contexto]
data-base: 16/11/2026
---
# Contextos e memória

A Estação-ai junta dois tipos de contexto:

- **Contextos da Estação** (global e por projeto): ficam em `estacao/estado.json` e são **injetados pela Estação** no prompt de cada execução. Um agente aberto fora da Estação (direto no terminal) não os vê.
- **Memória de longo prazo**: páginas, regras e sessões capturadas pelos hooks, que qualquer agente com o MCP `estacao-ai` consulta.

| Nível | Onde se edita | Alcance |
|---|---|---|
| Contexto global | Projetos → "Contexto global" | Todos os agentes, em todos os projetos |
| Contexto do projeto | Configurações do projeto | Todos os agentes daquele projeto |
| Memória ligada | Campo "Memória ligada" do projeto | Decisões, regras e histórico capturados pelos hooks |

## Como a memória entra no trabalho
- Os modelos rodam na pasta do projeto, então os hooks já instalados capturam cada sessão na memória daquele projeto, automaticamente.
- No modal **Contextos & Memória** do projeto expandido você pode visualizar as páginas `_rules/`, `decisions/`, `gotchas/` e recentes da memória ligada, e gravar `.estacao-ai.toml` na pasta com 1 clique para vincular também sessões abertas fora da Estação.
- O prompt diz ao modelo qual `workspace`/`project` usar nas ferramentas `memory_*` (MCP `estacao-ai`).
- A Estação injeta automaticamente no prompt os resumos das regras globais (`default/_global`) e das regras/decisões/gotchas e páginas recentes da memória ligada.
- A tela **Memória e contextos** (`/web/`) continua mostrando páginas, sessões, grafo e tokens de cada projeto.

> [!todo] Próximo passo possível
> Gravar os contextos também como páginas `_rules/` da memória ligada (ou global), para que agentes abertos fora da Estação também os recebam.

Relacionadas: [[Chats e orquestração]], [[Visão geral]].
