mod activity_sink;
mod local_game_context;
mod print_cleanup;
mod process_monitor;
mod session;
mod updater;

pub use activity_sink::OverlayActivityInputSink;
pub use local_game_context::{
    LocalGameContextSnapshot, LocalGameContextSource, UnavailableLocalGameContextSource,
};
pub use print_cleanup::{NoopPrintCleanupInputSink, PrintCleanupInputSink, PrintCleanupTrigger};
pub use process_monitor::{GameProcessEvent, GameProcessEventSink};
pub use session::{
    BackgroundCapabilitySession, GameProcessStatus as HostSessionGameProcessStatus,
    HostSessionProjection, HostSessionRuntime,
    RealtimeSessionContext as HostRealtimeSessionContext, SessionHostRuntime,
};
pub use updater::{
    NoopUpdaterPort, UpdaterCheckRequest, UpdaterDownloadOutcome, UpdaterDownloadProgress,
    UpdaterInstallHandle, UpdaterMetadata, UpdaterPort, UpdaterProgressCallback,
};

pub use crate::event_bus::{RuntimeEventBus, RuntimeEventSink};
pub use crate::task_supervisor::{
    RuntimeTask, RuntimeTaskExecutor, RuntimeTaskHandle, TaskStopToken, TaskSupervisor,
};
