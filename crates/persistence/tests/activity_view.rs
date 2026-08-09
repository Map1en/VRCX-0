use std::path::PathBuf;
use std::sync::{Arc, Barrier};

use chrono::DateTime;
use serde_json::json;
use vrcx_0_persistence::activity::{
    activity_bucket_cache_get, activity_bucket_cache_upsert,
    activity_friend_presence_last_created_at, activity_friend_status_distribution,
    activity_overlap_view_build, activity_self_sessions_warmup, activity_sessions_replace,
    activity_sync_state_get, activity_sync_state_upsert, activity_view_build,
    ActivityBucketCacheInput, ActivityBucketCacheQueryInput, ActivityOverlapViewBuildInput,
    ActivitySessionInput, ActivitySyncStateInput, ActivityViewBuildInput, ActivityViewKind,
    ActivityViewOutput,
};
use vrcx_0_persistence::game_log::{write_batch, GameLogLocationEntry, GameLogWriteBatch};
use vrcx_0_persistence::realtime::{write_realtime_batch, RealtimePersistenceBatch};
use vrcx_0_persistence::DatabaseService;

struct TestDir {
    path: PathBuf,
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

fn test_db(name: &str) -> (TestDir, Arc<DatabaseService>) {
    let dir = TestDir::new(name);
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap());
    (dir, db)
}

fn ms(value: &str) -> i64 {
    DateTime::parse_from_rfc3339(value)
        .unwrap()
        .timestamp_millis()
}

fn buckets_with(slot: usize, value: f64) -> Vec<f64> {
    let mut buckets = vec![0.0; 168];
    buckets[slot] = value;
    buckets
}

fn upsert_self_sync(db: &DatabaseService, user_id: &str, cursor: &str) {
    activity_sync_state_upsert(
        db,
        ActivitySyncStateInput {
            user_id: user_id.to_string(),
            updated_at: "2025-01-06T00:00:00Z".to_string(),
            is_self: true,
            source_last_created_at: cursor.to_string(),
            pending_session_start_at: None,
            cached_range_days: json!(7),
        },
    )
    .unwrap();
}

fn replace_self_session(db: &DatabaseService, user_id: &str, start: &str, end: &str) {
    activity_sessions_replace(
        db,
        user_id.to_string(),
        vec![ActivitySessionInput {
            start: json!(ms(start)),
            end: json!(ms(end)),
            is_open_tail: false,
            source_revision: "self-cursor".to_string(),
        }],
    )
    .unwrap();
}

fn add_presence(
    db: &DatabaseService,
    owner_user_id: &str,
    target_user_id: &str,
    created_at: &str,
    kind: &str,
) {
    write_realtime_batch(
        db,
        owner_user_id,
        &RealtimePersistenceBatch {
            feed_entries: vec![json!({
                "created_at": created_at,
                "userId": target_user_id,
                "displayName": "Friend",
                "type": kind,
                "location": "",
                "worldName": "",
                "time": 0,
                "groupName": ""
            })],
            ..RealtimePersistenceBatch::default()
        },
    )
    .unwrap();
}

fn add_status(
    db: &DatabaseService,
    owner_user_id: &str,
    target_user_id: &str,
    created_at: &str,
    status: &str,
) {
    let normalized = status
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect::<String>()
        .to_ascii_lowercase();
    let previous_status = if normalized == "active" || normalized == "online" {
        "busy"
    } else {
        "active"
    };
    add_status_with_previous(
        db,
        owner_user_id,
        target_user_id,
        created_at,
        status,
        previous_status,
    );
}

fn add_status_with_previous(
    db: &DatabaseService,
    owner_user_id: &str,
    target_user_id: &str,
    created_at: &str,
    status: &str,
    previous_status: &str,
) {
    write_realtime_batch(
        db,
        owner_user_id,
        &RealtimePersistenceBatch {
            feed_entries: vec![json!({
                "created_at": created_at,
                "userId": target_user_id,
                "displayName": "Friend",
                "type": "Status",
                "status": status,
                "statusDescription": "",
                "previousStatus": previous_status,
                "previousStatusDescription": ""
            })],
            ..RealtimePersistenceBatch::default()
        },
    )
    .unwrap();
}

