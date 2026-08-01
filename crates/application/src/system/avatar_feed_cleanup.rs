use serde::{Deserialize, Serialize};
use vrcx_0_persistence::feed::feed_avatar_purge;
use vrcx_0_persistence::maintenance::{database_maintenance_run, DatabaseMaintenanceTask};
use vrcx_0_persistence::DatabaseService;

use crate::Result;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum AvatarFeedCleanupStatus {
    Completed,
    OptimizationFailed,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AvatarFeedCleanupOutcome {
    pub deleted_rows: i64,
    pub status: AvatarFeedCleanupStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub optimization_error: Option<String>,
}

pub fn cleanup_avatar_feed_history(
    db: &DatabaseService,
    user_id: String,
    cutoff_date: Option<String>,
) -> Result<AvatarFeedCleanupOutcome> {
    let deleted_rows = feed_avatar_purge(db, user_id, cutoff_date)?;
    let optimization_error = database_maintenance_run(db, DatabaseMaintenanceTask::Vacuum)
        .err()
        .map(|error| error.to_string());
    Ok(cleanup_outcome(deleted_rows, optimization_error))
}

fn cleanup_outcome(
    deleted_rows: i64,
    optimization_error: Option<String>,
) -> AvatarFeedCleanupOutcome {
    AvatarFeedCleanupOutcome {
        deleted_rows,
        status: if optimization_error.is_some() {
            AvatarFeedCleanupStatus::OptimizationFailed
        } else {
            AvatarFeedCleanupStatus::Completed
        },
        optimization_error,
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            let suffix = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "vrcx-0-avatar-feed-cleanup-{}-{suffix}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn cleanup_owns_purge_and_database_optimization() {
        let dir = TestDir::new();
        let db = DatabaseService::new(&dir.0.join("VRCX-0.sqlite3")).unwrap();

        let outcome = cleanup_avatar_feed_history(&db, "usr_test".into(), None).unwrap();

        assert_eq!(outcome.deleted_rows, 0);
        assert_eq!(outcome.status, AvatarFeedCleanupStatus::Completed);
        assert_eq!(outcome.optimization_error, None);
    }

    #[test]
    fn optimization_failure_is_reported_as_a_partial_outcome() {
        let outcome = cleanup_outcome(12, Some("vacuum failed".into()));

        assert_eq!(outcome.deleted_rows, 12);
        assert_eq!(outcome.status, AvatarFeedCleanupStatus::OptimizationFailed);
        assert_eq!(outcome.optimization_error.as_deref(), Some("vacuum failed"));
    }
}
