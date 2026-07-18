use serde::Serialize;

use vrcx_0_application_realtime::{
    RealtimeTransportStartResult, SocialFavoritesBaselineOutput, SocialFriendRosterBaselineOutput,
};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum AuthenticatedRuntimePhase {
    #[default]
    Idle,
    Starting,
    Ready,
    Stopped,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum AuthenticatedRuntimeStepStatus {
    #[default]
    Pending,
    Running,
    RetryWaiting,
    Ready,
}

#[derive(Clone, Debug, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AuthenticatedRuntimeStepSnapshot {
    pub status: AuthenticatedRuntimeStepStatus,
    pub attempt: u32,
    pub retry_delay_seconds: Option<u64>,
    pub detail: String,
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AuthenticatedRuntimePhaseSnapshot {
    pub run_id: u64,
    pub auth_scope_generation: u64,
    pub user_id: String,
    pub endpoint: String,
    pub websocket: String,
    pub phase: AuthenticatedRuntimePhase,
    pub friends: AuthenticatedRuntimeStepSnapshot,
    pub favorites: AuthenticatedRuntimeStepSnapshot,
    pub realtime: AuthenticatedRuntimeStepSnapshot,
    pub friend_baseline: Option<SocialFriendRosterBaselineOutput>,
    pub favorites_baseline: Option<SocialFavoritesBaselineOutput>,
    pub realtime_transport: Option<RealtimeTransportStartResult>,
    pub updated_at: String,
}