#[test]
fn activity_friend_status_distribution_counts_four_status_logs_in_range() {
    let (_dir, db) = test_db("activity-friend-status-distribution");
    let owner = "usr_owner";
    let friend = "usr_friend";
    add_status(&db, owner, friend, "2024-12-20T00:00:00Z", "join me");
    add_status(&db, owner, friend, "2025-01-01T00:00:00Z", "Join_Me");
    add_status(&db, owner, friend, "2025-01-02T00:00:00Z", "ACTIVE");
    add_status(&db, owner, friend, "2025-01-03T00:00:00Z", "online");
    add_status(&db, owner, friend, "2025-01-04T00:00:00Z", "ask-me");
    add_status(&db, owner, friend, "2025-01-05T00:00:00Z", "busy");
    add_status_with_previous(
        &db,
        owner,
        friend,
        "2025-01-05T00:30:00Z",
        "active",
        "active",
    );
    add_status(&db, owner, friend, "2025-01-05T01:00:00Z", "offline");
    add_status(&db, owner, "usr_other", "2025-01-05T02:00:00Z", "busy");

    let recent =
        activity_friend_status_distribution(&db, owner, friend, 7, ms("2025-01-06T00:00:00Z"))
            .unwrap();
    assert_eq!(recent.join_me_count, 1);
    assert_eq!(recent.active_count, 2);
    assert_eq!(recent.ask_me_count, 1);
    assert_eq!(recent.busy_count, 1);
    assert_eq!(recent.total_count, 5);

    let all =
        activity_friend_status_distribution(&db, owner, friend, 0, ms("2025-01-06T00:00:00Z"))
            .unwrap();
    assert_eq!(all.join_me_count, 2);
    assert_eq!(all.total_count, 6);
}

#[test]
fn cached_friend_activity_view_refreshes_status_distribution_independently() {
    let (_dir, db) = test_db("activity-friend-status-cache");
    let owner = "usr_owner";
    let friend = "usr_friend";
    add_status(&db, owner, friend, "2025-01-04T00:00:00Z", "active");

    let first = build_friend_view(&db, owner, friend, 7, "2025-01-06T00:00:00Z");
    assert!(!first.has_any_data);
    assert_eq!(first.status_distribution.active_count, 1);
    assert_eq!(first.status_distribution.total_count, 1);

    add_status(&db, owner, friend, "2025-01-05T00:00:00Z", "busy");
    let second = build_friend_view(&db, owner, friend, 7, "2025-01-06T00:00:00Z");
    assert!(!second.has_any_data);
    assert_eq!(second.status_distribution.active_count, 1);
    assert_eq!(second.status_distribution.busy_count, 1);
    assert_eq!(second.status_distribution.total_count, 2);
}

#[test]
fn self_activity_warmup_prepares_a_year_without_bucket_cache() {
    let (_dir, db) = test_db("activity-self-warmup");
    let owner = "usr_self";
    write_batch(
        &db,
        owner,
        &GameLogWriteBatch {
            locations: vec![GameLogLocationEntry {
                created_at: "2025-01-05T01:00:00Z".to_string(),
                location: "wrld_1:1".to_string(),
                world_id: "wrld_1".to_string(),
                world_name: "World".to_string(),
                time: 3_600_000,
                group_name: String::new(),
            }],
            ..Default::default()
        },
    )
    .unwrap();

    let warmed = activity_self_sessions_warmup(
        &db,
        owner.to_string(),
        365,
        Some(ms("2025-01-06T00:00:00Z")),
    )
    .unwrap();

    assert_eq!(warmed.sync.cached_range_days, 365);
    assert_eq!(warmed.sync.source_last_created_at, "2025-01-05T01:00:00Z");
    assert!(!warmed.sessions.is_empty());
    assert!(activity_bucket_cache_get(
        &db,
        ActivityBucketCacheQueryInput {
            owner_user_id: owner.to_string(),
            target_user_id: String::new(),
            range_days: json!(365),
            view_kind: ActivityViewKind::Activity,
            exclude_key: String::new(),
        },
    )
    .unwrap()
    .is_none());
}

