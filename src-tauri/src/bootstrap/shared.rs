use crate::state::AppState;

pub(super) fn json_string_field(value: &serde_json::Value, key: &str) -> String {
    value
        .get(key)
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}

pub(super) fn db_config_bool(state: &AppState, key: &str) -> Option<bool> {
    state.runtime_context.config().get_bool(key, false).ok()
}

pub(super) fn app_language(state: &AppState) -> String {
    state
        .runtime_context
        .config()
        .get_string("appLanguage", "en")
        .unwrap_or_else(|_| "en".into())
        .to_ascii_lowercase()
}
