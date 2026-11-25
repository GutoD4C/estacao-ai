//! Page history and diff (`/w/{ws}/{proj}/h/*path`, `/api/v1/.../history/*path`)
//! and the session timeline (`/w/{ws}/{proj}/s/{session_id}`).
//!
//! Both views read by id, so each boundary is tested adversarially: a path,
//! version id or session id from another project or workspace must read as
//! not found, a restricted project must refuse a non-grantee, and captured
//! text must render inert. Every refusal has a legitimate control beside it.

use ai_memory_core::{
    ActorContext, AgentKind, AuthorizedViewer, IdentityKey, NewObservation, NewPage, NewSession,
    NewUser, ObservationKind, PageId, PagePath, ProjectId, Sanitized, Sanitizer, SessionId, Tier,
    UserId, UserRole, WorkspaceId,
};
use ai_memory_store::{GrantLevel, Store};
use ai_memory_web::{api_router, router};
use ai_memory_wiki::Wiki;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use tempfile::TempDir;
use tower::ServiceExt;

struct Fixture {
    _tmp: TempDir,
    store: Store,
    wiki: Wiki,
}

impl Fixture {
    async fn new() -> Self {
        let tmp = TempDir::new().unwrap();
        let store = Store::open(tmp.path()).unwrap();
        let wiki = Wiki::new(tmp.path(), store.writer.clone()).unwrap();
        Self {
            _tmp: tmp,
            store,
            wiki,
        }
    }

    async fn scope(&self, workspace: &str, project: &str) -> (WorkspaceId, ProjectId) {
        let ws = self
            .store
            .writer
            .get_or_create_workspace(workspace)
            .await
            .unwrap();
        let proj = self
            .store
            .writer
            .get_or_create_project(ws, project, None)
            .await
            .unwrap();
        (ws, proj)
    }

    async fn write(
        &self,
        scope: (WorkspaceId, ProjectId),
        path: &str,
        body: &str,
        author: Option<UserId>,
    ) -> PageId {
        self.write_expiring(scope, path, body, author, None).await
    }

    async fn write_expiring(
        &self,
        (ws, proj): (WorkspaceId, ProjectId),
        path: &str,
        body: &str,
        author: Option<UserId>,
        expires_at: Option<jiff::Timestamp>,
    ) -> PageId {
        self.store
            .writer
            .upsert_page(NewPage {
                workspace_id: ws,
                project_id: proj,
                path: PagePath::new(path).unwrap(),
                title: "Plan".into(),
                body: body.into(),
                tier: Tier::Semantic,
                frontmatter_json: serde_json::json!({"kind": "fact"}),
                pinned: false,
                links: Vec::new(),
                author_id: author,
                expires_at,
                entities: Vec::new(),
                evidence: Vec::new(),
            })
            .await
            .unwrap()
    }

    async fn user(&self, name: &str) -> UserId {
        self.store
            .writer
            .create_human_user(
                NewUser {
                    username: name.into(),
                    name: None,
                    email: None,
                },
                UserRole::User,
                None,
                false,
            )
            .await
            .unwrap()
    }

    async fn session(
        &self,
        (ws, proj): (WorkspaceId, ProjectId),
        owner: Option<&str>,
        rows: &[(&str, &str)],
    ) -> SessionId {
        let id = SessionId::new();
        self.store
            .writer
            .begin_session(NewSession {
                occurred_at: None,
                id,
                workspace_id: ws,
                project_id: proj,
                agent_kind: AgentKind::ClaudeCode,
                cwd: None,
                actor_user: owner.map(|name| IdentityKey::User(name.into()).storage_key()),
            })
            .await
            .unwrap();
        for (title, body) in rows {
            self.store
                .writer
                .insert_observation(Sanitized::new(
                    NewObservation {
                        occurred_at: None,
                        session_id: id,
                        workspace_id: ws,
                        project_id: proj,
                        kind: ObservationKind::UserPrompt,
                        extension: None,
                        source_event: None,
                        title: (*title).to_owned(),
                        body: (*body).to_owned(),
                        importance: 5,
                        file_path: None,
                    },
                    &Sanitizer::builtin(),
                ))
                .await
                .unwrap();
        }
        id
    }

    fn web(&self) -> axum::Router {
        router(self.store.reader.clone(), self.wiki.clone())
    }

    fn api(&self) -> axum::Router {
        api_router(self.store.reader.clone(), self.wiki.clone())
    }
}

