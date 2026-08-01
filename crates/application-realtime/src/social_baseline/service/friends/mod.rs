mod baseline;
mod entry;
mod profile;
mod state_map;

#[cfg(test)]
mod tests;

#[cfg(test)]
use std::collections::{HashMap, HashSet};

#[cfg(test)]
use serde_json::Value;
#[cfg(test)]
use vrcx_0_application_core::Result;
#[cfg(test)]
use vrcx_0_core::friends::FriendRecord;

#[cfg(test)]
use super::{
    json, object_field, object_field_string, FriendBaselineSyncOutcome, RawJson,
    SocialFriendRosterBaselineOutput,
};
#[cfg(test)]
use entry::build_fast_roster_snapshot;
#[cfg(test)]
use profile::{insert_fetched_friend, RemoteFriendProfile};

#[cfg(test)]
use baseline::collect_suspicious_friend_ids;

#[cfg(test)]
pub(crate) use baseline::friend_log_relationship_candidates;
pub use baseline::{
    apply_friend_roster_baseline_sync_outcome, build_friend_roster_baseline,
    build_friend_roster_baseline_deferred, FriendStatusVerdicts,
};
pub(crate) use baseline::{
    build_friend_roster_baseline_deferred_internal, reconcile_friend_roster_records,
    verify_friend_log_relationship_changes, FriendRosterReconcileOutcome,
};
pub(super) use state_map::{
    build_friend_state_map, build_snapshot_friend_ids, FriendStateMap, SnapshotFriendIds,
};
