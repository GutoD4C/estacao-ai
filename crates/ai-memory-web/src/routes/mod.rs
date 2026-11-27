//! Route module — assembles the public axum router.

use std::sync::Arc;

use axum::Router;
use axum::routing::{get, post};

use crate::html_auth::HtmlAuthRedirectConfig;
use crate::state::WebState;

mod agents;
mod api;
mod documentation;
mod graph;
mod health;
#[allow(dead_code)] // só a API JSON usa; a página de histórico saiu da Estação-ai.
mod history;
mod index;
mod login;
mod page;
mod pending;
mod project;
#[allow(dead_code)] // só a recuperação de contexto usa; a página de busca saiu da Estação-ai.
pub(crate) mod search;
mod session;
pub(crate) mod statics;

/// Whether the viewer may read `workspace/project` (#708).
///
/// For the routes that read a repository by name without resolving a scope
/// first — the page views and the project listing. Those went straight from a
/// URL to the page body, so the guard never saw them.
///
/// No viewer — an install with no database users, or root — returns
/// `Ok(None)` without a lookup, so these routes behave exactly as they did
/// before. Otherwise returns the scope the check resolved.
pub(crate) async fn authorize_read(
    state: &WebState,
    viewer: Option<axum::Extension<ai_memory_core::AuthorizedViewer>>,
    workspace: &str,
    project: &str,
) -> Result<Option<ai_memory_store::ResolvedScope>, ai_memory_store::ScopeResolutionError> {
    let Some(axum::Extension(viewer)) = viewer else {
        return Ok(None);
    };
    ai_memory_store::lookup_existing_scope_guarded(
        &state.reader,
        workspace,
        project,
        Some(viewer.user()),
        ai_memory_store::ProjectAccess::Read,
    )
    .await
    .map(Some)
}

/// Resolve `workspace/project` for a route that needs its ids, refusing a
/// viewer without read access (#708).
///
/// Unlike [`authorize_read`] it always resolves, viewer or not, because the
/// history and session views read by id. No-create and fail-closed, like
/// every read path.
pub(crate) async fn resolve_read_scope(
    state: &WebState,
    viewer: Option<ai_memory_core::UserId>,
    workspace: &str,
    project: &str,
) -> Result<ai_memory_store::ResolvedScope, ai_memory_store::ScopeResolutionError> {
    ai_memory_store::lookup_existing_scope_guarded(
        &state.reader,
        workspace,
        project,
        viewer,
        ai_memory_store::ProjectAccess::Read,
    )
    .await
}

/// Refuse a root-only page unless the caller may use `/admin`, with the same
/// `Capability::Admin` decision `require_root_for_multiuser_admin` makes:
/// anonymous on a multi-user server is 401, a non-root user 403.
pub(crate) async fn require_admin(
    i18n: &ai_memory_core::i18n::Localizer,
    state: &WebState,
    level: Option<axum::Extension<ai_memory_core::AuthLevel>>,
) -> Result<(), axum::response::Response> {
    use axum::http::StatusCode;
    use axum::response::{Html, IntoResponse};
    let level = level.map_or(
        ai_memory_core::AuthLevel::Anonymous,
        |axum::Extension(level)| level,
    );
    let distinguishes_operators = state
        .reader
        .distinguishes_operators(state.trusted_proxy_identity)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())?;
    match level.authorize(ai_memory_core::Capability::Admin, distinguishes_operators) {
        Ok(()) => Ok(()),
        Err(e) if e.is_authentication_required() => Err(StatusCode::UNAUTHORIZED.into_response()),
        Err(_) => {
            use askama::Template;
            // Unmarked, so the HTML auth redirect shows this refusal instead
            // of sending the user to the change-password form.
            Err(
                match (crate::templates::AdminRequiredView { i18n: i18n.clone() }).render() {
                    Ok(body) => (StatusCode::FORBIDDEN, Html(body)).into_response(),
                    Err(_) => StatusCode::FORBIDDEN.into_response(),
                },
            )
        }
    }
}

/// Build the read-only wiki page router (no static assets — those are public).
pub(crate) fn build(state: Arc<WebState>) -> Router {
    crate::localization::apply(
        Router::new()
            .route("/", get(index::handler))
            .route("/docs", get(documentation::index))
            .route("/docs/{slug}", get(documentation::page))
            .route(
                "/w/{workspace}/{project}/agents/{agent}",
                get(agents::handler),
            )
            .route("/graph", get(graph::global_handler))
            .route("/w/{workspace}/{project}", get(project::handler))
            .route(
                "/w/{workspace}/{project}/graph",
                get(graph::project_handler),
            )
            .route("/w/{workspace}/{project}/p/{*path}", get(page::handler))
            .route(
                "/w/{workspace}/{project}/s/{session_id}",
                get(session::handler),
            )
            .route("/pending", get(pending::handler))
            .route("/health", get(health::handler))
            .with_state(state),
    )
}

