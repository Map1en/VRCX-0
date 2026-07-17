use super::*;

pub(super) fn resolve_state_bucket(
    content: &Value,
    patch: &Value,
    previous: Option<&Value>,
    trust_event_user_state: bool,
    fallback: &str,
) -> String {
    let user_state = trust_event_user_state
        .then(|| content.get("user").and_then(|user| user.get("state")))
        .flatten();
    for candidate in [
        content.get("stateBucket"),
        content.get("state"),
        content.get("user").and_then(|user| user.get("stateBucket")),
        user_state,
        patch.get("stateBucket"),
        patch.get("state"),
        previous.and_then(|previous| previous.get("stateBucket")),
        previous.and_then(|previous| previous.get("state")),
    ] {
        let normalized = candidate
            .and_then(Value::as_str)
            .and_then(normalize_state_bucket);
        if let Some(normalized) = normalized {
            return normalized;
        }
    }
    fallback.to_string()
}

pub(super) fn state_bucket_from_patch(patch: &Value, fallback: &str) -> String {
    patch
        .get("state")
        .and_then(Value::as_str)
        .and_then(normalize_state_bucket)
        .unwrap_or_else(|| fallback.to_string())
}
