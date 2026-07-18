use std::path::PathBuf;

use crate::database::DatabaseService;
use crate::game_log::{game_log_query, get_game_log_events, get_game_log_locations};
use crate::Error;
use serde_json::json;
use vrcx_0_core::json::RawJson;

use super::super::tables::ensure_game_log_tables;
use super::super::types::{
    GameLogEventEntry, GameLogJoinLeaveEntry, GameLogLocationEntry, GameLogPortalSpawnEntry,
    GameLogQueryInput, GameLogResourceLoadEntry, GameLogWriteBatch,
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

fn test_db(name: &str) -> Result<TestDatabase, Error> {
    let dir = TestDir::new(name);
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    ensure_game_log_tables(&db)?;
    Ok(TestDatabase { _dir: dir, db })
}

#[test]
fn creates_all_game_log_tables_from_schema_builder() -> Result<(), Error> {
    let test_db = test_db("store-gamelog-schema-builder")?;
    let db = &test_db.db;

    let rows = db.execute(
    "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('gamelog_location', 'gamelog_join_leave', 'gamelog_portal_spawn', 'gamelog_video_play', 'gamelog_resource_load', 'gamelog_event', 'gamelog_external')",
    &Default::default(),
)?;
    assert_eq!(rows[0][0], serde_json::json!(7));
    Ok(())
}

#[test]
fn writes_core_game_log_rows_with_parameterized_sql() -> Result<(), Error> {
    let test_db = test_db("store-gamelog-writes")?;
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
            world_name: "测试世界".into(),
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
fn duplicate_location_and_join_leave_rows_are_ignored() -> Result<(), Error> {
    let test_db = test_db("store-gamelog-dedupe")?;
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
        world_name: "Dup".into(),
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
fn updates_location_duration_by_created_at() -> Result<(), Error> {
    let test_db = test_db("store-gamelog-duration")?;
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
fn writes_core_rows_in_one_batch_and_keeps_deduplication() -> Result<(), Error> {
    let test_db = test_db("store-gamelog-batch")?;
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
        world_name: "Batch 世界".into(),
        time: 0,
    });
    batch.events.push(GameLogEventEntry {
        created_at: "2026-05-14T06:00:20.000Z".into(),
        data: "event data".into(),
    });

    let affected_count = write_batch(db, "usr_test", &batch)?;
    assert_eq!(affected_count, 3);

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
fn account_scoped_reads_include_shared_rows_and_machine_cursor_stays_global() -> Result<(), Error> {
    let test_db = test_db("store-gamelog-owner-scope")?;
    let db = &test_db.db;

    insert_event(
        db,
        &GameLogEventEntry {
            created_at: "2026-05-14T05:00:00.000Z".into(),
            data: "shared".into(),
        },
    )?;
    insert_location(
        db,
        &GameLogLocationEntry {
            created_at: "2026-05-14T05:00:00.000Z".into(),
            location: "wrld_shared:1".into(),
            world_id: "wrld_shared".into(),
            world_name: "Shared".into(),
            time: 1,
            group_name: "".into(),
        },
    )?;

    for (owner_user_id, created_at, value) in [
        ("usr_a", "2026-05-14T06:00:00.000Z", "a"),
        ("usr_b", "2026-05-14T07:00:00.000Z", "b"),
    ] {
        let mut batch = GameLogWriteBatch::default();
        batch.events.push(GameLogEventEntry {
            created_at: created_at.into(),
            data: value.into(),
        });
        batch.locations.push(GameLogLocationEntry {
            created_at: created_at.into(),
            location: format!("wrld_{value}:1"),
            world_id: format!("wrld_{value}"),
            world_name: value.to_uppercase(),
            time: 1,
            group_name: "".into(),
        });
        assert_eq!(write_batch(db, owner_user_id, &batch)?, 2);
    }

    assert_eq!(
        get_game_log_events(db, "usr_a")?
            .into_iter()
            .map(|entry| entry.data)
            .collect::<Vec<_>>(),
        vec!["shared", "a"]
    );
    assert_eq!(
        get_game_log_events(db, "usr_b")?
            .into_iter()
            .map(|entry| entry.data)
            .collect::<Vec<_>>(),
        vec!["shared", "b"]
    );
    assert_eq!(
        get_game_log_locations(db, "usr_a")?
            .into_iter()
            .map(|entry| entry.location)
            .collect::<Vec<_>>(),
        vec!["wrld_shared:1", "wrld_a:1"]
    );
    let tagged_rows = db.execute(
        "SELECT e.data, o.user_id FROM gamelog_event e JOIN owners o ON o.id = e.owner_id ORDER BY e.id",
        &Default::default(),
    )?;
    assert_eq!(tagged_rows.len(), 2);
    assert_eq!(tagged_rows[0], vec![json!("a"), json!("usr_a")]);
    assert_eq!(tagged_rows[1], vec![json!("b"), json!("usr_b")]);

    let online_sessions = game_log_query(
        db,
        "usr_a",
        GameLogQueryInput {
            kind: "onlineSessions".into(),
            params: RawJson::from(json!({})),
        },
    )?;
    assert_eq!(
        online_sessions
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|row| row.get("created_at").and_then(serde_json::Value::as_str))
            .collect::<Vec<_>>(),
        vec!["2026-05-14T05:00:00.000Z", "2026-05-14T06:00:00.000Z"]
    );

    let last = crate::game_log::get_last_game_log_location(db)?.unwrap();
    assert_eq!(last.location, "wrld_b:1");
    Ok(())
}

#[test]
fn game_log_uniqueness_remains_machine_global() -> Result<(), Error> {
    let test_db = test_db("store-gamelog-global-unique")?;
    let db = &test_db.db;
    let mut batch = GameLogWriteBatch::default();
    batch.events.push(GameLogEventEntry {
        created_at: "2026-05-14T06:00:00.000Z".into(),
        data: "duplicate".into(),
    });

    assert_eq!(write_batch(db, "usr_a", &batch)?, 1);
    assert_eq!(write_batch(db, "usr_b", &batch)?, 0);
    assert!(get_game_log_events(db, "usr_b")?.is_empty());
    Ok(())
}

#[test]
fn machine_cursor_uses_latest_row_from_any_owner() -> Result<(), Error> {
    let test_db = test_db("store-gamelog-global-cursor")?;
    let db = &test_db.db;
    let created_at = (chrono::Utc::now() - chrono::Duration::minutes(1))
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();
    let mut batch = GameLogWriteBatch::default();
    batch.events.push(GameLogEventEntry {
        created_at: created_at.clone(),
        data: "owner-a-latest".into(),
    });
    write_batch(db, "usr_a", &batch)?;

    assert_eq!(crate::game_log::get_last_game_log_date(db)?, created_at);
    Ok(())
}

#[test]
fn batch_write_rolls_back_when_one_core_insert_fails() -> Result<(), Error> {
    let dir = TestDir::new("store-gamelog-batch-rollback");
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
        world_name: "Rollback".into(),
        time: 0,
    });

    assert!(write_batch(&db, "usr_test", &batch).is_err());
    let rows = db.execute("SELECT COUNT(*) FROM gamelog_location", &Default::default())?;
    assert_eq!(rows[0][0], serde_json::json!(0));
    Ok(())
}

