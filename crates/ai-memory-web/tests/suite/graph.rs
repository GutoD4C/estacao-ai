//! Built-in `/web/graph` pages and the in-project `/api/v1/.../graph` JSON.

use ai_memory_core::{NewPage, PagePath, Tier};
use ai_memory_store::Store;
use ai_memory_web::{api_router, router};
use ai_memory_wiki::Wiki;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use tempfile::TempDir;
use tower::ServiceExt;

async fn setup() -> (TempDir, Store, Wiki) {
    let tmp = TempDir::new().unwrap();
    let store = Store::open(tmp.path()).unwrap();
    let wiki = Wiki::new(tmp.path(), store.writer.clone()).unwrap();
    (tmp, store, wiki)
}

fn page_with_links(
    ws: ai_memory_core::WorkspaceId,
    proj: ai_memory_core::ProjectId,
    path: &str,
    title: &str,
    links: Vec<ai_memory_core::LinkTarget>,
) -> NewPage {
    NewPage {
        workspace_id: ws,
        project_id: proj,
        path: PagePath::new(path).unwrap(),
        title: title.to_owned(),
        body: "body".into(),
        tier: Tier::Semantic,
        frontmatter_json: serde_json::json!({"kind": "fact"}),
        pinned: false,
        links,
        author_id: None,
        expires_at: None,
        entities: Vec::new(),
        evidence: Vec::new(),
    }
}

fn same_project_link(path: &str) -> ai_memory_core::LinkTarget {
    ai_memory_core::LinkTarget {
        workspace: None,
        project: None,
        path: PagePath::new(path).unwrap(),
        relation: None,
    }
}

fn cross_project_link(project: &str, path: &str) -> ai_memory_core::LinkTarget {
    ai_memory_core::LinkTarget {
        workspace: None,
        project: Some(project.to_string()),
        path: PagePath::new(path).unwrap(),
        relation: None,
    }
}

async fn get(app: axum::Router, uri: &str) -> (StatusCode, String) {
    let resp = app
        .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = resp.status();
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    (status, String::from_utf8(body.to_vec()).unwrap())
}

