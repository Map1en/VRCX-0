use std::collections::{HashMap, HashSet};

use chrono::{DateTime, NaiveDateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};

use vrcx_0_contracts::game_log::{SessionLocationSegmentRow, SessionPlayerDurationRow};
use vrcx_0_core::game_log_sessions::{
    build_game_log_sessions, SessionEventInput, SessionEventOut, SessionLocationInput,
    SessionMemberOut, SessionSegmentOut,
};
use vrcx_0_core::text::contains_lowercase_query_case_insensitive;

use super::runtime_state::parse_event_time_ms;
use crate::Result;
use vrcx_0_core::OwnerId;

const DAY_MS: i64 = 86_400_000;
const PLAYER_DURATION_END_GRACE_MS: i64 = 60_000;
const SESSION_GLOBAL_SEARCH_INITIAL_LOCATIONS: i64 = 500;
// Authoritative defaults when the caller passes a non-positive value (0 = unset).
// The frontend reads config with a 0 sentinel and lets the backend own these.
const DEFAULT_MAX_TABLE_SIZE: i64 = 500;
const DEFAULT_SEARCH_LIMIT: i64 = 50_000;
const GAME_LOG_FILTER_TYPES: [&str; 9] = [
    "Location",
    "OnPlayerJoined",
    "OnPlayerLeft",
    "PortalSpawn",
    "VideoPlay",
    "Event",
    "External",
    "StringLoad",
    "ImageLoad",
];
const SESSION_EVENT_FILTER_TYPES: [&str; 3] = ["OnPlayerJoined", "OnPlayerLeft", "VideoPlay"];

#[derive(Clone, Debug, Default, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GameLogSessionsQueryInput {
    #[serde(default)]
    pub search: String,
    #[serde(default)]
    pub filters: Vec<String>,
    #[serde(default)]
    pub favorite_user_ids: Vec<String>,
    #[serde(default)]
    pub date_from: String,
    #[serde(default)]
    pub date_to: String,
    #[serde(default)]
    pub limit: i64,
    #[serde(default)]
    pub max_table_size: i64,
    #[serde(default)]
    pub search_limit: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GameLogSessionMemberDto {
    pub display_name: String,
    pub user_id: String,
    #[serde(rename = "created_at")]
    pub created_at: String,
    pub is_favorite: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GameLogSessionEventDto {
    #[serde(rename = "type")]
    pub type_: String,
    #[serde(rename = "created_at")]
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub row_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub play_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_favorite: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub members: Option<Vec<GameLogSessionMemberDto>>,
}

#[derive(Clone, Debug, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GameLogSessionPlayerDurationRowDto {
    pub display_name: String,
    pub user_id: String,
    pub time: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GameLogSessionDto {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<i64>,
    #[serde(rename = "created_at")]
    pub created_at: String,
    pub location: String,
    pub world_id: String,
    pub world_name: String,
    pub group_name: String,
    pub duration: Option<i64>,
    pub player_duration_rows: Vec<GameLogSessionPlayerDurationRowDto>,
    pub remote: bool,
    pub events: Vec<GameLogSessionEventDto>,
}

impl From<SessionPlayerDurationRow> for GameLogSessionPlayerDurationRowDto {
    fn from(row: SessionPlayerDurationRow) -> Self {
        Self {
            display_name: row.display_name,
            user_id: row.user_id,
            time: row.time,
        }
    }
}

impl From<SessionMemberOut> for GameLogSessionMemberDto {
    fn from(member: SessionMemberOut) -> Self {
        Self {
            display_name: member.display_name,
            user_id: member.user_id,
            created_at: member.created_at,
            is_favorite: member.is_favorite,
        }
    }
}

impl From<SessionEventOut> for GameLogSessionEventDto {
    fn from(event: SessionEventOut) -> Self {
        Self {
            type_: event.type_,
            created_at: event.created_at,
            row_id: event.row_id,
            user_id: event.user_id,
            display_name: event.display_name,
            location: event.location,
            video_url: event.video_url,
            video_name: event.video_name,
            video_id: event.video_id,
            play_count: event.play_count,
            is_favorite: event.is_favorite,
            count: event.count,
            members: event
                .members
                .map(|members| members.into_iter().map(Into::into).collect()),
        }
    }
}

impl GameLogSessionDto {
    fn from_segment(
        segment: SessionSegmentOut,
        player_duration_rows: Vec<GameLogSessionPlayerDurationRowDto>,
    ) -> Self {
        Self {
            id: segment.id,
            created_at: segment.created_at,
            location: segment.location,
            world_id: segment.world_id,
            world_name: segment.world_name,
            group_name: segment.group_name,
            duration: segment.duration,
            player_duration_rows,
            remote: segment.remote,
            events: segment.events.into_iter().map(Into::into).collect(),
        }
    }
}

fn parse_session_epoch(value: &str) -> i64 {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return 0;
    }
    if let Some(ms) = parse_event_time_ms(trimmed) {
        return ms;
    }
    for format in [
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
    ] {
        if let Ok(parsed) = NaiveDateTime::parse_from_str(trimmed, format) {
            return parsed.and_utc().timestamp_millis();
        }
    }
    0
}

