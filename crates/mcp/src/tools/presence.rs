use std::collections::HashSet;

use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;
use rmcp::{schemars, tool, tool_router};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use vrcx_0_core::location::parse_location;
use vrcx_0_persistence::social_aggregates;

use crate::server::VrcxMcpServer;

use super::common::structured_result;

#[tool_router(router = presence_tool_router, vis = "pub(crate)")]
impl VrcxMcpServer {
    #[tool(
        description = "[L1·query] List friends online right now from live VRCX-0 session memory (state, location, world, instance access, status, platform). Realtime, not history. Use for \"who is online\" or \"who can I join now\". Private instances may be redacted by VRChat privacy rules."
    )]
    async fn get_online_friends(
        &self,
        Parameters(input): Parameters<OnlineFriendsParams>,
    ) -> Result<CallToolResult, String> {
        structured_result(self.get_online_friends_output(input))
    }
}

impl VrcxMcpServer {
    fn get_online_friends_output(&self, input: OnlineFriendsParams) -> OnlineFriendsOutput {
        let states = input
            .states
            .unwrap_or_else(|| vec!["online".to_string(), "active".to_string()]);
        let normalized_states = states
            .iter()
            .map(|value| value.trim().to_ascii_lowercase())
            .filter(|value| !value.is_empty())
            .collect::<HashSet<_>>();
        let include_location = input.include_location.unwrap_or(true);

        let mut rows = self
            .runtime
            .realtime_runtime
            .friend_snapshot()
            .into_iter()
            .flat_map(|snapshot| snapshot.friends_by_id.into_values())
            .filter(|friend| normalized_states.contains(&friend.state_bucket))
            .map(|friend| {
                let parsed = parse_location(&friend.location);
                let display_name = friend.display_name_or_id();
                let world_name = friend
                    .extra
                    .get("worldName")
                    .or_else(|| friend.extra.get("world_name"))
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                OnlineFriendRow {
                    user_id: friend.id,
                    display_name,
                    state: friend.state_bucket,
                    location: include_location.then_some(friend.location),
                    world_id: include_location.then_some(parsed.world_id),
                    world_name: include_location.then_some(world_name),
                    instance_access_type: include_location.then_some(
                        social_aggregates::normalize_access_bucket(&parsed.access_type),
                    ),
                    status: friend.status,
                    platform: if friend.platform.is_empty() {
                        friend.last_platform
                    } else {
                        friend.platform
                    },
                }
            })
            .collect::<Vec<_>>();
        rows.sort_by(|left, right| {
            left.display_name
                .cmp(&right.display_name)
                .then_with(|| left.user_id.cmp(&right.user_id))
        });

        let summary = online_friends_summary(&rows);
        OnlineFriendsOutput {
            rows,
            summary,
            caveats: vec![
                "Realtime friend presence is maintained from the active VRChat websocket session."
                    .into(),
                "Location visibility still follows VRChat privacy rules; private instances may be redacted."
                    .into(),
            ],
        }
    }
}
#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct OnlineFriendsParams {
    states: Option<Vec<String>>,
    include_location: Option<bool>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OnlineFriendsOutput {
    rows: Vec<OnlineFriendRow>,
    summary: String,
    caveats: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OnlineFriendRow {
    user_id: String,
    display_name: String,
    state: String,
    location: Option<String>,
    world_id: Option<String>,
    world_name: Option<String>,
    instance_access_type: Option<String>,
    status: String,
    platform: String,
}

fn online_friends_summary(rows: &[OnlineFriendRow]) -> String {
    if rows.is_empty() {
        return "No friends are online right now.".to_string();
    }
    let names = rows
        .iter()
        .map(|row| row.display_name.as_str())
        .collect::<Vec<_>>()
        .join(", ");
    format!("{} friends online now: {names}.", rows.len())
}
