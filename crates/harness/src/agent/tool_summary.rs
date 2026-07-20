use serde_json::{Map, Value};
use vrcx_0_mcp::ToolCallOutcome;

const ROW_DETAIL_COUNT_FIELDS: &[(&str, &str, &str)] = &[
    ("distinctFriends", "friend", "friends"),
    ("onlineEvents", "online event", "online events"),
    ("totalMinutes", "minute", "minutes"),
    ("coDays", "day together", "days together"),
    ("instances", "instance", "instances"),
    ("encounterCount", "encounter", "encounters"),
    ("encounterDays", "encounter day", "encounter days"),
    ("changeCount", "change", "changes"),
    ("overlapMinutes", "overlap minute", "overlap minutes"),
    ("sharedInstances", "shared instance", "shared instances"),
    ("stayMinutes", "minute", "minutes"),
];

const SUMMARY_LIMIT: usize = 240;

pub(super) fn normalize_tool_arguments(
    tool_name: &str,
    arguments: Option<Map<String, Value>>,
    user_text: &str,
) -> Option<Map<String, Value>> {
    let mut arguments = arguments.unwrap_or_default();
    for key in ["limit", "utcOffsetMinutes", "utc_offset_minutes"] {
        normalize_integer_string(&mut arguments, key);
    }
    match tool_name {
        "get_copresence_summary" => {
            ensure_limit(&mut arguments, ranked_limit_for_user_text(user_text));
        }
        "get_friend_changes" | "get_invite_history" | "search_worlds_visited" => {
            ensure_limit(&mut arguments, 25);
        }
        "get_friend_log" => {
            ensure_limit(&mut arguments, 100);
        }
        _ => {}
    }
    (!arguments.is_empty()).then_some(arguments)
}

fn normalize_integer_string(arguments: &mut Map<String, Value>, key: &str) {
    let Some(value) = arguments.get(key).and_then(Value::as_str) else {
        return;
    };
    let Ok(value) = value.trim().parse::<i64>() else {
        return;
    };
    arguments.insert(key.to_string(), Value::from(value));
}

fn ensure_limit(arguments: &mut Map<String, Value>, limit: i64) {
    let has_valid_limit = arguments
        .get("limit")
        .and_then(Value::as_i64)
        .is_some_and(|value| value > 0);
    if !has_valid_limit {
        arguments.insert("limit".into(), Value::from(limit));
    }
}

fn ranked_limit_for_user_text(user_text: &str) -> i64 {
    let normalized = user_text.to_lowercase();
    let asks_single_winner = [
        "一番",
        "いちばん",
        "最も",
        "最多",
        "誰",
        "だれ",
        "who",
        "most",
        "best",
    ]
    .iter()
    .any(|needle| normalized.contains(needle));
    let asks_list = [
        "top ",
        "top",
        "ランキング",
        "rank",
        "list",
        "一覧",
        "人たち",
        "people",
    ]
    .iter()
    .any(|needle| normalized.contains(needle));

    if asks_single_winner && !asks_list {
        3
    } else {
        10
    }
}

pub(super) fn tool_call_signature(
    tool_name: &str,
    arguments: Option<&Map<String, Value>>,
) -> String {
    let args = arguments
        .map(|arguments| Value::Object(arguments.clone()).to_string())
        .unwrap_or_else(|| "null".into());
    format!("{tool_name}:{args}")
}

pub(super) fn tool_fact_summary(result: &ToolCallOutcome, content: &str) -> Option<String> {
    result
        .structured
        .as_ref()
        .and_then(summary_from_value)
        .or_else(|| {
            serde_json::from_str::<Value>(&result.text)
                .ok()
                .and_then(|value| summary_from_value(&value))
        })
        .or_else(|| {
            serde_json::from_str::<Value>(content)
                .ok()
                .and_then(|value| summary_from_value(&value))
        })
}

fn summary_from_value(value: &Value) -> Option<String> {
    value
        .get("summary")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|summary| !summary.is_empty())
        .map(ToOwned::to_owned)
}

pub(super) fn brief_summary_from_value(value: &Value) -> Option<String> {
    summary_from_value(value)
        .or_else(|| disambiguation_summary(value))
        .or_else(|| not_found_summary(value))
        .or_else(|| rows_summary(value))
}

fn disambiguation_summary(value: &Value) -> Option<String> {
    if !value
        .get("needsDisambiguation")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return None;
    }
    let query = string_field(value, "query");
    let names = value
        .get("candidates")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|candidate| string_field(candidate, "displayName"))
        .take(5)
        .collect::<Vec<_>>();
    let query_text = query
        .as_deref()
        .map(|query| format!(" for \"{query}\""))
        .unwrap_or_default();
    if names.is_empty() {
        Some(format!(
            "Multiple local users matched{query_text}; ask the user to choose one."
        ))
    } else {
        Some(format!(
            "Multiple local users matched{query_text}; ask the user to choose one: {}.",
            names.join(", ")
        ))
    }
}

fn not_found_summary(value: &Value) -> Option<String> {
    if !value
        .get("notFound")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return None;
    }
    let query = string_field(value, "query");
    Some(match query {
        Some(query) => format!("No local-history user matched \"{query}\"."),
        None => "No local-history user matched the query.".into(),
    })
}

