use super::test_support::*;
use super::*;
use crate::common::ParamsBuilder;
use crate::database::DatabaseService;
use crate::ownership::OwnerId;

const OWNER_USER_ID: &str = "usr_self";
const USER_PREFIX: &str = "usrself";

fn setup(name: &str) -> (TestDir, std::sync::Arc<DatabaseService>) {
    let (dir, db) = test_db(name);
    ensure_realtime_tables(&db, USER_PREFIX).unwrap();
    (dir, db)
}

fn add_friend(db: &DatabaseService, user_id: &str, display_name: &str) {
    db.execute_non_query(
        &format!(
            "INSERT INTO {USER_PREFIX}_friend_log_current (user_id, display_name, trust_level, friend_number)
             VALUES (@user_id, @display_name, 'trusted', 1)"
        ),
        &ParamsBuilder::new()
            .set("user_id", user_id)
            .set("display_name", display_name)
            .build(),
    )
    .unwrap();
}

fn insert_gps(db: &DatabaseService, created_at: &str, user_id: &str, location: &str) {
    db.execute_non_query(
        &format!(
            "INSERT INTO {USER_PREFIX}_feed_gps (created_at, user_id, display_name, location, world_name, previous_location, time, group_name)
             VALUES (@created_at, @user_id, 'Stale Name', @location, '', '', 0, '')"
        ),
        &ParamsBuilder::new()
            .set("created_at", created_at)
            .set("user_id", user_id)
            .set("location", location)
            .build(),
    )
    .unwrap();
}

fn insert_online_offline(
    db: &DatabaseService,
    created_at: &str,
    user_id: &str,
    kind: &str,
    location: &str,
) {
    db.execute_non_query(
        &format!(
            "INSERT INTO {USER_PREFIX}_feed_online_offline (created_at, user_id, display_name, type, location, world_name, time, group_name)
             VALUES (@created_at, @user_id, 'Stale Name', @type, @location, '', 0, '')"
        ),
        &ParamsBuilder::new()
            .set("created_at", created_at)
            .set("user_id", user_id)
            .set("type", kind)
            .set("location", location)
            .build(),
    )
    .unwrap();
}

#[test]
fn world_friend_visits_counts_only_current_friends() {
    let (_dir, db) = setup("friend-visits-current-friends");
    add_friend(&db, "usr_alice", "Alice");
    insert_gps(&db, "2026-08-01T10:00:00Z", "usr_alice", "wrld_alpha:1");
    insert_gps(&db, "2026-08-02T10:00:00Z", "usr_bob", "wrld_alpha:2");

    let output = get_world_friend_visits(&db, &OwnerId::new(OWNER_USER_ID), "wrld_alpha").unwrap();

    assert_eq!(output.friend_count, 1);
    assert_eq!(output.friends.len(), 1);
    assert_eq!(output.friends[0].user_id, "usr_alice");
    assert_eq!(output.friends[0].display_name, "Alice");
    assert_eq!(output.last_visited_at, "2026-08-01T10:00:00Z");
}

#[test]
fn world_friend_visits_merges_gps_and_online_rows() {
    let (_dir, db) = setup("friend-visits-merge-sources");
    add_friend(&db, "usr_alice", "Alice");
    insert_gps(&db, "2026-08-01T10:00:00Z", "usr_alice", "wrld_alpha:1");
    insert_online_offline(
        &db,
        "2026-08-03T10:00:00Z",
        "usr_alice",
        "Online",
        "wrld_alpha:2",
    );
    insert_online_offline(
        &db,
        "2026-08-04T10:00:00Z",
        "usr_alice",
        "Offline",
        "wrld_alpha:2",
    );

    let output = get_world_friend_visits(&db, &OwnerId::new(OWNER_USER_ID), "wrld_alpha").unwrap();

    assert_eq!(output.friend_count, 1);
    assert_eq!(output.friends[0].visit_count, 2);
    assert_eq!(output.friends[0].last_visited_at, "2026-08-03T10:00:00Z");
}

#[test]
fn world_friend_visits_matches_world_id_boundary_exactly() {
    let (_dir, db) = setup("friend-visits-world-boundary");
    add_friend(&db, "usr_alice", "Alice");
    add_friend(&db, "usr_bob", "Bob");
    insert_gps(&db, "2026-08-01T10:00:00Z", "usr_alice", "wrld_alpha");
    insert_gps(&db, "2026-08-02T10:00:00Z", "usr_bob", "wrld_alphax:1");
    insert_gps(&db, "2026-08-03T10:00:00Z", "usr_bob", "wrld_alphb:1");

    let output = get_world_friend_visits(&db, &OwnerId::new(OWNER_USER_ID), "wrld_alpha").unwrap();

    assert_eq!(output.friend_count, 1);
    assert_eq!(output.friends[0].user_id, "usr_alice");
}

