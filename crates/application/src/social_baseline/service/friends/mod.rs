use super::*;
use vrcx_0_core::trust::{compute_trust_level, compute_user_platform};
use vrcx_0_persistence::config::get_bool as config_get_bool;
use vrcx_0_persistence::friends::friend_log_current_list;
use vrcx_0_persistence::realtime::{
    write_realtime_batch, FriendLogDelete, FriendLogUpsert, RealtimePersistenceBatch,
};
use vrcx_0_vrchat_client::auth::current_user_get_input;

mod baseline;
mod entry;
mod profile;
mod state_map;

#[cfg(test)]
mod tests;

use entry::{build_fast_roster_snapshot, infer_state_from_platform};
use profile::{
    fallback_friend_user, fetch_all_friends, float_value, get_display_name,
    get_meaningful_display_name, insert_fetched_friend, normalize_state_bucket, number_value,
    RemoteFriendProfile,
};

#[cfg(test)]
use baseline::collect_suspicious_friend_ids;

pub use baseline::build_friend_roster_baseline;
pub(super) use state_map::{build_friend_state_map, build_snapshot_friend_ids};
