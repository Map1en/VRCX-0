pub mod activity;
pub mod activity_page;
pub mod assistant;
pub mod avatars;
pub mod browse_history;
pub mod cache_entities;
pub(crate) mod common;
pub mod config;
pub mod cookies;
pub mod data_dir_migration;
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
pub mod migration;
pub mod migrations;
pub mod mutual_graph;
pub mod notifications;
pub(crate) mod ownership;
pub mod player_list;
pub mod profile_backup;
pub mod realtime;
pub mod saved_group_favorites;
pub mod screenshot_cache;
pub mod secrets;
pub mod social_aggregates;
pub mod storage;
pub mod worlds;

pub mod maintenance {
    pub use crate::database::maintenance::{
        avatar_auto_cleanup_run, database_maintenance_broken_game_log_display_names_get,
        database_maintenance_broken_leave_entries_get,
        database_maintenance_max_friend_log_number_get, database_maintenance_run,
        database_maintenance_table_sizes_get, database_vacuum_if_fragmented,
        ensure_required_database_schema, user_tables_ensure, vacuum_after_secret_migration,
        BrokenGameLogDisplayNameOutput, DatabaseMaintenanceTask, MaintenanceTableSizesOutput,
        UserTableContextOutput,
    };
}

pub use database::schema::{
    prepare_vrcx0_schema_version, write_database_schema_versions, VRCX0_SCHEMA_VERSION,
    VRCX0_SCHEMA_VERSION_KEY,
};
pub use database::{
    database_scale_estimate, optimize_database, DatabaseScaleEstimate, DatabaseService,
    DatabaseUpgradeStatus, FrozenDatabase, WalCheckpointResult,
};
pub use error::{Error, SqliteErrorCategory};

pub type Result<T> = std::result::Result<T, Error>;
