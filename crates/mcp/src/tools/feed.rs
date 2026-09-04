use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::{DateTime, SecondsFormat, Utc};
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;
use rmcp::{schemars, tool, tool_router};
use serde::{Deserialize, Serialize};
use tokio::sync::Semaphore;
use vrcx_0_contracts::feed::{
    FeedCursorInput, FeedFilter, FeedQueryMode, FeedRowOutput, FeedRowsQueryInput,
};
use vrcx_0_contracts::social_aggregates;

use crate::server::VrcxMcpServer;
use crate::{McpFeedQueryPort, McpInterruptCheck};

use super::common::{
    deserialize_optional_bool, map_application_query_error, require_current_user_id,
    resolve_optional_target_or_result, structured_result, TargetResolutionOutcome,
    TimeWindowParams, WithResolution,
};
use vrcx_0_core::OwnerId;

const DEFAULT_LIMIT: i64 = 20;
const MAX_LIMIT: i64 = 50;
const MAX_QUERY_CHARACTERS: usize = 256;
const MAX_TEXT_FIELD_CHARACTERS: usize = 512;
const MAX_SEARCH_DURATION: Duration = Duration::from_secs(25);
static FRIEND_FEED_SEARCH_PERMIT: Semaphore = Semaphore::const_new(1);

#[tool_router(router = feed_tool_router, vis = "pub(crate)")]
impl VrcxMcpServer {
    #[tool(
        description = "[L1·query] Search observed persisted friend Feed events (GPS, online/offline, status, bio, avatar), newest first. Use for exact event evidence, not current state or aggregate counts. Pass target when known and narrow with eventTypes/timeWindow. A search with neither target nor a lower time bound requires allHistory=true. Returns at most 50 rows plus nextCursor; request another page only when needed. History is incomplete and private locations may be redacted."
    )]
    async fn search_friend_feed(
        &self,
        Parameters(input): Parameters<SearchFriendFeedParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        let (target_user_id, resolved_user) =
            match resolve_optional_target_or_result(&self.runtime, input.target.as_deref())? {
                Some(TargetResolutionOutcome::Resolved(target)) => {
                    (Some(target.user_id), target.echo)
                }
                Some(TargetResolutionOutcome::ToolResult(result)) => return Ok(result),
                None => (None, None),
            };
        let query = input
            .query
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        if query
            .as_deref()
            .is_some_and(|value| value.chars().count() > MAX_QUERY_CHARACTERS)
        {
            return Err(format!(
                "search_friend_feed query must be at most {MAX_QUERY_CHARACTERS} characters"
            ));
        }

        let time_window: social_aggregates::TimeWindow =
            input.time_window.unwrap_or_default().into();
        let date_from = canonical_time_bound(time_window.from)?;
        let date_to = canonical_time_bound(time_window.to)?;
        if !date_from.is_empty() && !date_to.is_empty() && date_from > date_to {
            return Err(
                "search_friend_feed timeWindow.from must not be after timeWindow.to".into(),
            );
        }
        if target_user_id.is_none() && date_from.is_empty() && input.all_history != Some(true) {
            return Err(
                "search_friend_feed global searches require timeWindow with a lower bound; for an explicit all-history request set allHistory=true. Broad all-history searches may be slow on large local databases."
                    .into(),
            );
        }

        let cursor = input
            .cursor
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(parse_feed_cursor)
            .transpose()?;
        let limit = input.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
        let filters = input
            .event_types
            .unwrap_or_default()
            .into_iter()
            .map(FeedFilter::from)
            .collect::<Vec<_>>();
        let permit = FRIEND_FEED_SEARCH_PERMIT
            .acquire()
            .await
            .map_err(|_| "search_friend_feed is unavailable".to_string())?;
        let cancelled = Arc::new(AtomicBool::new(false));
        let cancellation_guard = CancelSearchOnDrop(Arc::clone(&cancelled));
        let interruption = FriendFeedSearchInterruption::new(cancelled);
        let query_interruption = interruption.clone();
        let feed_queries = Arc::clone(&self.runtime.feed_queries);
        let output = tokio::task::spawn_blocking(move || {
            let _permit = permit;
            search_friend_feed_page(
                feed_queries.as_ref(),
                FriendFeedSearchQuery {
                    owner_user_id: owner_user_id.clone(),
                    target_user_id,
                    query: query.unwrap_or_default(),
                    filters,
                    date_from,
                    date_to,
                    limit,
                    cursor,
                },
                Arc::new(move || query_interruption.should_interrupt()),
                &interruption,
            )
        })
        .await
        .map_err(|error| {
            tracing::warn!(%error, "MCP friend Feed search task failed");
            "internal task error while searching local friend Feed data".to_string()
        })??;
        drop(cancellation_guard);

        structured_result(WithResolution {
            inner: output,
            resolved_user,
        })
    }
}

