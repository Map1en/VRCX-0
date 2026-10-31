use serde::{Deserialize, Serialize};

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
    pub local_weekday: u32,
    pub local_hour: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_ended: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vrchat_seen: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signed_in: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub basic: Option<bool>,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TelemetryVrcxOrigin {
    Migrated,
    VrcxDetected,
    Fresh,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TelemetryOfflineRecord {
    On,
    Off,
}

impl TelemetryOfflineRecord {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::On => "on",
            Self::Off => "off",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryConfigSnapshot {
    pub auto_state_change_enabled: bool,
    pub auto_accept_invite_requests: String,
    pub avatar_auto_cleanup: String,
    pub theme_mode: String,
    pub db_size_bucket: String,
    pub feed_rows_bucket: String,
    pub gamelog_rows_bucket: String,
    pub friend_log_rows_bucket: String,
    pub friend_count_bucket: String,
    pub vrcx_origin: TelemetryVrcxOrigin,
    pub offline_record: TelemetryOfflineRecord,
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
    pub landings: Option<u32>,
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
pub struct ToolUsageEntry {
    pub tool: String,
    pub opens: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolUsagePayload {
    #[serde(flatten)]
    pub context: TelemetryContext,
    pub tools: Vec<ToolUsageEntry>,
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
pub struct ClientErrorPayload {
    #[serde(flatten)]
    pub context: TelemetryContext,
    pub errors: Vec<TelemetryErrorDetail>,
}