/// GET `uri`, stamping what the auth layer would: a grant-checked viewer and
/// an actor identity.
async fn get_as(
    app: &axum::Router,
    uri: &str,
    viewer: Option<UserId>,
    actor: Option<&str>,
) -> (StatusCode, String) {
    let mut req = Request::builder().uri(uri);
    if let Some(viewer) = viewer {
        req = req.extension(AuthorizedViewer(viewer));
    }
    if let Some(user) = actor {
        req = req.extension(ActorContext {
            user: Some(user.to_owned()),
            ..ActorContext::default()
        });
    }
    let resp = app
        .clone()
        .oneshot(req.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = resp.status();
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    (status, String::from_utf8_lossy(&body).into_owned())
}

async fn get(app: &axum::Router, uri: &str) -> (StatusCode, String) {
    get_as(app, uri, None, None).await
}

// ---------------------------------------------------------------------------
// V1: page history and diff
// ---------------------------------------------------------------------------

/// A restricted project follows the ProjectAuthz read rule on both history
/// routes: a non-grantee is refused with a 403, a grantee and root read it.
#[tokio::test]
async fn history_and_timeline_honour_grants_in_a_restricted_project() {
    let f = Fixture::new().await;
    f.store
        .writer
        .set_new_project_mode(ai_memory_store::AccessMode::Restricted)
        .await
        .unwrap();
    let scope = f.scope("default", "client").await;
    f.write(scope, "secrets/rates.md", "rate one confidential\n", None)
        .await;
    f.write(scope, "secrets/rates.md", "rate two confidential\n", None)
        .await;
    let session = f
        .session(scope, None, &[("prompt", "confidential prompt")])
        .await;
    let alice = f.user("alice").await;
    let bob = f.user("bob").await;
    f.store
        .writer
        .grant_memory(alice, scope.1, GrantLevel::Read, None)
        .await
        .unwrap();

    let web = f.web();
    let api = f.api();
    let session_uri = format!("/w/default/client/s/{session}");
    for (app, uri) in [
        (
            &api,
            "/workspaces/default/projects/client/history/secrets/rates.md",
        ),
        (&web, session_uri.as_str()),
    ] {
        let (status, body) = get_as(app, uri, Some(bob), None).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{uri}: {body}");
        assert!(!body.contains("confidential"), "{uri} leaked: {body}");
        let (status, body) = get_as(app, uri, Some(alice), None).await;
        assert_eq!(status, StatusCode::OK, "{uri}: {body}");
        assert!(body.contains("confidential"), "{uri}: {body}");
        let (status, _) = get_as(app, uri, None, None).await;
        assert_eq!(status, StatusCode::OK, "{uri}");
    }
}

// ---------------------------------------------------------------------------
// V2: session timeline
// ---------------------------------------------------------------------------

/// A 500-observation session renders a bounded page at a time, in capture
/// order, with working prev/next/jump; every render stays under a time bound.
#[tokio::test]
async fn session_timeline_pages_a_500_observation_session() {
    let f = Fixture::new().await;
    let scope = f.scope("default", "app").await;
    let rows: Vec<(String, String)> = (1..=500)
        .map(|i| (format!("step {i}"), format!("body of observation {i}")))
        .collect();
    let borrowed: Vec<(&str, &str)> = rows.iter().map(|(t, b)| (t.as_str(), b.as_str())).collect();
    let session = f.session(scope, None, &borrowed).await;
    let web = f.web();
    let base = format!("/w/default/app/s/{session}");

    let mut timings = Vec::new();
    let render = |uri: String| {
        let web = web.clone();
        async move {
            let started = std::time::Instant::now();
            let (status, html) = get(&web, &uri).await;
            (status, html, started.elapsed())
        }
    };

    let (status, html, took) = render(base.clone()).await;
    timings.push(took);
    assert_eq!(status, StatusCode::OK, "{html}");
    assert_eq!(
        html.matches("<li id=\"obs-").count(),
        50,
        "default page size"
    );
    assert!(html.contains("id=\"obs-1\"") && html.contains("id=\"obs-50\""));
    assert!(!html.contains("id=\"obs-51\""));
    assert!(html.find("step 1<").unwrap() < html.find("step 2<").unwrap());
    assert!(html.contains("1–50 de 500"));
    assert!(html.contains("offset=50&amp;limit=50"), "next link");
    assert!(html.contains("offset=450&amp;limit=50"), "last link");

    // Jump to an observation: the page that holds it.
    let (_, html, took) = render(format!("{base}?at=480")).await;
    timings.push(took);
    assert!(html.contains("id=\"obs-451\"") && html.contains("id=\"obs-480\""));
    assert!(html.contains("id=\"obs-500\"") && !html.contains("id=\"obs-450\""));
    // Out-of-range jumps clamp.
    let (_, html, _) = render(format!("{base}?at=99999")).await;
    assert!(html.contains("id=\"obs-500\""));
    let (_, html, _) = render(format!("{base}?at=0")).await;
    assert!(html.contains("id=\"obs-1\""));

    // A huge limit clamps to the API's maximum page size.
    let (_, html, took) = render(format!("{base}?limit=100000")).await;
    timings.push(took);
    assert_eq!(html.matches("<li id=\"obs-").count(), 200);

    // Walk every default page: ten pages, 500 rows, none twice.
    let mut seen = 0;
    for page in 0..10 {
        let (status, html, took) = render(format!("{base}?offset={}", page * 50)).await;
        timings.push(took);
        assert_eq!(status, StatusCode::OK);
        seen += html.matches("<li id=\"obs-").count();
    }
    assert_eq!(seen, 500);
    // Past the end is an empty page, not an error.
    for offset in ["10000", &usize::MAX.to_string()] {
        let (status, html, _) = render(format!("{base}?offset={offset}")).await;
        assert_eq!(status, StatusCode::OK, "{offset}");
        assert_eq!(html.matches("<li id=\"obs-").count(), 0);
    }

    timings.sort();
    let p95 = timings[(timings.len() * 95).div_ceil(100) - 1];
    assert!(
        p95 < std::time::Duration::from_secs(2),
        "session page render p95 {p95:?}: {timings:?}"
    );
}

/// "Guilty until proven": a raw session id from another project or another
/// workspace reads as not found under the home project, and so does an owned
/// session for a different operator. Controls: the home session, and the
/// owner reading their own.
#[tokio::test]
async fn session_timeline_refuses_foreign_session_ids() {
    let f = Fixture::new().await;
    let home = f.scope("default", "home").await;
    let other = f.scope("default", "other").await;
    let far = f.scope("elsewhere", "home").await;
    let own = f.session(home, None, &[("home", "home prompt")]).await;
    let foreign = f
        .session(other, None, &[("x", "OTHER-PROJECT-PROMPT")])
        .await;
    let far_id = f
        .session(far, None, &[("x", "OTHER-WORKSPACE-PROMPT")])
        .await;
    let owned = f
        .session(home, Some("alice"), &[("mine", "ALICE-ONLY-PROMPT")])
        .await;
    let web = f.web();

    let (status, body) = get(&web, &format!("/w/default/home/s/{own}")).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body.contains("home prompt"));

    for uri in [
        format!("/w/default/home/s/{foreign}"),
        format!("/w/default/home/s/{far_id}"),
        format!("/w/default/home/s/{}", SessionId::new()),
        format!("/w/elsewhere/other/s/{foreign}"),
    ] {
        let (status, body) = get(&web, &uri).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{uri}: {body}");
        assert!(!body.contains("PROMPT"), "{uri} leaked: {body}");
    }
    let (status, _) = get(&web, "/w/default/home/s/not-a-session").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let owned_uri = format!("/w/default/home/s/{owned}");
    let (status, body) = get_as(&web, &owned_uri, None, Some("bob")).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
    assert!(!body.contains("ALICE-ONLY"));
    let (status, body) = get_as(&web, &owned_uri, None, Some("alice")).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body.contains("ALICE-ONLY-PROMPT"));

    // The project page lists the visible sessions and links to them, never
    // another operator's.
    let (_, project) = get_as(&web, "/w/default/home", None, Some("bob")).await;
    let link = |id: SessionId| format!("href=\"w/default/home/s/{id}\"");
    assert!(project.contains(&link(own)), "{project}");
    assert!(!project.contains(&link(owned)), "{project}");
    assert!(!project.contains(&link(foreign)));
    let (_, project) = get_as(&web, "/w/default/home", None, Some("alice")).await;
    assert!(project.contains(&link(owned)), "{project}");
}

