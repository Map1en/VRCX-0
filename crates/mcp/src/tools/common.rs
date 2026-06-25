use chrono::{DateTime, Datelike, Duration, TimeZone, Utc};
use rmcp::model::CallToolResult;
use rmcp::schemars;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use vrcx_0_persistence::social_aggregates;

use crate::runtime::McpRuntime;

#[derive(Clone, Debug, Default, schemars::JsonSchema)]
pub(super) struct TimeWindowParams {
    pub(super) from: Option<String>,
    pub(super) to: Option<String>,
}

impl<'de> Deserialize<'de> for TimeWindowParams {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        // Accept the documented object form `{from, to}` but also tolerate a
        // bare natural-language string (e.g. "this week") that models often pass
        // despite the schema. Unrecognized strings fall back to all history.
        let value = Value::deserialize(deserializer)?;
        Ok(time_window_from_value(&value))
    }
}

impl From<TimeWindowParams> for social_aggregates::TimeWindow {
    fn from(value: TimeWindowParams) -> Self {
        Self {
            from: value.from,
            to: value.to,
        }
    }
}

fn time_window_from_value(value: &Value) -> TimeWindowParams {
    match value {
        Value::String(text) => parse_relative_window(text),
        Value::Object(map) => TimeWindowParams {
            from: map
                .get("from")
                .and_then(Value::as_str)
                .and_then(normalize_time_bound),
            to: map
                .get("to")
                .and_then(Value::as_str)
                .and_then(normalize_time_bound),
        },
        _ => TimeWindowParams::default(),
    }
}

/// Coerce a single `from`/`to` bound into RFC3339, since models pass shorthand
/// (`7d`, `now`), date-only (`2025-07-11`), or timezone-less datetimes despite
/// the schema. Returns `None` (unbounded) for anything unparseable so the tool
/// never sees an invalid RFC3339 string.
fn normalize_time_bound(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if DateTime::parse_from_rfc3339(trimmed).is_ok() {
        return Some(trimmed.to_string());
    }
    let lowered = trimmed.to_ascii_lowercase();
    if lowered == "now" || lowered == "today" {
        return Some(Utc::now().to_rfc3339());
    }
    if let Ok(date) = chrono::NaiveDate::parse_from_str(trimmed, "%Y-%m-%d") {
        let naive = date.and_time(chrono::NaiveTime::MIN);
        return Some(Utc.from_utc_datetime(&naive).to_rfc3339());
    }
    for fmt in ["%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"] {
        if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(trimmed, fmt) {
            return Some(Utc.from_utc_datetime(&naive).to_rfc3339());
        }
    }
    if let Some(duration) = parse_duration(&lowered) {
        return Some((Utc::now() - duration).to_rfc3339());
    }
    tracing::warn!(input = %raw, "assistant: unrecognized time bound, ignoring");
    None
}

fn parse_relative_window(text: &str) -> TimeWindowParams {
    let normalized = text.trim().to_ascii_lowercase();
    let now = Utc::now();
    let rfc = |dt: DateTime<Utc>| Some(dt.to_rfc3339());
    let window = |from, to| TimeWindowParams { from, to };

    match normalized.as_str() {
        "" | "all" | "all time" | "alltime" | "any" | "anytime" | "ever" | "always" => {
            return TimeWindowParams::default();
        }
        "today" => return window(rfc(start_of_day(now)), None),
        "yesterday" => {
            let start_today = start_of_day(now);
            return window(rfc(start_today - Duration::days(1)), rfc(start_today));
        }
        "this week" | "week" => return window(rfc(start_of_week(now)), None),
        "last week" | "past week" | "previous week" => {
            let this = start_of_week(now);
            return window(rfc(this - Duration::days(7)), rfc(this));
        }
        "this month" | "month" => return window(rfc(start_of_month(now)), None),
        "last month" | "past month" | "previous month" => {
            return window(rfc(start_of_prev_month(now)), rfc(start_of_month(now)));
        }
        _ => {}
    }

    if let Some(window) = parse_rolling_window(&normalized, now) {
        return window;
    }

    tracing::warn!(input = %text, "assistant: unrecognized time window string, using all history");
    TimeWindowParams::default()
}

