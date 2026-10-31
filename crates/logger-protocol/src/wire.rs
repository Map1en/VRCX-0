use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u32 = 2;
pub const MIN_CLIENT_PROTOCOL_VERSION: u32 = 1;
pub const CAPTURE_FORMAT_VERSION: u32 = 1;
pub const MAX_FRAMES_PAGE: u32 = 2000;
pub const PRESENCE_INTERVAL_SECS: u64 = 10;
pub const PRESENCE_TTL_SECS: u64 = 30;

#[cfg_attr(
    feature = "specta",
    derive(specta::Type),
    specta(rename = "FeedLoggerHello")
)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelloResponse {
    pub protocol_version: u32,
    pub min_client_protocol_version: u32,
    pub capture_format_version: u32,
    pub logger_version: String,
    pub server_time: i64,
}

#[cfg_attr(
    feature = "specta",
    derive(specta::Type),
    specta(rename = "FeedLoggerSession")
)]
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum SessionState {
    #[default]
    NoCredentials,
    LoggingIn,
    Recording,
    Reconnecting,
    AwaitingTwoFactor {
        methods: Vec<String>,
    },
    LoginFailed {
        reason: String,
    },
}

#[cfg_attr(
    feature = "specta",
    derive(specta::Type),
    specta(rename = "FeedLoggerDeviceLogin")
)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum DeviceLoginState {
    #[serde(rename_all = "camelCase")]
    Waiting {
        verification_url: String,
        expires_at: i64,
    },
    Expired,
    Failed {
        reason: String,
    },
}

#[cfg_attr(
    feature = "specta",
    derive(specta::Type),
    specta(rename = "FeedLoggerStatus")
)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusResponse {
    pub logger_version: String,
    pub protocol_version: u32,
    pub started_at: i64,
    pub server_time: i64,
    pub session: SessionState,
    pub account_id: Option<String>,
    pub password_saved: bool,
    pub last_login_at: Option<i64>,
    pub last_error: Option<String>,
    pub storage_error: Option<String>,
    pub relogin_attempts: u32,
    pub connected_since: Option<i64>,
    pub last_snapshot_at: Option<i64>,
    pub unsynced_frames: u64,
    pub oldest_unsynced_at: Option<i64>,
    pub newest_unsynced_at: Option<i64>,
    pub last_pull_at: Option<i64>,
    pub desktop_present: bool,
    pub database_bytes: u64,
    pub available_bytes: Option<u64>,
    pub retention_bytes: Option<u64>,
    pub retention_days: Option<u32>,
    pub dropped_unsynced_frames: u64,
    pub dropped_after_password_change: u64,
    pub webhook_configured: bool,
    pub webhook_target: Option<String>,
    pub webhook_format: Option<WebhookFormat>,
    pub last_webhook_at: Option<i64>,
    pub last_webhook_ok: Option<bool>,
    #[serde(default)]
    pub device_login: Option<DeviceLoginState>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialsRequest {
    pub username: String,
    pub password: String,
    pub save_password: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceLoginRequest {
    pub account_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TwoFactorRequest {
    pub method: String,
    pub code: String,
}

#[cfg_attr(
    feature = "specta",
    derive(specta::Type),
    specta(rename = "FeedLoggerWebhookFormat")
)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WebhookFormat {
    Discord,
    Text,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhookRequest {
    pub url: Option<String>,
    pub format: WebhookFormat,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenceRequest {
    pub account_id: String,
    #[serde(default)]
    pub leaving: bool,
    #[serde(default)]
    pub profile_scan: bool,
    #[serde(default)]
    pub profile_checks: Vec<ProfileCheck>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenceResponse {
    pub server_time_ms: i64,
    pub resumed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileCheck {
    pub user_id: String,
    pub checked_at: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FramesRequest {
    pub account_id: String,
    pub after: i64,
    pub limit: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FrameKind {
    Message,
    Connect,
    Snapshot,
    Profile,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WireFrame {
    pub seq: i64,
    pub kind: FrameKind,
    pub received_at: String,
    pub account_id: String,
    pub payload: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FramesResponse {
    pub frames: Vec<WireFrame>,
    pub has_more: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AckRequest {
    pub account_id: String,
    pub up_to: i64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct OkResponse {}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ErrorResponse {
    pub message: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotPayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after_seq: Option<i64>,
    #[serde(default)]
    pub current_user: serde_json::Value,
    #[serde(default)]
    pub online_friends: Vec<serde_json::Value>,
    #[serde(default)]
    pub offline_friends: Vec<serde_json::Value>,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::SnapshotPayload;

    #[test]
    fn a_snapshot_frame_carries_the_baseline_under_its_wire_keys() {
        let payload = SnapshotPayload {
            after_seq: Some(7),
            current_user: json!({ "id": "usr_self" }),
            online_friends: vec![json!({ "id": "usr_a" })],
            offline_friends: vec![json!({ "id": "usr_b" })],
        };

        assert_eq!(
            serde_json::to_value(&payload).unwrap(),
            json!({
                "afterSeq": 7,
                "currentUser": { "id": "usr_self" },
                "onlineFriends": [{ "id": "usr_a" }],
                "offlineFriends": [{ "id": "usr_b" }],
            })
        );
    }

    #[test]
    fn a_snapshot_recorded_before_its_sequence_was_known_still_reads() {
        let payload: SnapshotPayload =
            serde_json::from_value(json!({ "onlineFriends": [], "offlineFriends": [] })).unwrap();

        assert_eq!(payload.after_seq, None);
        assert!(payload.current_user.is_null());
    }
}
