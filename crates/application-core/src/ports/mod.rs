mod activity_sink;
mod instance_roster;
mod local_game_context;
mod notification_observer;
mod print_cleanup;
mod process_monitor;
mod session;
mod updater;

pub use activity_sink::OverlayActivityInputSink;
pub use instance_roster::{InstanceRosterMember, InstanceRosterObserver, InstanceRosterSnapshot};
pub use local_game_context::{
    LocalGameContextSnapshot, LocalGameContextSource, UnavailableLocalGameContextSource,
};
pub use notification_observer::{
    RealtimeNotificationProjectionObserver, RealtimeNotificationProjectionObserverRegistry,
};
pub use print_cleanup::{NoopPrintCleanupInputSink, PrintCleanupInputSink, PrintCleanupTrigger};
pub use process_monitor::{GameProcessEvent, GameProcessEventSink};
pub use session::{
    BackgroundCapabilitySession, BackgroundCapabilitySessionIdentity, CurrentUserSnapshot,
    GameProcessStatus as HostSessionGameProcessStatus, HostRealtimeSessionContext,
    HostSessionProjection, HostSessionRuntime, SessionHostRuntime,
};
pub use updater::{
    NoopUpdaterPort, UpdaterCheckRequest, UpdaterDownloadOutcome, UpdaterDownloadProgress,
    UpdaterInstallHandle, UpdaterMetadata, UpdaterPort, UpdaterProgressCallback,
};

pub use crate::event_bus::{RuntimeEventBus, RuntimeEventSink};
pub use crate::task_supervisor::{
    RuntimeTask, RuntimeTaskExecutor, RuntimeTaskHandle, TaskSpawnOutcome, TaskStopReport,
    TaskStopToken, TaskSupervisor,
};