fn parse_rolling_window(text: &str, now: DateTime<Utc>) -> Option<TimeWindowParams> {
    let duration = parse_duration(text)?;
    Some(TimeWindowParams {
        from: Some((now - duration).to_rfc3339()),
        to: None,
    })
}

/// Parse a duration from word forms (`7 days`, `last 3 weeks`) or compact forms
/// (`7d`, `2w`, `3mo`, `24h`, `1y`). Bare `m` is read as months — the common
/// intent for social-history windows. `text` is expected to be lowercased.
fn parse_duration(text: &str) -> Option<Duration> {
    let number: i64 = text
        .split(|ch: char| !ch.is_ascii_digit())
        .find(|token| !token.is_empty())
        .and_then(|token| token.parse().ok())?;
    let compact = compact_unit(text);
    if text.contains("hour") || compact == Some('h') {
        Some(Duration::hours(number))
    } else if text.contains("week") || compact == Some('w') {
        Some(Duration::days(number * 7))
    } else if text.contains("mo") || compact == Some('m') {
        Some(Duration::days(number * 30))
    } else if text.contains("year") || compact == Some('y') {
        Some(Duration::days(number * 365))
    } else if text.contains("day") || compact == Some('d') {
        Some(Duration::days(number))
    } else {
        None
    }
}

/// First alphabetic character that immediately follows a digit, e.g. `d` in
/// `7d`. Used to read compact duration units.
fn compact_unit(text: &str) -> Option<char> {
    let mut seen_digit = false;
    for ch in text.chars() {
        if ch.is_ascii_digit() {
            seen_digit = true;
        } else if seen_digit && ch.is_ascii_alphabetic() {
            return Some(ch);
        }
    }
    None
}

fn start_of_day(now: DateTime<Utc>) -> DateTime<Utc> {
    now.date_naive()
        .and_hms_opt(0, 0, 0)
        .map(|naive| Utc.from_utc_datetime(&naive))
        .unwrap_or(now)
}

fn start_of_week(now: DateTime<Utc>) -> DateTime<Utc> {
    let days = now.weekday().num_days_from_monday() as i64;
    start_of_day(now) - Duration::days(days)
}

fn start_of_month(now: DateTime<Utc>) -> DateTime<Utc> {
    now.date_naive()
        .with_day(1)
        .and_then(|date| date.and_hms_opt(0, 0, 0))
        .map(|naive| Utc.from_utc_datetime(&naive))
        .unwrap_or(now)
}

fn start_of_prev_month(now: DateTime<Utc>) -> DateTime<Utc> {
    let last_day_prev = start_of_month(now) - Duration::days(1);
    start_of_month(last_day_prev)
}
pub(super) struct TimeWindowBoundsMs {
    pub(super) from: Option<i64>,
    pub(super) to: Option<i64>,
}
pub(super) fn time_window_bounds_ms(
    time_window: &social_aggregates::TimeWindow,
) -> Result<TimeWindowBoundsMs, String> {
    Ok(TimeWindowBoundsMs {
        from: time_window
            .from
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(parse_rfc3339_ms)
            .transpose()?,
        to: time_window
            .to
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(parse_rfc3339_ms)
            .transpose()?,
    })
}

fn parse_rfc3339_ms(value: &str) -> Result<i64, String> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.timestamp_millis())
        .map_err(|error| format!("invalid RFC3339 time '{value}': {error}"))
}

