use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;
use rmcp::{schemars, tool, tool_router};
use serde::{Deserialize, Serialize};
use vrcx_0_contracts::social_aggregates;
use vrcx_0_core::screenshots::{ScreenshotFacet, ScreenshotFilter, ScreenshotPeopleMatch};

use crate::server::VrcxMcpServer;

use super::common::{
    map_application_query_error, require_current_user_id, resolve_target_or_result,
    structured_result, ResolvedUserEcho, TargetResolutionOutcome, TimeWindowParams,
};

const DEFAULT_SEARCH_LIMIT: i64 = 8;
const MAX_SEARCH_LIMIT: i64 = 20;
const DEFAULT_SUMMARY_LIMIT: i64 = 10;
const WORLD_MATCH_LIMIT: i64 = 500;

#[tool_router(router = screenshots_tool_router, vis = "pub(crate)")]
impl VrcxMcpServer {
    #[tool(
        description = "[L1·query] Find the signed-in user's VRChat screenshots in the local library by who was in them (people: usr_ ids or names; together=true means all of them in the same shot, false means any), the world (wrld_ id or name) and a time window. Returns the total and the newest screenshots with screenshotId, capturedAt, worldName and the people in each. The app shows the matching screenshots under your answer, so describe them instead of listing ids. Only screenshots taken while VRCX-0 was running record who was there; withoutPeople counts the rest. For rankings (who appears most, which worlds, which months) use summarize_screenshots."
    )]
    async fn search_screenshots(
        &self,
        Parameters(input): Parameters<SearchScreenshotsParams>,
    ) -> Result<CallToolResult, String> {
        require_current_user_id(&self.runtime)?;
        let (filter, resolved_users) = match self.screenshot_filter(&input.scope)? {
            ScopeOutcome::Filter(filter, resolved) => (filter, resolved),
            ScopeOutcome::ToolResult(result) => return Ok(result),
        };
        let limit = input
            .limit
            .unwrap_or(DEFAULT_SEARCH_LIMIT)
            .clamp(1, MAX_SEARCH_LIMIT);
        let result = self
            .runtime
            .screenshots
            .query(&filter, limit)
            .map_err(map_application_query_error)?;
        let screenshots = result
            .images
            .into_iter()
            .map(|image| {
                let author = image
                    .metadata
                    .as_ref()
                    .map(|metadata| metadata.author.id.clone())
                    .unwrap_or_default();
                ScreenshotRow {
                    screenshot_id: image.file_name,
                    captured_at: millis_to_rfc3339(image.captured_at_ms),
                    world_id: image.world_id.unwrap_or_default(),
                    world_name: image.world_name.unwrap_or_default(),
                    people: image
                        .metadata
                        .map(|metadata| {
                            metadata
                                .players
                                .into_iter()
                                .filter(|player| player.id != author)
                                .map(|player| player.display_name)
                                .collect()
                        })
                        .unwrap_or_default(),
                }
            })
            .collect();
        structured_result(SearchScreenshotsOutput {
            total: result.total,
            without_people: result.without_people,
            screenshots,
            filter,
            resolved_users,
            caveats: vec![
                "Screenshots are read from the local screenshot library index; files outside the VRChat photos folder are not included.".into(),
            ],
        })
    }

    #[tool(
        description = "[L2·analyze] Rank the signed-in user's screenshots: groupBy person (who appears in the most screenshots with you, excluding yourself), world (where you took the most), or month. Accepts the same people/together/world/timeWindow filters as search_screenshots. Use for \"who do I take the most photos with\", \"which worlds did I photograph most this year\", or \"how many screenshots per month\"."
    )]
    async fn summarize_screenshots(
        &self,
        Parameters(input): Parameters<SummarizeScreenshotsParams>,
    ) -> Result<CallToolResult, String> {
        require_current_user_id(&self.runtime)?;
        let (filter, resolved_users) = match self.screenshot_filter(&input.scope)? {
            ScopeOutcome::Filter(filter, resolved) => (filter, resolved),
            ScopeOutcome::ToolResult(result) => return Ok(result),
        };
        let limit = input.limit.unwrap_or(DEFAULT_SUMMARY_LIMIT).clamp(1, 50);
        let screenshots = &self.runtime.screenshots;
        let rows = match input.group_by {
            ScreenshotGroupBy::Person => screenshots.people(&filter, limit),
            ScreenshotGroupBy::World => screenshots.worlds(&filter, limit),
            ScreenshotGroupBy::Month => {
                screenshots.months(&filter, input.scope.utc_offset_minutes.unwrap_or(0), limit)
            }
        }
        .map_err(map_application_query_error)?;
        let total = screenshots
            .query(&filter, 1)
            .map_err(map_application_query_error)?
            .total;
        structured_result(SummarizeScreenshotsOutput {
            group_by: input.group_by,
            total,
            rows: rows
                .into_iter()
                .map(|row| SummaryRow::new(input.group_by, row))
                .collect(),
            resolved_users,
        })
    }
}

enum ScopeOutcome {
    Filter(ScreenshotFilter, Vec<ResolvedUserEcho>),
    ToolResult(CallToolResult),
}