#[test]
fn concurrent_page_refresh_cannot_downgrade_year_warmup() {
    let (_dir, db) = test_db("activity-warmup-page-race");
    let owner = "usr_self";
    write_batch(
        &db,
        owner,
        &GameLogWriteBatch {
            locations: vec![GameLogLocationEntry {
                created_at: "2025-01-05T01:00:00Z".to_string(),
                location: "wrld_1:1".to_string(),
                world_id: "wrld_1".to_string(),
                world_name: "World".to_string(),
                time: 3_600_000,
                group_name: String::new(),
            }],
            ..Default::default()
        },
    )
    .unwrap();

    let barrier = Arc::new(Barrier::new(3));
    let warmup_db = Arc::clone(&db);
    let warmup_barrier = Arc::clone(&barrier);
    let warmup = std::thread::spawn(move || {
        warmup_barrier.wait();
        activity_self_sessions_warmup(
            warmup_db.as_ref(),
            owner.to_string(),
            365,
            Some(ms("2025-01-06T00:00:00Z")),
        )
        .unwrap();
    });
    let page_db = Arc::clone(&db);
    let page_barrier = Arc::clone(&barrier);
    let page = std::thread::spawn(move || {
        page_barrier.wait();
        activity_view_build(
            page_db.as_ref(),
            ActivityViewBuildInput {
                owner_user_id: owner.to_string(),
                target_user_id: owner.to_string(),
                is_self: true,
                range_days: 30,
                utc_offset_minutes: 0,
                now_ms: ms("2025-01-06T00:00:00Z"),
                force_refresh: true,
            },
        )
        .unwrap();
    });

    barrier.wait();
    warmup.join().unwrap();
    page.join().unwrap();

    let sync = activity_sync_state_get(&db, owner.to_string())
        .unwrap()
        .unwrap();
    assert_eq!(sync.cached_range_days, 365);
}

#[test]
fn activity_view_build_returns_matching_cached_self_view() {
    let (_dir, db) = test_db("activity-view-cache-hit");
    let owner = "usr_self";
    upsert_self_sync(&db, owner, "self-cursor");
    replace_self_session(&db, owner, "2025-01-05T01:00:00Z", "2025-01-05T02:00:00Z");
    activity_bucket_cache_upsert(
        &db,
        ActivityBucketCacheInput {
            owner_user_id: owner.to_string(),
            target_user_id: String::new(),
            range_days: json!(7),
            view_kind: ActivityViewKind::Activity,
            exclude_key: String::new(),
            bucket_version: json!(1),
            built_from_cursor: "self-cursor".to_string(),
            raw_buckets: json!(buckets_with(5, 42.0)),
            normalized_buckets: json!(buckets_with(5, 0.5)),
            summary: json!({
                "filteredEventCount": 1,
                "peakDayIndex": 0,
                "peakHourStart": 5,
                "peakHourEnd": 6,
                "hasAnyData": true
            }),
            built_at: "2025-01-06T00:00:00Z".to_string(),
        },
    )
    .unwrap();

    let view = activity_view_build(
        &db,
        ActivityViewBuildInput {
            owner_user_id: owner.to_string(),
            target_user_id: owner.to_string(),
            is_self: true,
            range_days: 7,
            utc_offset_minutes: 0,
            now_ms: ms("2025-01-06T00:00:00Z"),
            force_refresh: false,
        },
    )
    .unwrap();

    assert_eq!(view.built_from_cursor, "self-cursor");
    assert_eq!(view.raw_buckets[5], 42.0);
    assert_eq!(view.peak_hour_start, 5);
    assert!(view.has_any_data);
}

fn build_friend_view(
    db: &DatabaseService,
    owner: &str,
    friend: &str,
    range_days: i64,
    now: &str,
) -> ActivityViewOutput {
    activity_view_build(
        db,
        ActivityViewBuildInput {
            owner_user_id: owner.to_string(),
            target_user_id: friend.to_string(),
            is_self: false,
            range_days,
            utc_offset_minutes: 0,
            now_ms: ms(now),
            force_refresh: false,
        },
    )
    .unwrap()
}

