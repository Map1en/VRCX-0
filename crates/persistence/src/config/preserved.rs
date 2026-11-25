use std::path::Path;

use rusqlite::Connection;

const CLIENT_ERROR_CURSOR_KEY: &str = "config:vrcx_telemetryclienterrorcursor";
const PRESERVED_CONFIG_KEYS: [&str; 2] =
    ["config:vrcx_telemetryinstallid", CLIENT_ERROR_CURSOR_KEY];

pub(crate) fn read_preserved_config(db_file: &Path) -> Vec<(String, String)> {
    if !db_file.is_file() {
        return Vec::new();
    }
    let connection = match Connection::open(db_file) {
        Ok(connection) => connection,
        Err(error) => {
            tracing::warn!(error = %error, "failed to read config preserved across database replacement");
            return Vec::new();
        }
    };
    PRESERVED_CONFIG_KEYS
        .iter()
        .filter_map(|key| {
            connection
                .query_row("SELECT value FROM configs WHERE key = ?1", [key], |row| {
                    row.get::<_, String>(0)
                })
                .ok()
                .map(|value| (key.to_string(), value))
        })
        .collect()
}

pub(crate) fn write_preserved_config(db_file: &Path, entries: &[(String, String)]) {
    write_entries(db_file, entries, "INSERT OR REPLACE");
}

pub(crate) fn merge_preserved_config_into_restore(db_file: &Path, entries: &[(String, String)]) {
    let (cursor, carried_by_backup): (Vec<_>, Vec<_>) = entries
        .iter()
        .cloned()
        .partition(|(key, _)| key == CLIENT_ERROR_CURSOR_KEY);
    write_entries(db_file, &carried_by_backup, "INSERT OR IGNORE");
    write_entries(db_file, &cursor, "INSERT OR REPLACE");
}

fn write_entries(db_file: &Path, entries: &[(String, String)], insert: &str) {
    if entries.is_empty() {
        return;
    }
    let sql = format!("{insert} INTO configs (key, value) VALUES (?1, ?2)");
    let result = Connection::open(db_file).and_then(|connection| {
        for (key, value) in entries {
            connection.execute(&sql, [key, value])?;
        }
        Ok(())
    });
    if let Err(error) = result {
        tracing::warn!(error = %error, "failed to carry config across database replacement");
    }
}
