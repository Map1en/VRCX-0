use super::test_support::*;
use super::*;

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
fn copresence_is_account_scoped_and_includes_shared_history() {
    let (_dir, db) = test_db("copresence-owner-scope");
    for (owner_user_id, created_at, display_name, user_id, millis) in [
        ("", "2026-06-01T10:00:00Z", "Shared", "usr_shared", 60_000),
        (
            "usr_a",
            "2026-06-01T10:01:00Z",
            "Account A",
            "usr_a_friend",
            120_000,
        ),
        (
            "usr_b",
            "2026-06-01T10:02:00Z",
            "Account B",
            "usr_b_friend",
            180_000,
        ),
    ] {
        crate::game_log::write_batch(
            &db,
            owner_user_id,
            &crate::game_log::GameLogWriteBatch {
                join_leave: vec![crate::game_log::GameLogJoinLeaveEntry {
                    created_at: created_at.into(),
                    event_type: "OnPlayerLeft".into(),
                    display_name: display_name.into(),
                    location: "wrld_scope:1".into(),
                    user_id: user_id.into(),
                    world_name: String::new(),
                    time: millis,
                }],
                ..Default::default()
            },
        )
        .unwrap();
    }

    let visible_names = |owner_user_id: &str| {
        get_copresence_summary(
            &db,
            CopresenceSummaryInput {
                time_window: TimeWindow::all(),
                group_by: CopresenceGroupBy::Friend,
                min_minutes: None,
                limit: None,
                owner_user_id: Some(owner_user_id.into()),
                friends_only: false,
            },
        )
        .unwrap()
        .rows
        .into_iter()
        .map(|row| row.display_name)
        .collect::<std::collections::HashSet<_>>()
    };
    assert_eq!(
        visible_names("usr_a"),
        std::collections::HashSet::from(["Shared".into(), "Account A".into()])
    );
    assert_eq!(
        visible_names("usr_b"),
        std::collections::HashSet::from(["Shared".into(), "Account B".into()])
    );
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
