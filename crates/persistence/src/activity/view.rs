use serde_json::{json, Value};
use vrcx_0_core::activity_heatmap::{
    activity_normalize_config, activity_peak_indices_from_buckets, compute_activity_view,
    compute_overlap_view, overlap_best_indices_from_buckets, overlap_normalize_config,
    ExcludeHours, OverlapViewOptions,
};
use vrcx_0_core::activity_sessions::{sessions_from_presence, ActivitySession, PresenceKind};

use crate::common::{normalize_text, value_as_i64};
use crate::database::DatabaseService;
use crate::Error;

use super::repository::{
    activity_bucket_cache_get, activity_bucket_cache_upsert,
    activity_friend_presence_first_created_at, activity_friend_presence_last_created_at,
    activity_friend_presence_slice, activity_friend_status_distribution, activity_iso_from_ms,
    activity_self_sessions_refresh_auto, activity_self_source_first_created_at,
    parse_activity_time_ms,
};
use super::types::{
    ActivityBucketCacheInput, ActivityBucketCacheOutput, ActivityBucketCacheQueryInput,
    ActivityFriendPresenceSliceInput, ActivityOverlapViewBuildInput, ActivityOverlapViewOutput,
    ActivitySelfSessionsRefreshOutput, ActivityStatusDistributionOutput, ActivityViewBuildInput,
    ActivityViewKind, ActivityViewOutput,
};

const BUCKET_COUNT: usize = 168;
const DEFAULT_MAX_SESSION_MS: i64 = 8 * 60 * 60 * 1000;
const DAY_MS: i64 = 86_400_000;
const ACTIVITY_MAX_RANGE_DAYS: i64 = 3650;
const ACTIVITY_ALL_FALLBACK_RANGE_DAYS: i64 = 30;

pub fn activity_view_build(
    db: &DatabaseService,
    input: ActivityViewBuildInput,
) -> Result<ActivityViewOutput, Error> {
    let owner_user_id = normalize_owner_user_id(&input.owner_user_id, &input.target_user_id);
    let target_user_id = normalize_text(input.target_user_id);
    if owner_user_id.is_empty() || target_user_id.is_empty() {
        return Ok(empty_activity_output(String::new(), input.now_ms));
    }
    let status_distribution = if input.is_self {
        ActivityStatusDistributionOutput::default()
    } else {
        activity_friend_status_distribution(
            db,
            &owner_user_id,
            &target_user_id,
            input.range_days,
            input.now_ms,
        )?
    };
    let cache_range_days = cache_range_days(input.range_days);
    let effective_range_days = resolve_activity_effective_days(
        db,
        &owner_user_id,
        &target_user_id,
        input.is_self,
        input.range_days,
        input.now_ms,
    )?;
    let target_cache_id = if input.is_self {
        String::new()
    } else {
        target_user_id.clone()
    };

    if !input.force_refresh && !input.is_self {
        let cursor = activity_friend_presence_last_created_at(db, &owner_user_id, &target_user_id)?;
        if let Some(mut cached) = cached_activity_output(
            db,
            &owner_user_id,
            &target_cache_id,
            cache_range_days,
            &cursor,
        )? {
            cached.status_distribution = status_distribution.clone();
            return Ok(cached);
        }
    }

    let source = if input.is_self {
        self_activity_source(
            db,
            &owner_user_id,
            effective_range_days,
            input.now_ms,
            input.force_refresh,
        )?
    } else {
        friend_activity_source(
            db,
            &owner_user_id,
            &target_user_id,
            effective_range_days,
            input.now_ms,
        )?
    };

    if !input.force_refresh && input.is_self {
        if let Some(mut cached) = cached_activity_output(
            db,
            &owner_user_id,
            &target_cache_id,
            cache_range_days,
            &source.cursor,
        )? {
            cached.status_distribution = status_distribution.clone();
            return Ok(cached);
        }
    }

    let view = compute_activity_view(
        &source.sessions,
        effective_range_days,
        input.now_ms,
        input.utc_offset_minutes,
        &activity_normalize_config(input.is_self, effective_range_days),
        DEFAULT_MAX_SESSION_MS,
    );
    let built_at = activity_iso_from_ms(input.now_ms);
    let output = ActivityViewOutput {
        raw_buckets: view.raw_buckets,
        normalized_buckets: view.normalized_buckets,
        peak_day_index: view.peak_day_index,
        peak_hour_start: view.peak_hour_start,
        peak_hour_end: view.peak_hour_end,
        filtered_event_count: view.filtered_event_count as i64,
        has_any_data: source.has_any_data,
        status_distribution,
        built_from_cursor: source.cursor,
        built_at,
    };
    upsert_activity_output_cache(
        db,
        &owner_user_id,
        &target_cache_id,
        cache_range_days,
        &output,
    )?;
    Ok(output)
}

