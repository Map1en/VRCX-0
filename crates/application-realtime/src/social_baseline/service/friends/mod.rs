mod baseline;
mod current_user_snapshot;
mod entry;
mod profile;

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
    json, object_field, object_field_string, FriendBaselineSyncOutcome,
    SocialFriendRosterBaselineOutput,
};
#[cfg(test)]
use entry::build_fast_roster_records;
#[cfg(test)]
use profile::{insert_fetched_friend, RemoteFriendProfile};

#[cfg(test)]
use baseline::collect_suspicious_friend_ids;

pub(crate) use baseline::friend_baseline_from_raw;
#[cfg(test)]
pub(crate) use baseline::friend_log_relationship_candidates;
pub use baseline::FriendStatusVerdicts;
pub(crate) use baseline::{
    apply_friend_roster_baseline_sync_outcome, build_friend_roster_baseline,
    persisted_friend_numbers, reconcile_friend_roster_records,
    verify_friend_log_relationship_changes, FriendRosterReconcileOutcome,
};
