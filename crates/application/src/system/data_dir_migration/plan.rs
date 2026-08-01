use vrcx_0_persistence::data_dir_migration::{
    DataDirMigrationTargetState, DATA_DIR_MIGRATION_SPACE_MARGIN_BYTES,
};

use super::DataDirMigrationPlan;
use crate::{Error, Result};

pub fn build_data_dir_migration_plan(
    target_path: String,
    source_bytes: u64,
    available_bytes: u64,
    target_state: DataDirMigrationTargetState,
) -> Result<DataDirMigrationPlan> {
    let required_bytes = source_bytes
        .checked_add(DATA_DIR_MIGRATION_SPACE_MARGIN_BYTES)
        .ok_or_else(|| Error::Custom("Data directory migration size overflowed.".into()))?;
    Ok(DataDirMigrationPlan {
        target_path,
        required_bytes,
        available_bytes,
        target_state,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_adds_the_application_space_margin() {
        let plan = build_data_dir_migration_plan(
            "target".into(),
            42,
            100,
            DataDirMigrationTargetState::Empty,
        )
        .unwrap();

        assert_eq!(
            plan.required_bytes,
            42 + DATA_DIR_MIGRATION_SPACE_MARGIN_BYTES
        );
    }

    #[test]
    fn plan_rejects_size_overflow() {
        assert!(build_data_dir_migration_plan(
            "target".into(),
            u64::MAX,
            u64::MAX,
            DataDirMigrationTargetState::Empty,
        )
        .is_err());
    }
}
