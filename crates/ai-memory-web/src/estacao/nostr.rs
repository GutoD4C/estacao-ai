//! Sessões do painel local. Um assinador remoto recebe o desafio via NIP-46 cifrado.
use super::{
    estado::{NostrPerfil, agora, estacao},
    http::verificar_origem,
};
use crate::state::WebState;
use axum::{
    Json,
    extract::{OriginalUri, Request, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    middleware::Next,
    response::{AppendHeaders, IntoResponse, Response},
};
use nostr::{Event, ToBech32};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use std::{
    collections::HashMap,
    sync::LazyLock,
    time::{Duration, Instant},
};
use tokio::sync::{Mutex, RwLock};
use uuid::Uuid;

static DESAFIOS: LazyLock<Mutex<HashMap<String, Instant>>> = LazyLock::new(Default::default);
// A Estação executa CLIs e mantém um perfil por instalação. Uma troca de operador
// invalida todas as sessões da conta anterior antes de gravar o novo perfil.
static TROCA_CONTA: RwLock<()> = RwLock::const_new(());
const TTL: i64 = ai_memory_store::web_sessions::SESSION_TTL_MICROS / 1_000_000;
const CABECALHO: &str = "x-estacao-sessao";
const COOKIE: &str = "estacao_dispositivo";
const COOKIE_NOSTR: &str = "estacao_operador";

fn hash_dispositivo(token: &str) -> String {
    format!("nostr:{:x}", Sha256::digest(token.as_bytes()))
}

/// Called under the account write lock, after validating the Nostr signature.
fn consumir_vinculo(state: &WebState, headers: &HeaderMap) -> bool {
    let Some(ticket) = headers
        .get("x-estacao-vinculo")
        .and_then(|v| v.to_str().ok())
    else {
        return false;
    };
    let file = state.wiki.data_dir().join(".nostr-desktop");
    let valido = std::fs::metadata(&file)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.elapsed().ok())
        .is_some_and(|age| age < Duration::from_secs(600))
        && std::fs::read_to_string(&file).ok().as_deref()
            == Some(format!("{:x}", Sha256::digest(ticket.as_bytes())).as_str());
    valido && std::fs::remove_file(file).is_ok()
}

fn cookie<'a>(headers: &'a HeaderMap, nome: &str) -> Option<&'a str> {
    headers
        .get("cookie")?
        .to_str()
        .ok()?
        .split(';')
        .filter_map(|c| c.trim().split_once('='))
        .find_map(|(k, v)| (k == nome).then_some(v))
}

fn hash_token(token: &str, headers: &HeaderMap, dispositivo: bool) -> String {
    let mut hash = Sha256::new();
    if dispositivo {
        hash.update(cookie(headers, "ai_memory_session").unwrap_or_default());
        hash.update([0]);
    }
    hash.update(token);
    format!("{:x}", hash.finalize())
}

fn porta_valida(porta: &str) -> bool {
    !porta.is_empty() && porta.bytes().all(|b| b.is_ascii_digit()) && porta.parse::<u16>().is_ok()
}

fn host_local(host: &str) -> bool {
    if host.eq_ignore_ascii_case("localhost") || host == "127.0.0.1" || host == "[::1]" {
        return true;
    }
    if let Some(porta) = host.strip_prefix("[::1]:") {
        return porta_valida(porta);
    }
    let Some((nome, porta)) = host.split_once(':') else {
        return false;
    };
    (nome.eq_ignore_ascii_case("localhost") || nome == "127.0.0.1") && porta_valida(porta)
}

fn origem_http_local(origem: &str) -> Option<&str> {
    let autoridade = origem.trim().strip_prefix("http://")?;
    host_local(autoridade).then_some(autoridade)
}

