use super::test_support::*;
use super::*;

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
