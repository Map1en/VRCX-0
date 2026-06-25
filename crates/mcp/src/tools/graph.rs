use std::collections::HashMap;

use chrono::{DateTime, Duration, Utc};
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;
use rmcp::{schemars, tool, tool_router};
use serde::{Deserialize, Serialize};
use vrcx_0_application::{MutualGraphFetchStartInput, MutualGraphFetchStatus};
use vrcx_0_persistence::{mutual_graph, social_aggregates};

use crate::server::VrcxMcpServer;

use super::common::{
    map_persistence_error, require_current_user_id, social_aggregates_result, structured_result,
    TimeWindowParams,
};

#[tool_router(router = graph_tool_router, vis = "pub(crate)")]
impl VrcxMcpServer {
    #[tool(description = "Refresh stale mutual-friend graph data with throttled VRChat API reads.")]
    async fn refresh_mutual_graph(
        &self,
        Parameters(input): Parameters<RefreshMutualGraphParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        structured_result(self.refresh_mutual_graph_output(owner_user_id, input)?)
    }

    #[tool(description = "Return mutual-friend graph edges and connection degrees.")]
    async fn get_social_graph(
        &self,
        Parameters(input): Parameters<SocialGraphParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        social_aggregates_result(social_aggregates::get_social_graph(
            self.runtime.db.as_ref(),
            social_aggregates::SocialGraphInput {
                owner_user_id,
                user_id: input.user_id,
                depth: input.depth.unwrap_or(1),
            },
        ))
    }

    #[tool(description = "Infer visible companions of a friend from feed_gps overlap.")]
    async fn get_companions_of(
        &self,
        Parameters(input): Parameters<CompanionsOfParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        social_aggregates_result(social_aggregates::get_companions_of(
            self.runtime.db.as_ref(),
            social_aggregates::CompanionsOfInput {
                owner_user_id,
                user_id: input.user_id,
                time_window: input.time_window.into(),
                limit: input.limit,
            },
        ))
    }
}

