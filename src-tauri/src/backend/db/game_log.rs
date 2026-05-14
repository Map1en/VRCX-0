use std::collections::HashMap;

use crate::domain::database::{DatabaseService, DatabaseWriteTransaction};
use crate::error::AppError;

const CREATE_GAMELOG_LOCATION: &str = "CREATE TABLE IF NOT EXISTS gamelog_location (id INTEGER PRIMARY KEY, created_at TEXT, location TEXT, world_id TEXT, world_name TEXT, time INTEGER, group_name TEXT, UNIQUE(created_at, location))";
const CREATE_GAMELOG_JOIN_LEAVE: &str = "CREATE TABLE IF NOT EXISTS gamelog_join_leave (id INTEGER PRIMARY KEY, created_at TEXT, type TEXT, display_name TEXT, location TEXT, user_id TEXT, time INTEGER, UNIQUE(created_at, type, display_name))";
const CREATE_GAMELOG_PORTAL_SPAWN: &str = "CREATE TABLE IF NOT EXISTS gamelog_portal_spawn (id INTEGER PRIMARY KEY, created_at TEXT, display_name TEXT, location TEXT, user_id TEXT, instance_id TEXT, world_name TEXT, UNIQUE(created_at, display_name))";
const CREATE_GAMELOG_RESOURCE_LOAD: &str = "CREATE TABLE IF NOT EXISTS gamelog_resource_load (id INTEGER PRIMARY KEY, created_at TEXT, resource_url TEXT, resource_type TEXT, location TEXT, UNIQUE(created_at, resource_url))";
const CREATE_GAMELOG_EVENT: &str = "CREATE TABLE IF NOT EXISTS gamelog_event (id INTEGER PRIMARY KEY, created_at TEXT, data TEXT, UNIQUE(created_at, data))";
const CREATE_GAMELOG_EXTERNAL: &str = "CREATE TABLE IF NOT EXISTS gamelog_external (id INTEGER PRIMARY KEY, created_at TEXT, message TEXT, display_name TEXT, user_id TEXT, location TEXT, UNIQUE(created_at, message))";

const INSERT_LOCATION: &str = "INSERT OR IGNORE INTO gamelog_location (created_at, location, world_id, world_name, time, group_name) VALUES (@created_at, @location, @world_id, @world_name, @time, @group_name)";
const UPDATE_LOCATION_TIME: &str =
    "UPDATE gamelog_location SET time = @time WHERE created_at = @created_at";
const INSERT_JOIN_LEAVE: &str = "INSERT OR IGNORE INTO gamelog_join_leave (created_at, type, display_name, location, user_id, time) VALUES (@created_at, @type, @display_name, @location, @user_id, @time)";
const INSERT_PORTAL_SPAWN: &str = "INSERT OR IGNORE INTO gamelog_portal_spawn (created_at, display_name, location, user_id, instance_id, world_name) VALUES (@created_at, @display_name, @location, @user_id, @instance_id, @world_name)";
const INSERT_RESOURCE_LOAD: &str = "INSERT OR IGNORE INTO gamelog_resource_load (created_at, resource_url, resource_type, location) VALUES (@created_at, @resource_url, @resource_type, @location)";
const INSERT_EVENT: &str =
    "INSERT OR IGNORE INTO gamelog_event (created_at, data) VALUES (@created_at, @data)";
const INSERT_EXTERNAL: &str = "INSERT OR IGNORE INTO gamelog_external (created_at, message, display_name, user_id, location) VALUES (@created_at, @message, @display_name, @user_id, @location)";

trait GameLogWriteTarget {
    fn execute_non_query(
        &self,
        sql: &str,
        args: &HashMap<String, serde_json::Value>,
    ) -> Result<i64, AppError>;
}

impl GameLogWriteTarget for DatabaseService {
    fn execute_non_query(
        &self,
        sql: &str,
        args: &HashMap<String, serde_json::Value>,
    ) -> Result<i64, AppError> {
        DatabaseService::execute_non_query(self, sql, args)
    }
}