pub(super) fn rfc3339_z(value: DateTime<Utc>) -> String {
    value.format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

pub(super) fn ms_to_rfc3339_z(millis: i64) -> String {
    DateTime::<Utc>::from_timestamp_millis(millis)
        .map(rfc3339_z)
        .unwrap_or_default()
}
pub(super) fn map_persistence_error(error: vrcx_0_persistence::Error) -> String {
    match error {
        vrcx_0_persistence::Error::InvalidData(message) => message,
        other => {
            tracing::warn!("MCP persistence query failed: {other}");
            "internal data error while reading local VRCX-0 data".into()
        }
    }
}

pub(super) fn structured_result(value: impl Serialize) -> Result<CallToolResult, String> {
    serde_json::to_value(value)
        .map(CallToolResult::structured)
        .map_err(|error| format!("serialize MCP tool result: {error}"))
}

pub(super) fn social_aggregates_result<T: Serialize>(
    result: Result<T, vrcx_0_persistence::Error>,
) -> Result<CallToolResult, String> {
    match result {
        Ok(value) => structured_result(value),
        Err(vrcx_0_persistence::Error::InvalidData(message)) => Err(message),
        Err(error) => {
            tracing::warn!("MCP social query failed: {error}");
            Err("internal data error while reading local VRCX-0 data".into())
        }
    }
}

pub(super) fn require_current_user_id(runtime: &McpRuntime) -> Result<String, String> {
    runtime
        .current_user_id()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            "This tool requires an active realtime VRChat session (current user unknown).".into()
        })
}

#[cfg(test)]
mod time_window_tests {
    use super::*;

    #[test]
    fn parses_object_form() {
        let value = serde_json::json!({ "from": "2026-01-01T00:00:00Z", "to": null });
        let window = time_window_from_value(&value);
        assert_eq!(window.from.as_deref(), Some("2026-01-01T00:00:00Z"));
        assert_eq!(window.to, None);
    }

    #[test]
    fn relative_strings_produce_a_lower_bound() {
        for phrase in [
            "today",
            "this week",
            "last month",
            "last 7 days",
            "past 3 weeks",
        ] {
            let window = time_window_from_value(&serde_json::json!(phrase));
            assert!(window.from.is_some(), "{phrase} should set a lower bound");
        }
    }

    #[test]
    fn all_history_phrases_stay_empty() {
        for phrase in ["all", "all time", "ever", ""] {
            let window = time_window_from_value(&serde_json::json!(phrase));
            assert!(
                window.from.is_none() && window.to.is_none(),
                "{phrase} should be unbounded"
            );
        }
    }

    #[test]
    fn unknown_string_falls_back_to_all_history() {
        let window = time_window_from_value(&serde_json::json!("whenever-ish"));
        assert!(window.from.is_none() && window.to.is_none());
    }

    #[test]
    fn object_bounds_are_coerced_to_rfc3339() {
        // Shorthand, date-only, and "now" must all become valid RFC3339.
        for value in [
            serde_json::json!({ "from": "7d" }),
            serde_json::json!({ "from": "7d", "to": "now" }),
            serde_json::json!({ "from": "2025-07-11", "to": "2025-07-18" }),
            serde_json::json!({ "from": "2025-07-11T10:00:00" }),
        ] {
            let window = time_window_from_value(&value);
            for bound in [window.from.as_deref(), window.to.as_deref()]
                .into_iter()
                .flatten()
            {
                assert!(
                    DateTime::parse_from_rfc3339(bound).is_ok(),
                    "bound '{bound}' should be valid RFC3339"
                );
            }
            assert!(
                window.from.is_some(),
                "from bound should be set for {value}"
            );
        }
    }

    #[test]
    fn valid_rfc3339_bounds_pass_through() {
        let value = serde_json::json!({ "from": "2025-07-11T10:00:00Z" });
        let window = time_window_from_value(&value);
        assert_eq!(window.from.as_deref(), Some("2025-07-11T10:00:00Z"));
    }

    #[test]
    fn unparseable_bound_becomes_unbounded() {
        let value = serde_json::json!({ "from": "soon", "to": "2025-07-18" });
        let window = time_window_from_value(&value);
        assert!(window.from.is_none(), "garbage 'from' should drop to None");
        assert!(window.to.is_some(), "valid 'to' should remain");
    }
}
