//! Local durable data and schema-facing database operations.
//!
//! This crate should expose domain-oriented read/write APIs. It must not emit UI
//! events, call Tauri APIs, or own long-running runtime workflows.

pub mod activity;
pub mod avatars;
pub mod cache_entities;
pub mod common;
pub mod config;
pub mod cookies;
pub mod database;
mod domain_support;
mod error;
pub mod favorites;
pub mod feed;
pub mod friends;
pub mod game_log;
pub mod legacy_migration;
pub mod legacy_vrcx;
pub mod local_moderation;
pub mod memos;
pub mod mutual_graph;
pub mod notifications;
pub mod player_list;
pub mod realtime;
pub mod screenshot_cache;
pub mod storage;
pub mod worlds;

pub use error::Error;

pub type Result<T> = std::result::Result<T, Error>;