impl VrcxMcpServer {
    fn screenshot_filter(&self, scope: &ScreenshotScopeParams) -> Result<ScopeOutcome, String> {
        let mut people = Vec::new();
        let mut resolved_users = Vec::new();
        for person in scope.people.iter().map(|value| value.trim()) {
            if person.is_empty() {
                continue;
            }
            match resolve_target_or_result(&self.runtime, person)? {
                TargetResolutionOutcome::Resolved(target) => {
                    people.push(target.user_id);
                    resolved_users.extend(target.echo);
                }
                TargetResolutionOutcome::ToolResult(result) => {
                    return Ok(ScopeOutcome::ToolResult(result))
                }
            }
        }
        let window: social_aggregates::TimeWindow = scope
            .time_window
            .clone()
            .unwrap_or_default()
            .in_utc_offset(scope.utc_offset_minutes)?
            .into();
        let mut filter = ScreenshotFilter {
            people,
            people_match: if scope.together.unwrap_or(true) {
                ScreenshotPeopleMatch::All
            } else {
                ScreenshotPeopleMatch::Any
            },
            from_ms: window.from.as_deref().and_then(rfc3339_to_millis),
            to_ms: window.to.as_deref().and_then(rfc3339_to_millis),
            ..ScreenshotFilter::default()
        };
        if let Some(world) = scope
            .world
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            filter.world_ids = if world.starts_with("wrld_") {
                vec![world.to_string()]
            } else {
                self.screenshot_worlds_named(world, &filter)?
            };
            if filter.world_ids.is_empty() {
                return structured_result(serde_json::json!({
                    "total": 0,
                    "summary": format!("No screenshots were taken in a world named \"{world}\"."),
                }))
                .map(ScopeOutcome::ToolResult);
            }
        }
        Ok(ScopeOutcome::Filter(filter, resolved_users))
    }

    fn screenshot_worlds_named(
        &self,
        name: &str,
        filter: &ScreenshotFilter,
    ) -> Result<Vec<String>, String> {
        let needle = name.to_lowercase();
        let worlds = self
            .runtime
            .screenshots
            .worlds(filter, WORLD_MATCH_LIMIT)
            .map_err(map_application_query_error)?;
        let exact: Vec<String> = worlds
            .iter()
            .filter(|world| world.name.to_lowercase() == needle)
            .map(|world| world.id.clone())
            .collect();
        if !exact.is_empty() {
            return Ok(exact);
        }
        Ok(worlds
            .into_iter()
            .filter(|world| world.name.to_lowercase().contains(&needle))
            .map(|world| world.id)
            .collect())
    }
}

fn rfc3339_to_millis(value: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|time| time.timestamp_millis())
}

fn millis_to_rfc3339(value: i64) -> String {
    chrono::DateTime::from_timestamp_millis(value)
        .filter(|_| value > 0)
        .map(|time| time.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
        .unwrap_or_default()
}

#[derive(Clone, Debug, Default, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct ScreenshotScopeParams {
    /// People who must be in the screenshot: usr_ ids or display names.
    #[serde(default)]
    people: Vec<String>,
    /// true (default): all listed people in the same screenshot; false: any of them.
    together: Option<bool>,
    /// A wrld_ id or a world name.
    world: Option<String>,
    /// Omit for all history.
    time_window: Option<TimeWindowParams>,
    /// The user's UTC offset in minutes (e.g. 540 for UTC+9).
    utc_offset_minutes: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct SearchScreenshotsParams {
    #[serde(flatten)]
    scope: ScreenshotScopeParams,
    /// Newest screenshots to return (default 8, max 20).
    limit: Option<i64>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
enum ScreenshotGroupBy {
    #[default]
    Person,
    World,
    Month,
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct SummarizeScreenshotsParams {
    #[serde(default)]
    group_by: ScreenshotGroupBy,
    #[serde(flatten)]
    scope: ScreenshotScopeParams,
    /// Rows to return (default 10, max 50).
    limit: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScreenshotRow {
    screenshot_id: String,
    captured_at: String,
    world_id: String,
    world_name: String,
    people: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchScreenshotsOutput {
    total: i64,
    #[serde(skip_serializing_if = "is_zero")]
    without_people: i64,
    screenshots: Vec<ScreenshotRow>,
    filter: ScreenshotFilter,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    resolved_users: Vec<ResolvedUserEcho>,
    caveats: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SummarizeScreenshotsOutput {
    group_by: ScreenshotGroupBy,
    total: i64,
    rows: Vec<SummaryRow>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    resolved_users: Vec<ResolvedUserEcho>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SummaryRow {
    #[serde(skip_serializing_if = "Option::is_none")]
    user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    world_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    world_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    month: Option<String>,
    count: i64,
    last_captured_at: String,
}

impl SummaryRow {
    fn new(group_by: ScreenshotGroupBy, row: ScreenshotFacet) -> Self {
        let last_captured_at = millis_to_rfc3339(row.last_captured_at_ms);
        let mut summary = Self {
            user_id: None,
            display_name: None,
            world_id: None,
            world_name: None,
            month: None,
            count: row.count,
            last_captured_at,
        };
        match group_by {
            ScreenshotGroupBy::Person => {
                summary.user_id = Some(row.id);
                summary.display_name = Some(row.name);
            }
            ScreenshotGroupBy::World => {
                summary.world_id = Some(row.id);
                summary.world_name = Some(row.name);
            }
            ScreenshotGroupBy::Month => summary.month = Some(row.id),
        }
        summary
    }
}

fn is_zero(value: &i64) -> bool {
    *value == 0
}
