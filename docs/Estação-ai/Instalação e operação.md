---
tags: [estacao-ai, instalacao]
data-base: 26/11/2026
---
# Instalação e operação

## Uso do dia a dia
A Estação-ai (versão **1.7.6**) roda localmente em `http://127.0.0.1:49374/web/chat` e usa **Nostr** para autenticação, presença e compartilhamento seguro de salas e projetos.

1. **Instale** usando o instalador nativo (`.exe` para Windows 10/11 x64 ou `.deb` para Debian/Ubuntu amd64) ou compile a partir do código.
2. **Abra** pelo atalho **Estação-ai** (que executa `estacao-ai app`). O atalho abre a janela desktop dedicada da aplicação (atualmente em janela de aplicação sem barras de navegador, com migração em andamento para versão desktop própria e independente sem uso do Tauri v2).
3. **Entre com Nostr** na tela inicial: por chave privada direta (`nsec` ou hex de 64 caracteres), **QR Code (NIP-46)** no celular ou extensão de navegador **NIP-07**. A sessão é lembrada por **30 dias**.
4. Siga [[Tutorial completo]] → [[Agentes]] → [[Projetos e tarefas]] → [[Chats e orquestração]] → [[Consumo e limites]].

### Controle do serviço (Linux / systemd)
| Ação | Comando |
|---|---|
| Ver estado | `systemctl --user status estacao-ai` |
| Iniciar / parar | `systemctl --user start estacao-ai` / `stop` |
| Reiniciar | `systemctl --user restart estacao-ai` |
| Log | `journalctl --user -u estacao-ai -f` |
| Checar captura dos agentes | `estacao-ai doctor` |

### Controle no Windows (PowerShell)
| Ação | Comando |
|---|---|
| Instalar/atualizar e abrir | `.\iniciar.ps1` |
| Recompilar em release e reiniciar | `.\iniciar.ps1 -Recompilar` |
| Abrir sem lançar o navegador | `.\iniciar.ps1 -NaoAbrirNavegador` |
| Desabilitar autenticação do servidor localmente | `.\iniciar.ps1 -SemAuth` |
| Checar captura dos agentes | `estacao-ai doctor` |

> [!note] Autenticação do servidor
> Por padrão, `iniciar.ps1` preserva `bearer_token` / `bearer_token_file` caso a autenticação do servidor esteja configurada em `config.toml`. Ele também avisa quando há alterações locais mais novas que o binário compilado.

> [!warning] Codex
> Os hooks do Codex só rodam depois de aprovados: abra o Codex, digite `/hooks` e marque os da `estacao-ai` como confiáveis. Depois de instalar ou atualizar, reinicie os agentes abertos.

Guia ilustrado: [[Tutorial completo]] e [README](../../README.md).

## Onde fica cada coisa
| O quê | Linux | Windows |
|---|---|---|
| Binário | `~/.local/lib/estacao-ai/estacao-ai` (atalho em `~/.local/bin/estacao-ai`) | `%LOCALAPPDATA%\Programs\estacao-ai\estacao-ai.exe` (atalho `estacao.cmd`) |
| Scripts de hooks | `~/.local/lib/estacao-ai/hooks/` | `%LOCALAPPDATA%\Programs\estacao-ai\hooks\` |
| Dados, config e memória | `~/.local/share/estacao-ai/` | `%LOCALAPPDATA%\estacao-ai\` |
| Estado da Estação | `~/.local/share/estacao-ai/estacao/estado.json` | `%LOCALAPPDATA%\estacao-ai\estacao\estado.json` |
| Serviço | `~/.config/systemd/user/estacao-ai.service` | `service-host` / `estacao-ai app` |

## Instalar ou atualizar a partir do código
Requer Rust 1.95 (`rustup`; versão fixada em `rust-toolchain.toml`).

### Linux / macOS
```bash
cargo build --locked --release -p ai-memory-cli
mkdir -p ~/.local/lib/estacao-ai
install -m 755 target/release/estacao-ai ~/.local/lib/estacao-ai/estacao-ai
cp -a hooks LICENSE NOTICE README.md ~/.local/lib/estacao-ai/
ln -sfn ~/.local/lib/estacao-ai/estacao-ai ~/.local/bin/estacao-ai
estacao-ai setup --plan
estacao-ai setup --yes
```

### Windows (PowerShell)
```powershell
.\iniciar.ps1 -Recompilar
```

### Testes locais
```bash
cargo test -p ai-memory-web
cargo test -p ai-memory-cli --lib
node --test tests/e2e/estacao_frontend.mjs tests/e2e/nostr_key_generation.mjs
```

- O `setup` precisa da pasta `hooks/` ao lado do binário; sem ela, os hooks de Claude, Codex e Antigravity falham.
- Numa atualização no Linux: recompile, copie binário e `hooks/` de novo e rode `systemctl --user restart estacao-ai`. Repetir o `setup` não causa efeito colateral.
- Reinicie os agentes abertos depois de instalar ou atualizar.
