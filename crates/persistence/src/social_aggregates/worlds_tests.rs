use super::test_support::*;
use super::*;

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