fn assert_activity_output_eq(left: &ActivityViewOutput, right: &ActivityViewOutput) {
    assert_eq!(left.raw_buckets, right.raw_buckets);
    assert_eq!(left.normalized_buckets, right.normalized_buckets);
    assert_eq!(left.peak_day_index, right.peak_day_index);
    assert_eq!(left.peak_hour_start, right.peak_hour_start);
    assert_eq!(left.peak_hour_end, right.peak_hour_end);
    assert_eq!(left.filtered_event_count, right.filtered_event_count);
    assert_eq!(left.has_any_data, right.has_any_data);
    assert_eq!(left.built_from_cursor, right.built_from_cursor);
    assert_eq!(left.built_at, right.built_at);
}

#[test]
fn activity_friend_presence_last_created_at_returns_global_max() {
    let (_dir, db) = test_db("activity-friend-last-created");
    let owner = "usr_owner";
    let friend = "usr_friend";
    add_presence(&db, owner, friend, "2025-01-05T01:00:00Z", "Online");
    add_presence(&db, owner, friend, "2025-01-05T02:00:00Z", "Offline");
    add_presence(&db, owner, friend, "2025-01-04T23:00:00Z", "Online");

    let last = activity_friend_presence_last_created_at(&db, owner, friend).unwrap();
    assert_eq!(last, "2025-01-05T02:00:00Z");

    let missing = activity_friend_presence_last_created_at(&db, owner, "usr_nobody").unwrap();
    assert_eq!(missing, "");
}

#[test]
fn activity_view_build_friend_probe_hit_is_stable() {
    let (_dir, db) = test_db("activity-view-friend-probe-hit");
    let owner = "usr_owner";
    let friend = "usr_friend";
    add_presence(&db, owner, friend, "2025-01-05T01:00:00Z", "Online");
    add_presence(&db, owner, friend, "2025-01-05T02:00:00Z", "Offline");

    let first = build_friend_view(&db, owner, friend, 7, "2025-01-06T00:00:00Z");
    let second = build_friend_view(&db, owner, friend, 7, "2025-01-06T00:00:00Z");

    assert!(first.has_any_data);
    assert!(second.has_any_data);
    assert_activity_output_eq(&first, &second);
}

#[test]
fn activity_view_build_friend_without_data_is_stable() {
    let (_dir, db) = test_db("activity-view-friend-no-data");
    let owner = "usr_owner";
    let friend = "usr_friend";

    let first = build_friend_view(&db, owner, friend, 7, "2025-01-06T00:00:00Z");
    let second = build_friend_view(&db, owner, friend, 7, "2025-01-06T00:00:00Z");

    assert!(!first.has_any_data);
    assert!(!second.has_any_data);
    assert_eq!(first.built_from_cursor, "");
    assert_activity_output_eq(&first, &second);
}

#[test]
fn activity_view_build_friend_rebuilds_legacy_cache_without_has_any_data() {
    let (_dir, db) = test_db("activity-view-friend-legacy-cache");
    let owner = "usr_owner";
    let friend = "usr_friend";
    add_presence(&db, owner, friend, "2025-01-05T01:00:00Z", "Online");
    add_presence(&db, owner, friend, "2025-01-05T02:00:00Z", "Offline");

    activity_bucket_cache_upsert(
        &db,
        ActivityBucketCacheInput {
            owner_user_id: owner.to_string(),
            target_user_id: friend.to_string(),
            range_days: json!(7),
            view_kind: ActivityViewKind::Activity,
            exclude_key: String::new(),
            bucket_version: json!(1),
            built_from_cursor: "2025-01-05T02:00:00Z".to_string(),
            raw_buckets: json!(buckets_with(5, 999.0)),
            normalized_buckets: json!(buckets_with(5, 1.0)),
            summary: json!({
                "filteredEventCount": 7,
                "peakDayIndex": 0,
                "peakHourStart": 5,
                "peakHourEnd": 6
            }),
            built_at: "2025-01-06T00:00:00Z".to_string(),
        },
    )
    .unwrap();

    let view = build_friend_view(&db, owner, friend, 7, "2025-01-06T00:00:00Z");

    assert!(view.has_any_data);
    assert_eq!(view.raw_buckets[1], 60.0);
    assert_eq!(view.raw_buckets[5], 0.0);
    assert_eq!(view.built_from_cursor, "2025-01-05T02:00:00Z");

    let cached = activity_bucket_cache_get(
        &db,
        ActivityBucketCacheQueryInput {
            owner_user_id: owner.to_string(),
            target_user_id: friend.to_string(),
            range_days: json!(7),
            view_kind: ActivityViewKind::Activity,
            exclude_key: String::new(),
        },
    )
    .unwrap()
    .unwrap();
    assert_eq!(cached.summary["hasAnyData"], json!(true));
}

