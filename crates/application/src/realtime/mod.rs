pub(crate) mod connection;
pub(crate) mod current_user;
pub(crate) mod friends;
pub(crate) mod instance_queue;
pub(crate) mod invite_automation;
pub(crate) mod notifications;
mod output;
mod projection;
mod runtime_types;
pub(crate) mod service;
pub(crate) mod user_cache;
pub(crate) mod user_query_cache;
mod ws_event_log;

pub use friends::{is_friend_event_type, RealtimeFriendsRuntime};
pub use output::{
    RealtimeCurrentUserOutput, RealtimeFriendOutput, RealtimeInstanceClosedOutput,
    RealtimeNotificationOutput,
};
pub use projection::{
    FriendProjection, FriendProjectionPatch, RealtimeCurrentUserProjection,
    RealtimeEntryCorrection, RealtimeEntryCorrectionFields, RealtimeEntryCorrectionStream,
    RealtimeInstanceClosedProjection, RealtimeInstanceQueueProjection,
    RealtimeNotificationProjection, RealtimeNotificationUpsert, RealtimeProjectionSource,
};
pub use runtime_types::{
    FriendBaselineCausalWatermark, FriendBaselineResult, FriendBaselineSyncOutcome,
    PendingOfflineTimerAction, RealtimeCurrentUserAuthority, RealtimeFriendApplyResult,
    RealtimeFriendSnapshot, RealtimeSessionContext, RealtimeTransportStartResult,
    RealtimeWsMessagePayload, RealtimeWsStatusPayload,
};
pub use service::{
    FriendProfileBulkLoadStatus, FriendProfileLoadStatusPayload, RealtimeHostRuntime,
    RealtimeHostRuntimeDeps, RealtimeStopRequest, SyntheticFriendEventOutcome,
};