fn rows_summary(value: &Value) -> Option<String> {
    let rows = value.get("rows").and_then(Value::as_array)?;
    if rows.is_empty() {
        return Some("The tool returned no matching rows.".into());
    }
    let row_word = if rows.len() == 1 { "row" } else { "rows" };
    let Some(first) = rows.first() else {
        return Some(format!("The tool returned {} {row_word}.", rows.len()));
    };
    let Some(label) = row_label(first) else {
        return Some(format!("The tool returned {} {row_word}.", rows.len()));
    };
    let details = row_detail_fragments(first);
    if details.is_empty() {
        Some(format!(
            "The tool returned {} {row_word}. Top result: {label}.",
            rows.len()
        ))
    } else {
        Some(format!(
            "The tool returned {} {row_word}. Top result: {label} ({}).",
            rows.len(),
            details.join(", ")
        ))
    }
}

fn row_label(row: &Value) -> Option<String> {
    [
        "label",
        "displayName",
        "worldName",
        "matchedName",
        "userId",
        "worldId",
        "bucket",
    ]
    .iter()
    .find_map(|key| string_field(row, key))
}

fn row_detail_fragments(row: &Value) -> Vec<String> {
    let mut details = Vec::new();
    if let Some(value) = string_field(row, "typicalOnlineWindow") {
        details.push(format!("usually online around {value}"));
    }
    for (key, singular, plural) in ROW_DETAIL_COUNT_FIELDS {
        push_count_detail(&mut details, row, key, singular, plural);
    }
    details.truncate(3);
    details
}

fn push_count_detail(
    details: &mut Vec<String>,
    row: &Value,
    key: &str,
    singular: &str,
    plural: &str,
) {
    if let Some(value) = number_field(row, key) {
        let noun = if value == 1 { singular } else { plural };
        details.push(format!("{value} {noun}"));
    }
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn number_field(value: &Value, key: &str) -> Option<i64> {
    value.get(key).and_then(|value| {
        value
            .as_i64()
            .or_else(|| value.as_u64().and_then(|value| i64::try_from(value).ok()))
    })
}

pub(super) fn apply_tool_summary_fallback(
    final_answer: &mut String,
    last_tool_summary: Option<String>,
) -> bool {
    if !final_answer.trim().is_empty() {
        return false;
    }
    let Some(summary) = last_tool_summary
        .map(|summary| summary.trim().to_string())
        .filter(|summary| !summary.is_empty())
    else {
        return false;
    };
    *final_answer = summary;
    true
}

pub(super) fn parse_arguments(raw: &str) -> Option<serde_json::Map<String, Value>> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut map = match serde_json::from_str::<serde_json::Map<String, Value>>(trimmed) {
        Ok(map) => map,
        Err(error) => {
            // Distinguish "model sent no args" (empty, handled above) from
            // "model sent malformed JSON we dropped" — the latter usually means
            // a truncated stream or a weak model and is worth surfacing.
            tracing::warn!(args = %trimmed, %error, "assistant: tool arguments were not valid JSON; dispatching with none");
            return None;
        }
    };
    // Models routinely emit explicit `null` for optional parameters. serde's
    // `#[serde(default)]` only covers a missing key, not an explicit null, so
    // drop null-valued keys to let tool defaults apply.
    map.retain(|_, value| !value.is_null());
    Some(map)
}

pub(super) fn truncate(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= SUMMARY_LIMIT {
        return trimmed.to_string();
    }
    let clipped: String = trimmed.chars().take(SUMMARY_LIMIT).collect();
    format!("{clipped}…")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn copresence_top_question_gets_floor_limit_when_model_omits_it() {
        let arguments = normalize_tool_arguments(
            "get_copresence_summary",
            Some(serde_json::Map::new()),
            "今までで一番あっている人は誰かな",
        )
        .unwrap();

        assert_eq!(arguments.get("limit").and_then(Value::as_i64), Some(3));
    }

    #[test]
    fn tool_call_signature_includes_normalized_arguments() {
        let first = normalize_tool_arguments("get_copresence_summary", None, "who have I met most")
            .unwrap();
        let second = normalize_tool_arguments(
            "get_copresence_summary",
            Some(serde_json::Map::new()),
            "who have I met most",
        )
        .unwrap();

        assert_eq!(
            tool_call_signature("get_copresence_summary", Some(&first)),
            tool_call_signature("get_copresence_summary", Some(&second))
        );
    }

    #[test]
    fn numeric_tool_arguments_accept_integer_strings() {
        let arguments = normalize_tool_arguments(
            "get_friend_activity_pattern",
            Some(
                serde_json::from_value(serde_json::json!({
                    "limit": "10",
                    "utcOffsetMinutes": "600"
                }))
                .unwrap(),
            ),
            "activity",
        )
        .unwrap();

        assert_eq!(arguments.get("limit").and_then(Value::as_i64), Some(10));
        assert_eq!(
            arguments.get("utcOffsetMinutes").and_then(Value::as_i64),
            Some(600)
        );
    }

    #[test]
    fn numeric_tool_arguments_leave_non_integer_strings_unchanged() {
        let arguments = normalize_tool_arguments(
            "recall_encounter",
            Some(serde_json::from_value(serde_json::json!({ "limit": "many" })).unwrap()),
            "encounters",
        )
        .unwrap();

        assert_eq!(arguments.get("limit").and_then(Value::as_str), Some("many"));
    }
}
