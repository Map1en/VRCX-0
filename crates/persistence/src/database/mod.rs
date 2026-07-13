pub mod maintenance;
pub(crate) mod schema;
mod service;
mod sidecar;
mod value;

pub(crate) use service::DatabaseWriteTransaction;
pub use service::{
    current_vrcx0_schema_version, optimize_database, validate_database_file,
    DatabaseBackupProgress, DatabaseService, DatabaseUpgradeStatus,
};
pub use sidecar::{
    remove_sidecars as remove_database_sidecars, sidecar_paths as database_sidecar_paths,
};