#[test]
fn world_friend_visits_returns_empty_for_non_world_target() {
    let (_dir, db) = setup("friend-visits-non-world");
    add_friend(&db, "usr_alice", "Alice");
    insert_gps(&db, "2026-08-01T10:00:00Z", "usr_alice", "wrld_alpha:1");

    let output = get_world_friend_visits(&db, &OwnerId::new(OWNER_USER_ID), "private").unwrap();

    assert_eq!(output.friend_count, 0);
    assert!(output.friends.is_empty());
    assert!(output.last_visited_at.is_empty());
}

fn recent_counts(db: &DatabaseService, world_ids: &[&str], since: &str) -> Vec<(String, i64)> {
    let world_ids = world_ids
        .iter()
        .map(|world_id| world_id.to_string())
        .collect::<Vec<_>>();
    get_world_recent_friend_counts(db, &OwnerId::new(OWNER_USER_ID), &world_ids, since)
        .unwrap()
        .into_iter()
        .map(|row| (row.world_id, row.friend_count))
        .collect()
}

#[test]
fn world_recent_friend_counts_respects_window_cutoff() {
    let (_dir, db) = setup("recent-counts-window");
    add_friend(&db, "usr_alice", "Alice");
    add_friend(&db, "usr_bob", "Bob");
    insert_gps(&db, "2026-08-03T23:59:59.000Z", "usr_alice", "wrld_alpha:1");
    insert_gps(&db, "2026-08-04T00:00:00.000Z", "usr_bob", "wrld_alpha:1");

    let counts = recent_counts(&db, &["wrld_alpha"], "2026-08-04T00:00:00.000Z");

    assert_eq!(counts, vec![("wrld_alpha".to_string(), 1)]);
}

#[test]
fn world_recent_friend_counts_counts_each_friend_once() {
    let (_dir, db) = setup("recent-counts-distinct");
    add_friend(&db, "usr_alice", "Alice");
    insert_gps(&db, "2026-08-05T10:00:00.000Z", "usr_alice", "wrld_alpha:1");
    insert_gps(&db, "2026-08-06T10:00:00.000Z", "usr_alice", "wrld_alpha:2");
    insert_online_offline(
        &db,
        "2026-08-07T10:00:00.000Z",
        "usr_alice",
        "Online",
        "wrld_alpha:1",
    );

    let counts = recent_counts(&db, &["wrld_alpha"], "2026-08-01T00:00:00.000Z");

    assert_eq!(counts, vec![("wrld_alpha".to_string(), 1)]);
}

#[test]
fn world_recent_friend_counts_excludes_non_friends_and_offline_rows() {
    let (_dir, db) = setup("recent-counts-non-friends");
    add_friend(&db, "usr_alice", "Alice");
    insert_gps(
        &db,
        "2026-08-05T10:00:00.000Z",
        "usr_stranger",
        "wrld_alpha:1",
    );
    insert_online_offline(
        &db,
        "2026-08-05T11:00:00.000Z",
        "usr_alice",
        "Offline",
        "wrld_alpha:1",
    );

    let counts = recent_counts(&db, &["wrld_alpha"], "2026-08-01T00:00:00.000Z");

    assert!(counts.is_empty());
}

#[test]
fn world_recent_friend_counts_batches_worlds_and_matches_instance_suffixes() {
    let (_dir, db) = setup("recent-counts-batch");
    add_friend(&db, "usr_alice", "Alice");
    add_friend(&db, "usr_bob", "Bob");
    insert_gps(
        &db,
        "2026-08-05T10:00:00.000Z",
        "usr_alice",
        "wrld_alpha:1~hidden(usr_x)",
    );
    insert_gps(&db, "2026-08-05T10:00:00.000Z", "usr_bob", "wrld_alpha");
    insert_gps(&db, "2026-08-05T10:00:00.000Z", "usr_bob", "wrld_beta:7");
    insert_gps(&db, "2026-08-05T10:00:00.000Z", "usr_bob", "wrld_alphax:1");
    insert_gps(&db, "2026-08-05T10:00:00.000Z", "usr_bob", "wrld_gamma:1");

    let counts = recent_counts(
        &db,
        &["wrld_alpha", "wrld_beta", "private", "wrld_missing"],
        "2026-08-01T00:00:00.000Z",
    );

    assert_eq!(
        counts,
        vec![("wrld_alpha".to_string(), 2), ("wrld_beta".to_string(), 1)]
    );
}
