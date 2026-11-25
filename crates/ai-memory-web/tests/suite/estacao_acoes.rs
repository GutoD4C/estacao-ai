//! Um teste por braço de `api_acao` (`POST /estacao/api/acao`): a rede de
//! segurança antes de qualquer refatoração do `match`.
//!
//! O estado da Estação é um singleton do processo (`estacao()`), e o
//! `cargo test` roda todos os testes do binário em threads do mesmo processo.
//! Por isso todo teste que toca a Estação segura [`TRAVA`] e só confere os ids
//! que ele mesmo criou.

use ai_memory_store::Store;
use ai_memory_web::router;
use ai_memory_wiki::Wiki;
use axum::Router;
use axum::body::Body;
use axum::http::{Method, Request, StatusCode, header};
use serde_json::{Value, json};
use tempfile::TempDir;
use tokio::sync::{Mutex, MutexGuard};
use tower::ServiceExt;

/// Serializa os testes que leem ou escrevem o estado global da Estação.
pub(super) static TRAVA: Mutex<()> = Mutex::const_new(());

const FORNECEDORES: [&str; 7] = [
    "claude",
    "codex",
    "antigravity-cli",
    "opencode",
    "gemini",
    "pi",
    "ollama",
];

struct Painel {
    _trava: MutexGuard<'static, ()>,
    tmp: TempDir,
    app: Router,
}

