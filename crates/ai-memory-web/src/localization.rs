//! Request-local language selection. Catalogs are parsed once per router.

use ai_memory_core::i18n::{Language, Localizer};
use axum::{
    body::Body,
    http::{Request, header},
    middleware::{self, Next},
    response::Response,
};

#[derive(Clone)]
struct Catalogs(Vec<Localizer>);

pub(crate) fn apply(router: axum::Router) -> axum::Router {
    router.layer(middleware::from_fn_with_state(
        Catalogs(Language::ALL.iter().copied().map(Localizer::new).collect()),
        localize,
    ))
}

async fn localize(
    axum::extract::State(catalogs): axum::extract::State<Catalogs>,
    mut request: Request<Body>,
    next: Next,
) -> Response {
    // Estação-ai: a interface só tem português do Brasil (sem seletor de idioma).
    let language = Language::PortugueseBrazil;
    let i18n = catalogs
        .0
        .iter()
        .find(|catalog| catalog.language() == language)
        .cloned()
        .unwrap_or_default();
    request.extensions_mut().insert(i18n);
    let mut response = next.run(request).await;
    if response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with("text/html"))
    {
        response.headers_mut().insert(
            header::CONTENT_LANGUAGE,
            header::HeaderValue::from_static(language.tag()),
        );
        response.headers_mut().append(
            header::VARY,
            header::HeaderValue::from_static("Accept-Language, Cookie"),
        );
    }
    response
}
