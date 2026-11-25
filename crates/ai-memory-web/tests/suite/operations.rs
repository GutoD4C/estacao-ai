//! Browser writes, directed delivery and scoped operational views.

use ai_memory_core::{
    ActorContext, AgentKind, AuthLevel, AuthorizedViewer, NewSession, NewUser, OwnerFilter,
    SessionId, TokenCall, UserRole,
};
use ai_memory_store::Store;
use ai_memory_web::{api_router, router};
use ai_memory_wiki::Wiki;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use tower::ServiceExt;

async fn fixture() -> (
    tempfile::TempDir,
    Store,
    Wiki,
    ai_memory_core::WorkspaceId,
    ai_memory_core::ProjectId,
    SessionId,
) {
    let tmp = tempfile::tempdir().unwrap();
    let store = Store::open(tmp.path()).unwrap();
    let wiki = Wiki::new(tmp.path(), store.writer.clone()).unwrap();
    let ws = store.writer.get_or_create_workspace("team").await.unwrap();
    let project = store
        .writer
        .get_or_create_project(ws, "app", None)
        .await
        .unwrap();
    let sid = SessionId::new();
    store
        .writer
        .begin_session(NewSession {
            id: sid,
            workspace_id: ws,
            project_id: project,
            agent_kind: AgentKind::Codex,
            cwd: None,
            actor_user: None,
            occurred_at: None,
        })
        .await
        .unwrap();
    (tmp, store, wiki, ws, project, sid)
}

