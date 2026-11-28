//! Read-only wiki link graph pages.
//!
//! `GET /graph` draws resolved wikilinks whose endpoints sit in different
//! projects. `GET /w/:workspace/:project/graph` draws the latest unexpired
//! pages in that project and the resolved same-project links among them.
//! Both answers are HTML: a circular SVG plus a table, with no JavaScript.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use askama::Template;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{Html, IntoResponse, Response};

use ai_memory_store::{CrossProjectEdge, LinkGraph, PROJECT_LINK_GRAPH_MAX_NODES};

use crate::estacao::estado::{eh_conversa, estacao};
use crate::routes::learnings::{
    classify_learning_kind, load_all_project_learnings, load_scope_context,
};
use crate::state::WebState;
use crate::templates::{
    GraphEdgeRow, GraphProjectLink, GraphSvgEdge, GraphSvgNode, GraphView, encode_segment,
    graph_href, page_href, project_href,
};

/// Pixel centre of the SVG viewBox.
const SVG_CX: f64 = 400.0;
/// Pixel centre of the SVG viewBox.
const SVG_CY: f64 = 400.0;
/// Radius of the node circle.
const SVG_RADIUS: f64 = 300.0;
/// Characters kept in an SVG node label before an ellipsis.
const SVG_LABEL_CHARS: usize = 24;

/// Handler for `GET /graph`.
pub(crate) async fn global_handler(
    axum::Extension(i18n): axum::Extension<ai_memory_core::i18n::Localizer>,
    State(state): State<Arc<WebState>>,
    viewer: Option<axum::Extension<ai_memory_core::AuthorizedViewer>>,
) -> Response {
    let viewer_id = viewer.map(|axum::Extension(viewer)| viewer.user());
    match render_global(&i18n, &state, viewer_id).await {
        Ok(html) => html.into_response(),
        Err(status) => status.into_response(),
    }
}

