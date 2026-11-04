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
            + Self::chatbox_tool_router()
            + Self::favorites_tool_router()
            + Self::feed_tool_router()
            + Self::friends_tool_router()
            + Self::graph_tool_router()
            + Self::invites_tool_router()
            + Self::presence_tool_router()
            + Self::screenshots_tool_router()
            + Self::worlds_tool_router()
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
                "find_user",
                "get_activity_streaks",
                "get_activity_timeline",
                "get_best_time_to_play",
                "get_chatbox",
                "get_companions_of",
                "get_copresence_summary",
                "get_fading_friends",
                "get_favorites",
                "get_friend_activity_pattern",
                "get_friend_changes",
                "get_friend_circles",
                "get_friend_log",
                "get_friend_note",
                "get_friend_profile",
                "get_invite_history",
                "get_my_activity",
                "get_online_friends",
                "get_social_graph",
                "get_visit_timeline",
                "get_world_profile",
                "recall_encounter",
                "refresh_mutual_graph",
                "search_friend_feed",
                "search_screenshots",
                "search_worlds_visited",
                "send_chatbox_message",
                "set_chatbox_afk",
                "set_friend_note",
                "summarize_screenshots",
                "summarize_social_period",
                "update_chatbox",
            ]
        );
    }

    #[test]
    fn hour_bucketing_tools_expose_top_level_utc_offset_minutes() {
        let router = VrcxMcpServer::tool_router();
        let tools = router.list_all();
        for name in [
            "get_copresence_summary",
            "get_friend_profile",
            "get_friend_activity_pattern",
            "get_best_time_to_play",
            "get_activity_timeline",
            "get_activity_streaks",
            "get_my_activity",
            "summarize_social_period",
        ] {
            let tool = tools
                .iter()
                .find(|tool| tool.name.as_ref() == name)
                .expect("tool should be registered");
            assert!(
                tool.input_schema
                    .get("properties")
                    .and_then(|properties| properties.get("utcOffsetMinutes"))
                    .is_some(),
                "{name} should expose top-level properties.utcOffsetMinutes"
            );
        }
    }

    #[test]
    fn get_favorites_exposes_an_optional_kind_enum() {
        let router = VrcxMcpServer::tool_router();
        let tool = router
            .list_all()
            .into_iter()
            .find(|tool| tool.name.as_ref() == "get_favorites")
            .expect("get_favorites should be registered");
        let schema = &tool.input_schema;

        assert!(!schema
            .get("required")
            .and_then(serde_json::Value::as_array)
            .is_some_and(|required| required.iter().any(|field| field == "kind")));
        assert_eq!(
            schema["$defs"]["FavoriteListKind"]["enum"],
            serde_json::json!(["all", "world", "friend", "avatar"])
        );
    }

    #[test]
    fn friend_feed_search_exposes_its_cost_and_paging_boundaries() {
        let router = VrcxMcpServer::tool_router();
        let tool = router
            .list_all()
            .into_iter()
            .find(|tool| tool.name.as_ref() == "search_friend_feed")
            .expect("search_friend_feed should be registered");

        for phrase in ["exact event evidence", "allHistory=true", "at most 50 rows"] {
            assert!(
                tool.description
                    .as_deref()
                    .is_some_and(|description| description.contains(phrase)),
                "missing phrase: {phrase}"
            );
        }
        for property in [
            "query",
            "target",
            "eventTypes",
            "timeWindow",
            "allHistory",
            "limit",
            "cursor",
        ] {
            assert!(
                tool.input_schema["properties"].get(property).is_some(),
                "missing property: {property}"
            );
        }

        let time_window_schema = tool.input_schema["properties"]["timeWindow"].to_string();
        assert!(time_window_schema.contains("\"oneOf\""));
        assert!(time_window_schema.contains("\"string\""));
        assert!(time_window_schema.contains("\"integer\""));
        assert!(time_window_schema.contains("\"object\""));
    }
}
