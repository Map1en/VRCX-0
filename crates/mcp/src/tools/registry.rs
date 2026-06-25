use rmcp::handler::server::router::tool::ToolRouter;

use crate::runtime::McpRuntime;
use crate::server::VrcxMcpServer;

impl VrcxMcpServer {
    pub(crate) fn new(runtime: McpRuntime) -> Self {
        Self {
            runtime,
            tool_router: Self::tool_router(),
        }
    }

    fn tool_router() -> ToolRouter<Self> {
        Self::activity_tool_router()
            + Self::favorites_tool_router()
            + Self::friends_tool_router()
            + Self::graph_tool_router()
            + Self::invites_tool_router()
            + Self::presence_tool_router()
    }
}

#[cfg(test)]
mod router_tests {
    use super::*;

    #[test]
    fn merged_router_exposes_existing_tool_names() {
        let router = VrcxMcpServer::tool_router();
        let names = router
            .list_all()
            .iter()
            .map(|tool| tool.name.as_ref().to_string())
            .collect::<Vec<_>>();

        assert_eq!(
            names,
            vec![
                "favorite_local",
                "favorite_vrchat",
                "get_best_time_to_play",
                "get_companions_of",
                "get_copresence_summary",
                "get_fading_friends",
                "get_favorites",
                "get_friend_activity_pattern",
                "get_friend_changes",
                "get_friend_log",
                "get_friend_note",
                "get_friend_profile",
                "get_invite_history",
                "get_my_activity",
                "get_online_friends",
                "get_social_graph",
                "recall_encounter",
                "refresh_mutual_graph",
                "search_worlds_visited",
                "set_friend_note",
                "summarize_social_period",
            ]
        );
    }
}
