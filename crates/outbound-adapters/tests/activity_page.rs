use std::path::PathBuf;
use std::sync::Arc;

use chrono::{DateTime, Duration, SecondsFormat};
use vrcx_0_application_activity::activity_page::{
    ActivityCompanionOrder, ActivityPageBuildInput, ActivitySeriesBucket,
};
use vrcx_0_core::OwnerId;
use vrcx_0_persistence::friends::{
    friend_log_upsert_current, FriendLogCurrentEntryInput, FriendLogUpsertOptionsInput,
};
use vrcx_0_persistence::game_log::{
    write_batch, GameLogJoinLeaveEntry, GameLogLocationEntry, GameLogWriteBatch,
};
use vrcx_0_persistence::DatabaseService;

fn activity_page_view_build(
    db: &DatabaseService,
    input: ActivityPageBuildInput,
) -> vrcx_0_application_core::Result<vrcx_0_application_activity::activity_page::ActivityPageView> {
    vrcx_0_application_activity::activity_page::activity_page_view_build(
        &vrcx_0_outbound_adapters::LocalActivityPageStore::new(db),
        input,
    )
}

const USER_ID: &str = "usr_page";
const HOUR_MS: i64 = 3_600_000;

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

fn location(created_at: &str, location: &str, world_id: &str, time: i64) -> GameLogLocationEntry {
    named_location(created_at, location, world_id, time, "World")
}

fn named_location(
    created_at: &str,
    location: &str,
    world_id: &str,
    time: i64,
    world_name: &str,
) -> GameLogLocationEntry {
    GameLogLocationEntry {
        created_at: created_at.to_string(),
        location: location.to_string(),
        world_id: world_id.to_string(),
        world_name: world_name.to_string(),
        time,
        group_name: String::new(),
    }
}

fn write_locations(db: &DatabaseService, locations: Vec<GameLogLocationEntry>) {
    let join_leave = locations
        .iter()
        .filter(|location| location.time > 0)
        .map(|location| GameLogJoinLeaveEntry {
            created_at: (DateTime::parse_from_rfc3339(&location.created_at).unwrap()
                + Duration::milliseconds(location.time))
            .to_rfc3339_opts(SecondsFormat::Millis, true),
            event_type: "OnPlayerLeft".to_string(),
            display_name: USER_ID.to_string(),
            location: location.location.clone(),
            user_id: USER_ID.to_string(),
            world_name: location.world_name.clone(),
            time: location.time,
        })
        .collect();
    write_batch(
        db,
        &OwnerId::new(USER_ID),
        &GameLogWriteBatch {
            locations,
            join_leave,
            ..Default::default()
        },
    )
    .unwrap();
}

fn left(created_at: &str, user_id: &str, location: &str, time: i64) -> GameLogJoinLeaveEntry {
    GameLogJoinLeaveEntry {
        created_at: created_at.to_string(),
        event_type: "OnPlayerLeft".to_string(),
        display_name: user_id.to_string(),
        location: location.to_string(),
        user_id: user_id.to_string(),
        world_name: "World".to_string(),
        time,
    }
}

fn write_join_leave(db: &DatabaseService, join_leave: Vec<GameLogJoinLeaveEntry>) {
    write_batch(
        db,
        &OwnerId::new(USER_ID),
        &GameLogWriteBatch {
            join_leave,
            ..Default::default()
        },
    )
    .unwrap();
}

fn write_friends(db: &DatabaseService, user_ids: &[&str]) {
    for user_id in user_ids {
        friend_log_upsert_current(
            db,
            USER_ID.to_string(),
            FriendLogCurrentEntryInput {
                user_id: user_id.to_string(),
                display_name: user_id.to_string(),
                trust_level: None,
                friend_number: serde_json::Value::Null,
            },
            FriendLogUpsertOptionsInput::default(),
        )
        .unwrap();
    }
}

fn build(range_days: i64, now: &str) -> ActivityPageBuildInput {
    ActivityPageBuildInput {
        owner_user_id: OwnerId::new(USER_ID),
        range_days,
        utc_offset_minutes: 0,
        now_ms: ms(now),
        companion_order: ActivityCompanionOrder::Days,
        force_refresh: false,
    }
}

