use super::caveats::best_time_caveats;
use super::test_support::*;
use super::*;
use crate::ownership::OwnerId;

fn insert_event(
    db: &crate::database::DatabaseService,
    kind: &str,
    created_at: &str,
    user_id: &str,
    display_name: &str,
) {
    db.execute_non_query(
        "INSERT INTO usrself_feed_online_offline
            (created_at, user_id, display_name, type, location, world_name, time, group_name)
         VALUES (@created_at, @user_id, @display_name, @type, '', '', 0, '')",
        &crate::common::ParamsBuilder::new()
            .set("created_at", created_at)
            .set("user_id", user_id)
            .set("display_name", display_name)
            .set("type", kind)
            .build(),
    )
    .unwrap();
}

fn insert_online_event(
    db: &crate::database::DatabaseService,
    created_at: &str,
    user_id: &str,
    display_name: &str,
) {
    insert_event(db, "Online", created_at, user_id, display_name);
}

fn input(owner_user_id: &OwnerId, bucket: ActivityBucket) -> BestTimeToPlayInput {
    BestTimeToPlayInput {
        owner_user_id: owner_user_id.clone(),
        time_window: TimeWindow::all(),
        bucket,
        limit: None,
        utc_offset_minutes: None,
    }
}

#[test]
fn returns_empty_rows_when_owner_has_no_feed_table_yet() {
    let (_dir, db) = test_db("best-time-no-table");

    let output = get_best_time_to_play(
        &db,
        input(&OwnerId::new("usr_self"), ActivityBucket::HourOfDay),
    )
    .unwrap();

    assert!(output.rows.is_empty());
    assert_eq!(output.caveats, best_time_caveats());
}

#[test]
fn counts_only_online_events_and_ranks_friends_within_a_bucket() {
    let (_dir, db) = test_db("best-time-basic");
    ensure_realtime_tables(&db, "usrself").unwrap();
    insert_online_event(&db, "2026-06-01T18:05:00Z", "usr_alice", "Alice");
    insert_online_event(&db, "2026-06-02T18:10:00Z", "usr_alice", "Alice");
    insert_online_event(&db, "2026-06-02T18:20:00Z", "usr_bob", "Bob");
    insert_event(&db, "Offline", "2026-06-02T18:30:00Z", "usr_carol", "Carol");

    let output = get_best_time_to_play(
        &db,
        input(&OwnerId::new("usr_self"), ActivityBucket::HourOfDay),
    )
    .unwrap();

    assert_eq!(output.rows.len(), 1);
    let bucket = &output.rows[0];
    assert_eq!(bucket.bucket, "18");
    assert_eq!(bucket.label, "18:00-19:00");
    assert_eq!(bucket.distinct_friends, 2);
    assert_eq!(bucket.online_events, 3);
    assert_eq!(bucket.top_friends[0].user_id, "usr_alice");
    assert_eq!(bucket.top_friends[0].online_events, 2);
    assert_eq!(bucket.top_friends[1].user_id, "usr_bob");
    assert_eq!(bucket.top_friends[1].online_events, 1);
}

#[test]
fn ranks_buckets_by_distinct_friends_before_online_event_count() {
    let (_dir, db) = test_db("best-time-rank-buckets");
    ensure_realtime_tables(&db, "usrself").unwrap();
    insert_online_event(&db, "2026-06-01T20:05:00Z", "usr_alice", "Alice");
    insert_online_event(&db, "2026-06-02T20:30:00Z", "usr_bob", "Bob");
    for created_at in [
        "2026-06-01T09:00:00Z",
        "2026-06-02T09:00:00Z",
        "2026-06-03T09:00:00Z",
    ] {
        insert_online_event(&db, created_at, "usr_carol", "Carol");
    }

    let output = get_best_time_to_play(
        &db,
        input(&OwnerId::new("usr_self"), ActivityBucket::HourOfDay),
    )
    .unwrap();

    assert_eq!(
        output
            .rows
            .iter()
            .map(|row| (row.bucket.as_str(), row.distinct_friends, row.online_events))
            .collect::<Vec<_>>(),
        vec![("20", 2, 2), ("09", 1, 3)]
    );
}

