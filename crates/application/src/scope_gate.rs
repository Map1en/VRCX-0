use serde_json::Value;

use vrcx_0_application_core::{
    vrchat_api::{VrchatApiRequest, VrchatScope},
    AuthenticatedMutationContext, Error, Result, RuntimeAuthScope, RuntimeAuthScopeSnapshot,
};

use crate::remote::VrchatRequestPort;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RemoteMutationOutcome {
    Applied,
    AppliedScopeChanged,
}

pub(crate) async fn execute_vrchat_mutation(
    remote: &dyn VrchatRequestPort,
    mutation: &AuthenticatedMutationContext<'_>,
    mut request: VrchatApiRequest,
    action: &str,
) -> Result<RemoteMutationOutcome> {
    mutation.ensure_current()?;
    request.endpoint = Some(mutation.scope().endpoint.clone());
    let response = remote.send(request, VrchatScope::Vrchat).await?;
    let fallback_payload = Value::String(response.data.clone());
    if !(200..300).contains(&response.status) {
        return Err(Error::Custom(response_error_message(
            &serde_json::from_str::<Value>(&response.data).unwrap_or(fallback_payload),
            response.status,
            action,
        )));
    }
    let payload = if response.data.trim().is_empty() {
        Value::Null
    } else {
        serde_json::from_str::<Value>(&response.data).map_err(|error| {
            Error::Custom(format!("VRChat {action} returned invalid JSON: {error}"))
        })?
    };
    if payload.get("error").is_some() {
        return Err(Error::Custom(response_error_message(
            &payload,
            response.status,
            action,
        )));
    }
    if mutation.is_current() {
        Ok(RemoteMutationOutcome::Applied)
    } else {
        Ok(RemoteMutationOutcome::AppliedScopeChanged)
    }
}

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
