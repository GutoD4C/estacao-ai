//! Consultas compartilhadas para consolidar aprendizados reais de todos os
//! projetos ativos na máquina (Estação I.A e agentes externos).

use std::collections::{BTreeMap, BTreeSet, HashMap};

use ai_memory_core::{AgentKind, ProjectId, UserId, WorkspaceId};
use ai_memory_store::ProjectSummary;

use crate::state::WebState;
use crate::templates::agent_label;

/// Página consolidada associada a um projeto.
pub(crate) struct LearnedPage {
    pub path: String,
    pub title: String,
    pub excerpt: String,
    pub updated_at: i64,
    pub kind: &'static str,
}

/// Registro de continuidade (handoff) entre sessões de agentes.
pub(crate) struct LearnedHandoff {
    pub from_agent: String,
    pub summary: String,
    pub created_at: i64,
    pub files_touched: Vec<String>,
}

/// Sinal ou aprendizado relevante capturado por hooks/sessões externas.
pub(crate) struct LearnedSignal {
    pub kind: &'static str,
    pub title: String,
    pub detail: String,
    pub agent: String,
    pub created_at: i64,
    pub color: &'static str,
}

/// Pacote completo do que foi aprendido para um escopo `(workspace, project)`.
pub(crate) struct ScopeLearnings {
    pub workspace: String,
    pub project: String,
    pub pasta: String,
    pub agentes: Vec<String>,
    pub page_count: u64,
    pub observation_count: u64,
    pub session_count: u64,
    pub handoff_count: u64,
    pub latest_activity_us: i64,
    pub pages: Vec<LearnedPage>,
    pub handoffs: Vec<LearnedHandoff>,
    pub signals: Vec<LearnedSignal>,
}

/// Classifica caminho de página wiki em categoria visual + cor Obsidian.
pub(crate) fn classify_learning_kind(path: &str) -> (&'static str, &'static str) {
    if path.starts_with("_rules/") {
        ("Regra", "#f43f5e")
    } else if path.starts_with("decisions/") {
        ("Decisão", "#8b5cf6")
    } else if path.starts_with("gotchas/") {
        ("Alerta", "#f59e0b")
    } else if path.starts_with("concepts/") {
        ("Conceito", "#06b6d4")
    } else if path.starts_with("sessions/") {
        ("Sessão", "#10b981")
    } else {
        ("Nota", "#3b82f6")
    }
}

/// Converte o código salvo no banco para rótulo humano do harness.
pub(crate) fn human_agent_name(wire: &str) -> String {
    let trimmed = wire.trim();
    if trimmed.is_empty() {
        return "Agente".into();
    }
    agent_label(AgentKind::from_wire(trimmed)).to_owned()
}

/// Extrai resumo limpo de um handoff, desembrulhando `open_questions` quando
/// o resumo é apenas o marcador padrão de sessão única.
fn unwrap_handoff_summary(summary: &str, open_questions_json: &str) -> String {
    let trimmed = summary.trim();
    if let Ok(qs) = serde_json::from_str::<Vec<String>>(open_questions_json)
        && let Some(first) = qs
            .into_iter()
            .map(|s| s.trim().to_owned())
            .find(|s| !s.is_empty())
        && (trimmed.is_empty() || trimmed.starts_with("Single-prompt session"))
    {
        return first;
    }
    if trimmed.is_empty() {
        "Sessão contínua registrada".into()
    } else {
        trimmed.to_owned()
    }
}

fn parse_files_json(raw: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(raw)
        .unwrap_or_default()
        .into_iter()
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty())
        .take(4)
        .collect()
}

