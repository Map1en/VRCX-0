use std::sync::LazyLock;
use std::time::Duration;

use regex::Regex;
use reqwest::Client;
use serde::{Deserialize, Serialize};

const DEFAULT_PRODUCTION_ENDPOINT: &str = "https://stats.vrcx-0.dev";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_SUMMARY_LENGTH: usize = 160;
const MAX_TOKEN_LENGTH: usize = 64;

static URL_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"\bhttps?://[^\s'"`<>]+"#).unwrap());
static WINDOWS_PATH_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"[A-Za-z]:\\[^\s'"`<>]+"#).unwrap());
static SLASH_PATH_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?:^|\s)/[^\s'"`<>]+(?:/[^\s'"`<>]+)+"#).unwrap());
static VRCHAT_ID_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\b(?:usr|wrld|avtr|grp|file|vol|inst|auth|not|rgn|prn)_[A-Za-z0-9-]+\b").unwrap()
});
static UUID_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b")
        .unwrap()
});
static LONG_HEX_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b[0-9a-f]{24,}\b").unwrap());
static WHITESPACE_PATTERN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());
static SAFE_TOKEN_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[^A-Za-z0-9_.:-]+").unwrap());
static SAFE_VERSION_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[^A-Za-z0-9._+-]+").unwrap());

#[derive(Debug, thiserror::Error)]
pub enum TelemetryError {
    #[error("telemetry transport error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("telemetry rejected ({status})")]
    Rejected { status: u16 },
}

#[derive(Clone)]
pub struct TelemetryClient {
    http: Client,
    endpoint: String,
}

impl TelemetryClient {
    pub fn new(endpoint: String) -> Self {
        let http = Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .build()
            .unwrap_or_default();
        Self {
            http,
            endpoint: normalize_endpoint(&endpoint),
        }
    }

    pub fn is_enabled(&self) -> bool {
        !self.endpoint.is_empty()
    }

