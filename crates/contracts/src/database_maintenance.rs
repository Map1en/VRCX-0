use serde::Serialize;

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UserTableContextOutput {
    pub user_id: String,
    pub user_prefix: String,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MaintenanceTableSizesOutput {
    pub gps: i64,
    pub status: i64,
    pub bio: i64,
    pub avatar: i64,
    pub online_offline: i64,
    pub friend_log_history: i64,
    pub notification: i64,
    pub location: i64,
    pub join_leave: i64,
    pub portal_spawn: i64,
    pub video_play: i64,
    pub event: i64,
    pub external: i64,
    pub resource_load: i64,
}