#[test]
fn activity_page_totals_match_world_totals_without_overlap() {
    let (_dir, db) = test_db("activity-page-totals");
    write_locations(
        &db,
        vec![
            location("2025-01-05T01:00:00Z", "wrld_1:1", "wrld_1", HOUR_MS),
            location(
                "2025-01-05T02:00:00Z",
                "wrld_2:1~friends(usr_x)",
                "wrld_2",
                2 * HOUR_MS,
            ),
        ],
    );

    let view = activity_page_view_build(db.as_ref(), build(30, "2025-01-06T00:00:00Z")).unwrap();

    let world_minutes: i64 = view.worlds.top.iter().map(|row| row.minutes).sum();
    assert_eq!(view.summary.total_minutes, 180);
    assert_eq!(view.summary.total_minutes, world_minutes);
    assert_eq!(view.summary.active_days, 1);
    assert_eq!(view.summary.session_count, 1);
}

#[test]
fn activity_page_splits_minutes_by_access_bucket() {
    let (_dir, db) = test_db("activity-page-access");
    write_locations(
        &db,
        vec![
            location("2025-01-05T01:00:00Z", "wrld_1:1", "wrld_1", HOUR_MS),
            location(
                "2025-01-05T03:00:00Z",
                "wrld_2:1~friends(usr_x)",
                "wrld_2",
                2 * HOUR_MS,
            ),
        ],
    );

    let view = activity_page_view_build(db.as_ref(), build(30, "2025-01-06T00:00:00Z")).unwrap();

    assert_eq!(view.access_split.len(), 2);
    assert_eq!(view.access_split[0].access, "friends");
    assert_eq!(view.access_split[0].minutes, 120);
    assert_eq!(view.access_split[1].access, "public");
    assert_eq!(view.access_split[1].minutes, 60);
}

#[test]
fn activity_page_ignores_an_unclosed_instance() {
    let (_dir, db) = test_db("activity-page-unclosed");
    write_locations(
        &db,
        vec![
            location("2025-01-05T01:00:00Z", "wrld_1:1", "wrld_1", 0),
            location("2025-01-05T03:00:00Z", "wrld_2:1", "wrld_2", HOUR_MS),
        ],
    );

    let view = activity_page_view_build(db.as_ref(), build(30, "2025-01-06T00:00:00Z")).unwrap();

    assert_eq!(view.summary.total_minutes, 60);
    assert!(view.worlds.top.iter().all(|row| row.world_id != "wrld_1"));
}

#[test]
fn activity_page_uses_the_current_users_closed_instance_intervals() {
    let (_dir, db) = test_db("activity-page-closed-self-intervals");
    write_locations(
        &db,
        vec![
            location("2025-01-05T01:00:00Z", "wrld_1:1", "wrld_1", 0),
            location("2025-01-06T01:00:00Z", "wrld_2:1", "wrld_2", 0),
        ],
    );
    write_join_leave(
        &db,
        vec![left(
            "2025-01-05T03:00:00Z",
            USER_ID,
            "wrld_1:1",
            2 * HOUR_MS,
        )],
    );

    let view = activity_page_view_build(db.as_ref(), build(30, "2025-01-06T03:00:00Z")).unwrap();

    assert_eq!(view.summary.total_minutes, 120);
    assert_eq!(view.worlds.top.len(), 1);
    assert_eq!(view.worlds.top[0].world_id, "wrld_1");
}

#[test]
fn activity_page_carries_the_closed_instance_world_name() {
    let (_dir, db) = test_db("activity-page-closed-name");
    write_locations(
        &db,
        vec![
            named_location(
                "2025-01-05T01:00:00Z",
                "wrld_1:1",
                "wrld_1",
                0,
                "Renamed Later",
            ),
            named_location(
                "2025-01-05T03:00:00Z",
                "wrld_1:2",
                "wrld_1",
                HOUR_MS,
                "Newest Name",
            ),
        ],
    );

    let view = activity_page_view_build(db.as_ref(), build(30, "2025-01-06T00:00:00Z")).unwrap();

    assert_eq!(view.worlds.top[0].world_name, "Newest Name");
    assert_eq!(view.summary.longest_session_minutes, 60);
}

#[test]
fn activity_page_clips_spans_to_the_window() {
    let (_dir, db) = test_db("activity-page-clip");
    write_locations(
        &db,
        vec![location(
            "2025-01-01T00:00:00Z",
            "wrld_1:1",
            "wrld_1",
            10 * 24 * HOUR_MS,
        )],
    );

    let view = activity_page_view_build(db.as_ref(), build(3, "2025-01-08T00:00:00Z")).unwrap();

    assert_eq!(view.summary.total_minutes, 3 * 24 * 60);
}

