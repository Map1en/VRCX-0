//! VRChat and remote service transports plus DTO adapters.
//!
//! This crate owns VRChat HTTP and websocket transport code. It may depend on
//! `vrcx-0-core` for normalized data shapes, but it must not write SQLite rows
//! or emit frontend UI events.

pub mod realtime;
