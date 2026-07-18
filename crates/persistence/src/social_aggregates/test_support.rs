use std::path::PathBuf;
use std::sync::Arc;

use crate::database::DatabaseService;
pub(super) use crate::realtime::ensure_realtime_tables;

use super::*;

pub(super) struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "vrcx-0-social-aggregates-{name}-{}-{nonce}",
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

pub(super) fn test_db(name: &str) -> (TestDir, Arc<DatabaseService>) {
    let dir = TestDir::new(name);
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap());
    (dir, db)
}

pub(super) fn create_game_log_tables(db: &DatabaseService) {
    db.execute_non_query(
        "CREATE TABLE gamelog_join_leave (
                id INTEGER PRIMARY KEY,
                created_at TEXT,
                type TEXT,
                display_name TEXT,
                location TEXT,
                user_id TEXT,
                time INTEGER,
                owner_id INTEGER NOT NULL DEFAULT 0
            )",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "CREATE TABLE gamelog_location (
                id INTEGER PRIMARY KEY,
                created_at TEXT,
                location TEXT,
                world_id TEXT,
                world_name TEXT,
                time INTEGER,
                group_name TEXT,
                owner_id INTEGER NOT NULL DEFAULT 0
            )",
        &Default::default(),
    )
    .unwrap();
}

pub(super) fn favorite_friend_input(action: &str, dry_run: bool) -> FavoriteLocalInput {
    FavoriteLocalInput {
        kind: "friend".into(),
        entity_id: "usr_alice".into(),
        group: "AI Picks".into(),
        action: action.into(),
        dry_run,
    }
}

pub(super) fn insert_join_leave(
    db: &DatabaseService,
    created_at: &str,
    kind: &str,
    display_name: &str,
    user_id: &str,
    location: &str,
    millis: i64,
) {
    db.execute_non_query(
        "INSERT INTO gamelog_join_leave (created_at, type, display_name, location, user_id, time)
         VALUES (@created_at, @type, @display_name, @location, @user_id, @time)",
        &crate::common::ParamsBuilder::new()
            .set("created_at", created_at)
            .set("type", kind)
            .set("display_name", display_name)
            .set("location", location)
            .set("user_id", user_id)
            .set("time", millis)
            .build(),
    )
    .unwrap();
}
