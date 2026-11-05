use chrono::DateTime;

use super::text::{elapsed_minutes_text, instance_duration_text};

fn ms(value: &str) -> i64 {
    DateTime::parse_from_rfc3339(value)
        .unwrap()
        .timestamp_millis()
}

#[test]
fn elapsed_time_only_advances_on_wall_clock_minute_boundaries() {
    let started_at = "2026-10-19T12:00:40Z";

    assert_eq!(
        elapsed_minutes_text(started_at, ms("2026-10-19T12:05:59Z")),
        "4m"
    );
    assert_eq!(
        elapsed_minutes_text(started_at, ms("2026-10-19T12:06:00Z")),
        "5m"
    );
    assert_eq!(
        elapsed_minutes_text(started_at, ms("2026-10-19T14:06:00Z")),
        "2h 5m"
    );
}

#[test]
fn elapsed_time_shows_under_a_minute_right_after_start() {
    assert_eq!(
        elapsed_minutes_text("2026-10-19T12:00:40Z", ms("2026-10-19T12:00:50Z")),
        "<1m"
    );
}

#[test]
fn elapsed_time_is_empty_for_future_or_unparseable_starts() {
    let now = ms("2026-10-19T12:00:00Z");
    assert_eq!(elapsed_minutes_text("2026-10-19T12:01:00Z", now), "");
    assert_eq!(elapsed_minutes_text("", now), "");
}

#[test]
fn instance_duration_needs_a_real_instance_location() {
    let now = ms("2026-10-19T12:10:00Z");
    assert_eq!(
        instance_duration_text("wrld_abc:12345", "2026-10-19T12:00:00Z", now),
        "10m"
    );
    assert_eq!(
        instance_duration_text("offline", "2026-10-19T12:00:00Z", now),
        ""
    );
}
