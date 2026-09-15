use serde_json::Value;

use vrcx_0_application_core::{Error, Result, RuntimeAuthScope, RuntimeAuthScopeSnapshot};

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

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(generation: u64) -> RuntimeAuthScopeSnapshot {
        RuntimeAuthScopeSnapshot {
            current_user_id: "usr_a".into(),
            endpoint: "https://api.vrchat.cloud/api/1".into(),
            generation,
            active: true,
        }
    }

    #[test]
    fn matching_snapshot_passes_the_gate() {
        assert!(
            ensure_snapshot_scope_matches(&snapshot(3), &snapshot(3), "Favorite import").is_ok()
        );
    }

    #[test]
    fn changed_generation_reports_the_labelled_scope_change() {
        let error = ensure_snapshot_scope_matches(&snapshot(4), &snapshot(3), "Favorite import")
            .unwrap_err();
        assert_eq!(
            error.to_string(),
            "Favorite import authentication scope changed."
        );
    }
}
