use std::path::PathBuf;
use std::sync::Arc;

use serde_json::json;

use crate::database::DatabaseService;
use crate::realtime::ensure_realtime_tables;

use super::*;

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "vrcx-0-social-aggregates-{name}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn test_db(name: &str) -> (TestDir, Arc<DatabaseService>) {
    let dir = TestDir::new(name);
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap());
    (dir, db)
}

fn create_game_log_tables(db: &DatabaseService) {
    db.execute_non_query(
        "CREATE TABLE gamelog_join_leave (
                id INTEGER PRIMARY KEY,
                created_at TEXT,
                type TEXT,
                display_name TEXT,
                location TEXT,
                user_id TEXT,
                time INTEGER
            )",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "CREATE TABLE gamelog_location (
                id INTEGER PRIMARY KEY,
                created_at TEXT,
                location TEXT,
                world_id TEXT,
                world_name TEXT,
                time INTEGER,
                group_name TEXT
            )",
        &Default::default(),
    )
    .unwrap();
}

#[test]
fn copresence_summary_groups_minutes_days_instances_and_access_type() {
    let (_dir, db) = test_db("copresence");
    create_game_log_tables(&db);
    for (created_at, display_name, user_id, location, millis) in [
        (
            "2026-06-01T10:00:00Z",
            "Alice",
            "usr_alice",
            "wrld_a:1~private(usr_self)",
            600_000,
        ),
        (
            "2026-06-02T11:00:00Z",
            "Alice",
            "usr_alice",
            "wrld_b:2~group(grp_a)~groupAccessType(plus)",
            300_000,
        ),
        ("2026-06-02T12:00:00Z", "Bob", "usr_bob", "wrld_c:3", 60_000),
    ] {
        db.execute_non_query(
                "INSERT INTO gamelog_join_leave (created_at, type, display_name, location, user_id, time)
                 VALUES (@created_at, 'OnPlayerLeft', @display_name, @location, @user_id, @time)",
                &crate::common::ParamsBuilder::new()
                    .set("created_at", created_at)
                    .set("display_name", display_name)
                    .set("location", location)
                    .set("user_id", user_id)
                    .set("time", millis)
                    .build(),
            )
            .unwrap();
    }

    let output = get_copresence_summary(
        &db,
        CopresenceSummaryInput {
            time_window: TimeWindow {
                from: Some("2026-06-01T00:00:00Z".into()),
                to: Some("2026-06-03T00:00:00Z".into()),
            },
            group_by: CopresenceGroupBy::Friend,
            min_minutes: Some(2),
            limit: None,
            owner_user_id: None,
            friends_only: false,
        },
    )
    .unwrap();

    assert_eq!(output.rows.len(), 1);
    assert_eq!(output.total_rows, 1);
    assert_eq!(output.returned_rows, 1);
    assert!(!output.truncated);
    let row = &output.rows[0];
    assert_eq!(row.user_id, "usr_alice");
    assert_eq!(row.display_name, "Alice");
    assert_eq!(row.total_minutes, 15);
    assert_eq!(row.co_days, 2);
    assert_eq!(row.instances, 2);
    assert_eq!(row.last_seen_together, "2026-06-02T11:00:00Z");
    assert_eq!(row.minutes_by_access.get("invite"), Some(&10));
    assert_eq!(row.minutes_by_access.get("group"), Some(&5));
    assert!(output.summary.contains("Alice"));
    assert!(output
        .caveats
        .iter()
        .any(|caveat| caveat.contains("relative sorting")));
}

#[test]
fn copresence_summary_applies_limit_after_ranking() {
    let (_dir, db) = test_db("copresence-limit");
    create_game_log_tables(&db);
    for (display_name, user_id, millis) in [
        ("Alice", "usr_alice", 600_000),
        ("Bob", "usr_bob", 1_800_000),
        ("Carol", "usr_carol", 1_200_000),
    ] {
        db.execute_non_query(
            "INSERT INTO gamelog_join_leave (created_at, type, display_name, location, user_id, time)
                 VALUES ('2026-06-01T10:00:00Z', 'OnPlayerLeft', @display_name, 'wrld_a:1', @user_id, @time)",
            &crate::common::ParamsBuilder::new()
                .set("display_name", display_name)
                .set("user_id", user_id)
                .set("time", millis)
                .build(),
        )
        .unwrap();
    }

    let output = get_copresence_summary(
        &db,
        CopresenceSummaryInput {
            time_window: TimeWindow::all(),
            group_by: CopresenceGroupBy::Friend,
            min_minutes: None,
            limit: Some(2),
            owner_user_id: None,
            friends_only: false,
        },
    )
    .unwrap();

    assert_eq!(output.total_rows, 3);
    assert_eq!(output.returned_rows, 2);
    assert!(output.truncated);
    let names = output
        .rows
        .iter()
        .map(|row| row.display_name.as_str())
        .collect::<Vec<_>>();
    assert_eq!(names, ["Bob", "Carol"]);
}

#[test]
fn copresence_merges_renamed_user_into_one_row() {
    let (_dir, db) = test_db("copresence-renamed");
    create_game_log_tables(&db);
    insert_join_leave(
        &db,
        "2026-06-01T20:00:00Z",
        "OnPlayerLeft",
        "AliceOld",
        "usr_alice",
        "wrld_a:1",
        600_000,
    );
    insert_join_leave(
        &db,
        "2026-06-02T20:00:00Z",
        "OnPlayerLeft",
        "AliceNew",
        "usr_alice",
        "wrld_a:1",
        300_000,
    );

    let output = get_copresence_summary(
        &db,
        CopresenceSummaryInput {
            time_window: TimeWindow::all(),
            group_by: CopresenceGroupBy::Friend,
            min_minutes: None,
            limit: None,
            owner_user_id: None,
            friends_only: false,
        },
    )
    .unwrap();

    assert_eq!(output.total_rows, 1);
    assert_eq!(output.rows.len(), 1);
    let row = &output.rows[0];
    assert_eq!(row.user_id, "usr_alice");
    assert_eq!(row.display_name, "AliceNew");
    assert_eq!(row.total_minutes, 15);
    assert_eq!(row.co_days, 2);
    assert_eq!(row.last_seen_together, "2026-06-02T20:00:00Z");
}

#[test]
fn copresence_keeps_distinct_name_only_strangers_separate() {
    let (_dir, db) = test_db("copresence-name-only");
    create_game_log_tables(&db);
    for display_name in ["Stranger One", "Stranger Two"] {
        db.execute_non_query(
            "INSERT INTO gamelog_join_leave (created_at, type, display_name, location, user_id, time)
             VALUES ('2026-06-01T20:00:00Z', 'OnPlayerLeft', @display_name, 'wrld_a:1', NULL, 600000)",
            &crate::common::ParamsBuilder::new()
                .set("display_name", display_name)
                .build(),
        )
        .unwrap();
    }

    let output = get_copresence_summary(
        &db,
        CopresenceSummaryInput {
            time_window: TimeWindow::all(),
            group_by: CopresenceGroupBy::Friend,
            min_minutes: None,
            limit: None,
            owner_user_id: None,
            friends_only: false,
        },
    )
    .unwrap();

    assert_eq!(output.total_rows, 2);
    assert_eq!(output.rows.len(), 2);
    let names = output
        .rows
        .iter()
        .map(|row| row.display_name.as_str())
        .collect::<Vec<_>>();
    assert!(names.contains(&"Stranger One"));
    assert!(names.contains(&"Stranger Two"));
    assert!(output.rows.iter().all(|row| row.user_id.is_empty()));
}