#[test]
fn activity_page_reports_previous_window_totals() {
    let (_dir, db) = test_db("activity-page-previous");
    write_locations(
        &db,
        vec![
            location("2025-01-02T01:00:00Z", "wrld_1:1", "wrld_1", HOUR_MS),
            location("2025-01-09T01:00:00Z", "wrld_1:1", "wrld_1", 2 * HOUR_MS),
        ],
    );

    let view = activity_page_view_build(db.as_ref(), build(7, "2025-01-13T00:00:00Z")).unwrap();

    assert_eq!(view.summary.total_minutes, 120);
    assert!(view.previous.has_data);
    assert_eq!(view.previous.total_minutes, 60);
}

#[test]
fn activity_page_separates_new_worlds_from_returning_ones() {
    let (_dir, db) = test_db("activity-page-new-worlds");
    write_locations(
        &db,
        vec![
            location("2025-01-01T01:00:00Z", "wrld_old:1", "wrld_old", HOUR_MS),
            location("2025-01-10T01:00:00Z", "wrld_old:1", "wrld_old", HOUR_MS),
            location(
                "2025-01-10T03:00:00Z",
                "wrld_new:1",
                "wrld_new",
                2 * HOUR_MS,
            ),
        ],
    );

    let view = activity_page_view_build(db.as_ref(), build(7, "2025-01-13T00:00:00Z")).unwrap();

    assert_eq!(view.worlds.returning_world_minutes, 60);
    assert_eq!(view.worlds.new_world_minutes, 120);
}

#[test]
fn activity_page_switches_to_week_buckets_for_long_ranges() {
    let (_dir, db) = test_db("activity-page-weeks");
    write_locations(
        &db,
        vec![location(
            "2025-01-05T01:00:00Z",
            "wrld_1:1",
            "wrld_1",
            HOUR_MS,
        )],
    );

    let daily = activity_page_view_build(db.as_ref(), build(30, "2025-01-06T00:00:00Z")).unwrap();
    let weekly = activity_page_view_build(db.as_ref(), build(365, "2025-01-06T00:00:00Z")).unwrap();

    assert_eq!(daily.series.bucket, ActivitySeriesBucket::Day);
    assert_eq!(weekly.series.bucket, ActivitySeriesBucket::Week);
}

#[test]
fn activity_page_ranks_companions_by_shared_days_not_minutes() {
    let (_dir, db) = test_db("activity-page-companions");
    write_locations(
        &db,
        vec![location(
            "2025-01-05T01:00:00Z",
            "wrld_1:1",
            "wrld_1",
            HOUR_MS,
        )],
    );
    write_join_leave(
        &db,
        vec![
            left(
                "2025-01-05T02:00:00Z",
                "usr_marathon",
                "wrld_1:1",
                8 * HOUR_MS,
            ),
            left("2025-01-05T02:00:00Z", "usr_regular", "wrld_1:1", HOUR_MS),
            left("2025-01-06T02:00:00Z", "usr_regular", "wrld_1:1", HOUR_MS),
            left("2025-01-07T02:00:00Z", "usr_regular", "wrld_1:1", HOUR_MS),
        ],
    );

    write_friends(&db, &["usr_marathon", "usr_regular"]);

    let view = activity_page_view_build(db.as_ref(), build(30, "2025-01-08T00:00:00Z")).unwrap();

    assert_eq!(view.people.companions[0].user_id, "usr_regular");
    assert_eq!(view.people.companions[0].co_days, 3);
    assert_eq!(view.people.companions[1].user_id, "usr_marathon");
    assert!(view.people.companions[1].minutes > view.people.companions[0].minutes);
}

#[test]
fn activity_page_reranks_companions_when_the_order_changes() {
    let (_dir, db) = test_db("activity-page-companion-order");
    write_locations(
        &db,
        vec![location(
            "2025-01-05T01:00:00Z",
            "wrld_1:1",
            "wrld_1",
            HOUR_MS,
        )],
    );
    write_join_leave(
        &db,
        vec![
            left(
                "2025-01-05T02:00:00Z",
                "usr_marathon",
                "wrld_1:1",
                8 * HOUR_MS,
            ),
            left("2025-01-05T02:00:00Z", "usr_regular", "wrld_1:1", HOUR_MS),
            left("2025-01-06T02:00:00Z", "usr_regular", "wrld_1:1", HOUR_MS),
            left("2025-01-07T02:00:00Z", "usr_regular", "wrld_1:1", HOUR_MS),
        ],
    );

    write_friends(&db, &["usr_marathon", "usr_regular"]);

    let mut input = build(30, "2025-01-08T00:00:00Z");
    input.companion_order = ActivityCompanionOrder::Minutes;
    let by_minutes = activity_page_view_build(db.as_ref(), input).unwrap();

    let mut input = build(30, "2025-01-08T00:00:00Z");
    input.companion_order = ActivityCompanionOrder::Days;
    let by_days = activity_page_view_build(db.as_ref(), input).unwrap();

    assert_eq!(by_minutes.people.order, ActivityCompanionOrder::Minutes);
    assert_eq!(by_minutes.people.companions[0].user_id, "usr_marathon");
    assert_eq!(by_days.people.order, ActivityCompanionOrder::Days);
    assert_eq!(by_days.people.companions[0].user_id, "usr_regular");
}