#[test]
fn activity_view_build_friend_new_event_changes_cursor_and_rebuilds() {
    let (_dir, db) = test_db("activity-view-friend-new-event");
    let owner = "usr_owner";
    let friend = "usr_friend";
    add_presence(&db, owner, friend, "2025-01-05T01:00:00Z", "Online");
    add_presence(&db, owner, friend, "2025-01-05T02:00:00Z", "Offline");

    let first = build_friend_view(&db, owner, friend, 7, "2025-01-06T00:00:00Z");
    assert_eq!(first.built_from_cursor, "2025-01-05T02:00:00Z");

    add_presence(&db, owner, friend, "2025-01-05T03:00:00Z", "Online");
    add_presence(&db, owner, friend, "2025-01-05T04:00:00Z", "Offline");

    let second = build_friend_view(&db, owner, friend, 7, "2025-01-06T00:00:00Z");
    assert_eq!(second.built_from_cursor, "2025-01-05T04:00:00Z");
    assert!(second.has_any_data);
    assert_ne!(first.raw_buckets, second.raw_buckets);
}

#[test]
fn activity_view_build_computes_friend_presence_and_writes_cache() {
    let (_dir, db) = test_db("activity-view-friend");
    let owner = "usr_owner";
    let friend = "usr_friend";
    add_presence(&db, owner, friend, "2025-01-05T01:00:00Z", "Online");
    add_presence(&db, owner, friend, "2025-01-05T02:00:00Z", "Offline");

    let view = activity_view_build(
        &db,
        ActivityViewBuildInput {
            owner_user_id: owner.to_string(),
            target_user_id: friend.to_string(),
            is_self: false,
            range_days: 7,
            utc_offset_minutes: 0,
            now_ms: ms("2025-01-06T00:00:00Z"),
            force_refresh: false,
        },
    )
    .unwrap();

    assert_eq!(view.built_from_cursor, "2025-01-05T02:00:00Z");
    assert_eq!(view.raw_buckets[1], 60.0);
    assert_eq!(view.peak_day_index, 0);
    assert_eq!(view.filtered_event_count, 1);
    assert!(view.has_any_data);

    let cached = activity_bucket_cache_get(
        &db,
        ActivityBucketCacheQueryInput {
            owner_user_id: owner.to_string(),
            target_user_id: friend.to_string(),
            range_days: json!(7),
            view_kind: ActivityViewKind::Activity,
            exclude_key: String::new(),
        },
    )
    .unwrap()
    .unwrap();
    assert_eq!(cached.built_from_cursor, "2025-01-05T02:00:00Z");
    assert_eq!(cached.summary["peakDayIndex"], json!(0));
}

