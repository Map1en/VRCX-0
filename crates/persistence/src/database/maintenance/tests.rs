use chrono::{DateTime, Utc};

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

fn insert_join_leave(
    db: &DatabaseService,
    created_at: &str,
    event_type: &str,
    display_name: &str,
    location: &str,
    user_id: &str,
    time: i64,
) {
    db.execute_non_query(
        "INSERT INTO gamelog_join_leave (created_at, type, display_name, location, user_id, time)
         VALUES (@created_at, @type, @name, @location, @user_id, @time)",
        &ParamsBuilder::new()
            .set("created_at", created_at)
            .set("type", event_type)
            .set("name", display_name)
            .set("location", location)
            .set("user_id", user_id)
            .set("time", time)
            .build(),
    )
    .unwrap();
}

fn leave_time(db: &DatabaseService, user_id: &str) -> i64 {
    db.execute(
        "SELECT time FROM gamelog_join_leave WHERE user_id = @user_id AND type = 'OnPlayerLeft'",
        &ParamsBuilder::new().set("user_id", user_id).build(),
    )
    .unwrap()
    .first()
    .map(|row| row_i64(row, 0))
    .unwrap()
}

fn cleanup_test_db(name: &str) -> Result<(TestDir, DatabaseService), Error> {
    let dir = TestDir::new(name);
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    Ok((dir, db))
}

#[test]
fn avatar_auto_cleanup_disables_off_and_invalid_retention() -> Result<(), Error> {
    let (_dir, db) = cleanup_test_db("avatar-cleanup-disabled")?;
    let now = DateTime::parse_from_rfc3339("2026-07-17T12:00:00Z")
        .unwrap()
        .with_timezone(&Utc);

    let off = avatar_auto_cleanup_run(&db, "usr_self", now)?;
    assert_eq!(off.state, AvatarAutoCleanupState::Disabled);

    crate::config::set_string(&db, "VRCX_avatarAutoCleanup", "invalid")?;
    let invalid = avatar_auto_cleanup_run(&db, "usr_self", now)?;
    assert_eq!(invalid.state, AvatarAutoCleanupState::Disabled);
    Ok(())
}

#[test]
fn avatar_auto_cleanup_skips_when_last_run_is_less_than_seven_days_old() -> Result<(), Error> {
    let (_dir, db) = cleanup_test_db("avatar-cleanup-not-due")?;
    crate::config::set_string(&db, "VRCX_avatarAutoCleanup", "30")?;
    crate::config::set_string(
        &db,
        "lastAvatarCleanupDate_usr_self",
        "2026-07-12T12:00:00Z",
    )?;
    let now = DateTime::parse_from_rfc3339("2026-07-17T12:00:00Z")
        .unwrap()
        .with_timezone(&Utc);

    let outcome = avatar_auto_cleanup_run(&db, "usr_self", now)?;

    assert_eq!(outcome.state, AvatarAutoCleanupState::NotDue);
    assert_eq!(outcome.retention_days, Some(30));
    Ok(())
}

#[test]
fn avatar_auto_cleanup_treats_invalid_last_date_as_due_and_commits_delete_with_flag(
) -> Result<(), Error> {
    let (_dir, db) = cleanup_test_db("avatar-cleanup-runs")?;
    crate::config::set_string(&db, "VRCX_avatarAutoCleanup", "30")?;
    crate::config::set_string(&db, "lastAvatarCleanupDate_usr_self", "not-a-date")?;
    let prefix = normalize_user_table_prefix("usr_self")?;
    ensure_realtime_tables(&db, &prefix)?;
    db.execute_non_query(
        &format!("INSERT INTO {prefix}_feed_avatar (created_at) VALUES (@created_at)"),
        &ParamsBuilder::new()
            .set("created_at", "2026-05-01T00:00:00Z")
            .build(),
    )?;
    let now = DateTime::parse_from_rfc3339("2026-07-17T12:00:00Z")
        .unwrap()
        .with_timezone(&Utc);

    let outcome = avatar_auto_cleanup_run(&db, "usr_self", now)?;

    assert_eq!(outcome.state, AvatarAutoCleanupState::Ran);
    assert_eq!(outcome.removed_count, 1);
    assert_eq!(
        crate::config::get_string(&db, "lastAvatarCleanupDate_usr_self", "")?,
        "2026-07-17T12:00:00.000Z"
    );
    Ok(())
}

