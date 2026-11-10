#[cfg(test)]
use serde_json::{json, Value};
#[cfg(test)]
use vrcx_0_core::friends::{
    FriendBaselineEntry, FriendBaselinePresence, FriendRecord, FriendRosterBaseline,
};
#[cfg(test)]
use vrcx_0_core::realtime::RealtimeWsMessagePayload;

#[cfg(test)]
use super::super::{RealtimeFriendApplyResult, RealtimeFriendOutput};

mod apply;
mod social_feed;
mod state;

#[cfg(test)]
mod baseline_tests;
#[cfg(test)]
mod event_field_ownership_tests;
#[cfg(test)]
mod feed_tests;
#[cfg(test)]
mod location_feed_tests;
#[cfg(test)]
mod presence_test_support;
#[cfg(test)]
mod presence_tests;
#[cfg(test)]
mod profile_tests;
#[cfg(test)]
mod ws_trace_replay_test;

pub(crate) use social_feed::{display_name_feed_entry, trust_level_feed_entry};
pub use state::RealtimeFriendsRuntime;
pub(crate) use state::SyntheticFriendEvent;
pub(crate) use state::{apply_friend_number, FriendBaselineEffects, RosterDelta};