impl GameLogWriteTarget for DatabaseWriteTransaction<'_> {
    fn execute_non_query(
        &self,
        sql: &str,
        args: &HashMap<String, serde_json::Value>,
    ) -> Result<i64, AppError> {
        DatabaseWriteTransaction::execute_non_query(self, sql, args)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GameLogLocationEntry {
    pub created_at: String,
    pub location: String,
    pub world_id: String,
    pub world_name: String,
    pub time: i64,
    pub group_name: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GameLogJoinLeaveEntry {
    pub created_at: String,
    pub event_type: String,
    pub display_name: String,
    pub location: String,
    pub user_id: String,
    pub time: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GameLogPortalSpawnEntry {
    pub created_at: String,
    pub display_name: String,
    pub location: String,
    pub user_id: String,
    pub instance_id: String,
    pub world_name: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GameLogResourceLoadEntry {
    pub created_at: String,
    pub resource_url: String,
    pub resource_type: String,
    pub location: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GameLogEventEntry {
    pub created_at: String,
    pub data: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GameLogExternalEntry {
    pub created_at: String,
    pub message: String,
    pub display_name: String,
    pub user_id: String,
    pub location: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GameLogLocationTimeUpdate {
    pub created_at: String,
    pub time: i64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GameLogWriteBatch {
    pub locations: Vec<GameLogLocationEntry>,
    pub location_time_updates: Vec<GameLogLocationTimeUpdate>,
    pub join_leave: Vec<GameLogJoinLeaveEntry>,
    pub portal_spawns: Vec<GameLogPortalSpawnEntry>,
    pub resource_loads: Vec<GameLogResourceLoadEntry>,
    pub events: Vec<GameLogEventEntry>,
    pub externals: Vec<GameLogExternalEntry>,
}

impl GameLogWriteBatch {
    pub fn is_empty(&self) -> bool {
        self.locations.is_empty()
            && self.location_time_updates.is_empty()
            && self.join_leave.is_empty()
            && self.portal_spawns.is_empty()
            && self.resource_loads.is_empty()
            && self.events.is_empty()
            && self.externals.is_empty()
    }
}

#[allow(dead_code)]
pub fn ensure_game_log_tables(db: &DatabaseService) -> Result<(), AppError> {
    ensure_game_log_tables_on(db)
}

fn ensure_game_log_tables_on(target: &impl GameLogWriteTarget) -> Result<(), AppError> {
    let args = HashMap::new();
    for sql in [
        CREATE_GAMELOG_LOCATION,
        CREATE_GAMELOG_JOIN_LEAVE,
        CREATE_GAMELOG_PORTAL_SPAWN,
        CREATE_GAMELOG_RESOURCE_LOAD,
        CREATE_GAMELOG_EVENT,
        CREATE_GAMELOG_EXTERNAL,
    ] {
        target.execute_non_query(sql, &args)?;
    }
    Ok(())
}

#[allow(dead_code)]
pub fn insert_location(db: &DatabaseService, entry: &GameLogLocationEntry) -> Result<(), AppError> {
    insert_location_on(db, entry)
}

fn insert_location_on(
    target: &impl GameLogWriteTarget,
    entry: &GameLogLocationEntry,
) -> Result<(), AppError> {
    let mut args = HashMap::new();
    args.insert(
        "@created_at".to_string(),
        serde_json::json!(entry.created_at),
    );
    args.insert("@location".to_string(), serde_json::json!(entry.location));
    args.insert("@world_id".to_string(), serde_json::json!(entry.world_id));
    args.insert(
        "@world_name".to_string(),
        serde_json::json!(entry.world_name),
    );
    args.insert("@time".to_string(), serde_json::json!(entry.time));
    args.insert(
        "@group_name".to_string(),
        serde_json::json!(entry.group_name),
    );
    target.execute_non_query(INSERT_LOCATION, &args)?;
    Ok(())
}

#[allow(dead_code)]
pub fn update_location_time(
    db: &DatabaseService,
    created_at: &str,
    time: i64,
) -> Result<(), AppError> {
    update_location_time_on(db, created_at, time)
}

fn update_location_time_on(
    target: &impl GameLogWriteTarget,
    created_at: &str,
    time: i64,
) -> Result<(), AppError> {
    let mut args = HashMap::new();
    args.insert("@created_at".to_string(), serde_json::json!(created_at));
    args.insert("@time".to_string(), serde_json::json!(time));
    target.execute_non_query(UPDATE_LOCATION_TIME, &args)?;
    Ok(())
}

#[allow(dead_code)]
pub fn insert_join_leave(
    db: &DatabaseService,
    entry: &GameLogJoinLeaveEntry,
) -> Result<(), AppError> {
    insert_join_leave_on(db, entry)
}

fn insert_join_leave_on(
    target: &impl GameLogWriteTarget,
    entry: &GameLogJoinLeaveEntry,
) -> Result<(), AppError> {
    let mut args = HashMap::new();
    args.insert(
        "@created_at".to_string(),
        serde_json::json!(entry.created_at),
    );
    args.insert("@type".to_string(), serde_json::json!(entry.event_type));
    args.insert(
        "@display_name".to_string(),
        serde_json::json!(entry.display_name),
    );
    args.insert("@location".to_string(), serde_json::json!(entry.location));
    args.insert("@user_id".to_string(), serde_json::json!(entry.user_id));
    args.insert("@time".to_string(), serde_json::json!(entry.time));
    target.execute_non_query(INSERT_JOIN_LEAVE, &args)?;
    Ok(())
}

#[allow(dead_code)]
pub fn insert_portal_spawn(
    db: &DatabaseService,
    entry: &GameLogPortalSpawnEntry,
) -> Result<(), AppError> {
    insert_portal_spawn_on(db, entry)
}

fn insert_portal_spawn_on(
    target: &impl GameLogWriteTarget,
    entry: &GameLogPortalSpawnEntry,
) -> Result<(), AppError> {
    let mut args = HashMap::new();
    args.insert(
        "@created_at".to_string(),
        serde_json::json!(entry.created_at),
    );
    args.insert(
        "@display_name".to_string(),
        serde_json::json!(entry.display_name),
    );
    args.insert("@location".to_string(), serde_json::json!(entry.location));
    args.insert("@user_id".to_string(), serde_json::json!(entry.user_id));
    args.insert(
        "@instance_id".to_string(),
        serde_json::json!(entry.instance_id),
    );
    args.insert(
        "@world_name".to_string(),
        serde_json::json!(entry.world_name),
    );
    target.execute_non_query(INSERT_PORTAL_SPAWN, &args)?;
    Ok(())
}

#[allow(dead_code)]
pub fn insert_resource_load(
    db: &DatabaseService,
    entry: &GameLogResourceLoadEntry,
) -> Result<(), AppError> {
    insert_resource_load_on(db, entry)
}

fn insert_resource_load_on(
    target: &impl GameLogWriteTarget,
    entry: &GameLogResourceLoadEntry,
) -> Result<(), AppError> {
    let mut args = HashMap::new();
    args.insert(
        "@created_at".to_string(),
        serde_json::json!(entry.created_at),
    );
    args.insert(
        "@resource_url".to_string(),
        serde_json::json!(entry.resource_url),
    );
    args.insert(
        "@resource_type".to_string(),
        serde_json::json!(entry.resource_type),
    );
    args.insert("@location".to_string(), serde_json::json!(entry.location));
    target.execute_non_query(INSERT_RESOURCE_LOAD, &args)?;
    Ok(())
}

#[allow(dead_code)]
pub fn insert_event(db: &DatabaseService, entry: &GameLogEventEntry) -> Result<(), AppError> {
    insert_event_on(db, entry)
}

fn insert_event_on(
    target: &impl GameLogWriteTarget,
    entry: &GameLogEventEntry,
) -> Result<(), AppError> {
    let mut args = HashMap::new();
    args.insert(
        "@created_at".to_string(),
        serde_json::json!(entry.created_at),
    );
    args.insert("@data".to_string(), serde_json::json!(entry.data));
    target.execute_non_query(INSERT_EVENT, &args)?;
    Ok(())
}

#[allow(dead_code)]
pub fn insert_external(db: &DatabaseService, entry: &GameLogExternalEntry) -> Result<(), AppError> {
    insert_external_on(db, entry)
}

fn insert_external_on(
    target: &impl GameLogWriteTarget,
    entry: &GameLogExternalEntry,
) -> Result<(), AppError> {
    let mut args = HashMap::new();
    args.insert(
        "@created_at".to_string(),
        serde_json::json!(entry.created_at),
    );
    args.insert("@message".to_string(), serde_json::json!(entry.message));
    args.insert(
        "@display_name".to_string(),
        serde_json::json!(entry.display_name),
    );
    args.insert("@user_id".to_string(), serde_json::json!(entry.user_id));
    args.insert("@location".to_string(), serde_json::json!(entry.location));
    target.execute_non_query(INSERT_EXTERNAL, &args)?;
    Ok(())
}

pub fn write_batch(db: &DatabaseService, batch: &GameLogWriteBatch) -> Result<(), AppError> {
    if batch.is_empty() {
        return Ok(());
    }

    db.write_transaction(|tx| {
        ensure_game_log_tables_on(tx)?;
        for entry in &batch.locations {
            insert_location_on(tx, entry)?;
        }
        for update in &batch.location_time_updates {
            update_location_time_on(tx, &update.created_at, update.time)?;
        }
        for entry in &batch.join_leave {
            insert_join_leave_on(tx, entry)?;
        }
        for entry in &batch.portal_spawns {
            insert_portal_spawn_on(tx, entry)?;
        }
        for entry in &batch.resource_loads {
            insert_resource_load_on(tx, entry)?;
        }
        for entry in &batch.events {
            insert_event_on(tx, entry)?;
        }
        for entry in &batch.externals {
            insert_external_on(tx, entry)?;
        }
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use crate::domain::database::DatabaseService;
    use crate::error::AppError;

    use super::{
        ensure_game_log_tables, insert_event, insert_join_leave, insert_location,
        insert_portal_spawn, insert_resource_load, update_location_time, write_batch,
        GameLogEventEntry, GameLogJoinLeaveEntry, GameLogLocationEntry, GameLogPortalSpawnEntry,
        GameLogResourceLoadEntry, GameLogWriteBatch,
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
}