#[test]
fn avatar_auto_cleanup_rolls_back_delete_when_completion_flag_fails() -> Result<(), Error> {
    let (_dir, db) = cleanup_test_db("avatar-cleanup-rolls-back")?;
    crate::config::set_string(&db, "VRCX_avatarAutoCleanup", "30")?;
    crate::config::set_string(&db, "lastAvatarCleanupDate_usr_self", "not-a-date")?;
    let prefix = normalize_user_table_prefix("usr_self")?;
    ensure_realtime_tables(&db, &prefix)?;
    db.execute_non_query(
        &format!("INSERT INTO {prefix}_feed_avatar (created_at) VALUES (@created_at)"),
        &ParamsBuilder::new()
            .set("created_at", "2026-05-01T00:00:00Z")
            .build(),
    )?;
    db.execute_non_query(
        "CREATE TRIGGER fail_avatar_cleanup_flag BEFORE UPDATE ON configs
         BEGIN SELECT RAISE(ABORT, 'forced completion flag failure'); END",
        &Default::default(),
    )?;
    let now = DateTime::parse_from_rfc3339("2026-07-17T12:00:00Z")
        .unwrap()
        .with_timezone(&Utc);

    assert!(avatar_auto_cleanup_run(&db, "usr_self", now).is_err());
    let remaining = db.execute(
        &format!("SELECT COUNT(*) FROM {prefix}_feed_avatar"),
        &Default::default(),
    )?;
    assert_eq!(remaining.first().map(|row| row_i64(row, 0)), Some(1));
    Ok(())
}

#[test]
fn repair_zero_copresence_durations_pairs_leave_with_join() -> Result<(), Error> {
    let dir = TestDir::new("gamelog-repair-durations");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    ensure_game_log_tables(&db)?;

    // Alice: real 40-minute session whose leave was written as time=0.
    insert_join_leave(
        &db,
        "2026-06-30T16:00:10.000Z",
        "OnPlayerJoined",
        "Alice",
        "wrld_x:1",
        "usr_alice",
        0,
    );
    insert_join_leave(
        &db,
        "2026-06-30T16:40:10.000Z",
        "OnPlayerLeft",
        "Alice",
        "wrld_x:1",
        "usr_alice",
        0,
    );
    // Bob: leave with no matching join stays 0.
    insert_join_leave(
        &db,
        "2026-06-30T16:40:10.000Z",
        "OnPlayerLeft",
        "Bob",
        "wrld_x:1",
        "usr_bob",
        0,
    );
    // Carol: a 'traveling' leave carries no world, so it is not repaired.
    insert_join_leave(
        &db,
        "2026-06-30T16:05:00.000Z",
        "OnPlayerJoined",
        "Carol",
        "wrld_x:1",
        "usr_carol",
        0,
    );
    insert_join_leave(
        &db,
        "2026-06-30T16:20:00.000Z",
        "OnPlayerLeft",
        "Carol",
        "traveling",
        "usr_carol",
        0,
    );

    database_maintenance_run(&db, DatabaseMaintenanceTask::RepairZeroCopresenceDurations)?;

    assert_eq!(leave_time(&db, "usr_alice"), 2_400_000);
    assert_eq!(leave_time(&db, "usr_bob"), 0);
    assert_eq!(leave_time(&db, "usr_carol"), 0);
    Ok(())
}

#[test]
fn fix_broken_game_log_display_names_skips_unique_key_collisions() -> Result<(), Error> {
    let dir = TestDir::new("gamelog-display-name-collision");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    ensure_game_log_tables(&db)?;

    insert_join_leave(
        &db,
        "2026-07-03T12:00:00.000Z",
        "OnPlayerJoined",
        "Alice (usr_a)",
        "wrld_x:1",
        "usr_a",
        0,
    );
    insert_join_leave(
        &db,
        "2026-07-03T12:00:00.000Z",
        "OnPlayerJoined",
        "Alice (usr_b)",
        "wrld_x:1",
        "usr_b",
        0,
    );

    database_maintenance_run(&db, DatabaseMaintenanceTask::FixBrokenGameLogDisplayNames)?;

    let rows = db.execute(
        "SELECT display_name FROM gamelog_join_leave ORDER BY id",
        &Default::default(),
    )?;

    assert_eq!(rows.len(), 2);
    assert_eq!(row_string(&rows[0], 0), "Alice");
    assert_eq!(row_string(&rows[1], 0), "Alice (usr_b)");
    Ok(())
}
