use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use vrcx_0_core::friends::{normalize_state_bucket, FriendRecord, FriendRosterBaseline};
use vrcx_0_core::realtime::RealtimeWsMessagePayload;
use vrcx_0_persistence::realtime::{FriendLogDelete, FriendLogUpsert};

use super::super::{
    FriendBaselineResult, FriendProjection, FriendProjectionPatch, PendingOfflineTimerAction,
    RealtimeFriendApplyResult, RealtimeFriendOutput, RealtimeFriendSnapshot,
};

mod event_patch;
mod persistence;
mod projection;
mod state;
mod utils;

#[cfg(test)]
mod baseline_tests;
#[cfg(test)]
mod feed_tests;
#[cfg(test)]
mod location_embedded_user_tests;
#[cfg(test)]
mod location_feed_tests;
#[cfg(test)]
mod location_offline_tests;
#[cfg(test)]
mod location_state_tests;
#[cfg(test)]
mod presence_tests;
#[cfg(test)]
mod profile_tests;

pub use event_patch::is_friend_event_type;
pub use state::RealtimeFriendsRuntime;
