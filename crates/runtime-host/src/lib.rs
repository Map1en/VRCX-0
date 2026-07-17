mod authenticated_runtime;
mod context;
mod error;
mod event_sink;
mod game_client;
mod game_log;
mod host_actions;
mod host_file_access;
mod log_watcher;
mod note_export;
pub mod notification;
mod process_monitor;
mod registry_backup;
mod shared_collection_import;
mod state;
pub mod telemetry;
pub mod vr_overlay;

pub use authenticated_runtime::AuthenticatedRuntimeOrchestrator;
pub use context::RuntimeHostContext;
pub use error::{Error, Result};
pub use event_sink::RuntimeHostEventSink;
pub use game_client::GameClientHostRuntime;
pub use game_log::GameLogHostRuntime;
pub use host_actions::{RuntimeHost, RuntimeHostActions};
pub use host_file_access::{ensure_vrchat_launch_path_allowed, is_known_root_path, HostFileAccess};
pub use log_watcher::{
    GameLogEvent, GameLogEventSink, HostGameLogEventFanout, HostLogLocationSnapshotScanner,
    LogLocationSnapshot, LogWatcher,
};
pub use note_export::NoteExportRuntime;
pub use process_monitor::HostGameProcessMonitorActions;
pub use registry_backup::HostRegistryBackupActions;
pub use shared_collection_import::SharedCollectionImportRuntime;
pub use state::{
    BackendRuntimeFrontendSessionSnapshot, CliLoginPrompt, CliTwoFactorChoice, RuntimeHostOptions,
    RuntimeHostState,
};
