use serde_json::Value;

use crate::common::ParamsBuilder;
use crate::database::DatabaseService;
use crate::Error;

const COOKIE_TABLE_SQL: &str =
    "CREATE TABLE IF NOT EXISTS `cookies` (`key` TEXT PRIMARY KEY, `value` TEXT)";
const DEFAULT_COOKIE_KEY: &str = "default";

pub fn ensure_cookie_table(db: &DatabaseService) -> Result<(), Error> {
    db.execute_non_query(COOKIE_TABLE_SQL, &Default::default())?;
    Ok(())
}

pub fn get_default_cookies(db: &DatabaseService) -> Result<Option<String>, Error> {
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
