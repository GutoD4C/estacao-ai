//! Verificação e aplicação de atualizações da Estação I.A direto do GitHub.
//!
//! Consulta `https://api.github.com/repos/GutoD4C/estacao-ai/releases/latest`,
//! compara com `CARGO_PKG_VERSION` e, quando o usuário solicita, baixa o artefato
//! oficial da release, valida o `SHA256SUMS.txt` e aplica a atualização.

#[cfg(unix)]
use std::path::Path;
#[cfg(target_os = "linux")]
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use axum::Json;
use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::http::autorizar;
use crate::state::WebState;

const GITHUB_REPO_PADRAO: &str = "GutoD4C/estacao-ai";
const VERSAO_ATUAL: &str = env!("CARGO_PKG_VERSION");
const CACHE_TTL: Duration = Duration::from_secs(15 * 60);
const TIMEOUT_CHECK: Duration = Duration::from_secs(8);
const TIMEOUT_DOWNLOAD: Duration = Duration::from_secs(180);
const MAX_DOWNLOAD_BYTES: usize = 128 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
pub(crate) struct InfoAtualizacao {
    pub versao_atual: String,
    pub versao_disponivel: Option<String>,
    pub tag: Option<String>,
    pub disponivel: bool,
    pub titulo: Option<String>,
    pub notas: Option<String>,
    pub url_release: Option<String>,
    pub publicado_em: Option<String>,
    pub asset_nome: Option<String>,
    pub asset_url: Option<String>,
    pub sha256_url: Option<String>,
    pub pode_aplicar_direto: bool,
    pub erro: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct QueryAtualizacao {
    #[serde(default)]
    forcar: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    html_url: Option<String>,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Clone, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Serialize)]
struct RespostaAplicar {
    ok: bool,
    versao: Option<String>,
    mensagem: String,
    reiniciando: bool,
    arquivo_baixado: Option<String>,
}

struct CacheEntrada {
    em: Instant,
    info: InfoAtualizacao,
}

fn cache() -> &'static Mutex<Option<CacheEntrada>> {
    static CACHE: OnceLock<Mutex<Option<CacheEntrada>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

fn repo_github() -> String {
    std::env::var("ESTACAO_UPDATE_REPO")
        .ok()
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| GITHUB_REPO_PADRAO.to_owned())
}

pub(crate) fn normalizar_versao(raw: &str) -> Option<(u64, u64, u64)> {
    let limpa = raw
        .trim()
        .trim_start_matches("estacao-")
        .trim_start_matches('v')
        .trim_start_matches('V');
    let sem_sufixo = limpa.split(['-', '+']).next()?;
    let mut partes = sem_sufixo.split('.');
    let major = partes.next()?.parse::<u64>().ok()?;
    let minor = partes.next()?.parse::<u64>().ok()?;
    let patch = partes.next().unwrap_or("0").parse::<u64>().ok()?;
    Some((major, minor, patch))
}

pub(crate) fn ha_atualizacao(atual: &str, remota: &str) -> bool {
    match (normalizar_versao(atual), normalizar_versao(remota)) {
        (Some(a), Some(r)) => r > a,
        _ => false,
    }
}

fn versao_legivel(tag: &str) -> String {
    match normalizar_versao(tag) {
        Some((a, b, c)) => format!("{a}.{b}.{c}"),
        None => tag.trim().to_owned(),
    }
}

fn escolher_asset<'a>(assets: &'a [GithubAsset], os: &str, arch: &str) -> Option<&'a GithubAsset> {
    match (os, arch) {
        ("linux", "x86_64") => assets
            .iter()
            .find(|a| a.name.ends_with("_amd64.deb"))
            .or_else(|| {
                assets
                    .iter()
                    .find(|a| a.name.ends_with("-linux-x86_64.tar.gz"))
            }),
        ("linux", "aarch64") => assets
            .iter()
            .find(|a| a.name.ends_with("_arm64.deb"))
            .or_else(|| {
                assets
                    .iter()
                    .find(|a| a.name.ends_with("-linux-aarch64.tar.gz"))
            }),
        ("windows", "x86_64") => assets
            .iter()
            .find(|a| a.name.ends_with(".exe") && a.name.to_ascii_lowercase().contains("setup"))
            .or_else(|| assets.iter().find(|a| a.name.ends_with(".exe")))
            .or_else(|| {
                assets
                    .iter()
                    .find(|a| a.name.ends_with("-windows-x86_64.zip"))
            }),
        ("macos", "aarch64") => assets
            .iter()
            .find(|a| a.name.ends_with("-macos-aarch64.tar.gz") || a.name.ends_with(".dmg")),
        _ => None,
    }
}

