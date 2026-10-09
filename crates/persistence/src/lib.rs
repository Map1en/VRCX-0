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
pub mod files;
pub mod friends;
pub mod game_log;
pub mod legacy_migration;
pub mod legacy_remote_import;
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
pub mod profile_bio;
pub mod realtime;
pub mod saved_group_favorites;
pub mod screenshot_cache;
pub mod secrets;
pub mod social_aggregates;
pub mod storage;
pub mod worlds;

pub mod maintenance {
    pub use crate::database::maintenance::{
        avatar_auto_cleanup_run, database_maintenance_run, database_maintenance_table_sizes_get,
        database_vacuum_if_fragmented, ensure_required_database_schema, user_tables_ensure,
        vacuum_after_secret_migration, DatabaseMaintenanceTask, MaintenanceTableSizesOutput,
        UserTableContextOutput, PRINT_FAVORITE_IDS_CONFIG_KEY,
    };
}

pub use database::schema::{
    read_upstream_schema_version, read_vrcx0_schema_version, write_upstream_schema_version,
    write_vrcx0_schema_version, VRCX0_SCHEMA_VERSION, VRCX0_SCHEMA_VERSION_KEY,
};
pub use database::{
    database_scale_estimate, optimize_database, DatabaseRpcRequest, DatabaseRpcResponse,
    DatabaseScaleEstimate, DatabaseService, DatabaseUpgradeStatus, FrozenDatabase,
    RemoteConnectionStatus, WalCheckpointResult,
};
pub use error::{Error, SqliteErrorCategory};
pub use legacy_remote_import::{merge_remote_legacy, RemoteLegacyImportCounts};

pub type Result<T> = std::result::Result<T, Error>;
