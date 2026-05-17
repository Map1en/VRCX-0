//! Pure VRCX-0 backend models, normalized events, parsers, and state calculations.
//!
//! This crate must not depend on Tauri, SQLite, HTTP transports, or host runtime
//! services. Modules such as `friends`, `game_log`, and `realtime` should expose
//! data shapes and deterministic transformations only.

pub mod friends;
pub mod game_process;
pub mod ipc;
pub mod json;
pub mod log_watcher;
pub mod realtime;
pub mod screenshots;