/// The empty desktop shell is public. Its data and commands require a Nostr session.
pub(crate) fn station(state: Arc<WebState>) -> Router {
    crate::localization::apply(
        Router::new()
            .route("/chat", get(crate::estacao::pagina_chat))
            .route("/projetos", get(crate::estacao::pagina_projetos))
            .route("/projetos/{id}", get(crate::estacao::pagina_projeto))
            .route("/agentes", get(crate::estacao::pagina_agentes))
            .route("/modelos", get(crate::estacao::pagina_agentes))
            .route("/consumo", get(crate::estacao::pagina_consumo))
            .merge(
                Router::new()
                    .route("/estacao/api/sessao", get(crate::estacao::nostr::sessao))
                    .route("/estacao/api/estado", get(crate::estacao::api_estado))
                    .route(
                        "/estacao/api/contexto/{id}",
                        get(crate::estacao::api_contexto),
                    )
                    .route("/estacao/api/consumo", get(crate::estacao::api_consumo))
                    .route("/estacao/api/catalogo", get(crate::estacao::api_catalogo))
                    .route("/estacao/api/youtube", get(crate::estacao::api_youtube))
                    .route("/estacao/api/estante", get(crate::estacao::api_estante))
                    .route(
                        "/estacao/api/memorias/resumo",
                        get(crate::estacao::api_resumo_memorias),
                    )
                    .route(
                        "/estacao/api/memorias/inspecionar",
                        get(crate::estacao::api_inspecionar_memoria),
                    )
                    .route(
                        "/estacao/api/memorias/exportar",
                        post(crate::estacao::api_exportar_memorias),
                    )
                    .route(
                        "/estacao/api/memorias/importar",
                        post(crate::estacao::api_importar_memorias)
                            .layer(axum::extract::DefaultBodyLimit::max(128 * 1024 * 1024)),
                    )
                    .route(
                        "/estacao/api/atualizacao",
                        get(crate::estacao::api_atualizacao),
                    )
                    .route(
                        "/estacao/api/atualizacao/aplicar",
                        post(crate::estacao::api_aplicar_atualizacao),
                    )
                    .route("/estacao/api/acao", post(crate::estacao::api_acao))
                    .route("/estacao/api/terminal", post(crate::estacao::api_terminal))
                    .route_layer(axum::middleware::from_fn_with_state(
                        state.clone(),
                        crate::estacao::nostr::exigir_sessao,
                    )),
            )
            .route("/estacao/api/desafio", get(crate::estacao::nostr::desafio))
            .route("/estacao/api/entrar", post(crate::estacao::nostr::entrar))
            .route("/estacao/api/sair", post(crate::estacao::nostr::sair))
            .with_state(state),
    )
}

/// Public builtin surface: static assets.
pub(crate) fn build_public_auth(cfg: Arc<HtmlAuthRedirectConfig>) -> Router {
    crate::localization::apply(
        Router::new()
            .route("/login", get(login::login))
            .route("/change-password", get(login::change_password))
            .route("/static/tailwind.css", get(statics::tailwind_css))
            .route("/static/three.min.js", get(statics::three_js))
            .route("/static/estacao-3d.js", get(statics::estacao_3d_js))
            .route("/static/estacao.js", get(statics::estacao_js))
            .route(
                "/static/estacao-memoria.js",
                get(statics::estacao_memoria_js),
            )
            .route("/static/estacao-grafo.js", get(statics::estacao_grafo_js))
            .route(
                "/static/estacao-3d-cena.js",
                get(statics::estacao_3d_cena_js),
            )
            .route(
                "/static/estacao-3d-avatares.js",
                get(statics::estacao_3d_avatares_js),
            )
            .route(
                "/static/estacao-3d-animacoes.js",
                get(statics::estacao_3d_animacoes_js),
            )
            .route(
                "/static/estacao-3d-camera.js",
                get(statics::estacao_3d_camera_js),
            )
            .route(
                "/static/estacao-3d-nostr.js",
                get(statics::estacao_3d_nostr_js),
            )
            .route("/static/nostr-crypto.js", get(statics::nostr_crypto))
            .route("/static/nostr-qr.js", get(statics::nostr_qr))
            .route("/static/estacao-cookie.js", get(statics::estacao_cookie_js))
            .route(
                "/static/estacao-impressao.css",
                get(statics::estacao_impressao_css),
            )
            .route("/static/estacao.css", get(statics::estacao_css))
            .route("/static/logo.png", get(statics::logo))
            .route("/static/manual/{name}", get(statics::imagem_manual))
            .route("/static/{font}", get(statics::font))
            .with_state(cfg),
    )
}

/// Build the read-only JSON API router from a shared [`WebState`].
pub(crate) fn build_api(state: Arc<WebState>) -> Router {
    api::build(state)
}

/// Standalone `GET /favicon.ico` router. Mounted at the **host root**
/// by `serve`, OUTSIDE the `/web` nest and OUTSIDE the `--base-path`
/// prefix, because browsers auto-fetch `/favicon.ico` from the host
/// origin regardless of where the rest of the app is mounted. Putting
/// it inside the web router (as the original PR #79 did) made it
/// reachable only at `/web/favicon.ico` — never seen by the browser's
/// automatic fetch — so the in-page `<link rel="icon">` was the only
/// thing actually showing the icon.
pub(crate) fn build_favicon() -> Router {
    Router::new().route("/favicon.ico", get(statics::favicon))
}
