use std::collections::HashMap;

use crate::domain::database::DatabaseService;
use crate::error::AppError;

const CREATE_CONFIGS: &str =
    "CREATE TABLE IF NOT EXISTS configs (`key` TEXT PRIMARY KEY, `value` TEXT)";
const SELECT_CONFIG_VALUE: &str = "SELECT value FROM configs WHERE key = @key LIMIT 1";
#[allow(dead_code)]
const UPSERT_CONFIG_VALUE: &str =
    "INSERT OR REPLACE INTO configs (key, value) VALUES (@key, @value)";

pub fn ensure_config_table(db: &DatabaseService) -> Result<(), AppError> {
    db.execute_non_query(CREATE_CONFIGS, &HashMap::new())?;
    Ok(())
}

pub fn get_raw(db: &DatabaseService, key: &str) -> Result<Option<String>, AppError> {
    ensure_config_table(db)?;

    let mut args = HashMap::new();
    args.insert(
        "@key".to_string(),
        serde_json::json!(resolve_config_key(key)),
    );

    Ok(db
        .execute(SELECT_CONFIG_VALUE, &args)?
        .first()
        .and_then(|row| row.first())
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned))
}

pub fn get_bool(db: &DatabaseService, key: &str, default_value: bool) -> Result<bool, AppError> {
    Ok(get_raw(db, key)?.map_or(default_value, |value| value == "true"))
}

#[allow(dead_code)]
pub fn set_raw(db: &DatabaseService, key: &str, value: &str) -> Result<(), AppError> {
    ensure_config_table(db)?;

    let mut args = HashMap::new();
    args.insert(
        "@key".to_string(),
        serde_json::json!(resolve_config_key(key)),
    );
    args.insert("@value".to_string(), serde_json::json!(value));
    db.execute_non_query(UPSERT_CONFIG_VALUE, &args)?;
    Ok(())
}

#[allow(dead_code)]
pub fn set_bool(db: &DatabaseService, key: &str, value: bool) -> Result<(), AppError> {
    set_raw(db, key, if value { "true" } else { "false" })
}

fn resolve_config_key(key: &str) -> String {
    if key.starts_with("config:") {
        return key.to_string();
    }

    let stripped = key.strip_prefix("VRCX_").unwrap_or(key);
    format!("config:vrcx_{}", stripped.to_lowercase())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use crate::domain::database::DatabaseService;
    use crate::error::AppError;

    use super::{get_bool, get_raw, resolve_config_key, set_bool, set_raw};

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
        Ok(TestDatabase { _dir: dir, db })
    }

    #[test]
    fn resolves_frontend_config_keys() {
        assert_eq!(
            resolve_config_key("logResourceLoad"),
            "config:vrcx_logresourceload"
        );
        assert_eq!(
            resolve_config_key("VRCX_GameLogDisabled"),
            "config:vrcx_gamelogdisabled"
        );
        assert_eq!(
            resolve_config_key("config:vrcx_existing"),
            "config:vrcx_existing"
        );
    }

    #[test]
    fn reads_bool_config_with_default() -> Result<(), AppError> {
        let test_db = test_db("backend-config-bool")?;
        let db = &test_db.db;
        assert!(!get_bool(db, "logResourceLoad", false)?);

        let mut args = std::collections::HashMap::new();
        args.insert(
            "@key".to_string(),
            serde_json::json!("config:vrcx_logresourceload"),
        );
        args.insert("@value".to_string(), serde_json::json!("true"));
        db.execute_non_query(
            "INSERT OR REPLACE INTO configs (key, value) VALUES (@key, @value)",
            &args,
        )?;

        assert_eq!(get_raw(db, "logResourceLoad")?, Some("true".into()));
        assert!(get_bool(db, "logResourceLoad", false)?);
        Ok(())
    }

    #[test]
    fn writes_raw_and_bool_config_values() -> Result<(), AppError> {
        let test_db = test_db("backend-config-write")?;
        let db = &test_db.db;

        set_raw(db, "customKey", "custom-value")?;
        set_bool(db, "logResourceLoad", true)?;
        set_bool(db, "gameLogDisabled", false)?;

        assert_eq!(get_raw(db, "customKey")?, Some("custom-value".into()));
        assert!(get_bool(db, "logResourceLoad", false)?);
        assert!(!get_bool(db, "gameLogDisabled", true)?);
        Ok(())
    }
}
