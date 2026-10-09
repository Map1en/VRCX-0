use serde_json::Value;

use crate::common::ParamsBuilder;
use crate::config;
use crate::database::DatabaseService;
use crate::secrets;
use crate::Error;

const COOKIE_TABLE_SQL: &str =
    "CREATE TABLE IF NOT EXISTS `cookies` (`key` TEXT PRIMARY KEY, `value` TEXT)";
const DEFAULT_COOKIE_KEY: &str = "default";

pub fn ensure_cookie_table(db: &DatabaseService) -> Result<(), Error> {
    db.execute_non_query(COOKIE_TABLE_SQL, &Default::default())?;
    Ok(())
}

pub fn get_default_cookies(db: &DatabaseService) -> Result<Option<String>, Error> {
    get_cookies(db, DEFAULT_COOKIE_KEY)
}

/// Loads cookies stored under a profile-specific key.
///
/// Headless collectors share a database with remote desktop clients, so their
/// VRChat session must not replace the desktop's default cookie jar.
pub fn get_cookies(db: &DatabaseService, key: &str) -> Result<Option<String>, Error> {
    let Some(stored) = load_cookies_raw(db, key)? else {
        return Ok(None);
    };
    let Some(cookies) = secrets::open_secret(&stored) else {
        tracing::info!(
            "stored cookies are not decryptable on this machine; treating as no session"
        );
        return Ok(None);
    };
    Ok(Some(cookies))
}

fn load_cookies_raw(db: &DatabaseService, key: &str) -> Result<Option<String>, Error> {
    ensure_cookie_table(db)?;
    let args = ParamsBuilder::new().set("key", key).build();
    Ok(db
        .execute("SELECT `value` FROM `cookies` WHERE `key` = @key", &args)?
        .first()
        .and_then(|row| row.first())
        .and_then(Value::as_str)
        .map(ToString::to_string))
}

pub fn save_default_cookies(db: &DatabaseService, value: &str) -> Result<(), Error> {
    save_cookies(db, DEFAULT_COOKIE_KEY, value)
}

/// Saves cookies under a profile-specific key.
pub fn save_cookies(db: &DatabaseService, key: &str, value: &str) -> Result<(), Error> {
    let sealed = secrets::seal_secret_with_status(value);
    if secrets::is_initialized() && !sealed.encrypted && !value.is_empty() {
        config::remove(db, secrets::CLEANUP_COMPLETED_CONFIG_KEY)?;
    }
    upsert_cookies_raw(db, key, &sealed.stored)
}

fn upsert_cookies_raw(db: &DatabaseService, key: &str, value: &str) -> Result<(), Error> {
    ensure_cookie_table(db)?;
    let args = ParamsBuilder::new()
        .set("key", key)
        .set("value", value)
        .build();
    db.execute_non_query(
        "INSERT OR REPLACE INTO `cookies` (`key`, `value`) VALUES (@key, @value)",
        &args,
    )?;
    Ok(())
}

pub fn migrate_default_cookies(db: &DatabaseService) -> Result<bool, Error> {
    if !secrets::is_encrypting_writes() {
        return Ok(false);
    }
    let Some(stored) = load_cookies_raw(db, DEFAULT_COOKIE_KEY)? else {
        return Ok(false);
    };
    if stored.is_empty() || secrets::is_sealed_secret(&stored) {
        return Ok(false);
    }
    let sealed = secrets::seal_secret_with_status(&stored);
    if !sealed.encrypted {
        return Err(Error::Custom(
            "failed to encrypt stored cookies during migration".into(),
        ));
    }
    config::remove(db, secrets::CLEANUP_COMPLETED_CONFIG_KEY)?;
    upsert_cookies_raw(db, DEFAULT_COOKIE_KEY, &sealed.stored)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    struct TestDb {
        path: PathBuf,
        db: Option<DatabaseService>,
    }

    impl TestDb {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!(
                "vrcx-0-cookie-namespace-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            let path = dir.join("profile.sqlite3");
            let db = DatabaseService::new(&path).unwrap();
            Self { path, db: Some(db) }
        }
    }

    impl Drop for TestDb {
        fn drop(&mut self) {
            drop(self.db.take());
            if let Some(parent) = self.path.parent() {
                let _ = std::fs::remove_dir_all(parent);
            }
        }
    }

    #[test]
    fn profile_cookie_slot_keeps_collector_session_separate_from_desktop() {
        let test_db = TestDb::new();
        let db = test_db.db.as_ref().unwrap();

        save_default_cookies(db, "desktop-session").unwrap();
        save_cookies(db, "headless", "collector-session").unwrap();

        assert_eq!(
            get_default_cookies(db).unwrap().as_deref(),
            Some("desktop-session")
        );
        assert_eq!(
            get_cookies(db, "headless").unwrap().as_deref(),
            Some("collector-session")
        );
    }
}