async fn text(response: axum::response::Response) -> String {
    String::from_utf8(
        axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap()
}

#[tokio::test]
async fn operations_project_tabs_have_one_default_panel_and_matching_controls() {
    let (_tmp, store, wiki, _, _, _) = fixture().await;
    let response = router(store.reader.clone(), wiki)
        .oneshot(
            Request::builder()
                .uri("/w/team/app")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let html = text(response).await;
    assert_eq!(
        html.matches("class=\"project-panel\" role=\"tabpanel\"")
            .count(),
        5
    );
    assert_eq!(html.matches("<a id=\"project-tab-").count(), 5);
    for tab in ["overview", "agents", "tokens", "sessions", "knowledge"] {
        let panel = html
            .split(&format!("<section id=\"project-panel-{tab}\""))
            .nth(1)
            .unwrap()
            .split('>')
            .next()
            .unwrap();
        assert_eq!(panel.contains("hidden"), tab != "overview");
        assert!(panel.contains(&format!("aria-labelledby=\"project-tab-{tab}\"")));
        let control = html
            .split(&format!("<a id=\"project-tab-{tab}\""))
            .nth(1)
            .unwrap()
            .split('>')
            .next()
            .unwrap();
        assert!(control.contains(&format!("href=\"w/team/app?tab={tab}\"")));
        assert!(control.contains(&format!("aria-controls=\"project-panel-{tab}\"")));
        assert!(control.contains(&format!("aria-selected=\"{}\"", tab == "overview")));
        assert_eq!(control.contains("tabindex=\"-1\""), tab != "overview");
    }
    let overview = html
        .split("id=\"project-panel-overview\"")
        .nth(1)
        .unwrap()
        .split("id=\"project-panel-agents\"")
        .next()
        .unwrap();
    assert!(overview.contains("Resumo de captura do projeto"));
    for detail in [
        "id=\"agents\"",
        "id=\"token-usage\"",
        "id=\"knowledge\"",
        "id=\"session-token-table\"",
    ] {
        assert!(!overview.contains(detail));
    }
}

#[tokio::test]
async fn operations_agent_totals_and_session_drilldown_do_not_multiply_tokens() {
    let (_tmp, store, wiki, ws, project, sid) = fixture().await;
    let calls: Vec<_> = (0..3)
        .map(|i| TokenCall {
            context: None,
            call_id: format!("call-{i}"),
            input_tokens: 100,
            output_tokens: 30,
            cache_read_tokens: 400,
            cache_write_tokens: 20,
            model: Some("test-model".into()),
        })
        .collect();
    store.writer.upsert_token_calls(sid, calls).await.unwrap();
    let report = store
        .reader
        .agent_usage(ws, project, OwnerFilter::Any)
        .await
        .unwrap();
    assert_eq!(report[0].input, 300);
    assert_eq!(report[0].calls, 3);
    assert_eq!(report[0].sessions, 1);
    let app = router(store.reader.clone(), wiki);
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/w/team/app/agents/codex")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let html = text(response).await;
    assert!(html.contains("Codex"));
    assert!(html.contains(&sid.to_string()));
    assert!(html.contains("href=\"#agent-sessions\""));
    assert!(html.contains("?tab=tokens&calls_agent=codex#token-usage"));
    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/w/team/app/s/{sid}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let html = text(response).await;
    assert!(html.contains("test-model"));
    assert!(html.contains("call-2"));
    let foreign = store
        .reader
        .session_token_usage(
            ai_memory_core::WorkspaceId::new(),
            project,
            sid,
            OwnerFilter::Any,
        )
        .await
        .unwrap();
    assert_eq!(foreign.call_count, 0);
}

#[tokio::test]
async fn operations_agent_aggregates_and_drilldowns_apply_ownership_before_totals() {
    let (_tmp, store, _wiki, ws, project, _) = fixture().await;
    let alice = ai_memory_core::IdentityKey::User("alice".into()).storage_key();
    let bob = ai_memory_core::IdentityKey::User("bob".into()).storage_key();
    let mut sessions = Vec::new();
    for (owner, tokens) in [(alice.clone(), 100), (bob, 900)] {
        let sid = SessionId::new();
        store
            .writer
            .begin_session(NewSession {
                id: sid,
                workspace_id: ws,
                project_id: project,
                agent_kind: AgentKind::Codex,
                cwd: None,
                actor_user: Some(owner),
                occurred_at: None,
            })
            .await
            .unwrap();
        store
            .writer
            .upsert_token_calls(
                sid,
                vec![TokenCall {
                    context: None,
                    call_id: sid.to_string(),
                    input_tokens: tokens,
                    output_tokens: 5,
                    cache_read_tokens: 0,
                    cache_write_tokens: 0,
                    model: None,
                }],
            )
            .await
            .unwrap();
        sessions.push(sid);
    }
    let filter = OwnerFilter::User(alice);
    let totals = store
        .reader
        .agent_usage(ws, project, filter.clone())
        .await
        .unwrap();
    assert_eq!(totals[0].sessions, 2); // Shared legacy sessions remain readable.
    assert_eq!(totals[0].input, 100);
    assert_eq!(totals[0].calls, 1);
    let rows = store
        .reader
        .agent_sessions(ws, project, AgentKind::Codex, filter.clone(), 0)
        .await
        .unwrap();
    assert!(rows.iter().any(|s| s.session_id == sessions[0]));
    assert!(!rows.iter().any(|s| s.session_id == sessions[1]));
    let foreign = store
        .reader
        .session_token_usage(ws, project, sessions[1], filter)
        .await
        .unwrap();
    assert_eq!(foreign.call_count, 0);
}

#[tokio::test]
async fn operations_root_drilldowns_reach_every_users_sessions_and_users_stay_owned() {
    // The dashboard counts every user's sessions; root's drilldowns must reach
    // them (#1867), while a user still sees only their own and shared ones.
    let (_tmp, store, wiki, ws, project, shared) = fixture().await;
    let mut users = Vec::new();
    for name in ["alice", "bob"] {
        let id = store
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
            .unwrap();
        let sid = SessionId::new();
        store
            .writer
            .begin_session(NewSession {
                id: sid,
                workspace_id: ws,
                project_id: project,
                agent_kind: AgentKind::Codex,
                cwd: None,
                actor_user: Some(ai_memory_core::IdentityKey::User(name.into()).storage_key()),
                occurred_at: None,
            })
            .await
            .unwrap();
        store.writer.end_session(sid, None).await.unwrap();
        users.push((name, id, sid));
    }
    let (_, alice, alice_session) = users[0];
    let (_, _, bob_session) = users[1];
    let as_alice = |uri: &str| {
        Request::builder()
            .uri(uri)
            .extension(AuthLevel::User)
            .extension(AuthorizedViewer(alice))
            .extension(ActorContext {
                user: Some("alice".into()),
                ..ActorContext::anonymous()
            })
            .body(Body::empty())
            .unwrap()
    };
    let as_root = |uri: &str| {
        Request::builder()
            .uri(uri)
            .extension(AuthLevel::Root)
            .extension(ActorContext {
                user: Some("admin".into()),
                ..ActorContext::anonymous()
            })
            .body(Body::empty())
            .unwrap()
    };
    let app = router(store.reader.clone(), wiki.clone());
    let api = api_router(store.reader.clone(), wiki);

    for uri in ["/w/team/app/agents/codex", "/w/team/app?tab=sessions"] {
        let user_view = text(app.clone().oneshot(as_alice(uri)).await.unwrap()).await;
        assert!(user_view.contains(&alice_session.to_string()), "{uri}");
        assert!(user_view.contains(&shared.to_string()), "{uri}");
        assert!(
            !user_view.contains(&bob_session.to_string()),
            "{uri}: foreign session"
        );
        let root_view = text(app.clone().oneshot(as_root(uri)).await.unwrap()).await;
        for sid in [alice_session, bob_session, shared] {
            assert!(
                root_view.contains(&sid.to_string()),
                "{uri}: root misses {sid}"
            );
        }
    }

    let bob_page = format!("/w/team/app/s/{bob_session}");
    assert_eq!(
        app.clone()
            .oneshot(as_alice(&bob_page))
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        app.oneshot(as_root(&bob_page)).await.unwrap().status(),
        StatusCode::OK
    );

    let list = "/workspaces/team/projects/app/sessions?include_open=true";
    let user_list = text(api.clone().oneshot(as_alice(list)).await.unwrap()).await;
    assert!(user_list.contains(&alice_session.to_string()));
    assert!(!user_list.contains(&bob_session.to_string()));
    let root_list = text(api.clone().oneshot(as_root(list)).await.unwrap()).await;
    assert!(root_list.contains(&bob_session.to_string()));
    let bob_observations =
        format!("/workspaces/team/projects/app/sessions/{bob_session}/observations");
    assert_eq!(
        api.clone()
            .oneshot(as_alice(&bob_observations))
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        api.oneshot(as_root(&bob_observations))
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn operations_response_search_and_pagination_cover_the_full_project_and_session() {
    let (_tmp, store, wiki, _, _, sid) = fixture().await;
    let calls = (0..57)
        .map(|n| TokenCall {
            context: None,
            call_id: format!("response-{n}"),
            input_tokens: if n == 56 { 1 } else { 1000 },
            output_tokens: 1,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
            model: Some(if n == 56 {
                "unique-tiny-model".into()
            } else {
                "bulk-model".into()
            }),
        })
        .collect();
    store.writer.upsert_token_calls(sid, calls).await.unwrap();
    let app = router(store.reader.clone(), wiki);
    for base in ["/w/team/app".into(), format!("/w/team/app/s/{sid}")] {
        for (query, count, contains) in [
            ("", 50, false),
            ("?calls_q=unique-tiny-model", 1, true),
            ("?calls_offset=50", 7, true),
            ("?calls_signal=signals", 0, false),
        ] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri(format!("{base}{query}"))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            let status = response.status();
            let html = text(response).await;
            assert_eq!(status, StatusCode::OK, "{base}{query}: {html}");
            assert!(html.contains("Chamadas capturadas</span><strong>57</strong>"));
            assert_eq!(html.matches("<tr data-call-row").count(), count);
            let results = html
                .split("<div class=\"usage-results\">")
                .nth(1)
                .unwrap()
                .split("<p class=\"usage-note\">")
                .next()
                .unwrap();
            assert_eq!(results.contains("unique-tiny-model"), contains);
        }
        for query in [
            "?calls_sort=unknown",
            "?calls_signal=unknown",
            "?calls_agent=invalid",
            "?calls_session=not-uuid",
            "?calls_from=tomorrow",
            "?calls_from=2026-10-02&calls_until=2026-10-01",
        ] {
            assert_eq!(
                app.clone()
                    .oneshot(
                        Request::builder()
                            .uri(format!("{base}{query}"))
                            .body(Body::empty())
                            .unwrap()
                    )
                    .await
                    .unwrap()
                    .status(),
                StatusCode::BAD_REQUEST
            );
        }
    }
}
