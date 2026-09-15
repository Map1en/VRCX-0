use std::path::PathBuf;

use chrono::DateTime;
use serde_json::json;
use vrcx_0_core::OwnerId;
use vrcx_0_persistence::activity::{
    activity_self_sessions_refresh, activity_sessions_get, activity_sync_state_get,
    ActivityRefreshMode, ActivitySelfSessionsRefreshInput, ActivitySelfSessionsRefreshOutput,
    ActivitySessionOutput,
};
use vrcx_0_persistence::game_log::{write_batch, GameLogLocationEntry, GameLogWriteBatch};
use vrcx_0_persistence::DatabaseService;

const OWNER: &str = "usr_self";
const NOW: &str = "2025-01-10T00:00:00Z";

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

fn test_db(name: &str) -> (TestDir, DatabaseService) {
    let dir = TestDir::new(name);
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap();
    (dir, db)
}

fn ms(value: &str) -> i64 {
    DateTime::parse_from_rfc3339(value)
        .unwrap()
        .timestamp_millis()
}

fn location(created_at: &str, time: i64) -> GameLogLocationEntry {
    GameLogLocationEntry {
        created_at: created_at.to_string(),
        location: "wrld_1:1".to_string(),
        world_id: "wrld_1".to_string(),
        world_name: "World".to_string(),
        time,
        group_name: String::new(),
    }
}

fn seed(db: &DatabaseService, locations: Vec<GameLogLocationEntry>) {
    write_batch(
        db,
        &OwnerId::new(OWNER),
        &GameLogWriteBatch {
            locations,
            ..Default::default()
        },
    )
    .unwrap();
}

fn refresh(
    db: &DatabaseService,
    mode: ActivityRefreshMode,
    range_days: i64,
) -> ActivitySelfSessionsRefreshOutput {
    activity_self_sessions_refresh(
        db,
        &OwnerId::new(OWNER),
        ActivitySelfSessionsRefreshInput {
            user_id: OWNER.to_string(),
            mode,
            range_days: json!(range_days),
            now_ms: Some(ms(NOW)),
        },
    )
    .unwrap()
}

fn spans(sessions: &[ActivitySessionOutput]) -> Vec<(i64, i64, bool)> {
    sessions
        .iter()
        .map(|session| (session.start, session.end, session.is_open_tail))
        .collect()
}

fn persisted_spans(db: &DatabaseService) -> Vec<(i64, i64, bool)> {
    spans(&activity_sessions_get(db, OWNER.to_string()).unwrap())
}

#[test]
fn full_refresh_merges_adjacent_rows_and_records_the_source_cursor() {
    let (_dir, db) = test_db("activity-self-full");
    seed(
        &db,
        vec![
            location("2025-01-09T10:00:00Z", 3_600_000),
            location("2025-01-09T11:02:00Z", 0),
            location("2025-01-09T11:30:00Z", 1_800_000),
            location("2025-01-09T20:00:00Z", 0),
        ],
    );

    let output = refresh(&db, ActivityRefreshMode::Full, 30);

    let expected = vec![
        (
            ms("2025-01-09T10:00:00Z"),
            ms("2025-01-09T12:00:00Z"),
            false,
        ),
        (ms("2025-01-09T20:00:00Z"), ms(NOW), true),
    ];
    assert_eq!(spans(&output.sessions), expected);
    assert_eq!(output.source_count, 4);
    assert_eq!(output.sync.source_last_created_at, "2025-01-09T20:00:00Z");
    assert_eq!(output.sync.cached_range_days, 30);
    assert!(output.sync.is_self);
    assert_eq!(persisted_spans(&db), expected);
    let sync = activity_sync_state_get(&db, OWNER.to_string())
        .unwrap()
        .unwrap();
    assert_eq!(sync.source_last_created_at, "2025-01-09T20:00:00Z");
    assert_eq!(sync.cached_range_days, 30);
}

#[test]
fn incremental_refresh_extends_the_last_session_and_advances_the_cursor() {
    let (_dir, db) = test_db("activity-self-incremental");
    seed(
        &db,
        vec![
            location("2025-01-09T10:00:00Z", 3_600_000),
            location("2025-01-09T20:00:00Z", 1_800_000),
        ],
    );
    refresh(&db, ActivityRefreshMode::Full, 30);
    seed(&db, vec![location("2025-01-09T20:32:00Z", 1_800_000)]);

    let output = refresh(&db, ActivityRefreshMode::Incremental, 30);

    let expected = vec![
        (
            ms("2025-01-09T10:00:00Z"),
            ms("2025-01-09T11:00:00Z"),
            false,
        ),
        (ms("2025-01-09T20:00:00Z"), ms("2025-01-09T21:02:00Z"), true),
    ];
    assert_eq!(spans(&output.sessions), expected);
    assert_eq!(output.source_count, 2);
    assert_eq!(output.sync.source_last_created_at, "2025-01-09T20:32:00Z");
    assert_eq!(persisted_spans(&db), expected);
}

#[test]
fn expand_refresh_backfills_older_rows_and_ignores_narrower_ranges() {
    let (_dir, db) = test_db("activity-self-expand");
    seed(&db, vec![location("2025-01-09T10:00:00Z", 3_600_000)]);
    refresh(&db, ActivityRefreshMode::Full, 30);
    seed(&db, vec![location("2024-11-20T08:00:00Z", 3_600_000)]);

    let expanded = refresh(&db, ActivityRefreshMode::Expand, 60);

    let expected = vec![
        (
            ms("2024-11-20T08:00:00Z"),
            ms("2024-11-20T09:00:00Z"),
            false,
        ),
        (ms("2025-01-09T10:00:00Z"), ms("2025-01-09T11:00:00Z"), true),
    ];
    assert_eq!(spans(&expanded.sessions), expected);
    assert_eq!(expanded.source_count, 2);
    assert_eq!(expanded.sync.cached_range_days, 60);
    assert_eq!(expanded.sync.source_last_created_at, "2025-01-09T10:00:00Z");
    assert_eq!(persisted_spans(&db), expected);

    let narrower = refresh(&db, ActivityRefreshMode::Expand, 30);

    assert_eq!(spans(&narrower.sessions), expected);
    assert_eq!(narrower.source_count, 0);
    assert_eq!(narrower.sync.cached_range_days, 60);
}
