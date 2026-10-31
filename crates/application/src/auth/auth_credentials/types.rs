use std::collections::BTreeMap;

use serde::Serialize;
use vrcx_0_core::json::RawJson;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SavedCredentialUser {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_url: Option<String>,
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

impl SavedCredential {
    pub(super) fn has_saved_password(&self) -> bool {
        self.login_params
            .password
            .as_deref()
            .is_some_and(|password| !password.trim().is_empty())
    }
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SavedCredentialRecordMode {
    WithPassword,
    WithoutPassword,
    ExistingOnly,
}

pub struct LoginSuccessRecordInput {
    pub user: RawJson,
    pub login_params: RawJson,
    pub stored_login_params: Option<RawJson>,
    pub record: SavedCredentialRecordMode,
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