fn encontrar_sha256_asset(assets: &[GithubAsset]) -> Option<&GithubAsset> {
    assets
        .iter()
        .find(|a| a.name.eq_ignore_ascii_case("SHA256SUMS.txt"))
}

pub(crate) fn extrair_sha256_esperado(conteudo: &str, nome_arquivo: &str) -> Option<String> {
    for linha in conteudo.lines() {
        let partes: Vec<&str> = linha.split_whitespace().collect();
        if partes.len() >= 2 {
            let hash = partes[0].trim().to_ascii_lowercase();
            let nome = partes[1].trim().trim_start_matches('*');
            if nome == nome_arquivo
                && hash.len() == 64
                && hash.chars().all(|c| c.is_ascii_hexdigit())
            {
                return Some(hash);
            }
        }
    }
    None
}

async fn consultar_github_release() -> Result<GithubRelease, String> {
    let repo = repo_github();
    let url = format!("https://api.github.com/repos/{repo}/releases/latest");
    let client = reqwest::Client::builder()
        .timeout(TIMEOUT_CHECK)
        .user_agent(format!("estacao-ai/{VERSAO_ATUAL}"))
        .build()
        .map_err(|e| format!("erro ao criar cliente HTTP: {e}"))?;

    let resp = client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("não foi possível consultar o GitHub: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub retornou HTTP {}", resp.status()));
    }

    resp.json::<GithubRelease>()
        .await
        .map_err(|e| format!("resposta inválida do GitHub: {e}"))
}

fn montar_info(rel: &GithubRelease) -> InfoAtualizacao {
    let disponivel = ha_atualizacao(VERSAO_ATUAL, &rel.tag_name);
    let asset = escolher_asset(&rel.assets, std::env::consts::OS, std::env::consts::ARCH);
    let sha = encontrar_sha256_asset(&rel.assets);
    InfoAtualizacao {
        versao_atual: VERSAO_ATUAL.to_owned(),
        versao_disponivel: Some(versao_legivel(&rel.tag_name)),
        tag: Some(rel.tag_name.clone()),
        disponivel,
        titulo: rel.name.clone().filter(|s| !s.trim().is_empty()),
        notas: rel.body.clone().map(|b| {
            let trimmed = b.trim();
            if trimmed.len() > 1200 {
                format!("{}…", &trimmed[..1200])
            } else {
                trimmed.to_owned()
            }
        }),
        url_release: rel.html_url.clone(),
        publicado_em: rel.published_at.clone(),
        asset_nome: asset.map(|a| a.name.clone()),
        asset_url: asset.map(|a| a.browser_download_url.clone()),
        sha256_url: sha.map(|a| a.browser_download_url.clone()),
        pode_aplicar_direto: asset.is_some(),
        erro: None,
    }
}

