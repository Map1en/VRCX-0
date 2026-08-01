mod plan;
mod runtime;
mod types;

pub use plan::build_data_dir_migration_plan;
pub use runtime::{DataDirMigrationRuntime, DataDirPointerCommitter};
pub use types::{
    DataDirMigrationActionOutcome, DataDirMigrationError, DataDirMigrationErrorCode,
    DataDirMigrationMode, DataDirMigrationPhase, DataDirMigrationPlan, DataDirMigrationState,
    DataDirMigrationStatus,
};

#[cfg(test)]
mod tests;