#[test]
fn copresence_renamed_user_does_not_inflate_total_rows() {
    let (_dir, db) = test_db("copresence-renamed-total-rows");
    create_game_log_tables(&db);
    for (created_at, display_name, user_id, millis) in [
        ("2026-06-01T20:00:00Z", "AliceOld", "usr_alice", 1_200_000),
        ("2026-06-02T20:00:00Z", "AliceNew", "usr_alice", 2_400_000),
        ("2026-06-02T21:00:00Z", "Bob", "usr_bob", 1_800_000),
    ] {
        insert_join_leave(
            &db,
            created_at,
            "OnPlayerLeft",
            display_name,
            user_id,
            "wrld_a:1",
            millis,
        );
    }

    let output = get_copresence_summary(
        &db,
        CopresenceSummaryInput {
            time_window: TimeWindow::all(),
            group_by: CopresenceGroupBy::Friend,
            min_minutes: None,
            limit: Some(1),
            owner_user_id: None,
            friends_only: false,
        },
    )
    .unwrap();

    assert_eq!(output.total_rows, 2);
    assert_eq!(output.returned_rows, 1);
    assert!(output.truncated);
    assert_eq!(output.rows[0].user_id, "usr_alice");
    assert_eq!(output.rows[0].display_name, "AliceNew");
    assert_eq!(output.rows[0].total_minutes, 60);
}

#[test]
fn copresence_marks_is_friend_against_current_friends() {
    let (_dir, db) = test_db("copresence-is-friend");
    create_game_log_tables(&db);
    ensure_realtime_tables(&db, "usrself").unwrap();
    db.execute_non_query(
        "INSERT INTO usrself_friend_log_current (user_id, display_name, trust_level, friend_number)
             VALUES ('usr_alice', 'Alice', 'Trusted', 1)",
        &Default::default(),
    )
    .unwrap();
    for (display_name, user_id, millis) in [
        ("Alice", "usr_alice", 1_200_000),
        ("Stranger", "usr_stranger", 600_000),
    ] {
        insert_join_leave(
            &db,
            "2026-06-01T20:00:00Z",
            "OnPlayerLeft",
            display_name,
            user_id,
            "wrld_a:1",
            millis,
        );
    }

    let output = get_copresence_summary(
        &db,
        CopresenceSummaryInput {
            time_window: TimeWindow::all(),
            group_by: CopresenceGroupBy::Friend,
            min_minutes: None,
            limit: None,
            owner_user_id: Some("usr_self".into()),
            friends_only: false,
        },
    )
    .unwrap();

    let alice = output
        .rows
        .iter()
        .find(|row| row.user_id == "usr_alice")
        .unwrap();
    assert!(alice.is_friend);
    let stranger = output
        .rows
        .iter()
        .find(|row| row.user_id == "usr_stranger")
        .unwrap();
    assert!(!stranger.is_friend);
}

#[test]
fn copresence_enriches_world_name_from_game_log_location() {
    let (_dir, db) = test_db("copresence-world-name");
    create_game_log_tables(&db);
    insert_join_leave(
        &db,
        "2026-06-01T20:00:00Z",
        "OnPlayerLeft",
        "Alice",
        "usr_alice",
        "wrld_party:1",
        600_000,
    );
    db.execute_non_query(
        "INSERT INTO gamelog_location (created_at, location, world_id, world_name, time, group_name)
             VALUES ('2026-06-01T19:59:00Z', 'wrld_party:1', 'wrld_party', 'Party World', 600000, '')",
        &Default::default(),
    )
    .unwrap();

    let output = get_copresence_summary(
        &db,
        CopresenceSummaryInput {
            time_window: TimeWindow::all(),
            group_by: CopresenceGroupBy::FriendWorld,
            min_minutes: None,
            limit: None,
            owner_user_id: None,
            friends_only: false,
        },
    )
    .unwrap();

    let row = output
        .rows
        .iter()
        .find(|row| row.world_id.as_deref() == Some("wrld_party"))
        .unwrap();
    assert_eq!(row.world_name.as_deref(), Some("Party World"));
}

#[test]
fn resolve_user_ranks_exact_then_friend_then_seen() {
    let (_dir, db) = test_db("resolve-user");
    create_game_log_tables(&db);
    ensure_realtime_tables(&db, "usrself").unwrap();
    db.execute_non_query(
        "INSERT INTO usrself_friend_log_current (user_id, display_name, trust_level, friend_number)
             VALUES ('usr_alice', 'Alice', 'Trusted', 1)",
        &Default::default(),
    )
    .unwrap();
    // Alice (friend, seen twice), Alicia (stranger, seen once), and an exact
    // "Alic" stranger that must rank first on exact match.
    for (created_at, display_name, user_id) in [
        ("2026-06-01T20:00:00Z", "Alice", "usr_alice"),
        ("2026-06-02T20:00:00Z", "Alice", "usr_alice"),
        ("2026-06-03T20:00:00Z", "Alicia", "usr_alicia"),
        ("2026-06-04T20:00:00Z", "Alic", "usr_exact"),
    ] {
        insert_join_leave(
            &db,
            created_at,
            "OnPlayerJoined",
            display_name,
            user_id,
            "wrld_a:1",
            0,
        );
    }

    let output = resolve_user_by_name(
        &db,
        ResolveUserInput {
            owner_user_id: "usr_self".into(),
            name_query: "Alic".into(),
            limit: None,
        },
    )
    .unwrap();

    let ids = output
        .rows
        .iter()
        .map(|row| row.user_id.as_str())
        .collect::<Vec<_>>();
    // Exact "Alic" first, then friend Alice, then stranger Alicia.
    assert_eq!(ids, ["usr_exact", "usr_alice", "usr_alicia"]);
    let alice = output
        .rows
        .iter()
        .find(|row| row.user_id == "usr_alice")
        .unwrap();
    assert!(alice.is_friend);
    assert_eq!(alice.encounter_count, 2);
    assert!(output
        .rows
        .iter()
        .all(|row| !row.user_id.is_empty() && row.user_id.starts_with("usr_")));
}

#[test]
fn copresence_friend_world_keeps_tied_worlds_separate() {
    let (_dir, db) = test_db("copresence-world-tie");
    create_game_log_tables(&db);
    // Same friend, two worlds with identical total time, each split across two
    // access buckets. The streaming fold must keep each world's rows contiguous.
    for (created_at, location, millis) in [
        ("2026-06-01T10:00:00Z", "wrld_a:1", 300_000),
        ("2026-06-01T11:00:00Z", "wrld_a:1~friends(usr_x)", 300_000),
        ("2026-06-01T12:00:00Z", "wrld_b:1", 300_000),
        ("2026-06-01T13:00:00Z", "wrld_b:1~friends(usr_x)", 300_000),
    ] {
        db.execute_non_query(
            "INSERT INTO gamelog_join_leave (created_at, type, display_name, location, user_id, time)
                 VALUES (@created_at, 'OnPlayerLeft', 'Alice', @location, 'usr_alice', @time)",
            &crate::common::ParamsBuilder::new()
                .set("created_at", created_at)
                .set("location", location)
                .set("time", millis)
                .build(),
        )
        .unwrap();
    }

    let output = get_copresence_summary(
        &db,
        CopresenceSummaryInput {
            time_window: TimeWindow::all(),
            group_by: CopresenceGroupBy::FriendWorld,
            min_minutes: None,
            limit: None,
            owner_user_id: None,
            friends_only: false,
        },
    )
    .unwrap();

    assert_eq!(output.total_rows, 2);
    assert_eq!(output.rows.len(), 2);
    let world_ids = output
        .rows
        .iter()
        .map(|row| row.world_id.as_deref())
        .collect::<Vec<_>>();
    assert_eq!(world_ids, [Some("wrld_a"), Some("wrld_b")]);
    for row in &output.rows {
        assert_eq!(row.total_minutes, 10);
        assert_eq!(row.minutes_by_access.get("public"), Some(&5));
        assert_eq!(row.minutes_by_access.get("friends"), Some(&5));
    }
}

