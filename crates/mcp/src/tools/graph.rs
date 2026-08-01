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
    map_persistence_error, require_current_user_id, resolve_optional_target_or_result,
    resolve_target_or_result, social_aggregates_result, structured_result, TargetResolutionOutcome,
    TimeWindowParams, WithResolution,
};

#[tool_router(router = graph_tool_router, vis = "pub(crate)")]
impl VrcxMcpServer {
    #[tool(
        description = "[action] Trigger throttled VRChat reads to refresh stale mutual-friend graph snapshots (feeds get_social_graph and get_friend_circles). Returns immediately with status; large friend lists take time; friends who opt out of Shared Connections are skipped. Use only when graph data is stale or empty."
    )]
    async fn refresh_mutual_graph(
        &self,
        Parameters(input): Parameters<RefreshMutualGraphParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        structured_result(self.refresh_mutual_graph_output(owner_user_id, input)?)
    }

    #[tool(
        description = "[L2·advanced] Raw mutual-friend graph: nodes and edges with connection degree. Nodes include friends-of-friends (second-degree mutuals), not only your own friends — use each node's isFriend flag to tell them apart; never call a node a friend unless isFriend is true. Large output for custom graph analysis. For the common \"which of my friends know each other\" prefer get_friend_circles. Pair with refresh_mutual_graph if the graph is stale or empty."
    )]
    async fn get_social_graph(
        &self,
        Parameters(input): Parameters<SocialGraphParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        let (user_id, resolved_user) =
            match resolve_optional_target_or_result(&self.runtime, input.user.as_deref())? {
                Some(TargetResolutionOutcome::Resolved(target)) => {
                    (Some(target.user_id), target.echo)
                }
                Some(TargetResolutionOutcome::ToolResult(result)) => return Ok(result),
                None => (None, None),
            };
        let output = social_aggregates::get_social_graph(
            self.runtime.db.as_ref(),
            social_aggregates::SocialGraphInput {
                owner_user_id,
                user_id,
                depth: input.depth.unwrap_or(1),
                max_nodes: input.max_nodes,
                max_edges: input.max_edges,
            },
        )
        .map_err(map_persistence_error)?;
        structured_result(WithResolution {
            inner: output,
            resolved_user,
        })
    }

    #[tool(
        description = "[L2·analyze] The signed-in user's friends grouped into mutual-friendship circles (pre-computed clusters of friends who know each other) for \"which of my friends know each other\" or \"my friend groups\". Returns ready-to-read circles plus a summary. Supersedes get_social_graph for this — circles already did the clustering; do NOT use the raw graph here."
    )]
    async fn get_friend_circles(
        &self,
        Parameters(input): Parameters<FriendCirclesParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        social_aggregates_result(social_aggregates::get_friend_circles(
            self.runtime.db.as_ref(),
            social_aggregates::FriendCirclesInput {
                owner_user_id,
                max_circles: input.max_circles,
                max_members_per_circle: input.max_members,
            },
        ))
    }

    #[tool(
        description = "[L2·analyze] Infer who a given user is most often co-present with, from the local game log (instances the signed-in user attended). Ranked by shared instances. For \"who does X usually/often play with\" OMIT timeWindow so it covers all history — a narrow window will miss their regular companions. THIRD-PARTY blind spot: instances you were not in (especially private) are invisible — say the picture is partial; never conclude who they are \"closest\" to."
    )]
    async fn get_companions_of(
        &self,
        Parameters(input): Parameters<CompanionsOfParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        let target = match resolve_target_or_result(&self.runtime, &input.user)? {
            TargetResolutionOutcome::Resolved(target) => target,
            TargetResolutionOutcome::ToolResult(result) => return Ok(result),
        };
        let output = social_aggregates::get_companions_of(
            self.runtime.db.as_ref(),
            social_aggregates::CompanionsOfInput {
                owner_user_id,
                user_id: target.user_id,
                time_window: input.time_window.into(),
                limit: input.limit,
            },
        )
        .map_err(map_persistence_error)?;
        structured_result(WithResolution {
            inner: output,
            resolved_user: target.echo,
        })
    }
}

impl VrcxMcpServer {
    fn refresh_mutual_graph_output(
        &self,
        owner_user_id: String,
        input: RefreshMutualGraphParams,
    ) -> Result<RefreshMutualGraphOutput, String> {
        let status = self.runtime.mutual_graph_fetch.status();
        if status.status.is_active() {
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
                self.runtime.auth_scope.clone(),
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
    #[serde(alias = "userId", alias = "user_id", alias = "focus")]
    user: Option<String>,
    depth: Option<u8>,
    max_nodes: Option<i64>,
    max_edges: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct FriendCirclesParams {
    max_circles: Option<i64>,
    max_members: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct CompanionsOfParams {
    #[serde(alias = "userId", alias = "user_id")]
    user: String,
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

fn mutual_graph_refresh_caveats() -> Vec<String> {
    vec![
        "This triggers throttled VRChat API reads and updates only local mutual graph snapshots.".into(),
        "Large friend lists can take a long time; friends who opt out of Shared Connections are skipped.".into(),
    ]
}