pub fn activity_overlap_view_build(
    db: &DatabaseService,
    input: ActivityOverlapViewBuildInput,
) -> Result<ActivityOverlapViewOutput, Error> {
    let owner_user_id = normalize_owner_user_id(&input.owner_user_id, &input.current_user_id);
    let current_user_id = normalize_text(input.current_user_id);
    let target_user_id = normalize_text(input.target_user_id);
    if owner_user_id.is_empty() || current_user_id.is_empty() || target_user_id.is_empty() {
        return Ok(empty_overlap_output(String::new(), input.now_ms));
    }
    let cache_range_days = cache_range_days(input.range_days);
    let effective_range_days = resolve_overlap_effective_days(
        db,
        &owner_user_id,
        &current_user_id,
        &target_user_id,
        input.range_days,
        input.now_ms,
    )?;
    let self_source = self_activity_source(
        db,
        &current_user_id,
        effective_range_days,
        input.now_ms,
        input.force_refresh,
    )?;
    let exclude_hours = exclude_hours_from_input(input.exclude_start_hour, input.exclude_end_hour);
    let exclude_key = exclude_key(exclude_hours);

    if !input.force_refresh {
        let target_cursor =
            activity_friend_presence_last_created_at(db, &owner_user_id, &target_user_id)?;
        let cursor = format!("{}|{}", self_source.cursor, target_cursor);
        if let Some(cached) = cached_overlap_output(
            db,
            &owner_user_id,
            &target_user_id,
            cache_range_days,
            &exclude_key,
            &cursor,
        )? {
            return Ok(cached);
        }
    }

    let target_source = friend_activity_source(
        db,
        &owner_user_id,
        &target_user_id,
        effective_range_days,
        input.now_ms,
    )?;
    let cursor = format!("{}|{}", self_source.cursor, target_source.cursor);

    let view = compute_overlap_view(
        &self_source.sessions,
        &target_source.sessions,
        OverlapViewOptions {
            range_days: effective_range_days,
            now_ms: input.now_ms,
            offset_minutes: input.utc_offset_minutes,
            exclude_hours,
            config: overlap_normalize_config(effective_range_days),
            max_session_ms: DEFAULT_MAX_SESSION_MS,
        },
    );
    let built_at = activity_iso_from_ms(input.now_ms);
    let has_overlap_data = view.raw_buckets.iter().any(|value| *value > 0.0);
    let output = ActivityOverlapViewOutput {
        raw_buckets: view.raw_buckets,
        normalized_buckets: view.normalized_buckets,
        overlap_percent: view.overlap_percent,
        best_day_index: view.best_day_index,
        best_hour_start: view.best_hour_start,
        best_hour_end: view.best_hour_end,
        has_overlap_data,
        built_from_cursor: cursor,
        built_at,
    };
    upsert_overlap_output_cache(
        db,
        &owner_user_id,
        &target_user_id,
        cache_range_days,
        &exclude_key,
        &output,
    )?;
    Ok(output)
}

pub fn activity_self_sessions_warmup(
    db: &DatabaseService,
    user_id: String,
    range_days: i64,
    now_ms: Option<i64>,
) -> Result<ActivitySelfSessionsRefreshOutput, Error> {
    refresh_self_activity_sessions(db, &user_id, range_days, now_ms, false)
}

struct ActivitySource {
    sessions: Vec<ActivitySession>,
    cursor: String,
    has_any_data: bool,
}

fn self_activity_source(
    db: &DatabaseService,
    user_id: &str,
    range_days: i64,
    now_ms: i64,
    force_refresh: bool,
) -> Result<ActivitySource, Error> {
    let refreshed =
        refresh_self_activity_sessions(db, user_id, range_days, Some(now_ms), force_refresh)?;
    Ok(ActivitySource {
        has_any_data: !refreshed.sessions.is_empty(),
        cursor: refreshed.sync.source_last_created_at,
        sessions: refreshed
            .sessions
            .into_iter()
            .map(|session| ActivitySession {
                start: session.start,
                end: session.end,
                is_open_tail: session.is_open_tail,
                source_revision: session.source_revision,
            })
            .collect(),
    })
}