/// Remove ruído estrutural (`tool_family`, `tool_call_id`, `outcome`) de uma
/// observação e produz `(rótulo, título, detalhe)` legível quando há valor útil.
fn extract_signal(
    kind: &str,
    title: &str,
    body: &str,
    file_path: Option<&str>,
    agent_wire: Option<&str>,
    created_at: i64,
) -> Option<LearnedSignal> {
    let agent = agent_wire.map(human_agent_name).unwrap_or_default();
    let (label, color) = match kind {
        "rule" => ("Regra", "#f43f5e"),
        "decision" => ("Decisão", "#8b5cf6"),
        "gotcha" => ("Alerta", "#f59e0b"),
        "learning" => ("Aprendizado", "#06b6d4"),
        "user-prompt" => ("Prompt", "#ec4899"),
        _ => ("Atividade", "#64748b"),
    };

    let clean_body = strip_tool_metadata(body);
    let clean_title = title.trim();
    let file_clean = file_path.map(str::trim).filter(|s| !s.is_empty());

    if kind == "stop" && clean_body.is_empty() {
        return None;
    }

    let heading = if let Some(fp) = file_clean
        && (clean_title.is_empty() || clean_title.starts_with("tool "))
    {
        fp.rsplit(['/', '\\']).next().unwrap_or(fp).to_owned()
    } else if !clean_title.is_empty()
        && !clean_title.eq_ignore_ascii_case("stop")
        && !clean_title.starts_with("tool ")
        && clean_title != "non-file"
    {
        clean_title.to_owned()
    } else if !clean_body.is_empty() {
        truncate_chars(&clean_body, 88)
    } else if let Some(fp) = file_clean {
        fp.rsplit(['/', '\\']).next().unwrap_or(fp).to_owned()
    } else {
        return None;
    };

    let detail = if !clean_body.is_empty() && clean_body != heading {
        truncate_chars(&clean_body, 200)
    } else if let Some(fp) = file_clean {
        fp.to_owned()
    } else {
        String::new()
    };

    Some(LearnedSignal {
        kind: label,
        title: heading,
        detail,
        agent,
        created_at,
        color,
    })
}

fn strip_tool_metadata(raw: &str) -> String {
    let after_sep = raw
        .split_once("\n---\n")
        .map(|(_, rest)| rest)
        .unwrap_or(raw);
    let mut kept = Vec::new();
    for line in after_sep.lines() {
        let t = line.trim();
        if t.is_empty()
            || t.starts_with("tool_family:")
            || t.starts_with("tool_call_id:")
            || t.starts_with("outcome:")
        {
            continue;
        }
        kept.push(t);
        if kept.len() >= 4 {
            break;
        }
    }
    kept.join(" ")
}

fn truncate_chars(text: &str, max: usize) -> String {
    let mut chars = text.chars();
    let head: String = chars.by_ref().take(max).collect();
    if chars.next().is_some() {
        format!("{head}…")
    } else {
        head
    }
}

fn clean_excerpt(body: &str, max: usize) -> String {
    let mut lines = Vec::new();
    for line in body.lines() {
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') || t.starts_with("- **session_id:**") {
            continue;
        }
        lines.push(t);
        if lines.join(" ").chars().count() >= max {
            break;
        }
    }
    truncate_chars(&lines.join(" "), max)
}

