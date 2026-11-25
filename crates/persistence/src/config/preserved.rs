use std::path::Path;

use rusqlite::Connection;

const PRESERVED_CONFIG_KEYS: [&str; 2] = [
    "config:vrcx_telemetryinstallid",
    "config:vrcx_telemetryclienterrorcursor",
];

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

pub(crate) fn fill_missing_preserved_config(db_file: &Path, entries: &[(String, String)]) {
    write_entries(db_file, entries, "INSERT OR IGNORE");
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
