use std::time::Duration;

use serde_json::Value;
use vrcx_0_contracts::realtime::RealtimePersistenceBatch;

use crate::realtime::{
    RealtimeCurrentUserOutput, RealtimeInstanceQueueProjection, RealtimeNotificationOutput,
    RealtimeNotificationProjection, RealtimeNotificationUpsert,
};
#[cfg(test)]
use crate::social_baseline::service::friend_log_relationship_candidates;

#[cfg(test)]
use vrcx_0_application_core::Result;
#[cfg(test)]
use vrcx_0_core::realtime::RealtimeWsMessagePayload;

#[cfg(test)]
use crate::realtime::connection::RealtimeMessageSink;
#[cfg(test)]
use crate::realtime::{
    RealtimeFriendApplyResult, RealtimeFriendOutput, RealtimeTransportStartResult,
    RealtimeTransportTermination,
};
#[cfg(test)]
use crate::social_baseline::service::{reconcile_friend_roster_records, FriendStatusVerdicts};

mod automation;
mod baseline;
mod connection;
mod current_user;
mod enrichment;
mod fanout;
mod feed;
mod friend_avatar_change;
#[cfg(test)]
mod friend_avatar_change_tests;
#[cfg(test)]
mod friend_baseline_tests;
mod friend_events;
mod friend_feed_entry;
#[cfg(test)]
mod friend_feed_entry_tests;
#[cfg(test)]
mod friend_joining_tests;
mod friend_mutation;
mod friend_profile;
mod friend_profile_bulk_load;
#[cfg(test)]
mod friend_profile_bulk_load_tests;
mod game_process;
mod group_changes;
mod message_dispatch;
#[cfg(test)]
mod notification_enrichment_tests;
mod state;
#[cfg(any(test, feature = "test-utils"))]
pub mod test_support;
#[cfg(test)]
mod transport_lifecycle_tests;
mod world_cache;
#[cfg(test)]
mod world_cache_tests;

async fn sleep_until(at_ms: i64) {
    while let Ok(remaining_ms @ 1..) = u64::try_from(at_ms - chrono::Utc::now().timestamp_millis())
    {
        tokio::time::sleep(Duration::from_millis(remaining_ms)).await;
    }
}

pub use friend_mutation::SyntheticFriendEventOutcome;
pub use friend_profile_bulk_load::{FriendProfileBulkLoadStatus, FriendProfileLoadStatusPayload};
pub use state::{
    RealtimeCurrentUserSnapshotSink, RealtimeHostRuntime, RealtimeHostRuntimeDeps,
    RealtimeStopRequest,
};

#[cfg(test)]
mod sleep_until_tests {
    use super::*;

    #[tokio::test]
    async fn sleep_until_waits_for_the_wall_clock_deadline() {
        let at_ms = chrono::Utc::now().timestamp_millis() + 50;

        sleep_until(at_ms).await;

        assert!(chrono::Utc::now().timestamp_millis() >= at_ms);
    }
}
