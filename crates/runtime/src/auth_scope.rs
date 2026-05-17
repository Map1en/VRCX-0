use std::sync::{Arc, Mutex};

use serde::Serialize;

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendAuthScopeSnapshot {
    pub current_user_id: String,
    pub endpoint: String,
    pub generation: u64,
    pub active: bool,
}

#[derive(Clone, Debug, Default)]
pub struct BackendAuthScope {
    state: Arc<Mutex<BackendAuthScopeSnapshot>>,
}

impl BackendAuthScope {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set(
        &self,
        user_id: impl AsRef<str>,
        endpoint: impl AsRef<str>,
    ) -> BackendAuthScopeSnapshot {
        let mut state = self.lock_state();
        state.generation = state.generation.saturating_add(1);
        state.current_user_id = normalize_text(user_id);
        state.endpoint = normalize_endpoint(endpoint);
        state.active = !state.current_user_id.is_empty();
        state.clone()
    }

    pub fn snapshot(&self) -> BackendAuthScopeSnapshot {
        self.lock_state().clone()
    }

    pub fn matches(&self, user_id: &str, endpoint: &str) -> bool {
        let state = self.lock_state();
        state.active
            && state.current_user_id == user_id.trim()
            && state.endpoint == normalize_endpoint(endpoint)
    }

    fn lock_state(&self) -> std::sync::MutexGuard<'_, BackendAuthScopeSnapshot> {
        self.state.lock().unwrap_or_else(|error| error.into_inner())
    }
}

fn normalize_text(value: impl AsRef<str>) -> String {
    value.as_ref().trim().to_string()
}

fn normalize_endpoint(value: impl AsRef<str>) -> String {
    let endpoint = value.as_ref().trim().trim_end_matches('/');
    if endpoint.is_empty() {
        String::new()
    } else {
        endpoint.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::BackendAuthScope;

    #[test]
    fn tracks_active_auth_scope() {
        let scope = BackendAuthScope::new();
        assert!(!scope.snapshot().active);

        let snapshot = scope.set(" usr_current ", "https://api.example.test/api/1/");
        assert!(snapshot.active);
        assert_eq!(snapshot.current_user_id, "usr_current");
        assert_eq!(snapshot.endpoint, "https://api.example.test/api/1");
        assert!(scope.matches("usr_current", "https://api.example.test/api/1"));
        assert!(scope.matches("usr_current", "https://api.example.test/api/1/"));
        assert!(!scope.matches("usr_other", "https://api.example.test/api/1"));

        let cleared = scope.set("", "");
        assert!(!cleared.active);
        assert!(!scope.matches("usr_current", "https://api.example.test/api/1"));
    }
}
