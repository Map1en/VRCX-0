use serde::{Deserialize, Serialize};
use vrcx_0_core::json::RawJson;

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SocialFavoritesBaselineInput {
    #[serde(default)]
    pub user_id: String,
    #[serde(default)]
    pub endpoint: String,
    #[serde(default)]
    pub current_user_snapshot: RawJson,
    #[serde(default)]
    pub friend_roster_by_id: RawJson,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SocialFavoritesBaselineOutput {
    pub user_id: String,
    pub stale: bool,
    pub count: usize,
    pub snapshot: Option<RawJson>,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SocialFriendRosterBaselineInput {
    #[serde(default)]
    pub user_id: String,
    #[serde(default)]
    pub endpoint: String,
    #[serde(default)]
    pub websocket: String,
    #[serde(default)]
    pub current_user_snapshot: RawJson,
    #[serde(default)]
    pub is_first_load: bool,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SocialFriendRosterBaselineOutput {
    pub user_id: String,
    pub stale: bool,
    pub count: usize,
    pub detail: String,
    pub snapshot: Option<RawJson>,
    pub friend_log_changed: bool,
}
