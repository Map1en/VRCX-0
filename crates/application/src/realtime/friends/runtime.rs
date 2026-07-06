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

#[path = "event_patch.rs"]
mod event_patch;
#[path = "persistence.rs"]
mod persistence;
#[path = "projection.rs"]
mod projection;
#[path = "state.rs"]
mod state;
#[path = "utils.rs"]
mod utils;

#[cfg(test)]
#[path = "../../../tests/realtime/friends/baseline_tests.rs"]
mod baseline_tests;
#[cfg(test)]
#[path = "../../../tests/realtime/friends/feed_tests.rs"]
mod feed_tests;
#[cfg(test)]
#[path = "../../../tests/realtime/friends/location_embedded_user_tests.rs"]
mod location_embedded_user_tests;
#[cfg(test)]
#[path = "../../../tests/realtime/friends/location_feed_tests.rs"]
mod location_feed_tests;
#[cfg(test)]
#[path = "../../../tests/realtime/friends/location_offline_tests.rs"]
mod location_offline_tests;
#[cfg(test)]
#[path = "../../../tests/realtime/friends/location_state_tests.rs"]
mod location_state_tests;
#[cfg(test)]
#[path = "../../../tests/realtime/friends/presence_tests.rs"]
mod presence_tests;
#[cfg(test)]
#[path = "../../../tests/realtime/friends/profile_tests.rs"]
mod profile_tests;

pub use event_patch::is_friend_event_type;
pub use state::RealtimeFriendsRuntime;
