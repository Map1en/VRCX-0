pub fn row_string(row: &[serde_json::Value], index: usize) -> String {
    row.get(index)
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string()
}

#[allow(dead_code)]
pub fn row_i64(row: &[serde_json::Value], index: usize) -> i64 {
    row.get(index)
        .and_then(|value| value.as_i64())
        .or_else(|| {
            row.get(index)
                .and_then(|value| value.as_str()?.parse().ok())
        })
        .unwrap_or_default()
}

#[allow(dead_code)]
pub fn row_bool(row: &[serde_json::Value], index: usize) -> bool {
    match row.get(index) {
        Some(serde_json::Value::Bool(value)) => *value,
        Some(serde_json::Value::Number(value)) => value.as_i64().unwrap_or_default() != 0,
        Some(serde_json::Value::String(value)) => {
            matches!(value.trim().to_ascii_lowercase().as_str(), "true" | "1")
        }
        _ => false,
    }
}
