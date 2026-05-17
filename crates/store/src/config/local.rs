#![allow(non_snake_case)]
#![allow(unused_imports)]

use serde_json::Value;

use crate::common::ParamsBuilder;
use crate::database::DatabaseService;
use crate::domain_support::*;
use crate::Error;

use super::types::{ConfigReadEntry, ConfigWriteEntry};

pub fn app__config_set_values(
    db: &DatabaseService,
    entries: Vec<ConfigWriteEntry>,
) -> Result<(), Error> {
    ensure_config_table(db)?;
    db.write_transaction(|tx| {
        for entry in &entries {
            tx.execute_non_query(
                "INSERT OR REPLACE INTO configs (key, value) VALUES (@key, @value)",
                &ParamsBuilder::new()
                    .set("key", normalize_config_key(&entry.key))
                    .set("value", entry.value.clone())
                    .build(),
            )?;
        }
        Ok(())
    })?;
    Ok(())
}

pub fn app__config_list_values(db: &DatabaseService) -> Result<Vec<ConfigReadEntry>, Error> {
    ensure_config_table(db)?;
    Ok(db
        .execute("SELECT key, value FROM configs", &Default::default())?
        .into_iter()
        .map(|row| ConfigReadEntry {
            key: row_string(&row, 0),
            value: row_string(&row, 1),
        })
        .collect())
}

pub fn app__config_remove_value(db: &DatabaseService, key: String) -> Result<i64, Error> {
    ensure_config_table(db)?;
    db.execute_non_query(
        "DELETE FROM configs WHERE key = @key",
        &ParamsBuilder::new()
            .set("key", normalize_config_key(&key))
            .build(),
    )
}
