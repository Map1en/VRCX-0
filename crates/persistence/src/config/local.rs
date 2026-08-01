#![allow(non_snake_case)]

use crate::common::{row_string, ParamsBuilder};
use crate::database::DatabaseService;
use crate::Error;

use super::repository::ensure_config_table;
use super::types::{resolve_config_key, ConfigMutation, ConfigReadEntry, ConfigWriteEntry};

pub fn config_apply_mutations(
    db: &DatabaseService,
    mutations: &[ConfigMutation],
) -> Result<(), Error> {
    ensure_config_table(db)?;
    db.write_transaction(|tx| {
        for mutation in mutations {
            let key = resolve_config_key(&mutation.key);
            match mutation.value.as_deref() {
                Some(value) => {
                    tx.execute_non_query(
                        "INSERT OR REPLACE INTO configs (key, value) VALUES (@key, @value)",
                        &ParamsBuilder::new()
                            .set("key", key)
                            .set("value", value)
                            .build(),
                    )?;
                }
                None => {
                    tx.execute_non_query(
                        "DELETE FROM configs WHERE key = @key",
                        &ParamsBuilder::new().set("key", key).build(),
                    )?;
                }
            }
        }
        Ok(())
    })
}

pub fn config_set_values(
    db: &DatabaseService,
    entries: Vec<ConfigWriteEntry>,
) -> Result<(), Error> {
    ensure_config_table(db)?;
    db.write_transaction(|tx| {
        for entry in &entries {
            tx.execute_non_query(
                "INSERT OR REPLACE INTO configs (key, value) VALUES (@key, @value)",
                &ParamsBuilder::new()
                    .set("key", resolve_config_key(&entry.key))
                    .set("value", entry.value.clone())
                    .build(),
            )?;
        }
        Ok(())
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::*;

    static NEXT_TEST_ID: AtomicU64 = AtomicU64::new(1);

    #[test]
    fn applies_set_and_remove_mutations_in_one_write_transaction() {
        let path = std::env::temp_dir().join(format!(
            "vrcx-0-config-mutations-{}-{}.sqlite3",
            std::process::id(),
            NEXT_TEST_ID.fetch_add(1, Ordering::Relaxed)
        ));
        let db = DatabaseService::new(&path).unwrap();
        super::super::repository::set_string(&db, "themeA", "old").unwrap();
        super::super::repository::set_string(&db, "themeB", "remove").unwrap();

        config_apply_mutations(
            &db,
            &[
                ConfigMutation::set("themeA", "new"),
                ConfigMutation::remove("themeB"),
                ConfigMutation::set("themeC", "created"),
            ],
        )
        .unwrap();

        assert_eq!(
            super::super::repository::get_string(&db, "themeA", "").unwrap(),
            "new"
        );
        assert_eq!(
            super::super::repository::get_raw(&db, "themeB").unwrap(),
            None
        );
        assert_eq!(
            super::super::repository::get_string(&db, "themeC", "").unwrap(),
            "created"
        );
        drop(db);
        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(path.with_extension("sqlite3-wal"));
        let _ = fs::remove_file(path.with_extension("sqlite3-shm"));
    }
}

pub fn config_list_values(db: &DatabaseService) -> Result<Vec<ConfigReadEntry>, Error> {
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

pub fn config_remove_value(db: &DatabaseService, key: String) -> Result<i64, Error> {
    ensure_config_table(db)?;
    db.execute_non_query(
        "DELETE FROM configs WHERE key = @key",
        &ParamsBuilder::new()
            .set("key", resolve_config_key(&key))
            .build(),
    )
}
