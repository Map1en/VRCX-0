use serde_json::Value;
use vrcx_0_mcp::ToolCallOutcome;

const TOOL_CONTENT_CHAR_BUDGET: usize = 64_000;
const TOOL_RESULT_ARRAY_LIMIT: usize = 100;
const TOOL_RESULT_STRING_LIMIT: usize = 4_000;

pub(super) fn tool_content(result: &ToolCallOutcome) -> String {
    match result.structured.as_ref() {
        Some(value) if !value.is_null() => budget_json_tool_content(value),
        _ => budget_text_tool_content(&result.text),
    }
}

fn budget_json_tool_content(value: &Value) -> String {
    let raw = value.to_string();
    if within_tool_budget(&raw) {
        return raw;
    }

    let light =
        compact_json_value(value, TOOL_RESULT_ARRAY_LIMIT, TOOL_RESULT_STRING_LIMIT).to_string();
    if within_tool_budget(&light) {
        return light;
    }

    let aggressive = compact_json_value(
        value,
        TOOL_RESULT_ARRAY_LIMIT / 4,
        TOOL_RESULT_STRING_LIMIT / 4,
    )
    .to_string();
    if within_tool_budget(&aggressive) {
        return aggressive;
    }
    budget_text_tool_content(&aggressive)
}

fn budget_text_tool_content(text: &str) -> String {
    if within_tool_budget(text) {
        return text.to_string();
    }
    let keep = TOOL_CONTENT_CHAR_BUDGET.saturating_sub(128);
    let clipped: String = text.chars().take(keep).collect();
    let omitted = text.chars().count().saturating_sub(clipped.chars().count());
    format!("{clipped}\n\n[Tool result truncated by VRCX-0: omitted {omitted} characters.]")
}

fn within_tool_budget(text: &str) -> bool {
    text.chars().count() <= TOOL_CONTENT_CHAR_BUDGET
}

fn compact_json_value(value: &Value, array_limit: usize, string_limit: usize) -> Value {
    match value {
        Value::Array(items) => {
            let mut compacted = items
                .iter()
                .take(array_limit)
                .map(|item| compact_json_value(item, array_limit, string_limit))
                .collect::<Vec<_>>();
            if items.len() > array_limit {
                compacted.push(serde_json::json!({
                    "__truncated": true,
                    "originalCount": items.len(),
                    "omittedCount": items.len() - array_limit,
                }));
            }
            Value::Array(compacted)
        }
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(key, nested)| {
                    (
                        key.clone(),
                        compact_json_value(nested, array_limit, string_limit),
                    )
                })
                .collect(),
        ),
        Value::String(text) if text.chars().count() > string_limit => {
            let clipped: String = text.chars().take(string_limit).collect();
            Value::String(format!(
                "{clipped}… [truncated {} characters]",
                text.chars().count().saturating_sub(clipped.chars().count())
            ))
        }
        _ => value.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn large_structured_tool_results_are_compacted_for_llm_context() {
        let rows = (0..150)
            .map(|index| {
                serde_json::json!({
                    "userId": format!("usr_{index}"),
                    "displayName": format!("Friend {index}"),
                    "notes": "x".repeat(500),
                })
            })
            .collect::<Vec<_>>();
        let value = serde_json::json!({ "rows": rows, "caveats": ["local data"] });

        let content = budget_json_tool_content(&value);
        let parsed: Value = serde_json::from_str(&content).unwrap();
        let compact_rows = parsed["rows"].as_array().unwrap();
        let marker = compact_rows.last().unwrap();

        assert!(within_tool_budget(&content));
        assert!(compact_rows.len() <= TOOL_RESULT_ARRAY_LIMIT + 1);
        assert_eq!(marker["__truncated"], true);
        assert!(marker["omittedCount"].as_u64().unwrap() >= 50);
        assert!(
            compact_rows[0]["notes"].as_str().unwrap().chars().count()
                <= TOOL_RESULT_STRING_LIMIT + 64
        );
    }

    #[test]
    fn huge_text_tool_results_get_a_truncation_notice() {
        let text = "x".repeat(TOOL_CONTENT_CHAR_BUDGET + 1_000);

        let content = budget_text_tool_content(&text);

        assert!(within_tool_budget(&content));
        assert!(content.contains("Tool result truncated by VRCX-0"));
    }

    #[test]
    fn top_100_compact_aggregate_rows_fit_without_truncation() {
        let rows = (0..100)
            .map(|index| {
                serde_json::json!({
                    "userId": format!("usr_{index:032}"),
                    "displayName": format!("Friend Name {index:03}"),
                    "totalMinutes": 12345,
                    "coDays": 365,
                    "instances": 999,
                    "lastSeenTogether": "2026-06-26T12:34:56Z",
                    "minutesByAccess": {
                        "public": 1111,
                        "friends": 2222,
                        "invite": 3333,
                        "group": 4444,
                    },
                })
            })
            .collect::<Vec<_>>();
        let value = serde_json::json!({
            "rows": rows,
            "caveats": ["Local observer-centered data; private instances are undercounted."],
        });

        let content = budget_json_tool_content(&value);
        let parsed: Value = serde_json::from_str(&content).unwrap();

        assert!(within_tool_budget(&content));
        assert_eq!(parsed["rows"].as_array().unwrap().len(), 100);
        assert!(parsed["rows"]
            .as_array()
            .unwrap()
            .iter()
            .all(|row| row.get("__truncated").is_none()));
    }
}