fn refresh_self_activity_sessions(
    db: &DatabaseService,
    user_id: &str,
    range_days: i64,
    now_ms: Option<i64>,
    force_refresh: bool,
) -> Result<ActivitySelfSessionsRefreshOutput, Error> {
    activity_self_sessions_refresh_auto(db, user_id, range_days, now_ms, force_refresh)
}

fn friend_activity_source(
    db: &DatabaseService,
    owner_user_id: &str,
    target_user_id: &str,
    range_days: i64,
    now_ms: i64,
) -> Result<ActivitySource, Error> {
    let from_date_iso = activity_iso_from_ms(now_ms - range_days * DAY_MS);
    let rows = activity_friend_presence_slice(
        db,
        ActivityFriendPresenceSliceInput {
            owner_user_id: owner_user_id.to_string(),
            user_id: target_user_id.to_string(),
            from_date_iso,
            to_date_iso: String::new(),
        },
    )?;
    let cursor = rows
        .last()
        .map(|row| row.created_at.clone())
        .unwrap_or_default();
    let events: Vec<(i64, PresenceKind)> = rows
        .iter()
        .filter_map(|row| {
            let kind = match row.r#type.as_str() {
                "Online" => PresenceKind::Online,
                "Offline" => PresenceKind::Offline,
                _ => PresenceKind::Other,
            };
            parse_activity_time_ms(&row.created_at).map(|created_at_ms| (created_at_ms, kind))
        })
        .collect();
    let (_, mut sessions) = sessions_from_presence(&events, None);
    for session in &mut sessions {
        session.source_revision = cursor.clone();
    }
    Ok(ActivitySource {
        has_any_data: !sessions.is_empty(),
        sessions,
        cursor,
    })
}

fn cached_activity_output(
    db: &DatabaseService,
    owner_user_id: &str,
    target_user_id: &str,
    range_days: i64,
    cursor: &str,
) -> Result<Option<ActivityViewOutput>, Error> {
    let Some(cached) = matching_cached_bucket(
        db,
        owner_user_id,
        target_user_id,
        range_days,
        ActivityViewKind::Activity,
        "",
        cursor,
    )?
    else {
        return Ok(None);
    };
    let Some(has_any_data) = summary_bool(&cached.summary, "hasAnyData") else {
        return Ok(None);
    };
    let Some((raw_buckets, normalized_buckets)) = cached_bucket_values(&cached) else {
        return Ok(None);
    };
    let derived = activity_peak_indices_from_buckets(&raw_buckets);
    let output = ActivityViewOutput {
        raw_buckets,
        normalized_buckets,
        peak_day_index: summary_i32(&cached.summary, "peakDayIndex")
            .unwrap_or(derived.peak_day_index),
        peak_hour_start: summary_i32(&cached.summary, "peakHourStart")
            .unwrap_or(derived.peak_hour_start),
        peak_hour_end: summary_i32(&cached.summary, "peakHourEnd").unwrap_or(derived.peak_hour_end),
        filtered_event_count: summary_i64(&cached.summary, "filteredEventCount").unwrap_or(0),
        has_any_data,
        status_distribution: ActivityStatusDistributionOutput::default(),
        built_from_cursor: cached.built_from_cursor,
        built_at: cached.built_at,
    };
    Ok(Some(output))
}

fn cached_overlap_output(
    db: &DatabaseService,
    owner_user_id: &str,
    target_user_id: &str,
    range_days: i64,
    exclude_key: &str,
    cursor: &str,
) -> Result<Option<ActivityOverlapViewOutput>, Error> {
    let Some(cached) = matching_cached_bucket(
        db,
        owner_user_id,
        target_user_id,
        range_days,
        ActivityViewKind::Overlap,
        exclude_key,
        cursor,
    )?
    else {
        return Ok(None);
    };
    let Some((raw_buckets, normalized_buckets)) = cached_bucket_values(&cached) else {
        return Ok(None);
    };
    let overlap_percent = match summary_i32(&cached.summary, "overlapPercent") {
        Some(value) => value,
        None => return Ok(None),
    };
    let derived = overlap_best_indices_from_buckets(&raw_buckets);
    let has_overlap_data = raw_buckets.iter().any(|value| *value > 0.0);
    Ok(Some(ActivityOverlapViewOutput {
        raw_buckets,
        normalized_buckets,
        overlap_percent,
        best_day_index: summary_i32(&cached.summary, "bestDayIndex")
            .unwrap_or(derived.best_day_index),
        best_hour_start: summary_i32(&cached.summary, "bestHourStart")
            .unwrap_or(derived.best_hour_start),
        best_hour_end: summary_i32(&cached.summary, "bestHourEnd").unwrap_or(derived.best_hour_end),
        has_overlap_data,
        built_from_cursor: cached.built_from_cursor,
        built_at: cached.built_at,
    }))
}

