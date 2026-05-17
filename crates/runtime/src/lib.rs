//! Host app runtime orchestration.
//!
//! This crate owns long-running business workflows such as GameLog and future
//! realtime/friends ingestion. It must not depend on Tauri types directly; shell
//! integration should flow through small traits such as event sinks, host
//! actions, and clocks.

pub mod auth_scope;
pub mod backend_runtime;
pub mod background;
pub mod diagnostics;
mod error;
pub mod event_bus;
pub mod game_client;
pub mod game_log;
pub mod image_cache;
pub mod log_watcher;
pub mod process_monitor;
pub mod proxy;
pub mod realtime;
pub mod screenshots;
pub mod session;
pub mod shell;
pub mod sync;
pub mod task_runtime;
pub mod web_client;
pub mod worker;

pub use error::Error;

pub type Result<T> = std::result::Result<T, Error>;