#[test]
fn local_query_negative_limits_are_clamped_to_zero() -> Result<(), Error> {
    let test_db = test_db("store-gamelog-negative-limit")?;
    let db = &test_db.db;
    insert_location(
        db,
        &GameLogLocationEntry {
            created_at: "2026-05-14T08:00:00.000Z".into(),
            location: "wrld_limit:1".into(),
            world_id: "wrld_limit".into(),
            world_name: "Limit".into(),
            time: 0,
            group_name: "".into(),
        },
    )?;

    let result = game_log_query(
        db,
        "usr_test",
        GameLogQueryInput {
            kind: "recentDatabase".into(),
            params: RawJson::from(json!({
                "dateOffset": "-365 day",
                "maxTableSize": -1
            })),
        },
    )?;

    assert_eq!(result.as_array().map(Vec::len), Some(0));
    Ok(())
}

#[test]
fn previous_instances_by_user_id_uses_latest_location_metadata() -> Result<(), Error> {
    let test_db = test_db("store-gamelog-previous-instances-user-location")?;
    let db = &test_db.db;
    let target_user_id = "usr_target";
    let matched_location = "wrld_match:1";
    let missing_location = "wrld_missing:1";

    insert_location(
        db,
        &GameLogLocationEntry {
            created_at: "2026-05-14T09:00:00.000Z".into(),
            location: matched_location.into(),
            world_id: "wrld_match".into(),
            world_name: "Old World".into(),
            time: 0,
            group_name: "old-group".into(),
        },
    )?;
    insert_location(
        db,
        &GameLogLocationEntry {
            created_at: "2026-05-14T10:00:00.000Z".into(),
            location: matched_location.into(),
            world_id: "wrld_match".into(),
            world_name: "New World".into(),
            time: 0,
            group_name: "new-group".into(),
        },
    )?;
    insert_location(
        db,
        &GameLogLocationEntry {
            created_at: "2026-05-14T10:30:00.000Z".into(),
            location: "wrld_other:1".into(),
            world_id: "wrld_other".into(),
            world_name: "Other World".into(),
            time: 0,
            group_name: "".into(),
        },
    )?;

    insert_join_leave(
        db,
        &GameLogJoinLeaveEntry {
            created_at: "2026-05-14T10:01:00.000Z".into(),
            event_type: "OnPlayerJoined".into(),
            display_name: "Target".into(),
            location: matched_location.into(),
            user_id: target_user_id.into(),
            world_name: "New World".into(),
            time: 0,
        },
    )?;
    insert_join_leave(
        db,
        &GameLogJoinLeaveEntry {
            created_at: "2026-05-14T10:02:00.000Z".into(),
            event_type: "OnPlayerLeft".into(),
            display_name: "Target".into(),
            location: missing_location.into(),
            user_id: target_user_id.into(),
            world_name: "".into(),
            time: 120,
        },
    )?;
    insert_join_leave(
        db,
        &GameLogJoinLeaveEntry {
            created_at: "2026-05-14T10:03:00.000Z".into(),
            event_type: "OnPlayerJoined".into(),
            display_name: "Other".into(),
            location: "wrld_match:1".into(),
            user_id: "usr_other".into(),
            world_name: "New World".into(),
            time: 0,
        },
    )?;

    let result = game_log_query(
        db,
        "usr_test",
        GameLogQueryInput {
            kind: "previousInstancesByUserIdRows".into(),
            params: RawJson::from(json!({
                "userId": target_user_id
            })),
        },
    )?;

    let rows = result.as_array().cloned().unwrap_or_default();
    assert_eq!(rows.len(), 1);
    let row = &rows[0];
    assert_eq!(row.get("location"), Some(&json!(matched_location)));
    assert_eq!(row.get("worldName"), Some(&json!("New World")));
    assert_eq!(row.get("groupName"), Some(&json!("new-group")));
    assert_eq!(row.get("eventType"), Some(&json!("OnPlayerJoined")));
    Ok(())
}

