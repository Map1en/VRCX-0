mod instance_dwell;
mod notification_observer;
mod ports;
mod realtime;
mod social_baseline;
#[cfg(any(test, feature = "test-utils"))]
mod test_store;

mod world_enrich;

#[cfg(any(test, feature = "test-utils"))]
pub mod test_support {
    pub use crate::realtime::service::test_support::{
        feed_lookup_input, runtime_with_active_session, seed_friend_baseline, TestDir,
        TestRealtimeHostRuntime,
    };
}

pub use instance_dwell::{
    FriendLocationTime, FriendLocationTimeSource, FriendPlace, InstanceDwellRegistry,
};
pub use notification_observer::{
    RealtimeNotificationProjectionObserver, RealtimeNotificationProjectionObserverRegistry,
};
pub use ports::{
    FavoriteBaselineStore, FeedQueryStore, FriendLogStore, GameLogLookup, RealtimeBatchWriter,
    RealtimeRemoteRequests, RealtimeStores, SocialMutationStore,
};
pub use realtime::replay::{replay_logger_frames, ReplayOutcome, ReplayResolvers};
pub use realtime::PENDING_OFFLINE_DELAY_MS;
pub use realtime::{
    is_print_created_content_refresh, FriendProfileBulkLoadStatus, FriendProfileLoadStatusPayload,
    FriendProjection, FriendProjectionObserver, FriendProjectionPatch, FriendProjectionSink,
    FriendRosterSnapshot, RealtimeCurrentUserProjection, RealtimeCurrentUserSnapshotSink,
    RealtimeEconomyBalancePayload, RealtimeEntryCorrection, RealtimeEntryCorrectionFields,
    RealtimeEntryCorrectionStream, RealtimeFeedProjection, RealtimeFriendRosterSnapshot,
    RealtimeFriendSnapshot, RealtimeHostRuntime, RealtimeHostRuntimeDeps,
    RealtimeInstanceClosedProjection, RealtimeInstanceQueueKind, RealtimeInstanceQueueProjection,
    RealtimeMessageSink, RealtimeNotificationProjection, RealtimeNotificationUpsert,
    RealtimeSessionContext, RealtimeStopRequest, RealtimeTransport, RealtimeTransportFuture,
    RealtimeTransportLifecycleEvent, RealtimeTransportStartResult, RealtimeTransportTermination,
    RealtimeUserProjection, RealtimeWsMessagePayload, RealtimeWsStatus, RealtimeWsStatusPayload,
    SyntheticFriendEventOutcome, UserQueryCachePolicy, UserQueryKind, UserQueryOptions,
};
pub use realtime::{normalize_v1_notification, normalize_v2_notification};
pub use social_baseline::{
    build_favorites_baseline, build_favorites_baseline_from_friend_ids,
    build_synced_friend_roster_baseline, FavoriteBaselineSnapshot, SocialBaselineDeps,
    SocialFavoritesBaselineInput, SocialFavoritesBaselineOutput, SocialFavoritesBaselineRequest,
    SocialFriendRosterBaselineInput, SocialFriendRosterBaselineOutput,
};