impl VrcxMcpServer {
    fn refresh_mutual_graph_output(
        &self,
        owner_user_id: String,
        input: RefreshMutualGraphParams,
    ) -> Result<RefreshMutualGraphOutput, String> {
        let status = self.runtime.mutual_graph_fetch.status();
        if is_active_fetch_status(&status.status) {
            return Ok(RefreshMutualGraphOutput::from_status(
                false,
                "already running",
                0,
                status,
            ));
        }
        let snapshot = self
            .runtime
            .realtime_runtime
            .friend_snapshot()
            .ok_or_else(|| {
                "refresh_mutual_graph requires a loaded realtime friend snapshot".to_string()
            })?;
        let graph = mutual_graph::mutual_graph_snapshot_get(
            self.runtime.db.as_ref(),
            owner_user_id.clone(),
        )
        .map_err(map_persistence_error)?;
        let freshness = mutual_graph_freshness(&graph.meta);
        let meta_by_friend_id = graph
            .meta
            .into_iter()
            .map(|meta| (meta.friend_id.clone(), meta))
            .collect::<HashMap<_, _>>();
        let force = input.force.unwrap_or(false);
        let max_age_hours = input.max_age_hours.unwrap_or(24).max(1) as i64;
        let stale_after = Utc::now() - Duration::hours(max_age_hours);
        let friend_ids = snapshot
            .friends_by_id
            .keys()
            .filter(|friend_id| {
                let meta = meta_by_friend_id.get(*friend_id);
                if meta.is_some_and(|meta| meta.opted_out) {
                    return false;
                }
                force || meta.is_none_or(|meta| is_stale_mutual_meta(meta, stale_after))
            })
            .cloned()
            .collect::<Vec<_>>();
        if friend_ids.is_empty() {
            return Ok(RefreshMutualGraphOutput {
                refreshed: false,
                reason: if force {
                    "no eligible friends"
                } else {
                    "already fresh"
                }
                .into(),
                selected_friend_count: 0,
                status: self.runtime.mutual_graph_fetch.status(),
                fetched_friends: freshness.fetched_friends,
                opted_out_friends: freshness.opted_out_friends,
                newest_fetched_at: freshness.newest_fetched_at,
                oldest_fetched_at: freshness.oldest_fetched_at,
                caveats: mutual_graph_refresh_caveats(),
            });
        }
        let status = self
            .runtime
            .mutual_graph_fetch
            .start(
                MutualGraphFetchStartInput {
                    owner_user_id,
                    endpoint: self.runtime.current_endpoint(),
                    friend_ids: friend_ids.clone(),
                },
                self.runtime.db.clone(),
                self.runtime.web.clone(),
                self.runtime.tasks.clone(),
            )
            .map_err(|error| error.to_string())?;
        Ok(RefreshMutualGraphOutput {
            refreshed: true,
            reason: "started".into(),
            selected_friend_count: friend_ids.len(),
            status,
            fetched_friends: freshness.fetched_friends,
            opted_out_friends: freshness.opted_out_friends,
            newest_fetched_at: freshness.newest_fetched_at,
            oldest_fetched_at: freshness.oldest_fetched_at,
            caveats: mutual_graph_refresh_caveats(),
        })
    }
}
#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct RefreshMutualGraphParams {
    force: Option<bool>,
    max_age_hours: Option<u32>,
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct SocialGraphParams {
    user_id: Option<String>,
    depth: Option<u8>,
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct CompanionsOfParams {
    user_id: String,
    #[serde(default)]
    time_window: TimeWindowParams,
    limit: Option<i64>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RefreshMutualGraphOutput {
    refreshed: bool,
    reason: String,
    selected_friend_count: usize,
    status: MutualGraphFetchStatus,
    fetched_friends: usize,
    opted_out_friends: usize,
    newest_fetched_at: Option<String>,
    oldest_fetched_at: Option<String>,
    caveats: Vec<String>,
}

impl RefreshMutualGraphOutput {
    fn from_status(
        refreshed: bool,
        reason: impl Into<String>,
        selected_friend_count: usize,
        status: MutualGraphFetchStatus,
    ) -> Self {
        Self {
            refreshed,
            reason: reason.into(),
            selected_friend_count,
            status,
            fetched_friends: 0,
            opted_out_friends: 0,
            newest_fetched_at: None,
            oldest_fetched_at: None,
            caveats: mutual_graph_refresh_caveats(),
        }
    }
}

struct MutualGraphFreshness {
    fetched_friends: usize,
    opted_out_friends: usize,
    newest_fetched_at: Option<String>,
    oldest_fetched_at: Option<String>,
}
fn mutual_graph_freshness(meta: &[mutual_graph::MutualGraphMetaOutput]) -> MutualGraphFreshness {
    let mut freshness = MutualGraphFreshness {
        fetched_friends: 0,
        opted_out_friends: 0,
        newest_fetched_at: None,
        oldest_fetched_at: None,
    };
    for row in meta {
        if row.opted_out {
            freshness.opted_out_friends += 1;
            continue;
        }
        if row.last_fetched_at.trim().is_empty() {
            continue;
        }
        freshness.fetched_friends += 1;
        freshness.newest_fetched_at = Some(match freshness.newest_fetched_at {
            Some(current) => current.max(row.last_fetched_at.clone()),
            None => row.last_fetched_at.clone(),
        });
        freshness.oldest_fetched_at = Some(match freshness.oldest_fetched_at {
            Some(current) => current.min(row.last_fetched_at.clone()),
            None => row.last_fetched_at.clone(),
        });
    }
    freshness
}

fn is_stale_mutual_meta(
    meta: &mutual_graph::MutualGraphMetaOutput,
    stale_after: DateTime<Utc>,
) -> bool {
    DateTime::parse_from_rfc3339(&meta.last_fetched_at)
        .map(|value| value.with_timezone(&Utc) < stale_after)
        .unwrap_or(true)
}

fn is_active_fetch_status(status: &str) -> bool {
    matches!(status, "running" | "cancelling")
}

fn mutual_graph_refresh_caveats() -> Vec<String> {
    vec![
        "This triggers throttled VRChat API reads and updates only local mutual graph snapshots.".into(),
        "Large friend lists can take a long time; friends who opt out of Shared Connections are skipped.".into(),
    ]
}