fn http_local(headers: &HeaderMap) -> bool {
    if headers.contains_key(header::FORWARDED) {
        return false;
    }
    let xfp_ok = headers.get_all("x-forwarded-proto").iter().all(|v| {
        v.to_str()
            .is_ok_and(|s| s.split(',').all(|p| p.trim().eq_ignore_ascii_case("http")))
    });
    if !xfp_ok {
        return false;
    }
    let xfh_ok = headers.get_all("x-forwarded-host").iter().all(|v| {
        v.to_str()
            .is_ok_and(|s| s.split(',').all(|h| host_local(h.trim())))
    });
    if !xfh_ok {
        return false;
    }
    let mut hosts = headers.get_all(header::HOST).iter();
    let (Some(host), None) = (hosts.next(), hosts.next()) else {
        return false;
    };
    let Ok(host) = host.to_str().map(str::trim) else {
        return false;
    };
    if !host_local(host) {
        return false;
    }
    let mut origins = headers.get_all(header::ORIGIN).iter();
    if let Some(origin) = origins.next() {
        if origins.next().is_some() {
            return false;
        }
        let Ok(origin) = origin.to_str() else {
            return false;
        };
        let Some(autoridade) = origem_http_local(origin) else {
            return false;
        };
        if !autoridade.eq_ignore_ascii_case(host) {
            return false;
        }
    }
    true
}

fn raiz_cookie(uri: &axum::http::Uri) -> &str {
    uri.path()
        .rsplit_once("/estacao/api/")
        .map_or("", |(raiz, _)| raiz)
        .trim_end_matches('/')
}

fn formatar_cookie_caminho(
    nome: &str,
    headers: &HeaderMap,
    token: &str,
    idade: i64,
    caminho: &str,
) -> String {
    let seguro = if http_local(headers) { "" } else { "; Secure" };
    format!("{nome}={token}; Path={caminho}; HttpOnly; SameSite=Strict; Max-Age={idade}{seguro}")
}

fn formatar_cookie(
    nome: &str,
    headers: &HeaderMap,
    token: &str,
    idade: i64,
    uri: &axum::http::Uri,
) -> String {
    let raiz = raiz_cookie(uri);
    let caminho = if raiz.is_empty() { "/" } else { raiz };
    formatar_cookie_caminho(nome, headers, token, idade, caminho)
}

fn formatar_cookie_legado(
    nome: &str,
    headers: &HeaderMap,
    token: &str,
    idade: i64,
    uri: &axum::http::Uri,
) -> Option<String> {
    let raiz = raiz_cookie(uri);
    if raiz.is_empty() {
        return None;
    }
    Some(formatar_cookie_caminho(
        nome,
        headers,
        token,
        idade,
        &format!("{raiz}/"),
    ))
}

fn cookie_dispositivo(
    headers: &HeaderMap,
    token: &str,
    idade: i64,
    uri: &axum::http::Uri,
) -> String {
    formatar_cookie(COOKIE_NOSTR, headers, token, idade, uri)
}

fn expirar_cookie(nome: &str, headers: &HeaderMap, uri: &axum::http::Uri) -> String {
    formatar_cookie(nome, headers, "", 0, uri)
}

fn expirar_cookie_barra(nome: &str, headers: &HeaderMap, uri: &axum::http::Uri) -> Option<String> {
    formatar_cookie_legado(nome, headers, "", 0, uri)
}

fn adicionar_set_cookie(mut resp: Response, cookie: String) -> Response {
    if let Ok(valor) = HeaderValue::from_str(&cookie) {
        resp.headers_mut().append(header::SET_COOKIE, valor);
    }
    resp
}

fn token_requisicao(headers: &HeaderMap) -> Option<&str> {
    let token = headers.get(CABECALHO)?.to_str().ok()?;
    if token == "dispositivo" {
        cookie(headers, COOKIE_NOSTR).or_else(|| cookie(headers, COOKIE))
    } else {
        Some(token)
    }
}

pub(crate) async fn desafio() -> Response {
    let mut ativos = DESAFIOS.lock().await;
    ativos.retain(|_, t| t.elapsed() < Duration::from_secs(90));
    if ativos.len() >= 1024 {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    }
    let desafio = Uuid::new_v4().to_string();
    ativos.insert(desafio.clone(), Instant::now());
    ([("cache-control", "no-store")], Json(desafio)).into_response()
}

