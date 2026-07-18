use serde_json::Value;
use vrcx_0_core::realtime::RealtimeWsMessagePayload;

pub fn is_print_created_content_refresh(payload: &RealtimeWsMessagePayload) -> bool {
    if text_field(&payload.json, "type") != "content-refresh" {
        return false;
    }
    let content = payload.json.get("content").unwrap_or(&Value::Null);
    text_field(content, "contentType") == "print" && text_field(content, "actionType") == "created"
}

fn text_field(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}
