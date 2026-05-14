use std::path::PathBuf;

use crate::domain::database::DatabaseService;
use crate::error::AppError;

use super::super::tables::ensure_game_log_tables;
use super::super::types::{
    GameLogEventEntry, GameLogJoinLeaveEntry, GameLogLocationEntry, GameLogPortalSpawnEntry,
    GameLogResourceLoadEntry, GameLogWriteBatch,
};
use super::{
    insert_event, insert_join_leave, insert_location, insert_portal_spawn, insert_resource_load,
    update_location_time, write_batch,
};

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

struct TestDatabase {
    _dir: TestDir,
    db: DatabaseService,
}

fn test_db(name: &str) -> Result<TestDatabase, AppError> {
    let dir = TestDir::new(name);
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    ensure_game_log_tables(&db)?;
    Ok(TestDatabase { _dir: dir, db })
}

#[test]
fn creates_all_game_log_tables_from_schema_builder() -> Result<(), AppError> {
    let test_db = test_db("backend-gamelog-schema-builder")?;
    let db = &test_db.db;

    let rows = db.execute(
    "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('gamelog_location', 'gamelog_join_leave', 'gamelog_portal_spawn', 'gamelog_video_play', 'gamelog_resource_load', 'gamelog_event', 'gamelog_external')",
    &Default::default(),
)?;
    assert_eq!(rows[0][0], serde_json::json!(7));
    Ok(())
}

#[test]
fn writes_core_game_log_rows_with_parameterized_sql() -> Result<(), AppError> {
    let test_db = test_db("backend-gamelog-writes")?;
    let db = &test_db.db;

    insert_location(
        db,
        &GameLogLocationEntry {
            created_at: "2026-05-14T01:00:00.000Z".into(),
            location: "wrld_test:123".into(),
            world_id: "wrld_test".into(),
            world_name: "测试世界".into(),
            time: 0,
            group_name: "".into(),
        },
    )?;
    insert_join_leave(
        db,
        &GameLogJoinLeaveEntry {
            created_at: "2026-05-14T01:00:10.000Z".into(),
            event_type: "OnPlayerJoined".into(),
            display_name: "做鳄梦small-fry".into(),
            location: "wrld_test:123".into(),
            user_id: "usr_1".into(),
            time: 0,
        },
    )?;
    insert_portal_spawn(
        db,
        &GameLogPortalSpawnEntry {
            created_at: "2026-05-14T01:00:20.000Z".into(),
            display_name: "".into(),
            location: "wrld_test:123".into(),
            user_id: "".into(),
            instance_id: "".into(),
            world_name: "".into(),
        },
    )?;
    insert_resource_load(
        db,
        &GameLogResourceLoadEntry {
            created_at: "2026-05-14T01:00:30.000Z".into(),
            resource_url: "https://example.test/image.png".into(),
            resource_type: "ImageLoad".into(),
            location: "wrld_test:123".into(),
        },
    )?;
    insert_event(
        db,
        &GameLogEventEntry {
            created_at: "2026-05-14T01:00:40.000Z".into(),
            data: "Shader Keyword Limit has been reached".into(),
        },
    )?;

    let rows = db.execute("SELECT COUNT(*) FROM gamelog_location", &Default::default())?;
    assert_eq!(rows[0][0], serde_json::json!(1));
    let rows = db.execute(
        "SELECT display_name FROM gamelog_join_leave",
        &Default::default(),
    )?;
    assert_eq!(rows[0][0], serde_json::json!("做鳄梦small-fry"));
    let rows = db.execute(
        "SELECT COUNT(*) FROM gamelog_portal_spawn",
        &Default::default(),
    )?;
    assert_eq!(rows[0][0], serde_json::json!(1));
    let rows = db.execute(
        "SELECT resource_type FROM gamelog_resource_load",
        &Default::default(),
    )?;
    assert_eq!(rows[0][0], serde_json::json!("ImageLoad"));
    let rows = db.execute("SELECT data FROM gamelog_event", &Default::default())?;
    assert_eq!(
        rows[0][0],
        serde_json::json!("Shader Keyword Limit has been reached")
    );

    Ok(())
}

