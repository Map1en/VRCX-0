use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SavedCredentialUser {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile_pic_override_thumbnail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile_pic_override: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thumbnail_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_avatar_thumbnail_image_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_avatar_image_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct SavedLoginParams {
    pub username: String,
    pub password: Option<String>,
    pub endpoint: String,
    pub websocket: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct SavedCredential {
    pub user: SavedCredentialUser,
    pub login_params: SavedLoginParams,
    pub cookies: Option<String>,
}

pub(super) type SavedCredentials = BTreeMap<String, SavedCredential>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SavedLoginParamsSnapshot {
    pub username: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SavedCredentialSnapshot {
    pub user: SavedCredentialUser,
    pub login_params: SavedLoginParamsSnapshot,
    pub has_login_credentials: bool,
    pub has_cookies: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "kebab-case")]
pub enum SavedAuthAutoLoginStatus {
    NotConfigured,
    MissingLastUser,
    MissingCredentials,
    Available,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SavedAuthSnapshot {
    pub last_user_logged_in: Option<String>,
    pub saved_credentials_list: Vec<SavedCredentialSnapshot>,
    pub auto_login_delay_enabled: bool,
    pub auto_login_delay_seconds: i64,
    pub auto_login_status: SavedAuthAutoLoginStatus,
    pub auto_login_reason: String,
}

pub struct LoginSuccessRecordInput {
    pub user: Value,
    pub login_params: Value,
    pub stored_login_params: Option<Value>,
    pub save_credentials: bool,
}

pub struct LogoutRecordInput {
    pub user_id: String,
    pub clear_last_user_logged_in: bool,
}

pub struct SavedCredentialLoginStartInput {
    pub user_id: String,
    pub endpoint: String,
}

pub struct SavedCredentialSessionData {
    pub endpoint: String,
    pub websocket: String,
    pub cookies: Option<String>,
}
