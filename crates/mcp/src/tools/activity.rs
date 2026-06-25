use std::collections::{BTreeMap, HashMap};

use chrono::{DateTime, Datelike, Duration, Utc};
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;
use rmcp::{schemars, tool, tool_router};
use serde::{Deserialize, Serialize};
use vrcx_0_persistence::{activity, social_aggregates};

use crate::server::VrcxMcpServer;

use super::common::{
    map_persistence_error, ms_to_rfc3339_z, require_current_user_id, rfc3339_z,
    social_aggregates_result, structured_result, time_window_bounds_ms, TimeWindowParams,
};

#[tool_router(router = activity_tool_router, vis = "pub(crate)")]
impl VrcxMcpServer {
    #[tool(description = "Return observed co-presence summary facts for friends in a time window.")]
    async fn get_copresence_summary(
        &self,
        Parameters(input): Parameters<CopresenceSummaryParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = self.runtime.current_user_id().unwrap_or_default();
        social_aggregates_result(social_aggregates::get_copresence_summary(
            self.runtime.db.as_ref(),
            social_aggregates::CopresenceSummaryInput {
                time_window: input.time_window.into(),
                group_by: input.group_by.into(),
                min_minutes: input.min_minutes,
                owner_user_id: Some(owner_user_id),
                friends_only: input.friends_only,
            },
        ))
    }

    #[tool(description = "Return observed friend online activity buckets by hour or weekday.")]
    async fn get_friend_activity_pattern(
        &self,
        Parameters(input): Parameters<FriendActivityPatternParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        social_aggregates_result(social_aggregates::get_friend_activity_pattern(
            self.runtime.db.as_ref(),
            social_aggregates::FriendActivityPatternInput {
                owner_user_id,
                user_id: input.user_id,
                time_window: input.time_window.into(),
                bucket: input.bucket.into(),
            },
        ))
    }

    #[tool(description = "Search recently visited worlds from the local game log.")]
    async fn search_worlds_visited(
        &self,
        Parameters(input): Parameters<SearchWorldsVisitedParams>,
    ) -> Result<CallToolResult, String> {
        social_aggregates_result(social_aggregates::search_worlds_visited(
            self.runtime.db.as_ref(),
            social_aggregates::SearchWorldsVisitedInput {
                time_window: input.time_window.into(),
                limit: input.limit.unwrap_or(25),
            },
        ))
    }
    #[tool(description = "Return aggregated activity for the current VRCX-0 profile.")]
    async fn get_my_activity(
        &self,
        Parameters(input): Parameters<MyActivityParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        structured_result(self.get_my_activity_output(owner_user_id, input)?)
    }
    #[tool(
        description = "Surface friends whose observed co-presence dropped sharply versus the prior equal-length window (fading relationships); defaults to the last 30 days versus the prior 30 days."
    )]
    async fn get_fading_friends(
        &self,
        Parameters(input): Parameters<FadingFriendsParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        social_aggregates_result(social_aggregates::get_fading_friends(
            self.runtime.db.as_ref(),
            self.fading_friends_input(owner_user_id, input),
        ))
    }

    #[tool(
        description = "Return the hour-of-day or weekday buckets where the most friends are observed coming online (best time to catch people)."
    )]
    async fn get_best_time_to_play(
        &self,
        Parameters(input): Parameters<BestTimeToPlayParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        social_aggregates_result(social_aggregates::get_best_time_to_play(
            self.runtime.db.as_ref(),
            social_aggregates::BestTimeToPlayInput {
                owner_user_id,
                time_window: input.time_window.into(),
                bucket: input.bucket.into(),
                limit: input.limit,
            },
        ))
    }

    #[tool(
        description = "Fuzzy-recall people from the local game log by name fragment, time window, world, or who they shared an instance with; includes non-friends."
    )]
    async fn recall_encounter(
        &self,
        Parameters(input): Parameters<RecallEncounterParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        social_aggregates_result(social_aggregates::recall_encounter(
            self.runtime.db.as_ref(),
            social_aggregates::RecallEncounterInput {
                owner_user_id,
                name_query: input.name_query,
                world_id: input.world_id,
                co_present_with_user_id: input.co_present_with_user_id,
                time_window: input.time_window.unwrap_or_default().into(),
                limit: input.limit,
            },
        ))
    }

    #[tool(
        description = "Return a structured social overview for a period (activity, top companions, new friends, fading friends, top worlds, best times) for the AI to narrate."
    )]
    async fn summarize_social_period(
        &self,
        Parameters(input): Parameters<SummarizeSocialPeriodParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        structured_result(self.summarize_social_period_output(owner_user_id, input)?)
    }
}

