//! Local durable data and schema-facing database operations.
//!
//! This crate should expose domain-oriented read/write APIs. It must not emit UI
//! events, call Tauri APIs, or own long-running runtime workflows.

pub mod common;
pub mod config;
pub mod database;
mod error;
pub mod game_log;
pub mod legacy_migration;
pub mod legacy_vrcx;
pub mod realtime;
pub mod screenshot_cache;
pub mod storage;

pub use error::Error;

pub type Result<T> = std::result::Result<T, Error>;
