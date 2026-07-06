use std::sync::Arc;

use crate::common::ParamsBuilder;
use crate::database::DatabaseService;
use crate::Error;

use super::schema::{
    create_configs_sql, delete_value_sql, select_value_sql, upsert_value_sql, COL_KEY, COL_VALUE,
};
use super::types::{resolve_config_key, ConfigKey};

#[derive(Clone)]
pub struct ConfigRepository {
    db: Arc<DatabaseService>,
}

impl ConfigRepository {
    pub fn new(db: Arc<DatabaseService>) -> Self {
        Self { db }
    }

    pub fn ensure_table(&self) -> Result<(), Error> {
        ensure_config_table(&self.db)
    }

    pub fn get_raw(&self, key: impl Into<ConfigKey>) -> Result<Option<String>, Error> {
        get_raw(&self.db, key.into().as_str())
    }

    pub fn get_bool(&self, key: impl Into<ConfigKey>, default_value: bool) -> Result<bool, Error> {
        get_bool(&self.db, key.into().as_str(), default_value)
    }

    pub fn get_string(
        &self,
        key: impl Into<ConfigKey>,
        default_value: &str,
    ) -> Result<String, Error> {
        get_string(&self.db, key.into().as_str(), default_value)
    }

    pub fn get_json(
        &self,
        key: impl Into<ConfigKey>,
        default_value: serde_json::Value,
    ) -> Result<serde_json::Value, Error> {
        get_json(&self.db, key.into().as_str(), default_value)
    }

    pub fn set_raw(&self, key: impl Into<ConfigKey>, value: &str) -> Result<(), Error> {
        set_raw(&self.db, key.into().as_str(), value)
    }

    pub fn set_bool(&self, key: impl Into<ConfigKey>, value: bool) -> Result<(), Error> {
        set_bool(&self.db, key.into().as_str(), value)
    }

    pub fn set_string(&self, key: impl Into<ConfigKey>, value: &str) -> Result<(), Error> {
        set_string(&self.db, key.into().as_str(), value)
    }

    pub fn set_json(
        &self,
        key: impl Into<ConfigKey>,
        value: &serde_json::Value,
    ) -> Result<(), Error> {
        set_json(&self.db, key.into().as_str(), value)
    }

    pub fn remove(&self, key: impl Into<ConfigKey>) -> Result<(), Error> {
        remove(&self.db, key.into().as_str())
    }
}

pub fn ensure_config_table(db: &DatabaseService) -> Result<(), Error> {
    db.execute_non_query(&create_configs_sql(), &Default::default())?;
    Ok(())
}

pub fn get_raw(db: &DatabaseService, key: &str) -> Result<Option<String>, Error> {
    ensure_config_table(db)?;
    let args = ParamsBuilder::new()
        .set(COL_KEY, resolve_config_key(key))
        .build();

    Ok(db
        .execute(&select_value_sql(), &args)?
        .first()
        .and_then(|row| row.first())
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned))
}

pub fn get_bool(db: &DatabaseService, key: &str, default_value: bool) -> Result<bool, Error> {
    Ok(get_raw(db, key)?.map_or(default_value, |value| {
        parse_bool_config(&value).unwrap_or(default_value)
    }))
}

pub fn get_string(db: &DatabaseService, key: &str, default_value: &str) -> Result<String, Error> {
    Ok(get_raw(db, key)?.unwrap_or_else(|| default_value.to_string()))
}

pub fn get_json(
    db: &DatabaseService,
    key: &str,
    default_value: serde_json::Value,
) -> Result<serde_json::Value, Error> {
    let Some(value) = get_raw(db, key)? else {
        return Ok(default_value);
    };
    Ok(serde_json::from_str(&value).unwrap_or(default_value))
}

pub fn set_raw(db: &DatabaseService, key: &str, value: &str) -> Result<(), Error> {
    ensure_config_table(db)?;
    let args = ParamsBuilder::new()
        .set(COL_KEY, resolve_config_key(key))
        .set(COL_VALUE, value)
        .build();
    db.execute_non_query(&upsert_value_sql(), &args)?;
    Ok(())
}

pub fn set_bool(db: &DatabaseService, key: &str, value: bool) -> Result<(), Error> {
    set_raw(db, key, if value { "true" } else { "false" })
}

pub fn set_string(db: &DatabaseService, key: &str, value: &str) -> Result<(), Error> {
    set_raw(db, key, value)
}

pub fn set_json(db: &DatabaseService, key: &str, value: &serde_json::Value) -> Result<(), Error> {
    set_raw(db, key, &value.to_string())
}

pub fn remove(db: &DatabaseService, key: &str) -> Result<(), Error> {
    ensure_config_table(db)?;
    let args = ParamsBuilder::new()
        .set(COL_KEY, resolve_config_key(key))
        .build();
    db.execute_non_query(&delete_value_sql(), &args)?;
    Ok(())
}

fn parse_bool_config(value: &str) -> Option<bool> {
    match value.trim().to_ascii_lowercase().as_str() {
        "true" | "1" => Some(true),
        "false" | "0" => Some(false),
        other => serde_json::from_str::<bool>(other).ok().or_else(|| {
            serde_json::from_str::<String>(value)
                .ok()
                .and_then(|inner| parse_bool_config(&inner))
        }),
    }
}

#[cfg(test)]
#[path = "../../tests/config/tests.rs"]
mod tests;
