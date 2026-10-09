pub mod maintenance;
mod online_backup;
mod remote;
mod remote_server;
mod scale;
pub(crate) mod schema;
mod service;
mod sidecar;
mod value;

pub(crate) use online_backup::backup_connection_to_path;
pub use remote::RemoteConnectionStatus;
pub use remote_server::{DatabaseRpcRequest, DatabaseRpcResponse};
pub use scale::{database_scale_estimate, DatabaseScaleEstimate};
pub(crate) use service::DatabaseWriteTransaction;
pub use service::{
    optimize_database, DatabaseService, DatabaseUpgradeStatus, FrozenDatabase, WalCheckpointResult,
};
pub(crate) use sidecar::remove_sidecars;