fn upsert_activity_output_cache(
    db: &DatabaseService,
    owner_user_id: &str,
    target_user_id: &str,
    range_days: i64,
    output: &ActivityViewOutput,
) -> Result<(), Error> {
    activity_bucket_cache_upsert(
        db,
        ActivityBucketCacheInput {
            owner_user_id: owner_user_id.to_string(),
            target_user_id: target_user_id.to_string(),
            range_days: json!(range_days),
            view_kind: ActivityViewKind::Activity,
            exclude_key: String::new(),
            bucket_version: json!(1),
            built_from_cursor: output.built_from_cursor.clone(),
            raw_buckets: json!(output.raw_buckets),
            normalized_buckets: json!(output.normalized_buckets),
            summary: json!({
                "filteredEventCount": output.filtered_event_count,
                "peakDayIndex": output.peak_day_index,
                "peakHourStart": output.peak_hour_start,
                "peakHourEnd": output.peak_hour_end,
                "hasAnyData": output.has_any_data
            }),
            built_at: output.built_at.clone(),
        },
    )
}

fn upsert_overlap_output_cache(
    db: &DatabaseService,
    owner_user_id: &str,
    target_user_id: &str,
    range_days: i64,
    exclude_key: &str,
    output: &ActivityOverlapViewOutput,
) -> Result<(), Error> {
    activity_bucket_cache_upsert(
        db,
        ActivityBucketCacheInput {
            owner_user_id: owner_user_id.to_string(),
            target_user_id: target_user_id.to_string(),
            range_days: json!(range_days),
            view_kind: ActivityViewKind::Overlap,
            exclude_key: exclude_key.to_string(),
            bucket_version: json!(1),
            built_from_cursor: output.built_from_cursor.clone(),
            raw_buckets: json!(output.raw_buckets),
            normalized_buckets: json!(output.normalized_buckets),
            summary: json!({
                "overlapPercent": output.overlap_percent,
                "bestDayIndex": output.best_day_index,
                "bestHourStart": output.best_hour_start,
                "bestHourEnd": output.best_hour_end
            }),
            built_at: output.built_at.clone(),
        },
    )
}

fn empty_activity_output(cursor: String, now_ms: i64) -> ActivityViewOutput {
    ActivityViewOutput {
        raw_buckets: empty_buckets(),
        normalized_buckets: empty_buckets(),
        peak_day_index: -1,
        peak_hour_start: -1,
        peak_hour_end: -1,
        filtered_event_count: 0,
        has_any_data: false,
        status_distribution: ActivityStatusDistributionOutput::default(),
        built_from_cursor: cursor,
        built_at: activity_iso_from_ms(now_ms),
    }
}

fn empty_overlap_output(cursor: String, now_ms: i64) -> ActivityOverlapViewOutput {
    ActivityOverlapViewOutput {
        raw_buckets: empty_buckets(),
        normalized_buckets: empty_buckets(),
        overlap_percent: 0,
        best_day_index: -1,
        best_hour_start: -1,
        best_hour_end: -1,
        has_overlap_data: false,
        built_from_cursor: cursor,
        built_at: activity_iso_from_ms(now_ms),
    }
}

fn matching_cached_bucket(
    db: &DatabaseService,
    owner_user_id: &str,
    target_user_id: &str,
    range_days: i64,
    view_kind: ActivityViewKind,
    exclude_key: &str,
    cursor: &str,
) -> Result<Option<ActivityBucketCacheOutput>, Error> {
    let cached = activity_bucket_cache_get(
        db,
        ActivityBucketCacheQueryInput {
            owner_user_id: owner_user_id.to_string(),
            target_user_id: target_user_id.to_string(),
            range_days: json!(range_days),
            view_kind,
            exclude_key: exclude_key.to_string(),
        },
    )?;
    Ok(cached.filter(|entry| entry.built_from_cursor == cursor))
}

