use super::test_support::*;
use super::types::TopVisitedWorldsInput;
use super::*;
use crate::ownership::OwnerId;

#[test]
fn search_worlds_visited_returns_recent_world_candidates() {
    let (_dir, db) = test_db("worlds-visited");
    create_game_log_tables(&db);
    db.execute_non_query(
            "INSERT INTO gamelog_location (created_at, location, world_id, world_name, time, group_name)
             VALUES
             ('2026-06-01T22:00:00Z', 'wrld_parkour:1~hidden(usr_host)', 'wrld_parkour', 'Parkour Night', 1800000, ''),
             ('2026-06-01T20:00:00Z', 'wrld_chill:2', 'wrld_chill', 'Chill Room', 600000, '')",
            &Default::default(),
        )
        .unwrap();

    let output = search_worlds_visited(
        &db,
        &OwnerId::new("usr_test"),
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
    assert_eq!(
        output.rows[0].left_at.as_deref(),
        Some("2026-06-01T22:30:00.000Z")
    );
    let row = serde_json::to_value(&output.rows[0]).unwrap();
    assert_eq!(row["accessType"], "friends+");
    assert!(!row.to_string().contains("usr_host"), "{row}");
    assert!(output.summary.contains("Parkour Night (1)"));
}

#[test]
fn favorite_local_supports_kind_action_and_dry_run() {
    let (_dir, db) = test_db("favorite-local-dry-run");

    let output = favorite_local(
        &db,
        &OwnerId::new("usr_test"),
        favorite_friend_input(FavoriteAction::Add, true),
    )
    .unwrap();

    assert!(output.dry_run);
    assert_eq!(output.kind, vrcx_0_core::FavoriteEntityKind::Friend);
    assert_eq!(output.entity_id, "usr_alice");
    assert_eq!(output.action, FavoriteAction::Add);
    assert!(crate::favorites::favorite_list(
        &db,
        Some(&OwnerId::new("usr_test")),
        vrcx_0_core::FavoriteEntityKind::Friend,
    )
    .unwrap()
    .is_empty());

    favorite_local(
        &db,
        &OwnerId::new("usr_test"),
        favorite_friend_input(FavoriteAction::Add, false),
    )
    .unwrap();
    assert_eq!(
        crate::favorites::favorite_list(
            &db,
            Some(&OwnerId::new("usr_test")),
            vrcx_0_core::FavoriteEntityKind::Friend,
        )
        .unwrap()
        .len(),
        1
    );

    favorite_local(
        &db,
        &OwnerId::new("usr_test"),
        favorite_friend_input(FavoriteAction::Remove, true),
    )
    .unwrap();
    assert_eq!(
        crate::favorites::favorite_list(
            &db,
            Some(&OwnerId::new("usr_test")),
            vrcx_0_core::FavoriteEntityKind::Friend,
        )
        .unwrap()
        .len(),
        1
    );

    favorite_local(
        &db,
        &OwnerId::new("usr_test"),
        favorite_friend_input(FavoriteAction::Remove, false),
    )
    .unwrap();
    assert!(crate::favorites::favorite_list(
        &db,
        Some(&OwnerId::new("usr_test")),
        vrcx_0_core::FavoriteEntityKind::Friend,
    )
    .unwrap()
    .is_empty());
}

#[test]
fn top_visited_worlds_counts_every_visit_under_the_latest_world_name() {
    let (_dir, db) = test_db("worlds-top-visited");
    create_game_log_tables(&db);
    db.execute_non_query(
        "INSERT INTO gamelog_location (created_at, location, world_id, world_name, time, group_name)
         VALUES
         ('2026-06-01T20:00:00Z', 'wrld_a:1', 'wrld_a', 'Zeta Old Name', 600000, ''),
         ('2026-06-01T21:00:00Z', 'wrld_a:2', 'wrld_a', 'Alpha New Name', 1200000, ''),
         ('2026-06-01T22:00:00Z', 'wrld_b:1', 'wrld_b', 'Beta', 600000, '')",
        &Default::default(),
    )
    .unwrap();

    let rows = top_visited_worlds(
        &db,
        &OwnerId::new("usr_test"),
        TopVisitedWorldsInput {
            time_window: TimeWindow {
                from: None,
                to: None,
            },
            limit: 5,
        },
    )
    .unwrap();

    assert_eq!(rows[0].world_id, "wrld_a");
    assert_eq!(rows[0].world_name, "Alpha New Name");
    assert_eq!(rows[0].visits, 2);
    assert_eq!(rows[0].total_minutes, 30);
    assert_eq!(rows[0].last_visited_at, "2026-06-01T21:00:00Z");
    assert_eq!(rows[1].world_id, "wrld_b");
}

#[test]
fn world_visit_history_totals_one_world_and_lists_recent_visits() {
    let (_dir, db) = test_db("world-visit-history");
    create_game_log_tables(&db);
    db.execute_non_query(
        "INSERT INTO gamelog_location (created_at, location, world_id, world_name, time, group_name)
         VALUES
         ('2026-05-01T20:00:00Z', 'wrld_pier:1', 'wrld_pier', 'Night Pier', 1200000, ''),
         ('2026-06-01T20:00:00Z', 'wrld_pier:2~private(usr_host)', 'wrld_pier', 'Night Pier', 600000, ''),
         ('2026-06-02T20:00:00Z', 'wrld_loft:1', 'wrld_loft', 'Cozy Loft', 600000, '')",
        &Default::default(),
    )
    .unwrap();

    let history = world_visit_history(&db, &OwnerId::new("usr_test"), "wrld_pier", 1).unwrap();

    assert_eq!(history.visits, 2);
    assert_eq!(history.total_minutes, 30);
    assert_eq!(history.first_visited_at, "2026-05-01T20:00:00Z");
    assert_eq!(history.last_visited_at, "2026-06-01T20:00:00Z");
    assert_eq!(history.recent_visits.len(), 1);
    assert_eq!(history.recent_visits[0].visited_at, "2026-06-01T20:00:00Z");
    assert_eq!(history.recent_visits[0].access_type, "invite");
}

#[test]
fn world_visit_history_lists_who_was_there_on_each_recent_visit() {
    let (_dir, db) = test_db("world-visit-people");
    create_game_log_tables(&db);
    db.execute_non_query(
        "INSERT INTO gamelog_location (created_at, location, world_id, world_name, time, group_name)
         VALUES
         ('2026-06-01T20:00:00Z', 'wrld_pier:1', 'wrld_pier', 'Night Pier', 1800000, ''),
         ('2026-06-02T20:00:00Z', 'wrld_pier:1', 'wrld_pier', 'Night Pier', 1800000, '')",
        &Default::default(),
    )
    .unwrap();
    for (created_at, name, user_id, millis) in [
        ("2026-06-01T20:10:00Z", "Alice", "usr_alice", 300_000),
        ("2026-06-01T20:30:00Z", "Bob", "usr_bob", 1_200_000),
        ("2026-06-01T20:30:00Z", "Me", "usr_test", 1_800_000),
        ("2026-06-02T20:20:00Z", "Carol", "usr_carol", 600_000),
    ] {
        insert_join_leave(
            &db,
            created_at,
            "OnPlayerLeft",
            name,
            user_id,
            "wrld_pier:1",
            millis,
        );
    }

    let history = world_visit_history(&db, &OwnerId::new("usr_test"), "wrld_pier", 5).unwrap();

    let people = history
        .recent_visits
        .iter()
        .map(|visit| visit.people.clone().unwrap_or_default())
        .collect::<Vec<_>>();
    assert_eq!(people, [vec!["Carol"], vec!["Bob", "Alice"]]);
}

#[test]
fn find_visited_worlds_ranks_exact_names_first() {
    let (_dir, db) = test_db("find-visited-worlds");
    create_game_log_tables(&db);
    db.execute_non_query(
        "INSERT INTO gamelog_location (created_at, location, world_id, world_name, time, group_name)
         VALUES
         ('2026-06-03T20:00:00Z', 'wrld_pier2:1', 'wrld_pier2', 'Night Pier 2', 0, ''),
         ('2026-06-01T20:00:00Z', 'wrld_pier:1', 'wrld_pier', 'Night Pier', 0, ''),
         ('2026-06-02T20:00:00Z', 'wrld_loft:1', 'wrld_loft', 'Cozy Loft', 0, '')",
        &Default::default(),
    )
    .unwrap();

    let matches = find_visited_worlds(&db, &OwnerId::new("usr_test"), "night pier", 5).unwrap();

    let ids = matches
        .iter()
        .map(|row| row.world_id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(ids, ["wrld_pier", "wrld_pier2"]);
}
