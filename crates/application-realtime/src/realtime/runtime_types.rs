use std::collections::HashMap;

use serde::Serialize;
use vrcx_0_core::friends::FriendRecord;
pub use vrcx_0_core::realtime::{
    RealtimeSessionContext, RealtimeWsMessagePayload, RealtimeWsStatusPayload,
};

use super::output::RealtimeFriendOutput;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct RealtimeFriendSnapshot {
    pub current_user_id: String,
    pub endpoint: String,
    pub websocket: String,
    pub generation: u64,
    pub baseline_revision: u64,
    pub friends_by_id: HashMap<String, FriendRecord>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendBaselineResult {
    pub accepted: bool,
    pub generation: u64,
    pub baseline_revision: u64,
    pub friend_count: usize,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct FriendBaselineCausalWatermark {
    pub generation: Option<u64>,
    pub baseline_revision: Option<u64>,
    pub friend_state_sequence: u64,
    pub friend_log_sequence: u64,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct FriendBaselineSyncOutcome {
    pub result: FriendBaselineResult,
    pub snapshot: Option<RealtimeFriendSnapshot>,
    pub friend_log_changed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeTransportStartResult {
    pub generation: u64,
    pub client_run_id: u64,
    pub session_generation: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RealtimeTransportTermination {
    Stopped,
    AuthExpired {
        reason: String,
        status_code: Option<i32>,
    },
    UnexpectedExit {
        reason: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RealtimeTransportLifecycleEvent {
    Connected(RealtimeTransportStartResult),
    Finished {
        transport: RealtimeTransportStartResult,
        termination: RealtimeTransportTermination,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RealtimeCurrentUserAuthority {
    pub local_game_context_available: bool,
    pub is_game_running: bool,
    pub game_log_enabled: bool,
    pub game_log_location: String,
    pub game_log_destination: String,
    pub game_log_world_name: String,
}

impl Default for RealtimeCurrentUserAuthority {
    fn default() -> Self {
        Self {
            local_game_context_available: true,
            is_game_running: false,
            game_log_enabled: false,
            game_log_location: String::new(),
            game_log_destination: String::new(),
            game_log_world_name: String::new(),
        }
    }
}

pub enum RealtimeFriendApplyResult {
    Output(Box<RealtimeFriendOutput>),
    MissingBaseline,
    Ignored,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum PendingOfflineTimerAction {
    #[default]
    None,
    Schedule {
        user_id: String,
        token: u64,
        delay_ms: u64,
    },
}