/// Carrega aprendizados reais de todos os projetos autorizados para `viewer`
/// (incluindo projetos fora da Estação I.A com páginas, handoffs ou observações).
pub(crate) async fn load_all_project_learnings(
    state: &WebState,
    viewer: Option<UserId>,
    pages_per_project: usize,
    captures_per_project: usize,
) -> Vec<ScopeLearnings> {
    let summaries = state
        .reader
        .list_projects_with_stats(viewer)
        .await
        .unwrap_or_default();
    if summaries.is_empty() {
        return Vec::new();
    }

    let summary_map: HashMap<(String, String), &ProjectSummary> = summaries
        .iter()
        .map(|s| ((s.workspace_name.clone(), s.project_name.clone()), s))
        .collect();
    let allowed_keys: BTreeSet<(String, String)> = summary_map.keys().cloned().collect();

    let now_us = jiff::Timestamp::now().as_microsecond();
    let pages_cap = i64::try_from(pages_per_project.max(1)).unwrap_or(10);
    let cap_limit = i64::try_from(captures_per_project.max(1)).unwrap_or(8);

    struct SignalRow {
        ws: String,
        proj: String,
        kind: String,
        title: String,
        body: String,
        file_path: Option<String>,
        agent_kind: Option<String>,
        created_at: i64,
    }

    struct DbSnapshot {
        meta: Vec<(String, String, String, i64, i64)>,
        agent_rows: Vec<(String, String, String)>,
        pages: Vec<(String, String, String, String, String, i64)>,
        handoffs: Vec<(String, String, String, String, String, String, i64)>,
        signals: Vec<SignalRow>,
        files: Vec<(String, String, String, i64)>,
    }

    let snap = state
        .reader
        .with_conn(move |conn| {
            let mut stmt_meta = conn.prepare(
                "SELECT w.name, pr.name, \
                 COALESCE((SELECT s.cwd FROM sessions s WHERE s.project_id = pr.id AND s.cwd IS NOT NULL AND s.cwd != '' ORDER BY s.started_at DESC LIMIT 1), \
                          (SELECT s2.cwd FROM observations o2 JOIN sessions s2 ON s2.id = o2.session_id WHERE o2.project_id = pr.id AND s2.cwd IS NOT NULL AND s2.cwd != '' ORDER BY o2.created_at DESC LIMIT 1), ''), \
                 (SELECT COUNT(*) FROM handoffs h WHERE h.workspace_id = pr.workspace_id AND h.project_id = pr.id), \
                 COALESCE((SELECT MAX(h2.created_at) FROM handoffs h2 WHERE h2.workspace_id = pr.workspace_id AND h2.project_id = pr.id), 0) \
                 FROM projects pr JOIN workspaces w ON w.id = pr.workspace_id",
            )?;
            let meta = stmt_meta
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?
                .filter_map(Result::ok)
                .collect();

            let mut stmt_agents = conn.prepare(
                "SELECT DISTINCT w.name, pr.name, s.agent_kind \
                 FROM sessions s \
                 JOIN projects pr ON pr.id = s.project_id \
                 JOIN workspaces w ON w.id = pr.workspace_id \
                 UNION \
                 SELECT DISTINCT w.name, pr.name, s.agent_kind \
                 FROM observations o \
                 JOIN sessions s ON s.id = o.session_id \
                 JOIN projects pr ON pr.id = o.project_id \
                 JOIN workspaces w ON w.id = pr.workspace_id",
            )?;
            let agent_rows = stmt_agents
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
                .filter_map(Result::ok)
                .collect();

            let mut stmt_pages = conn.prepare(
                "SELECT ws, proj, path, title, body, updated_at FROM ( \
                   SELECT w.name AS ws, pr.name AS proj, p.path, COALESCE(p.title, p.path) AS title, COALESCE(p.body, '') AS body, p.updated_at, \
                          ROW_NUMBER() OVER (PARTITION BY p.workspace_id, p.project_id ORDER BY \
                            CASE WHEN p.path LIKE '_rules/%' OR p.path LIKE 'decisions/%' OR p.path LIKE 'gotchas/%' OR p.path LIKE 'concepts/%' THEN 0 \
                                 WHEN p.path LIKE '_lint/%' THEN 2 ELSE 1 END, p.pinned DESC, p.updated_at DESC) AS rn \
                   FROM pages p \
                   JOIN workspaces w ON w.id = p.workspace_id \
                   JOIN projects pr ON pr.id = p.project_id \
                   WHERE p.is_latest = 1 AND (p.expires_at IS NULL OR p.expires_at > ?1) \
                 ) WHERE rn <= ?2 ORDER BY updated_at DESC",
            )?;
            let pages = stmt_pages
                .query_map(rusqlite::params![now_us, pages_cap], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))
                })?
                .filter_map(Result::ok)
                .collect();

            let mut stmt_handoffs = conn.prepare(
                "SELECT ws, proj, from_agent, summary, open_questions, files_touched, created_at FROM ( \
                   SELECT w.name AS ws, pr.name AS proj, h.from_agent, h.summary, h.open_questions, h.files_touched, h.created_at, \
                          ROW_NUMBER() OVER (PARTITION BY h.workspace_id, h.project_id ORDER BY h.created_at DESC) AS rn \
                   FROM handoffs h \
                   JOIN workspaces w ON w.id = h.workspace_id \
                   JOIN projects pr ON pr.id = h.project_id \
                 ) WHERE rn <= ?1 ORDER BY created_at DESC",
            )?;
            let handoffs = stmt_handoffs
                .query_map([cap_limit], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?))
                })?
                .filter_map(Result::ok)
                .collect();

            let mut stmt_sig = conn.prepare(
                "SELECT ws, proj, kind, title, body, file_path, agent_kind, created_at FROM ( \
                   SELECT w.name AS ws, pr.name AS proj, o.kind, o.title, o.body, o.file_path, s.agent_kind, o.created_at, \
                          ROW_NUMBER() OVER (PARTITION BY o.workspace_id, o.project_id ORDER BY \
                            CASE WHEN o.kind IN ('rule','decision','gotcha','learning') THEN 0 ELSE 1 END, o.created_at DESC) AS rn \
                   FROM observations o \
                   JOIN workspaces w ON w.id = o.workspace_id \
                   JOIN projects pr ON pr.id = o.project_id \
                   LEFT JOIN sessions s ON s.id = o.session_id \
                   WHERE o.kind IN ('decision','learning','rule','gotcha','user-prompt') \
                 ) WHERE rn <= ?1 ORDER BY created_at DESC",
            )?;
            let signals = stmt_sig
                .query_map([cap_limit * 2], |r| {
                    Ok(SignalRow {
                        ws: r.get(0)?,
                        proj: r.get(1)?,
                        kind: r.get(2)?,
                        title: r.get(3)?,
                        body: r.get(4)?,
                        file_path: r.get(5)?,
                        agent_kind: r.get(6)?,
                        created_at: r.get(7)?,
                    })
                })?
                .filter_map(Result::ok)
                .collect();

            let mut stmt_files = conn.prepare(
                "SELECT w.name, pr.name, o.file_path, MAX(o.created_at) AS last_seen \
                 FROM observations o \
                 JOIN workspaces w ON w.id = o.workspace_id \
                 JOIN projects pr ON pr.id = o.project_id \
                 WHERE o.file_path IS NOT NULL AND o.file_path != '' \
                 GROUP BY o.workspace_id, o.project_id, o.file_path \
                 ORDER BY last_seen DESC \
                 LIMIT 180",
            )?;
            let files = stmt_files
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
                .filter_map(Result::ok)
                .collect();

            Ok(DbSnapshot {
                meta,
                agent_rows,
                pages,
                handoffs,
                signals,
                files,
            })
        })
        .await
        .unwrap_or(DbSnapshot {
            meta: Vec::new(),
            agent_rows: Vec::new(),
            pages: Vec::new(),
            handoffs: Vec::new(),
            signals: Vec::new(),
            files: Vec::new(),
        });

    let mut buckets: BTreeMap<(String, String), ScopeLearnings> = BTreeMap::new();
    for ((ws, proj), sum) in &summary_map {
        let ts_us = sum
            .last_activity
            .as_deref()
            .and_then(|iso| iso.parse::<jiff::Timestamp>().ok())
            .map(jiff::Timestamp::as_microsecond)
            .unwrap_or(0);
        buckets.insert(
            (ws.clone(), proj.clone()),
            ScopeLearnings {
                workspace: ws.clone(),
                project: proj.clone(),
                pasta: String::new(),
                agentes: Vec::new(),
                page_count: sum.page_count,
                observation_count: sum.observation_count,
                session_count: sum.session_count,
                handoff_count: 0,
                latest_activity_us: ts_us,
                pages: Vec::new(),
                handoffs: Vec::new(),
                signals: Vec::new(),
            },
        );
    }

    for (ws, proj, cwd, handoff_count, latest_h) in snap.meta {
        let key = (ws, proj);
        if !allowed_keys.contains(&key) {
            continue;
        }
        if let Some(entry) = buckets.get_mut(&key) {
            entry.pasta = cwd;
            entry.handoff_count = u64::try_from(handoff_count.max(0)).unwrap_or(0);
            entry.latest_activity_us = entry.latest_activity_us.max(latest_h);
        }
    }

    let mut agent_sets: HashMap<(String, String), BTreeSet<String>> = HashMap::new();
    for (ws, proj, ag) in snap.agent_rows {
        let key = (ws, proj);
        if allowed_keys.contains(&key) {
            agent_sets
                .entry(key)
                .or_default()
                .insert(human_agent_name(&ag));
        }
    }
    for (key, set) in agent_sets {
        if let Some(entry) = buckets.get_mut(&key) {
            entry.agentes = set.into_iter().collect();
        }
    }

    for (ws, proj, path, title, body, updated_at) in snap.pages {
        let key = (ws, proj);
        if let Some(entry) = buckets.get_mut(&key) {
            let (kind, _) = classify_learning_kind(&path);
            entry.pages.push(LearnedPage {
                path,
                title,
                excerpt: clean_excerpt(&body, 190),
                updated_at,
                kind,
            });
            entry.latest_activity_us = entry.latest_activity_us.max(updated_at);
        }
    }

    for (ws, proj, from_agent, summary, open_q, files_json, created_at) in snap.handoffs {
        let key = (ws, proj);
        if let Some(entry) = buckets.get_mut(&key) {
            entry.handoffs.push(LearnedHandoff {
                from_agent: human_agent_name(&from_agent),
                summary: truncate_chars(&unwrap_handoff_summary(&summary, &open_q), 220),
                created_at,
                files_touched: parse_files_json(&files_json),
            });
        }
    }

    let mut seen_signals: HashMap<(String, String), HashSetLower> = HashMap::new();
    for srow in snap.signals {
        let key = (srow.ws, srow.proj);
        let Some(entry) = buckets.get_mut(&key) else {
            continue;
        };
        if entry.signals.len() >= captures_per_project {
            continue;
        }
        if let Some(sig) = extract_signal(
            &srow.kind,
            &srow.title,
            &srow.body,
            srow.file_path.as_deref(),
            srow.agent_kind.as_deref(),
            srow.created_at,
        ) {
            let dedup = sig.title.to_lowercase();
            let set = seen_signals.entry(key).or_default();
            if set.insert(dedup) {
                entry.signals.push(sig);
            }
        }
    }

    // Para projetos externos sem prompts/decisões explícitas ainda, completa com arquivos trabalhados.
    for (ws, proj, fp, last_seen) in snap.files {
        let key = (ws, proj);
        let Some(entry) = buckets.get_mut(&key) else {
            continue;
        };
        if entry.pages.len() + entry.signals.len() >= captures_per_project {
            continue;
        }
        if let Some(sig) = extract_signal("learning", "", "", Some(&fp), None, last_seen) {
            let dedup = sig.title.to_lowercase();
            let set = seen_signals.entry(key).or_default();
            if set.insert(dedup) {
                entry.signals.push(sig);
            }
        }
    }

    let mut out: Vec<ScopeLearnings> = buckets
        .into_values()
        .filter(|s| {
            s.page_count > 0
                || s.observation_count > 0
                || s.session_count > 0
                || s.handoff_count > 0
        })
        .collect();
    out.sort_by(|a, b| {
        b.latest_activity_us
            .cmp(&a.latest_activity_us)
            .then_with(|| b.page_count.cmp(&a.page_count))
            .then_with(|| b.observation_count.cmp(&a.observation_count))
            .then_with(|| a.workspace.cmp(&b.workspace))
            .then_with(|| a.project.cmp(&b.project))
    });
    out
}