struct CancelSearchOnDrop(Arc<AtomicBool>);

impl Drop for CancelSearchOnDrop {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Release);
    }
}

#[derive(Clone)]
struct FriendFeedSearchInterruption {
    cancelled: Arc<AtomicBool>,
    timed_out: Arc<AtomicBool>,
    deadline: Instant,
}

impl FriendFeedSearchInterruption {
    fn new(cancelled: Arc<AtomicBool>) -> Self {
        Self {
            cancelled,
            timed_out: Arc::new(AtomicBool::new(false)),
            deadline: Instant::now() + MAX_SEARCH_DURATION,
        }
    }

    fn should_interrupt(&self) -> bool {
        if self.cancelled.load(Ordering::Acquire) {
            return true;
        }
        if Instant::now() >= self.deadline {
            self.timed_out.store(true, Ordering::Release);
            return true;
        }
        false
    }

    fn map_query_error(&self, error: vrcx_0_application_core::Error) -> String {
        if self.timed_out.load(Ordering::Acquire) {
            return "search_friend_feed exceeded 25 seconds; narrow target, eventTypes, or timeWindow"
                .into();
        }
        if self.cancelled.load(Ordering::Acquire) {
            return "search_friend_feed was cancelled".into();
        }
        map_application_query_error(error)
    }
}

struct FriendFeedSearchQuery {
    owner_user_id: OwnerId,
    target_user_id: Option<String>,
    query: String,
    filters: Vec<FeedFilter>,
    date_from: String,
    date_to: String,
    limit: i64,
    cursor: Option<FeedCursorInput>,
}

fn search_friend_feed_page(
    feed_queries: &dyn McpFeedQueryPort,
    input: FriendFeedSearchQuery,
    should_interrupt: McpInterruptCheck,
    interruption: &FriendFeedSearchInterruption,
) -> Result<SearchFriendFeedOutput, String> {
    let page_limit = input.limit.saturating_add(1);
    let query_text = input.query.clone();
    let mode = if query_text.is_empty() {
        FeedQueryMode::Lookup
    } else {
        FeedQueryMode::Search
    };
    let mut rows = feed_queries
        .feed_rows_interruptible(
            FeedRowsQueryInput {
                user_id: input.owner_user_id.to_string(),
                mode,
                search: input.query,
                filters: input.filters,
                vip_list: Vec::new(),
                scoped_user_ids: input.target_user_id.into_iter().collect(),
                excluded_user_ids: Vec::new(),
                max_entries: page_limit,
                date_from: input.date_from,
                date_to: input.date_to,
                cursor: input.cursor,
            },
            should_interrupt,
        )
        .map_err(|error| interruption.map_query_error(error))?;
    let truncated = rows.len() > input.limit as usize;
    if truncated {
        rows.truncate(input.limit as usize);
    }
    let next_cursor = if truncated {
        Some(feed_cursor(rows.last().ok_or_else(|| {
            "internal data error while paging local friend Feed data".to_string()
        })?)?)
    } else {
        None
    };
    let rows = rows
        .into_iter()
        .map(|row| SearchFriendFeedRow::from_feed_row(row, &query_text))
        .collect::<Vec<_>>();
    let summary = friend_feed_summary(&rows, truncated);

    Ok(SearchFriendFeedOutput {
        returned_rows: rows.len(),
        rows,
        summary,
        truncated,
        next_cursor,
        caveats: friend_feed_caveats(),
    })
}

fn canonical_time_bound(value: Option<String>) -> Result<String, String> {
    let Some(value) = value else {
        return Ok(String::new());
    };
    DateTime::parse_from_rfc3339(&value)
        .map(|value| {
            value
                .with_timezone(&Utc)
                .to_rfc3339_opts(SecondsFormat::Millis, true)
        })
        .map_err(|error| format!("invalid friend Feed time bound '{value}': {error}"))
}

fn feed_cursor(row: &FeedRowOutput) -> Result<String, String> {
    let created_at = row.created_at.as_deref().filter(|value| !value.is_empty());
    let source_rank = row.source_rank.filter(|value| *value > 0);
    let row_id = row.row_id.filter(|value| *value > 0);
    match (created_at, source_rank, row_id) {
        (Some(created_at), Some(source_rank), Some(row_id)) => {
            Ok(format!("{created_at}|{source_rank}|{row_id}"))
        }
        _ => Err("internal data error while paging local friend Feed data".into()),
    }
}