pub(crate) async fn api_atualizacao(Query(q): Query<QueryAtualizacao>) -> Response {
    let forcar = q.forcar.as_deref().is_some_and(|v| v == "1" || v == "true");
    if !forcar
        && let Ok(guard) = cache().lock()
        && let Some(entry) = guard.as_ref()
        && entry.em.elapsed() < CACHE_TTL
    {
        return Json(entry.info.clone()).into_response();
    }

    let info = match consultar_github_release().await {
        Ok(rel) => {
            let info = montar_info(&rel);
            if let Ok(mut guard) = cache().lock() {
                *guard = Some(CacheEntrada {
                    em: Instant::now(),
                    info: info.clone(),
                });
            }
            info
        }
        Err(erro) => InfoAtualizacao {
            versao_atual: VERSAO_ATUAL.to_owned(),
            versao_disponivel: None,
            tag: None,
            disponivel: false,
            titulo: None,
            notas: None,
            url_release: Some(format!("https://github.com/{}/releases", repo_github())),
            publicado_em: None,
            asset_nome: None,
            asset_url: None,
            sha256_url: None,
            pode_aplicar_direto: false,
            erro: Some(erro),
        },
    };

    Json(info).into_response()
}

async fn baixar_bytes_limitado(client: &reqwest::Client, url: &str) -> Result<Vec<u8>, String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "URL de download inválida".to_owned())?;
    let host = parsed.host_str().unwrap_or("");
    let host_permitido = host == "github.com"
        || host.ends_with(".githubusercontent.com")
        || host.ends_with(".github.com");
    if parsed.scheme() != "https" || !host_permitido {
        return Err(format!("origem de download não permitida: {host}"));
    }

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("falha ao baixar arquivo do GitHub: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("download falhou com HTTP {}", resp.status()));
    }
    if let Some(len) = resp.content_length()
        && len as usize > MAX_DOWNLOAD_BYTES
    {
        return Err("arquivo excede o limite de segurança de 128 MiB".to_owned());
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("erro ao ler corpo do download: {e}"))?;
    if bytes.len() > MAX_DOWNLOAD_BYTES {
        return Err("arquivo excede o limite de segurança de 128 MiB".to_owned());
    }
    Ok(bytes.to_vec())
}

#[cfg(unix)]
fn substituir_binario_atomico(novo_bin: &Path, destino: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let pai = destino
        .parent()
        .ok_or_else(|| "caminho do executável sem diretório pai".to_owned())?;
    let tmp = pai.join(format!(".estacao-ai-update-{}.tmp", std::process::id()));
    std::fs::copy(novo_bin, &tmp)
        .map_err(|e| format!("sem permissão para atualizar {}: {e}", destino.display()))?;
    std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755))
        .map_err(|e| format!("erro ao definir permissão executável: {e}"))?;
    std::fs::rename(&tmp, destino).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("erro ao substituir executável {}: {e}", destino.display())
    })?;
    Ok(())
}

pub(crate) fn nome_arquivo_seguro(nome: &str) -> Result<String, String> {
    let limpo = nome.trim();
    if limpo.is_empty()
        || limpo.contains('/')
        || limpo.contains('\\')
        || limpo.contains("..")
        || !limpo
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
    {
        return Err("Nome de arquivo de atualização inválido.".to_owned());
    }
    Ok(limpo.to_owned())
}

