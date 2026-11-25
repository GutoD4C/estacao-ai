use std::sync::LazyLock;
use std::time::Duration;

use axum::Json;
use axum::extract::Query;
use axum::response::IntoResponse;
use axum::response::Response;
use serde::{Deserialize, Serialize};

const YOUTUBE_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

static YOUTUBE_CLIENT: LazyLock<Option<reqwest::Client>> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .user_agent(YOUTUBE_USER_AGENT)
        .build()
        .ok()
});

#[derive(Deserialize)]
pub(crate) struct YoutubeQuery {
    #[serde(default)]
    q: String,
}

#[derive(Serialize, PartialEq, Debug)]
pub(super) struct YoutubeResultado {
    pub(super) id: String,
    pub(super) title: String,
    channel: String,
    duration: String,
}

pub(super) fn extrair_resultados_youtube(html: &str) -> Vec<YoutubeResultado> {
    let marcadores = ["var ytInitialData = ", "window[\"ytInitialData\"] = "];
    let Some(json_str) = marcadores.iter().find_map(|m| {
        let pos = html.find(m)?;
        let rest = &html[pos + m.len()..];
        let end = rest.find(";</script>")?;
        Some(&rest[..end])
    }) else {
        return Vec::new();
    };
    let Ok(val) = serde_json::from_str::<serde_json::Value>(json_str) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    fn coletar(v: &serde_json::Value, out: &mut Vec<YoutubeResultado>) {
        if out.len() >= 8 {
            return;
        }
        match v {
            serde_json::Value::Object(map) => {
                if let Some(vr) = map.get("videoRenderer").and_then(|x| x.as_object())
                    && let Some(id) = vr.get("videoId").and_then(|x| x.as_str())
                {
                    let title = vr
                        .get("title")
                        .and_then(|t| t.get("runs"))
                        .and_then(|r| r.as_array())
                        .and_then(|a| a.first())
                        .and_then(|x| x.get("text"))
                        .and_then(|x| x.as_str())
                        .unwrap_or("Vídeo do YouTube")
                        .to_owned();
                    let channel = vr
                        .get("ownerText")
                        .and_then(|t| t.get("runs"))
                        .and_then(|r| r.as_array())
                        .and_then(|a| a.first())
                        .and_then(|x| x.get("text"))
                        .and_then(|x| x.as_str())
                        .unwrap_or("")
                        .to_owned();
                    let duration = vr
                        .get("lengthText")
                        .and_then(|t| t.get("simpleText"))
                        .and_then(|x| x.as_str())
                        .unwrap_or("")
                        .to_owned();
                    if !id.is_empty() && !out.iter().any(|x| x.id == id) {
                        out.push(YoutubeResultado {
                            id: id.to_owned(),
                            title,
                            channel,
                            duration,
                        });
                    }
                }
                for val in map.values() {
                    coletar(val, out);
                    if out.len() >= 8 {
                        break;
                    }
                }
            }
            serde_json::Value::Array(arr) => {
                for item in arr {
                    coletar(item, out);
                    if out.len() >= 8 {
                        break;
                    }
                }
            }
            _ => {}
        }
    }
    coletar(&val, &mut out);
    out
}

fn encode_query_component(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.as_bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(*b as char);
        } else if *b == b' ' {
            out.push('+');
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

const MAX_YOUTUBE_QUERY_CHARS: usize = 200;
const MAX_YOUTUBE_HTML_BYTES: usize = 4 * 1024 * 1024;

pub(crate) async fn api_youtube(Query(q): Query<YoutubeQuery>) -> Response {
    let query: String = q.q.trim().chars().take(MAX_YOUTUBE_QUERY_CHARS).collect();
    if query.is_empty() {
        return Json(serde_json::json!({ "query": "", "results": [] })).into_response();
    }
    let url = format!(
        "https://www.youtube.com/results?search_query={}&hl=pt&gl=BR",
        encode_query_component(&query)
    );
    let out = match YOUTUBE_CLIENT.as_ref() {
        Some(client) => match client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => {
                let excede = resp
                    .content_length()
                    .is_some_and(|len| len as usize > MAX_YOUTUBE_HTML_BYTES);
                if excede {
                    Vec::new()
                } else {
                    match resp.bytes().await {
                        Ok(bytes) if bytes.len() <= MAX_YOUTUBE_HTML_BYTES => {
                            let html = String::from_utf8_lossy(&bytes);
                            extrair_resultados_youtube(&html)
                        }
                        _ => Vec::new(),
                    }
                }
            }
            _ => Vec::new(),
        },
        None => Vec::new(),
    };
    Json(serde_json::json!({ "query": query, "results": out })).into_response()
}