pub(crate) async fn entrar(
    OriginalUri(uri): OriginalUri,
    State(state): State<Arc<WebState>>,
    headers: HeaderMap,
    Json(prova): Json<Event>,
) -> Response {
    if let Err(r) = verificar_origem(&headers) {
        return r.into_response();
    }
    if prova.kind.as_u16() != 20081
        || prova.content != "estacao-ai/login"
        || prova.verify().is_err()
    {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Some(desafio) = prova.tags.iter().find_map(|t| {
        let s = t.as_slice();
        if s.first().map(|x| x.as_str()) == Some("challenge") {
            s.get(1).map(|x| x.as_str())
        } else {
            None
        }
    }) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    if DESAFIOS
        .lock()
        .await
        .remove(desafio)
        .is_none_or(|t| t.elapsed() >= Duration::from_secs(90))
    {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let npub = prova.pubkey.to_bech32().expect("fixed length public key");
    let _troca = TROCA_CONTA.write().await;
    let est = estacao(&state);
    let local = consumir_vinculo(&state, &headers);
    if !local && est.estado.lock().await.nostr_perfil.npub != npub {
        return StatusCode::FORBIDDEN.into_response();
    }
    let token = Uuid::new_v4().to_string();
    let dispositivo = headers
        .get("x-estacao-dispositivo")
        .is_some_and(|h| h == "1");
    if let Err(e) = estacao(&state)
        .mudar(|e| {
            if e.nostr_perfil.npub != npub {
                e.dispositivos_nostr.clear();
                e.nostr_perfil = NostrPerfil::default();
            }
            let inicio = agora();
            e.dispositivos_nostr.retain(|_, vence| *vence > inicio);
            e.dispositivos_nostr.insert(
                if dispositivo {
                    hash_dispositivo(&token)
                } else {
                    hash_token(&token, &headers, false)
                },
                inicio + if dispositivo { TTL } else { 12 * 3600 },
            );
            let perfil = &mut e.nostr_perfil;
            perfil.npub = npub.clone();
            perfil.pubkey_hex = prova.pubkey.to_hex();
            perfil.autenticado = true;
            if perfil.relay_url.is_empty() || perfil.relay_url == "ws://127.0.0.1:8080" {
                perfil.relay_url = "wss://nostr.mom".into();
            }
            let contatos_npub: std::collections::HashSet<&str> = e
                .nostr_contatos
                .iter()
                .map(|c| c.npub.trim())
                .filter(|n| !n.is_empty())
                .collect();
            for a in &mut e.agentes {
                let eh_remoto = a.comando.trim() == "echo '(agente remoto Nostr)'"
                    || contatos_npub.contains(a.dono_npub.trim());
                if a.dono_npub.is_empty() || !eh_remoto {
                    a.dono_npub.clone_from(&npub);
                }
            }
            for p in &mut e.projetos {
                if p.dono_npub.is_empty() {
                    p.dono_npub.clone_from(&npub);
                }
            }
            Ok(())
        })
        .await
    {
        return (StatusCode::INTERNAL_SERVER_ERROR, e).into_response();
    }
    if dispositivo {
        let mut resp = (
            [
                ("cache-control", "no-store".to_owned()),
                (
                    "set-cookie",
                    cookie_dispositivo(&headers, &token, TTL, &uri),
                ),
            ],
            Json(prova.pubkey.to_hex()),
        )
            .into_response();
        // Remove eventual cookie antigo gravado em `Path=/web/` (com barra final),
        // que segundo a RFC 6265 não era enviado para a rota `/web` (Memória dos projetos).
        if let Some(antigo) = expirar_cookie_barra(COOKIE_NOSTR, &headers, &uri) {
            resp = adicionar_set_cookie(resp, antigo);
        }
        resp
    } else {
        ([("cache-control", "no-store")], Json(token)).into_response()
    }
}

pub(crate) async fn exigir_sessao(
    State(state): State<Arc<WebState>>,
    mut req: Request,
    next: Next,
) -> Response {
    let leitura = TROCA_CONTA.read().await;
    let est = estacao(&state);
    let e = est.estado.lock().await;
    let valido = token_requisicao(req.headers())
        .and_then(|t| {
            let headers = req.headers();
            let device = headers[CABECALHO] == "dispositivo";
            let hash = if device && cookie(headers, COOKIE_NOSTR).is_some() {
                hash_dispositivo(t)
            } else {
                hash_token(t, headers, device)
            };
            e.dispositivos_nostr.get(&hash)
        })
        .is_some_and(|vence| *vence > agora());
    let conta_correta = req
        .headers()
        .get("x-estacao-conta")
        .is_none_or(|c| c.as_bytes() == e.nostr_perfil.pubkey_hex.as_bytes());
    if !valido || !conta_correta {
        return (StatusCode::UNAUTHORIZED, [("x-estacao-login", "1")]).into_response();
    }
    drop(e);
    drop(leitura);
    // The signed operator owns this desktop. This extension is scoped to
    // this router, never the server's administrative or machine endpoints.
    req.extensions_mut()
        .get_or_insert(ai_memory_core::AuthLevel::Root);
    next.run(req).await
}

/// A remembered owner can also read the built-in wiki pages.
pub async fn dispositivo_do_operador(state: &WebState, headers: &HeaderMap) -> bool {
    let Some(token) = cookie(headers, COOKIE_NOSTR) else {
        return false;
    };
    estacao(state)
        .estado
        .lock()
        .await
        .dispositivos_nostr
        .get(&hash_dispositivo(token))
        .is_some_and(|vence| *vence > agora())
}

// O navegador cifra o assinador com uma chave distinta da credencial HTTP.
// O estado em disco contém apenas o hash do token e não permite abrir o cofre.
fn sessao_dispositivo(
    headers: &HeaderMap,
    uri: &axum::http::Uri,
    token: &str,
    conta: String,
    vence: i64,
) -> Response {
    let chave = Sha256::digest([b"estacao/signer/v1\0".as_slice(), token.as_bytes()].concat());
    let mut resp = (
        [
            ("cache-control", "no-store".to_owned()),
            ("x-estacao-cofre", format!("{chave:x}")),
            ("x-estacao-vence", vence.to_string()),
            (
                "set-cookie",
                cookie_dispositivo(headers, token, (vence - agora()).max(0), uri),
            ),
        ],
        Json(conta),
    )
        .into_response();
    if let Some(antigo) = expirar_cookie_barra(COOKIE_NOSTR, headers, uri) {
        resp = adicionar_set_cookie(resp, antigo);
    }
    resp
}

pub(crate) async fn sessao(
    OriginalUri(uri): OriginalUri,
    State(state): State<Arc<WebState>>,
    headers: HeaderMap,
) -> Response {
    let est = estacao(&state);
    let dispositivo = headers.get(CABECALHO).is_some_and(|h| h == "dispositivo");
    if dispositivo
        && cookie(&headers, COOKIE_NOSTR).is_none()
        && let Some(old) = cookie(&headers, COOKIE)
    {
        let token = Uuid::new_v4().to_string();
        let agora_ts = agora();
        let migrated = est
            .mudar(|e| {
                let Some(expiry) = e
                    .dispositivos_nostr
                    .remove(&hash_token(old, &headers, true))
                else {
                    return Err("Sessão expirada".to_string());
                };
                if expiry <= agora_ts {
                    return Ok(None);
                }
                e.dispositivos_nostr
                    .insert(hash_dispositivo(&token), expiry);
                Ok(Some((e.nostr_perfil.pubkey_hex.clone(), expiry)))
            })
            .await;
        return match migrated {
            Ok(Some((key, expiry))) => {
                let mut resp = adicionar_set_cookie(
                    sessao_dispositivo(&headers, &uri, &token, key, expiry),
                    expirar_cookie(COOKIE, &headers, &uri),
                );
                if let Some(barra) = expirar_cookie_barra(COOKIE, &headers, &uri) {
                    resp = adicionar_set_cookie(resp, barra);
                }
                resp
            }
            Ok(None) | Err(_) => {
                let mut resp = adicionar_set_cookie(
                    StatusCode::UNAUTHORIZED.into_response(),
                    expirar_cookie(COOKIE, &headers, &uri),
                );
                if let Some(barra) = expirar_cookie_barra(COOKIE, &headers, &uri) {
                    resp = adicionar_set_cookie(resp, barra);
                }
                resp
            }
        };
    }
    if dispositivo && let Some(token) = cookie(&headers, COOKIE_NOSTR) {
        let hash = hash_dispositivo(token);
        let agora_ts = agora();
        let encontrado = {
            let estado = est.estado.lock().await;
            estado
                .dispositivos_nostr
                .get(&hash)
                .copied()
                .map(|vence| (estado.nostr_perfil.pubkey_hex.clone(), vence))
        };
        return match encontrado {
            Some((pubkey, vence)) if vence > agora_ts => {
                sessao_dispositivo(&headers, &uri, token, pubkey, vence)
            }
            Some(_) => {
                let _ = est
                    .mudar(|e| {
                        if e.dispositivos_nostr
                            .get(&hash)
                            .is_some_and(|&v| v <= agora())
                        {
                            e.dispositivos_nostr.remove(&hash);
                        }
                        Ok(())
                    })
                    .await;
                StatusCode::UNAUTHORIZED.into_response()
            }
            None => StatusCode::UNAUTHORIZED.into_response(),
        };
    }
    if dispositivo {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let pubkey = est.estado.lock().await.nostr_perfil.pubkey_hex.clone();
    ([("cache-control", "no-store")], Json(pubkey)).into_response()
}

pub(crate) async fn sair(
    OriginalUri(uri): OriginalUri,
    State(state): State<Arc<WebState>>,
    headers: HeaderMap,
) -> Response {
    let _troca = TROCA_CONTA.write().await;
    if !headers.contains_key(CABECALHO) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    if let Some(token) = token_requisicao(&headers) {
        let device = headers[CABECALHO] == "dispositivo";
        let hash = if device && cookie(&headers, COOKIE_NOSTR).is_some() {
            hash_dispositivo(token)
        } else {
            hash_token(token, &headers, device)
        };
        if let Err(err) = estacao(&state)
            .mudar(|e| {
                e.dispositivos_nostr.remove(&hash);
                if let Some(old) = cookie(&headers, COOKIE) {
                    e.dispositivos_nostr
                        .remove(&hash_token(old, &headers, true));
                }
                Ok(())
            })
            .await
        {
            return (StatusCode::INTERNAL_SERVER_ERROR, err).into_response();
        }
    }
    let mut resp = (
        StatusCode::NO_CONTENT,
        AppendHeaders([
            ("set-cookie", expirar_cookie(COOKIE_NOSTR, &headers, &uri)),
            ("set-cookie", expirar_cookie(COOKIE, &headers, &uri)),
        ]),
    )
        .into_response();
    if let Some(barra) = expirar_cookie_barra(COOKIE_NOSTR, &headers, &uri) {
        resp = adicionar_set_cookie(resp, barra);
    }
    if let Some(barra) = expirar_cookie_barra(COOKIE, &headers, &uri) {
        resp = adicionar_set_cookie(resp, barra);
    }
    resp
}

#[cfg(test)]
mod tests {
    use super::*;
    use ai_memory_store::Store;
    use ai_memory_wiki::Wiki;
    use axum::http::Uri;
    use tempfile::TempDir;

    fn estado_web(tmp: &TempDir) -> Arc<WebState> {
        let store = Store::open(tmp.path()).unwrap();
        let wiki = Wiki::new(tmp.path(), store.writer.clone()).unwrap();
        Arc::new(WebState::new(store.reader, wiki))
    }

    #[tokio::test]
    async fn sessao_remove_entradas_vencidas_e_expira_cookie_legado() {
        let tmp = TempDir::new().unwrap();
        let expirado = agora() - 30;
        let hash_ativo = hash_dispositivo("tok-ativo-expirado");
        let hash_legado = format!(
            "{:x}",
            Sha256::digest(b"sessao-antiga\0tok-legado-expirado")
        );
        std::fs::create_dir(tmp.path().join("estacao")).unwrap();
        std::fs::write(
            tmp.path().join("estacao/estado.json"),
            serde_json::json!({
                "dispositivos_nostr": {
                    hash_ativo: expirado,
                    hash_legado: expirado,
                }
            })
            .to_string(),
        )
        .unwrap();
        let state = estado_web(&tmp);
        let uri: Uri = "/web/estacao/api/sessao".parse().unwrap();

        let mut headers_ativo = HeaderMap::new();
        headers_ativo.insert(CABECALHO, HeaderValue::from_static("dispositivo"));
        headers_ativo.insert(
            header::COOKIE,
            HeaderValue::from_static("estacao_operador=tok-ativo-expirado"),
        );
        let resp_ativo = sessao(
            OriginalUri(uri.clone()),
            State(state.clone()),
            headers_ativo,
        )
        .await;
        assert_eq!(resp_ativo.status(), StatusCode::UNAUTHORIZED);
        assert!(resp_ativo.headers().get("x-estacao-cofre").is_none());
        assert!(
            !estacao(&state)
                .estado
                .lock()
                .await
                .dispositivos_nostr
                .contains_key(&hash_dispositivo("tok-ativo-expirado"))
        );

        let mut headers_legado = HeaderMap::new();
        headers_legado.insert(CABECALHO, HeaderValue::from_static("dispositivo"));
        headers_legado.insert(header::HOST, HeaderValue::from_static("localhost:7654"));
        headers_legado.insert(
            header::COOKIE,
            HeaderValue::from_static(
                "estacao_dispositivo=tok-legado-expirado; ai_memory_session=sessao-antiga",
            ),
        );
        let resp_legado = sessao(OriginalUri(uri), State(state.clone()), headers_legado).await;
        assert_eq!(resp_legado.status(), StatusCode::UNAUTHORIZED);
        assert!(resp_legado.headers().get("x-estacao-cofre").is_none());
        let set_cookies: Vec<&str> = resp_legado
            .headers()
            .get_all(header::SET_COOKIE)
            .iter()
            .map(|v| v.to_str().unwrap())
            .collect();
        assert!(
            set_cookies.contains(&"estacao_dispositivo=; Path=/web; HttpOnly; SameSite=Strict; Max-Age=0"),
            "{set_cookies:?}"
        );
        assert!(
            set_cookies.contains(&"estacao_dispositivo=; Path=/web/; HttpOnly; SameSite=Strict; Max-Age=0"),
            "{set_cookies:?}"
        );
        assert!(
            estacao(&state)
                .estado
                .lock()
                .await
                .dispositivos_nostr
                .is_empty()
        );
    }

    #[test]
    fn cookie_dispositivo_cobre_raiz_web_sem_barra() {
        let mut h = HeaderMap::new();
        h.insert(header::HOST, HeaderValue::from_static("127.0.0.1:49374"));
        let uri: Uri = "/web/estacao/api/entrar".parse().unwrap();
        let c = cookie_dispositivo(&h, "tok123", 3600, &uri);
        assert_eq!(
            c,
            "estacao_operador=tok123; Path=/web; HttpOnly; SameSite=Strict; Max-Age=3600"
        );
        let root_uri: Uri = "/estacao/api/entrar".parse().unwrap();
        let c_root = cookie_dispositivo(&h, "tok123", 3600, &root_uri);
        assert_eq!(
            c_root,
            "estacao_operador=tok123; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600"
        );
    }

    #[test]
    fn http_local_rejeita_cabecalhos_nao_utf8() {
        let invalido = HeaderValue::from_bytes(b"\xff").unwrap();

        let mut h = HeaderMap::new();
        h.insert(header::HOST, invalido.clone());
        assert!(!http_local(&h));

        for nome in [
            header::ORIGIN.as_str(),
            "x-forwarded-proto",
            "x-forwarded-host",
        ] {
            let mut h = HeaderMap::new();
            h.insert(header::HOST, HeaderValue::from_static("localhost:7654"));
            h.insert(
                header::HeaderName::from_bytes(nome.as_bytes()).unwrap(),
                invalido.clone(),
            );
            assert!(!http_local(&h), "{nome} não-UTF-8 deve forçar Secure");
        }
    }
}
