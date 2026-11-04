use std::time::{SystemTime, UNIX_EPOCH};

use chrono::{DateTime, Local, Timelike};

use crate::surfaces::wrist::compact_duration;

pub(super) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

pub(super) fn local_time_text(hour12: bool) -> String {
    let now = Local::now();
    format_local_time(now.hour(), now.minute(), hour12)
}

fn format_local_time(hour: u32, minute: u32, hour12: bool) -> String {
    if !hour12 {
        return format!("{hour:02}:{minute:02}");
    }
    let period = if hour < 12 { "AM" } else { "PM" };
    let display_hour = match hour % 12 {
        0 => 12,
        value => value,
    };
    format!("{display_hour}:{minute:02} {period}")
}

pub(super) fn instance_duration_text(location: &str, started_at: &str, now_ms: i64) -> String {
    if !is_world_instance_location(location) {
        return String::new();
    }
    elapsed_minutes_text(started_at, now_ms)
}

pub(super) fn elapsed_minutes_text(started_at: &str, now_ms: i64) -> String {
    let Some(started_at_ms) = DateTime::parse_from_rfc3339(started_at.trim())
        .ok()
        .map(|value| value.timestamp_millis())
    else {
        return String::new();
    };
    if now_ms < started_at_ms {
        return String::new();
    }
    let minute_start_ms = now_ms - now_ms.rem_euclid(60_000);
    compact_duration((minute_start_ms - started_at_ms).max(0))
}

fn is_world_instance_location(location: &str) -> bool {
    let location = location.trim().to_ascii_lowercase();
    location.starts_with("wrld_") && location.contains(':')
}
