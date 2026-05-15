//! Pure domain models, normalized events, parsers, and state calculations.
//!
//! This crate must not depend on Tauri, SQLite, HTTP transports, or host runtime
//! services. Future modules such as `friends`, `presence`, and `realtime` should
//! expose data shapes and deterministic transformations only.

pub mod log_watcher;
pub mod friends;
pub mod realtime;