#[cfg(target_os = "linux")]
fn aplicar_deb_linux(
    deb_bytes: &[u8],
    nome_arquivo: &str,
) -> Result<(String, bool, Option<String>), String> {
    let nome_seguro = nome_arquivo_seguro(nome_arquivo)?;
    let tmp_dir =
        tempfile::tempdir().map_err(|e| format!("erro ao criar pasta temporária: {e}"))?;
    let deb_path = tmp_dir.path().join(&nome_seguro);
    std::fs::write(&deb_path, deb_bytes).map_err(|e| format!("erro ao gravar .deb: {e}"))?;

    let extrair_dir = tmp_dir.path().join("extraido");
    std::fs::create_dir_all(&extrair_dir).map_err(|e| format!("erro ao criar pasta: {e}"))?;

    let status = std::process::Command::new("dpkg-deb")
        .arg("-x")
        .arg(&deb_path)
        .arg(&extrair_dir)
        .status()
        .map_err(|e| format!("erro ao executar dpkg-deb: {e}"))?;
    if !status.success() {
        return Err("dpkg-deb falhou ao extrair o pacote .deb".to_owned());
    }

    let novo_bin = extrair_dir.join("usr/lib/estacao-ai/estacao-ai");
    if !novo_bin.is_file() {
        return Err("binário estacao-ai não encontrado dentro do pacote .deb".to_owned());
    }

    let exe_atual = std::env::current_exe()
        .map_err(|e| format!("não foi possível localizar o executável atual: {e}"))?;

    // Tenta substituir o executável atual diretamente (instalação de usuário em ~/.local/...).
    if substituir_binario_atomico(&novo_bin, &exe_atual).is_ok() {
        if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
            let link_bin = home.join(".local/bin/estacao-ai");
            if link_bin.exists() && link_bin != exe_atual {
                let _ = substituir_binario_atomico(&novo_bin, &link_bin);
            }
        }
        // Reinicia o serviço de usuário em segundo plano para carregar o novo binário.
        tokio::spawn(async {
            tokio::time::sleep(Duration::from_millis(800)).await;
            let _ = std::process::Command::new("systemctl")
                .args(["--user", "restart", "estacao-ai.service"])
                .status();
        });
        return Ok((
            "Atualização aplicada diretamente do GitHub! Reiniciando a Estação I.A…".to_owned(),
            true,
            None,
        ));
    }

    // Fallback para instalação de sistema (/usr/bin): salva em ~/Downloads e abre instalador.
    let destino_dir = std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|h| h.join("Downloads"))
        .filter(|d| d.is_dir())
        .unwrap_or_else(std::env::temp_dir);
    let salvo = destino_dir.join(&nome_seguro);
    std::fs::write(&salvo, deb_bytes).map_err(|e| format!("erro ao salvar .deb: {e}"))?;
    let _ = std::process::Command::new("xdg-open").arg(&salvo).spawn();
    Ok((
        format!(
            "Pacote baixado e verificado em {}. Conclua a instalação pelo instalador do sistema ou execute `sudo apt install ./{}`.",
            salvo.display(),
            nome_seguro
        ),
        false,
        Some(salvo.display().to_string()),
    ))
}

#[cfg(windows)]
fn aplicar_exe_windows(
    exe_bytes: &[u8],
    nome_arquivo: &str,
    state: Arc<WebState>,
) -> Result<(String, bool, Option<String>), String> {
    let nome_seguro = nome_arquivo_seguro(nome_arquivo)?;
    let destino = std::env::temp_dir().join(&nome_seguro);
    std::fs::write(&destino, exe_bytes).map_err(|e| format!("erro ao gravar instalador: {e}"))?;
    std::process::Command::new(&destino)
        .spawn()
        .map_err(|e| format!("erro ao abrir o instalador: {e}"))?;

    // Fecha cooperativamente o supervisor/bandeja e o servidor HTTP logo após
    // enviar a resposta ao navegador, evitando conflito de arquivo em uso.
    let stop_file = state.wiki.data_dir().join("service-host.stop");
    let state_clone = Arc::clone(&state);
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(650)).await;
        let _ = std::fs::write(&stop_file, b"update");
        state_clone.request_shutdown();
    });

    Ok((
        "Instalador oficial baixado e verificado. Fechando esta versão automaticamente para atualizar sem conflitos…".to_owned(),
        true,
        Some(destino.display().to_string()),
    ))
}

