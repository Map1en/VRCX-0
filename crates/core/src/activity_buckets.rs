use std::collections::{BTreeMap, BTreeSet};

use chrono::{Datelike, Timelike, Utc};

use crate::activity_sessions::{merge_sessions_with_gap, ActivitySession};

const MS_PER_MINUTE: i64 = 60_000;
const MS_PER_DAY: i64 = 86_400_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ActivityTimeBucket {
    Year,
    Month,
    Week,
    DayOfWeek,
    HourOfDay,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ActivityBucket {
    pub key: String,
    pub label: String,
    pub minutes: i64,
    pub session_count: usize,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ActivityStreaks {
    pub longest_break_days: i64,
    pub current_break_days: i64,
    pub longest_play_streak_days: i64,
    pub total_active_days: i64,
    pub first_session_ms: Option<i64>,
    pub last_session_ms: Option<i64>,
    pub total_minutes: i64,
    pub session_count: usize,
}

pub fn merge_spans(spans: &[(i64, i64)], merge_gap_ms: i64) -> Vec<(i64, i64)> {
    let sessions = spans
        .iter()
        .map(|&(start, end)| ActivitySession {
            start,
            end,
            is_open_tail: false,
            source_revision: String::new(),
        })
        .collect::<Vec<_>>();
    merge_sessions_with_gap(&[], &sessions, merge_gap_ms)
        .into_iter()
        .map(|session| (session.start, session.end))
        .collect()
}

pub fn activity_timeline(
    sessions: &[(i64, i64)],
    bucket: ActivityTimeBucket,
    offset_minutes: i64,
    from_ms: Option<i64>,
    to_ms: Option<i64>,
) -> Vec<ActivityBucket> {
    let mut buckets: BTreeMap<String, BucketAccumulator> = BTreeMap::new();
    for (index, (start, end)) in sessions.iter().copied().enumerate() {
        let start = from_ms.map_or(start, |from| start.max(from));
        let end = to_ms.map_or(end, |to| end.min(to));
        if end <= start {
            continue;
        }

        let mut cursor = start;
        while cursor < end {
            let step_end = end.min(next_minute_boundary_ms(cursor));
            let step_ms = step_end - cursor;
            if let Some(key) = bucket_key(cursor, bucket, offset_minutes) {
                let accumulator = buckets.entry(key).or_default();
                accumulator.ms += step_ms;
                accumulator.session_indexes.insert(index);
            }
            cursor = step_end;
        }
    }

    fill_histogram_buckets(bucket, &mut buckets);

    buckets
        .into_iter()
        .map(|(key, accumulator)| ActivityBucket {
            label: bucket_label(&key, bucket),
            key,
            minutes: accumulator.ms / MS_PER_MINUTE,
            session_count: accumulator.session_indexes.len(),
        })
        .collect()
}

pub fn activity_streaks(
    sessions: &[(i64, i64)],
    now_ms: i64,
    offset_minutes: i64,
) -> ActivityStreaks {
    let mut active_days = BTreeSet::new();
    let mut session_count = 0usize;
    let mut total_ms = 0i64;
    let mut first_session_ms: Option<i64> = None;
    let mut last_session_ms: Option<i64> = None;
    for (start, end) in sessions.iter().copied().filter(|(start, end)| end > start) {
        session_count += 1;
        total_ms += end - start;
        first_session_ms = Some(first_session_ms.map_or(start, |value| value.min(start)));
        last_session_ms = Some(last_session_ms.map_or(end, |value| value.max(end)));
        for day in local_day(start, offset_minutes)..=local_day(end - 1, offset_minutes) {
            active_days.insert(day);
        }
    }
    if session_count == 0 {
        return ActivityStreaks::default();
    }

    let mut longest_play_streak_days = 0i64;
    let mut current_play_streak_days = 0i64;
    let mut previous_day = None;
    let mut longest_break_days = 0i64;
    for day in active_days.iter().copied() {
        match previous_day {
            Some(previous) if day == previous + 1 => {
                current_play_streak_days += 1;
            }
            Some(previous) => {
                longest_break_days = longest_break_days.max(day - previous - 1);
                current_play_streak_days = 1;
            }
            None => {
                current_play_streak_days = 1;
            }
        }
        longest_play_streak_days = longest_play_streak_days.max(current_play_streak_days);
        previous_day = Some(day);
    }

    let today = local_day(now_ms, offset_minutes);
    let last_active_day = active_days.last().copied().unwrap_or(today);
    ActivityStreaks {
        longest_break_days,
        current_break_days: (today - last_active_day).max(0),
        longest_play_streak_days,
        total_active_days: active_days.len() as i64,
        first_session_ms,
        last_session_ms,
        total_minutes: total_ms / MS_PER_MINUTE,
        session_count,
    }
}

pub fn utc_offset_label(offset_minutes: i64) -> String {
    if offset_minutes == 0 {
        return "UTC".into();
    }
    let sign = if offset_minutes > 0 { '+' } else { '-' };
    let total = offset_minutes.unsigned_abs();
    format!("UTC{sign}{:02}:{:02}", total / 60, total % 60)
}

#[derive(Default)]
struct BucketAccumulator {
    ms: i64,
    session_indexes: BTreeSet<usize>,
}

fn bucket_key(ms: i64, bucket: ActivityTimeBucket, offset_minutes: i64) -> Option<String> {
    let local_ms = ms.checked_add(offset_minutes.checked_mul(MS_PER_MINUTE)?)?;
    let local = chrono::DateTime::<Utc>::from_timestamp_millis(local_ms)?;
    Some(match bucket {
        ActivityTimeBucket::Year => format!("{:04}", local.year()),
        ActivityTimeBucket::Month => format!("{:04}-{:02}", local.year(), local.month()),
        ActivityTimeBucket::Week => {
            let week = local.iso_week();
            format!("{:04}-W{:02}", week.year(), week.week())
        }
        ActivityTimeBucket::DayOfWeek => local.weekday().num_days_from_monday().to_string(),
        ActivityTimeBucket::HourOfDay => format!("{:02}", local.hour()),
    })
}

fn bucket_label(key: &str, bucket: ActivityTimeBucket) -> String {
    match bucket {
        ActivityTimeBucket::Year | ActivityTimeBucket::Week => key.to_string(),
        ActivityTimeBucket::Month => month_label(key).unwrap_or_else(|| key.to_string()),
        ActivityTimeBucket::DayOfWeek => weekday_label(key).unwrap_or(key).to_string(),
        ActivityTimeBucket::HourOfDay => hour_label(key).unwrap_or_else(|| key.to_string()),
    }
}

fn fill_histogram_buckets(
    bucket: ActivityTimeBucket,
    buckets: &mut BTreeMap<String, BucketAccumulator>,
) {
    match bucket {
        ActivityTimeBucket::DayOfWeek => {
            for day in 0..7 {
                buckets.entry(day.to_string()).or_default();
            }
        }
        ActivityTimeBucket::HourOfDay => {
            for hour in 0..24 {
                buckets.entry(format!("{hour:02}")).or_default();
            }
        }
        ActivityTimeBucket::Year | ActivityTimeBucket::Month | ActivityTimeBucket::Week => {}
    }
}

fn month_label(key: &str) -> Option<String> {
    let (year, month) = key.split_once('-')?;
    let month_index = month.parse::<usize>().ok()?;
    let name = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ]
    .get(month_index.checked_sub(1)?)?;
    Some(format!("{name} {year}"))
}

pub fn weekday_label(key: &str) -> Option<&'static str> {
    match key {
        "0" => Some("Monday"),
        "1" => Some("Tuesday"),
        "2" => Some("Wednesday"),
        "3" => Some("Thursday"),
        "4" => Some("Friday"),
        "5" => Some("Saturday"),
        "6" => Some("Sunday"),
        _ => None,
    }
}

fn hour_label(key: &str) -> Option<String> {
    let hour = key.parse::<u8>().ok()?;
    if hour > 23 {
        return None;
    }
    Some(format!("{hour:02}:00\u{2013}{:02}:00", (hour + 1) % 24))
}

fn local_day(ms: i64, offset_minutes: i64) -> i64 {
    ms.saturating_add(offset_minutes.saturating_mul(MS_PER_MINUTE))
        .div_euclid(MS_PER_DAY)
}

fn next_minute_boundary_ms(ms: i64) -> i64 {
    let remainder = ms.rem_euclid(MS_PER_MINUTE);
    let delta = if remainder == 0 {
        MS_PER_MINUTE
    } else {
        MS_PER_MINUTE - remainder
    };
    ms.saturating_add(delta)
}
