use crate::common::ParamsBuilder;
use crate::game_log::ensure_game_log_tables;
use crate::realtime::ensure_realtime_tables;

use super::*;

struct TestDir {
    path: std::path::PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("vrcx-0-{name}-{}-{nonce}", std::process::id()));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn insert_gps_rows(db: &DatabaseService, user_prefix: &str, count: usize) {
    for index in 0..count {
        db.execute_non_query(
            &format!(
                "INSERT INTO {user_prefix}_feed_gps (created_at, user_id, display_name, location) \
                 VALUES (@created_at, @user_id, @display_name, @location)"
            ),
            &ParamsBuilder::new()
                .set("created_at", format!("2026-08-29T00:00:{:02}Z", index % 60))
                .set("user_id", format!("usr_{index}"))
                .set("display_name", format!("friend {index}"))
                .set("location", "wrld_test:1")
                .build(),
        )
        .unwrap();
    }
}

#[test]
fn scale_estimate_reports_no_rows_until_the_database_is_analyzed() -> Result<(), Error> {
    let dir = TestDir::new("scale-unanalyzed");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    ensure_game_log_tables(&db)?;
    ensure_realtime_tables(&db, "usrtest")?;
    insert_gps_rows(&db, "usrtest", 3);

    let estimate = database_scale_estimate(&db)?;

    assert!(estimate.db_bytes > 0);
    assert_eq!(estimate.feed_rows, None);
    assert_eq!(estimate.gamelog_rows, None);
    assert_eq!(estimate.friend_log_rows, None);
    Ok(())
}

#[test]
fn scale_estimate_sums_feed_tables_of_the_largest_account() -> Result<(), Error> {
    let dir = TestDir::new("scale-analyzed");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    ensure_game_log_tables(&db)?;
    ensure_realtime_tables(&db, "usrsmall")?;
    ensure_realtime_tables(&db, "usrlarge")?;
    insert_gps_rows(&db, "usrsmall", 2);
    insert_gps_rows(&db, "usrlarge", 7);
    db.execute_non_query("ANALYZE", &Default::default())?;

    let estimate = database_scale_estimate(&db)?;

    assert_eq!(estimate.feed_rows, Some(7));
    Ok(())
}