impl VrcxMcpServer {
    fn get_my_activity_output(
        &self,
        owner_user_id: String,
        input: MyActivityParams,
    ) -> Result<MyActivityOutput, String> {
        let time_window = input.time_window.unwrap_or_default().into();
        let bounds = time_window_bounds_ms(&time_window)?;
        let sessions = activity::activity_sessions_get(self.runtime.db.as_ref(), owner_user_id)
            .map_err(map_persistence_error)?;
        let mut session_count = 0usize;
        let mut total_ms = 0i64;
        let mut longest_ms = 0i64;
        let mut by_weekday = BTreeMap::new();
        for session in sessions {
            let start = bounds
                .from
                .map_or(session.start, |from| session.start.max(from));
            let end = bounds.to.map_or(session.end, |to| session.end.min(to));
            if end <= start {
                continue;
            }
            session_count += 1;
            let duration_ms = end - start;
            total_ms += duration_ms;
            longest_ms = longest_ms.max(duration_ms);
            if let Some(start_at) = DateTime::<Utc>::from_timestamp_millis(start) {
                *by_weekday
                    .entry(start_at.weekday().to_string())
                    .or_insert(0) += duration_ms / 60_000;
            }
        }
        let total_minutes = total_ms / 60_000;
        Ok(MyActivityOutput {
            total_minutes,
            session_count,
            avg_session_minutes: if session_count == 0 {
                0
            } else {
                total_minutes / session_count as i64
            },
            longest_session_minutes: longest_ms / 60_000,
            by_weekday,
            caveats: vec![
                "Activity sessions are derived from this profile's local VRCX-0 activity cache."
                    .into(),
            ],
        })
    }
    fn fading_friends_input(
        &self,
        owner_user_id: String,
        input: FadingFriendsParams,
    ) -> social_aggregates::FadingFriendsInput {
        let recent_days = input.recent_days.unwrap_or(30).clamp(1, 365);
        let now = Utc::now();
        let pivot = now - Duration::days(recent_days);
        let prior_from = pivot - Duration::days(recent_days);
        social_aggregates::FadingFriendsInput {
            owner_user_id,
            prior_from: rfc3339_z(prior_from),
            pivot: rfc3339_z(pivot),
            now: rfc3339_z(now),
            min_prior_minutes: input.min_prior_minutes,
            limit: input.limit,
        }
    }

    fn summarize_social_period_output(
        &self,
        owner_user_id: String,
        input: SummarizeSocialPeriodParams,
    ) -> Result<SocialPeriodSummaryOutput, String> {
        let time_window_params = input.time_window.unwrap_or_default();
        let time_window: social_aggregates::TimeWindow = time_window_params.clone().into();
        let db = self.runtime.db.as_ref();

        let activity = self.get_my_activity_output(
            owner_user_id.clone(),
            MyActivityParams {
                time_window: Some(time_window_params.clone()),
            },
        )?;

        let mut top_companions = social_aggregates::get_copresence_summary(
            db,
            social_aggregates::CopresenceSummaryInput {
                time_window: time_window.clone(),
                group_by: social_aggregates::CopresenceGroupBy::Friend,
                min_minutes: None,
                owner_user_id: Some(owner_user_id.clone()),
                friends_only: true,
            },
        )
        .map_err(map_persistence_error)?
        .rows;
        top_companions.truncate(5);

        let new_friends = social_aggregates::get_friend_log(
            db,
            social_aggregates::FriendLogInput {
                owner_user_id: owner_user_id.clone(),
                target_user_id: None,
                types: vec!["Friend".into()],
                time_window: time_window.clone(),
                limit: Some(50),
            },
        )
        .map_err(map_persistence_error)?
        .rows;

        let fading_friends = social_aggregates::get_fading_friends(
            db,
            self.summary_fading_input(&owner_user_id, &time_window)?,
        )
        .map_err(map_persistence_error)?
        .rows
        .into_iter()
        .take(5)
        .collect();

        let top_worlds = summarize_world_visits(
            social_aggregates::search_worlds_visited(
                db,
                social_aggregates::SearchWorldsVisitedInput {
                    time_window: time_window.clone(),
                    limit: 100,
                },
            )
            .map_err(map_persistence_error)?
            .rows,
        );

        let best_times = social_aggregates::get_best_time_to_play(
            db,
            social_aggregates::BestTimeToPlayInput {
                owner_user_id,
                time_window: time_window.clone(),
                bucket: social_aggregates::ActivityBucket::HourOfDay,
                limit: Some(3),
            },
        )
        .map_err(map_persistence_error)?
        .rows;

        Ok(SocialPeriodSummaryOutput {
            period: TimeWindowEcho {
                from: time_window.from,
                to: time_window.to,
            },
            activity,
            top_companions,
            new_friends,
            fading_friends,
            top_worlds,
            best_times,
            caveats: vec![
                "This is a structured fact bundle for narration; all figures are observer-centered and undercount private instances.".into(),
                "fadingFriends compares the recent half of the period against the earlier half (or the last 30 days versus the prior 30 when no period is given).".into(),
            ],
        })
    }

