use std::path::PathBuf;
use std::sync::Arc;

use crate::database::DatabaseService;
use crate::Error;

use crate::config::ConfigKey;

use super::{
    get_bool, get_json, get_raw, remove, set_bool, set_json, set_raw, set_string, ConfigRepository,
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
    db: Arc<DatabaseService>,
}

fn test_db(name: &str) -> Result<TestDatabase, Error> {
    let dir = TestDir::new(name);
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);
    Ok(TestDatabase { _dir: dir, db })
}

#[test]
fn resolves_frontend_config_keys() {
    assert_eq!(
        ConfigKey::new("logResourceLoad").as_str(),
        "config:vrcx_logresourceload"
    );
    assert_eq!(
        ConfigKey::new("VRCX_GameLogDisabled").as_str(),
        "config:vrcx_gamelogdisabled"
    );
    assert_eq!(
        ConfigKey::new("config:vrcx_existing").as_str(),
        "config:vrcx_existing"
    );
    assert_eq!(
        ConfigKey::new("config:VRCX_Existing").as_str(),
        "config:vrcx_existing"
    );
    assert_eq!(
        ConfigKey::new("  VRCX_GameLogDisabled  ").as_str(),
        "config:vrcx_gamelogdisabled"
    );
}

#[test]
fn reads_and_writes_bool_string_and_json_values() -> Result<(), Error> {
    let test_db = test_db("store-config-repository")?;
    let repo = ConfigRepository::new(Arc::clone(&test_db.db));

    assert!(!repo.get_bool("logResourceLoad", false)?);
    repo.set_bool("logResourceLoad", true)?;
    repo.set_string("customKey", "custom-value")?;
    repo.set_json("jsonKey", &serde_json::json!({ "enabled": true }))?;

    assert!(get_bool(&test_db.db, "logResourceLoad", false)?);
    assert_eq!(repo.get_raw("customKey")?, Some("custom-value".into()));
    assert_eq!(
        get_json(&test_db.db, "jsonKey", serde_json::json!({}))?,
        serde_json::json!({ "enabled": true })
    );
    Ok(())
}

#[test]
fn bool_reading_accepts_legacy_shapes() -> Result<(), Error> {
    let test_db = test_db("store-config-bool-shapes")?;

    set_raw(&test_db.db, "one", "1")?;
    set_raw(&test_db.db, "zero", "0")?;
    set_raw(&test_db.db, "trueString", "true")?;
    set_raw(&test_db.db, "falseString", "false")?;

    assert!(get_bool(&test_db.db, "one", false)?);
    assert!(!get_bool(&test_db.db, "zero", true)?);
    assert!(get_bool(&test_db.db, "trueString", false)?);
    assert!(!get_bool(&test_db.db, "falseString", true)?);
    Ok(())
}

#[test]
fn remove_deletes_existing_values() -> Result<(), Error> {
    let test_db = test_db("store-config-remove")?;

    set_string(&test_db.db, "customKey", "value")?;
    assert_eq!(get_raw(&test_db.db, "customKey")?, Some("value".into()));
    remove(&test_db.db, "customKey")?;
    assert_eq!(get_raw(&test_db.db, "customKey")?, None);

    set_bool(&test_db.db, "enabled", true)?;
    set_json(&test_db.db, "payload", &serde_json::json!({ "ok": true }))?;
    assert!(get_bool(&test_db.db, "enabled", false)?);
    assert_eq!(
        get_json(&test_db.db, "payload", serde_json::json!({}))?,
        serde_json::json!({ "ok": true })
    );
    Ok(())
}