fn parse_feed_cursor(value: &str) -> Result<FeedCursorInput, String> {
    let Some((prefix, row_id)) = value.rsplit_once('|') else {
        return Err("invalid friend Feed cursor".into());
    };
    let Some((created_at, source_rank)) = prefix.rsplit_once('|') else {
        return Err("invalid friend Feed cursor".into());
    };
    let source_rank = source_rank
        .parse::<i64>()
        .map_err(|_| "invalid friend Feed cursor".to_string())?;
    let row_id = row_id
        .parse::<i64>()
        .map_err(|_| "invalid friend Feed cursor".to_string())?;
    if created_at.trim().is_empty() || source_rank <= 0 || row_id <= 0 {
        return Err("invalid friend Feed cursor".into());
    }
    Ok(FeedCursorInput {
        created_at: created_at.to_string(),
        source_rank,
        row_id,
    })
}

fn friend_feed_summary(rows: &[SearchFriendFeedRow], truncated: bool) -> String {
    if rows.is_empty() {
        return "No matching persisted friend Feed events found.".into();
    }
    let mut counts = BTreeMap::<&str, usize>::new();
    for row in rows {
        *counts.entry(&row.kind).or_default() += 1;
    }
    let breakdown = counts
        .into_iter()
        .map(|(kind, count)| format!("{kind} {count}"))
        .collect::<Vec<_>>()
        .join(", ");
    let more = if truncated {
        " Additional matches are available."
    } else {
        ""
    };
    format!(
        "Returned {} newest matching persisted friend Feed event(s) on this page ({breakdown}).{more}",
        rows.len()
    )
}

fn friend_feed_caveats() -> Vec<String> {
    vec![
        "This is persisted, observer-centered friend Feed history, not the live current state; absence of a row does not prove an event did not happen.".into(),
        "GPS and online/offline locations may be absent or redacted to 'private'; equal 'private' values do not prove the same instance.".into(),
        "Rows are newest-first and page-limited. nextCursor means more matches may exist, not how many.".into(),
        "Oversized historical status or bio fields are clipped to 512 characters per field; contentTruncated marks affected rows.".into(),
        "Returned Feed row fields, including status and bio text, are sent to the configured AI endpoint.".into(),
    ]
}

#[derive(Clone, Copy, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
enum FriendFeedEventTypeParam {
    Gps,
    Status,
    Bio,
    Avatar,
    Online,
    Offline,
}