    pub async fn post<T>(&self, path: &str, payload: &T) -> Result<(), TelemetryError>
    where
        T: Serialize + ?Sized,
    {
        if !self.is_enabled() {
            return Ok(());
        }
        let response = self
            .http
            .post(format!("{}{}", self.endpoint, normalize_path(path)))
            .json(payload)
            .send()
            .await?;
        if response.status().is_success() {
            return Ok(());
        }
        Err(TelemetryError::Rejected {
            status: response.status().as_u16(),
        })
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TelemetryRuntimeMode {
    Foreground,
    Background,
    Headless,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryContext {
    pub install_id: String,
    pub session_id: String,
    pub app_version: String,
    pub platform: String,
    pub arch: String,
    pub locale: String,
    pub timezone: String,
    pub mode: TelemetryRuntimeMode,
    pub vrchat_running: bool,
    pub local_weekday: u32,
    pub local_hour: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_ended: Option<bool>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VrchatLifecyclePayload {
    #[serde(flatten)]
    pub context: TelemetryContext,
    pub state: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryConfigSnapshot {
    pub background_mode_enabled: bool,
    pub wrist_overlay_enabled: bool,
    pub xs_notifications: bool,
    pub ovrt_hud_notifications: bool,
    pub ovrt_wrist_notifications: bool,
    pub discord_active: bool,
    pub mcp_server_enabled: bool,
    pub webhook_enabled: bool,
    pub auto_state_change_enabled: bool,
    pub auto_accept_invite_requests: String,
    pub avatar_auto_cleanup: String,
    pub theme_mode: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSnapshotPayload {
    #[serde(flatten)]
    pub context: TelemetryContext,
    pub config: TelemetryConfigSnapshot,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewModeUsageEntry {
    pub dimension: String,
    pub used: Vec<String>,
    pub switches: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewModeUsagePayload {
    #[serde(flatten)]
    pub context: TelemetryContext,
    pub modes: Vec<ViewModeUsageEntry>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryErrorDetail {
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    pub signature: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_version: Option<String>,
    pub count: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteUsageEntry {
    pub route: String,
    pub visits: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub load_fail: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub render_crash: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Vec<TelemetryErrorDetail>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageHealthPayload {
    #[serde(flatten)]
    pub context: TelemetryContext,
    pub routes: Vec<RouteUsageEntry>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantHealthPayload {
    #[serde(flatten)]
    pub context: TelemetryContext,
    pub tool_errors: u32,
    pub turn_errors: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Vec<TelemetryErrorDetail>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantUsagePayload {
    #[serde(flatten)]
    pub context: TelemetryContext,
    pub opens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key_configured: Option<bool>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientErrorPayload {
    #[serde(flatten)]
    pub context: TelemetryContext,
    pub errors: Vec<TelemetryErrorDetail>,
}

pub fn resolve_endpoint() -> String {
    if cfg!(debug_assertions) {
        resolve_endpoint_for(
            true,
            std::env::var("VRCX_0_TELEMETRY_ENDPOINT").ok().as_deref(),
            option_env!("VRCX_0_TELEMETRY_ENDPOINT"),
        )
    } else {
        resolve_endpoint_for(
            false,
            std::env::var("VRCX_0_TELEMETRY_ENDPOINT").ok().as_deref(),
            option_env!("VRCX_0_TELEMETRY_ENDPOINT"),
        )
    }
}

pub fn resolve_endpoint_for(
    debug_assertions: bool,
    runtime_env: Option<&str>,
    compile_env: Option<&str>,
) -> String {
    if debug_assertions {
        return normalize_endpoint(runtime_env.unwrap_or_default());
    }
    normalize_endpoint(compile_env.unwrap_or(DEFAULT_PRODUCTION_ENDPOINT))
}

pub fn sanitize_error_summary(value: impl AsRef<str>) -> String {
    let value = value.as_ref();
    let value = URL_PATTERN.replace_all(value, "<url>");
    let value = WINDOWS_PATH_PATTERN.replace_all(&value, "<path>");
    let value = SLASH_PATH_PATTERN.replace_all(&value, " <path>");
    let value = VRCHAT_ID_PATTERN.replace_all(&value, "<id>");
    let value = UUID_PATTERN.replace_all(&value, "<uuid>");
    let value = LONG_HEX_PATTERN.replace_all(&value, "<hash>");
    let value = WHITESPACE_PATTERN.replace_all(&value, " ");
    truncate_chars(value.trim(), MAX_SUMMARY_LENGTH)
}

pub fn sanitize_error_token(value: Option<&str>) -> Option<String> {
    let value = value.unwrap_or_default().trim();
    let value = SAFE_TOKEN_PATTERN.replace_all(value, "_");
    let value = value.trim_matches('_');
    (!value.is_empty()).then(|| truncate_chars(value, MAX_TOKEN_LENGTH))
}

pub fn sanitize_app_version(value: Option<&str>) -> Option<String> {
    let value = value.unwrap_or_default().trim();
    let value = SAFE_VERSION_PATTERN.replace_all(value, "_");
    let value = value.trim_matches('_');
    (!value.is_empty()).then(|| truncate_chars(value, MAX_TOKEN_LENGTH))
}

pub fn build_error_detail(
    kind: &str,
    source: Option<&str>,
    code: Option<&str>,
    name: Option<&str>,
    summary: Option<&str>,
    app_version: Option<&str>,
) -> TelemetryErrorDetail {
    let source = sanitize_error_token(source);
    let code = sanitize_error_token(code);
    let name = sanitize_error_token(name);
    let summary = summary
        .map(sanitize_error_summary)
        .filter(|value| !value.is_empty());
    let app_version = sanitize_app_version(app_version);
    let stable_parts = [
        kind,
        source.as_deref().unwrap_or("-"),
        code.as_deref().unwrap_or("-"),
        name.as_deref().unwrap_or("-"),
        summary.as_deref().unwrap_or("-"),
    ];
    TelemetryErrorDetail {
        kind: kind.to_string(),
        signature: format!("{kind}:{}", hash_string(&stable_parts.join("|"))),
        source,
        code,
        name,
        summary,
        app_version,
        count: 1,
    }
}

fn normalize_endpoint(value: &str) -> String {
    value.trim().trim_end_matches('/').to_string()
}

fn normalize_path(path: &str) -> String {
    if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    }
}

fn truncate_chars(value: &str, max_len: usize) -> String {
    value.chars().take(max_len).collect()
}

fn hash_string(value: &str) -> String {
    let mut hash = 0x811c9dc5u32;
    for unit in value.encode_utf16() {
        hash ^= u32::from(unit);
        hash = hash.wrapping_mul(0x01000193);
    }
    format!("{hash:08x}")
}