/// Handler for `GET /w/:workspace/:project/graph`.
pub(crate) async fn project_handler(
    axum::Extension(i18n): axum::Extension<ai_memory_core::i18n::Localizer>,
    State(state): State<Arc<WebState>>,
    viewer: Option<axum::Extension<ai_memory_core::AuthorizedViewer>>,
    Path((workspace, project)): Path<(String, String)>,
) -> Response {
    let viewer_id = viewer.as_ref().map(|axum::Extension(viewer)| viewer.user());
    let scope = match super::resolve_read_scope(&state, viewer_id, &workspace, &project).await {
        Ok(scope) => scope,
        Err(refusal) => return super::page::localized_refusal_response(&i18n, &refusal),
    };
    let graph = match state
        .reader
        .project_link_graph(scope.workspace_id, scope.project_id)
        .await
    {
        Ok(graph) => graph,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let extras = load_scope_context(&state, scope.workspace_id, scope.project_id, 18).await;
    match render_project(&i18n, &workspace, &project, graph, &extras) {
        Ok(html) => html.into_response(),
        Err(status) => status.into_response(),
    }
}

async fn render_global(
    i18n: &ai_memory_core::i18n::Localizer,
    state: &WebState,
    viewer: Option<ai_memory_core::UserId>,
) -> Result<Html<String>, StatusCode> {
    let edges = state
        .reader
        .cross_project_edges(None, viewer)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let (mut svg_nodes, mut svg_edges, mut rows) = aggregate_projects(&edges);

    let all_learnings = if viewer.is_none() {
        load_all_project_learnings(state, None, 6, 4).await
    } else {
        Vec::new()
    };
    let project_graphs: Vec<GraphProjectLink> = all_learnings
        .iter()
        .take(36)
        .map(|s| {
            let badge = match (s.page_count, s.observation_count) {
                (p, o) if p > 0 && o > 0 => format!("{p} pág. · {o} obs."),
                (p, _) if p > 0 => format!("{p} pág."),
                (_, o) => format!("{o} obs."),
            };
            GraphProjectLink {
                label: format!("{}/{}", s.workspace, s.project),
                href: graph_href(&s.workspace, &s.project),
                badge,
            }
        })
        .collect();

    let (e_nodes, e_edges, e_rows) = if viewer.is_none() {
        build_estacao_graph(state, None, &all_learnings).await
    } else {
        (Vec::new(), Vec::new(), Vec::new())
    };
    let has_estacao_nodes = !e_nodes.is_empty();
    let blurb = if has_estacao_nodes {
        let cross_links_only = !rows.is_empty();
        svg_nodes = e_nodes;
        svg_edges = e_edges;
        if !cross_links_only {
            rows = e_rows;
        } else {
            rows.extend(e_rows);
        }
        "Mapa neural interativo com projetos da Estação I.A e todos os projetos ativos na máquina (páginas, regras, handoffs, agentes e capturas).".into()
    } else {
        "Resolved wikilinks whose endpoints sit in different projects. \
         An edge is shown only when both ends are readable."
            .to_owned()
    };

    GraphView {
        i18n: i18n.clone(),
        is_project: false,
        workspace: String::new(),
        project: String::new(),
        project_href: String::new(),
        heading: "Link graph".into(),
        blurb,
        empty_message: "No cross-project links yet.".into(),
        truncated: false,
        shown: svg_nodes.len(),
        node_cap: 0,
        svg_nodes,
        svg_edges,
        rows,
        project_graphs,
        has_estacao_nodes,
    }
    .render()
    .map(Html)
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn build_estacao_graph(
    state: &WebState,
    _viewer: Option<ai_memory_core::UserId>,
    learnings: &[crate::routes::learnings::ScopeLearnings],
) -> (Vec<GraphSvgNode>, Vec<GraphSvgEdge>, Vec<GraphEdgeRow>) {
    struct RawNode {
        label: String,
        tooltip: String,
        href: String,
        color: &'static str,
        kind: &'static str,
    }
    fn add_node(
        raw_nodes: &mut Vec<RawNode>,
        index: &mut BTreeMap<String, usize>,
        key: String,
        node: RawNode,
    ) -> usize {
        if let Some(&idx) = index.get(&key) {
            return idx;
        }
        let idx = raw_nodes.len();
        index.insert(key, idx);
        raw_nodes.push(node);
        idx
    }

    let mut raw_nodes: Vec<RawNode> = Vec::new();
    let mut index: BTreeMap<String, usize> = BTreeMap::new();
    let mut raw_edges: Vec<(usize, usize)> = Vec::new();

    {
        let est = estacao(state);
        let e = est.estado.lock().await;
        for ag in e.agentes.iter().take(16) {
            add_node(
                &mut raw_nodes,
                &mut index,
                format!("ag:{}", ag.id),
                RawNode {
                    label: ag.nome.clone(),
                    tooltip: format!("Agente: {} ({})", ag.nome, ag.modelo),
                    href: "modelos".into(),
                    color: "#10b981",
                    kind: "Agente",
                },
            );
        }
        for p in e.projetos.iter().take(14) {
            let is_chat = eh_conversa(p);
            let p_idx = add_node(
                &mut raw_nodes,
                &mut index,
                format!("pr:{}", p.id),
                RawNode {
                    label: p.nome.clone(),
                    tooltip: format!("{}: {}", if is_chat { "Chat" } else { "Projeto" }, p.nome),
                    href: if is_chat {
                        "chat".into()
                    } else {
                        format!("projetos/{}", encode_segment(&p.id))
                    },
                    color: if is_chat { "#d97706" } else { "#2563eb" },
                    kind: if is_chat { "Chat" } else { "Projeto" },
                },
            );
            for ag_id in &p.agentes {
                if let Some(&ag_idx) = index.get(&format!("ag:{ag_id}")) {
                    raw_edges.push((p_idx, ag_idx));
                }
            }
            if !p.memoria.trim().is_empty()
                && let Some((ws, proj)) = p.memoria.split_once('/')
            {
                let m_idx = add_node(
                    &mut raw_nodes,
                    &mut index,
                    format!("mem:{ws}/{proj}"),
                    RawNode {
                        label: format!("{ws}/{proj}"),
                        tooltip: format!("Memória ligada: {ws}/{proj}"),
                        href: graph_href(ws, proj),
                        color: "#06b6d4",
                        kind: "Memória",
                    },
                );
                raw_edges.push((p_idx, m_idx));
            }
        }
        for t in e
            .tarefas
            .iter()
            .filter(|t| t.status == "concluida")
            .take(12)
        {
            let t_idx = add_node(
                &mut raw_nodes,
                &mut index,
                format!("tf:{}", t.id),
                RawNode {
                    label: t.titulo.clone(),
                    tooltip: format!("Tarefa concluída: {}", t.titulo),
                    href: format!("projetos/{}", encode_segment(&t.projeto)),
                    color: "#8b5cf6",
                    kind: "Concluída",
                },
            );
            if let Some(&p_idx) = index.get(&format!("pr:{}", t.projeto)) {
                raw_edges.push((p_idx, t_idx));
            }
            if let Some(ag_id) = &t.agente
                && let Some(&ag_idx) = index.get(&format!("ag:{ag_id}"))
            {
                raw_edges.push((ag_idx, t_idx));
            }
        }
    }

    // Inclui todos os projetos capturados na máquina (páginas, regras, agentes externos, handoffs e sinais)
    const MAX_GRAPH_NODES: usize = 190;
    let mut included_pages: BTreeMap<(String, String, String), usize> = BTreeMap::new();

    for scope in learnings {
        if raw_nodes.len() >= MAX_GRAPH_NODES {
            break;
        }
        let scope_key = format!("{}/{}", scope.workspace, scope.project);
        let mut tooltip = format!(
            "Memória na máquina: {scope_key} · {} pág. · {} obs.",
            scope.page_count, scope.observation_count
        );
        if !scope.pasta.is_empty() {
            tooltip.push_str(&format!(" · {}", scope.pasta));
        }
        let scope_idx = add_node(
            &mut raw_nodes,
            &mut index,
            format!("mem:{scope_key}"),
            RawNode {
                label: scope_key.clone(),
                tooltip,
                href: graph_href(&scope.workspace, &scope.project),
                color: "#06b6d4",
                kind: "Memória",
            },
        );

        for ag in &scope.agentes {
            let ag_idx = add_node(
                &mut raw_nodes,
                &mut index,
                format!("agext:{}", ag.to_lowercase()),
                RawNode {
                    label: ag.clone(),
                    tooltip: format!("Agente na máquina: {ag}"),
                    href: project_href(&scope.workspace, &scope.project),
                    color: "#10b981",
                    kind: "Agente",
                },
            );
            raw_edges.push((scope_idx, ag_idx));
        }

        for pg in &scope.pages {
            if raw_nodes.len() >= MAX_GRAPH_NODES {
                break;
            }
            let (kind, color) = classify_learning_kind(&pg.path);
            let pg_idx = add_node(
                &mut raw_nodes,
                &mut index,
                format!("pg:{scope_key}/{}", pg.path),
                RawNode {
                    label: pg.title.clone(),
                    tooltip: format!("[{kind}] {} ({scope_key})", pg.title),
                    href: page_href(&scope.workspace, &scope.project, &pg.path),
                    color,
                    kind,
                },
            );
            included_pages.insert(
                (
                    scope.workspace.clone(),
                    scope.project.clone(),
                    pg.path.clone(),
                ),
                pg_idx,
            );
            raw_edges.push((scope_idx, pg_idx));
        }

        for (i, h) in scope.handoffs.iter().take(3).enumerate() {
            if raw_nodes.len() >= MAX_GRAPH_NODES {
                break;
            }
            let h_idx = add_node(
                &mut raw_nodes,
                &mut index,
                format!("ho:{scope_key}:{}:{i}", h.created_at),
                RawNode {
                    label: h.summary.clone(),
                    tooltip: format!("[Handoff · {}] {} ({scope_key})", h.from_agent, h.summary),
                    href: format!(
                        "{}?tab=sessions",
                        project_href(&scope.workspace, &scope.project)
                    ),
                    color: "#f97316",
                    kind: "Handoff",
                },
            );
            raw_edges.push((scope_idx, h_idx));
            if let Some(&ag_idx) = index.get(&format!("agext:{}", h.from_agent.to_lowercase())) {
                raw_edges.push((ag_idx, h_idx));
            }
        }

        for (i, sig) in scope.signals.iter().take(4).enumerate() {
            if raw_nodes.len() >= MAX_GRAPH_NODES {
                break;
            }
            let s_idx = add_node(
                &mut raw_nodes,
                &mut index,
                format!("sig:{scope_key}:{}:{i}", sig.created_at),
                RawNode {
                    label: sig.title.clone(),
                    tooltip: format!(
                        "[{}] {} ({scope_key})",
                        sig.kind,
                        if sig.detail.is_empty() {
                            &sig.title
                        } else {
                            &sig.detail
                        }
                    ),
                    href: format!(
                        "{}?tab=sessions",
                        project_href(&scope.workspace, &scope.project)
                    ),
                    color: sig.color,
                    kind: sig.kind,
                },
            );
            raw_edges.push((scope_idx, s_idx));
            if !sig.agent.is_empty()
                && let Some(&ag_idx) = index.get(&format!("agext:{}", sig.agent.to_lowercase()))
            {
                raw_edges.push((ag_idx, s_idx));
            }
        }
    }

    // Adiciona links wiki explícitos entre páginas incluídas
    if !included_pages.is_empty() {
        let page_links: Vec<(String, String, String, String, String, String)> = state
            .reader
            .with_conn(|conn| {
                let mut stmt = conn.prepare(
                    "SELECT w1.name, pr1.name, p1.path, w2.name, pr2.name, p2.path \
                     FROM links l \
                     JOIN pages p1 ON p1.id = l.from_page_id \
                     JOIN workspaces w1 ON w1.id = p1.workspace_id \
                     JOIN projects pr1 ON pr1.id = p1.project_id \
                     JOIN pages p2 ON p2.id = l.to_page_id \
                     JOIN workspaces w2 ON w2.id = p2.workspace_id \
                     JOIN projects pr2 ON pr2.id = p2.project_id \
                     WHERE p1.is_latest = 1 AND p2.is_latest = 1 \
                     LIMIT 400",
                )?;
                let rows = stmt
                    .query_map([], |r| {
                        Ok((
                            r.get(0)?,
                            r.get(1)?,
                            r.get(2)?,
                            r.get(3)?,
                            r.get(4)?,
                            r.get(5)?,
                        ))
                    })?
                    .filter_map(Result::ok)
                    .collect();
                Ok(rows)
            })
            .await
            .unwrap_or_default();
        for (w1, pr1, pa1, w2, pr2, pa2) in page_links {
            if let (Some(&a), Some(&b)) = (
                included_pages.get(&(w1, pr1, pa1)),
                included_pages.get(&(w2, pr2, pa2)),
            ) {
                raw_edges.push((a, b));
            }
        }
    }
    let coords = circular_layout(raw_nodes.len(), SVG_CX, SVG_CY, SVG_RADIUS);
    let svg_nodes: Vec<GraphSvgNode> = raw_nodes
        .iter()
        .enumerate()
        .map(|(i, n)| {
            let (x, y) = coords[i];
            GraphSvgNode {
                href: n.href.clone(),
                tooltip: n.tooltip.clone(),
                label: truncate_label(&n.label, SVG_LABEL_CHARS),
                x: x.round() as i32,
                y: y.round() as i32,
                label_y: (y + 22.0).round() as i32,
                color: n.color,
                kind: n.kind,
            }
        })
        .collect();

    let mut drawn: BTreeSet<(usize, usize)> = BTreeSet::new();
    let mut svg_edges = Vec::new();
    let mut rows = Vec::new();
    for (from, to) in raw_edges {
        if from == to {
            continue;
        }
        let pair = if from <= to { (from, to) } else { (to, from) };
        if drawn.insert(pair) {
            svg_edges.push(svg_line(from, to, &coords[from], &coords[to]));
            rows.push(GraphEdgeRow {
                from_href: raw_nodes[from].href.clone(),
                from_label: format!("[{}] {}", raw_nodes[from].kind, raw_nodes[from].label),
                to_href: raw_nodes[to].href.clone(),
                to_label: format!("[{}] {}", raw_nodes[to].kind, raw_nodes[to].label),
            });
        }
    }
    (svg_nodes, svg_edges, rows)
}

type ScopeContext = (
    Vec<String>,
    Vec<crate::routes::learnings::LearnedHandoff>,
    Vec<crate::routes::learnings::LearnedSignal>,
    Vec<(String, String)>,
);

fn render_project(
    i18n: &ai_memory_core::i18n::Localizer,
    workspace: &str,
    project: &str,
    graph: LinkGraph,
    context: &ScopeContext,
) -> Result<Html<String>, StatusCode> {
    let (agentes, handoffs, signals, entities) = context;
    let has_extras =
        !agentes.is_empty() || !handoffs.is_empty() || !signals.is_empty() || !entities.is_empty();
    let (svg_nodes, svg_edges, rows) = if !has_extras {
        let (nodes, edges) = layout_pages(workspace, project, &graph);
        let rows = graph
            .edges
            .iter()
            .map(|edge| GraphEdgeRow {
                from_href: page_href(workspace, project, &edge.from_path),
                from_label: edge.from_path.clone(),
                to_href: page_href(workspace, project, &edge.to_path),
                to_label: edge.to_path.clone(),
            })
            .collect();
        (nodes, edges, rows)
    } else {
        build_project_scope_graph(
            workspace, project, &graph, agentes, handoffs, signals, entities,
        )
    };
    GraphView {
        i18n: i18n.clone(),
        is_project: true,
        workspace: workspace.to_owned(),
        project: project.to_owned(),
        project_href: project_href(workspace, project),
        heading: format!("{workspace}/{project} link graph"),
        blurb: "Páginas compiladas, entidades, agentes, handoffs e aprendizados capturados neste projeto."
            .into(),
        empty_message: "No pages in this project yet.".into(),
        truncated: graph.truncated,
        shown: svg_nodes.len(),
        node_cap: PROJECT_LINK_GRAPH_MAX_NODES,
        svg_nodes,
        svg_edges,
        rows,
        project_graphs: Vec::new(),
        has_estacao_nodes: has_extras,
    }
    .render()
    .map(Html)
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

fn build_project_scope_graph(
    workspace: &str,
    project: &str,
    graph: &LinkGraph,
    agentes: &[String],
    handoffs: &[crate::routes::learnings::LearnedHandoff],
    signals: &[crate::routes::learnings::LearnedSignal],
    entities: &[(String, String)],
) -> (Vec<GraphSvgNode>, Vec<GraphSvgEdge>, Vec<GraphEdgeRow>) {
    struct LocalNode {
        href: String,
        tooltip: String,
        label: String,
        color: &'static str,
        kind: &'static str,
    }

    let mut nodes: Vec<LocalNode> = Vec::new();
    let mut page_index: BTreeMap<&str, usize> = BTreeMap::new();
    for node in &graph.nodes {
        let idx = nodes.len();
        page_index.insert(node.path.as_str(), idx);
        let (kind, color) = classify_learning_kind(&node.path);
        nodes.push(LocalNode {
            href: page_href(workspace, project, &node.path),
            tooltip: format!("[{kind}] {} — {}", node.title, node.path),
            label: node.title.clone(),
            color,
            kind,
        });
    }

    let hub_idx = nodes.len();
    let proj_href = project_href(workspace, project);
    nodes.push(LocalNode {
        href: proj_href.clone(),
        tooltip: format!("Projeto: {workspace}/{project}"),
        label: format!("{workspace}/{project}"),
        color: "#06b6d4",
        kind: "Projeto",
    });

    let mut agent_index: BTreeMap<String, usize> = BTreeMap::new();
    let mut raw_edges: Vec<(usize, usize)> = Vec::new();
    for ag in agentes {
        let idx = nodes.len();
        agent_index.insert(ag.to_lowercase(), idx);
        nodes.push(LocalNode {
            href: format!("{proj_href}?tab=sessions"),
            tooltip: format!("Agente na máquina: {ag}"),
            label: ag.clone(),
            color: "#10b981",
            kind: "Agente",
        });
        raw_edges.push((hub_idx, idx));
    }

    for &p_idx in page_index.values() {
        raw_edges.push((hub_idx, p_idx));
    }

    for edge in &graph.edges {
        if let (Some(&a), Some(&b)) = (
            page_index.get(edge.from_path.as_str()),
            page_index.get(edge.to_path.as_str()),
        ) && a != b
        {
            raw_edges.push((a, b));
        }
    }

    let mut ent_index: BTreeMap<String, usize> = BTreeMap::new();
    for (ent_name, page_path) in entities {
        if let Some(&p_idx) = page_index.get(page_path.as_str()) {
            let e_idx = *ent_index.entry(ent_name.clone()).or_insert_with(|| {
                let idx = nodes.len();
                nodes.push(LocalNode {
                    href: proj_href.clone(),
                    tooltip: format!("Entidade / conceito: {ent_name}"),
                    label: ent_name.clone(),
                    color: "#06b6d4",
                    kind: "Entidade",
                });
                idx
            });
            raw_edges.push((e_idx, p_idx));
        }
    }

    for h in handoffs.iter().take(12) {
        let idx = nodes.len();
        nodes.push(LocalNode {
            href: format!("{proj_href}?tab=sessions"),
            tooltip: format!("[Handoff · {}] {}", h.from_agent, h.summary),
            label: h.summary.clone(),
            color: "#f97316",
            kind: "Handoff",
        });
        raw_edges.push((hub_idx, idx));
        if let Some(&ag_idx) = agent_index.get(&h.from_agent.to_lowercase()) {
            raw_edges.push((ag_idx, idx));
        }
    }

    for sig in signals.iter().take(18) {
        let idx = nodes.len();
        nodes.push(LocalNode {
            href: format!("{proj_href}?tab=sessions"),
            tooltip: format!(
                "[{}] {}",
                sig.kind,
                if sig.detail.is_empty() {
                    &sig.title
                } else {
                    &sig.detail
                }
            ),
            label: sig.title.clone(),
            color: sig.color,
            kind: sig.kind,
        });
        raw_edges.push((hub_idx, idx));
        if !sig.agent.is_empty()
            && let Some(&ag_idx) = agent_index.get(&sig.agent.to_lowercase())
        {
            raw_edges.push((ag_idx, idx));
        }
    }

    let coords = circular_layout(nodes.len(), SVG_CX, SVG_CY, SVG_RADIUS);
    let svg_nodes = nodes
        .iter()
        .enumerate()
        .map(|(i, n)| {
            let (x, y) = coords[i];
            GraphSvgNode {
                href: n.href.clone(),
                tooltip: n.tooltip.clone(),
                label: truncate_label(&n.label, SVG_LABEL_CHARS),
                x: x.round() as i32,
                y: y.round() as i32,
                label_y: (y + 22.0).round() as i32,
                color: n.color,
                kind: n.kind,
            }
        })
        .collect();

    let mut drawn: BTreeSet<(usize, usize)> = BTreeSet::new();
    let mut svg_edges = Vec::new();
    for (a, b) in raw_edges {
        if a == b {
            continue;
        }
        let pair = if a <= b { (a, b) } else { (b, a) };
        if drawn.insert(pair) {
            svg_edges.push(svg_line(a, b, &coords[a], &coords[b]));
        }
    }

    let mut rows: Vec<GraphEdgeRow> = graph
        .edges
        .iter()
        .map(|edge| GraphEdgeRow {
            from_href: page_href(workspace, project, &edge.from_path),
            from_label: edge.from_path.clone(),
            to_href: page_href(workspace, project, &edge.to_path),
            to_label: edge.to_path.clone(),
        })
        .collect();
    if rows.is_empty() {
        for edge in &svg_edges {
            rows.push(GraphEdgeRow {
                from_href: nodes[edge.from_idx].href.clone(),
                from_label: format!(
                    "[{}] {}",
                    nodes[edge.from_idx].kind, nodes[edge.from_idx].label
                ),
                to_href: nodes[edge.to_idx].href.clone(),
                to_label: format!("[{}] {}", nodes[edge.to_idx].kind, nodes[edge.to_idx].label),
            });
        }
    }
    (svg_nodes, svg_edges, rows)
}

fn aggregate_projects(
    edges: &[CrossProjectEdge],
) -> (Vec<GraphSvgNode>, Vec<GraphSvgEdge>, Vec<GraphEdgeRow>) {
    let mut projects: BTreeSet<(String, String)> = BTreeSet::new();
    for edge in edges {
        projects.insert((edge.from_workspace.clone(), edge.from_project.clone()));
        projects.insert((edge.to_workspace.clone(), edge.to_project.clone()));
    }
    let list: Vec<(String, String)> = projects.into_iter().collect();
    let coords = circular_layout(list.len(), SVG_CX, SVG_CY, SVG_RADIUS);
    let mut index: BTreeMap<(String, String), usize> = BTreeMap::new();
    let svg_nodes: Vec<GraphSvgNode> = list
        .iter()
        .enumerate()
        .map(|(i, (workspace, project))| {
            index.insert((workspace.clone(), project.clone()), i);
            let (x, y) = coords[i];
            let full = format!("{workspace}/{project}");
            GraphSvgNode {
                href: graph_href(workspace, project),
                tooltip: full.clone(),
                label: truncate_label(&full, SVG_LABEL_CHARS),
                x: x.round() as i32,
                y: y.round() as i32,
                label_y: (y + 22.0).round() as i32,
                color: "#2563eb",
                kind: "Projeto",
            }
        })
        .collect();

    let mut drawn: BTreeSet<(usize, usize)> = BTreeSet::new();
    let mut svg_edges = Vec::new();
    for edge in edges {
        let Some(&from) = index.get(&(edge.from_workspace.clone(), edge.from_project.clone()))
        else {
            continue;
        };
        let Some(&to) = index.get(&(edge.to_workspace.clone(), edge.to_project.clone())) else {
            continue;
        };
        let pair = if from <= to { (from, to) } else { (to, from) };
        if from != to && drawn.insert(pair) {
            svg_edges.push(svg_line(from, to, &coords[from], &coords[to]));
        }
    }

    let rows = edges
        .iter()
        .map(|edge| GraphEdgeRow {
            from_href: page_href(&edge.from_workspace, &edge.from_project, &edge.from_path),
            from_label: format!(
                "{}/{}:{}",
                edge.from_workspace, edge.from_project, edge.from_path
            ),
            to_href: page_href(&edge.to_workspace, &edge.to_project, &edge.to_path),
            to_label: format!("{}/{}:{}", edge.to_workspace, edge.to_project, edge.to_path),
        })
        .collect();
    (svg_nodes, svg_edges, rows)
}

fn layout_pages(
    workspace: &str,
    project: &str,
    graph: &LinkGraph,
) -> (Vec<GraphSvgNode>, Vec<GraphSvgEdge>) {
    let coords = circular_layout(graph.nodes.len(), SVG_CX, SVG_CY, SVG_RADIUS);
    let mut index: BTreeMap<&str, usize> = BTreeMap::new();
    let svg_nodes: Vec<GraphSvgNode> = graph
        .nodes
        .iter()
        .enumerate()
        .map(|(i, node)| {
            index.insert(node.path.as_str(), i);
            let (x, y) = coords[i];
            let (kind, color) = classify_learning_kind(&node.path);
            GraphSvgNode {
                href: page_href(workspace, project, &node.path),
                tooltip: format!("[{kind}] {} — {}", node.title, node.path),
                label: truncate_label(&node.title, SVG_LABEL_CHARS),
                x: x.round() as i32,
                y: y.round() as i32,
                label_y: (y + 22.0).round() as i32,
                color,
                kind,
            }
        })
        .collect();
    let svg_edges = graph
        .edges
        .iter()
        .filter_map(|edge| {
            let from = *index.get(edge.from_path.as_str())?;
            let to = *index.get(edge.to_path.as_str())?;
            if from == to {
                return None;
            }
            Some(svg_line(from, to, &coords[from], &coords[to]))
        })
        .collect();
    (svg_nodes, svg_edges)
}

fn svg_line(from_idx: usize, to_idx: usize, from: &(f64, f64), to: &(f64, f64)) -> GraphSvgEdge {
    GraphSvgEdge {
        from_idx,
        to_idx,
        x1: from.0.round() as i32,
        y1: from.1.round() as i32,
        x2: to.0.round() as i32,
        y2: to.1.round() as i32,
    }
}

/// Place `n` points evenly around a circle, starting at the top.
#[must_use]
pub(crate) fn circular_layout(n: usize, cx: f64, cy: f64, radius: f64) -> Vec<(f64, f64)> {
    match n {
        0 => Vec::new(),
        1 => vec![(cx, cy)],
        _ => (0..n)
            .map(|i| {
                let angle =
                    std::f64::consts::TAU * (i as f64) / (n as f64) - std::f64::consts::FRAC_PI_2;
                (cx + radius * angle.cos(), cy + radius * angle.sin())
            })
            .collect(),
    }
}

fn truncate_label(text: &str, max_chars: usize) -> String {
    let mut chars = text.chars();
    let taken: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{taken}…")
    } else {
        taken
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn circular_layout_is_empty_for_zero_and_centred_for_one() {
        assert!(circular_layout(0, 400.0, 400.0, 300.0).is_empty());
        assert_eq!(
            circular_layout(1, 400.0, 400.0, 300.0),
            vec![(400.0, 400.0)]
        );
    }

    #[test]
    fn circular_layout_starts_at_the_top() {
        let pts = circular_layout(4, 0.0, 0.0, 10.0);
        assert_eq!(pts.len(), 4);
        assert!((pts[0].0 - 0.0).abs() < 1e-9);
        assert!((pts[0].1 + 10.0).abs() < 1e-9);
    }

    #[test]
    fn truncate_label_keeps_short_text_and_ellipsises_long() {
        assert_eq!(truncate_label("short", 24), "short");
        assert_eq!(
            truncate_label("abcdefghijklmnopqrstuvwxyz", 24)
                .chars()
                .count(),
            25
        );
        assert!(truncate_label("abcdefghijklmnopqrstuvwxyz", 24).ends_with('…'));
    }
}
