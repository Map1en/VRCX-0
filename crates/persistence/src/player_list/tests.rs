use std::path::PathBuf;

use serde_json::json;

use super::*;
use crate::cache_entities::CacheEntityInput;
use crate::game_log::{
    write_batch, GameLogJoinLeaveEntry, GameLogLocationEntry, GameLogWriteBatch,
};
use crate::worlds::world_cache_upsert;

struct TestDatabase {
    _dir: TestDir,
    db: DatabaseService,
}

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "vrcx-0-player-list-{name}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn test_db(name: &str) -> Result<TestDatabase, Error> {
    let dir = TestDir::new(name);
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    Ok(TestDatabase { _dir: dir, db })
}

fn location(
    created_at: &str,
    location: &str,
    world_id: &str,
    world_name: &str,
) -> GameLogLocationEntry {
    GameLogLocationEntry {
        created_at: created_at.into(),
        location: location.into(),
        world_id: world_id.into(),
        world_name: world_name.into(),
        time: 60_000,
        group_name: String::new(),
    }
}

fn join_leave(
    created_at: &str,
    event_type: &str,
    display_name: &str,
    location: &str,
    user_id: &str,
    time: i64,
) -> GameLogJoinLeaveEntry {
    GameLogJoinLeaveEntry {
        created_at: created_at.into(),
        event_type: event_type.into(),
        display_name: display_name.into(),
        location: location.into(),
        user_id: user_id.into(),
        world_name: String::new(),
        time,
    }
}

fn cache_world(id: &str, name: &str) -> CacheEntityInput {
    CacheEntityInput {
        id: json!(id),
        author_id: json!("usr_author"),
        author_name: json!("Author"),
        created_at: json!("2026-01-01T00:00:00Z"),
        description: json!("Description"),
        image_url: json!("image.png"),
        name: json!(name),
        release_status: json!("public"),
        thumbnail_image_url: json!("thumb.png"),
        updated_at: json!("2026-01-02T00:00:00Z"),
        version: json!(1),
    }
}

#[test]
fn latest_location_uses_id_order() -> Result<(), Error> {
    let test_db = test_db("latest-location")?;
    write_batch(
        &test_db.db,
        &GameLogWriteBatch {
            locations: vec![
                location(
                    "2026-07-02T00:00:00Z",
                    "wrld_a:instance",
                    "wrld_a",
                    "Newer Time",
                ),
                location(
                    "2026-07-01T00:00:00Z",
                    "wrld_a:instance",
                    "wrld_a",
                    "Later Id",
                ),
            ],
            ..GameLogWriteBatch::default()
        },
    )?;

    let by_location = player_list_location_get(&test_db.db, " wrld_a:instance ".into())?.unwrap();
    let latest = player_list_latest_location_get(&test_db.db)?.unwrap();
    assert_eq!(by_location.created_at, "2026-07-01T00:00:00Z");
    assert_eq!(by_location.world_name, "Later Id");
    assert_eq!(latest.created_at, "2026-07-01T00:00:00Z");
    Ok(())
}

#[test]
fn join_leave_rows_include_started_at_and_keep_id_order() -> Result<(), Error> {
    let test_db = test_db("join-leave-order")?;
    write_batch(
        &test_db.db,
        &GameLogWriteBatch {
            join_leave: vec![
                join_leave(
                    "2026-07-01T00:02:00Z",
                    "OnPlayerLeft",
                    "First Id",
                    "wrld_a:instance",
                    "usr_first",
                    1_000,
                ),
                join_leave(
                    "2026-07-01T00:01:00Z",
                    "OnPlayerJoined",
                    "Boundary",
                    "wrld_a:instance",
                    "usr_boundary",
                    0,
                ),
                join_leave(
                    "2026-07-01T00:00:00Z",
                    "OnPlayerJoined",
                    "Excluded",
                    "wrld_a:instance",
                    "usr_excluded",
                    0,
                ),
            ],
            ..GameLogWriteBatch::default()
        },
    )?;

    let rows = player_list_join_leave_rows(
        &test_db.db,
        "wrld_a:instance".into(),
        "2026-07-01T00:01:00Z".into(),
    )?;
    assert_eq!(
        rows.iter().map(|row| row.id).collect::<Vec<_>>(),
        vec![1, 2]
    );
    assert_eq!(rows[1].display_name, "Boundary");
    Ok(())
}

#[test]
fn activity_includes_duration_start_across_range_and_filters_traveling() -> Result<(), Error> {
    let test_db = test_db("activity-range")?;
    write_batch(
        &test_db.db,
        &GameLogWriteBatch {
            join_leave: vec![
                join_leave(
                    "2026-07-01T10:10:00Z",
                    "OnPlayerLeft",
                    "Spanning",
                    "wrld_a:instance",
                    "usr_spanning",
                    1_200_000,
                ),
                join_leave(
                    "2026-07-01T09:52:00Z",
                    "OnPlayerLeft",
                    "Traveling",
                    " traveling:traveling ",
                    "usr_traveling",
                    0,
                ),
                join_leave(
                    "2026-07-01T09:53:00Z",
                    "OnPlayerJoined",
                    "Joined",
                    "wrld_a:instance",
                    "usr_joined",
                    0,
                ),
            ],
            ..GameLogWriteBatch::default()
        },
    )?;

    let rows = instance_activity_rows_get(
        &test_db.db,
        "2026-07-01T09:49:00Z".into(),
        "2026-07-01T09:55:00Z".into(),
    )?;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].display_name, "Spanning");
    assert_eq!(rows[0].created_at, "2026-07-01T10:10:00Z");
    Ok(())
}

#[test]
fn world_summaries_prefer_cache_and_fall_back_to_latest_game_log_name() -> Result<(), Error> {
    let test_db = test_db("world-summaries")?;
    world_cache_upsert(&test_db.db, cache_world("wrld_cached", "Cached Name"))?;
    world_cache_upsert(&test_db.db, cache_world("wrld_empty_cache", ""))?;
    write_batch(
        &test_db.db,
        &GameLogWriteBatch {
            locations: vec![
                location(
                    "2026-07-01T00:00:00Z",
                    "cached:1",
                    "wrld_cached",
                    "Game Log Name",
                ),
                location(
                    "2026-07-01T00:01:00Z",
                    "fallback:1",
                    "wrld_fallback",
                    "Old Fallback",
                ),
                location(
                    "2026-07-01T00:02:00Z",
                    "fallback:2",
                    "wrld_fallback",
                    "Latest Fallback",
                ),
                location(
                    "2026-07-01T00:03:00Z",
                    "empty:1",
                    "wrld_empty_cache",
                    "Recovered Name",
                ),
            ],
            ..GameLogWriteBatch::default()
        },
    )?;

    let summaries = world_summaries_get(
        &test_db.db,
        vec![
            " wrld_cached ".into(),
            "wrld_cached".into(),
            "wrld_fallback".into(),
            "wrld_empty_cache".into(),
            "wrld_missing".into(),
            " ".into(),
        ],
    )?;
    assert_eq!(summaries.len(), 3);
    assert_eq!(summaries["wrld_cached"].name, "Cached Name");
    assert_eq!(summaries["wrld_cached"].author_name, "Author");
    assert_eq!(summaries["wrld_fallback"].name, "Latest Fallback");
    assert!(summaries["wrld_fallback"].author_name.is_empty());
    assert_eq!(summaries["wrld_empty_cache"].name, "Recovered Name");
    assert!(!summaries.contains_key("wrld_missing"));
    Ok(())
}