#[test]
fn previous_instances_by_user_id_filters_by_date_range() -> Result<(), Error> {
    let test_db = test_db("store-gamelog-previous-user-date-range")?;
    let db = &test_db.db;
    let target_user_id = "usr_target";
    let matched_location = "wrld_match:123";

    insert_location(
        db,
        &GameLogLocationEntry {
            created_at: "2026-05-14T10:00:00.000Z".into(),
            location: matched_location.into(),
            world_id: "wrld_match".into(),
            world_name: "Matched World".into(),
            time: 0,
            group_name: "".into(),
        },
    )?;

    for created_at in [
        "2026-05-13T23:59:59.999Z",
        "2026-05-14T10:01:00.000Z",
        "2026-05-15T00:00:00.001Z",
    ] {
        insert_join_leave(
            db,
            &GameLogJoinLeaveEntry {
                created_at: created_at.into(),
                event_type: "OnPlayerJoined".into(),
                display_name: "Target".into(),
                location: matched_location.into(),
                user_id: target_user_id.into(),
                world_name: "Matched World".into(),
                time: 0,
            },
        )?;
    }
    insert_join_leave(
        db,
        &GameLogJoinLeaveEntry {
            created_at: "2026-05-14T12:00:00.000Z".into(),
            event_type: "OnPlayerLeft".into(),
            display_name: "Target".into(),
            location: "wrld_missing:123".into(),
            user_id: target_user_id.into(),
            world_name: "".into(),
            time: 120,
        },
    )?;

    let result = game_log_query(
        db,
        "usr_test",
        GameLogQueryInput {
            kind: "previousInstancesByUserIdRows".into(),
            params: RawJson::from(json!({
                "userId": target_user_id,
                "dateFrom": "2026-05-14T00:00:00.000Z",
                "dateTo": "2026-05-15T00:00:00.000Z"
            })),
        },
    )?;

    let rows = result.as_array().cloned().unwrap_or_default();
    assert_eq!(rows.len(), 1);
    assert_eq!(
        rows[0].get("created_at"),
        Some(&json!("2026-05-14T10:01:00.000Z"))
    );
    assert_eq!(rows[0].get("location"), Some(&json!(matched_location)));
    Ok(())
}

#[test]
fn get_last_location_returns_latest_by_id() -> Result<(), Error> {
    let test_db = test_db("store-gamelog-last-location")?;
    let db = &test_db.db;

    insert_location(
        db,
        &GameLogLocationEntry {
            created_at: "2026-05-14T09:00:00.000Z".into(),
            location: "wrld_a:1".into(),
            world_id: "wrld_a".into(),
            world_name: "A".into(),
            time: 0,
            group_name: "".into(),
        },
    )?;
    insert_location(
        db,
        &GameLogLocationEntry {
            created_at: "2026-05-14T10:00:00.000Z".into(),
            location: "wrld_b:1".into(),
            world_id: "wrld_b".into(),
            world_name: "B".into(),
            time: 0,
            group_name: "".into(),
        },
    )?;

    let last = crate::game_log::get_last_game_log_location(db)?;
    assert_eq!(
        last.map(|entry| entry.location),
        Some("wrld_b:1".to_string())
    );
    Ok(())
}
