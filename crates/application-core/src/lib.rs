mod async_runtime_policy;
mod auth_scope;
mod backend_runtime;
mod background;
mod config;
mod diagnostics;
mod error;
mod event_bus;
pub mod events;
mod image_cache;
mod interruptible_sleep;
pub mod ports;
mod proxy;
mod runtime_lifecycle;
mod runtime_output;
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
pub use auth_scope::{RuntimeAuthScope, RuntimeAuthScopeSnapshot};
pub use backend_runtime::{
    BackendRuntime, BackendRuntimeMode, BackendRuntimePhase, BackendRuntimeSnapshot,
    BackendRuntimeTelemetry,
};
pub use background::{
    sleep_until_due_or_stopped, RuntimeBackgroundJobSnapshot, RuntimeBackgroundJobs,
};
pub use config::{read_config_string_array, validate_config_writes, write_config_string_array};
pub use diagnostics::RuntimeDiagnostics;
pub use error::Error;
#[cfg(any(test, feature = "test-utils"))]
pub use event_bus::RuntimeEventForTest;
pub use event_bus::{
    FavoritesChangedPayload, RuntimeEventBus, RuntimeEventPayload, RuntimeEventSink,
    RuntimeVrchatAuthFailurePayload,
};
pub use events::{
    FriendProfileBulkLoadStatus, FriendProfileLoadStatusPayload, FriendProjection,
    FriendProjectionPatch, PrintAutoCleanupEvent, RealtimeCurrentUserProjection,
    RealtimeEntryCorrection, RealtimeEntryCorrectionFields, RealtimeEntryCorrectionStream,
    RealtimeInstanceClosedProjection, RealtimeInstanceQueueProjection,
    RealtimeNotificationProjection, RealtimeNotificationUpsert, RealtimeProjectionSource,
    RealtimeUserProjection,
};
pub use image_cache::{save_ugc_image_to_file, ImageCache};
pub use interruptible_sleep::sleep_interruptibly;
pub use ports::{
    BackgroundCapabilitySession, GameProcessEvent, GameProcessEventSink,
    HostRealtimeSessionContext, HostSessionGameProcessStatus, HostSessionProjection,
    HostSessionRuntime, LocalGameContextSnapshot, LocalGameContextSource,
    NoopPrintCleanupInputSink, NoopUpdaterPort, OverlayActivityInputSink, PrintCleanupInputSink,
    PrintCleanupTrigger, SessionHostRuntime, UnavailableLocalGameContextSource,
    UpdaterCheckRequest, UpdaterDownloadOutcome, UpdaterDownloadProgress, UpdaterInstallHandle,
    UpdaterMetadata, UpdaterPort, UpdaterProgressCallback,
};
pub use proxy::{load_proxy_url, test_proxy_connectivity, ProxySettingsTestResult};
pub use runtime_lifecycle::{RuntimeLifecycle, RuntimeLifecycleSnapshot};
pub use runtime_output::{
    format_runtime_output_event, RuntimeOutputLevel, RuntimeOutputLine, RuntimeOutputMode,
};
pub use sync::{RuntimeSyncEngine, RuntimeSyncSnapshot};
pub use task_supervisor::{
    RuntimeTask, RuntimeTaskExecutor, RuntimeTaskHandle, TaskStopToken, TaskSupervisor,
};
pub use web_client::WebClient;
pub use world_cache::WorldCache;

pub use vrcx_0_core::location::ParsedLocation;
pub use vrcx_0_media::ugc_image_files::UgcCategory;

pub type Result<T> = std::result::Result<T, Error>;
