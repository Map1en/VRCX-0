use std::path::PathBuf;
use std::sync::{Arc, Barrier};

use chrono::DateTime;
use serde_json::json;
use vrcx_0_core::json::RawJson;
use vrcx_0_persistence::activity::{
    activity_bucket_cache_get, activity_bucket_cache_upsert, activity_overlap_view_build,
    activity_self_sessions_warmup, activity_sessions_replace, activity_sync_state_get,
    activity_sync_state_upsert, activity_view_build, ActivityBucketCacheInput,
    ActivityBucketCacheQueryInput, ActivityOverlapViewBuildInput, ActivitySessionInput,
    ActivitySyncStateInput, ActivityViewBuildInput,
};
use vrcx_0_persistence::feed::feed_add_entry;
use vrcx_0_persistence::game_log::{write_batch, GameLogLocationEntry, GameLogWriteBatch};
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
    feed_add_entry(
        db,
        owner_user_id.to_string(),
        RawJson::from(json!({
            "created_at": created_at,
            "userId": target_user_id,
            "displayName": "Friend",
            "type": kind,
            "location": "",
            "worldName": "",
            "time": 0,
            "groupName": ""
        })),
    )
    .unwrap();
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
            view_kind: "activity".to_string(),
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
            view_kind: "activity".to_string(),
            exclude_key: String::new(),
            bucket_version: json!(1),
            built_from_cursor: "self-cursor".to_string(),
            raw_buckets: json!(buckets_with(5, 42.0)),
            normalized_buckets: json!(buckets_with(5, 0.5)),
            summary: json!({
                "filteredEventCount": 1,
                "peakDayIndex": 0,
                "peakHourStart": 5,
                "peakHourEnd": 6
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
            view_kind: "activity".to_string(),
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
            view_kind: "overlap".to_string(),
            exclude_key: "22-2".to_string(),
        },
    )
    .unwrap()
    .unwrap();
    assert_eq!(cached.built_from_cursor, "self-cursor|2025-01-05T04:00:00Z");
    assert_eq!(cached.summary["overlapPercent"], json!(100));
}