fn epoch_to_iso(ms: i64) -> String {
    DateTime::from_timestamp_millis(ms)
        .map(|value| value.to_rfc3339_opts(SecondsFormat::Millis, true))
        .unwrap_or_default()
}

fn normalize_filters(filters: &[String]) -> Vec<String> {
    let mut normalized: Vec<String> = Vec::new();
    for filter in filters {
        if GAME_LOG_FILTER_TYPES.contains(&filter.as_str()) && !normalized.contains(filter) {
            normalized.push(filter.clone());
        }
    }
    normalized
}

fn normalize_favorites(favorite_user_ids: &[String]) -> HashSet<String> {
    favorite_user_ids
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect()
}

fn normalize_limit(limit: i64) -> i64 {
    if limit <= 0 {
        25
    } else {
        limit.min(1000)
    }
}

fn is_favorite(favorite_user_ids: &HashSet<String>, user_id: &str) -> bool {
    let trimmed = user_id.trim();
    !trimmed.is_empty() && favorite_user_ids.contains(trimmed)
}

fn resolve_session_fetch_limit(
    limit: i64,
    has_filtering: bool,
    max_table_size: i64,
    search_limit: i64,
) -> i64 {
    if !has_filtering {
        return limit;
    }
    let ceiling = limit.max(search_limit.min(2000));
    limit.max(max_table_size.min(ceiling))
}

fn build_location_inputs(rows: &[SessionLocationSegmentRow]) -> Vec<SessionLocationInput> {
    rows.iter()
        .map(|row| SessionLocationInput {
            epoch: parse_session_epoch(&row.created_at),
            sort_id: row.id,
            id: Some(row.id),
            created_at: row.created_at.clone(),
            location: row.location.clone(),
            world_id: row.world_id.clone(),
            world_name: row.world_name.clone(),
            group_name: row.group_name.clone(),
            duration: if row.time != 0 { Some(row.time) } else { None },
        })
        .collect()
}