#[test]
fn copresence_summary_excludes_owner_self_rows() {
    let (_dir, db) = test_db("copresence-exclude-self");
    create_game_log_tables(&db);
    // The owner's own OnPlayerLeft rows have the longest stay, so without the
    // data-layer exclusion they would rank first.
    for (display_name, user_id, millis) in [
        ("Self", "usr_self", 3_600_000),
        ("Alice", "usr_alice", 600_000),
    ] {
        db.execute_non_query(
            "INSERT INTO gamelog_join_leave (created_at, type, display_name, location, user_id, time)
                 VALUES ('2026-06-01T10:00:00Z', 'OnPlayerLeft', @display_name, 'wrld_a:1', @user_id, @time)",
            &crate::common::ParamsBuilder::new()
                .set("display_name", display_name)
                .set("user_id", user_id)
                .set("time", millis)
                .build(),
        )
        .unwrap();
    }
    // Name-only legacy row (NULL user_id) must survive the owner exclusion.
    db.execute_non_query(
        "INSERT INTO gamelog_join_leave (created_at, type, display_name, location, user_id, time)
             VALUES ('2026-06-01T10:00:00Z', 'OnPlayerLeft', 'Mallory', 'wrld_a:1', NULL, 900000)",
        &Default::default(),
    )
    .unwrap();

    let output = get_copresence_summary(
        &db,
        CopresenceSummaryInput {
            time_window: TimeWindow::all(),
            group_by: CopresenceGroupBy::Friend,
            min_minutes: None,
            limit: None,
            owner_user_id: Some("usr_self".into()),
            friends_only: false,
        },
    )
    .unwrap();

    assert_eq!(output.total_rows, 2);
    assert!(output.rows.iter().all(|row| row.user_id != "usr_self"));
    assert!(output.rows.iter().any(|row| row.user_id == "usr_alice"));
    assert!(output
        .rows
        .iter()
        .any(|row| row.user_id.is_empty() && row.display_name == "Mallory"));
}

#[test]
fn recall_encounter_excludes_owner_self_rows() {
    let (_dir, db) = test_db("recall-exclude-self");
    create_game_log_tables(&db);
    ensure_realtime_tables(&db, "usrself").unwrap();
    // A display name that also matches the owner's own join rows; the owner must
    // never surface even when the name query would otherwise catch them.
    insert_join_leave(
        &db,
        "2026-06-10T21:00:00Z",
        "OnPlayerJoined",
        "Luna",
        "usr_self",
        "wrld_party:1",
        0,
    );
    insert_join_leave(
        &db,
        "2026-06-10T21:05:00Z",
        "OnPlayerJoined",
        "LunaBunny",
        "usr_luna",
        "wrld_party:1",
        0,
    );

    let output = recall_encounter(
        &db,
        RecallEncounterInput {
            owner_user_id: "usr_self".into(),
            name_query: Some("luna".into()),
            world_id: None,
            co_present_with_user_id: None,
            time_window: TimeWindow::all(),
            limit: None,
        },
    )
    .unwrap();

    assert!(output.rows.iter().all(|row| row.user_id != "usr_self"));
    assert!(output.rows.iter().any(|row| row.user_id == "usr_luna"));
}

#[test]
fn friend_activity_pattern_counts_online_events_by_hour() {
    let (_dir, db) = test_db("activity-pattern");
    ensure_realtime_tables(&db, "usrself").unwrap();
    for (user_id, display_name, created_at) in [
        ("usr_alice", "Alice", "2026-06-01T18:05:00Z"),
        ("usr_alice", "Alice", "2026-06-02T18:45:00Z"),
        ("usr_alice", "Alice", "2026-06-02T21:00:00Z"),
        ("usr_bob", "Bob", "2026-06-03T09:00:00Z"),
    ] {
        db.execute_non_query(
                "INSERT INTO usrself_feed_online_offline
                    (created_at, user_id, display_name, type, location, world_name, time, group_name)
                 VALUES (@created_at, @user_id, @display_name, 'Online', '', '', 0, '')",
                &crate::common::ParamsBuilder::new()
                    .set("created_at", created_at)
                    .set("user_id", user_id)
                    .set("display_name", display_name)
                    .build(),
            )
            .unwrap();
    }

    let output = get_friend_activity_pattern(
        &db,
        FriendActivityPatternInput {
            owner_user_id: "usr_self".into(),
            user_id: Some("usr_alice".into()),
            time_window: TimeWindow::all(),
            bucket: ActivityBucket::HourOfDay,
            utc_offset_minutes: None,
        },
    )
    .unwrap();

    assert_eq!(output.rows.len(), 1);
    assert_eq!(output.rows[0].user_id, "usr_alice");
    assert_eq!(output.rows[0].buckets.get("18"), Some(&2));
    assert_eq!(output.rows[0].buckets.get("21"), Some(&1));
    assert_eq!(output.rows[0].typical_online_window, "18:00-19:00");
}

#[test]
fn friend_activity_pattern_buckets_in_local_time_with_offset() {
    let (_dir, db) = test_db("activity-pattern-offset");
    ensure_realtime_tables(&db, "usrself").unwrap();
    db.execute_non_query(
        "INSERT INTO usrself_feed_online_offline
            (created_at, user_id, display_name, type, location, world_name, time, group_name)
         VALUES ('2026-06-01T18:05:00Z', 'usr_alice', 'Alice', 'Online', '', '', 0, '')",
        &Default::default(),
    )
    .unwrap();

    let output = get_friend_activity_pattern(
        &db,
        FriendActivityPatternInput {
            owner_user_id: "usr_self".into(),
            user_id: Some("usr_alice".into()),
            time_window: TimeWindow::all(),
            bucket: ActivityBucket::HourOfDay,
            utc_offset_minutes: Some(540),
        },
    )
    .unwrap();

    // 18:05 UTC shifted by +9h lands at 03:05 local -> bucket "03", not "18".
    assert_eq!(output.rows[0].buckets.get("03"), Some(&1));
    assert!(!output.rows[0].buckets.contains_key("18"));
    assert!(output
        .caveats
        .iter()
        .any(|caveat| caveat.contains("UTC+09:00")));
}

#[test]
fn friend_activity_pattern_merges_renamed_user_buckets() {
    let (_dir, db) = test_db("activity-pattern-renamed");
    ensure_realtime_tables(&db, "usrself").unwrap();
    for (display_name, created_at) in [
        ("AliceOld", "2026-06-01T18:05:00Z"),
        ("AliceNew", "2026-06-02T18:45:00Z"),
    ] {
        db.execute_non_query(
            "INSERT INTO usrself_feed_online_offline
                (created_at, user_id, display_name, type, location, world_name, time, group_name)
             VALUES (@created_at, 'usr_alice', @display_name, 'Online', '', '', 0, '')",
            &crate::common::ParamsBuilder::new()
                .set("created_at", created_at)
                .set("display_name", display_name)
                .build(),
        )
        .unwrap();
    }

    let output = get_friend_activity_pattern(
        &db,
        FriendActivityPatternInput {
            owner_user_id: "usr_self".into(),
            user_id: Some("usr_alice".into()),
            time_window: TimeWindow::all(),
            bucket: ActivityBucket::HourOfDay,
            utc_offset_minutes: None,
        },
    )
    .unwrap();

    assert_eq!(output.rows.len(), 1);
    let row = &output.rows[0];
    assert_eq!(row.user_id, "usr_alice");
    assert_eq!(row.display_name, "AliceNew");
    assert_eq!(row.buckets.get("18"), Some(&2));
    assert_eq!(row.typical_online_window, "18:00-19:00");
}