pub(crate) async fn api_aplicar_atualizacao(
    axum::Extension(i18n): axum::Extension<ai_memory_core::i18n::Localizer>,
    State(state): State<Arc<WebState>>,
    level: Option<axum::Extension<ai_memory_core::AuthLevel>>,
    headers: HeaderMap,
) -> Response {
    if let Err(recusa) = autorizar(&i18n, &state, level, &headers).await {
        return recusa;
    }
    let rel = match consultar_github_release().await {
        Ok(r) => r,
        Err(erro) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(RespostaAplicar {
                    ok: false,
                    versao: None,
                    mensagem: erro,
                    reiniciando: false,
                    arquivo_baixado: None,
                }),
            )
                .into_response();
        }
    };

    if !ha_atualizacao(VERSAO_ATUAL, &rel.tag_name) {
        return Json(RespostaAplicar {
            ok: true,
            versao: Some(VERSAO_ATUAL.to_owned()),
            mensagem: format!("A Estação I.A já está na versão mais recente ({VERSAO_ATUAL})."),
            reiniciando: false,
            arquivo_baixado: None,
        })
        .into_response();
    }

    let Some(asset) = escolher_asset(&rel.assets, std::env::consts::OS, std::env::consts::ARCH)
    else {
        return (
            StatusCode::NOT_FOUND,
            Json(RespostaAplicar {
                ok: false,
                versao: Some(versao_legivel(&rel.tag_name)),
                mensagem:
                    "Nenhum pacote compatível com este sistema foi encontrado na release do GitHub."
                        .to_owned(),
                reiniciando: false,
                arquivo_baixado: None,
            }),
        )
            .into_response();
    };

    let client = match reqwest::Client::builder()
        .timeout(TIMEOUT_DOWNLOAD)
        .user_agent(format!("estacao-ai/{VERSAO_ATUAL}"))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(RespostaAplicar {
                    ok: false,
                    versao: None,
                    mensagem: format!("erro ao criar cliente HTTP: {e}"),
                    reiniciando: false,
                    arquivo_baixado: None,
                }),
            )
                .into_response();
        }
    };

    let bytes = match baixar_bytes_limitado(&client, &asset.browser_download_url).await {
        Ok(b) => b,
        Err(erro) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(RespostaAplicar {
                    ok: false,
                    versao: Some(versao_legivel(&rel.tag_name)),
                    mensagem: erro,
                    reiniciando: false,
                    arquivo_baixado: None,
                }),
            )
                .into_response();
        }
    };

    // Exige SHA256SUMS.txt publicado e hash correspondente na release (fail-closed).
    let Some(sha_asset) = encontrar_sha256_asset(&rel.assets) else {
        return (
            StatusCode::BAD_GATEWAY,
            Json(RespostaAplicar {
                ok: false,
                versao: Some(versao_legivel(&rel.tag_name)),
                mensagem:
                    "SHA256SUMS.txt ausente na release do GitHub. Atualização cancelada por segurança."
                        .to_owned(),
                reiniciando: false,
                arquivo_baixado: None,
            }),
        )
            .into_response();
    };
    match baixar_bytes_limitado(&client, &sha_asset.browser_download_url).await {
        Ok(sha_bytes) => {
            let texto = String::from_utf8_lossy(&sha_bytes);
            let Some(esperado) = extrair_sha256_esperado(&texto, &asset.name) else {
                return (
                    StatusCode::BAD_GATEWAY,
                    Json(RespostaAplicar {
                        ok: false,
                        versao: Some(versao_legivel(&rel.tag_name)),
                        mensagem: "Hash SHA-256 do pacote não encontrado em SHA256SUMS.txt. Atualização cancelada por segurança.".to_owned(),
                        reiniciando: false,
                        arquivo_baixado: None,
                    }),
                )
                    .into_response();
            };
            let calculado = format!("{:x}", Sha256::digest(&bytes));
            if calculado != esperado {
                return (
                    StatusCode::BAD_GATEWAY,
                    Json(RespostaAplicar {
                        ok: false,
                        versao: Some(versao_legivel(&rel.tag_name)),
                        mensagem: "Falha na verificação SHA-256 do arquivo baixado. Atualização cancelada por segurança.".to_owned(),
                        reiniciando: false,
                        arquivo_baixado: None,
                    }),
                )
                    .into_response();
            }
        }
        Err(erro) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(RespostaAplicar {
                    ok: false,
                    versao: Some(versao_legivel(&rel.tag_name)),
                    mensagem: format!("Não foi possível baixar SHA256SUMS.txt: {erro}"),
                    reiniciando: false,
                    arquivo_baixado: None,
                }),
            )
                .into_response();
        }
    }

    let resultado: Result<(String, bool, Option<String>), String> = {
        #[cfg(target_os = "linux")]
        {
            if asset.name.ends_with(".deb") {
                aplicar_deb_linux(&bytes, &asset.name)
            } else {
                Err("Formato de pacote Linux não suportado para aplicação automática.".to_owned())
            }
        }
        #[cfg(windows)]
        {
            aplicar_exe_windows(&bytes, &asset.name, Arc::clone(&state))
        }
        #[cfg(not(any(target_os = "linux", windows)))]
        {
            Err("Aplicação automática suportada em Linux (.deb) e Windows (.exe). Baixe o arquivo pela página da release.".to_owned())
        }
    };

    match resultado {
        Ok((mensagem, reiniciando, arquivo_baixado)) => {
            if let Ok(mut guard) = cache().lock() {
                *guard = None;
            }
            Json(RespostaAplicar {
                ok: true,
                versao: Some(versao_legivel(&rel.tag_name)),
                mensagem,
                reiniciando,
                arquivo_baixado,
            })
            .into_response()
        }
        Err(erro) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(RespostaAplicar {
                ok: false,
                versao: Some(versao_legivel(&rel.tag_name)),
                mensagem: erro,
                reiniciando: false,
                arquivo_baixado: None,
            }),
        )
            .into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizar_e_comparar_versoes_funciona() {
        assert_eq!(normalizar_versao("1.5.0"), Some((1, 5, 0)));
        assert_eq!(normalizar_versao("estacao-1.6.0"), Some((1, 6, 0)));
        assert_eq!(normalizar_versao("v2.0.1-rc1"), Some((2, 0, 1)));
        assert!(ha_atualizacao("1.5.0", "estacao-1.5.1"));
        assert!(ha_atualizacao("1.5.0", "estacao-1.6.0"));
        assert!(!ha_atualizacao("1.5.0", "estacao-1.5.0"));
        assert!(!ha_atualizacao("1.5.0", "estacao-1.4.9"));
    }

    #[test]
    fn extrair_sha256_esperado_le_formato_sha256sum() {
        let hash = "38c8a735f30a9569ae9e2f45035a4d5c8848ad7ef3842b7a4dcabcfa5ccee162";
        let txt = format!("{hash}  estacao-ai_1.5.0_amd64.deb\n");
        assert_eq!(
            extrair_sha256_esperado(&txt, "estacao-ai_1.5.0_amd64.deb").as_deref(),
            Some(hash)
        );
        assert_eq!(extrair_sha256_esperado(&txt, "outro.deb"), None);
    }

    #[test]
    fn escolher_asset_prioriza_deb_linux_e_exe_windows() {
        let assets = vec![
            GithubAsset {
                name: "SHA256SUMS.txt".into(),
                browser_download_url: "https://github.com/a/b/SHA256SUMS.txt".into(),
            },
            GithubAsset {
                name: "estacao-ai_1.6.0_amd64.deb".into(),
                browser_download_url: "https://github.com/a/b/estacao-ai_1.6.0_amd64.deb".into(),
            },
            GithubAsset {
                name: "Estacao-ai-Setup-win10-11-x64.exe".into(),
                browser_download_url: "https://github.com/a/b/Estacao-ai-Setup-win10-11-x64.exe"
                    .into(),
            },
        ];
        assert_eq!(
            escolher_asset(&assets, "linux", "x86_64").map(|a| a.name.as_str()),
            Some("estacao-ai_1.6.0_amd64.deb")
        );
        assert_eq!(
            escolher_asset(&assets, "windows", "x86_64").map(|a| a.name.as_str()),
            Some("Estacao-ai-Setup-win10-11-x64.exe")
        );
    }

    #[test]
    fn nome_arquivo_seguro_rejeita_path_traversal() {
        assert_eq!(
            nome_arquivo_seguro("estacao-ai_1.7.0_amd64.deb").as_deref(),
            Ok("estacao-ai_1.7.0_amd64.deb")
        );
        assert!(nome_arquivo_seguro("../evil.deb").is_err());
        assert!(nome_arquivo_seguro("/etc/passwd").is_err());
        assert!(nome_arquivo_seguro("..\\evil.exe").is_err());
        assert!(nome_arquivo_seguro("").is_err());
    }
}
