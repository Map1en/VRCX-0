use std::path::Path;
use std::sync::Mutex;

use rusqlite::{types::Value, Connection};

use crate::error::AppError;

pub struct DatabaseService {
    conn: Mutex<Connection>,
}

impl DatabaseService {
    pub fn new(db_path: &Path) -> Result<Self, AppError> {
        let conn = Connection::open(db_path).map_err(|e| AppError::Database(e.to_string()))?;

        conn.execute_batch(
            "PRAGMA locking_mode=NORMAL;
             PRAGMA busy_timeout=5000;
             PRAGMA journal_mode=WAL;
             PRAGMA optimize=0x10002;",
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn execute(
        &self,
        sql: &str,
        args: &std::collections::HashMap<String, serde_json::Value>,
    ) -> Result<Vec<Vec<serde_json::Value>>, AppError> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| AppError::Database(e.to_string()))?;

        let mut stmt = conn
            .prepare(sql)
            .map_err(|e| AppError::Database(e.to_string()))?;

        let param_names: Vec<String> = (1..=stmt.parameter_count())
            .filter_map(|i| stmt.parameter_name(i).map(|s| s.to_owned()))
            .collect();

        let params: Vec<Box<dyn rusqlite::types::ToSql>> = param_names
            .iter()
            .map(|name| json_to_sql(args.get(name.as_str())))
            .collect();

        let param_refs: Vec<(&str, &dyn rusqlite::types::ToSql)> = param_names
            .iter()
            .zip(params.iter())
            .map(|(name, val)| (name.as_str(), val.as_ref()))
            .collect();

        let col_count = stmt.column_count();

        let rows = stmt
            .query_map(&*param_refs, |row| {
                let mut vals = Vec::with_capacity(col_count);
                for i in 0..col_count {
                    let val: Value = row.get(i)?;
                    vals.push(sqlite_value_to_json(val));
                }
                Ok(vals)
            })
            .map_err(|e| AppError::Database(e.to_string()))?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| AppError::Database(e.to_string()))?);
        }
        Ok(result)
    }

    pub fn execute_non_query(
        &self,
        sql: &str,
        args: &std::collections::HashMap<String, serde_json::Value>,
    ) -> Result<i64, AppError> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| AppError::Database(e.to_string()))?;

        let mut stmt = conn
            .prepare(sql)
            .map_err(|e| AppError::Database(e.to_string()))?;

        let param_names: Vec<String> = (1..=stmt.parameter_count())
            .filter_map(|i| stmt.parameter_name(i).map(|s| s.to_owned()))
            .collect();

        let params: Vec<Box<dyn rusqlite::types::ToSql>> = param_names
            .iter()
            .map(|name| json_to_sql(args.get(name.as_str())))
            .collect();

        let param_refs: Vec<(&str, &dyn rusqlite::types::ToSql)> = param_names
            .iter()
            .zip(params.iter())
            .map(|(name, val)| (name.as_str(), val.as_ref()))
            .collect();

        let affected = stmt
            .execute(&*param_refs)
            .map_err(|e| AppError::Database(e.to_string()))?;

        Ok(affected as i64)
    }
}

fn json_to_sql(val: Option<&serde_json::Value>) -> Box<dyn rusqlite::types::ToSql> {
    match val {
        None | Some(serde_json::Value::Null) => Box::new(rusqlite::types::Null),
        Some(serde_json::Value::Bool(b)) => Box::new(if *b { 1i64 } else { 0i64 }),
        Some(serde_json::Value::Number(n)) => {
            if let Some(i) = n.as_i64() {
                Box::new(i)
            } else if let Some(f) = n.as_f64() {
                Box::new(f)
            } else {
                Box::new(n.to_string())
            }
        }
        Some(serde_json::Value::String(s)) => Box::new(s.clone()),
        Some(other) => Box::new(other.to_string()),
    }
}

fn sqlite_value_to_json(val: Value) -> serde_json::Value {
    match val {
        Value::Null => serde_json::Value::Null,
        Value::Integer(i) => serde_json::json!(i),
        Value::Real(f) => serde_json::json!(f),
        Value::Text(s) => serde_json::json!(s),
        Value::Blob(b) => serde_json::json!(base64_encode(&b)),
    }
}

fn base64_encode(data: &[u8]) -> String {
    let mut s = String::with_capacity(data.len() * 4 / 3 + 4);

    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        s.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        s.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            s.push(CHARS[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            s.push('=');
        }
        if chunk.len() > 2 {
            s.push(CHARS[(triple & 0x3F) as usize] as char);
        } else {
            s.push('=');
        }
    }
    s
}
