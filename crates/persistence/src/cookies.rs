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
    let Some(stored) = load_default_cookies_raw(db)? else {
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

fn load_default_cookies_raw(db: &DatabaseService) -> Result<Option<String>, Error> {
    ensure_cookie_table(db)?;
    let args = ParamsBuilder::new().set("key", DEFAULT_COOKIE_KEY).build();
    Ok(db
        .execute("SELECT `value` FROM `cookies` WHERE `key` = @key", &args)?
        .first()
        .and_then(|row| row.first())
        .and_then(Value::as_str)
        .map(ToString::to_string))
}

pub fn save_default_cookies(db: &DatabaseService, value: &str) -> Result<(), Error> {
    let sealed = secrets::seal_secret_with_status(value);
    if secrets::is_initialized() && !sealed.encrypted && !value.is_empty() {
        config::remove(db, secrets::CLEANUP_COMPLETED_CONFIG_KEY)?;
    }
    upsert_default_cookies_raw(db, &sealed.stored)
}

fn upsert_default_cookies_raw(db: &DatabaseService, value: &str) -> Result<(), Error> {
    ensure_cookie_table(db)?;
    let args = ParamsBuilder::new()
        .set("key", DEFAULT_COOKIE_KEY)
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
    let Some(stored) = load_default_cookies_raw(db)? else {
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
    upsert_default_cookies_raw(db, &sealed.stored)?;
    Ok(true)
}
