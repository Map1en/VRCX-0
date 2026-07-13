pub mod activity;
pub mod assistant;
pub mod avatars;
pub mod cache_entities;
pub(crate) mod common;
pub mod config;
pub mod cookies;
mod database;
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
pub mod social_aggregates;
pub mod storage;
pub mod worlds;

pub mod maintenance {
    pub use crate::database::maintenance::{
        database_maintenance_broken_game_log_display_names_get,
        database_maintenance_broken_leave_entries_get,
        database_maintenance_max_friend_log_number_get, database_maintenance_run,
        database_maintenance_table_sizes_get, user_tables_ensure, BrokenGameLogDisplayNameOutput,
        DatabaseMaintenanceTask, MaintenanceTableSizesOutput, UserTableContextOutput,
    };
}

pub use database::{
    optimize_database, DatabaseBackupProgress, DatabaseService, DatabaseUpgradeStatus,
};
pub use error::Error;

pub type Result<T> = std::result::Result<T, Error>;