fn load_session_events(
    store: &dyn crate::GameStateStore,
    owner_user_id: &OwnerId,
    locations: &[SessionLocationInput],
    favorite_user_ids: &HashSet<String>,
) -> Result<Vec<SessionEventInput>> {
    if locations.is_empty() {
        return Ok(Vec::new());
    }

    let epochs: Vec<i64> = locations
        .iter()
        .map(|location| location.epoch)
        .filter(|epoch| *epoch > 0)
        .collect();
    let (min_epoch, max_epoch) = if epochs.is_empty() {
        let now = Utc::now().timestamp_millis();
        (now, now)
    } else {
        (
            epochs.iter().copied().min().unwrap_or_default(),
            epochs.iter().copied().max().unwrap_or_default(),
        )
    };

    let after_date = epoch_to_iso(min_epoch - DAY_MS);
    let before_date = epoch_to_iso(max_epoch + DAY_MS);
    let rows = store.session_events_for_range(owner_user_id, &after_date, &before_date)?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let favorite = is_favorite(favorite_user_ids, &row.user_id);
            SessionEventInput {
                epoch: parse_session_epoch(&row.created_at),
                sort_id: row.row_id,
                row_id: Some(row.row_id),
                type_: row.event_type,
                created_at: row.created_at,
                display_name: row.display_name,
                user_id: row.user_id,
                location: row.location,
                video_url: row.video_url,
                video_name: row.video_name,
                video_id: row.video_id,
                is_favorite: favorite,
            }
        })
        .collect())
}

fn session_event_filter_type(type_: &str) -> &str {
    match type_ {
        "JoinGroup" => "OnPlayerJoined",
        "LeftGroup" => "OnPlayerLeft",
        other => other,
    }
}

fn contains_ci(value: &Option<String>, query: &str) -> bool {
    value
        .as_deref()
        .is_some_and(|value| contains_lowercase_query_case_insensitive(value, query))
}

fn member_matches_search(member: &SessionMemberOut, query: &str) -> bool {
    contains_lowercase_query_case_insensitive(&member.display_name, query)
        || contains_lowercase_query_case_insensitive(&member.user_id, query)
}

// Retain only members matching `pred`, updating `count`; drop the event (None)
// when it has no members or none survive. Consumes the event so kept events move
// through untouched instead of being cloned.
fn keep_members(
    mut event: SessionEventOut,
    pred: impl Fn(&SessionMemberOut) -> bool,
) -> Option<SessionEventOut> {
    let kept: Vec<SessionMemberOut> = event.members.take()?.into_iter().filter(pred).collect();
    if kept.is_empty() {
        return None;
    }
    event.count = Some(kept.len() as i64);
    event.members = Some(kept);
    Some(event)
}

fn filter_event_by_favorite(
    event: SessionEventOut,
    favorite_user_ids: &HashSet<String>,
) -> Option<SessionEventOut> {
    if favorite_user_ids.is_empty() || event.type_ == "VideoPlay" {
        return Some(event);
    }
    if let Some(user_id) = &event.user_id {
        if is_favorite(favorite_user_ids, user_id) {
            return Some(event);
        }
    }
    keep_members(event, |member| {
        is_favorite(favorite_user_ids, &member.user_id)
    })
}

fn filter_event_by_search(event: SessionEventOut, query: &str) -> Option<SessionEventOut> {
    if query.is_empty() {
        return Some(event);
    }
    let value_matches = contains_lowercase_query_case_insensitive(&event.type_, query)
        || contains_ci(&event.display_name, query)
        || contains_ci(&event.user_id, query)
        || contains_ci(&event.video_name, query)
        || contains_ci(&event.video_url, query)
        || contains_ci(&event.video_id, query);
    if value_matches {
        return Some(event);
    }
    keep_members(event, |member| member_matches_search(member, query))
}

fn filter_session_events(
    events: Vec<SessionEventOut>,
    event_filters: &[String],
    favorite_user_ids: &HashSet<String>,
    search_query: &str,
) -> Vec<SessionEventOut> {
    let mut filtered = Vec::new();
    for event in events {
        if !event_filters.is_empty()
            && !event_filters
                .iter()
                .any(|filter| filter == session_event_filter_type(&event.type_))
        {
            continue;
        }
        let by_favorite = match filter_event_by_favorite(event, favorite_user_ids) {
            Some(event) => event,
            None => continue,
        };
        let by_search = match filter_event_by_search(by_favorite, search_query) {
            Some(event) => event,
            None => continue,
        };
        filtered.push(by_search);
    }
    filtered
}

