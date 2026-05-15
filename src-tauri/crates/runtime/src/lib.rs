//! Host app runtime orchestration.
//!
//! This crate owns long-running business workflows such as GameLog and future
//! realtime/friends ingestion. It must not depend on Tauri types directly; shell
//! integration should flow through small traits such as event sinks, host
//! actions, and clocks.

pub mod game_log;
pub mod session;
pub mod shell;
