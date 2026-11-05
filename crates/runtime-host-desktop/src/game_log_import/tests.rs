use std::path::PathBuf;
use std::sync::Arc;

use serde_json::json;
use vrcx_0_application_game::{GameLogImportConsent, GameLogImportFileStatus};
use vrcx_0_core::OwnerId;
use vrcx_0_outbound_adapters::LocalConfigStore;
use vrcx_0_persistence::activity::{
    activity_self_sessions_refresh, activity_sync_state_get, ActivityRefreshMode,
    ActivitySelfSessionsRefreshInput,
};
use vrcx_0_persistence::storage::StorageService;
use vrcx_0_persistence::DatabaseService;

use super::{import_game_log, inspect_game_log_import};

const LOG: [&str; 6] = [
    "2026.06.21 22:00:00 Debug      -  User Authenticated: Me (usr_self)",
    "2026.06.21 22:10:00 Log        -  [Behaviour] Entering Room: Midnight Rooftop",
    "2026.06.21 22:10:05 Log        -  [Behaviour] Joining wrld_abc:123",
    "2026.06.21 22:11:00 Log        -  [Behaviour] OnPlayerJoined Maple (usr_join)",
    "2026.06.21 22:12:00 Log        -  [Behaviour] OnPlayerLeft Maple (usr_join)",
    "2026.06.21 22:20:01 Log        -  [Behaviour] OnLeftRoom",
];

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
            "vrcx-0-host-game-log-import-{name}-{}-{nonce}",
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

fn fixture(name: &str) -> (TestDir, Arc<DatabaseService>, Arc<LocalConfigStore>, String) {
    let dir = TestDir::new(name);
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap());
    let storage = Arc::new(StorageService::new(&dir.path.join("storage.json")).unwrap());
    let config = Arc::new(LocalConfigStore::new(Arc::clone(&db), storage));
    let log = dir.path.join("output_log_vrcx-replay.txt");
    std::fs::write(&log, format!("{}\n", LOG.join("\n"))).unwrap();
    let log = log.to_string_lossy().into_owned();
    (dir, db, config, log)
}

#[test]
fn importing_the_same_log_twice_only_adds_rows_once() {
    let (_dir, db, config, log) = fixture("dedupe");
    let owner = OwnerId::new("usr_self");

    let first = import_game_log(
        &db,
        config.as_ref(),
        &owner,
        std::slice::from_ref(&log),
        GameLogImportConsent::default(),
        false,
    )
    .unwrap();
    let second = import_game_log(
        &db,
        config.as_ref(),
        &owner,
        &[log],
        GameLogImportConsent::default(),
        false,
    )
    .unwrap();

    assert_eq!(first[0].inserted_count, 3);
    assert!(second[0].imported);
    assert_eq!(second[0].inserted_count, 0);
}

#[test]
fn importing_new_rows_invalidates_self_activity_sessions() {
    let (_dir, db, config, log) = fixture("activity");
    let owner = OwnerId::new("usr_self");
    activity_self_sessions_refresh(
        &db,
        &owner,
        ActivitySelfSessionsRefreshInput {
            user_id: owner.as_str().to_string(),
            mode: ActivityRefreshMode::Full,
            range_days: json!(30),
            now_ms: None,
        },
    )
    .unwrap();
    assert!(activity_sync_state_get(&db, owner.as_str().to_string())
        .unwrap()
        .is_some());

    import_game_log(
        &db,
        config.as_ref(),
        &owner,
        &[log],
        GameLogImportConsent::default(),
        false,
    )
    .unwrap();

    assert!(activity_sync_state_get(&db, owner.as_str().to_string())
        .unwrap()
        .is_none());
}

#[test]
fn import_requires_a_signed_in_account() {
    let (_dir, db, config, log) = fixture("signed-out");
    let owner = OwnerId::new("");

    assert!(inspect_game_log_import(&owner, std::slice::from_ref(&log), false).is_err());
    assert!(import_game_log(
        &db,
        config.as_ref(),
        &owner,
        &[log],
        GameLogImportConsent::default(),
        false
    )
    .is_err());
}

#[test]
fn inspect_reports_each_selected_file() {
    let (dir, _db, _config, log) = fixture("inspect");
    let missing = dir.path.join("missing.txt").to_string_lossy().into_owned();

    let files = inspect_game_log_import(&OwnerId::new("usr_self"), &[log, missing], false).unwrap();

    assert_eq!(
        files.iter().map(|file| file.status).collect::<Vec<_>>(),
        vec![
            GameLogImportFileStatus::Ready,
            GameLogImportFileStatus::Unreadable
        ]
    );
}
