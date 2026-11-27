//! Static asset handlers: Tailwind CSS and logo image.
//!
//! Assets are embedded at compile time so the binary is fully
//! self-contained — no runtime file access needed.

use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::IntoResponse;

/// Compiled Tailwind CSS. The path is emitted by `build.rs` via the
/// `AI_MEMORY_WEB_TAILWIND_CSS` cargo env var.
static TAILWIND_CSS: &str = include_str!(env!("AI_MEMORY_WEB_TAILWIND_CSS"));

/// Logo (PNG), embedded at compile time from `docs/logo.png`.
static LOGO: &[u8] = include_bytes!("../../../../docs/logo.png");

/// Vendored Three.js 0.158.0 runtime for the 3D Estação environments.
static THREE_JS: &str = include_str!("../../static/vendor/three.min.js");

/// Custom 3D engine integrating Jury (Chat) and Separated Dev Bays (Projects).
static ESTACAO_3D_JS: &str = include_str!("../../static/estacao-3d.js");

/// Estação page styles, kept out of the template so they can be edited alone.
static ESTACAO_CSS: &str = include_str!("../../static/estacao.css");

/// Capturas incluídas no tutorial da mesma versão do executável.
pub(crate) async fn imagem_manual(
    axum::extract::Path(name): axum::extract::Path<String>,
) -> axum::response::Response {
    let imagem: &[u8] = match name.as_str() {
        "entrar-por-qr.png" => {
            include_bytes!("../../../../docs/images/modelo-001/entrar-por-qr.png")
        }
        "salas.png" => include_bytes!("../../../../docs/images/modelo-001/salas.png"),
        "convites.png" => include_bytes!("../../../../docs/images/modelo-001/convites.png"),
        "chat-2d.png" => include_bytes!("../../../../docs/images/modelo-001/chat-2d.png"),
        "chale.png" => include_bytes!("../../../../docs/images/modelo-001/chale.png"),
        "modelos.png" => include_bytes!("../../../../docs/images/modelo-001/modelos.png"),
        "projeto.png" => include_bytes!("../../../../docs/images/modelo-001/projeto.png"),
        _ => return StatusCode::NOT_FOUND.into_response(),
    };
    ([(header::CONTENT_TYPE, "image/png")], imagem).into_response()
}

/// Self-hosted fonts shared with the management surface.
pub(crate) async fn font(
    axum::extract::Path(name): axum::extract::Path<String>,
) -> axum::response::Response {
    let bytes: &[u8] = match name.as_str() {
        "instrument-sans-latin-wdth-normal.woff2" => {
            include_bytes!("../../static/management/instrument-sans-latin-wdth-normal.woff2")
        }
        "bricolage-grotesque-latin-standard-normal.woff2" => include_bytes!(
            "../../static/management/bricolage-grotesque-latin-standard-normal.woff2"
        ),
        "commit-mono-latin-400-normal.woff2" => {
            include_bytes!("../../static/management/commit-mono-latin-400-normal.woff2")
        }
        _ => return StatusCode::NOT_FOUND.into_response(),
    };
    ([(header::CONTENT_TYPE, "font/woff2")], bytes).into_response()
}

/// `GET /static/tailwind.css`
pub(crate) async fn tailwind_css() -> impl IntoResponse {
    css_response(TAILWIND_CSS)
}

/// `GET /static/estacao.css`
pub(crate) async fn estacao_css() -> impl IntoResponse {
    css_response(ESTACAO_CSS)
}

fn css_response(body: &'static str) -> (StatusCode, HeaderMap, &'static str) {
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/css; charset=utf-8"),
    );
    (StatusCode::OK, headers, body)
}

/// `GET /static/three.min.js`
pub(crate) async fn three_js() -> impl IntoResponse {
    js_response(THREE_JS)
}

/// `GET /static/estacao-3d.js`
pub(crate) async fn estacao_3d_js() -> impl IntoResponse {
    js_response(ESTACAO_3D_JS)
}

/// `GET /static/estacao.js`
pub(crate) async fn estacao_js() -> impl IntoResponse {
    js_response(include_str!("../../static/estacao.js"))
}

