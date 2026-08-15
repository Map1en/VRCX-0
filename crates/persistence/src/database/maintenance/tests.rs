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

fn leave_time_at(db: &DatabaseService, created_at: &str) -> i64 {
    db.execute(
        "SELECT time FROM gamelog_join_leave WHERE created_at = @created_at AND type = 'OnPlayerLeft'",
        &ParamsBuilder::new().set("created_at", created_at).build(),
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

    avatar_auto_cleanup_run(&db, "usr_self", now)?;
    assert_eq!(
        crate::config::get_string(&db, "lastAvatarCleanupDate_usr_self", "")?,
        ""
    );

    for value in ["invalid", "1", "31", "9223372036854775807"] {
        crate::config::set_string(&db, "VRCX_avatarAutoCleanup", value)?;
        avatar_auto_cleanup_run(&db, "usr_self", now)?;
        assert_eq!(
            crate::config::get_string(&db, "lastAvatarCleanupDate_usr_self", "")?,
            ""
        );
    }
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
    let prefix = normalize_user_table_prefix("usr_self")?;
    ensure_realtime_tables(&db, &prefix)?;
    db.execute_non_query(
        &format!("INSERT INTO {prefix}_feed_avatar (created_at) VALUES (@created_at)"),
        &ParamsBuilder::new()
            .set("created_at", "2026-05-01T00:00:00Z")
            .build(),
    )?;

    avatar_auto_cleanup_run(&db, "usr_self", now)?;

    let remaining = db.execute(
        &format!("SELECT COUNT(*) FROM {prefix}_feed_avatar"),
        &Default::default(),
    )?;
    assert_eq!(remaining.first().map(|row| row_i64(row, 0)), Some(1));
    assert_eq!(
        crate::config::get_string(&db, "lastAvatarCleanupDate_usr_self", "")?,
        "2026-07-12T12:00:00Z"
    );
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

    avatar_auto_cleanup_run(&db, "usr_self", now)?;

    let remaining = db.execute(
        &format!("SELECT COUNT(*) FROM {prefix}_feed_avatar"),
        &Default::default(),
    )?;
    assert_eq!(remaining.first().map(|row| row_i64(row, 0)), Some(0));
    assert_eq!(
        crate::config::get_string(&db, "lastAvatarCleanupDate_usr_self", "")?,
        "2026-07-17T12:00:00.000Z"
    );
    Ok(())
}

#[test]
fn avatar_auto_cleanup_runs_when_last_completion_is_in_the_future() -> Result<(), Error> {
    let (_dir, db) = cleanup_test_db("avatar-cleanup-future-completion")?;
    crate::config::set_string(&db, "VRCX_avatarAutoCleanup", "30")?;
    crate::config::set_string(
        &db,
        "lastAvatarCleanupDate_usr_self",
        "2027-07-17T12:00:00Z",
    )?;
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

    avatar_auto_cleanup_run(&db, "usr_self", now)?;
    assert_eq!(
        crate::config::get_string(&db, "lastAvatarCleanupDate_usr_self", "")?,
        "2026-07-17T12:00:00.000Z"
    );
    Ok(())
}

#[test]
fn avatar_cleanup_compares_mixed_timestamp_formats_by_instant() -> Result<(), Error> {
    let (_dir, db) = cleanup_test_db("avatar-cleanup-timestamps")?;
    crate::config::set_string(&db, "VRCX_avatarAutoCleanup", "30")?;
    let prefix = normalize_user_table_prefix("usr_self")?;
    ensure_realtime_tables(&db, &prefix)?;
    for (user_id, created_at) in [
        ("old", "2026-06-17T11:59:59+00:00"),
        ("old-positive-offset", "2026-06-18T01:59:59+14:00"),
        ("equal", "2026-06-17T12:00:00+00:00"),
        ("equal-positive-offset", "2026-06-18T02:00:00+14:00"),
        ("new-space", "2026-06-17 12:00:01"),
        ("invalid", "not-a-date"),
    ] {
        db.execute_non_query(
            &format!(
                "INSERT INTO {prefix}_feed_avatar (user_id, created_at) VALUES (@user_id, @created_at)"
            ),
            &ParamsBuilder::new()
                .set("user_id", user_id)
                .set("created_at", created_at)
                .build(),
        )?;
    }
    let now = DateTime::parse_from_rfc3339("2026-07-17T12:00:00Z")
        .unwrap()
        .with_timezone(&Utc);

    avatar_auto_cleanup_run(&db, "usr_self", now)?;
    let rows = db.execute(
        &format!("SELECT user_id FROM {prefix}_feed_avatar ORDER BY user_id"),
        &Default::default(),
    )?;
    let remaining_ids = rows
        .iter()
        .map(|row| row_string(row, 0))
        .collect::<Vec<_>>();
    assert_eq!(
        remaining_ids,
        vec!["equal", "equal-positive-offset", "invalid", "new-space"]
    );
    Ok(())
}

#[test]
fn avatar_cleanup_uses_the_created_at_index() -> Result<(), Error> {
    let (_dir, db) = cleanup_test_db("avatar-cleanup-query-plan")?;
    let prefix = normalize_user_table_prefix("usr_self")?;
    ensure_realtime_tables(&db, &prefix)?;

    let plan = db.execute(
        &format!(
            "EXPLAIN QUERY PLAN {}",
            crate::feed::feed_avatar_delete_before_sql(&prefix)
        ),
        &ParamsBuilder::new()
            .set("cutoff", "2026-06-17T12:00:00.000Z")
            .build(),
    )?;
    let expected_index = format!("USING INDEX {prefix}_feed_avatar_created_id_idx");

    assert!(plan
        .iter()
        .any(|row| row_string(row, 3).contains(&expected_index)));
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
fn copresence_repair_uses_the_latest_matching_join_in_the_same_instance() -> Result<(), Error> {
    let dir = TestDir::new("gamelog-repair-latest-matching-join");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    ensure_game_log_tables(&db)?;

    for (created_at, location, user_id) in [
        ("2026-08-13T10:00:00.000Z", "wrld_a:1", "usr_alice"),
        ("2026-08-13T10:10:00.000Z", "wrld_a:1", "usr_alice"),
        ("2026-08-13T10:20:00.000Z", "wrld_a:1", "usr_other"),
        ("2026-08-13T10:25:00.000Z", "wrld_b:1", "usr_alice"),
    ] {
        insert_join_leave(
            &db,
            created_at,
            "OnPlayerJoined",
            "Alice",
            location,
            user_id,
            0,
        );
    }
    insert_join_leave(
        &db,
        "2026-08-13T10:30:00.000Z",
        "OnPlayerLeft",
        "Alice",
        "wrld_a:1",
        "usr_alice",
        0,
    );

    database_maintenance_run(&db, DatabaseMaintenanceTask::RepairZeroCopresenceDurations)?;

    assert_eq!(leave_time(&db, "usr_alice"), 20 * 60 * 1000);
    Ok(())
}

#[test]
fn copresence_repair_uses_latest_display_name_match_for_legacy_rows_without_user_id(
) -> Result<(), Error> {
    let dir = TestDir::new("gamelog-repair-legacy-name");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    ensure_game_log_tables(&db)?;

    insert_join_leave(
        &db,
        "2026-08-13T11:00:00.000Z",
        "OnPlayerJoined",
        "Legacy Player",
        "wrld_a:1",
        "",
        0,
    );
    insert_join_leave(
        &db,
        "2026-08-13T11:10:00.000Z",
        "OnPlayerJoined",
        "Legacy Player",
        "wrld_a:1",
        "usr_known",
        0,
    );
    insert_join_leave(
        &db,
        "2026-08-13T11:15:00.000Z",
        "OnPlayerLeft",
        "Legacy Player",
        "wrld_a:1",
        "",
        0,
    );
    insert_join_leave(
        &db,
        "2026-08-13T11:20:00.000Z",
        "OnPlayerLeft",
        "Legacy Player",
        "wrld_a:1",
        "usr_missing",
        0,
    );

    database_maintenance_run(&db, DatabaseMaintenanceTask::RepairZeroCopresenceDurations)?;

    assert_eq!(
        leave_time_at(&db, "2026-08-13T11:15:00.000Z"),
        5 * 60 * 1000
    );
    assert_eq!(leave_time(&db, "usr_missing"), 0);
    Ok(())
}

#[test]
fn copresence_repair_preserves_recorded_and_rejects_implausible_history() -> Result<(), Error> {
    let dir = TestDir::new("gamelog-repair-history-guards");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    ensure_game_log_tables(&db)?;

    for (created_at, event_type, user_id, time) in [
        ("2026-08-12T12:00:00.000Z", "OnPlayerJoined", "usr_day", 0),
        ("2026-08-13T12:00:00.000Z", "OnPlayerLeft", "usr_day", 0),
        ("2026-08-12T11:59:59.999Z", "OnPlayerJoined", "usr_over", 0),
        ("2026-08-13T12:00:00.000Z", "OnPlayerLeft", "usr_over", 0),
        (
            "2026-08-13T11:00:00.000Z",
            "OnPlayerJoined",
            "usr_recorded",
            0,
        ),
        (
            "2026-08-13T12:00:00.000Z",
            "OnPlayerLeft",
            "usr_recorded",
            1234,
        ),
        (
            "2026-08-13T11:00:00.000Z",
            "OnPlayerJoined",
            "usr_invalid",
            0,
        ),
        ("not-a-timestamp", "OnPlayerLeft", "usr_invalid", 0),
    ] {
        insert_join_leave(
            &db, created_at, event_type, user_id, "wrld_a:1", user_id, time,
        );
    }

    database_maintenance_run(&db, DatabaseMaintenanceTask::RepairZeroCopresenceDurations)?;

    assert_eq!(leave_time(&db, "usr_day"), 24 * 60 * 60 * 1000);
    assert_eq!(leave_time(&db, "usr_over"), 0);
    assert_eq!(leave_time(&db, "usr_recorded"), 1234);
    assert_eq!(leave_time(&db, "usr_invalid"), 0);
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

#[test]
fn vacuum_is_skipped_when_there_is_nothing_meaningful_to_reclaim() -> Result<(), Error> {
    let dir = TestDir::new("vacuum-skip");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;

    assert!(!database_vacuum_if_fragmented(&db)?);
    Ok(())
}

#[test]
fn vacuum_runs_once_a_large_delete_leaves_the_file_fragmented() -> Result<(), Error> {
    let dir = TestDir::new("vacuum-run");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;

    db.execute_non_query(
        "CREATE TABLE bulk (id INTEGER PRIMARY KEY, blob TEXT)",
        &Default::default(),
    )?;
    db.write_transaction(|tx| {
        for index in 0..6000 {
            tx.execute_non_query(
                "INSERT INTO bulk (blob) VALUES (@blob)",
                &ParamsBuilder::new()
                    .set("blob", format!("{index}{}", "x".repeat(2048)))
                    .build(),
            )?;
        }
        Ok(())
    })?;
    db.execute_non_query("DELETE FROM bulk", &Default::default())?;

    let (free_pages, page_count) = read_page_stats(&db)?;
    assert!(
        free_pages >= VACUUM_MIN_FREE_PAGES,
        "expected a large free list, got {free_pages} free of {page_count}"
    );

    assert!(database_vacuum_if_fragmented(&db)?);

    let (free_after, _) = read_page_stats(&db)?;
    assert!(
        free_after < free_pages,
        "vacuum should have reclaimed pages, {free_pages} -> {free_after}"
    );
    Ok(())
}

#[test]
fn page_stats_come_from_a_single_snapshot() -> Result<(), Error> {
    let dir = TestDir::new("vacuum-stats");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;

    let (free_pages, page_count) = read_page_stats(&db)?;
    assert!(page_count > 0);
    assert!(free_pages >= 0);
    assert!(free_pages <= page_count);
    Ok(())
}
