---
tags: [estacao-ai, consumo]
data-base: 16/11/2026
---
# Consumo e limites

A aba **Consumo e uso** mostra, por modelo de IA cadastrado (e também uma tabela com todos os modelos detectados pelos hooks):
- percentual **livre e usado** nas janelas de **5 horas** e **semanal**, com a data de renovação;
- **tokens medidos por modelo** em cada janela (entrada nova + saída e cache), além do total do fornecedor quando diferente;
- quantas execuções a Estação fez e quanto tempo levaram.

## Configuração automática
Ao adicionar um modelo pela tela **Modelos de IA**, a Estação já deixa o consumo pronto:
- O comando usa a saída JSON da CLI (`--output-format json`), e a Estação **mede os tokens de cada execução** sozinha, mesmo para fornecedores sem limite local.
- **Claude Code:** liga a linha de status da Estação em `~/.claude/settings.json`, só se ainda não houver uma. A cópia do original fica em `settings.json.antes-estacao-ai`.
- **Codex:** lê os limites dos registros de sessão, sem configurar nada.

## De onde vêm os números
| Fornecedor | % de 5 h e semanal | Tokens |
|---|---|---|
| Claude Code | Linha de status (`estacao/limites/claude.json`), configurada ao adicionar | Medidos pela Estação + hooks |
| Codex | Último `rate_limits` em `~/.codex/sessions/` | Hooks |
| Antigravity | Não informa localmente | Medidos pela Estação (JSON do `agy`) |
| Gemini, OpenCode e outros | Não informam localmente | Hooks |

O Claude Code só atualiza os limites enquanto está aberto, em planos de assinatura; o número fica congelado no último valor recebido.

> [!note] Tokens por modelo e limites da assinatura
> Quando o campo **Modelo** está preenchido, os tokens são filtrados para aquele modelo (ex.: `opus` vs `sonnet`), exibindo também o total da CLI/fornecedor para comparação. Já os percentuais de cota (5 h / semanal) são compartilhados pelo plano/fornecedor.