#[test]
fn activity_page_counts_new_faces_against_the_previous_window() {
    let (_dir, db) = test_db("activity-page-new-faces");
    write_locations(
        &db,
        vec![location(
            "2025-01-10T01:00:00Z",
            "wrld_1:1",
            "wrld_1",
            HOUR_MS,
        )],
    );
    write_join_leave(
        &db,
        vec![
            left("2025-01-02T02:00:00Z", "usr_known", "wrld_1:1", HOUR_MS),
            left("2025-01-10T02:00:00Z", "usr_known", "wrld_1:1", HOUR_MS),
            left("2025-01-10T03:00:00Z", "usr_fresh", "wrld_1:1", HOUR_MS),
        ],
    );

    let view = activity_page_view_build(db.as_ref(), build(7, "2025-01-13T00:00:00Z")).unwrap();

    assert_eq!(view.people.encountered_count, 2);
    assert_eq!(view.people.new_face_count, 1);
}

#[test]
fn activity_page_rebuilds_when_the_requested_offset_differs_from_the_cache() {
    let (_dir, db) = test_db("activity-page-offset");
    write_locations(
        &db,
        vec![location(
            "2025-01-05T01:00:00Z",
            "wrld_1:1",
            "wrld_1",
            HOUR_MS,
        )],
    );

    let utc = activity_page_view_build(db.as_ref(), build(30, "2025-01-06T00:00:00Z")).unwrap();
    let shifted = activity_page_view_build(
        db.as_ref(),
        ActivityPageBuildInput {
            utc_offset_minutes: -600,
            ..build(30, "2025-01-06T00:00:00Z")
        },
    )
    .unwrap();

    assert_eq!(utc.utc_offset_minutes, 0);
    assert_eq!(shifted.utc_offset_minutes, -600);
    assert_ne!(shifted.series.points, utc.series.points);
}

#[test]
fn activity_page_sees_the_current_users_closed_instance() {
    let (_dir, db) = test_db("activity-page-leave-writeback");
    write_locations(
        &db,
        vec![location("2025-01-05T01:00:00Z", "wrld_1:1", "wrld_1", 0)],
    );

    let open = activity_page_view_build(db.as_ref(), build(30, "2025-01-05T03:00:00Z")).unwrap();
    assert_eq!(open.summary.total_minutes, 0);

    write_join_leave(
        db.as_ref(),
        vec![left(
            "2025-01-05T01:30:00Z",
            USER_ID,
            "wrld_1:1",
            30 * 60 * 1000,
        )],
    );

    let closed = activity_page_view_build(db.as_ref(), build(30, "2025-01-05T03:00:00Z")).unwrap();

    assert_eq!(closed.summary.total_minutes, 30);
}

#[test]
fn activity_page_totals_never_exceed_the_per_world_breakdown() {
    let (_dir, db) = test_db("activity-page-reconcile");
    write_locations(
        &db,
        vec![
            location("2025-01-05T01:00:00Z", "wrld_1:1", "wrld_1", HOUR_MS),
            // Three minute loading gap between worlds.
            location("2025-01-05T02:03:00Z", "wrld_2:1", "wrld_2", HOUR_MS),
        ],
    );

    let view = activity_page_view_build(db.as_ref(), build(30, "2025-01-06T00:00:00Z")).unwrap();

    let world_minutes: i64 = view.worlds.top.iter().map(|row| row.minutes).sum();
    let access_minutes: i64 = view.access_split.iter().map(|slice| slice.minutes).sum();
    let series_minutes: i64 = view.series.points.iter().map(|point| point.minutes).sum();

    assert_eq!(view.summary.total_minutes, 120);
    assert_eq!(world_minutes, 120);
    assert_eq!(access_minutes, 120);
    assert_eq!(series_minutes, 120);
    assert_eq!(view.summary.session_count, 1);
}

