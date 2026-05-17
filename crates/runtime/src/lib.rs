//! Host app runtime orchestration.
//!
//! This crate owns long-running business workflows such as GameLog and future
//! realtime/friends ingestion. It must not depend on Tauri types directly; shell
//! integration should flow through small traits such as event sinks, host
//! actions, and clocks.

mod error;
pub mod game_log;
pub mod image_cache;
pub mod proxy;
pub mod realtime;
pub mod screenshots;
pub mod session;
pub mod shell;
pub mod web_client;

pub use error::Error;

pub type Result<T> = std::result::Result<T, Error>;
