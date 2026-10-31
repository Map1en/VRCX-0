use super::test_support::*;
use super::*;
use crate::ownership::OwnerId;

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
            owner_user_id: OwnerId::new("usr_self"),
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
fn friend_activity_pattern_numbers_weekdays_from_monday_like_the_activity_histogram() {
    let (_dir, db) = test_db("activity-pattern-weekday");
    ensure_realtime_tables(&db, "usrself").unwrap();
    for created_at in ["2026-06-01T18:05:00Z", "2026-06-07T18:05:00Z"] {
        db.execute_non_query(
            "INSERT INTO usrself_feed_online_offline
                (created_at, user_id, display_name, type, location, world_name, time, group_name)
             VALUES (@created_at, 'usr_alice', 'Alice', 'Online', '', '', 0, '')",
            &crate::common::ParamsBuilder::new()
                .set("created_at", created_at)
                .build(),
        )
        .unwrap();
    }

    let output = get_friend_activity_pattern(
        &db,
        FriendActivityPatternInput {
            owner_user_id: OwnerId::new("usr_self"),
            user_id: Some("usr_alice".into()),
            time_window: TimeWindow::all(),
            bucket: ActivityBucket::DayOfWeek,
            utc_offset_minutes: None,
        },
    )
    .unwrap();

    assert_eq!(output.rows[0].buckets.get("0"), Some(&1));
    assert_eq!(output.rows[0].buckets.get("6"), Some(&1));
    assert_eq!(output.rows[0].typical_online_window, "Monday");
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
            owner_user_id: OwnerId::new("usr_self"),
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
            owner_user_id: OwnerId::new("usr_self"),
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
            owner_user_id: OwnerId::new("usr_self"),
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
            owner_user_id: OwnerId::new("usr_self"),
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
