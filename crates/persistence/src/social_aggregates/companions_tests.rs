use super::test_support::*;
use super::*;

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