fn cached_bucket_values(cached: &ActivityBucketCacheOutput) -> Option<(Vec<f64>, Vec<f64>)> {
    let raw_buckets = value_to_f64_vec(&cached.raw_buckets);
    let normalized_buckets = value_to_f64_vec(&cached.normalized_buckets);
    (raw_buckets.len() == BUCKET_COUNT && normalized_buckets.len() == BUCKET_COUNT)
        .then_some((raw_buckets, normalized_buckets))
}

fn empty_buckets() -> Vec<f64> {
    vec![0.0; BUCKET_COUNT]
}

fn normalize_owner_user_id(owner_user_id: &str, fallback_user_id: &str) -> String {
    let owner_user_id = normalize_text(owner_user_id);
    if owner_user_id.is_empty() {
        normalize_text(fallback_user_id)
    } else {
        owner_user_id
    }
}

fn cache_range_days(range_days: i64) -> i64 {
    if range_days > 0 {
        range_days.clamp(1, ACTIVITY_MAX_RANGE_DAYS)
    } else {
        0
    }
}

fn resolve_activity_effective_days(
    db: &DatabaseService,
    owner_user_id: &str,
    target_user_id: &str,
    is_self: bool,
    range_days: i64,
    now_ms: i64,
) -> Result<i64, Error> {
    if range_days > 0 {
        return Ok(range_days.clamp(1, ACTIVITY_MAX_RANGE_DAYS));
    }
    let first_created_at = if is_self {
        activity_self_source_first_created_at(db, owner_user_id)?
    } else {
        activity_friend_presence_first_created_at(db, owner_user_id, target_user_id)?
    };
    Ok(effective_days_from_first(&first_created_at, now_ms))
}

fn resolve_overlap_effective_days(
    db: &DatabaseService,
    owner_user_id: &str,
    current_user_id: &str,
    target_user_id: &str,
    range_days: i64,
    now_ms: i64,
) -> Result<i64, Error> {
    if range_days > 0 {
        return Ok(range_days.clamp(1, ACTIVITY_MAX_RANGE_DAYS));
    }
    let self_first = activity_self_source_first_created_at(db, current_user_id)?;
    let target_first =
        activity_friend_presence_first_created_at(db, owner_user_id, target_user_id)?;
    let self_days = effective_days_from_first(&self_first, now_ms);
    let target_days = effective_days_from_first(&target_first, now_ms);
    Ok(self_days.max(target_days))
}

fn effective_days_from_first(first_created_at: &str, now_ms: i64) -> i64 {
    let Some(first_ms) = parse_activity_time_ms(first_created_at) else {
        return ACTIVITY_ALL_FALLBACK_RANGE_DAYS;
    };
    let span_ms = (now_ms - first_ms).max(0);
    let days = span_ms / DAY_MS + i64::from(span_ms % DAY_MS != 0);
    days.clamp(1, ACTIVITY_MAX_RANGE_DAYS)
}

fn exclude_hours_from_input(
    start_hour: Option<i32>,
    end_hour: Option<i32>,
) -> Option<ExcludeHours> {
    Some(ExcludeHours {
        start_hour: start_hour?,
        end_hour: end_hour?,
    })
}

fn exclude_key(exclude_hours: Option<ExcludeHours>) -> String {
    exclude_hours
        .map(|value| format!("{}-{}", value.start_hour, value.end_hour))
        .unwrap_or_default()
}

fn value_to_f64_vec(value: &Value) -> Vec<f64> {
    match value {
        Value::Array(values) => values.iter().map(value_as_f64).collect(),
        _ => Vec::new(),
    }
}

fn value_as_f64(value: &Value) -> f64 {
    value
        .as_f64()
        .or_else(|| value.as_i64().map(|value| value as f64))
        .or_else(|| value.as_u64().map(|value| value as f64))
        .unwrap_or_default()
}

fn summary_i32(summary: &Value, key: &str) -> Option<i32> {
    summary_i64(summary, key).and_then(|value| i32::try_from(value).ok())
}

fn summary_i64(summary: &Value, key: &str) -> Option<i64> {
    summary.get(key).map(value_as_i64)
}

fn summary_bool(summary: &Value, key: &str) -> Option<bool> {
    summary.get(key).and_then(Value::as_bool)
}