fn header_matches_search(segment: &SessionSegmentOut, query: &str) -> bool {
    if query.is_empty() {
        return true;
    }
    [
        &segment.created_at,
        &segment.location,
        &segment.world_id,
        &segment.world_name,
        &segment.group_name,
    ]
    .iter()
    .any(|value| contains_lowercase_query_case_insensitive(value, query))
}

fn filter_sessions(
    segments: Vec<SessionSegmentOut>,
    filters: &[String],
    favorite_user_ids: &HashSet<String>,
    search: &str,
) -> Vec<SessionSegmentOut> {
    let search_query = search.trim().to_lowercase();
    let has_location_filter = filters.iter().any(|filter| filter == "Location");
    let event_filters: Vec<String> = filters
        .iter()
        .filter(|filter| SESSION_EVENT_FILTER_TYPES.contains(&filter.as_str()))
        .cloned()
        .collect();
    let has_unsupported_only_filter =
        !filters.is_empty() && !has_location_filter && event_filters.is_empty();
    if has_unsupported_only_filter {
        return Vec::new();
    }

    let mut result = Vec::new();
    for mut segment in segments {
        let header_matches = header_matches_search(&segment, &search_query);
        let event_search = if header_matches {
            ""
        } else {
            search_query.as_str()
        };
        let next_events = filter_session_events(
            std::mem::take(&mut segment.events),
            &event_filters,
            favorite_user_ids,
            event_search,
        );
        let matches_filter = filters.is_empty() || has_location_filter || !next_events.is_empty();
        let matches_favorites = favorite_user_ids.is_empty() || !next_events.is_empty();
        let matches_search = search_query.is_empty() || header_matches || !next_events.is_empty();

        if matches_filter && matches_favorites && matches_search {
            segment.events = next_events;
            result.push(segment);
        }
    }
    result
}