#[tokio::test]
async fn graph_pages_render_svg_and_edge_table() {
    let (_tmp, store, wiki) = setup().await;
    let ws = store
        .writer
        .get_or_create_workspace("default")
        .await
        .unwrap();
    let app = store
        .writer
        .get_or_create_project(ws, "app", None)
        .await
        .unwrap();
    let lib = store
        .writer
        .get_or_create_project(ws, "lib", None)
        .await
        .unwrap();
    store
        .writer
        .upsert_page(page_with_links(ws, lib, "notes/x.md", "Lib note", vec![]))
        .await
        .unwrap();
    store
        .writer
        .upsert_page(page_with_links(ws, app, "notes/b.md", "B", vec![]))
        .await
        .unwrap();
    store
        .writer
        .upsert_page(page_with_links(
            ws,
            app,
            "notes/a.md",
            "A",
            vec![
                same_project_link("notes/b.md"),
                cross_project_link("lib", "notes/x.md"),
            ],
        ))
        .await
        .unwrap();

    let web = router(store.reader.clone(), wiki.clone());
    let api = api_router(store.reader.clone(), wiki);

    let (status, home) = get(web.clone(), "/").await;
    assert_eq!(status, StatusCode::OK);
    assert!(home.contains(r#"href="graph""#), "{home}");
    assert!(home.contains("Grafo de conhecimento"), "{home}");

    let (status, project) = get(web.clone(), "/w/default/app").await;
    assert_eq!(status, StatusCode::OK);
    assert!(project.contains("w/default/app/graph"), "{project}");

    let (status, html) = get(web.clone(), "/graph").await;
    assert_eq!(status, StatusCode::OK, "{html}");
    assert!(html.contains("<svg"), "{html}");
    assert!(html.contains("default/lib:notes/x.md"), "{html}");
    assert!(html.contains("default/app:notes/a.md"), "{html}");
    assert!(html.contains("w/default/lib/graph"), "{html}");

    let (status, html) = get(web.clone(), "/w/default/app/graph").await;
    assert_eq!(status, StatusCode::OK, "{html}");
    assert!(html.contains("<svg"), "{html}");
    assert!(html.contains("static/estacao-grafo.js"), "{html}");
    assert!(html.contains("data-from=\""), "{html}");
    assert!(html.contains("data-kind=\"Nota\""), "{html}");
    assert!(html.contains("notes/a.md"), "{html}");
    assert!(html.contains("notes/b.md"), "{html}");
    assert!(
        !html.contains("notes/x.md"),
        "in-project graph must omit the cross-project target: {html}"
    );
    assert!(html.contains("w/default/app/p/notes/a.md"), "{html}");

    let (status, body) = get(api.clone(), "/graph").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body.contains("notes/x.md"), "{body}");

    let (status, body) = get(api, "/workspaces/default/projects/app/graph").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let json: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(json["workspace"], "default");
    assert_eq!(json["project"], "app");
    assert_eq!(json["truncated"], false);
    let paths: Vec<&str> = json["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n["path"].as_str().unwrap())
        .collect();
    assert!(
        paths.contains(&"notes/a.md") && paths.contains(&"notes/b.md"),
        "{body}"
    );
    assert!(!paths.contains(&"notes/x.md"), "{body}");
    assert_eq!(json["edges"][0]["from_path"], "notes/a.md");
    assert_eq!(json["edges"][0]["to_path"], "notes/b.md");
}

#[tokio::test]
async fn graph_page_renders_hostile_titles_inert() {
    let (_tmp, store, wiki) = setup().await;
    let ws = store
        .writer
        .get_or_create_workspace("default")
        .await
        .unwrap();
    let proj = store
        .writer
        .get_or_create_project(ws, "app", None)
        .await
        .unwrap();
    let title = "<script>alert('title')</script>";
    store
        .writer
        .upsert_page(page_with_links(ws, proj, "notes/a.md", title, vec![]))
        .await
        .unwrap();
    store
        .writer
        .upsert_page(page_with_links(
            ws,
            proj,
            "notes/b.md",
            "\"><img src=x onerror=alert(1)>",
            vec![same_project_link("notes/a.md")],
        ))
        .await
        .unwrap();

    let web = router(store.reader, wiki);
    let (status, html) = get(web, "/w/default/app/graph").await;
    assert_eq!(status, StatusCode::OK);
    assert!(!html.contains("<script>alert("), "{html}");
    assert!(!html.contains("<img src=x"), "{html}");
    assert!(html.contains("&lt;script&gt;alert("), "{html}");
}

#[tokio::test]
async fn project_graph_unknown_project_is_not_found() {
    let (_tmp, store, wiki) = setup().await;
    let web = router(store.reader.clone(), wiki.clone());
    let api = api_router(store.reader, wiki);
    let (status, body) = get(web, "/w/default/missing/graph").await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
    let (status, body) = get(api, "/workspaces/default/projects/missing/graph").await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
}

#[tokio::test]
async fn graph_surfaces_external_machine_projects_sessions_and_observations_without_pages() {
    let (_tmp, store, wiki) = setup().await;
    let ws = store
        .writer
        .get_or_create_workspace("default")
        .await
        .unwrap();
    let proj_with_page = store
        .writer
        .get_or_create_project(ws, "repo-alpha", None)
        .await
        .unwrap();
    let proj_external_only = store
        .writer
        .get_or_create_project(ws, "portaria-externa", None)
        .await
        .unwrap();

    store
        .writer
        .upsert_page(page_with_links(
            ws,
            proj_with_page,
            "_rules/regra-alpha.md",
            "Regra Alpha Consolidada",
            vec![],
        ))
        .await
        .unwrap();

    // Insere sessão, handoff e observação relevante diretamente no projeto externo sem páginas.
    let sid = ai_memory_core::SessionId::new();
    store
        .writer
        .begin_session(ai_memory_core::NewSession {
            occurred_at: None,
            id: sid,
            workspace_id: ws,
            project_id: proj_external_only,
            agent_kind: ai_memory_core::AgentKind::ClaudeCode,
            cwd: Some("/tmp/portaria-externa".into()),
            actor_user: None,
        })
        .await
        .unwrap();
    store
        .writer
        .insert_handoff(ai_memory_core::NewHandoff {
            workspace_id: ws,
            project_id: proj_external_only,
            from_session_id: Some(sid),
            from_agent: ai_memory_core::AgentKind::ClaudeCode,
            to_agent: None,
            cwd: Some("/tmp/portaria-externa".into()),
            summary: "Integrar autenticacao da portaria com chave local".into(),
            open_questions: Vec::new(),
            next_steps: Vec::new(),
            files_touched: vec!["src/portaria.rs".into()],
            owner_user: None,
        })
        .await
        .unwrap();
    store
        .writer
        .insert_observation(ai_memory_core::Sanitized::new(
            ai_memory_core::NewObservation {
                occurred_at: None,
                session_id: sid,
                workspace_id: ws,
                project_id: proj_external_only,
                kind: ai_memory_core::ObservationKind::UserPrompt,
                extension: None,
                source_event: None,
                title: "Usar token rotativo na sincronizacao externa".into(),
                body: "Decisao tomada fora da Estacao I.A via Claude Code".into(),
                importance: 8,
                file_path: Some("src/portaria.rs".into()),
            },
            &ai_memory_core::Sanitizer::builtin(),
        ))
        .await
        .unwrap();

    let web = router(store.reader, wiki);
    let (status, global_html) = get(web.clone(), "/graph").await;
    assert_eq!(status, StatusCode::OK, "{global_html}");
    assert!(
        global_html.contains("Regra Alpha Consolidada"),
        "{global_html}"
    );
    assert!(
        global_html.contains("default/portaria-externa"),
        "{global_html}"
    );
    assert!(global_html.contains("Claude Code"), "{global_html}");
    assert!(global_html.contains("Usar token rotativo"), "{global_html}");

    let (status, proj_html) = get(web, "/w/default/portaria-externa/graph").await;
    assert_eq!(status, StatusCode::OK, "{proj_html}");
    assert!(proj_html.contains("Claude Code"), "{proj_html}");
    assert!(proj_html.contains("Usar token rotativo"), "{proj_html}");
    assert!(proj_html.contains("Integrar autenticacao"), "{proj_html}");
}
