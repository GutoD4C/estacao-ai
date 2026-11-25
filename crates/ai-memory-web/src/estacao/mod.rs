//! Estação-ai: agentes cadastrados à mão, projetos, tarefas, chats e consumo.
//!
//! Tudo fica em `<data_dir>/estacao/estado.json`. Os agentes são CLIs locais
//! (claude, codex, gemini…) executadas na pasta do projeto, então os hooks de
//! memória já instalados registram cada execução na memória do projeto.
//!
//! shortcut: o estado inteiro é regravado em JSON a cada mudança; serve para um
//! operador local, migrar para SQLite se os chats passarem de alguns MB.

mod atualizacao;
mod catalogo;
mod consumo;
pub(crate) mod estado;
mod execucao;
mod http;
mod memoria;
pub(crate) mod nostr;
mod processo;
mod terminal;
#[cfg(test)]
mod testes;
mod youtube;

pub(crate) use atualizacao::{api_aplicar_atualizacao, api_atualizacao};
pub(crate) use catalogo::api_catalogo;
pub(crate) use consumo::api_consumo;
pub(crate) use http::{
    api_acao, api_estado, pagina_agentes, pagina_chat, pagina_consumo, pagina_projeto,
    pagina_projetos,
};
pub(crate) use memoria::{api_contexto, api_estante};
pub(crate) use terminal::api_terminal;
pub(crate) use youtube::api_youtube;