#[test]
fn friend_log_applies_filters_limit_and_rejects_unknown_types() {
    let (_dir, db) = test_db("friend-log");
    ensure_realtime_tables(&db, "usrself").unwrap();
    db.execute_non_query(
        "INSERT INTO usrself_friend_log_history
            (created_at, type, user_id, display_name, previous_display_name, trust_level, previous_trust_level, friend_number)
         VALUES
            ('2026-06-01T10:00:00Z', 'Friend', 'usr_alice', 'Alice', '', 'Known', '', 1),
            ('2026-06-02T10:00:00Z', 'Friend', 'usr_bob', 'Bob', '', 'Known', '', 2),
            ('2026-06-03T10:00:00Z', 'TrustLevel', 'usr_alice', 'Alice', '', 'Trusted', 'Known', 1),
            ('2026-06-04T10:00:00Z', 'DisplayName', 'usr_alice', 'Alice New', 'Alice', 'Trusted', 'Trusted', 1)",
        &Default::default(),
    )
    .unwrap();

    let output = get_friend_log(
        &db,
        FriendLogInput {
            owner_user_id: "usr_self".into(),
            target_user_id: Some("usr_alice".into()),
            types: vec!["Friend".into(), "TrustLevel".into()],
            time_window: TimeWindow {
                from: Some("2026-06-01T00:00:00Z".into()),
                to: Some("2026-06-03T23:59:59Z".into()),
            },
            limit: Some(1),
            cursor: None,
        },
    )
    .unwrap();

    assert_eq!(output.rows.len(), 1);
    assert_eq!(output.total_rows, 2);
    assert_eq!(output.returned_rows, 1);
    assert!(output.truncated);
    assert!(output.next_cursor.is_some());
    assert_eq!(output.rows[0].kind, "TrustLevel");
    assert_eq!(output.rows[0].user_id, "usr_alice");
    assert_eq!(
        get_friend_log_first_created_at(&db, "usr_self", "usr_alice", "Friend").unwrap(),
        Some("2026-06-01T10:00:00Z".into())
    );
    assert!(output
        .caveats
        .iter()
        .any(|caveat| caveat.contains("relationship events")));

    let error = get_friend_log(
        &db,
        FriendLogInput {
            owner_user_id: "usr_self".into(),
            target_user_id: None,
            types: vec!["Block".into()],
            time_window: TimeWindow::all(),
            limit: None,
            cursor: None,
        },
    )
    .expect_err("unknown type should be rejected");
    assert!(matches!(error, crate::Error::InvalidData(message) if message.contains("Block")));
}