type HashSetLower = BTreeSet<String>;

/// Carrega agentes, handoffs, sinais capturados e ligações de entidades dentro
/// de um único escopo `(workspace_id, project_id)` para o grafo do projeto.
pub(crate) async fn load_scope_context(
    state: &WebState,
    workspace_id: WorkspaceId,
    project_id: ProjectId,
    limit: usize,
) -> (
    Vec<String>,
    Vec<LearnedHandoff>,
    Vec<LearnedSignal>,
    Vec<(String, String)>,
) {
    let lim = i64::try_from(limit.max(1)).unwrap_or(16);
    state
        .reader
        .with_conn(move |conn| {
            let ws_bytes = workspace_id.as_bytes().to_vec();
            let pr_bytes = project_id.as_bytes().to_vec();

            let mut stmt_ag = conn.prepare(
                "SELECT DISTINCT s.agent_kind FROM sessions s WHERE s.workspace_id = ?1 AND s.project_id = ?2 \
                 UNION \
                 SELECT DISTINCT s.agent_kind FROM observations o JOIN sessions s ON s.id = o.session_id \
                 WHERE o.workspace_id = ?1 AND o.project_id = ?2",
            )?;
            let agentes: Vec<String> = stmt_ag
                .query_map(rusqlite::params![ws_bytes, pr_bytes], |r| r.get::<_, String>(0))?
                .filter_map(Result::ok)
                .map(|w| human_agent_name(&w))
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect();

            let mut stmt_h = conn.prepare(
                "SELECT from_agent, summary, open_questions, files_touched, created_at \
                 FROM handoffs WHERE workspace_id = ?1 AND project_id = ?2 \
                 ORDER BY created_at DESC LIMIT ?3",
            )?;
            let handoffs: Vec<LearnedHandoff> = stmt_h
                .query_map(rusqlite::params![ws_bytes, pr_bytes, lim], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                        r.get::<_, i64>(4)?,
                    ))
                })?
                .filter_map(Result::ok)
                .map(|(ag, sum, oq, ft, ca)| LearnedHandoff {
                    from_agent: human_agent_name(&ag),
                    summary: truncate_chars(&unwrap_handoff_summary(&sum, &oq), 180),
                    created_at: ca,
                    files_touched: parse_files_json(&ft),
                })
                .collect();

            let mut stmt_sig = conn.prepare(
                "SELECT o.kind, o.title, o.body, o.file_path, s.agent_kind, o.created_at \
                 FROM observations o \
                 LEFT JOIN sessions s ON s.id = o.session_id \
                 WHERE o.workspace_id = ?1 AND o.project_id = ?2 \
                   AND o.kind IN ('decision','learning','rule','gotcha','user-prompt') \
                 ORDER BY CASE WHEN o.kind IN ('rule','decision','gotcha','learning') THEN 0 ELSE 1 END, o.created_at DESC \
                 LIMIT ?3",
            )?;
            let mut seen = BTreeSet::new();
            let mut signals: Vec<LearnedSignal> = stmt_sig
                .query_map(rusqlite::params![ws_bytes, pr_bytes, lim * 2], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, Option<String>>(3)?,
                        r.get::<_, Option<String>>(4)?,
                        r.get::<_, i64>(5)?,
                    ))
                })?
                .filter_map(Result::ok)
                .filter_map(|(k, t, b, fp, ag, ca)| {
                    let sig = extract_signal(&k, &t, &b, fp.as_deref(), ag.as_deref(), ca)?;
                    seen.insert(sig.title.to_lowercase()).then_some(sig)
                })
                .take(limit)
                .collect();

            if signals.len() < 4 {
                let mut stmt_files = conn.prepare(
                    "SELECT o.file_path, MAX(o.created_at) AS ts \
                     FROM observations o \
                     WHERE o.workspace_id = ?1 AND o.project_id = ?2 \
                       AND o.file_path IS NOT NULL AND o.file_path != '' \
                     GROUP BY o.file_path ORDER BY ts DESC LIMIT ?3",
                )?;
                let extra: Vec<(String, i64)> = stmt_files
                    .query_map(rusqlite::params![ws_bytes, pr_bytes, lim], |r| {
                        Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
                    })?
                    .filter_map(Result::ok)
                    .collect();
                for (fp, ca) in extra {
                    if signals.len() >= limit {
                        break;
                    }
                    if let Some(sig) = extract_signal("learning", "", "", Some(&fp), None, ca)
                        && seen.insert(sig.title.to_lowercase())
                    {
                        signals.push(sig);
                    }
                }
            }

            let mut stmt_ent = conn.prepare(
                "SELECT e.name, pg.path \
                 FROM entity_page_links epl \
                 JOIN entities e ON e.id = epl.entity_id \
                 JOIN pages pg ON pg.id = epl.page_id \
                 WHERE e.workspace_id = ?1 AND e.project_id = ?2 \
                   AND epl.superseded_at IS NULL AND pg.is_latest = 1 \
                 LIMIT 60",
            )?;
            let entities: Vec<(String, String)> = stmt_ent
                .query_map(rusqlite::params![ws_bytes, pr_bytes], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                })?
                .filter_map(Result::ok)
                .collect();

            Ok((agentes, handoffs, signals, entities))
        })
        .await
        .unwrap_or_default()
}
