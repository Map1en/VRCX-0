mod realtime;
mod social_baseline;
mod world_enrich;

#[cfg(any(test, feature = "test-utils"))]
pub mod test_support {
    pub use crate::realtime::service::test_support::{
        runtime_with_active_session, TestDir, TestRealtimeHostRuntime,
    };
}

pub use realtime::{
    is_friend_event_type, is_print_created_content_refresh, FriendBaselineCausalWatermark,
    FriendBaselineResult, FriendBaselineSyncOutcome, FriendProfileBulkLoadStatus,
    FriendProfileLoadStatusPayload, FriendProjection, FriendProjectionPatch,
    PendingOfflineTimerAction, RealtimeCurrentUserAuthority, RealtimeCurrentUserOutput,
    RealtimeCurrentUserProjection, RealtimeEntryCorrection, RealtimeEntryCorrectionFields,
    RealtimeEntryCorrectionStream, RealtimeFriendApplyResult, RealtimeFriendOutput,
    RealtimeFriendSnapshot, RealtimeFriendsRuntime, RealtimeHostRuntime, RealtimeHostRuntimeDeps,
    RealtimeInstanceClosedOutput, RealtimeInstanceClosedProjection,
    RealtimeInstanceQueueProjection, RealtimeNotificationOutput, RealtimeNotificationProjection,
    RealtimeNotificationUpsert, RealtimeSessionContext, RealtimeStopRequest,
    RealtimeTransportLifecycleEvent, RealtimeTransportStartResult, RealtimeTransportTermination,
    RealtimeUserProjection, RealtimeWsMessagePayload, RealtimeWsStatusPayload,
    SyntheticFriendEventOutcome,
};
pub use social_baseline::{
    apply_friend_roster_baseline_sync_outcome, build_favorites_baseline,
    build_friend_roster_baseline, build_friend_roster_baseline_deferred,
    build_synced_friend_roster_baseline, SocialBaselineDeps, SocialFavoritesBaselineInput,
    SocialFavoritesBaselineOutput, SocialFriendRosterBaselineInput,
    SocialFriendRosterBaselineOutput, SyncedFriendRosterBaseline,
};
pub use world_enrich::world_id_from_location_or_id;
