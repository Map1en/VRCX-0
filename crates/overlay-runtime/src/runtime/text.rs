use std::time::{SystemTime, UNIX_EPOCH};

use chrono::{DateTime, Local, Timelike};

use crate::surfaces::wrist::{clock_duration, compact_duration};

pub(super) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

pub(super) fn local_time_text(hour12: bool, show_seconds: bool) -> String {
    let now = Local::now();
    format_local_time(
        now.hour(),
        now.minute(),
        show_seconds.then(|| now.second()),
        hour12,
    )
}

fn format_local_time(hour: u32, minute: u32, second: Option<u32>, hour12: bool) -> String {
    let seconds = second
        .map(|second| format!(":{second:02}"))
        .unwrap_or_default();
    if !hour12 {
        return format!("{hour:02}:{minute:02}{seconds}");
    }
    let period = if hour < 12 { "AM" } else { "PM" };
    let display_hour = match hour % 12 {
        0 => 12,
        value => value,
    };
    format!("{display_hour}:{minute:02}{seconds} {period}")
}

pub(super) fn instance_duration_text(
    location: &str,
    started_at: &str,
    now_ms: i64,
    show_seconds: bool,
) -> String {
    if !is_world_instance_location(location) {
        return String::new();
    }
    elapsed_duration_text(started_at, now_ms, show_seconds)
}

pub(super) fn elapsed_duration_text(started_at: &str, now_ms: i64, show_seconds: bool) -> String {
    let Some(started_at_ms) = DateTime::parse_from_rfc3339(started_at.trim())
        .ok()
        .map(|value| value.timestamp_millis())
    else {
        return String::new();
    };
    if now_ms < started_at_ms {
        return String::new();
    }
    if show_seconds {
        return clock_duration((now_ms - started_at_ms) / 1000);
    }
    let minute_start_ms = now_ms - now_ms.rem_euclid(60_000);
    compact_duration((minute_start_ms - started_at_ms).max(0))
}

fn is_world_instance_location(location: &str) -> bool {
    let location = location.trim().to_ascii_lowercase();
    location.starts_with("wrld_") && location.contains(':')
}

#[cfg(test)]
mod tests {
    use super::format_local_time;

    #[test]
    fn local_time_appends_seconds_only_when_requested() {
        assert_eq!(format_local_time(9, 5, None, false), "09:05");
        assert_eq!(format_local_time(9, 5, Some(7), false), "09:05:07");
        assert_eq!(format_local_time(0, 5, Some(59), true), "12:05:59 AM");
        assert_eq!(format_local_time(13, 5, None, true), "1:05 PM");
    }
}
