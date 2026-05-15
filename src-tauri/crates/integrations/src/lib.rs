//! External service transports and DTO adapters.
//!
//! This crate owns VRChat HTTP and websocket transport code over time. It may
//! depend on `domain` for normalized data shapes, but it must not write SQLite
//! rows or emit frontend UI events.

pub mod realtime;