#[test]
fn duplicate_location_and_join_leave_rows_are_ignored() -> Result<(), AppError> {
    let test_db = test_db("backend-gamelog-dedupe")?;
    let db = &test_db.db;
    let location = GameLogLocationEntry {
        created_at: "2026-05-14T02:00:00.000Z".into(),
        location: "wrld_dup:1".into(),
        world_id: "wrld_dup".into(),
        world_name: "Dup".into(),
        time: 0,
        group_name: "".into(),
    };
    insert_location(db, &location)?;
    insert_location(db, &location)?;

    let join = GameLogJoinLeaveEntry {
        created_at: "2026-05-14T02:00:10.000Z".into(),
        event_type: "OnPlayerJoined".into(),
        display_name: "DupUser".into(),
        location: "wrld_dup:1".into(),
        user_id: "usr_dup".into(),
        time: 0,
    };
    insert_join_leave(db, &join)?;
    insert_join_leave(db, &join)?;

    let rows = db.execute("SELECT COUNT(*) FROM gamelog_location", &Default::default())?;
    assert_eq!(rows[0][0], serde_json::json!(1));
    let rows = db.execute(
        "SELECT COUNT(*) FROM gamelog_join_leave",
        &Default::default(),
    )?;
    assert_eq!(rows[0][0], serde_json::json!(1));
    Ok(())
}

#[test]
fn updates_location_duration_by_created_at() -> Result<(), AppError> {
    let test_db = test_db("backend-gamelog-duration")?;
    let db = &test_db.db;
    insert_location(
        db,
        &GameLogLocationEntry {
            created_at: "2026-05-14T03:00:00.000Z".into(),
            location: "wrld_time:1".into(),
            world_id: "wrld_time".into(),
            world_name: "Timed".into(),
            time: 0,
            group_name: "".into(),
        },
    )?;
    update_location_time(db, "2026-05-14T03:00:00.000Z", 2500)?;
    let rows = db.execute("SELECT time FROM gamelog_location", &Default::default())?;
    assert_eq!(rows[0][0], serde_json::json!(2500));
    Ok(())
}

#[test]
fn writes_core_rows_in_one_batch_and_keeps_deduplication() -> Result<(), AppError> {
    let test_db = test_db("backend-gamelog-batch")?;
    let db = &test_db.db;
    let mut batch = GameLogWriteBatch::default();
    batch.locations.push(GameLogLocationEntry {
        created_at: "2026-05-14T06:00:00.000Z".into(),
        location: "wrld_batch:1".into(),
        world_id: "wrld_batch".into(),
        world_name: "Batch 世界".into(),
        time: 0,
        group_name: "".into(),
    });
    batch.locations.push(batch.locations[0].clone());
    batch.join_leave.push(GameLogJoinLeaveEntry {
        created_at: "2026-05-14T06:00:10.000Z".into(),
        event_type: "OnPlayerJoined".into(),
        display_name: "BatchUser".into(),
        location: "wrld_batch:1".into(),
        user_id: "usr_batch".into(),
        time: 0,
    });
    batch.events.push(GameLogEventEntry {
        created_at: "2026-05-14T06:00:20.000Z".into(),
        data: "event data".into(),
    });

    write_batch(db, &batch)?;

    let rows = db.execute("SELECT COUNT(*) FROM gamelog_location", &Default::default())?;
    assert_eq!(rows[0][0], serde_json::json!(1));
    let rows = db.execute(
        "SELECT COUNT(*) FROM gamelog_join_leave",
        &Default::default(),
    )?;
    assert_eq!(rows[0][0], serde_json::json!(1));
    let rows = db.execute("SELECT COUNT(*) FROM gamelog_event", &Default::default())?;
    assert_eq!(rows[0][0], serde_json::json!(1));
    Ok(())
}

#[test]
fn batch_write_rolls_back_when_one_core_insert_fails() -> Result<(), AppError> {
    let dir = TestDir::new("backend-gamelog-batch-rollback");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    db.execute_non_query(
        "CREATE TABLE gamelog_join_leave (id INTEGER PRIMARY KEY, broken TEXT)",
        &Default::default(),
    )?;

    let mut batch = GameLogWriteBatch::default();
    batch.locations.push(GameLogLocationEntry {
        created_at: "2026-05-14T07:00:00.000Z".into(),
        location: "wrld_rollback:1".into(),
        world_id: "wrld_rollback".into(),
        world_name: "Rollback".into(),
        time: 0,
        group_name: "".into(),
    });
    batch.join_leave.push(GameLogJoinLeaveEntry {
        created_at: "2026-05-14T07:00:10.000Z".into(),
        event_type: "OnPlayerJoined".into(),
        display_name: "RollbackUser".into(),
        location: "wrld_rollback:1".into(),
        user_id: "usr_rollback".into(),
        time: 0,
    });

    assert!(write_batch(&db, &batch).is_err());
    let rows = db.execute(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'gamelog_location'",
        &Default::default(),
    )?;
    assert!(rows.is_empty());
    Ok(())
}
