# Créditos e Licença

## Origem e autoria da base (`ai-memory`)

A **Estação I.A** foi construída a partir do projeto **[ai-memory](https://github.com/akitaonrails/ai-memory)**, criado por **Fabio Akita** e distribuído sob a **Licença MIT**.

### O que foi desenvolvido originalmente por Fabio Akita (`ai-memory`)

Os seguintes módulos e componentes centrais do repositório têm como base o trabalho original de **Fabio Akita**:

- **`crates/ai-memory-core`**: tipos de domínio, identificadores, sanitização de privacidade, roteamento e internacionalização.
- **`crates/ai-memory-store`**: camada de persistência em SQLite (modo WAL, migrações, fila de escrita dedicada e busca).
- **`crates/ai-memory-wiki`**: camada de arquivos Markdown portáteis, frontmatter, escrita atômica e sincronização com o índice SQLite.
- **`crates/ai-memory-consolidate`**: pipeline de consolidação de sessões, envelhecimento de memória, perfis, lint e auto-melhoria.
- **`crates/ai-memory-llm`**: clientes tipados de provedores de LLM e embeddings.
- **`crates/ai-memory-mcp`**: servidor MCP (Model Context Protocol) exposto para agentes de codificação.
- **`crates/ai-memory-hooks`**: captura de eventos de ciclo de vida de agentes via hooks.
- **`crates/ai-memory-workstream`**: adaptadores nativos para sessões gerenciadas (`estacao-ai run`).
- **Base de `crates/ai-memory-web` e `crates/ai-memory-cli`**: servidor HTTP/autenticação, visualização de memória/wiki e comandos de CLI do motor de memória.

### O que foi adicionado na Estação I.A

Sobre essa base, a **Estação I.A** adiciona a camada visual e de orquestração multi-agentes (em `crates/ai-memory-web/src/estacao/` e ativos associados):

- Salas de **Chat 2D** e **Chalé 3D** com personagens caninos, debates estruturados, avaliação do Mediador e **Estante de Conhecimento**.
- **Projetos 2D** com coordenação pelo **Pensador**, painel dinâmico de **TAREFAS** e **Multi-Terminal** integrado.
- Autenticação, presença e compartilhamento de salas via **Nostr** (`npub`/`nsec`/NIP-46/NIP-07).
- Detecção automática de CLIs de IA, catálogo de papéis, consumo e empacotamento desktop.

---

## Licença MIT

O texto legal oficial encontra-se no arquivo [`LICENSE`](../../LICENSE) na raiz do repositório. Abaixo consta a licença MIT conforme deixada por Fabio Akita:

> **Licença MIT**
>
> **Direitos autorais (c) 2026 Fabio Akita**
>
> Fica concedida permissão, gratuitamente, a qualquer pessoa que obtenha uma cópia deste software e arquivos de documentação associados (o "Software"), para lidar no Software sem restrições, incluindo, sem limitação, os direitos de usar, copiar, modificar, mesclar, publicar, distribuir, sublicenciar e/ou vender cópias do Software e permitir que as pessoas a quem o Software é fornecido o façam, sujeito às seguintes condições:
>
> O aviso de direitos autorais acima e este aviso de permissão devem ser incluídos em todas as cópias ou partes substanciais do Software.
>
> O SOFTWARE É FORNECIDO "NO ESTADO EM QUE SE ENCONTRA", SEM GARANTIA DE QUALQUER TIPO, EXPRESSA OU IMPLÍCITA, INCLUINDO, MAS NÃO SE LIMITANDO ÀS GARANTIAS DE COMERCIABILIDADE, ADEQUAÇÃO A UM FIM ESPECÍFICO E NÃO VIOLAÇÃO. EM NENHUM CASO OS AUTORES OU DETENTORES DOS DIREITOS AUTORAIS SERÃO RESPONSABILIZADOS POR QUAISQUER RECLAMAÇÕES, DANOS OU OUTRAS RESPONSABILIDADES, SEJA EM AÇÃO CONTRATUAL, EXTRACONTRATUAL OU DE OUTRA NATUREZA, DECORRENTE DE, OU EM CONEXÃO COM O SOFTWARE OU O USO OU OUTRAS NEGOCIAÇÕES NO SOFTWARE.