pub fn game_log_sessions_query(
    store: &dyn crate::GameStateStore,
    owner_user_id: &OwnerId,
    input: GameLogSessionsQueryInput,
) -> Result<Vec<GameLogSessionDto>> {
    let search = input.search.trim().to_string();
    let filters = normalize_filters(&input.filters);
    let favorite_user_ids = normalize_favorites(&input.favorite_user_ids);
    let limit = normalize_limit(input.limit);
    let max_table_size = if input.max_table_size > 0 {
        input.max_table_size
    } else {
        DEFAULT_MAX_TABLE_SIZE
    };
    let search_limit = if input.search_limit > 0 {
        input.search_limit
    } else {
        DEFAULT_SEARCH_LIMIT
    };
    let date_from = input.date_from.trim().to_string();
    let date_to = input.date_to.trim().to_string();

    let has_filtering = !search.is_empty() || !filters.is_empty() || !favorite_user_ids.is_empty();
    let fetch_limit =
        resolve_session_fetch_limit(limit, has_filtering, max_table_size, search_limit);

    let segments = if !search.is_empty() && date_from.is_empty() && date_to.is_empty() {
        let fetch_count = SESSION_GLOBAL_SEARCH_INITIAL_LOCATIONS + 1;
        let mut all_locations: Vec<SessionLocationInput> = Vec::new();
        let mut all_events: Vec<SessionEventInput> = Vec::new();
        let mut before_id: Option<i64> = None;
        let mut has_more = true;
        let mut accumulated_locations: i64 = 0;
        let mut latest: Vec<SessionSegmentOut> = Vec::new();

        // Rebuild sessions over the whole accumulated set each round (O(n^2)):
        // this mirrors the frontend's incremental "pull until `limit` filtered
        // rows" convergence and must not be flattened into a single build pass.
        // Bounded by `search_limit` (locations scanned) and `limit` (rows kept).
        while has_more && (latest.len() as i64) < limit && accumulated_locations < search_limit {
            let batch = store.session_location_segments(owner_user_id, before_id, fetch_count)?;
            if batch.is_empty() {
                break;
            }
            let has_extra_tail = batch.len() as i64 >= fetch_count;
            let effective = if has_extra_tail {
                &batch[..batch.len() - 1]
            } else {
                &batch[..]
            };
            if effective.is_empty() {
                break;
            }

            let location_inputs = build_location_inputs(effective);
            let batch_events =
                load_session_events(store, owner_user_id, &location_inputs, &favorite_user_ids)?;
            before_id = effective.last().map(|row| row.id);
            accumulated_locations += effective.len() as i64;
            all_locations.extend(location_inputs);
            all_events.extend(batch_events);
            has_more = has_extra_tail && accumulated_locations < search_limit;

            let built = build_game_log_sessions(&all_locations, &all_events);
            latest = filter_sessions(built, &filters, &favorite_user_ids, &search);
            latest.truncate(limit as usize);
        }
        latest
    } else {
        let locations = if !date_from.is_empty() || !date_to.is_empty() {
            let from = if date_from.is_empty() {
                "1970-01-01T00:00:00.000Z".to_string()
            } else {
                date_from
            };
            let to = if date_to.is_empty() {
                epoch_to_iso(Utc::now().timestamp_millis())
            } else {
                date_to
            };
            store.session_location_segments_by_date_range(owner_user_id, &from, &to, fetch_limit)?
        } else {
            store.session_location_segments(owner_user_id, None, fetch_limit)?
        };
        if locations.is_empty() {
            return Ok(Vec::new());
        }

        let location_inputs = build_location_inputs(&locations);
        let events =
            load_session_events(store, owner_user_id, &location_inputs, &favorite_user_ids)?;
        let built = build_game_log_sessions(&location_inputs, &events);
        let mut filtered = filter_sessions(built, &filters, &favorite_user_ids, &search);
        filtered.truncate(limit as usize);
        filtered
    };

    let locations = segments
        .iter()
        .map(|segment| segment.location.clone())
        .collect::<Vec<_>>();
    let duration_rows = store
        .session_player_duration_rows(owner_user_id, &locations)
        .unwrap_or_default();
    let player_duration_rows = assign_player_duration_rows(&segments, duration_rows);

    Ok(segments
        .into_iter()
        .zip(player_duration_rows)
        .map(|(segment, rows)| GameLogSessionDto::from_segment(segment, rows))
        .collect())
}

struct SegmentWindow {
    index: usize,
    start: i64,
    end: Option<i64>,
}

fn assign_player_duration_rows(
    segments: &[SessionSegmentOut],
    rows: Vec<SessionPlayerDurationRow>,
) -> Vec<Vec<GameLogSessionPlayerDurationRowDto>> {
    let mut windows_by_location: HashMap<&str, Vec<SegmentWindow>> = HashMap::new();
    for (index, segment) in segments.iter().enumerate() {
        let start = parse_session_epoch(&segment.created_at);
        if start <= 0 {
            continue;
        }
        let end = segment
            .duration
            .filter(|duration| *duration > 0)
            .map(|duration| start + duration + PLAYER_DURATION_END_GRACE_MS);
        windows_by_location
            .entry(segment.location.as_str())
            .or_default()
            .push(SegmentWindow { index, start, end });
    }
    for windows in windows_by_location.values_mut() {
        windows.sort_by_key(|window| window.start);
    }

    let mut assigned = vec![Vec::new(); segments.len()];
    for row in rows {
        let Some(windows) = windows_by_location.get(row.location.as_str()) else {
            continue;
        };
        let epoch = parse_session_epoch(&row.created_at);
        let position = windows.partition_point(|window| window.start <= epoch);
        let Some(window) = windows[..position].last() else {
            continue;
        };
        if window.end.is_none_or(|end| epoch <= end) {
            assigned[window.index].push(row.into());
        }
    }
    assigned
}

#[cfg(test)]
mod tests;
