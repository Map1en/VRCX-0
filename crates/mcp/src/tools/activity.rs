use std::collections::BTreeMap;

use chrono::{DateTime, Datelike, Duration, Utc};
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;
use rmcp::{schemars, tool, tool_router};
use serde::{Deserialize, Serialize};
use vrcx_0_application_core::LocalGameContextSnapshot;
use vrcx_0_contracts::social_aggregates;
use vrcx_0_core::activity_buckets::{
    self, ActivityBucket as CoreActivityBucket, ActivityStreaks, ActivityTimeBucket,
};
use vrcx_0_core::activity_sessions::PLAY_SESSION_MERGE_GAP_MS;
use vrcx_0_core::location::is_real_instance;

use crate::server::VrcxMcpServer;

use super::common::{
    application_query_result, deserialize_optional_bool, map_application_query_error,
    ms_to_rfc3339_z, require_current_user_id, resolve_optional_target_or_result, rfc3339_z,
    structured_result, time_window_bounds_ms, TargetResolutionOutcome, TimeWindowParams,
    WithResolution,
};
use vrcx_0_core::OwnerId;

const PLAY_TIME_CAVEAT: &str =
    "Play time counts instance stays from this profile's game log, including the current stay while VRChat is running; time spent while VRCX-0 was not running is missing.";

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
        application_query_result(self.runtime.activity_queries.copresence_summary(
            social_aggregates::CopresenceSummaryInput {
                time_window: input.time_window.into(),
                group_by: input.group_by.into(),
                min_minutes: input.min_minutes,
                limit: input.limit,
                owner_user_id: Some(owner_user_id.clone()),
                audience: if input.friends_only.unwrap_or(true) {
                    social_aggregates::CopresenceAudience::Friends
                } else {
                    social_aggregates::CopresenceAudience::Everyone
                },
                order_by: social_aggregates::CopresenceOrderBy::default(),
                utc_offset_minutes: None,
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
        let output = self
            .runtime
            .activity_queries
            .friend_activity_pattern(social_aggregates::FriendActivityPatternInput {
                owner_user_id: owner_user_id.clone(),
                user_id,
                time_window: input.time_window.into(),
                bucket: input.bucket.into(),
                utc_offset_minutes: input.utc_offset_minutes,
            })
            .map_err(map_application_query_error)?;
        structured_result(WithResolution {
            inner: output,
            resolved_user,
        })
    }

    #[tool(
        description = "[L1·query] List worlds the signed-in user recently visited, newest first, from the local game log (worldId, worldName, location, visitedAt, leftAt, stayMinutes; leftAt is null for the visit still in progress or when the leave was not recorded). Leaf lookup. Drill into one row with get_visit_timeline (pass its visitedAt as `at`) to see who came and went. For \"which worlds did I play most\" use the aggregated summarize_social_period instead of counting these rows yourself."
    )]
    async fn search_worlds_visited(
        &self,
        Parameters(input): Parameters<SearchWorldsVisitedParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        application_query_result(self.runtime.activity_queries.search_worlds_visited(
            &owner_user_id,
            social_aggregates::SearchWorldsVisitedInput {
                time_window: input.time_window.into(),
                limit: input.limit.unwrap_or(25),
            },
        ))
    }

    #[tool(
        description = "[L1·query] Reconstruct one instance visit from the local game log: the world/instance, your exact joinedAt and leftAt (UTC, millisecond precision), and everyone observed while you were there — per person, ordered by time shared, with each stay's joinedAt/leftAt (a person who leaves and comes back has several stints). Select the visit with `at`: any UTC timestamp inside it, or the visitedAt of a search_worlds_visited row; add `location` only to disambiguate. Use for \"who was in that room with me\", \"when did X join or leave\", or exact timestamps for a recording. Caveats: the visit you are still in has no leftAt (inProgress=true); a crash or truncated log drops leave events, so a missing leftAt never means the person stayed; a missing joinedAt means the person was already inside before you arrived or before VRCX-0 started watching; old rows may lack userId and are keyed by display name; the roster is capped (truncated=true, peopleObserved keeps the real count) and the summary still covers the whole visit. Pairs with search_worlds_visited to find visits in a period."
    )]
    async fn get_visit_timeline(
        &self,
        Parameters(input): Parameters<VisitTimelineParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        application_query_result(self.runtime.activity_queries.visit_timeline(
            social_aggregates::VisitTimelineInput {
                owner_user_id,
                at: input.at,
                location: input.location,
                limit: input.limit,
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
        structured_result(self.get_my_activity_output(owner_user_id.clone(), input)?)
    }

    #[tool(
        description = "[L2·analyze] The signed-in user's own playtime bucketed over time: year, month, week, dayOfWeek, or hourOfDay, with a ready-to-read summary. Use this for \"which months/days did I play most\", activity trends, and personal schedule / when I log on. Pass utcOffsetMinutes (e.g. 540 for UTC+9) so month/day/hour buckets are local. Omit timeWindow for all history. Rows carry minutes and sessionCount."
    )]
    async fn get_activity_timeline(
        &self,
        Parameters(input): Parameters<ActivityTimelineParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        let time_window: social_aggregates::TimeWindow = input.time_window.into();
        let bounds = time_window_bounds_ms(&time_window)?;
        let to_ms = bounds.to.unwrap_or_else(|| Utc::now().timestamp_millis());
        let sessions = self.play_sessions(&owner_user_id, bounds.from, to_ms)?;
        let offset_minutes = input.utc_offset_minutes.unwrap_or(0);
        let bucket = input.bucket.into();
        let rows = activity_buckets::activity_timeline(
            &sessions,
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
        let sessions = self.play_sessions(&owner_user_id, None, now_ms)?;
        let offset_minutes = input.utc_offset_minutes.unwrap_or(0);
        let streaks = activity_buckets::activity_streaks(&sessions, now_ms, offset_minutes);
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
        application_query_result(
            self.runtime
                .activity_queries
                .fading_friends(self.fading_friends_input(owner_user_id.clone(), input)),
        )
    }

    #[tool(
        description = "[L2·analyze] The hour-of-day or weekday buckets where the most distinct friends are observed coming online (best time to catch people), across all friends. Use for \"when should I log on to find people\". Buckets are UTC unless you pass utcOffsetMinutes (e.g. 540 for UTC+9) for the user's local time. For a single named friend prefer get_friend_activity_pattern."
    )]
    async fn get_best_time_to_play(
        &self,
        Parameters(input): Parameters<BestTimeToPlayParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        application_query_result(self.runtime.activity_queries.best_time_to_play(
            social_aggregates::BestTimeToPlayInput {
                owner_user_id: owner_user_id.clone(),
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
        let output = self
            .runtime
            .activity_queries
            .recall_encounter(social_aggregates::RecallEncounterInput {
                owner_user_id: owner_user_id.clone(),
                name_query: input.name_query,
                world_id: input.world_id,
                co_present_with_user_id,
                time_window: input.time_window.unwrap_or_default().into(),
                limit: input.limit,
            })
            .map_err(map_application_query_error)?;
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
        structured_result(self.summarize_social_period_output(owner_user_id.clone(), input)?)
    }
}

impl VrcxMcpServer {
    fn get_my_activity_output(
        &self,
        owner_user_id: OwnerId,
        input: MyActivityParams,
    ) -> Result<MyActivityOutput, String> {
        let time_window = input.time_window.unwrap_or_default().into();
        let bounds = time_window_bounds_ms(&time_window)?;
        let offset_minutes = input.utc_offset_minutes.unwrap_or(0);
        let offset_ms = offset_minutes.saturating_mul(60_000);
        let to_ms = bounds.to.unwrap_or_else(|| Utc::now().timestamp_millis());
        let spans = self.play_spans(&owner_user_id, bounds.from, to_ms)?;
        let sessions = activity_buckets::merge_spans(&spans, PLAY_SESSION_MERGE_GAP_MS);
        let session_count = sessions.len();
        let longest_ms = sessions
            .iter()
            .map(|(start, end)| end - start)
            .max()
            .unwrap_or(0);
        let mut total_ms = 0i64;
        let mut by_weekday = BTreeMap::new();
        for (start, end) in activity_buckets::merge_spans(&spans, 0) {
            let duration_ms = end - start;
            total_ms += duration_ms;
            if let Some(start_at) =
                DateTime::<Utc>::from_timestamp_millis(start.saturating_add(offset_ms))
            {
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
                format!(
                    "Weekday buckets are in {}.",
                    activity_buckets::utc_offset_label(offset_minutes)
                ),
                PLAY_TIME_CAVEAT.into(),
            ],
        })
    }
    fn fading_friends_input(
        &self,
        owner_user_id: OwnerId,
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
        owner_user_id: OwnerId,
        input: SummarizeSocialPeriodParams,
    ) -> Result<SocialPeriodSummaryOutput, String> {
        let time_window_params = input.time_window.unwrap_or_default();
        let time_window: social_aggregates::TimeWindow = time_window_params.clone().into();
        let activity = self.get_my_activity_output(
            owner_user_id.clone(),
            MyActivityParams {
                time_window: Some(time_window_params.clone()),
                utc_offset_minutes: input.utc_offset_minutes,
            },
        )?;

        let top_companions = self
            .runtime
            .activity_queries
            .copresence_summary(social_aggregates::CopresenceSummaryInput {
                time_window: time_window.clone(),
                group_by: social_aggregates::CopresenceGroupBy::Friend,
                min_minutes: None,
                limit: Some(5),
                owner_user_id: Some(owner_user_id.clone()),
                audience: social_aggregates::CopresenceAudience::Friends,
                order_by: social_aggregates::CopresenceOrderBy::default(),
                utc_offset_minutes: input.utc_offset_minutes,
            })
            .map_err(map_application_query_error)?
            .rows;

        let new_friends = self
            .runtime
            .activity_queries
            .friend_log(social_aggregates::FriendLogInput {
                owner_user_id: owner_user_id.clone(),
                target_user_id: None,
                types: vec!["Friend".into()],
                time_window: time_window.clone(),
                limit: Some(50),
                cursor: None,
            })
            .map_err(map_application_query_error)?
            .rows;

        let fading_friends = self
            .runtime
            .activity_queries
            .fading_friends(self.summary_fading_input(&owner_user_id, &time_window)?)
            .map_err(map_application_query_error)?
            .rows
            .into_iter()
            .take(5)
            .collect();

        let top_worlds = self
            .runtime
            .activity_queries
            .top_visited_worlds(
                &owner_user_id,
                social_aggregates::TopVisitedWorldsInput {
                    time_window: time_window.clone(),
                    limit: 5,
                },
            )
            .map_err(map_application_query_error)?;

        let best_times = self
            .runtime
            .activity_queries
            .best_time_to_play(social_aggregates::BestTimeToPlayInput {
                owner_user_id,
                time_window: time_window.clone(),
                bucket: social_aggregates::ActivityBucket::HourOfDay,
                limit: Some(3),
                utc_offset_minutes: input.utc_offset_minutes,
            })
            .map_err(map_application_query_error)?
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
                format!(
                    "Best-time buckets are in {}.",
                    activity_buckets::utc_offset_label(input.utc_offset_minutes.unwrap_or(0))
                ),
            ],
        })
    }

    fn summary_fading_input(
        &self,
        owner_user_id: &OwnerId,
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
            owner_user_id: owner_user_id.clone(),
            prior_from,
            pivot,
            now,
            min_prior_minutes: None,
            limit: Some(10),
        })
    }

    fn open_play_location(&self) -> Option<String> {
        match self.runtime.realtime_runtime.local_game_context() {
            LocalGameContextSnapshot::Available {
                is_game_running: true,
                location,
                ..
            } if is_real_instance(&location) => Some(location),
            _ => None,
        }
    }

    fn play_spans(
        &self,
        owner_user_id: &OwnerId,
        from_ms: Option<i64>,
        to_ms: i64,
    ) -> Result<Vec<(i64, i64)>, String> {
        let open_location = self.open_play_location();
        self.runtime
            .activity_queries
            .play_spans(owner_user_id, from_ms, to_ms, open_location.as_deref())
            .map(|spans| {
                spans
                    .into_iter()
                    .map(|span| (span.start, span.end))
                    .collect()
            })
            .map_err(map_application_query_error)
    }

    fn play_sessions(
        &self,
        owner_user_id: &OwnerId,
        from_ms: Option<i64>,
        to_ms: i64,
    ) -> Result<Vec<(i64, i64)>, String> {
        self.play_spans(owner_user_id, from_ms, to_ms)
            .map(|spans| activity_buckets::merge_spans(&spans, PLAY_SESSION_MERGE_GAP_MS))
    }
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
            PLAY_TIME_CAVEAT.into(),
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
            PLAY_TIME_CAVEAT.into(),
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
    #[serde(alias = "hourOfDay")]
    HourOfDay,
    #[serde(alias = "dayOfWeek", alias = "weekday")]
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
    /// Time window to search. Accepts {from, to} RFC3339, a four-digit calendar
    /// year, or a relative string ("today", "yesterday", "this week",
    /// "last week", "this month", "last month", or a rolling window like
    /// "7d", "2w", "3mo"). Resolved in UTC; weeks start Monday. Omit only for
    /// all history ("ever", "so far").
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
    #[serde(default, deserialize_with = "deserialize_optional_bool")]
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
struct VisitTimelineParams {
    /// A UTC timestamp inside the visit (RFC3339), or the visitedAt of a
    /// search_worlds_visited row.
    at: String,
    /// Optional instance location to disambiguate when several visits share a second.
    location: Option<String>,
    /// Roster cap (default 50, max 200); peopleObserved keeps the real count.
    limit: Option<i64>,
}
#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct MyActivityParams {
    time_window: Option<TimeWindowParams>,
    /// The user's UTC offset in minutes (e.g. 540 for UTC+9, -300 for UTC-5).
    /// Pass it so weekday buckets come back in the user's local time.
    utc_offset_minutes: Option<i64>,
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
    /// The user's UTC offset in minutes (e.g. 540 for UTC+9, -300 for UTC-5).
    /// Pass it so weekday and best-time buckets come back in the user's local time.
    utc_offset_minutes: Option<i64>,
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
    top_worlds: Vec<social_aggregates::TopVisitedWorldRow>,
    best_times: Vec<social_aggregates::BestTimeBucketRow>,
    caveats: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TimeWindowEcho {
    from: Option<String>,
    to: Option<String>,
}

#[cfg(test)]
mod activity_output_tests;