impl From<FriendFeedEventTypeParam> for FeedFilter {
    fn from(value: FriendFeedEventTypeParam) -> Self {
        match value {
            FriendFeedEventTypeParam::Gps => Self::Gps,
            FriendFeedEventTypeParam::Status => Self::Status,
            FriendFeedEventTypeParam::Bio => Self::Bio,
            FriendFeedEventTypeParam::Avatar => Self::Avatar,
            FriendFeedEventTypeParam::Online => Self::Online,
            FriendFeedEventTypeParam::Offline => Self::Offline,
        }
    }
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct SearchFriendFeedParams {
    /// Literal text in names, locations/worlds/groups, current or previous status/bio, or avatar names. Omit for event- or time-filtered history.
    query: Option<String>,
    /// VRChat user id (usr_...) or display name to scope the search to one friend.
    target: Option<String>,
    /// Event kinds to search. Omit or pass an empty list for every kind.
    event_types: Option<Vec<FriendFeedEventTypeParam>>,
    /// Relative string such as "90d", or an object with RFC3339/shorthand from/to bounds.
    time_window: Option<TimeWindowParams>,
    /// Required for a global search without a lower time bound; acknowledges the potentially slow all-history scan.
    #[serde(default, deserialize_with = "deserialize_optional_bool")]
    all_history: Option<bool>,
    /// Rows per page. Defaults to 20 and is clamped to 1..=50.
    limit: Option<i64>,
    /// Opaque nextCursor from the preceding page. Keep every other search argument unchanged.
    cursor: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchFriendFeedOutput {
    rows: Vec<SearchFriendFeedRow>,
    summary: String,
    returned_rows: usize,
    truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    next_cursor: Option<String>,
    caveats: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchFriendFeedRow {
    created_at: String,
    kind: String,
    user_id: String,
    display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    location: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    world_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    previous_location: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    group_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status_description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    previous_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    previous_status_description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bio: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    previous_bio: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    avatar_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    avatar_visibility: Option<String>,
    content_truncated: bool,
}

impl SearchFriendFeedRow {
    fn from_feed_row(value: FeedRowOutput, query: &str) -> Self {
        let avatar_visibility = match (value.user_id.as_deref(), value.owner_id.as_deref()) {
            (Some(user_id), Some(owner_id)) if user_id == owner_id => Some("private".into()),
            (Some(_), Some(_)) => Some("public".into()),
            _ => None,
        };
        let (status, status_truncated) = bounded_feed_text(value.status, query);
        let (status_description, status_description_truncated) =
            bounded_feed_text(value.status_description, query);
        let (previous_status, previous_status_truncated) =
            bounded_feed_text(value.previous_status, query);
        let (previous_status_description, previous_status_description_truncated) =
            bounded_feed_text(value.previous_status_description, query);
        let (bio, bio_truncated) = bounded_feed_text(value.bio, query);
        let (previous_bio, previous_bio_truncated) = bounded_feed_text(value.previous_bio, query);
        Self {
            created_at: value.created_at.unwrap_or_default(),
            kind: value.r#type.unwrap_or_default(),
            user_id: value.user_id.unwrap_or_default(),
            display_name: value.display_name.unwrap_or_default(),
            location: value.location,
            world_name: value.world_name,
            previous_location: value.previous_location,
            group_name: value.group_name,
            status,
            status_description,
            previous_status,
            previous_status_description,
            bio,
            previous_bio,
            avatar_name: value.avatar_name,
            avatar_visibility,
            content_truncated: status_truncated
                || status_description_truncated
                || previous_status_truncated
                || previous_status_description_truncated
                || bio_truncated
                || previous_bio_truncated,
        }
    }
}

fn bounded_feed_text(value: Option<String>, query: &str) -> (Option<String>, bool) {
    let Some(value) = value else {
        return (None, false);
    };
    if value.chars().count() <= MAX_TEXT_FIELD_CHARACTERS {
        return (Some(value), false);
    }
    let query = query.trim();
    if !query.is_empty() {
        let normalized_value = value.to_lowercase();
        let normalized_query = query.to_lowercase();
        if let Some(match_start) = normalized_value.find(&normalized_query) {
            let match_character = normalized_value[..match_start].chars().count();
            let characters = value.chars().collect::<Vec<_>>();
            let half_window = MAX_TEXT_FIELD_CHARACTERS / 2;
            let start = match_character.saturating_sub(half_window);
            let end = (start + MAX_TEXT_FIELD_CHARACTERS).min(characters.len());
            let start = end.saturating_sub(MAX_TEXT_FIELD_CHARACTERS);
            return (Some(characters[start..end].iter().collect()), true);
        }
    }
    (
        Some(value.chars().take(MAX_TEXT_FIELD_CHARACTERS).collect()),
        true,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn friend_feed_cursor_round_trips_and_rejects_unknown_source_rank() {
        let row = FeedRowOutput {
            row_id: Some(42),
            source_rank: Some(30),
            created_at: Some("2026-08-12T10:00:00Z".into()),
            ..FeedRowOutput::default()
        };

        let encoded = feed_cursor(&row).unwrap();
        let decoded = parse_feed_cursor(&encoded).unwrap();

        assert_eq!(decoded.created_at, "2026-08-12T10:00:00Z");
        assert_eq!(decoded.source_rank, 30);
        assert_eq!(decoded.row_id, 42);
        assert!(parse_feed_cursor("2026-08-12T10:00:00Z|0|42").is_err());
    }

    #[test]
    fn friend_feed_projection_excludes_avatar_urls_and_keeps_visibility() {
        let row = SearchFriendFeedRow::from_feed_row(
            FeedRowOutput {
                user_id: Some("usr_friend".into()),
                owner_id: Some("usr_friend".into()),
                avatar_name: Some("Avatar".into()),
                current_avatar_image_url: Some("https://example.com/full.png".into()),
                current_avatar_thumbnail_image_url: Some("https://example.com/thumb.png".into()),
                ..FeedRowOutput::default()
            },
            "",
        );
        let value = serde_json::to_value(row).unwrap();

        assert_eq!(value["avatarVisibility"], "private");
        assert!(value.get("currentAvatarImageUrl").is_none());
        assert!(value.get("currentAvatarThumbnailImageUrl").is_none());
    }

    #[test]
    fn oversized_feed_text_keeps_the_matching_region_within_the_budget() {
        let value = format!("{}needle{}", "a".repeat(700), "b".repeat(700));

        let (bounded, truncated) = bounded_feed_text(Some(value), "needle");

        let bounded = bounded.unwrap();
        assert!(truncated);
        assert_eq!(bounded.chars().count(), MAX_TEXT_FIELD_CHARACTERS);
        assert!(bounded.contains("needle"));
    }

    #[test]
    fn feed_time_bounds_use_the_persisted_millisecond_format() {
        assert_eq!(
            canonical_time_bound(Some("2026-08-12T10:00:00Z".into())).unwrap(),
            "2026-08-12T10:00:00.000Z"
        );
        assert_eq!(
            canonical_time_bound(Some("2026-08-12T19:00:00+09:00".into())).unwrap(),
            "2026-08-12T10:00:00.000Z"
        );
    }
}