/// Captured text is untrusted: markup and attribute-injection payloads in an
/// observation's title and body render as inert text.
#[tokio::test]
async fn session_timeline_renders_captured_markup_inert() {
    let f = Fixture::new().await;
    let scope = f.scope("default", "app").await;
    let title = "<script>alert('title')</script>";
    let body =
        "<script>alert('body')</script>\n\"><img src=x onerror=alert(1)>\n' onmouseover='alert(2)";
    let session = f.session(scope, None, &[(title, body)]).await;
    // The payload must survive ingest, or this test proves nothing.
    let stored = f
        .store
        .reader
        .observations_for_session(session)
        .await
        .unwrap();
    assert!(stored[0].body.contains("<script>"), "{:?}", stored[0].body);
    assert!(
        stored[0].title.contains("<script>"),
        "{:?}",
        stored[0].title
    );

    let (status, html) = get(&f.web(), &format!("/w/default/app/s/{session}")).await;
    assert_eq!(status, StatusCode::OK);
    assert!(!html.contains("<script>alert("), "{html}");
    assert!(!html.contains("<img src=x"), "{html}");
    assert!(!html.contains("' onmouseover='"), "{html}");
    assert!(!html.contains("\"><img src=x onerror="), "{html}");
    assert!(html.contains("&lt;script&gt;alert("), "{html}");
}
