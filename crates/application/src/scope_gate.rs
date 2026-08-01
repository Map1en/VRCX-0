use serde_json::Value;

use crate::{Error, Result, RuntimeAuthScope, RuntimeAuthScopeSnapshot};

pub(crate) fn require_active_scope(
    auth_scope: &RuntimeAuthScope,
    label: &str,
) -> Result<RuntimeAuthScopeSnapshot> {
    let scope = auth_scope.snapshot();
    if scope.active {
        Ok(scope)
    } else {
        Err(Error::Custom(format!(
            "{label} requires an authenticated session."
        )))
    }
}

pub(crate) fn ensure_scope_matches(
    auth_scope: &RuntimeAuthScope,
    expected: &RuntimeAuthScopeSnapshot,
    label: &str,
) -> Result<()> {
    ensure_snapshot_scope_matches(&auth_scope.snapshot(), expected, label)
}

pub(crate) fn ensure_snapshot_scope_matches(
    current: &RuntimeAuthScopeSnapshot,
    expected: &RuntimeAuthScopeSnapshot,
    label: &str,
) -> Result<()> {
    if current.generation_matches(expected) {
        Ok(())
    } else {
        Err(Error::Custom(format!(
            "{label} authentication scope changed."
        )))
    }
}

pub(crate) fn response_error_message(payload: &Value, status: i32, action: &str) -> String {
    payload
        .get("error")
        .and_then(Value::as_object)
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .or_else(|| payload.get("message").and_then(Value::as_str))
        .map(str::to_string)
        .unwrap_or_else(|| format!("VRChat {action} failed with HTTP {status}."))
}
