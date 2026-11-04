use std::sync::Arc;

use vrcx_0_application::favorites::FavoriteMutationCoordinator;
use vrcx_0_application_core::{ConfigStore, RuntimeAuthScope, TaskSupervisor};
use vrcx_0_application_realtime::RealtimeHostRuntime;

use crate::ports::{
    McpActivityQueries, McpChatbox, McpFavoritesQueries, McpFeedQueries, McpFriendLocalData,
    McpMutualGraph, McpScreenshotQueries, McpSocialHistoryQueries, McpWorldLookup,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum McpCaller {
    Assistant,
    ExternalServer,
}

#[derive(Clone)]
pub struct McpRuntime {
    pub(crate) realtime_runtime: Arc<RealtimeHostRuntime>,
    pub(crate) auth_scope: RuntimeAuthScope,
    pub(crate) config: Arc<dyn ConfigStore>,
    pub(crate) activity_queries: McpActivityQueries,
    pub(crate) social_history_queries: McpSocialHistoryQueries,
    pub(crate) friend_local_data: McpFriendLocalData,
    pub(crate) favorites_queries: McpFavoritesQueries,
    pub(crate) feed_queries: McpFeedQueries,
    pub(crate) mutual_graph: McpMutualGraph,
    pub(crate) world_lookup: McpWorldLookup,
    pub(crate) screenshots: McpScreenshotQueries,
    pub(crate) chatbox: McpChatbox,
    pub(crate) favorite_mutations: FavoriteMutationCoordinator,
    pub(crate) tasks: TaskSupervisor,
    pub(crate) caller: McpCaller,
}

pub struct McpRuntimeDeps {
    pub realtime_runtime: Arc<RealtimeHostRuntime>,
    pub auth_scope: RuntimeAuthScope,
    pub config: Arc<dyn ConfigStore>,
    pub activity_queries: McpActivityQueries,
    pub social_history_queries: McpSocialHistoryQueries,
    pub friend_local_data: McpFriendLocalData,
    pub favorites_queries: McpFavoritesQueries,
    pub feed_queries: McpFeedQueries,
    pub mutual_graph: McpMutualGraph,
    pub world_lookup: McpWorldLookup,
    pub screenshots: McpScreenshotQueries,
    pub chatbox: McpChatbox,
    pub favorite_mutations: FavoriteMutationCoordinator,
    pub tasks: TaskSupervisor,
}

impl McpRuntime {
    pub fn new(deps: McpRuntimeDeps, caller: McpCaller) -> Self {
        Self {
            realtime_runtime: deps.realtime_runtime,
            auth_scope: deps.auth_scope,
            config: deps.config,
            activity_queries: deps.activity_queries,
            social_history_queries: deps.social_history_queries,
            friend_local_data: deps.friend_local_data,
            favorites_queries: deps.favorites_queries,
            feed_queries: deps.feed_queries,
            mutual_graph: deps.mutual_graph,
            world_lookup: deps.world_lookup,
            screenshots: deps.screenshots,
            chatbox: deps.chatbox,
            favorite_mutations: deps.favorite_mutations,
            tasks: deps.tasks,
            caller,
        }
    }

    pub(crate) fn vrchat_writes_allowed(&self) -> bool {
        match self.caller {
            McpCaller::Assistant => true,
            McpCaller::ExternalServer => self
                .config
                .get_bool(crate::config::MCP_ALLOW_VRCHAT_WRITES_CONFIG_KEY, false)
                .unwrap_or(false),
        }
    }

    pub(crate) fn current_user_id(&self) -> Option<String> {
        let from_auth = self.auth_scope.snapshot().current_user_id;
        current_user_id_from_sources(&from_auth)
    }

    pub(crate) fn current_endpoint(&self) -> String {
        self.realtime_runtime
            .friend_snapshot()
            .map(|snapshot| snapshot.endpoint)
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_default()
    }
}

fn current_user_id_from_sources(auth_scope_user_id: &str) -> Option<String> {
    let auth_scope_user_id = auth_scope_user_id.trim();
    if !auth_scope_user_id.is_empty() {
        return Some(auth_scope_user_id.to_string());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{current_user_id_from_sources, McpCaller};

    #[test]
    fn current_user_owner_is_the_trimmed_auth_scope_user_or_none_when_blank() {
        assert_eq!(
            current_user_id_from_sources(" usr_auth ").as_deref(),
            Some("usr_auth")
        );
        assert_eq!(current_user_id_from_sources(""), None);
        assert_eq!(current_user_id_from_sources(" "), None);
    }

    #[test]
    fn caller_policy_keeps_external_and_assistant_write_authority_separate() {
        let (_dir, mut runtime) =
            crate::test_support::test_runtime("mcp-caller", "usr_test").expect("test runtime");

        assert!(!runtime.vrchat_writes_allowed());
        runtime
            .config
            .set_bool(crate::config::MCP_ALLOW_VRCHAT_WRITES_CONFIG_KEY, true)
            .unwrap();
        assert!(runtime.vrchat_writes_allowed());

        runtime.caller = McpCaller::Assistant;
        runtime
            .config
            .set_bool(crate::config::MCP_ALLOW_VRCHAT_WRITES_CONFIG_KEY, false)
            .unwrap();
        assert!(runtime.vrchat_writes_allowed());
    }
}
