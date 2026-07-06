use std::sync::Arc;

use vrcx_0_application::{
    MutualGraphFetchRuntime, RealtimeHostRuntime, RuntimeAuthScope, RuntimeDiagnostics,
    RuntimeSyncEngine, TaskSupervisor, WebClient,
};
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::DatabaseService;
use vrcx_0_runtime_host::RuntimeHostState;

#[derive(Clone)]
pub struct McpRuntime {
    pub(crate) db: Arc<DatabaseService>,
    pub(crate) web: Arc<WebClient>,
    pub(crate) diagnostics: RuntimeDiagnostics,
    pub(crate) sync: RuntimeSyncEngine,
    pub(crate) realtime_runtime: Arc<RealtimeHostRuntime>,
    pub(crate) auth_scope: RuntimeAuthScope,
    pub(crate) config: ConfigRepository,
    pub(crate) mutual_graph_fetch: MutualGraphFetchRuntime,
    pub(crate) tasks: TaskSupervisor,
}

impl McpRuntime {
    pub fn from_host(state: &RuntimeHostState) -> Self {
        Self {
            db: Arc::clone(&state.db),
            web: Arc::clone(&state.web),
            diagnostics: state.runtime_context.diagnostics.clone(),
            sync: state.runtime_context.sync.clone(),
            realtime_runtime: Arc::clone(&state.realtime_runtime),
            auth_scope: state.runtime_context.auth_scope.clone(),
            config: state.runtime_context.config.clone(),
            mutual_graph_fetch: state.runtime_context.mutual_graph_fetch.clone(),
            tasks: state.runtime_context.tasks.clone(),
        }
    }

    pub(crate) fn current_user_id(&self) -> Option<String> {
        let from_auth = self.auth_scope.snapshot().current_user_id;
        current_user_id_from_sources(&from_auth, None)
    }

    pub(crate) fn current_endpoint(&self) -> String {
        self.realtime_runtime
            .friend_snapshot()
            .map(|snapshot| snapshot.endpoint)
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_default()
    }
}

fn current_user_id_from_sources(
    auth_scope_user_id: &str,
    _realtime_user_id: Option<&str>,
) -> Option<String> {
    let auth_scope_user_id = auth_scope_user_id.trim();
    if !auth_scope_user_id.is_empty() {
        return Some(auth_scope_user_id.to_string());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::current_user_id_from_sources;

    #[test]
    fn current_user_owner_prefers_auth_scope_over_realtime_snapshot() {
        let owner = current_user_id_from_sources(" usr_auth ", Some("usr_ws"));

        assert_eq!(owner.as_deref(), Some("usr_auth"));
    }

    #[test]
    fn current_user_owner_does_not_fall_back_to_realtime_when_auth_scope_is_empty() {
        let owner = current_user_id_from_sources(" ", Some(" usr_ws "));

        assert_eq!(owner, None);
    }

    #[test]
    fn current_user_owner_stays_empty_when_all_sources_are_empty() {
        assert_eq!(current_user_id_from_sources("", None), None);
        assert_eq!(current_user_id_from_sources(" ", Some(" ")), None);
    }
}