#[test]
fn activity_page_clips_companion_minutes_to_the_window() {
    let (_dir, db) = test_db("activity-page-companion-clip");
    write_locations(
        &db,
        vec![location(
            "2025-01-07T23:00:00Z",
            "wrld_1:1",
            "wrld_1",
            HOUR_MS,
        )],
    );
    write_join_leave(
        &db,
        vec![left(
            "2025-01-08T00:01:00Z",
            "usr_friend",
            "wrld_1:1",
            8 * HOUR_MS,
        )],
    );

    write_friends(&db, &["usr_friend"]);

    let view = activity_page_view_build(db.as_ref(), build(1, "2025-01-08T12:00:00Z")).unwrap();

    let companion = &view.people.companions[0];
    assert_eq!(companion.user_id, "usr_friend");
    assert_eq!(companion.minutes, 1);
}

#[test]
fn activity_page_counts_a_face_as_new_only_when_never_seen_before() {
    let (_dir, db) = test_db("activity-page-new-face-history");
    write_locations(
        &db,
        vec![location(
            "2025-01-10T01:00:00Z",
            "wrld_1:1",
            "wrld_1",
            HOUR_MS,
        )],
    );
    write_join_leave(
        &db,
        vec![
            left("2023-05-02T02:00:00Z", "usr_long_ago", "wrld_1:1", HOUR_MS),
            left("2025-01-10T02:00:00Z", "usr_long_ago", "wrld_1:1", HOUR_MS),
            left("2025-01-10T03:00:00Z", "usr_fresh", "wrld_1:1", HOUR_MS),
        ],
    );

    let view = activity_page_view_build(db.as_ref(), build(7, "2025-01-13T00:00:00Z")).unwrap();

    assert_eq!(view.people.encountered_count, 2);
    assert_eq!(view.people.new_face_count, 1);
}

#[test]
fn activity_page_returns_an_empty_view_for_missing_owner_or_bad_range() {
    let (_dir, db) = test_db("activity-page-guards");
    write_locations(
        &db,
        vec![location(
            "2025-01-05T01:00:00Z",
            "wrld_1:1",
            "wrld_1",
            HOUR_MS,
        )],
    );

    let no_owner = activity_page_view_build(
        db.as_ref(),
        ActivityPageBuildInput {
            owner_user_id: OwnerId::new(""),
            ..build(30, "2025-01-06T00:00:00Z")
        },
    )
    .unwrap();
    let negative_range =
        activity_page_view_build(db.as_ref(), build(-1, "2025-01-06T00:00:00Z")).unwrap();

    assert_eq!(no_owner.summary.total_minutes, 0);
    assert_eq!(negative_range.summary.total_minutes, 0);
}

#[test]
fn activity_page_serves_cache_until_the_source_cursor_moves() {
    let (_dir, db) = test_db("activity-page-cache");
    write_locations(
        &db,
        vec![location(
            "2025-01-05T01:00:00Z",
            "wrld_1:1",
            "wrld_1",
            HOUR_MS,
        )],
    );

    let first = activity_page_view_build(db.as_ref(), build(30, "2025-01-06T00:00:00Z")).unwrap();
    let cached = activity_page_view_build(db.as_ref(), build(30, "2025-01-06T12:00:00Z")).unwrap();
    assert_eq!(cached.built_at, first.built_at);

    write_locations(
        &db,
        vec![location(
            "2025-01-05T05:00:00Z",
            "wrld_2:1",
            "wrld_2",
            HOUR_MS,
        )],
    );
    let rebuilt = activity_page_view_build(db.as_ref(), build(30, "2025-01-06T12:00:00Z")).unwrap();

    assert_ne!(rebuilt.built_from_cursor, first.built_from_cursor);
    assert_eq!(rebuilt.summary.total_minutes, 120);
    assert!(!rebuilt.stale);
}

#[test]
fn activity_page_rebuilds_a_version_one_cache() {
    let (_dir, db) = test_db("activity-page-cache-version");
    write_locations(
        &db,
        vec![location(
            "2025-01-05T01:00:00Z",
            "wrld_1:1",
            "wrld_1",
            HOUR_MS,
        )],
    );

    let first = activity_page_view_build(db.as_ref(), build(30, "2025-01-06T00:00:00Z")).unwrap();
    let mut obsolete = first.clone();
    obsolete.summary.total_minutes = 999;
    rusqlite::Connection::open(db.db_path())
        .unwrap()
        .execute(
            "UPDATE usrpage_activity_page_cache
             SET payload_version = 1, payload_json = ?1
             WHERE user_id = ?2 AND range_days = 30",
            rusqlite::params![serde_json::to_string(&obsolete).unwrap(), USER_ID],
        )
        .unwrap();

    let rebuilt = activity_page_view_build(db.as_ref(), build(30, "2025-01-06T12:00:00Z")).unwrap();

    assert_eq!(rebuilt.summary.total_minutes, 60);
    assert_ne!(rebuilt.built_at, first.built_at);
}
