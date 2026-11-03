use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;
use rmcp::{schemars, tool, tool_router};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use vrcx_0_contracts::social_aggregates;
use vrcx_0_core::OwnerId;

use crate::server::VrcxMcpServer;

use super::common::{map_application_query_error, require_current_user_id, structured_result};

const RECENT_VISIT_LIMIT: i64 = 5;
const PEOPLE_LIMIT: i64 = 5;
const NAME_MATCH_LIMIT: i64 = 5;
const TAG_LIMIT: usize = 10;

#[tool_router(router = worlds_tool_router, vis = "pub(crate)")]
impl VrcxMcpServer {
    #[tool(
        description = "[L2·analyze] One world's overview: your own visits there (count, total minutes, first/last visit, latest visits), the people you spent the most time with there, and its live VRChat stats (favorites, total visits, popularity, heat, players now, capacity, publication dates). Accepts a wrld_ id or the name of a world you visited. Each recentVisits row already lists the people seen during that visit (an empty people list means nobody else was observed), so answer \"when did I go and who was there\" from it; call get_visit_timeline only for exact join/leave times of one visit, never once per visit."
    )]
    async fn get_world_profile(
        &self,
        Parameters(input): Parameters<WorldProfileParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        let query = input.world.trim();
        if query.is_empty() {
            return Err("get_world_profile requires world".into());
        }
        let world_id = if query.starts_with("wrld_") {
            query.to_string()
        } else {
            let matches = self
                .runtime
                .activity_queries
                .find_visited_worlds(&owner_user_id, query, NAME_MATCH_LIMIT)
                .map_err(map_application_query_error)?;
            let exact = matches
                .iter()
                .filter(|row| row.world_name.eq_ignore_ascii_case(query))
                .count();
            match matches.first() {
                None => {
                    return structured_result(WorldCandidates {
                        candidates: Vec::new(),
                        summary: format!(
                            "No visited world matches \"{query}\". Ask for the world link or id."
                        ),
                    })
                }
                Some(first) if matches.len() == 1 || exact == 1 => first.world_id.clone(),
                Some(_) => {
                    return structured_result(WorldCandidates {
                        summary: format!(
                            "Several visited worlds match \"{query}\"; ask the user which one."
                        ),
                        candidates: matches,
                    })
                }
            }
        };
        structured_result(
            self.get_world_profile_output(owner_user_id, world_id)
                .await?,
        )
    }
}

impl VrcxMcpServer {
    async fn get_world_profile_output(
        &self,
        owner_user_id: OwnerId,
        world_id: String,
    ) -> Result<WorldProfileOutput, String> {
        let my_visits = self
            .runtime
            .activity_queries
            .world_visit_history(&owner_user_id, &world_id, RECENT_VISIT_LIMIT)
            .map_err(map_application_query_error)?;
        let people_met_here = self
            .runtime
            .activity_queries
            .copresence_summary(social_aggregates::CopresenceSummaryInput {
                time_window: social_aggregates::TimeWindow::all(),
                group_by: social_aggregates::CopresenceGroupBy::Friend,
                min_minutes: None,
                limit: Some(PEOPLE_LIMIT),
                owner_user_id: Some(owner_user_id.clone()),
                audience: social_aggregates::CopresenceAudience::Everyone,
                order_by: social_aggregates::CopresenceOrderBy::default(),
                utc_offset_minutes: None,
                world_id: Some(world_id.clone()),
                target_user_id: None,
            })
            .map_err(map_application_query_error)?
            .rows
            .into_iter()
            .map(WorldProfilePerson::from)
            .collect();
        let mut caveats = vec![
            "myVisits and peopleMetHere come from your local game log over all history.".into(),
            "world stats are VRChat-wide: favorites and visits count every player; heat reflects activity right now and popularity the longer-term trend, both on VRChat's own relative scale.".into(),
        ];
        let world = match self.runtime.world_lookup.world(world_id.clone()).await {
            Ok(Some(world)) => Some(WorldFacts::from_json(&world)),
            Ok(None) => {
                caveats.push("Live VRChat stats for this world were not available.".into());
                None
            }
            Err(error) => {
                caveats.push(format!("Live VRChat stats could not be fetched: {error}"));
                None
            }
        };
        let world_name = world
            .as_ref()
            .map(|facts| facts.name.clone())
            .filter(|name| !name.is_empty())
            .or_else(|| {
                my_visits
                    .recent_visits
                    .first()
                    .map(|row| row.world_name.clone())
            })
            .unwrap_or_default();
        Ok(WorldProfileOutput {
            world_id,
            world_name,
            world,
            my_visits,
            people_met_here,
            caveats,
        })
    }
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct WorldProfileParams {
    /// A wrld_ id, or the name of a world you visited.
    world: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorldCandidates {
    candidates: Vec<social_aggregates::VisitedWorldMatch>,
    summary: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorldProfileOutput {
    world_id: String,
    world_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    world: Option<WorldFacts>,
    my_visits: social_aggregates::WorldVisitHistory,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    people_met_here: Vec<WorldProfilePerson>,
    caveats: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorldProfilePerson {
    user_id: String,
    display_name: String,
    is_friend: bool,
    total_minutes: i64,
    co_days: usize,
    last_seen_together: String,
}

impl From<social_aggregates::CopresenceSummaryRow> for WorldProfilePerson {
    fn from(row: social_aggregates::CopresenceSummaryRow) -> Self {
        Self {
            user_id: row.user_id,
            display_name: row.display_name,
            is_friend: row.is_friend,
            total_minutes: row.total_minutes,
            co_days: row.co_days,
            last_seen_together: row.last_seen_together,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorldFacts {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    author_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    release_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    favorites: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    visits: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    favorite_rate_percent: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    popularity: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    heat: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    players_now: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    capacity: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    recommended_capacity: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    publication_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    labs_publication_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    updated_at: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tags: Vec<String>,
}

impl WorldFacts {
    fn from_json(world: &Value) -> Self {
        let text = |key: &str| {
            world
                .get(key)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty() && *value != "none")
                .map(str::to_string)
        };
        let number = |key: &str| world.get(key).and_then(Value::as_i64);
        let favorites = number("favorites");
        let visits = number("visits");
        Self {
            name: text("name").unwrap_or_default(),
            author_name: text("authorName"),
            release_status: text("releaseStatus"),
            favorites,
            visits,
            favorite_rate_percent: favorites.zip(visits).filter(|(_, visits)| *visits > 0).map(
                |(favorites, visits)| (favorites as f64 / visits as f64 * 1000.0).round() / 10.0,
            ),
            popularity: number("popularity"),
            heat: number("heat"),
            players_now: number("occupants"),
            capacity: number("capacity"),
            recommended_capacity: number("recommendedCapacity"),
            publication_date: text("publicationDate"),
            labs_publication_date: text("labsPublicationDate"),
            updated_at: text("updated_at"),
            tags: world
                .get("tags")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .filter_map(|tag| tag.strip_prefix("author_tag_"))
                .take(TAG_LIMIT)
                .map(str::to_string)
                .collect(),
        }
    }
}