#[test]
fn friend_log_cursor_returns_the_next_page() {
    let (_dir, db) = test_db("friend-log-cursor");
    ensure_realtime_tables(&db, "usrself").unwrap();
    db.execute_non_query(
        "INSERT INTO usrself_friend_log_history
            (created_at, type, user_id, display_name, previous_display_name, trust_level, previous_trust_level, friend_number)
         VALUES
            ('2026-06-03T10:00:00Z', 'Friend', 'usr_carol', 'Carol', '', 'Known', '', 3),
            ('2026-06-02T10:00:00Z', 'Friend', 'usr_bob', 'Bob', '', 'Known', '', 2),
            ('2026-06-01T10:00:00Z', 'Friend', 'usr_alice', 'Alice', '', 'Known', '', 1)",
        &Default::default(),
    )
    .unwrap();

    let first = get_friend_log(
        &db,
        FriendLogInput {
            owner_user_id: "usr_self".into(),
            target_user_id: None,
            types: vec!["Friend".into()],
            time_window: TimeWindow::all(),
            limit: Some(1),
            cursor: None,
        },
    )
    .unwrap();
    assert_eq!(first.rows[0].user_id, "usr_carol");
    assert_eq!(first.total_rows, 3);
    assert!(first.truncated);

    let second = get_friend_log(
        &db,
        FriendLogInput {
            owner_user_id: "usr_self".into(),
            target_user_id: None,
            types: vec!["Friend".into()],
            time_window: TimeWindow::all(),
            limit: Some(2),
            cursor: first.next_cursor,
        },
    )
    .unwrap();

    let user_ids = second
        .rows
        .iter()
        .map(|row| row.user_id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(user_ids, ["usr_bob", "usr_alice"]);
    assert_eq!(second.total_rows, 3);
    assert_eq!(second.returned_rows, 2);
    assert!(!second.truncated);
    assert!(second.next_cursor.is_none());
}

#[test]
fn search_worlds_visited_returns_recent_world_candidates() {
    let (_dir, db) = test_db("worlds-visited");
    create_game_log_tables(&db);
    db.execute_non_query(
            "INSERT INTO gamelog_location (created_at, location, world_id, world_name, time, group_name)
             VALUES
             ('2026-06-01T22:00:00Z', 'wrld_parkour:1', 'wrld_parkour', 'Parkour Night', 1800000, ''),
             ('2026-06-01T20:00:00Z', 'wrld_chill:2', 'wrld_chill', 'Chill Room', 600000, '')",
            &Default::default(),
        )
        .unwrap();

    let output = search_worlds_visited(
        &db,
        SearchWorldsVisitedInput {
            time_window: TimeWindow {
                from: Some("2026-06-01T21:00:00Z".into()),
                to: Some("2026-06-02T00:00:00Z".into()),
            },
            limit: 10,
        },
    )
    .unwrap();

    assert_eq!(output.rows.len(), 1);
    assert_eq!(output.rows[0].world_id, "wrld_parkour");
    assert_eq!(output.rows[0].world_name, "Parkour Night");
    assert_eq!(output.rows[0].stay_minutes, 30);
}

#[test]
fn social_graph_uses_mutual_graph_edges_without_implying_coplay() {
    let (_dir, db) = test_db("social-graph");
    ensure_realtime_tables(&db, "usrself").unwrap();
    db.execute_non_query(
        "CREATE TABLE usrself_mutual_graph_friends (friend_id TEXT PRIMARY KEY)",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
            "CREATE TABLE usrself_mutual_graph_links (friend_id TEXT NOT NULL, mutual_id TEXT NOT NULL, PRIMARY KEY(friend_id, mutual_id))",
            &Default::default(),
        )
        .unwrap();
    db.execute_non_query(
            "CREATE TABLE usrself_mutual_graph_meta (friend_id TEXT PRIMARY KEY, last_fetched_at TEXT, opted_out INTEGER DEFAULT 0)",
            &Default::default(),
        )
        .unwrap();
    db.execute_non_query(
        "INSERT INTO usrself_mutual_graph_friends (friend_id)
             VALUES ('usr_a'), ('usr_b')",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "INSERT INTO usrself_mutual_graph_links (friend_id, mutual_id)
             VALUES ('usr_a', 'usr_b')",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "INSERT INTO usrself_mutual_graph_meta (friend_id, last_fetched_at, opted_out)
             VALUES
                ('usr_a', '2026-06-01T10:00:00Z', 0),
                ('usr_b', '2026-06-02T11:00:00Z', 0),
                ('usr_opted', '2026-06-03T12:00:00Z', 1)",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "INSERT INTO usrself_friend_log_current (user_id, display_name, trust_level, friend_number)
             VALUES
                ('usr_a', 'Alice', 'Trusted', 1),
                ('usr_b', 'Bob', 'Known', 2)",
        &Default::default(),
    )
    .unwrap();

    let output = get_social_graph(
        &db,
        SocialGraphInput {
            owner_user_id: "usr_self".into(),
            user_id: None,
            depth: 1,
            max_nodes: None,
            max_edges: None,
        },
    )
    .unwrap();

    assert_eq!(output.nodes.len(), 2);
    assert_eq!(output.edges.len(), 1);
    assert_eq!(output.total_nodes, 2);
    assert_eq!(output.total_edges, 1);
    assert!(!output.truncated);
    let alice = output
        .nodes
        .iter()
        .find(|node| node.user_id == "usr_a")
        .unwrap();
    assert_eq!(alice.display_name, "Alice");
    assert!(alice.is_friend);
    assert_eq!(output.fetched_friends, 2);
    assert_eq!(output.opted_out_friends, 1);
    assert_eq!(
        output.oldest_fetched_at,
        Some("2026-06-01T10:00:00Z".into())
    );
    assert_eq!(
        output.newest_fetched_at,
        Some("2026-06-02T11:00:00Z".into())
    );
    assert!(output
        .caveats
        .iter()
        .any(|caveat| caveat.contains("friend relationship")));
    assert!(output
        .caveats
        .iter()
        .any(|caveat| caveat.contains("refresh_mutual_graph")));
}

#[test]
fn social_graph_marks_first_degree_friends_apart_from_mutuals() {
    let (_dir, db) = test_db("social-graph-is-friend");
    ensure_realtime_tables(&db, "usrself").unwrap();
    db.execute_non_query(
        "CREATE TABLE usrself_mutual_graph_friends (friend_id TEXT PRIMARY KEY)",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "CREATE TABLE usrself_mutual_graph_links (friend_id TEXT NOT NULL, mutual_id TEXT NOT NULL, PRIMARY KEY(friend_id, mutual_id))",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "CREATE TABLE usrself_mutual_graph_meta (friend_id TEXT PRIMARY KEY, last_fetched_at TEXT, opted_out INTEGER DEFAULT 0)",
        &Default::default(),
    )
    .unwrap();
    // usr_a is my friend; usr_stranger is a friend-of-friend, not mine.
    db.execute_non_query(
        "INSERT INTO usrself_mutual_graph_friends (friend_id) VALUES ('usr_a')",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "INSERT INTO usrself_mutual_graph_links (friend_id, mutual_id) VALUES ('usr_a', 'usr_stranger')",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "INSERT INTO usrself_mutual_graph_meta (friend_id, last_fetched_at, opted_out) VALUES ('usr_a', '2026-06-01T10:00:00Z', 0)",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "INSERT INTO usrself_friend_log_current (user_id, display_name, trust_level, friend_number)
             VALUES ('usr_a', 'Alice', 'Trusted', 1)",
        &Default::default(),
    )
    .unwrap();

    let output = get_social_graph(
        &db,
        SocialGraphInput {
            owner_user_id: "usr_self".into(),
            user_id: None,
            depth: 1,
            max_nodes: None,
            max_edges: None,
        },
    )
    .unwrap();

    let alice = output
        .nodes
        .iter()
        .find(|node| node.user_id == "usr_a")
        .unwrap();
    assert!(alice.is_friend);
    let stranger = output
        .nodes
        .iter()
        .find(|node| node.user_id == "usr_stranger")
        .unwrap();
    assert!(!stranger.is_friend);
    assert!(stranger.display_name.is_empty());
    assert!(output
        .caveats
        .iter()
        .any(|caveat| caveat.contains("isFriend")));
}

#[test]
fn social_graph_applies_node_and_edge_caps_with_total_counts() {
    let (_dir, db) = test_db("social-graph-caps");
    ensure_realtime_tables(&db, "usrself").unwrap();
    db.execute_non_query(
        "CREATE TABLE usrself_mutual_graph_friends (friend_id TEXT PRIMARY KEY)",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "CREATE TABLE usrself_mutual_graph_links (friend_id TEXT NOT NULL, mutual_id TEXT NOT NULL, PRIMARY KEY(friend_id, mutual_id))",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "CREATE TABLE usrself_mutual_graph_meta (friend_id TEXT PRIMARY KEY, last_fetched_at TEXT, opted_out INTEGER DEFAULT 0)",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "INSERT INTO usrself_mutual_graph_friends (friend_id)
             VALUES ('usr_a'), ('usr_b'), ('usr_c'), ('usr_d')",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "INSERT INTO usrself_mutual_graph_links (friend_id, mutual_id)
             VALUES
                ('usr_a', 'usr_b'),
                ('usr_a', 'usr_c'),
                ('usr_a', 'usr_d'),
                ('usr_b', 'usr_c'),
                ('usr_b', 'usr_d'),
                ('usr_c', 'usr_d')",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "INSERT INTO usrself_friend_log_current (user_id, display_name, trust_level, friend_number)
             VALUES
                ('usr_a', 'Alice', 'Trusted', 1),
                ('usr_b', 'Bob', 'Known', 2),
                ('usr_c', 'Carol', 'Known', 3),
                ('usr_d', 'Delta', 'Known', 4)",
        &Default::default(),
    )
    .unwrap();

    let output = get_social_graph(
        &db,
        SocialGraphInput {
            owner_user_id: "usr_self".into(),
            user_id: Some("usr_d".into()),
            depth: 1,
            max_nodes: Some(3),
            max_edges: Some(2),
        },
    )
    .unwrap();

    assert_eq!(output.total_nodes, 4);
    assert_eq!(output.total_edges, 3);
    assert_eq!(output.nodes.len(), 3);
    assert_eq!(output.edges.len(), 2);
    assert!(output.truncated);
    assert_eq!(output.nodes[0].user_id, "usr_d");
    assert!(output.edges.iter().all(|edge| output
        .nodes
        .iter()
        .any(|node| node.user_id == edge.source_user_id)
        && output
            .nodes
            .iter()
            .any(|node| node.user_id == edge.target_user_id)));
}

#[test]
fn friend_circles_groups_mutually_linked_friends_and_excludes_second_degree_nodes() {
    let (_dir, db) = test_db("friend-circles");
    ensure_realtime_tables(&db, "usrself").unwrap();
    db.execute_non_query(
        "CREATE TABLE usrself_mutual_graph_friends (friend_id TEXT PRIMARY KEY)",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "CREATE TABLE usrself_mutual_graph_links (friend_id TEXT NOT NULL, mutual_id TEXT NOT NULL, PRIMARY KEY(friend_id, mutual_id))",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "CREATE TABLE usrself_mutual_graph_meta (friend_id TEXT PRIMARY KEY, last_fetched_at TEXT, opted_out INTEGER DEFAULT 0)",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "INSERT INTO usrself_friend_log_current (user_id, display_name, trust_level, friend_number)
             VALUES
                ('usr_a', 'Alice', 'Trusted', 1),
                ('usr_b', 'Bob', 'Known', 2),
                ('usr_c', 'Carol', 'Known', 3),
                ('usr_d', 'Delta', 'Known', 4),
                ('usr_e', 'Echo', 'Known', 5),
                ('usr_f', 'Foxtrot', 'Known', 6)",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "INSERT INTO usrself_mutual_graph_friends (friend_id)
             VALUES ('usr_a'), ('usr_b'), ('usr_c'), ('usr_d'), ('usr_e'), ('usr_stranger')",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "INSERT INTO usrself_mutual_graph_links (friend_id, mutual_id)
             VALUES
                ('usr_a', 'usr_b'),
                ('usr_b', 'usr_c'),
                ('usr_d', 'usr_e'),
                ('usr_e', 'usr_d'),
                ('usr_a', 'usr_stranger')",
        &Default::default(),
    )
    .unwrap();

    let output = get_friend_circles(
        &db,
        FriendCirclesInput {
            owner_user_id: "usr_self".into(),
            max_circles: Some(6),
            max_members_per_circle: Some(8),
        },
    )
    .unwrap();

    assert_eq!(output.circle_count, 2);
    assert_eq!(output.circles.len(), 2);
    assert_eq!(output.friends_analyzed, 6);
    assert_eq!(output.isolated_friend_count, 1);
    assert_eq!(output.circles[0].member_count, 3);
    assert_eq!(output.circles[0].members, vec!["Alice", "Bob", "Carol"]);
    assert_eq!(output.circles[1].members, vec!["Delta", "Echo"]);
    assert!(output
        .circles
        .iter()
        .all(|circle| !circle.members.iter().any(|name| name == "usr_stranger")));
    assert!(!output.circles[0].sample_pairs.is_empty());
    assert!(output.summary.contains("6 friends"));
    assert!(output
        .caveats
        .iter()
        .any(|caveat| caveat.contains("Connected circles")));
}

#[test]
fn favorite_local_supports_kind_action_and_dry_run() {
    let (_dir, db) = test_db("favorite-local-dry-run");

    let output = favorite_local(&db, favorite_friend_input("add", true)).unwrap();

    assert!(output.dry_run);
    assert_eq!(output.kind, "friend");
    assert_eq!(output.entity_id, "usr_alice");
    assert_eq!(output.action, "add");
    assert!(crate::favorites::favorite_list(&db, "friend".into())
        .unwrap()
        .is_empty());

    favorite_local(&db, favorite_friend_input("add", false)).unwrap();
    assert_eq!(
        crate::favorites::favorite_list(&db, "friend".into())
            .unwrap()
            .len(),
        1
    );

    favorite_local(&db, favorite_friend_input("remove", true)).unwrap();
    assert_eq!(
        crate::favorites::favorite_list(&db, "friend".into())
            .unwrap()
            .len(),
        1
    );

    favorite_local(&db, favorite_friend_input("remove", false)).unwrap();
    assert!(crate::favorites::favorite_list(&db, "friend".into())
        .unwrap()
        .is_empty());
}

fn favorite_friend_input(action: &str, dry_run: bool) -> FavoriteLocalInput {
    FavoriteLocalInput {
        kind: "friend".into(),
        entity_id: "usr_alice".into(),
        group: "AI Picks".into(),
        action: action.into(),
        dry_run,
    }
}

#[test]
fn companions_of_uses_gamelog_overlap_and_excludes_owner_and_non_overlap() {
    let (_dir, db) = test_db("companions-of");
    create_game_log_tables(&db);
    // Target stayed wrld_public:1 [20:00,20:15]; Alice overlaps [20:00,20:10];
    // the owner overlaps too but must be excluded; Charlie was there later with
    // no overlap; Bob shared no instance with the target.
    for (created_at, user_id, display_name, location, millis) in [
        (
            "2026-06-01T20:15:00Z",
            "usr_target",
            "Target",
            "wrld_public:1",
            900_000,
        ),
        (
            "2026-06-01T20:10:00Z",
            "usr_alice",
            "Alice",
            "wrld_public:1",
            600_000,
        ),
        (
            "2026-06-01T20:12:00Z",
            "usr_self",
            "Self",
            "wrld_public:1",
            600_000,
        ),
        (
            "2026-06-01T20:40:00Z",
            "usr_charlie",
            "Charlie",
            "wrld_public:1",
            300_000,
        ),
        (
            "2026-06-01T20:10:00Z",
            "usr_bob",
            "Bob",
            "wrld_other:1",
            600_000,
        ),
    ] {
        insert_join_leave(
            &db,
            created_at,
            "OnPlayerLeft",
            display_name,
            user_id,
            location,
            millis,
        );
    }
    db.execute_non_query(
        "INSERT INTO gamelog_location (created_at, location, world_id, world_name, time, group_name)
             VALUES ('2026-06-01T20:00:00Z', 'wrld_public:1', 'wrld_public', 'Public World', 900000, '')",
        &Default::default(),
    )
    .unwrap();

    let output = get_companions_of(
        &db,
        CompanionsOfInput {
            owner_user_id: "usr_self".into(),
            user_id: "usr_target".into(),
            time_window: TimeWindow::all(),
            limit: Some(10),
        },
    )
    .unwrap();

    assert_eq!(output.rows.len(), 1);
    assert_eq!(output.rows[0].user_id, "usr_alice");
    assert_eq!(output.rows[0].overlap_minutes, 10);
    assert_eq!(output.rows[0].shared_instances, 1);
    assert_eq!(output.rows[0].world_count, 1);
    assert_eq!(output.rows[0].worlds[0].world_id, "wrld_public");
    assert_eq!(output.rows[0].worlds[0].world_name, "Public World");
    assert!(output.summary.contains("Target"));
}

#[test]
fn companions_of_renamed_user_shows_latest_name() {
    let (_dir, db) = test_db("companions-of-renamed");
    create_game_log_tables(&db);
    // Target and Alice overlapped on two days; Alice was renamed in between, so
    // the companion row must surface her latest observed name.
    for (created_at, user_id, display_name) in [
        ("2026-06-01T20:10:00Z", "usr_target", "Target"),
        ("2026-06-03T20:10:00Z", "usr_target", "Target"),
        ("2026-06-01T20:10:00Z", "usr_alice", "AliceOld"),
        ("2026-06-03T20:10:00Z", "usr_alice", "AliceNew"),
    ] {
        insert_join_leave(
            &db,
            created_at,
            "OnPlayerLeft",
            display_name,
            user_id,
            "wrld_public:1",
            600_000,
        );
    }

    let output = get_companions_of(
        &db,
        CompanionsOfInput {
            owner_user_id: "usr_self".into(),
            user_id: "usr_target".into(),
            time_window: TimeWindow::all(),
            limit: Some(10),
        },
    )
    .unwrap();

    assert_eq!(output.rows.len(), 1);
    assert_eq!(output.rows[0].user_id, "usr_alice");
    assert_eq!(output.rows[0].display_name, "AliceNew");
}

#[test]
fn companions_of_reports_world_count_and_truncates_world_samples() {
    let (_dir, db) = test_db("companions-of-world-count");
    create_game_log_tables(&db);
    for (index, location, world_id, world_name) in [
        ("1", "wrld_a:1", "wrld_a", "A World"),
        ("2", "wrld_b:1", "wrld_b", "B World"),
        ("3", "wrld_c:1", "wrld_c", "C World"),
        ("4", "wrld_d:1", "wrld_d", "D World"),
    ] {
        let target_time = format!("2026-06-0{index}T20:15:00Z");
        let alice_time = format!("2026-06-0{index}T20:10:00Z");
        insert_join_leave(
            &db,
            &target_time,
            "OnPlayerLeft",
            "Target",
            "usr_target",
            location,
            900_000,
        );
        insert_join_leave(
            &db,
            &alice_time,
            "OnPlayerLeft",
            "Alice",
            "usr_alice",
            location,
            600_000,
        );
        db.execute_non_query(
            "INSERT INTO gamelog_location (created_at, location, world_id, world_name, time, group_name)
                 VALUES (@created_at, @location, @world_id, @world_name, 900000, '')",
            &crate::common::ParamsBuilder::new()
                .set("created_at", target_time)
                .set("location", location)
                .set("world_id", world_id)
                .set("world_name", world_name)
                .build(),
        )
        .unwrap();
    }

    let output = get_companions_of(
        &db,
        CompanionsOfInput {
            owner_user_id: "usr_self".into(),
            user_id: "usr_target".into(),
            time_window: TimeWindow::all(),
            limit: Some(10),
        },
    )
    .unwrap();

    assert_eq!(output.rows.len(), 1);
    assert_eq!(output.rows[0].world_count, 4);
    assert_eq!(output.rows[0].worlds.len(), 3);
    assert!(output.summary.contains("Alice"));
}

#[test]
fn invite_history_groups_received_and_sent_notifications() {
    let (_dir, db) = test_db("invite-history");
    ensure_realtime_tables(&db, "usrself").unwrap();
    db.execute_non_query(
            "INSERT INTO usrself_notifications
                (id, created_at, type, sender_user_id, sender_username, receiver_user_id, message, world_id, world_name, image_url, invite_message, request_message, response_message, expired)
             VALUES
                ('n1', '2026-06-01T20:00:00Z', 'invite', 'usr_alice', 'Alice', 'usr_self', '', '', '', '', '', '', '', 0),
                ('n2', '2026-06-02T20:00:00Z', 'requestInvite', 'usr_self', 'Self', 'usr_bob', '', '', '', '', '', '', '', 0)",
            &Default::default(),
        )
        .unwrap();
    db.execute_non_query(
            "INSERT INTO usrself_notifications_v2
                (id, created_at, updated_at, expires_at, type, link, link_text, message, title, image_url, seen, sender_user_id, sender_username, data, responses, details)
             VALUES
                ('n3', '2026-06-03T20:00:00Z', '', '', 'invite', '', '', '', '', '', 0, 'usr_alice', 'Alice', '', '', '')",
            &Default::default(),
        )
        .unwrap();

    let output = get_invite_history(
        &db,
        InviteHistoryInput {
            owner_user_id: "usr_self".into(),
            time_window: TimeWindow::all(),
            direction: InviteDirection::Both,
            limit: Some(10),
        },
    )
    .unwrap();

    assert_eq!(output.rows.len(), 2);
    let alice = output
        .rows
        .iter()
        .find(|row| row.user_id == "usr_alice")
        .unwrap();
    assert_eq!(alice.direction, InviteDirection::Received);
    assert_eq!(alice.total_count, 2);
    assert_eq!(alice.last_invite_at, "2026-06-03T20:00:00Z");
    let bob = output
        .rows
        .iter()
        .find(|row| row.user_id == "usr_bob")
        .unwrap();
    assert_eq!(bob.direction, InviteDirection::Sent);
    assert_eq!(bob.total_count, 1);
}

#[test]
fn friend_changes_returns_recent_status_events_by_friend() {
    let (_dir, db) = test_db("friend-changes");
    ensure_realtime_tables(&db, "usrself").unwrap();
    db.execute_non_query(
            "INSERT INTO usrself_feed_status
                (created_at, user_id, display_name, status, status_description, previous_status, previous_status_description)
             VALUES
                ('2026-06-01T20:00:00Z', 'usr_alice', 'Alice', 'join me', 'Open', 'active', 'Busy'),
                ('2026-06-02T20:00:00Z', 'usr_alice', 'Alice', 'active', 'Back later', 'join me', 'Open'),
                ('2026-06-03T20:00:00Z', 'usr_bob', 'Bob', 'ask me', '', 'active', ''),
                ('2026-06-04T20:00:00Z', 'usr_alice', 'Alice', 'join me', 'Again', 'active', 'Back later')",
            &Default::default(),
        )
        .unwrap();

    let output = get_friend_changes(
        &db,
        FriendChangesInput {
            owner_user_id: "usr_self".into(),
            target_user_id: None,
            time_window: TimeWindow::all(),
            kind: FriendChangeKind::Status,
            limit: Some(10),
        },
    )
    .unwrap();

    assert_eq!(output.rows.len(), 2);
    assert_eq!(output.rows[0].user_id, "usr_alice");
    assert_eq!(output.rows[0].change_count, 3);
    assert_eq!(
        output.rows[0].recent_events[0].changed_at,
        "2026-06-04T20:00:00Z"
    );
    assert_eq!(
        output.rows[0].recent_events[0].kind,
        FriendChangeKind::Status
    );

    let bob = get_friend_changes(
        &db,
        FriendChangesInput {
            owner_user_id: "usr_self".into(),
            target_user_id: Some("usr_bob".into()),
            time_window: TimeWindow::all(),
            kind: FriendChangeKind::Status,
            limit: Some(1),
        },
    )
    .unwrap();
    assert_eq!(bob.rows.len(), 1);
    assert_eq!(bob.rows[0].user_id, "usr_bob");
}

fn insert_join_leave(
    db: &DatabaseService,
    created_at: &str,
    kind: &str,
    display_name: &str,
    user_id: &str,
    location: &str,
    millis: i64,
) {
    db.execute_non_query(
        "INSERT INTO gamelog_join_leave (created_at, type, display_name, location, user_id, time)
         VALUES (@created_at, @type, @display_name, @location, @user_id, @time)",
        &crate::common::ParamsBuilder::new()
            .set("created_at", created_at)
            .set("type", kind)
            .set("display_name", display_name)
            .set("location", location)
            .set("user_id", user_id)
            .set("time", millis)
            .build(),
    )
    .unwrap();
}

#[test]
fn fading_friends_ranks_dropped_copresence_for_current_friends() {
    let (_dir, db) = test_db("fading-friends");
    create_game_log_tables(&db);
    ensure_realtime_tables(&db, "usrself").unwrap();
    db.execute_non_query(
        "INSERT INTO usrself_friend_log_current (user_id, display_name, trust_level, friend_number)
             VALUES ('usr_alice', 'Alice', 'Trusted', 1), ('usr_bob', 'Bob', 'Known', 2)",
        &Default::default(),
    )
    .unwrap();
    // Alice: heavy in prior window, almost gone in recent window -> fading.
    insert_join_leave(
        &db,
        "2026-05-05T20:00:00Z",
        "OnPlayerLeft",
        "Alice",
        "usr_alice",
        "wrld_a:1",
        3_600_000,
    );
    insert_join_leave(
        &db,
        "2026-05-10T20:00:00Z",
        "OnPlayerLeft",
        "Alice",
        "usr_alice",
        "wrld_a:1",
        3_600_000,
    );
    insert_join_leave(
        &db,
        "2026-06-10T20:00:00Z",
        "OnPlayerLeft",
        "Alice",
        "usr_alice",
        "wrld_a:1",
        600_000,
    );
    // Bob: steady in both windows -> not fading.
    insert_join_leave(
        &db,
        "2026-05-08T20:00:00Z",
        "OnPlayerLeft",
        "Bob",
        "usr_bob",
        "wrld_b:1",
        1_800_000,
    );
    insert_join_leave(
        &db,
        "2026-06-08T20:00:00Z",
        "OnPlayerLeft",
        "Bob",
        "usr_bob",
        "wrld_b:1",
        1_800_000,
    );
    // Stranger is ignored even with a big drop.
    insert_join_leave(
        &db,
        "2026-05-09T20:00:00Z",
        "OnPlayerLeft",
        "Carol",
        "usr_carol",
        "wrld_c:1",
        3_600_000,
    );

    let output = get_fading_friends(
        &db,
        FadingFriendsInput {
            owner_user_id: "usr_self".into(),
            prior_from: "2026-05-01T00:00:00Z".into(),
            pivot: "2026-06-01T00:00:00Z".into(),
            now: "2026-07-01T00:00:00Z".into(),
            min_prior_minutes: Some(30),
            limit: None,
        },
    )
    .unwrap();

    assert_eq!(output.rows.len(), 1);
    let row = &output.rows[0];
    assert_eq!(row.user_id, "usr_alice");
    assert_eq!(row.prior_minutes, 120);
    assert_eq!(row.recent_minutes, 10);
    assert_eq!(row.prior_co_days, 2);
    assert_eq!(row.recent_co_days, 1);
    assert_eq!(row.drop_percent, 91);
    assert_eq!(row.last_seen_together, "2026-06-10T20:00:00Z");
}

#[test]
fn fading_friends_renamed_user_shows_latest_name() {
    let (_dir, db) = test_db("fading-friends-renamed");
    create_game_log_tables(&db);
    ensure_realtime_tables(&db, "usrself").unwrap();
    db.execute_non_query(
        "INSERT INTO usrself_friend_log_current (user_id, display_name, trust_level, friend_number)
             VALUES ('usr_alice', 'AliceNew', 'Trusted', 1)",
        &Default::default(),
    )
    .unwrap();
    insert_join_leave(
        &db,
        "2026-05-05T20:00:00Z",
        "OnPlayerLeft",
        "AliceOld",
        "usr_alice",
        "wrld_a:1",
        3_600_000,
    );
    insert_join_leave(
        &db,
        "2026-06-10T20:00:00Z",
        "OnPlayerLeft",
        "AliceNew",
        "usr_alice",
        "wrld_a:1",
        600_000,
    );

    let output = get_fading_friends(
        &db,
        FadingFriendsInput {
            owner_user_id: "usr_self".into(),
            prior_from: "2026-05-01T00:00:00Z".into(),
            pivot: "2026-06-01T00:00:00Z".into(),
            now: "2026-07-01T00:00:00Z".into(),
            min_prior_minutes: Some(30),
            limit: None,
        },
    )
    .unwrap();

    assert_eq!(output.rows.len(), 1);
    assert_eq!(output.rows[0].user_id, "usr_alice");
    assert_eq!(output.rows[0].display_name, "AliceNew");
}

#[test]
fn best_time_to_play_ranks_buckets_by_distinct_friends() {
    let (_dir, db) = test_db("best-time");
    ensure_realtime_tables(&db, "usrself").unwrap();
    for (user_id, display_name, created_at) in [
        ("usr_alice", "Alice", "2026-06-01T20:05:00Z"),
        ("usr_bob", "Bob", "2026-06-02T20:30:00Z"),
        ("usr_alice", "Alice", "2026-06-03T20:45:00Z"),
        ("usr_carol", "Carol", "2026-06-04T09:00:00Z"),
    ] {
        db.execute_non_query(
                "INSERT INTO usrself_feed_online_offline
                    (created_at, user_id, display_name, type, location, world_name, time, group_name)
                 VALUES (@created_at, @user_id, @display_name, 'Online', '', '', 0, '')",
                &crate::common::ParamsBuilder::new()
                    .set("created_at", created_at)
                    .set("user_id", user_id)
                    .set("display_name", display_name)
                    .build(),
            )
            .unwrap();
    }

    let output = get_best_time_to_play(
        &db,
        BestTimeToPlayInput {
            owner_user_id: "usr_self".into(),
            time_window: TimeWindow::all(),
            bucket: ActivityBucket::HourOfDay,
            limit: None,
            utc_offset_minutes: None,
        },
    )
    .unwrap();

    assert_eq!(output.rows.len(), 2);
    let top = &output.rows[0];
    assert_eq!(top.bucket, "20");
    assert_eq!(top.label, "20:00-21:00");
    assert_eq!(top.distinct_friends, 2);
    assert_eq!(top.online_events, 3);
    assert_eq!(top.top_friends[0].user_id, "usr_alice");
    assert_eq!(top.top_friends[0].online_events, 2);
}

#[test]
fn best_time_renamed_user_shows_latest_name() {
    let (_dir, db) = test_db("best-time-renamed");
    ensure_realtime_tables(&db, "usrself").unwrap();
    for (display_name, created_at) in [
        ("AliceA", "2026-06-01T20:05:00Z"),
        ("AliceZ", "2026-06-02T20:30:00Z"),
    ] {
        db.execute_non_query(
            "INSERT INTO usrself_feed_online_offline
                (created_at, user_id, display_name, type, location, world_name, time, group_name)
             VALUES (@created_at, 'usr_alice', @display_name, 'Online', '', '', 0, '')",
            &crate::common::ParamsBuilder::new()
                .set("created_at", created_at)
                .set("display_name", display_name)
                .build(),
        )
        .unwrap();
    }

    let output = get_best_time_to_play(
        &db,
        BestTimeToPlayInput {
            owner_user_id: "usr_self".into(),
            time_window: TimeWindow::all(),
            bucket: ActivityBucket::HourOfDay,
            limit: None,
            utc_offset_minutes: None,
        },
    )
    .unwrap();

    assert_eq!(output.rows.len(), 1);
    let top = &output.rows[0];
    assert_eq!(top.bucket, "20");
    assert_eq!(top.distinct_friends, 1);
    assert_eq!(top.online_events, 2);
    assert_eq!(top.top_friends.len(), 1);
    assert_eq!(top.top_friends[0].user_id, "usr_alice");
    assert_eq!(top.top_friends[0].display_name, "AliceZ");
    assert_eq!(top.top_friends[0].online_events, 2);
}

#[test]
fn best_time_renamed_user_shows_latest_name_across_buckets() {
    let (_dir, db) = test_db("best-time-renamed-across-buckets");
    ensure_realtime_tables(&db, "usrself").unwrap();
    for (display_name, created_at) in [
        ("AliceA", "2026-06-01T20:05:00Z"),
        ("AliceZ", "2026-06-02T21:30:00Z"),
    ] {
        db.execute_non_query(
            "INSERT INTO usrself_feed_online_offline
                (created_at, user_id, display_name, type, location, world_name, time, group_name)
             VALUES (@created_at, 'usr_alice', @display_name, 'Online', '', '', 0, '')",
            &crate::common::ParamsBuilder::new()
                .set("created_at", created_at)
                .set("display_name", display_name)
                .build(),
        )
        .unwrap();
    }

    let output = get_best_time_to_play(
        &db,
        BestTimeToPlayInput {
            owner_user_id: "usr_self".into(),
            time_window: TimeWindow::all(),
            bucket: ActivityBucket::HourOfDay,
            limit: None,
            utc_offset_minutes: None,
        },
    )
    .unwrap();

    let bucket_20 = output.rows.iter().find(|row| row.bucket == "20").unwrap();
    assert_eq!(bucket_20.top_friends.len(), 1);
    assert_eq!(bucket_20.top_friends[0].user_id, "usr_alice");
    assert_eq!(bucket_20.top_friends[0].display_name, "AliceZ");
}

#[test]
fn recall_encounter_filters_by_name_and_copresence_including_non_friends() {
    let (_dir, db) = test_db("recall-encounter");
    create_game_log_tables(&db);
    ensure_realtime_tables(&db, "usrself").unwrap();
    db.execute_non_query(
        "INSERT INTO usrself_friend_log_current (user_id, display_name, trust_level, friend_number)
             VALUES ('usr_anchor', 'Anchor', 'Known', 1)",
        &Default::default(),
    )
    .unwrap();
    // Anchor and Luna share wrld_party; Luna is a non-friend stranger.
    insert_join_leave(
        &db,
        "2026-06-10T21:00:00Z",
        "OnPlayerJoined",
        "Anchor",
        "usr_anchor",
        "wrld_party:1",
        0,
    );
    insert_join_leave(
        &db,
        "2026-06-10T21:05:00Z",
        "OnPlayerJoined",
        "LunaBunny",
        "usr_luna",
        "wrld_party:1",
        0,
    );
    insert_join_leave(
        &db,
        "2026-06-12T21:00:00Z",
        "OnPlayerJoined",
        "LunaBunny",
        "usr_luna",
        "wrld_party:1",
        0,
    );
    // Luna also appears in a world Anchor never visited -> excluded by coPresentWith.
    insert_join_leave(
        &db,
        "2026-06-11T10:00:00Z",
        "OnPlayerJoined",
        "LunaBunny",
        "usr_luna",
        "wrld_solo:1",
        0,
    );
    // Different person should be filtered out by the name query.
    insert_join_leave(
        &db,
        "2026-06-10T21:10:00Z",
        "OnPlayerJoined",
        "Zephyr",
        "usr_zephyr",
        "wrld_party:1",
        0,
    );

    let output = recall_encounter(
        &db,
        RecallEncounterInput {
            owner_user_id: "usr_self".into(),
            name_query: Some("luna".into()),
            world_id: None,
            co_present_with_user_id: Some("usr_anchor".into()),
            time_window: TimeWindow::all(),
            limit: None,
        },
    )
    .unwrap();

    assert_eq!(output.rows.len(), 1);
    let row = &output.rows[0];
    assert_eq!(row.user_id, "usr_luna");
    assert_eq!(row.display_name, "LunaBunny");
    assert_eq!(row.encounter_count, 2);
    assert_eq!(row.encounter_days, 2);
    assert_eq!(row.last_seen, "2026-06-12T21:00:00Z");
    assert!(!row.is_friend);
    assert_eq!(row.sample_locations, vec!["wrld_party:1".to_string()]);

    // coPresentWith must not return the anchor user as their own companion.
    let anchored = recall_encounter(
        &db,
        RecallEncounterInput {
            owner_user_id: "usr_self".into(),
            name_query: None,
            world_id: None,
            co_present_with_user_id: Some("usr_anchor".into()),
            time_window: TimeWindow::all(),
            limit: None,
        },
    )
    .unwrap();
    assert!(anchored.rows.iter().all(|row| row.user_id != "usr_anchor"));
    assert!(anchored.rows.iter().any(|row| row.user_id == "usr_luna"));
}

#[test]
fn tool_outputs_include_global_data_caveat_resource_text() {
    let value = data_caveats_resource();
    assert!(value.contains("observer-centered"));
    assert!(value.contains("not a global VRChat record"));
    assert_eq!(
        json!(global_caveats()).as_array().unwrap().len(),
        global_caveats().len()
    );
}
