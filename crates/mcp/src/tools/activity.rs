use std::collections::{BTreeMap, HashMap};

use chrono::{DateTime, Datelike, Duration, Utc};
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;
use rmcp::{schemars, tool, tool_router};
use serde::{Deserialize, Serialize};
use vrcx_0_core::activity_buckets::{
    self, ActivityBucket as CoreActivityBucket, ActivityStreaks, ActivityTimeBucket,
};
use vrcx_0_persistence::{activity, social_aggregates};

use crate::server::VrcxMcpServer;

use super::common::{
    map_persistence_error, ms_to_rfc3339_z, require_current_user_id,
    resolve_optional_target_or_result, rfc3339_z, social_aggregates_result, structured_result,
    time_window_bounds_ms, TargetResolutionOutcome, TimeWindowParams, WithResolution,
};

const ACTIVITY_CACHE_CAVEAT: &str =
    "Activity sessions come from this profile's local VRCX-0 activity cache.";

#[tool_router(router = activity_tool_router, vis = "pub(crate)")]
impl VrcxMcpServer {
    #[tool(
        description = "[L2·analyze] Ranked time-spent-together facts per person, aggregated from the local game log (reliable even inside private instances because you were there). THE tool for \"who I play/spend the most time with\". Defaults to current friends (friendsOnly=true). groupBy=friend ranks total minutes per person; groupBy=friend_world breaks one person's time down by world. For all-time/\"ever\"/\"so far\" questions OMIT timeWindow entirely — never pass a narrow window for an all-time question. Rows are pre-ranked and limited with isFriend; read the top rows, don't loop."
    )]
    async fn get_copresence_summary(
        &self,
        Parameters(input): Parameters<CopresenceSummaryParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        social_aggregates_result(social_aggregates::get_copresence_summary(
            self.runtime.db.as_ref(),
            social_aggregates::CopresenceSummaryInput {
                time_window: input.time_window.into(),
                group_by: input.group_by.into(),
                min_minutes: input.min_minutes,
                limit: input.limit,
                owner_user_id: Some(owner_user_id),
                friends_only: input.friends_only.unwrap_or(true),
            },
        ))
    }

    #[tool(
        description = "[L2·analyze] One friend's (or all friends') online activity bucketed by hour-of-day or weekday, from the online/offline log. Use for \"when is X usually online\". Buckets are UTC unless you pass utcOffsetMinutes (the user's offset, e.g. 540 for UTC+9) for the user's local time. For \"best time to catch the MOST people\" prefer get_best_time_to_play."
    )]
    async fn get_friend_activity_pattern(
        &self,
        Parameters(input): Parameters<FriendActivityPatternParams>,
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
        let output = social_aggregates::get_friend_activity_pattern(
            self.runtime.db.as_ref(),
            social_aggregates::FriendActivityPatternInput {
                owner_user_id,
                user_id,
                time_window: input.time_window.into(),
                bucket: input.bucket.into(),
                utc_offset_minutes: input.utc_offset_minutes,
            },
        )
        .map_err(map_persistence_error)?;
        structured_result(WithResolution {
            inner: output,
            resolved_user,
        })
    }

    #[tool(
        description = "[L1·query] List worlds the signed-in user recently visited, newest first, from the local game log (worldId, worldName, location, visitedAt, stayMinutes). Leaf lookup. For \"which worlds did I play most\" use the aggregated summarize_social_period instead of counting these rows yourself."
    )]
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
    #[tool(
        description = "[L2·analyze] Your own aggregated playtime for a window: total minutes, sessions, average/longest session, weekday breakdown. Use for \"how much did I play\". For trends over time prefer get_activity_timeline; for streaks/breaks prefer get_activity_streaks."
    )]
    async fn get_my_activity(
        &self,
        Parameters(input): Parameters<MyActivityParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        structured_result(self.get_my_activity_output(owner_user_id, input)?)
    }

    #[tool(
        description = "[L2·analyze] The signed-in user's own playtime bucketed over time: year, month, week, dayOfWeek, or hourOfDay, with a ready-to-read summary. Use this for \"which months/days did I play most\", activity trends, and personal schedule / when I log on. Pass utcOffsetMinutes (e.g. 540 for UTC+9) so month/day/hour buckets are local. Omit timeWindow for all history. Rows carry minutes and sessionCount."
    )]
    async fn get_activity_timeline(
        &self,
        Parameters(input): Parameters<ActivityTimelineParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        let now_ms = Utc::now().timestamp_millis();
        let pairs = self.activity_session_pairs_for_user(owner_user_id, now_ms)?;
        let time_window: social_aggregates::TimeWindow = input.time_window.into();
        let bounds = time_window_bounds_ms(&time_window)?;
        let offset_minutes = input.utc_offset_minutes.unwrap_or(0);
        let bucket = input.bucket.into();
        let rows = activity_buckets::activity_timeline(
            &pairs,
            bucket,
            offset_minutes,
            bounds.from,
            bounds.to,
        );
        structured_result(activity_timeline_output(input.bucket, offset_minutes, rows))
    }

    #[tool(
        description = "[L2·analyze] The signed-in user's play-streak facts: longest break without playing, current break, longest daily play streak, total active days, first/last session, total minutes, and session count, with a ready-to-read summary. Use this for \"longest I went without playing\" or \"how many days have I played\". Pass utcOffsetMinutes so day boundaries are local."
    )]
    async fn get_activity_streaks(
        &self,
        Parameters(input): Parameters<ActivityStreaksParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        let now_ms = Utc::now().timestamp_millis();
        let pairs = self.activity_session_pairs_for_user(owner_user_id, now_ms)?;
        let offset_minutes = input.utc_offset_minutes.unwrap_or(0);
        let streaks = activity_buckets::activity_streaks(&pairs, now_ms, offset_minutes);
        structured_result(activity_streaks_output(offset_minutes, streaks))
    }
    #[tool(
        description = "[L2·analyze] Friends whose observed co-presence dropped sharply versus the prior equal-length window (fading relationships), ranked by drop; defaults to the last 30 days versus the prior 30 days. Report as an observation (overlap fell — could be schedule, status, or sample size), never as the other person's intent or feelings."
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
        description = "[L2·analyze] The hour-of-day or weekday buckets where the most distinct friends are observed coming online (best time to catch people), across all friends. Use for \"when should I log on to find people\". Buckets are UTC unless you pass utcOffsetMinutes (e.g. 540 for UTC+9) for the user's local time. For a single named friend prefer get_friend_activity_pattern."
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
                utc_offset_minutes: input.utc_offset_minutes,
            },
        ))
    }

    #[tool(
        description = "[L1·query] Fuzzy-recall people from the local game log by name fragment, time window, world, or who they shared an instance with; INCLUDES non-friends/strangers (each row flags isFriend). Use for \"who was that person I met at ...\". Recall only, not prediction."
    )]
    async fn recall_encounter(
        &self,
        Parameters(input): Parameters<RecallEncounterParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        let (co_present_with_user_id, resolved_user) = match resolve_optional_target_or_result(
            &self.runtime,
            input.co_present_with.as_deref(),
        )? {
            Some(TargetResolutionOutcome::Resolved(target)) => (Some(target.user_id), target.echo),
            Some(TargetResolutionOutcome::ToolResult(result)) => return Ok(result),
            None => (None, None),
        };
        let output = social_aggregates::recall_encounter(
            self.runtime.db.as_ref(),
            social_aggregates::RecallEncounterInput {
                owner_user_id,
                name_query: input.name_query,
                world_id: input.world_id,
                co_present_with_user_id,
                time_window: input.time_window.unwrap_or_default().into(),
                limit: input.limit,
            },
        )
        .map_err(map_persistence_error)?;
        structured_result(WithResolution {
            inner: output,
            resolved_user,
        })
    }

    #[tool(
        description = "[L3·bundle] One call composing several L2 analyses for a period (your activity, top companions, new friends, fading friends, top worlds, best times) into a structured bundle for you to narrate. Use for \"recap my week/month\" or \"how was my social activity\". Do NOT separately call the parts it already includes; drill into a specific L2 tool only for extra detail."
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

        let top_companions = social_aggregates::get_copresence_summary(
            db,
            social_aggregates::CopresenceSummaryInput {
                time_window: time_window.clone(),
                group_by: social_aggregates::CopresenceGroupBy::Friend,
                min_minutes: None,
                limit: Some(5),
                owner_user_id: Some(owner_user_id.clone()),
                friends_only: true,
            },
        )
        .map_err(map_persistence_error)?
        .rows;

        let new_friends = social_aggregates::get_friend_log(
            db,
            social_aggregates::FriendLogInput {
                owner_user_id: owner_user_id.clone(),
                target_user_id: None,
                types: vec!["Friend".into()],
                time_window: time_window.clone(),
                limit: Some(50),
                cursor: None,
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
                utc_offset_minutes: None,
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

    fn activity_session_pairs_for_user(
        &self,
        owner_user_id: String,
        now_ms: i64,
    ) -> Result<Vec<(i64, i64)>, String> {
        activity::activity_sessions_get(self.runtime.db.as_ref(), owner_user_id)
            .map(|sessions| activity_session_pairs(sessions, now_ms))
            .map_err(map_persistence_error)
    }
}

fn activity_session_pairs(
    sessions: Vec<activity::ActivitySessionOutput>,
    now_ms: i64,
) -> Vec<(i64, i64)> {
    sessions
        .into_iter()
        .filter_map(|session| {
            let end = if session.is_open_tail {
                now_ms
            } else {
                session.end
            };
            (end > session.start).then_some((session.start, end))
        })
        .collect()
}

fn activity_timeline_output(
    bucket: ActivityTimelineBucketParam,
    offset_minutes: i64,
    rows: Vec<CoreActivityBucket>,
) -> ActivityTimelineOutput {
    let total_minutes = rows.iter().map(|row| row.minutes).sum::<i64>();
    let summary = rows
        .iter()
        .filter(|row| row.minutes > 0)
        .max_by_key(|row| row.minutes)
        .map(|top| {
            format!(
                "Across {} {} buckets you logged {}h; most active: {} ({}h).",
                rows.len(),
                bucket.summary_label(),
                total_minutes / 60,
                top.label,
                top.minutes / 60
            )
        })
        .unwrap_or_else(|| "No activity sessions found in this window.".into());
    ActivityTimelineOutput {
        bucket: bucket.as_str().into(),
        rows: rows.into_iter().map(ActivityTimelineRow::from).collect(),
        summary,
        caveats: vec![
            format!(
                "Buckets are in {}.",
                activity_buckets::utc_offset_label(offset_minutes)
            ),
            ACTIVITY_CACHE_CAVEAT.into(),
        ],
    }
}

fn activity_streaks_output(offset_minutes: i64, streaks: ActivityStreaks) -> ActivityStreaksOutput {
    let summary = if streaks.session_count == 0 {
        "No activity sessions recorded yet.".into()
    } else {
        let current_break = if streaks.current_break_days == 0 {
            "You've played today.".into()
        } else {
            format!(
                "It's been {}d since you last played.",
                streaks.current_break_days
            )
        };
        format!(
            "You've played on {} day(s); longest streak {}d, longest break {}d. {}",
            streaks.total_active_days,
            streaks.longest_play_streak_days,
            streaks.longest_break_days,
            current_break
        )
    };
    ActivityStreaksOutput {
        longest_break_days: streaks.longest_break_days,
        current_break_days: streaks.current_break_days,
        longest_play_streak_days: streaks.longest_play_streak_days,
        total_active_days: streaks.total_active_days,
        first_session_at: streaks.first_session_ms.map(ms_to_rfc3339_z),
        last_session_at: streaks.last_session_ms.map(ms_to_rfc3339_z),
        total_minutes: streaks.total_minutes,
        session_count: streaks.session_count,
        summary,
        caveats: vec![
            format!(
                "Day boundaries and breaks are counted in {}.",
                activity_buckets::utc_offset_label(offset_minutes)
            ),
            ACTIVITY_CACHE_CAVEAT.into(),
        ],
    }
}

impl From<CoreActivityBucket> for ActivityTimelineRow {
    fn from(value: CoreActivityBucket) -> Self {
        Self {
            label: value.label,
            minutes: value.minutes,
            session_count: value.session_count,
        }
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

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
enum ActivityTimelineBucketParam {
    Year,
    #[default]
    Month,
    Week,
    #[serde(alias = "day_of_week")]
    DayOfWeek,
    #[serde(alias = "hour_of_day")]
    HourOfDay,
}

impl ActivityTimelineBucketParam {
    fn as_str(self) -> &'static str {
        match self {
            Self::Year => "year",
            Self::Month => "month",
            Self::Week => "week",
            Self::DayOfWeek => "dayOfWeek",
            Self::HourOfDay => "hourOfDay",
        }
    }

    fn summary_label(self) -> &'static str {
        match self {
            Self::Year => "year",
            Self::Month => "month",
            Self::Week => "week",
            Self::DayOfWeek => "weekday",
            Self::HourOfDay => "hour-of-day",
        }
    }
}

impl From<ActivityTimelineBucketParam> for ActivityTimeBucket {
    fn from(value: ActivityTimelineBucketParam) -> Self {
        match value {
            ActivityTimelineBucketParam::Year => Self::Year,
            ActivityTimelineBucketParam::Month => Self::Month,
            ActivityTimelineBucketParam::Week => Self::Week,
            ActivityTimelineBucketParam::DayOfWeek => Self::DayOfWeek,
            ActivityTimelineBucketParam::HourOfDay => Self::HourOfDay,
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
    /// Time window to search. Accepts {from, to} RFC3339, or a relative string
    /// ("today", "yesterday", "this week", "last week", "this month",
    /// "last month", or a rolling window like "7d", "2w", "3mo"). Resolved in
    /// UTC; weeks start Monday. Omit only for all history ("ever", "so far").
    #[serde(default)]
    time_window: TimeWindowParams,
    /// friend (default) ranks total time per person; friend_world breaks one
    /// person's time down per world (use only for a per-world breakdown).
    #[serde(default)]
    group_by: CopresenceGroupByParam,
    /// Minimum co-presence minutes to include after aggregation.
    min_minutes: Option<i64>,
    /// Maximum ranked rows to return for a top/most ranking.
    limit: Option<i64>,
    /// Restrict to current friends. Defaults to true; set false only to include
    /// strangers/acquaintances you are not friends with.
    friends_only: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct FriendActivityPatternParams {
    #[serde(alias = "userId", alias = "user_id")]
    user: Option<String>,
    #[serde(default)]
    time_window: TimeWindowParams,
    #[serde(default)]
    bucket: ActivityBucketParam,
    /// The user's UTC offset in minutes (e.g. 540 for UTC+9, -300 for UTC-5).
    /// Pass it so hour/weekday buckets come back in the user's local time.
    utc_offset_minutes: Option<i64>,
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
struct ActivityTimelineParams {
    /// year | month | week | dayOfWeek | hourOfDay (default month).
    #[serde(default)]
    bucket: ActivityTimelineBucketParam,
    /// Omit for all history.
    #[serde(default)]
    time_window: TimeWindowParams,
    /// The user's UTC offset in minutes (e.g. 540 for UTC+9, -300 for UTC-5).
    /// Pass it so month/day/hour buckets come back in the user's local time.
    utc_offset_minutes: Option<i64>,
}
#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct ActivityStreaksParams {
    /// The user's UTC offset in minutes (e.g. 540 for UTC+9, -300 for UTC-5).
    /// Pass it so day boundaries and breaks are counted in the user's local time.
    utc_offset_minutes: Option<i64>,
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
    /// The user's UTC offset in minutes (e.g. 540 for UTC+9, -300 for UTC-5).
    /// Pass it so hour/weekday buckets come back in the user's local time.
    utc_offset_minutes: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct RecallEncounterParams {
    name_query: Option<String>,
    world_id: Option<String>,
    #[serde(alias = "coPresentWithUserId", alias = "co_present_with_user_id")]
    co_present_with: Option<String>,
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
struct ActivityTimelineOutput {
    bucket: String,
    rows: Vec<ActivityTimelineRow>,
    summary: String,
    caveats: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActivityTimelineRow {
    label: String,
    minutes: i64,
    session_count: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActivityStreaksOutput {
    longest_break_days: i64,
    current_break_days: i64,
    longest_play_streak_days: i64,
    total_active_days: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    first_session_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_session_at: Option<String>,
    total_minutes: i64,
    session_count: usize,
    summary: String,
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

#[cfg(test)]
mod activity_output_tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use rmcp::handler::server::wrapper::Parameters;
    use vrcx_0_application::{
        HostSessionRuntime, MutualGraphFetchRuntime, OverlayActivityRuntime, PrintCleanupQueue,
        RealtimeHostRuntime, RealtimeHostRuntimeDeps, RuntimeAuthScope, RuntimeDiagnostics,
        RuntimeEventBus, RuntimeSnapshot, RuntimeSyncEngine, TaskSupervisor, WebClient, WorldCache,
    };
    use vrcx_0_persistence::{
        config::ConfigRepository, game_log::ensure_game_log_tables, storage::StorageService,
        DatabaseService,
    };

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir()
                .join(format!("vrcx-0-mcp-{name}-{}-{nonce}", std::process::id()));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn test_server(
        name: &str,
        auth_scope_user_id: &str,
    ) -> Result<(TestDir, VrcxMcpServer), Box<dyn std::error::Error>> {
        let dir = TestDir::new(name);
        let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);
        ensure_game_log_tables(db.as_ref())?;
        let storage = StorageService::new(&dir.path.join("storage.json"))?;
        let web = Arc::new(WebClient::new(
            &storage,
            db.as_ref(),
            "wss://pipeline.vrchat.cloud".into(),
            env!("CARGO_PKG_VERSION"),
        )?);
        let auth_scope = RuntimeAuthScope::new();
        if !auth_scope_user_id.trim().is_empty() {
            auth_scope.set(auth_scope_user_id, "https://api.vrchat.cloud/api/1");
        }
        let event_bus = RuntimeEventBus::new();
        let sync = RuntimeSyncEngine::new();
        let tasks = TaskSupervisor::new();
        let session = HostSessionRuntime::new();
        let world_cache = Arc::new(WorldCache::new(
            Arc::clone(&db),
            512,
            Duration::from_secs(30 * 60),
        ));
        let realtime_runtime = Arc::new(RealtimeHostRuntime::new(RealtimeHostRuntimeDeps {
            db: Arc::clone(&db),
            web: Arc::clone(&web),
            event_bus,
            sync: sync.clone(),
            tasks: tasks.clone(),
            session,
            auth_scope: auth_scope.clone(),
            game_log_snapshot: Arc::new(Mutex::new(RuntimeSnapshot::default())),
            overlay_activity: OverlayActivityRuntime::default(),
            world_cache,
            print_cleanup: PrintCleanupQueue::new(),
            friend_note_change_sink: None,
        }));
        let runtime = crate::runtime::McpRuntime {
            db: Arc::clone(&db),
            web,
            diagnostics: RuntimeDiagnostics::new(),
            sync,
            realtime_runtime,
            auth_scope,
            config: ConfigRepository::new(db),
            mutual_graph_fetch: MutualGraphFetchRuntime::new(),
            tasks,
        };
        Ok((dir, VrcxMcpServer::new(runtime)))
    }

    fn ms(value: &str) -> i64 {
        DateTime::parse_from_rfc3339(value)
            .unwrap()
            .timestamp_millis()
    }

    #[test]
    fn timeline_output_echoes_bucket_and_keeps_histogram_rows() {
        let rows = activity_buckets::activity_timeline(
            &[(ms("2025-01-01T18:00:00Z"), ms("2025-01-01T20:00:00Z"))],
            ActivityTimeBucket::HourOfDay,
            540,
            None,
            None,
        );

        let output = activity_timeline_output(ActivityTimelineBucketParam::HourOfDay, 540, rows);

        assert_eq!(output.bucket, "hourOfDay");
        assert_eq!(output.rows.len(), 24);
        assert!(output.rows.iter().any(|row| row.minutes == 60));
        assert!(!output.summary.is_empty());
        assert!(output
            .caveats
            .iter()
            .any(|caveat| caveat.contains("UTC+09:00")));
    }

    #[test]
    fn streaks_output_includes_summary_and_dates() {
        let streaks = activity_buckets::activity_streaks(
            &[(ms("2025-01-01T01:00:00Z"), ms("2025-01-01T02:00:00Z"))],
            ms("2025-01-04T01:00:00Z"),
            0,
        );

        let output = activity_streaks_output(0, streaks);

        assert_eq!(output.current_break_days, 3);
        assert_eq!(
            output.first_session_at.as_deref(),
            Some("2025-01-01T01:00:00Z")
        );
        assert!(!output.summary.is_empty());
        assert!(output.caveats.iter().any(|caveat| caveat.contains("UTC")));
    }

    #[tokio::test]
    async fn copresence_summary_requires_auth_scope_owner() {
        let (_dir, server) =
            test_server("copresence-empty-owner", "").expect("test server should build");

        let error = server
            .get_copresence_summary(Parameters(CopresenceSummaryParams {
                time_window: TimeWindowParams::default(),
                group_by: CopresenceGroupByParam::Friend,
                min_minutes: None,
                limit: Some(5),
                friends_only: None,
            }))
            .await
            .expect_err("empty auth_scope owner must reject the tool call");

        assert!(
            error.contains("current user unknown"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn timeline_bucket_accepts_camel_and_snake_case() {
        let camel: ActivityTimelineParams =
            serde_json::from_value(serde_json::json!({ "bucket": "dayOfWeek" })).unwrap();
        let snake: ActivityTimelineParams =
            serde_json::from_value(serde_json::json!({ "bucket": "hour_of_day" })).unwrap();

        assert_eq!(camel.bucket, ActivityTimelineBucketParam::DayOfWeek);
        assert_eq!(snake.bucket, ActivityTimelineBucketParam::HourOfDay);
    }
}
