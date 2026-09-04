mod async_runtime_policy;
mod auth_scope;
mod avatar_cache;
mod backend_runtime;
mod background;
mod config;
#[cfg(any(test, feature = "test-utils"))]
mod contract_test_support;
mod diagnostics;
mod error;
mod event_bus;
pub mod events;
mod favorite_kind;
mod image_cache;
mod instance_dwell;
mod interruptible_sleep;
pub mod ports;
mod proxy;
mod remote_mutation_gate;
mod runtime_lifecycle;
mod runtime_output;
mod runtime_status;
#[cfg(test)]
mod session;
mod sync;
mod task_supervisor;
pub mod vrchat_api;
mod web_client;
mod world_cache;

pub use async_runtime_policy::{
    recommended_tokio_max_blocking_threads, recommended_tokio_max_blocking_threads_for,
    recommended_tokio_worker_threads, recommended_tokio_worker_threads_for,
};
pub use auth_scope::{
    RuntimeAuthIdentity, RuntimeAuthScope, RuntimeAuthScopeObserver, RuntimeAuthScopeSnapshot,
};
pub use avatar_cache::{AvatarCache, AvatarCachePort};
pub use backend_runtime::{
    BackendRuntime, BackendRuntimeAuthStatus, BackendRuntimeGameLogStatus, BackendRuntimeMode,
    BackendRuntimePhase, BackendRuntimeProcessStatus, BackendRuntimeSnapshot,
    BackendRuntimeStatusPublisher, BackendRuntimeTelemetry, BackendRuntimeTelemetryKind,
    GuiRuntimeMode, RealtimeProjectionSync, RuntimeHostProfile,
};
pub use background::{
    sleep_until_due_or_stopped, DatabaseCheckpointKind, DatabaseCheckpointResult,
    DatabaseMaintenancePort, RuntimeBackgroundJobSnapshot, RuntimeBackgroundJobs,
};
pub use config::{config_string_array_value, normalize_config_string_array};
#[cfg(any(test, feature = "test-utils"))]
pub use contract_test_support::{
    assert_json_contract, BehaviorLockFacet, CallRecorder, MemoryCookieWebClientPort,
    MemoryWorldCachePort, NoopImageCachePort, NoopWebClientPort, NoopWorldCachePort,
    ScriptedResults, BEHAVIOR_LOCK_CHECKLIST,
};
pub use diagnostics::RuntimeDiagnostics;
pub use error::Error;
#[cfg(any(test, feature = "test-utils"))]
pub use event_bus::RuntimeEventForTest;
pub use event_bus::{
    FavoriteChange, FavoritesChangedPayload, RuntimeEventBus, RuntimeEventSink,
    RuntimeRealtimeTransportEpoch, RuntimeVrchatAuthFailurePayload, VrcStatusSnapshot,
};
pub use events::{
    FeedLiveEntry, FriendProfileBulkLoadStatus, FriendProfileLoadStatusPayload, FriendProjection,
    FriendProjectionPatch, FriendStateBucketAuthority, PrintAutoCleanupEvent,
    RealtimeCurrentUserProjection, RealtimeEntryCorrection, RealtimeEntryCorrectionFields,
    RealtimeEntryCorrectionStream, RealtimeInstanceClosedProjection, RealtimeInstanceQueueKind,
    RealtimeInstanceQueueProjection, RealtimeNotificationProjection, RealtimeNotificationUpsert,
    RealtimeUserProjection,
};
pub use favorite_kind::{FavoriteChangeScope, FavoriteEntityKind, VrchatFavoriteType};
pub use image_cache::{save_ugc_image_to_file, ImageCache, ImageCachePort};
pub use instance_dwell::{FriendLocationTime, FriendLocationTimeSource, InstanceDwellRegistry};
pub use interruptible_sleep::sleep_interruptibly;
pub use ports::{
    BackgroundCapabilitySession, BackgroundCapabilitySessionIdentity, CurrentUserSnapshot,
    GameProcessEvent, GameProcessEventSink, HostRealtimeSessionContext,
    HostSessionGameProcessStatus, HostSessionProjection, HostSessionRuntime, InstanceRosterMember,
    InstanceRosterObserver, InstanceRosterSnapshot, LocalGameContextSnapshot,
    LocalGameContextSource, NoopPrintCleanupInputSink, NoopUpdaterPort, OverlayActivityInputSink,
    PrintCleanupInputSink, PrintCleanupTrigger, RealtimeNotificationProjectionObserver,
    RealtimeNotificationProjectionObserverRegistry, SessionHostRuntime,
    UnavailableLocalGameContextSource, UpdaterCheckRequest, UpdaterDownloadOutcome,
    UpdaterDownloadProgress, UpdaterInstallHandle, UpdaterMetadata, UpdaterPort,
    UpdaterProgressCallback,
};
pub use proxy::{
    load_proxy_url, test_proxy_connectivity, ProxyConnectivityPort, ProxySettingsTestResult,
    PROXY_ENABLED_STORAGE_KEY, PROXY_STORAGE_KEY,
};
pub use remote_mutation_gate::{
    is_remote_mutation_request, AuthenticatedMutationContext, RemoteMutationGate,
};
pub use runtime_lifecycle::{RuntimeLifecycle, RuntimeLifecycleSnapshot};
pub use runtime_output::{
    format_runtime_output_event, RuntimeOutputLevel, RuntimeOutputLine, RuntimeOutputMode,
};
pub use runtime_status::RuntimeOperationStatus;
pub use sync::{RuntimeSyncEngine, RuntimeSyncSnapshot};
pub use task_supervisor::{
    RuntimeTask, RuntimeTaskExecutor, RuntimeTaskHandle, TaskSpawnOutcome, TaskStopReport,
    TaskStopToken, TaskSupervisor,
};
pub use vrcx_0_contracts::{runtime_event_payload, RuntimeEventPayload};
pub use vrcx_0_contracts::{
    RealtimeAuthTokenFetch, RealtimeConnectionOptions, WebExecuteRequest, WebUploadMode,
};
pub use vrcx_0_core::FavoriteGroupVisibility;
pub use web_client::{WebClient, WebClientPort};
pub use world_cache::{WorldCache, WorldCachePort};

pub use vrcx_0_contracts::UgcCategory;
pub use vrcx_0_core::location::ParsedLocation;

pub type Result<T> = std::result::Result<T, Error>;