#[test]
fn truncates_top_friends_to_five_but_keeps_true_distinct_count() {
    let (_dir, db) = test_db("best-time-truncate");
    ensure_realtime_tables(&db, "usrself").unwrap();
    for index in 0..6 {
        insert_online_event(
            &db,
            "2026-06-01T09:00:00Z",
            &format!("usr_{index}"),
            &format!("Friend{index}"),
        );
    }

    let output = get_best_time_to_play(
        &db,
        input(&OwnerId::new("usr_self"), ActivityBucket::HourOfDay),
    )
    .unwrap();

    assert_eq!(output.rows.len(), 1);
    assert_eq!(output.rows[0].distinct_friends, 6);
    assert_eq!(output.rows[0].top_friends.len(), 5);
}

#[test]
fn day_of_week_bucket_groups_by_weekday_with_readable_label() {
    let (_dir, db) = test_db("best-time-weekday");
    ensure_realtime_tables(&db, "usrself").unwrap();
    insert_online_event(&db, "2026-06-01T09:00:00Z", "usr_alice", "Alice");
    insert_online_event(&db, "2026-06-08T09:00:00Z", "usr_alice", "Alice");

    let output = get_best_time_to_play(
        &db,
        input(&OwnerId::new("usr_self"), ActivityBucket::DayOfWeek),
    )
    .unwrap();

    assert_eq!(output.rows.len(), 1);
    assert_eq!(output.rows[0].bucket, "0");
    assert_eq!(output.rows[0].label, "Monday");
    assert_eq!(output.rows[0].online_events, 2);
}

#[test]
fn utc_offset_shifts_hour_bucket_into_local_time_and_notes_it_in_caveats() {
    let (_dir, db) = test_db("best-time-offset");
    ensure_realtime_tables(&db, "usrself").unwrap();
    insert_online_event(&db, "2026-06-01T23:30:00Z", "usr_alice", "Alice");

    let mut request = input(&OwnerId::new("usr_self"), ActivityBucket::HourOfDay);
    request.utc_offset_minutes = Some(9 * 60);
    let output = get_best_time_to_play(&db, request).unwrap();

    assert_eq!(output.rows.len(), 1);
    assert_eq!(output.rows[0].bucket, "08");
    assert!(output
        .caveats
        .iter()
        .any(|caveat| caveat.contains("UTC+09:00")));
}

#[test]
fn limit_is_clamped_to_at_least_one_bucket() {
    let (_dir, db) = test_db("best-time-limit");
    ensure_realtime_tables(&db, "usrself").unwrap();
    insert_online_event(&db, "2026-06-01T09:00:00Z", "usr_alice", "Alice");
    insert_online_event(&db, "2026-06-01T21:00:00Z", "usr_bob", "Bob");

    let mut request = input(&OwnerId::new("usr_self"), ActivityBucket::HourOfDay);
    request.limit = Some(0);
    let output = get_best_time_to_play(&db, request).unwrap();

    assert_eq!(output.rows.len(), 1);
}

#[test]
fn tolerates_an_out_of_range_utc_offset() {
    let (_dir, db) = test_db("best-time-min-offset");
    ensure_realtime_tables(&db, "usrself").unwrap();
    insert_online_event(&db, "2026-06-01T18:05:00Z", "usr_alice", "Alice");

    let output = get_best_time_to_play(
        &db,
        BestTimeToPlayInput {
            utc_offset_minutes: Some(i64::MIN),
            ..input(&OwnerId::new("usr_self"), ActivityBucket::HourOfDay)
        },
    );

    assert!(output.is_ok());
}
