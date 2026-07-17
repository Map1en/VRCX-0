use std::sync::{Arc, Mutex};

use serde::Serialize;
use vrcx_0_vrchat_client::http_api::normalize_vrchat_api_endpoint;

#[derive(Clone, Debug, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAuthScopeSnapshot {
    pub current_user_id: String,
    pub endpoint: String,
    pub generation: u64,
    pub active: bool,
}

#[derive(Clone, Debug, Default)]
pub struct RuntimeAuthScope {
    state: Arc<Mutex<RuntimeAuthScopeSnapshot>>,
}

impl RuntimeAuthScope {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set(
        &self,
        user_id: impl AsRef<str>,
        endpoint: impl AsRef<str>,
    ) -> RuntimeAuthScopeSnapshot {
        let mut state = self.lock_state();
        let current_user_id = normalize_text(user_id);
        let endpoint = normalize_endpoint(endpoint);
        let active = !current_user_id.is_empty();
        if state.current_user_id == current_user_id
            && state.endpoint == endpoint
            && state.active == active
        {
            return state.clone();
        }
        state.generation = state.generation.saturating_add(1);
        state.current_user_id = current_user_id;
        state.endpoint = endpoint;
        state.active = active;
        state.clone()
    }

    pub fn snapshot(&self) -> RuntimeAuthScopeSnapshot {
        self.lock_state().clone()
    }

    pub fn matches(&self, user_id: &str, endpoint: &str) -> bool {
        let state = self.lock_state();
        state.active
            && state.current_user_id == user_id.trim()
            && state.endpoint == normalize_endpoint(endpoint)
    }

    fn lock_state(&self) -> std::sync::MutexGuard<'_, RuntimeAuthScopeSnapshot> {
        self.state.lock().unwrap_or_else(|error| error.into_inner())
    }
}

fn normalize_text(value: impl AsRef<str>) -> String {
    value.as_ref().trim().to_string()
}

fn normalize_endpoint(value: impl AsRef<str>) -> String {
    normalize_vrchat_api_endpoint(Some(value.as_ref()))
}

#[cfg(test)]
mod tests {
    use super::RuntimeAuthScope;

    #[test]
    fn tracks_active_auth_scope() {
        let scope = RuntimeAuthScope::new();
        assert!(!scope.snapshot().active);

        let snapshot = scope.set(" usr_current ", "https://api.example.test/api/1/");
        assert!(snapshot.active);
        assert_eq!(snapshot.current_user_id, "usr_current");
        assert_eq!(snapshot.endpoint, "https://api.example.test/api/1");
        assert!(scope.matches("usr_current", "https://api.example.test/api/1"));
        assert!(scope.matches("usr_current", "https://api.example.test/api/1/"));
        assert!(!scope.matches("usr_other", "https://api.example.test/api/1"));

        let unchanged = scope.set(" usr_current ", "https://api.example.test/api/1/");
        assert_eq!(unchanged.generation, snapshot.generation);

        let default_endpoint = scope.set("usr_current", "");
        assert_eq!(default_endpoint.endpoint, "https://api.vrchat.cloud/api/1");
        assert!(scope.matches("usr_current", ""));

        let cleared = scope.set("", "");
        assert!(!cleared.active);
        assert!(!scope.matches("usr_current", "https://api.example.test/api/1"));
    }

    #[test]
    fn bumps_generation_when_switching_to_a_different_user() {
        let scope = RuntimeAuthScope::new();

        let first = scope.set("usr_a", "");
        let switched = scope.set("usr_b", "");

        assert_eq!(switched.current_user_id, "usr_b");
        assert!(switched.generation > first.generation);
    }

    #[test]
    fn bumps_generation_and_deactivates_when_cleared() {
        let scope = RuntimeAuthScope::new();

        let active = scope.set("usr_a", "");
        let cleared = scope.set("", "");

        assert!(active.active);
        assert!(!cleared.active);
        assert!(cleared.generation > active.generation);
    }
}