/// `GET /static/estacao-memoria.js`
pub(crate) async fn estacao_memoria_js() -> impl IntoResponse {
    js_response(include_str!("../../static/estacao-memoria.js"))
}

/// `GET /static/estacao-grafo.js`
pub(crate) async fn estacao_grafo_js() -> impl IntoResponse {
    js_response(include_str!("../../static/estacao-grafo.js"))
}

/// `GET /static/estacao-3d-cena.js`
pub(crate) async fn estacao_3d_cena_js() -> impl IntoResponse {
    js_response(include_str!("../../static/estacao-3d-cena.js"))
}

/// `GET /static/estacao-3d-avatares.js`
pub(crate) async fn estacao_3d_avatares_js() -> impl IntoResponse {
    js_response(include_str!("../../static/estacao-3d-avatares.js"))
}

/// `GET /static/estacao-3d-animacoes.js`
pub(crate) async fn estacao_3d_animacoes_js() -> impl IntoResponse {
    js_response(include_str!("../../static/estacao-3d-animacoes.js"))
}

/// `GET /static/estacao-3d-camera.js`
pub(crate) async fn estacao_3d_camera_js() -> impl IntoResponse {
    js_response(include_str!("../../static/estacao-3d-camera.js"))
}

/// `GET /static/estacao-3d-nostr.js`
pub(crate) async fn estacao_3d_nostr_js() -> impl IntoResponse {
    js_response(include_str!("../../static/estacao-3d-nostr.js"))
}

pub(crate) async fn nostr_crypto() -> impl IntoResponse {
    js_response(include_str!("../../static/vendor/nostr-crypto.js"))
}

pub(crate) async fn nostr_qr() -> impl IntoResponse {
    js_response(include_str!("../../static/vendor/nostr-qr.js"))
}

/// `GET /static/estacao-cookie.js`
pub(crate) async fn estacao_cookie_js() -> impl IntoResponse {
    js_response(concat!(
        include_str!("../../templates/_js_cookie.html"),
        "\nexport { cookie };\n"
    ))
}

/// `GET /static/estacao-impressao.css`
pub(crate) async fn estacao_impressao_css() -> impl IntoResponse {
    css_response(include_str!("../../static/estacao-impressao.css"))
}

fn js_response(body: &'static str) -> (StatusCode, HeaderMap, &'static str) {
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/javascript; charset=utf-8"),
    );
    (StatusCode::OK, headers, body)
}

/// `GET /static/logo.png`
pub(crate) async fn logo() -> impl IntoResponse {
    png_response(LOGO)
}

/// `GET /favicon.ico` — same PNG as the header logo (browsers request this path by default).
pub(crate) async fn favicon() -> impl IntoResponse {
    png_response(LOGO)
}

fn png_response(bytes: &'static [u8]) -> (StatusCode, HeaderMap, &'static [u8]) {
    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("image/png"));
    (StatusCode::OK, headers, bytes)
}

#[cfg(test)]
mod tests {
    /// #2003: the three shipped faces are Latin subsets, so the Unicode
    /// characters the templates use as icons fall through every text stack.
    /// Each stack has to reach a symbol face, after `system-ui` so Latin text
    /// keeps the platform font it had.
    #[test]
    fn text_font_stacks_reach_a_symbol_face_after_system_ui() {
        let stacks: Vec<&str> = super::TAILWIND_CSS
            .split("font-family:")
            .skip(1)
            .filter_map(|rest| rest.split([';', '}']).next())
            .filter(|stack| {
                stack.starts_with("Management Sans,") || stack.starts_with("Management Display,")
            })
            .collect();
        assert!(!stacks.is_empty(), "no text font stack in the stylesheet");
        for stack in stacks {
            let system_ui = stack.find("system-ui").unwrap_or_else(|| panic!("{stack}"));
            for face in [
                "Apple Symbols",
                "Segoe UI Symbol",
                "Noto Sans Symbols",
                "DejaVu Sans",
            ] {
                let at = stack
                    .find(face)
                    .unwrap_or_else(|| panic!("{face} missing from {stack}"));
                assert!(system_ui < at, "{face} precedes system-ui in {stack}");
            }
        }
    }
}