#[test]
fn activity_overlap_view_build_uses_pair_cursor_and_exclude_key() {
    let (_dir, db) = test_db("activity-overlap-view");
    let owner = "usr_owner";
    let friend = "usr_friend";
    upsert_self_sync(&db, owner, "self-cursor");
    replace_self_session(&db, owner, "2025-01-05T00:00:00Z", "2025-01-05T04:00:00Z");
    add_presence(&db, owner, friend, "2025-01-05T00:00:00Z", "Online");
    add_presence(&db, owner, friend, "2025-01-05T04:00:00Z", "Offline");

    let view = activity_overlap_view_build(
        &db,
        ActivityOverlapViewBuildInput {
            owner_user_id: owner.to_string(),
            current_user_id: owner.to_string(),
            target_user_id: friend.to_string(),
            range_days: 7,
            utc_offset_minutes: 0,
            now_ms: ms("2025-01-06T00:00:00Z"),
            force_refresh: false,
            exclude_start_hour: Some(22),
            exclude_end_hour: Some(2),
        },
    )
    .unwrap();

    assert_eq!(view.built_from_cursor, "self-cursor|2025-01-05T04:00:00Z");
    assert_eq!(view.raw_buckets[0], 0.0);
    assert_eq!(view.raw_buckets[1], 0.0);
    assert_eq!(view.raw_buckets[2], 60.0);
    assert_eq!(view.raw_buckets[3], 60.0);
    assert_eq!(view.overlap_percent, 100);
    assert_eq!(view.best_hour_start, 2);
    assert!(view.has_overlap_data);

    let cached = activity_bucket_cache_get(
        &db,
        ActivityBucketCacheQueryInput {
            owner_user_id: owner.to_string(),
            target_user_id: friend.to_string(),
            range_days: json!(7),
            view_kind: ActivityViewKind::Overlap,
            exclude_key: "22-2".to_string(),
        },
    )
    .unwrap()
    .unwrap();
    assert_eq!(cached.built_from_cursor, "self-cursor|2025-01-05T04:00:00Z");
    assert_eq!(cached.summary["overlapPercent"], json!(100));
}

#[test]
fn activity_view_build_all_range_resolves_friend_span_and_uses_sentinel_cache() {
    let (_dir, db) = test_db("activity-view-all-friend");
    let owner = "usr_owner";
    let friend = "usr_friend";
    add_presence(&db, owner, friend, "2024-06-01T01:00:00Z", "Online");
    add_presence(&db, owner, friend, "2024-06-01T02:00:00Z", "Offline");

    let view = activity_view_build(
        &db,
        ActivityViewBuildInput {
            owner_user_id: owner.to_string(),
            target_user_id: friend.to_string(),
            is_self: false,
            range_days: 0,
            utc_offset_minutes: 0,
            now_ms: ms("2025-01-06T00:00:00Z"),
            force_refresh: false,
        },
    )
    .unwrap();

    assert!(view.has_any_data);
    assert_eq!(view.filtered_event_count, 1);

    assert!(activity_bucket_cache_get(
        &db,
        ActivityBucketCacheQueryInput {
            owner_user_id: owner.to_string(),
            target_user_id: friend.to_string(),
            range_days: json!(0),
            view_kind: ActivityViewKind::Activity,
            exclude_key: String::new(),
        },
    )
    .unwrap()
    .is_some());
}

#[test]
fn activity_view_build_all_range_backfills_old_self_gamelog() {
    let (_dir, db) = test_db("activity-view-all-self");
    let owner = "usr_self";
    write_batch(
        &db,
        owner,
        &GameLogWriteBatch {
            locations: vec![GameLogLocationEntry {
                created_at: "2024-06-01T01:00:00Z".to_string(),
                location: "wrld_1:1".to_string(),
                world_id: "wrld_1".to_string(),
                world_name: "World".to_string(),
                time: 3_600_000,
                group_name: String::new(),
            }],
            ..Default::default()
        },
    )
    .unwrap();

    let view = activity_view_build(
        &db,
        ActivityViewBuildInput {
            owner_user_id: owner.to_string(),
            target_user_id: owner.to_string(),
            is_self: true,
            range_days: 0,
            utc_offset_minutes: 0,
            now_ms: ms("2025-01-06T00:00:00Z"),
            force_refresh: false,
        },
    )
    .unwrap();

    assert!(view.has_any_data);
    assert_eq!(view.raw_buckets.iter().sum::<f64>(), 60.0);

    assert!(activity_bucket_cache_get(
        &db,
        ActivityBucketCacheQueryInput {
            owner_user_id: owner.to_string(),
            target_user_id: String::new(),
            range_days: json!(0),
            view_kind: ActivityViewKind::Activity,
            exclude_key: String::new(),
        },
    )
    .unwrap()
    .is_some());
}