    fn summary_fading_input(
        &self,
        owner_user_id: &str,
        time_window: &social_aggregates::TimeWindow,
    ) -> Result<social_aggregates::FadingFriendsInput, String> {
        let bounds = time_window_bounds_ms(time_window)?;
        let (prior_from, pivot, now) = match (bounds.from, bounds.to) {
            (Some(from), Some(to)) if to > from => {
                let mid = from + (to - from) / 2;
                (
                    ms_to_rfc3339_z(from),
                    ms_to_rfc3339_z(mid),
                    ms_to_rfc3339_z(to),
                )
            }
            _ => {
                let now = Utc::now();
                let pivot = now - Duration::days(30);
                let prior_from = pivot - Duration::days(30);
                (rfc3339_z(prior_from), rfc3339_z(pivot), rfc3339_z(now))
            }
        };
        Ok(social_aggregates::FadingFriendsInput {
            owner_user_id: owner_user_id.to_string(),
            prior_from,
            pivot,
            now,
            min_prior_minutes: None,
            limit: Some(10),
        })
    }
}
#[derive(Clone, Debug, Default, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
enum CopresenceGroupByParam {
    #[default]
    Friend,
    FriendWorld,
}

impl From<CopresenceGroupByParam> for social_aggregates::CopresenceGroupBy {
    fn from(value: CopresenceGroupByParam) -> Self {
        match value {
            CopresenceGroupByParam::Friend => Self::Friend,
            CopresenceGroupByParam::FriendWorld => Self::FriendWorld,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
enum ActivityBucketParam {
    #[default]
    HourOfDay,
    DayOfWeek,
}

impl From<ActivityBucketParam> for social_aggregates::ActivityBucket {
    fn from(value: ActivityBucketParam) -> Self {
        match value {
            ActivityBucketParam::HourOfDay => Self::HourOfDay,
            ActivityBucketParam::DayOfWeek => Self::DayOfWeek,
        }
    }
}
#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct CopresenceSummaryParams {
    #[serde(default)]
    time_window: TimeWindowParams,
    #[serde(default)]
    group_by: CopresenceGroupByParam,
    min_minutes: Option<i64>,
    #[serde(default)]
    friends_only: bool,
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct FriendActivityPatternParams {
    user_id: Option<String>,
    #[serde(default)]
    time_window: TimeWindowParams,
    #[serde(default)]
    bucket: ActivityBucketParam,
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct SearchWorldsVisitedParams {
    #[serde(default)]
    time_window: TimeWindowParams,
    limit: Option<i64>,
}
#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct MyActivityParams {
    time_window: Option<TimeWindowParams>,
}
#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct FadingFriendsParams {
    recent_days: Option<i64>,
    min_prior_minutes: Option<i64>,
    limit: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct BestTimeToPlayParams {
    #[serde(default)]
    time_window: TimeWindowParams,
    #[serde(default)]
    bucket: ActivityBucketParam,
    limit: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct RecallEncounterParams {
    name_query: Option<String>,
    world_id: Option<String>,
    co_present_with_user_id: Option<String>,
    time_window: Option<TimeWindowParams>,
    limit: Option<i64>,
}

#[derive(Clone, Debug, Default, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct SummarizeSocialPeriodParams {
    time_window: Option<TimeWindowParams>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MyActivityOutput {
    total_minutes: i64,
    session_count: usize,
    avg_session_minutes: i64,
    longest_session_minutes: i64,
    by_weekday: BTreeMap<String, i64>,
    caveats: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SocialPeriodSummaryOutput {
    period: TimeWindowEcho,
    activity: MyActivityOutput,
    top_companions: Vec<social_aggregates::CopresenceSummaryRow>,
    new_friends: Vec<social_aggregates::FriendLogRow>,
    fading_friends: Vec<social_aggregates::FadingFriendRow>,
    top_worlds: Vec<WorldVisitSummary>,
    best_times: Vec<social_aggregates::BestTimeBucketRow>,
    caveats: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TimeWindowEcho {
    from: Option<String>,
    to: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorldVisitSummary {
    world_id: String,
    world_name: String,
    visits: i64,
    total_minutes: i64,
    last_visited_at: String,
}
fn summarize_world_visits(rows: Vec<social_aggregates::VisitedWorldRow>) -> Vec<WorldVisitSummary> {
    let mut grouped: HashMap<String, WorldVisitSummary> = HashMap::new();
    for row in rows {
        let key = if row.world_id.is_empty() {
            row.location.clone()
        } else {
            row.world_id.clone()
        };
        if key.is_empty() {
            continue;
        }
        let entry = grouped.entry(key).or_insert_with(|| WorldVisitSummary {
            world_id: row.world_id.clone(),
            world_name: row.world_name.clone(),
            visits: 0,
            total_minutes: 0,
            last_visited_at: String::new(),
        });
        if entry.world_name.is_empty() && !row.world_name.is_empty() {
            entry.world_name = row.world_name.clone();
        }
        entry.visits += 1;
        entry.total_minutes += row.stay_minutes.max(0);
        if row.visited_at > entry.last_visited_at {
            entry.last_visited_at = row.visited_at;
        }
    }
    let mut worlds = grouped.into_values().collect::<Vec<_>>();
    worlds.sort_by(|left, right| {
        right
            .visits
            .cmp(&left.visits)
            .then_with(|| right.total_minutes.cmp(&left.total_minutes))
            .then_with(|| left.world_name.cmp(&right.world_name))
    });
    worlds.truncate(5);
    worlds
}