#[tokio::test]
async fn login_nostr_recusa_desafio_desconhecido_e_token_invalido() {
    use nostr::{EventBuilder, Keys, Kind, Tag};
    let _trava = TRAVA.lock().await;
    let tmp = TempDir::new().unwrap();
    let store = Store::open(tmp.path()).unwrap();
    let wiki = Wiki::new(tmp.path(), store.writer.clone()).unwrap();
    let app = router(store.reader.clone(), wiki);
    let prova = EventBuilder::new(Kind::Custom(20081), "estacao-ai/login")
        .tag(Tag::parse(["challenge", "nao-emitido"]).unwrap())
        .sign_with_keys(&Keys::generate())
        .unwrap();
    let resp = app
        .clone()
        .oneshot(
            Request::post("/estacao/api/entrar")
                .extension(ai_memory_core::AuthLevel::Root)
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-estacao-ui", "1")
                .body(Body::from(serde_json::to_vec(&prova).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let resp = app
        .clone()
        .oneshot(
            Request::get("/estacao/api/estado")
                .header("x-estacao-sessao", "token-invalido")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let autenticado = com_login_nostr(app, tmp.path()).await;
    let resp = autenticado
        .oneshot(
            Request::get("/estacao/api/estado")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

async fn prova_login(app: &Router) -> nostr::Event {
    use nostr::{EventBuilder, Keys, Kind, Tag};
    let resposta = app
        .clone()
        .oneshot(
            Request::get("/estacao/api/desafio")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let bytes = axum::body::to_bytes(resposta.into_body(), 1024)
        .await
        .unwrap();
    let desafio: String = serde_json::from_slice(&bytes).unwrap();
    EventBuilder::new(Kind::Custom(20081), "estacao-ai/login")
        .tag(Tag::parse(["challenge", &desafio]).unwrap())
        .sign_with_keys(&Keys::generate())
        .unwrap()
}

#[tokio::test]
async fn dispositivo_lembrado_por_30_dias_ate_sair() {
    let _trava = TRAVA.lock().await;
    let tmp = TempDir::new().unwrap();
    let store = Store::open(tmp.path()).unwrap();
    let app = router(
        store.reader.clone(),
        Wiki::new(tmp.path(), store.writer.clone()).unwrap(),
    );
    let prova = prova_login(&app).await;
    let login = Request::post("/estacao/api/entrar")
        .header("x-estacao-vinculo", vinculo(tmp.path()))
        .header(header::CONTENT_TYPE, "application/json")
        .header("x-estacao-ui", "1")
        .header("x-estacao-dispositivo", "1")
        .header("cookie", "ai_memory_session=primary")
        .body(Body::from(serde_json::to_vec(&prova).unwrap()))
        .unwrap();
    let resposta = app.clone().oneshot(login).await.unwrap();
    assert_eq!(resposta.status(), StatusCode::OK);
    let estranha = prova_login(&app).await;
    let rejeitada = app
        .clone()
        .oneshot(
            Request::post("/estacao/api/entrar")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-estacao-ui", "1")
                .body(Body::from(serde_json::to_vec(&estranha).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(rejeitada.status(), StatusCode::FORBIDDEN);
    let cookie = resposta.headers()["set-cookie"].to_str().unwrap();
    assert!(cookie.contains("Max-Age=2592000"));
    for flag in ["HttpOnly", "SameSite=Strict", "Secure"] {
        assert!(cookie.contains(flag));
    }
    let dispositivo = cookie.split(';').next().unwrap();
    let pedido = |url, metodo, principal| {
        Request::builder()
            .method(metodo)
            .uri(url)
            .header(
                "cookie",
                format!("{dispositivo}; ai_memory_session={principal}"),
            )
            .header("x-estacao-sessao", "dispositivo")
            .body(Body::empty())
            .unwrap()
    };
    let sessao = || pedido("/estacao/api/sessao", Method::GET, "primary");
    let restaurado = app.clone().oneshot(sessao()).await.unwrap();
    assert_eq!(restaurado.status(), StatusCode::OK);
    assert_eq!(
        restaurado.headers()["x-estacao-cofre"]
            .to_str()
            .unwrap()
            .len(),
        64
    );
    let body = axum::body::to_bytes(restaurado.into_body(), 256)
        .await
        .unwrap();
    assert_eq!(
        serde_json::from_slice::<String>(&body).unwrap(),
        prova.pubkey.to_hex()
    );
    // Server-password cookies are independent of the operator session.
    let outra_conta = pedido("/estacao/api/sessao", Method::GET, "other");
    assert_eq!(
        app.clone().oneshot(outra_conta).await.unwrap().status(),
        StatusCode::OK
    );
    let sair = pedido("/estacao/api/sair", Method::POST, "primary");
    assert_eq!(
        app.clone().oneshot(sair).await.unwrap().status(),
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        app.oneshot(sessao()).await.unwrap().status(),
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn atualizacao_migra_dispositivo_anterior_sem_renovar_o_prazo() {
    use sha2::{Digest, Sha256};
    use std::time::{SystemTime, UNIX_EPOCH};
    let _trava = TRAVA.lock().await;
    let tmp = TempDir::new().unwrap();
    let fim = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
        + 7200;
    let hash = format!("{:x}", Sha256::digest(b"sessao-antiga\0dispositivo-antigo"));
    let estado = json!({"dispositivos_nostr": {hash: fim}});
    std::fs::create_dir(tmp.path().join("estacao")).unwrap();
    std::fs::write(tmp.path().join("estacao/estado.json"), estado.to_string()).unwrap();
    let store = Store::open(tmp.path()).unwrap();
    let app = router(
        store.reader.clone(),
        Wiki::new(tmp.path(), store.writer.clone()).unwrap(),
    );
    let consulta = |cookie: &str| {
        app.clone().oneshot(
            Request::get("/estacao/api/sessao")
                .header("x-estacao-sessao", "dispositivo")
                .header("cookie", cookie)
                .body(Body::empty())
                .unwrap(),
        )
    };
    let antigo = "estacao_dispositivo=dispositivo-antigo";
    assert_eq!(
        consulta(antigo).await.unwrap().status(),
        StatusCode::UNAUTHORIZED
    );
    let resposta = consulta(&format!("{antigo}; ai_memory_session=sessao-antiga"))
        .await
        .unwrap();
    assert_eq!(resposta.status(), StatusCode::OK);
    let cookies: Vec<&str> = resposta
        .headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .map(|v| v.to_str().unwrap())
        .collect();
    assert_eq!(cookies.len(), 2);
    let cookie = cookies[0];
    let ttl: u64 = cookie
        .split("Max-Age=")
        .nth(1)
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .parse()
        .unwrap();
    assert!((7100..=7200).contains(&ttl));
    assert_eq!(
        cookies[1],
        "estacao_dispositivo=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure"
    );
    assert_eq!(
        consulta(cookie.split(';').next().unwrap())
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        consulta(&format!("{antigo}; ai_memory_session=sessao-antiga"))
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn sessao_expirada_retorna_unauthorized_sem_cofre() {
    use sha2::{Digest, Sha256};
    use std::time::{SystemTime, UNIX_EPOCH};
    let _trava = TRAVA.lock().await;
    let tmp = TempDir::new().unwrap();
    let vencido = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
        .saturating_sub(60);
    let hash_ativo = format!("nostr:{:x}", Sha256::digest(b"dispositivo-expirado"));
    let hash_legado = format!("{:x}", Sha256::digest(b"sessao-antiga\0legado-expirado"));
    let estado = json!({
        "dispositivos_nostr": {
            hash_ativo: vencido,
            hash_legado: vencido,
        }
    });
    std::fs::create_dir(tmp.path().join("estacao")).unwrap();
    std::fs::write(tmp.path().join("estacao/estado.json"), estado.to_string()).unwrap();
    let store = Store::open(tmp.path()).unwrap();
    let app = router(
        store.reader.clone(),
        Wiki::new(tmp.path(), store.writer.clone()).unwrap(),
    );

    let ativo = app
        .clone()
        .oneshot(
            Request::get("/estacao/api/sessao")
                .header("x-estacao-sessao", "dispositivo")
                .header("cookie", "estacao_operador=dispositivo-expirado")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(ativo.status(), StatusCode::UNAUTHORIZED);
    assert!(ativo.headers().get("x-estacao-cofre").is_none());

    let legado = app
        .oneshot(
            Request::get("/estacao/api/sessao")
                .header("x-estacao-sessao", "dispositivo")
                .header(
                    "cookie",
                    "estacao_dispositivo=legado-expirado; ai_memory_session=sessao-antiga",
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(legado.status(), StatusCode::UNAUTHORIZED);
    assert!(legado.headers().get("x-estacao-cofre").is_none());
}

#[tokio::test]
async fn cookie_secure_respeita_host_local_sem_origin_e_x_forwarded_proto() {
    let _trava = TRAVA.lock().await;
    let tmp = TempDir::new().unwrap();
    let store = Store::open(tmp.path()).unwrap();
    let app = router(
        store.reader.clone(),
        Wiki::new(tmp.path(), store.writer.clone()).unwrap(),
    );
    let prova = prova_login(&app).await;
    let login = app
        .clone()
        .oneshot(
            Request::post("/estacao/api/entrar")
                .header("x-estacao-vinculo", vinculo(tmp.path()))
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-estacao-ui", "1")
                .header("x-estacao-dispositivo", "1")
                .header(header::HOST, "localhost:7654")
                .body(Body::from(serde_json::to_vec(&prova).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(login.status(), StatusCode::OK);
    let cookie_login = login.headers()[header::SET_COOKIE].to_str().unwrap();
    assert!(!cookie_login.contains("; Secure"));
    let par_cookie = cookie_login.split(';').next().unwrap().to_owned();

    let casos: &[(&[(&str, &str)], bool)] = &[
        (&[("host", "localhost")], false),
        (&[("host", "localhost:7654")], false),
        (&[("host", "127.0.0.1")], false),
        (&[("host", "127.0.0.1:7654")], false),
        (&[("host", "[::1]")], false),
        (&[("host", "[::1]:7654")], false),
        (
            &[("host", "localhost:7654"), ("x-forwarded-proto", "http")],
            false,
        ),
        (
            &[
                ("host", "localhost:7654"),
                ("x-forwarded-proto", "HTTP, http"),
            ],
            false,
        ),
        (
            &[("host", "localhost:7654"), ("x-forwarded-proto", "https")],
            true,
        ),
        (
            &[("host", "[::1]:7654"), ("x-forwarded-proto", "HTTPS")],
            true,
        ),
        (
            &[
                ("host", "localhost:7654"),
                ("origin", "http://localhost:7654"),
                ("x-forwarded-proto", "https"),
            ],
            true,
        ),
        (
            &[
                ("host", "localhost:7654"),
                ("origin", "http://localhost:7654"),
            ],
            false,
        ),
        (
            &[
                ("host", "localhost:7654"),
                ("origin", "http://LOCALHOST:7654"),
            ],
            false,
        ),
        (
            &[("host", "[::1]:7654"), ("origin", "http://[::1]:7654")],
            false,
        ),
        (&[("host", "[::1]"), ("origin", "http://[::1]")], false),
        (
            &[("host", "[::1]:7654"), ("origin", "https://[::1]:7654")],
            true,
        ),
        (
            &[
                ("host", "localhost:7654"),
                ("origin", "https://localhost:7654"),
            ],
            true,
        ),
        (&[("host", "estacao.example.com")], true),
        (&[], true),
        // Host remoto ou ausente + Origin local (ou autoridades divergentes)
        (
            &[
                ("host", "estacao.example.com"),
                ("origin", "http://localhost:7654"),
            ],
            true,
        ),
        (&[("origin", "http://localhost:7654")], true),
        (
            &[
                ("host", "localhost:7654"),
                ("origin", "http://127.0.0.1:7654"),
            ],
            true,
        ),
        (
            &[
                ("host", "localhost:7654"),
                ("origin", "http://localhost:8080"),
            ],
            true,
        ),
        // Headers Host / Origin duplicados
        (
            &[("host", "localhost:7654"), ("host", "localhost:7654")],
            true,
        ),
        (
            &[("host", "localhost:7654"), ("host", "estacao.example.com")],
            true,
        ),
        (
            &[
                ("host", "localhost:7654"),
                ("origin", "http://localhost:7654"),
                ("origin", "http://localhost:7654"),
            ],
            true,
        ),
        (
            &[
                ("host", "localhost:7654"),
                ("origin", "http://localhost:7654"),
                ("origin", "https://estacao.example.com"),
            ],
            true,
        ),
        // X-Forwarded-Proto vazio, malformado ou desconhecido
        (
            &[("host", "localhost:7654"), ("x-forwarded-proto", "")],
            true,
        ),
        (
            &[("host", "localhost:7654"), ("x-forwarded-proto", "   ")],
            true,
        ),
        (
            &[("host", "localhost:7654"), ("x-forwarded-proto", "http,")],
            true,
        ),
        (
            &[
                ("host", "localhost:7654"),
                ("x-forwarded-proto", "http, https"),
            ],
            true,
        ),
        (
            &[("host", "localhost:7654"), ("x-forwarded-proto", "ws")],
            true,
        ),
        (
            &[
                ("host", "localhost:7654"),
                ("x-forwarded-proto", "http"),
                ("x-forwarded-proto", "https"),
            ],
            true,
        ),
        (
            &[
                ("host", "localhost:7654"),
                ("x-forwarded-proto", "http"),
                ("x-forwarded-proto", ""),
            ],
            true,
        ),
        // X-Forwarded-Host local vs remoto / vazio
        (
            &[
                ("host", "localhost:7654"),
                ("x-forwarded-host", "localhost:7654"),
            ],
            false,
        ),
        (
            &[
                ("host", "localhost:7654"),
                ("x-forwarded-host", "127.0.0.1:7654, [::1]:7654"),
            ],
            false,
        ),
        (
            &[
                ("host", "localhost:7654"),
                ("x-forwarded-host", "estacao.example.com"),
            ],
            true,
        ),
        (
            &[
                ("host", "localhost:7654"),
                ("x-forwarded-host", "localhost:7654, estacao.example.com"),
            ],
            true,
        ),
        (
            &[("host", "localhost:7654"), ("x-forwarded-host", "")],
            true,
        ),
        (
            &[
                ("host", "localhost:7654"),
                ("x-forwarded-host", "localhost:7654"),
                ("x-forwarded-host", "estacao.example.com"),
            ],
            true,
        ),
        // Forwarded (RFC 7239) presente
        (
            &[
                ("host", "localhost:7654"),
                ("forwarded", "proto=http;host=localhost:7654"),
            ],
            true,
        ),
        (
            &[
                ("host", "localhost:7654"),
                ("forwarded", "for=127.0.0.1;proto=https"),
            ],
            true,
        ),
        (&[("host", "localhost:7654"), ("forwarded", "")], true),
    ];

    for (extras, espera_secure) in casos {
        let mut builder = Request::get("/estacao/api/sessao")
            .header("x-estacao-sessao", "dispositivo")
            .header(header::COOKIE, &par_cookie);
        for (nome, valor) in *extras {
            builder = builder.header(*nome, *valor);
        }
        let resp = app
            .clone()
            .oneshot(builder.body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let set_cookie = resp.headers()[header::SET_COOKIE].to_str().unwrap();
        assert_eq!(
            set_cookie.contains("; Secure"),
            *espera_secure,
            "headers={extras:?} -> {set_cookie}"
        );
    }
}

#[tokio::test]
async fn expira_cookie_legado_na_migracao_e_no_logout() {
    use sha2::{Digest, Sha256};
    use std::time::{SystemTime, UNIX_EPOCH};
    let _trava = TRAVA.lock().await;
    let tmp = TempDir::new().unwrap();
    let fim = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
        + 3600;
    let hash = format!("{:x}", Sha256::digest(b"sessao-antiga\0legado-ok"));
    let estado = json!({"dispositivos_nostr": {hash: fim}});
    std::fs::create_dir(tmp.path().join("estacao")).unwrap();
    std::fs::write(tmp.path().join("estacao/estado.json"), estado.to_string()).unwrap();
    let store = Store::open(tmp.path()).unwrap();
    let app = router(
        store.reader.clone(),
        Wiki::new(tmp.path(), store.writer.clone()).unwrap(),
    );

    let migrada = app
        .clone()
        .oneshot(
            Request::get("/estacao/api/sessao")
                .header("x-estacao-sessao", "dispositivo")
                .header(header::HOST, "127.0.0.1:7654")
                .header(
                    header::COOKIE,
                    "estacao_dispositivo=legado-ok; ai_memory_session=sessao-antiga",
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(migrada.status(), StatusCode::OK);
    let cookies_migracao: Vec<&str> = migrada
        .headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .map(|v| v.to_str().unwrap())
        .collect();
    assert_eq!(cookies_migracao.len(), 2);
    assert!(cookies_migracao[0].starts_with("estacao_operador="));
    assert!(!cookies_migracao[0].contains("; Secure"));
    assert_eq!(
        cookies_migracao[1],
        "estacao_dispositivo=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"
    );
    let par_novo = cookies_migracao[0].split(';').next().unwrap().to_owned();

    let logout_https = app
        .clone()
        .oneshot(
            Request::post("/estacao/api/sair")
                .header("x-estacao-sessao", "dispositivo")
                .header(header::HOST, "127.0.0.1:7654")
                .header("x-forwarded-proto", "https")
                .header(header::COOKIE, &par_novo)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(logout_https.status(), StatusCode::NO_CONTENT);
    let cookies_logout_https: Vec<&str> = logout_https
        .headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .map(|v| v.to_str().unwrap())
        .collect();
    assert_eq!(
        cookies_logout_https,
        [
            "estacao_operador=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure",
            "estacao_dispositivo=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure",
        ]
    );

    let logout_local = app
        .oneshot(
            Request::post("/estacao/api/sair")
                .header("x-estacao-sessao", "dispositivo")
                .header(header::HOST, "localhost:7654")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(logout_local.status(), StatusCode::NO_CONTENT);
    let cookies_logout_local: Vec<&str> = logout_local
        .headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .map(|v| v.to_str().unwrap())
        .collect();
    assert_eq!(
        cookies_logout_local,
        [
            "estacao_operador=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
            "estacao_dispositivo=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
        ]
    );
}

#[cfg(unix)]
#[tokio::test]
async fn sair_e_troca_de_conta_nao_bloqueiam_com_rota_protegida_em_andamento() {
    use std::time::Duration;
    let p = painel().await;
    let iniciado = p.tmp.path().join("rota-longa-iniciada");
    let liberar = p.tmp.path().join("rota-longa-liberar");
    let comando = format!(
        "sh -c 'touch \"{}\" && i=0 && while [ ! -f \"{}\" ] && [ $i -lt 50 ]; do sleep 0.1; i=$((i+1)); done && echo online'",
        iniciado.display(),
        liberar.display()
    );
    let ag = p.agente("Lento", &comando, json!({})).await;

    let app_longa = p.app.clone();
    let tarefa_longa = tokio::spawn(async move {
        app_longa
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/estacao/api/acao")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header("x-estacao-ui", "1")
                    .body(Body::from(
                        json!({ "tipo": "testar_agente", "id": ag }).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap()
    });

    for _ in 0..200 {
        if iniciado.exists() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(15)).await;
    }
    assert!(iniciado.exists(), "a rota protegida não chegou ao handler");

    let sair_resp = tokio::time::timeout(
        Duration::from_secs(1),
        p.app.clone().oneshot(
            Request::post("/estacao/api/sair")
                .body(Body::empty())
                .unwrap(),
        ),
    )
    .await
    .expect("sair não deve bloquear enquanto outra rota protegida executa")
    .unwrap();
    assert_eq!(sair_resp.status(), StatusCode::NO_CONTENT);

    let prova = prova_login(&p.app).await;
    let entrar_resp = tokio::time::timeout(
        Duration::from_secs(1),
        p.app.clone().oneshot(
            Request::post("/estacao/api/entrar")
                .header("x-estacao-vinculo", vinculo(p.tmp.path()))
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-estacao-ui", "1")
                .body(Body::from(serde_json::to_vec(&prova).unwrap()))
                .unwrap(),
        ),
    )
    .await
    .expect("troca de conta não deve bloquear enquanto outra rota protegida executa")
    .unwrap();
    assert_eq!(entrar_resp.status(), StatusCode::OK);

    std::fs::write(&liberar, b"ok").unwrap();
    let resp_longa = tokio::time::timeout(Duration::from_secs(3), tarefa_longa)
        .await
        .expect("a rota longa deveria concluir após liberação")
        .unwrap();
    assert_eq!(resp_longa.status(), StatusCode::OK);
}

fn vinculo(dir: &std::path::Path) -> String {
    use sha2::{Digest, Sha256};
    let ticket = uuid::Uuid::new_v4().to_string();
    std::fs::write(
        dir.join(".nostr-desktop"),
        format!("{:x}", Sha256::digest(ticket.as_bytes())),
    )
    .unwrap();
    ticket
}

pub(super) async fn com_login_nostr(app: Router, dir: &std::path::Path) -> Router {
    let ticket = vinculo(dir);
    let prova = prova_login(&app).await;
    let login = || {
        Request::post("/estacao/api/entrar")
            .extension(ai_memory_core::AuthLevel::Root)
            .header(header::CONTENT_TYPE, "application/json")
            .header("x-estacao-ui", "1")
            .header("x-estacao-vinculo", &ticket)
            .body(Body::from(serde_json::to_vec(&prova).unwrap()))
            .unwrap()
    };
    let resp = app.clone().oneshot(login()).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(
        app.clone().oneshot(login()).await.unwrap().status(),
        StatusCode::UNAUTHORIZED
    );
    let bytes = axum::body::to_bytes(resp.into_body(), 1024).await.unwrap();
    let token: String = serde_json::from_slice(&bytes).unwrap();
    app.layer(axum::middleware::from_fn(
        move |mut req: Request<Body>, next: axum::middleware::Next| {
            req.headers_mut()
                .insert("x-estacao-sessao", token.parse().unwrap());
            async move { next.run(req).await }
        },
    ))
}

async fn painel() -> Painel {
    let trava = TRAVA.lock().await;
    let tmp = TempDir::new().unwrap();
    let store = Store::open(tmp.path()).unwrap();
    let wiki = Wiki::new(tmp.path(), store.writer.clone()).unwrap();
    let app = router(store.reader.clone(), wiki).layer(axum::middleware::from_fn(
        |mut req: Request<Body>, next: axum::middleware::Next| async move {
            req.extensions_mut().insert(ai_memory_core::AuthLevel::Root);
            next.run(req).await
        },
    ));
    let app = com_login_nostr(app, tmp.path()).await;
    Painel {
        _trava: trava,
        tmp,
        app,
    }
}

impl Painel {
    async fn acao(&self, payload: Value) -> (StatusCode, String) {
        let resp = self
            .app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/estacao/api/acao")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header("x-estacao-ui", "1")
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = resp.status();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, String::from_utf8_lossy(&bytes).into_owned())
    }

    /// Ação que deve devolver 204.
    async fn ok(&self, payload: Value) {
        let (st, corpo) = self.acao(payload.clone()).await;
        assert_eq!(st, StatusCode::NO_CONTENT, "{payload} -> {corpo}");
    }

    /// Ação que deve devolver 400 com `trecho` na mensagem.
    async fn recusa(&self, payload: Value, trecho: &str) {
        let (st, corpo) = self.acao(payload.clone()).await;
        assert_eq!(st, StatusCode::BAD_REQUEST, "{payload} -> {corpo}");
        assert!(
            corpo.contains(trecho),
            "{payload}: esperava {trecho:?}, veio {corpo:?}"
        );
    }

    /// Ação que deve devolver 200 com `{"id": ...}`.
    async fn id(&self, payload: Value) -> String {
        let (st, corpo) = self.acao(payload.clone()).await;
        assert_eq!(st, StatusCode::OK, "{payload} -> {corpo}");
        serde_json::from_str::<Value>(&corpo).unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned()
    }

    async fn estado(&self) -> Value {
        let resp = self
            .app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/estacao/api/estado")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    /// Consulta o estado até `cond` valer (no máximo ~10 s).
    async fn esperar(&self, oque: &str, cond: impl Fn(&Value) -> bool) -> Value {
        for _ in 0..200 {
            let e = self.estado().await;
            if cond(&e) {
                return e;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        panic!("tempo esgotado esperando: {oque}");
    }

    async fn agente(&self, nome: &str, comando: &str, extra: Value) -> String {
        let mut agente = json!({
            "id": "",
            "nome": nome,
            "modelo": "teste",
            "fornecedor": "teste",
            "comando": comando,
        });
        for (k, v) in extra.as_object().unwrap() {
            agente[k] = v.clone();
        }
        self.id(json!({ "tipo": "salvar_agente", "agente": agente }))
            .await
    }

    async fn projeto(&self, nome: &str, agentes: &[&str], eh_chat: bool) -> String {
        self.id(json!({
            "tipo": "salvar_projeto",
            "projeto": { "id": "", "nome": nome, "agentes": agentes, "eh_chat": eh_chat }
        }))
        .await
    }

    async fn tarefa(&self, projeto: &str, agente: Option<&str>) -> String {
        self.id(json!({
            "tipo": "salvar_tarefa",
            "tarefa": { "id": "", "projeto": projeto, "titulo": "Tarefa de teste", "agente": agente }
        }))
        .await
    }
}

fn achar<'a>(estado: &'a Value, lista: &str, id: &str) -> Option<&'a Value> {
    estado[lista]
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["id"] == id)
}

fn mensagens<'a>(estado: &'a Value, projeto: &str) -> Vec<&'a Value> {
    estado["mensagens"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| m["projeto"] == projeto)
        .collect()
}

/// Nenhuma mensagem do projeto está pensando e há ao menos `n` respostas de agente.
fn respostas_prontas(estado: &Value, projeto: &str, n: usize) -> bool {
    let ms = mensagens(estado, projeto);
    ms.iter().all(|m| m["estado"] != "pensando")
        && ms
            .iter()
            .filter(|m| m["autor"] != "voce" && m["estado"] == "ok")
            .count()
            >= n
}

#[tokio::test]
async fn acao_recusa_pedido_sem_cabecalho_da_interface() {
    let p = painel().await;
    let resp = p
        .app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/estacao/api/acao")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "tipo": "contexto_global", "texto": "x" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn acao_salvar_agente() {
    let p = painel().await;
    let id = p
        .agente("  Agente Salvo  ", "  cat  ", json!({ "papel": "Revisor" }))
        .await;
    let e = p.estado().await;
    let a = achar(&e, "agentes", &id).unwrap();
    assert_eq!(a["nome"], "Agente Salvo");
    assert_eq!(a["comando"], "cat");
    assert_eq!(a["grupo"], "projetos");

    // Editar mantém o id e troca os campos.
    let mesmo = p
        .id(json!({ "tipo": "salvar_agente", "agente": {
            "id": id, "nome": "Renomeado", "fornecedor": "teste", "comando": "cat",
            "funcao": "mediador"
        }}))
        .await;
    assert_eq!(mesmo, id);
    let e = p.estado().await;
    let a = achar(&e, "agentes", &id).unwrap();
    assert_eq!(a["nome"], "Renomeado");
    assert_eq!(a["grupo"], "chat", "o papel define o grupo");

    p.recusa(
        json!({ "tipo": "salvar_agente", "agente": { "id": "", "nome": " ", "comando": "cat" } }),
        "Informe nome e comando",
    )
    .await;
    p.recusa(
        json!({ "tipo": "salvar_agente", "agente": {
            "id": "", "nome": "X", "comando": "cat", "funcao": "papel-que-nao-existe"
        }}),
        "Papel desconhecido",
    )
    .await;
}

#[tokio::test]
async fn acao_excluir_agente() {
    let p = painel().await;
    let ag = p.agente("Excluível", "cat", json!({})).await;
    let pr = p.projeto("Projeto do excluível", &[&ag], false).await;
    let tf = p.tarefa(&pr, Some(&ag)).await;

    p.ok(json!({ "tipo": "excluir_agente", "id": ag })).await;
    let e = p.estado().await;
    assert!(achar(&e, "agentes", &ag).is_none());
    assert_eq!(achar(&e, "projetos", &pr).unwrap()["agentes"], json!([]));
    assert!(achar(&e, "tarefas", &tf).unwrap()["agente"].is_null());
}

#[tokio::test]
async fn acao_salvar_projeto() {
    let p = painel().await;
    let ag_proj = p.agente("Do projeto", "cat", json!({})).await;
    let ag_chat = p.agente("Do chat", "cat", json!({ "grupo": "chat" })).await;
    let pr = p
        .projeto(
            "  Projeto Salvo  ",
            &[&ag_proj, &ag_chat, "ag-inexistente"],
            false,
        )
        .await;
    let e = p.estado().await;
    let proj = achar(&e, "projetos", &pr).unwrap();
    assert_eq!(proj["nome"], "Projeto Salvo");
    assert_eq!(
        proj["agentes"],
        json!([ag_proj]),
        "agente de chat e id inexistente ficam de fora"
    );

    let mesmo = p
        .id(json!({ "tipo": "salvar_projeto", "projeto": { "id": pr, "nome": "Renomeado" } }))
        .await;
    assert_eq!(mesmo, pr);
    assert_eq!(
        achar(&p.estado().await, "projetos", &pr).unwrap()["nome"],
        "Renomeado"
    );

    p.recusa(
        json!({ "tipo": "salvar_projeto", "projeto": { "id": "", "nome": "  " } }),
        "Informe o nome do projeto",
    )
    .await;
}

#[tokio::test]
async fn acao_excluir_projeto() {
    let p = painel().await;
    let pr = p.projeto("Projeto a excluir", &[], false).await;
    let tf = p.tarefa(&pr, None).await;
    // Sem agentes no projeto, a mensagem é gravada e ninguém é acionado.
    p.ok(json!({ "tipo": "enviar", "projeto": pr, "canal": "geral", "texto": "oi" }))
        .await;
    assert_eq!(mensagens(&p.estado().await, &pr).len(), 1);

    p.ok(json!({ "tipo": "excluir_projeto", "id": pr })).await;
    let e = p.estado().await;
    assert!(achar(&e, "projetos", &pr).is_none());
    assert!(achar(&e, "tarefas", &tf).is_none());
    assert!(mensagens(&e, &pr).is_empty());
}

#[tokio::test]
async fn acao_salvar_tarefa() {
    let p = painel().await;
    let pr = p.projeto("Projeto das tarefas", &[], false).await;
    let tf = p.tarefa(&pr, None).await;
    let e = p.estado().await;
    assert_eq!(achar(&e, "tarefas", &tf).unwrap()["status"], "a_fazer");

    let mesmo = p
        .id(json!({ "tipo": "salvar_tarefa", "tarefa": {
            "id": tf, "projeto": pr, "titulo": "Novo título", "status": "concluida"
        }}))
        .await;
    assert_eq!(mesmo, tf);
    let e = p.estado().await;
    let t = achar(&e, "tarefas", &tf).unwrap();
    assert_eq!(t["titulo"], "Novo título");
    assert_eq!(t["status"], "a_fazer", "editar não troca o status");

    p.recusa(
        json!({ "tipo": "salvar_tarefa", "tarefa": { "id": "", "projeto": pr, "titulo": " " } }),
        "Informe o título",
    )
    .await;
    p.recusa(
        json!({ "tipo": "salvar_tarefa", "tarefa": {
            "id": "", "projeto": "pr-inexistente", "titulo": "T"
        }}),
        "projeto existente",
    )
    .await;
    p.recusa(
        json!({ "tipo": "salvar_tarefa", "tarefa": {
            "id": "", "projeto": pr, "titulo": "T", "agente": "ag-inexistente"
        }}),
        "Modelo inexistente",
    )
    .await;
}

#[tokio::test]
async fn acao_excluir_tarefa() {
    let p = painel().await;
    let pr = p.projeto("Projeto excluir tarefa", &[], false).await;
    let fica = p.tarefa(&pr, None).await;
    let sai = p.tarefa(&pr, None).await;
    p.ok(json!({ "tipo": "excluir_tarefa", "id": sai })).await;
    let e = p.estado().await;
    assert!(achar(&e, "tarefas", &sai).is_none());
    assert!(achar(&e, "tarefas", &fica).is_some());
}

#[tokio::test]
async fn acao_reabrir_tarefa() {
    let p = painel().await;
    let ag = p
        .agente(
            "Executor reabrir",
            "sh -c 'cat; echo; echo ENTREGUE'",
            json!({}),
        )
        .await;
    let pr = p.projeto("Projeto reabrir", &[&ag], false).await;
    let tf = p.tarefa(&pr, Some(&ag)).await;
    p.ok(json!({ "tipo": "executar", "tarefa": tf })).await;
    p.esperar("tarefa concluída", |e| {
        achar(e, "tarefas", &tf).unwrap()["status"] == "concluida"
    })
    .await;

    p.ok(json!({ "tipo": "reabrir_tarefa", "id": tf })).await;
    assert_eq!(
        achar(&p.estado().await, "tarefas", &tf).unwrap()["status"],
        "a_fazer"
    );
    p.recusa(
        json!({ "tipo": "reabrir_tarefa", "id": "tf-inexistente" }),
        "Tarefa inexistente",
    )
    .await;
}

#[tokio::test]
async fn acao_atribuir() {
    let p = painel().await;
    let ag = p.agente("Atribuível", "cat", json!({})).await;
    let pr = p.projeto("Projeto atribuir", &[&ag], false).await;
    let tf = p.tarefa(&pr, None).await;

    p.ok(json!({ "tipo": "atribuir", "tarefa": tf, "agente": ag }))
        .await;
    assert_eq!(
        achar(&p.estado().await, "tarefas", &tf).unwrap()["agente"],
        ag
    );
    p.ok(json!({ "tipo": "atribuir", "tarefa": tf, "agente": null }))
        .await;
    assert!(achar(&p.estado().await, "tarefas", &tf).unwrap()["agente"].is_null());

    p.recusa(
        json!({ "tipo": "atribuir", "tarefa": tf, "agente": "ag-inexistente" }),
        "Modelo inexistente",
    )
    .await;
    p.recusa(
        json!({ "tipo": "atribuir", "tarefa": "tf-inexistente", "agente": null }),
        "Tarefa inexistente",
    )
    .await;
}

#[tokio::test]
async fn acao_executar() {
    let p = painel().await;
    let ag = p
        .agente("Executor", "sh -c 'cat; echo; echo ENTREGUE'", json!({}))
        .await;
    let pr = p.projeto("Projeto executar", &[&ag], false).await;
    let sem_agente = p.tarefa(&pr, None).await;
    p.recusa(
        json!({ "tipo": "executar", "tarefa": sem_agente }),
        "Arraste um modelo",
    )
    .await;
    p.recusa(
        json!({ "tipo": "executar", "tarefa": "tf-inexistente" }),
        "Tarefa inexistente",
    )
    .await;

    let tf = p.tarefa(&pr, Some(&ag)).await;
    p.ok(json!({ "tipo": "executar", "tarefa": tf })).await;
    let e = p
        .esperar("tarefa concluída", |e| {
            achar(e, "tarefas", &tf).unwrap()["status"] == "concluida"
        })
        .await;
    let resposta = mensagens(&e, &pr)
        .into_iter()
        .find(|m| m["autor"] == ag)
        .expect("mensagem do agente");
    assert_eq!(resposta["estado"], "ok");
    // `cat` devolve o prompt, que leva o título da tarefa.
    assert!(
        resposta["texto"]
            .as_str()
            .unwrap()
            .contains("Tarefa de teste")
    );
}

#[cfg(unix)]
#[tokio::test]
async fn entrega_do_projeto_continua_ate_a_revisao_final() {
    let painel = painel().await;
    let coordenador = painel
        .agente(
            "Coordenador",
            r#"cat >/dev/null
if test -f ajuste; then
    echo "Validado"
    echo ENTREGUE
elif test -f implementado; then
    echo "@Dev: corrija o teste pendente"
else
    echo "@Dev: implemente o pedido"
fi"#,
            json!({ "funcao": "pensador" }),
        )
        .await;
    let dev = painel
        .agente(
            "Dev",
            r#"cat >/dev/null
if test -f implementado; then
    touch ajuste
    echo ENTREGUE
elif test -f iniciado; then
    touch implementado
    echo ENTREGUE
else
    touch iniciado
    echo CONTINUAR
fi"#,
            json!({"funcao":"desenvolvedor"}),
        )
        .await;
    for pelo_quadro in [false, true] {
        let pasta = tempfile::tempdir().unwrap();
        let pr = painel
            .id(json!({"tipo":"salvar_projeto", "projeto":{
                "id":"", "nome":"Entrega", "pasta":pasta.path(), "agentes":[coordenador,dev]
            }}))
            .await;
        let tarefa = if pelo_quadro {
            let tf = painel.tarefa(&pr, Some(&coordenador)).await;
            painel.ok(json!({"tipo":"executar","tarefa":tf})).await;
            Some(tf)
        } else {
            painel.ok(json!({"tipo":"enviar","projeto":pr,"canal":coordenador,"texto":"Implemente e teste"})).await;
            None
        };
        let estado = painel
            .esperar("revisão final", |e| respostas_prontas(e, &pr, 6))
            .await;
        assert!(pasta.path().join("ajuste").exists());
        let msgs = mensagens(&estado, &pr);
        let autores: Vec<_> = msgs
            .iter()
            .filter_map(|m| m["autor"].as_str())
            .filter(|a| *a != "voce")
            .collect();
        assert_eq!(
            autores,
            [&coordenador, &dev, &dev, &coordenador, &dev, &coordenador]
        );
        assert!(
            msgs.last().unwrap()["texto"]
                .as_str()
                .unwrap()
                .contains("Validado")
        );
        if let Some(tf) = tarefa {
            assert_eq!(
                achar(&estado, "tarefas", &tf).unwrap()["status"],
                "concluida"
            );
        }
    }
}

#[tokio::test]
async fn bloqueio_ou_resposta_sem_decisao_nao_conclui_a_tarefa() {
    let painel = painel().await;
    for (comando, tentativas) in [("echo BLOQUEADO", 1), ("echo incompleto", 2)] {
        let ag = painel.agente("Executor", comando, json!({})).await;
        let pr = painel.projeto("Impedimento", &[&ag], false).await;
        let tf = painel.tarefa(&pr, Some(&ag)).await;
        painel.ok(json!({"tipo":"executar","tarefa":tf})).await;
        let estado = painel
            .esperar("impedimento", |e| {
                achar(e, "tarefas", &tf).unwrap()["status"] == "erro"
            })
            .await;
        assert_eq!(mensagens(&estado, &pr).len(), tentativas);
    }
}

#[tokio::test]
async fn acao_enviar() {
    let p = painel().await;
    let ag = p
        .agente("Conversador", "sh -c 'cat; echo; echo ENTREGUE'", json!({}))
        .await;
    let fora = p.agente("De fora", "cat", json!({})).await;
    let pr = p.projeto("Projeto enviar", &[&ag], false).await;

    p.ok(json!({ "tipo": "enviar", "projeto": pr, "canal": "geral", "texto": "  olá equipe  " }))
        .await;
    let e = p
        .esperar("resposta do agente", |e| respostas_prontas(e, &pr, 1))
        .await;
    let ms = mensagens(&e, &pr);
    assert_eq!(ms[0]["autor"], "voce");
    assert_eq!(ms[0]["texto"], "olá equipe");
    assert!(ms.iter().any(|m| m["autor"] == ag && m["estado"] == "ok"));

    p.recusa(
        json!({ "tipo": "enviar", "projeto": pr, "canal": "geral", "texto": "   " }),
        "Mensagem vazia",
    )
    .await;
    p.recusa(
        json!({ "tipo": "enviar", "projeto": "pr-inexistente", "canal": "geral", "texto": "oi" }),
        "Projeto inexistente",
    )
    .await;
    p.recusa(
        json!({ "tipo": "enviar", "projeto": pr, "canal": fora, "texto": "oi" }),
        "não faz parte do projeto",
    )
    .await;
}

#[tokio::test]
async fn acao_contexto_global() {
    let p = painel().await;
    let anterior = p.estado().await["contexto_global"].clone();
    p.ok(json!({ "tipo": "contexto_global", "texto": "Responder em português." }))
        .await;
    assert_eq!(
        p.estado().await["contexto_global"],
        "Responder em português."
    );
    p.ok(json!({ "tipo": "contexto_global", "texto": anterior }))
        .await;
}

#[tokio::test]
async fn acao_vincular_pasta() {
    let p = painel().await;
    let pasta = p.tmp.path().join("repo-vinculo");
    std::fs::create_dir_all(&pasta).unwrap();
    let pr = p
        .id(json!({ "tipo": "salvar_projeto", "projeto": {
            "id": "", "nome": "Projeto vínculo", "pasta": pasta.to_string_lossy(),
            "memoria": "default/vinculo-teste"
        }}))
        .await;
    p.ok(json!({ "tipo": "vincular_pasta", "projeto": pr }))
        .await;
    let toml = std::fs::read_to_string(pasta.join(".estacao-ai.toml")).unwrap();
    assert_eq!(
        toml,
        "workspace = \"default\"\nproject = \"vinculo-teste\"\n"
    );

    let sem_pasta = p.projeto("Sem pasta", &[], false).await;
    p.recusa(
        json!({ "tipo": "vincular_pasta", "projeto": sem_pasta }),
        "Configure a pasta",
    )
    .await;
    let sem_memoria = p
        .id(json!({ "tipo": "salvar_projeto", "projeto": {
            "id": "", "nome": "Sem memória", "pasta": pasta.to_string_lossy()
        }}))
        .await;
    p.recusa(
        json!({ "tipo": "vincular_pasta", "projeto": sem_memoria }),
        "memória ligada",
    )
    .await;
    p.recusa(
        json!({ "tipo": "vincular_pasta", "projeto": "pr-inexistente" }),
        "Projeto inexistente",
    )
    .await;
}

// Parar mata o grupo de processos, o que só existe em Unix.
#[cfg(unix)]
#[tokio::test]
async fn acao_parar() {
    let p = painel().await;
    let ag = p.agente("Demorado", "sleep 30", json!({})).await;
    let pr = p.projeto("Projeto parar", &[&ag], false).await;
    p.recusa(
        json!({ "tipo": "parar", "projeto": pr, "agente": null }),
        "Nada em execução",
    )
    .await;

    let tf = p.tarefa(&pr, Some(&ag)).await;
    p.ok(json!({ "tipo": "executar", "tarefa": tf })).await;
    // Enquanto executa, a tarefa não pode ser reaberta, reatribuída nem reexecutada.
    p.recusa(json!({ "tipo": "reabrir_tarefa", "id": tf }), "em execução")
        .await;
    p.recusa(
        json!({ "tipo": "atribuir", "tarefa": tf, "agente": null }),
        "em execução",
    )
    .await;
    p.recusa(
        json!({ "tipo": "executar", "tarefa": tf }),
        "já está em execução",
    )
    .await;

    // O processo é registrado logo depois do 204 do executar; tenta até pegar.
    let mut parou = false;
    for _ in 0..100 {
        let (st, _) = p
            .acao(json!({ "tipo": "parar", "projeto": pr, "agente": ag }))
            .await;
        if st == StatusCode::NO_CONTENT {
            parou = true;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    assert!(parou, "parar nunca encontrou a execução");
    p.esperar("tarefa sair de executando", |e| {
        achar(e, "tarefas", &tf).unwrap()["status"] != "executando"
    })
    .await;
}

#[tokio::test]
async fn acao_limpar_chat() {
    let p = painel().await;
    let limpo = p.projeto("Chat a limpar", &[], false).await;
    let outro = p.projeto("Chat preservado", &[], false).await;
    for pr in [&limpo, &outro] {
        p.ok(json!({ "tipo": "enviar", "projeto": pr, "canal": "geral", "texto": "oi" }))
            .await;
    }
    p.ok(json!({ "tipo": "limpar_chat", "projeto": limpo, "canal": "geral" }))
        .await;
    let e = p.estado().await;
    assert!(mensagens(&e, &limpo).is_empty());
    assert_eq!(mensagens(&e, &outro).len(), 1);
}

#[tokio::test]
async fn acao_debate() {
    let p = painel().await;
    let a1 = p.agente("Debatedor 1", "cat", json!({})).await;
    let a2 = p.agente("Debatedor 2", "cat", json!({})).await;
    let fora = p.agente("Fora do debate", "cat", json!({})).await;
    let pr = p.projeto("Projeto debate", &[&a1, &a2], false).await;

    p.recusa(
        json!({ "tipo": "debate", "projeto": pr, "tema": " ", "participantes": [a1, a2], "rodadas": 1 }),
        "tema do debate",
    )
    .await;
    p.recusa(
        json!({ "tipo": "debate", "projeto": pr, "tema": "T", "participantes": [a1], "rodadas": 1 }),
        "dois participantes",
    )
    .await;
    p.recusa(
        json!({ "tipo": "debate", "projeto": pr, "tema": "T", "participantes": [a1, fora], "rodadas": 1 }),
        "precisam estar no projeto",
    )
    .await;

    p.ok(json!({
        "tipo": "debate", "projeto": pr, "tema": "Rust ou Go",
        "participantes": [a1, a2], "rodadas": 1
    }))
    .await;
    let e = p
        .esperar("os dois falarem", |e| respostas_prontas(e, &pr, 2))
        .await;
    let ms = mensagens(&e, &pr);
    assert!(
        ms[0]["texto"]
            .as_str()
            .unwrap()
            .contains("Debate iniciado:** Rust ou Go")
    );
    assert!(ms.iter().any(|m| m["autor"] == a1));
    assert!(ms.iter().any(|m| m["autor"] == a2));
}

#[tokio::test]
async fn acao_ocultar_memoria() {
    let p = painel().await;
    let escopo = "default/oculta-teste";
    let ocultas = |e: &Value| {
        e["memorias_ocultas"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|x| *x == escopo)
            .count()
    };
    for _ in 0..2 {
        p.ok(json!({ "tipo": "ocultar_memoria", "escopo": escopo, "ocultar": true }))
            .await;
    }
    assert_eq!(
        ocultas(&p.estado().await),
        1,
        "ocultar duas vezes não duplica"
    );
    p.ok(json!({ "tipo": "ocultar_memoria", "escopo": escopo, "ocultar": false }))
        .await;
    assert_eq!(ocultas(&p.estado().await), 0);
}

/// Só o caminho determinístico: o sucesso depende das CLIs instaladas na
/// máquina e já tem teste unitário (`auto_configurar_por_grupo_separa_projetos_e_chat`).
#[tokio::test]
async fn acao_auto_configurar_sem_ferramenta_ativa() {
    let p = painel().await;
    let antes: Vec<Value> = p.estado().await["ferramentas_desativadas"]
        .as_array()
        .unwrap()
        .clone();
    for f in FORNECEDORES {
        p.ok(json!({ "tipo": "alternar_ferramenta", "fornecedor": f, "ativa": false }))
            .await;
    }
    let qtd_agentes = p.estado().await["agentes"].as_array().unwrap().len();
    p.recusa(
        json!({ "tipo": "auto_configurar", "grupo": "projetos" }),
        "Nenhuma ferramenta de IA ativa",
    )
    .await;
    assert_eq!(
        p.estado().await["agentes"].as_array().unwrap().len(),
        qtd_agentes
    );
    for f in FORNECEDORES {
        let ativa = !antes.iter().any(|x| x == f);
        p.ok(json!({ "tipo": "alternar_ferramenta", "fornecedor": f, "ativa": ativa }))
            .await;
    }
}

#[tokio::test]
async fn acao_excluir_agentes_grupo() {
    let p = painel().await;
    let de_chat = p
        .agente("Mediador grupo", "cat", json!({ "funcao": "mediador" }))
        .await;
    let de_projeto = p.agente("Dev grupo", "cat", json!({})).await;
    let sala = p.projeto("Sala do grupo", &[&de_chat], true).await;
    assert_eq!(
        achar(&p.estado().await, "projetos", &sala).unwrap()["agentes"],
        json!([de_chat])
    );

    p.recusa(
        json!({ "tipo": "excluir_agentes_grupo", "grupo": "outro" }),
        "Grupo inválido",
    )
    .await;
    p.ok(json!({ "tipo": "excluir_agentes_grupo", "grupo": " chat " }))
        .await;
    let e = p.estado().await;
    assert!(achar(&e, "agentes", &de_chat).is_none());
    assert!(achar(&e, "agentes", &de_projeto).is_some());
    assert_eq!(achar(&e, "projetos", &sala).unwrap()["agentes"], json!([]));
}

#[tokio::test]
async fn acao_testar_agente() {
    let p = painel().await;
    let ag = p.agente("Testável", "cat", json!({})).await;
    // Contrato atual: a resposta da CLI vem no campo `id`.
    let texto = p.id(json!({ "tipo": "testar_agente", "id": ag })).await;
    assert!(texto.contains("online"), "{texto}");

    let sem_cli = p
        .agente("Sem CLI", "cli-que-nao-existe-xyz -p", json!({}))
        .await;
    p.recusa(
        json!({ "tipo": "testar_agente", "id": sem_cli }),
        "CLI não encontrada",
    )
    .await;
    p.recusa(
        json!({ "tipo": "testar_agente", "id": "ag-inexistente" }),
        "Modelo inexistente",
    )
    .await;
}

#[tokio::test]
async fn acao_verificar_ideias() {
    let p = painel().await;
    let vazio = p.projeto("Verificar sem equipe", &[], false).await;
    p.recusa(
        json!({ "tipo": "verificar_ideias", "projeto": vazio, "canal": "geral" }),
        "Adicione pelo menos um modelo",
    )
    .await;
    p.recusa(
        json!({ "tipo": "verificar_ideias", "projeto": "pr-inexistente", "canal": "geral" }),
        "Projeto inexistente",
    )
    .await;

    let ag = p.agente("Revisor", "cat", json!({})).await;
    let pr = p.projeto("Projeto verificar", &[&ag], false).await;
    p.ok(json!({ "tipo": "verificar_ideias", "projeto": pr, "canal": "geral" }))
        .await;
    let e = p
        .esperar("resposta do revisor", |e| respostas_prontas(e, &pr, 1))
        .await;
    assert!(mensagens(&e, &pr).iter().any(|m| {
        m["texto"]
            .as_str()
            .unwrap()
            .contains("Solicitando verificação")
    }));
}

#[tokio::test]
async fn acao_avaliar_mediador() {
    let p = painel().await;
    let sem_mediador = p
        .agente("Sem mediação", "cat", json!({ "grupo": "chat" }))
        .await;
    let sala_sem = p.projeto("Sala sem mediador", &[&sem_mediador], true).await;
    p.recusa(
        json!({ "tipo": "avaliar_mediador", "projeto": sala_sem, "canal": "geral" }),
        "Adicione um agente Mediador",
    )
    .await;

    let med = p
        .agente("Mediador avalia", "cat", json!({ "funcao": "mediador" }))
        .await;
    let sala = p
        .projeto("Sala com mediador", &[&med, &sem_mediador], true)
        .await;
    p.ok(json!({ "tipo": "avaliar_mediador", "projeto": sala, "canal": "geral" }))
        .await;
    let e = p
        .esperar("resposta do mediador", |e| respostas_prontas(e, &sala, 1))
        .await;
    assert!(
        mensagens(&e, &sala)
            .iter()
            .any(|m| m["autor"] == med && m["estado"] == "ok")
    );
}

#[tokio::test]
async fn acao_alternar_ferramenta() {
    let p = painel().await;
    let forn = "ferramenta-de-teste";
    let desativada = |e: &Value| {
        e["ferramentas_desativadas"]
            .as_array()
            .unwrap()
            .iter()
            .any(|x| x == forn)
    };
    p.ok(json!({ "tipo": "alternar_ferramenta", "fornecedor": forn, "ativa": false }))
        .await;
    assert!(desativada(&p.estado().await));
    p.ok(json!({ "tipo": "alternar_ferramenta", "fornecedor": forn, "ativa": true }))
        .await;
    assert!(!desativada(&p.estado().await));
    p.recusa(
        json!({ "tipo": "alternar_ferramenta", "fornecedor": "  ", "ativa": false }),
        "Fornecedor inválido",
    )
    .await;
}
