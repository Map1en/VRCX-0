use std::collections::HashMap;

use serde::Serialize;
use vrcx_0_core::friends::FriendRecord;
use vrcx_0_core::presence::PresenceEntry;
pub use vrcx_0_core::realtime::{
    RealtimeSessionContext, RealtimeWsMessagePayload, RealtimeWsStatus, RealtimeWsStatusPayload,
};

use super::output::RealtimeFriendOutput;

pub const PENDING_OFFLINE_DELAY_MS: i64 = 170_000;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RealtimeCachedUserProfile {
    pub user_id: String,
    pub is_friend: bool,
    pub languages: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct RealtimeFriendSnapshot {
    pub current_user_id: String,
    pub endpoint: String,
    pub websocket: String,
    pub generation: u64,
    pub baseline_revision: u64,
    pub friends_by_id: HashMap<String, FriendRecord>,
    pub presence_by_id: HashMap<String, PresenceEntry>,
}

impl RealtimeFriendSnapshot {
    pub(crate) fn to_roster_snapshot(&self) -> FriendRosterSnapshot {
        FriendRosterSnapshot {
            current_user_id: self.current_user_id.clone(),
            friends_by_id: self.friends_by_id.clone(),
            presence_by_id: self.presence_by_id.clone(),
            generation: self.generation,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendRosterSnapshot {
    pub current_user_id: String,
    pub friends_by_id: HashMap<String, FriendRecord>,
    pub presence_by_id: HashMap<String, PresenceEntry>,
    pub generation: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RealtimeFriendRecordSnapshot {
    pub endpoint: String,
    pub record: FriendRecord,
}

#[derive(Debug, PartialEq)]
pub struct RealtimeFriendRosterSnapshot {
    pub current_user_id: String,
    pub endpoint: String,
    pub websocket: String,
    pub friend_count: usize,
    pub snapshot: FriendRosterSnapshot,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendBaselineResult {
    pub accepted: bool,
    pub generation: u64,
    pub baseline_revision: u64,
    pub friend_count: u32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct FriendBaselineCausalWatermark {
    pub generation: Option<u64>,
    pub baseline_revision: Option<u64>,
    pub friend_rev: u64,
    pub friend_log_sequence: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct FriendBaselineSyncOutcome {
    pub result: FriendBaselineResult,
    pub snapshot: Option<RealtimeFriendSnapshot>,
    pub friend_log_changed: bool,
}

impl FriendBaselineSyncOutcome {
    pub(crate) fn rejected(result: FriendBaselineResult) -> Self {
        Self {
            result,
            snapshot: None,
            friend_log_changed: false,
        }
    }

    pub(crate) fn accepted(
        result: FriendBaselineResult,
        snapshot: RealtimeFriendSnapshot,
        friend_log_changed: bool,
    ) -> Self {
        Self {
            result,
            snapshot: Some(snapshot),
            friend_log_changed,
        }
    }
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
        connected_secs: Option<u64>,
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

pub enum RealtimeFriendApplyResult {
    Output(Box<RealtimeFriendOutput>),
    MissingBaseline,
    Ignored,
}
