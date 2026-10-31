use super::*;

#[tokio::test]
async fn tool_wait_stops_when_the_turn_is_cancelled() {
    let cancel = CancellationToken::new();
    cancel.cancel();

    let result = await_tool_call(
        std::future::pending::<()>(),
        &cancel,
        Duration::from_secs(1),
    )
    .await;

    assert!(matches!(result, AwaitToolCall::Cancelled));
}

#[tokio::test]
async fn tool_wait_returns_when_the_budget_expires() {
    let result = await_tool_call(
        std::future::pending::<()>(),
        &CancellationToken::new(),
        Duration::from_millis(1),
    )
    .await;

    assert!(matches!(result, AwaitToolCall::TimedOut));
}

#[test]
fn system_prompt_keeps_core_boundaries_and_schema_field_names() {
    for phrase in [
        "not observed",
        "private instances",
        "not my own friend",
        "caveats",
        "needsDisambiguation",
        "`timeWindow`",
        "calendar year",
    ] {
        assert!(SYSTEM_PROMPT.contains(phrase), "missing phrase: {phrase}");
    }
    assert!(!SYSTEM_PROMPT.contains("time_window"));
}

#[test]
fn utc_offset_acceptance_is_read_from_the_tool_schema() {
    let tool_defs = vec![
        crate::test_support::tool_def(
            "get_best_time_to_play",
            serde_json::json!({
                "type": "object",
                "properties": { "utcOffsetMinutes": { "type": "integer" } }
            }),
        ),
        crate::test_support::tool_def(
            "get_copresence_summary",
            serde_json::json!({
                "type": "object",
                "properties": { "limit": { "type": "integer" } }
            }),
        ),
    ];

    assert!(tool_accepts_utc_offset(&tool_defs, "get_best_time_to_play"));
    assert!(!tool_accepts_utc_offset(
        &tool_defs,
        "get_copresence_summary"
    ));
    assert!(!tool_accepts_utc_offset(&tool_defs, "unknown_tool"));
}

fn tool_call(name: &str, arguments: &str) -> ToolCall {
    ToolCall {
        id: "call_0".into(),
        kind: "function".into(),
        function: vrcx_0_contracts::llm::FunctionCall {
            name: name.into(),
            arguments: arguments.into(),
        },
    }
}

fn copresence_tool_defs() -> Vec<ToolDefinition> {
    vec![crate::test_support::tool_def(
        "get_copresence_summary",
        serde_json::json!({ "type": "object", "properties": {} }),
    )]
}

#[test]
fn malformed_tool_arguments_are_returned_to_the_model_instead_of_dispatched() {
    let tool_defs = copresence_tool_defs();
    let mut dispatched = HashSet::new();
    let call = tool_call("get_copresence_summary", r#"{"timeWindow": "this we"#);

    let prepared = prepare_call(&call, &tool_defs, &tool_defs, 0, false, &mut dispatched);

    let resolved = prepared
        .resolved
        .expect("malformed arguments must not dispatch");
    assert!(!resolved.ok);
    assert!(resolved.content.contains("not a valid JSON object"));
    assert!(resolved.content.contains(r#"{"timeWindow": "this we"#));
    assert!(dispatched.is_empty());
}

#[test]
fn empty_tool_arguments_still_dispatch_with_defaults() {
    let tool_defs = copresence_tool_defs();
    let mut dispatched = HashSet::new();
    let call = tool_call("get_copresence_summary", "  ");

    let prepared = prepare_call(&call, &tool_defs, &tool_defs, 0, false, &mut dispatched);

    assert!(prepared.resolved.is_none());
    assert_eq!(
        prepared
            .arguments
            .and_then(|arguments| arguments.get("limit").and_then(Value::as_i64)),
        Some(10)
    );
}

#[test]
fn tool_calls_from_a_truncated_response_are_not_dispatched() {
    let tool_defs = copresence_tool_defs();
    let mut dispatched = HashSet::new();
    let call = tool_call("get_copresence_summary", r#"{"limit": 5}"#);

    let prepared = prepare_call(&call, &tool_defs, &tool_defs, 0, true, &mut dispatched);

    let resolved = prepared
        .resolved
        .expect("truncated calls must not dispatch");
    assert!(!resolved.ok);
    assert!(resolved.content.contains("output token limit"));
    assert!(dispatched.is_empty());
}

#[test]
fn empty_final_answer_falls_back_to_last_tool_summary() {
    let resolved = resolve_tool_outcome(Ok(ToolCallOutcome {
        is_error: false,
        text: String::new(),
        structured: Some(serde_json::json!({
            "summary": "Alice is your top companion.",
            "rows": []
        })),
    }));
    let mut final_answer = String::new();

    assert!(apply_tool_summary_fallback(
        &mut final_answer,
        resolved.fallback_summary
    ));
    assert_eq!(final_answer, "Alice is your top companion.");
}

#[test]
fn duplicate_tool_call_summary_does_not_replace_real_fallback_summary() {
    let resolved = resolve_tool_outcome(Ok(ToolCallOutcome {
        is_error: false,
        text: String::new(),
        structured: Some(serde_json::json!({
            "summary": "Alice is your top companion.",
            "rows": []
        })),
    }));
    let duplicate = duplicate_tool_call_result("get_copresence_summary");
    let mut last_success_tool_summary = None;
    let mut last_error_tool_summary = None;
    let mut final_answer = String::new();

    remember_resolved_tool_summary(
        &resolved,
        &mut last_success_tool_summary,
        &mut last_error_tool_summary,
    );
    remember_resolved_tool_summary(
        &duplicate,
        &mut last_success_tool_summary,
        &mut last_error_tool_summary,
    );

    assert!(apply_tool_summary_fallback(
        &mut final_answer,
        last_success_tool_summary.or(last_error_tool_summary)
    ));
    assert_eq!(final_answer, "Alice is your top companion.");
}

#[test]
fn tool_without_top_level_summary_builds_readable_fallback_summary() {
    let resolved = resolve_tool_outcome(Ok(ToolCallOutcome {
        is_error: false,
        text: String::new(),
        structured: Some(serde_json::json!({
            "rows": [{
                "label": "21:00",
                "distinctFriends": 3,
                "onlineEvents": 9,
                "topFriends": []
            }],
            "caveats": []
        })),
    }));
    let mut final_answer = String::new();

    assert!(apply_tool_summary_fallback(
        &mut final_answer,
        resolved.fallback_summary
    ));
    assert_eq!(
        final_answer,
        "The tool returned 1 row. Top result: 21:00 (3 friends, 9 online events)."
    );
}

#[test]
fn raw_tool_fallback_is_not_accepted_as_supported_facts() {
    let resolved = resolve_tool_outcome(Ok(ToolCallOutcome {
        is_error: false,
        text: String::new(),
        structured: Some(serde_json::json!({
            "nodes": [{ "displayName": "Alice", "connectionDegree": 37 }],
            "edges": []
        })),
    }));

    assert!(resolved.fallback_summary.is_some());
    assert!(resolved.supported_summary.is_none());
}

#[test]
fn empty_final_answer_can_fall_back_to_tool_error_summary() {
    let resolved = resolve_tool_outcome(Err(vrcx_0_mcp::McpError::Custom("db unavailable".into())));
    let mut final_answer = String::new();

    assert!(apply_tool_summary_fallback(
        &mut final_answer,
        resolved.fallback_summary
    ));
    assert_eq!(final_answer, "tool error: db unavailable");
}

#[test]
fn llm_api_error_summary_omits_provider_response_body() {
    let error = AssistantLlmError::Api {
        status: 429,
        message: "rate limited for org_TESTPROVIDER123456789 req_TESTREQUEST123 model qwen".into(),
    };

    assert_eq!(llm_error_summary(&error), "LLM API error (429)");
}

#[test]
fn empty_final_answer_after_tools_uses_generic_fallback_when_summary_is_missing() {
    let mut final_answer = String::new();

    assert!(apply_empty_tool_answer_fallback(&mut final_answer, true));
    assert_eq!(final_answer, EMPTY_TOOL_FALLBACK_ANSWER);
}

#[test]
fn empty_final_answer_without_tools_still_allows_no_answer_error() {
    let mut final_answer = String::new();

    assert!(!apply_empty_tool_answer_fallback(&mut final_answer, false));
    assert!(final_answer.is_empty());
}

#[test]
fn no_answer_message_reports_both_finish_reasons() {
    let message = no_answer_message(Some("length"), None);

    assert!(
        message.contains("(finish_reason: length → none)"),
        "{message}"
    );
}

#[test]
fn direct_answer_retry_prompt_does_not_mention_tool_results() {
    assert!(!DIRECT_ANSWER_RETRY_PROMPT.contains("tool results"));
}

#[test]
fn unfinished_placeholders_are_rejected_without_supported_tool_facts() {
    let mut answer = "| 1 | [Friend Name 1] | [Time Minutes] |".to_string();

    assert_eq!(
        guard_final_answer(&mut answer, None),
        FinalAnswerGuard::Rejected("placeholder")
    );
    assert!(answer.is_empty());
}

#[test]
fn unfinished_answer_is_replaced_by_supported_tool_summary() {
    let mut answer = "请稍等，我正在为您查询。".to_string();

    assert_eq!(
        guard_final_answer(&mut answer, Some("Alice has the most mutual connections.")),
        FinalAnswerGuard::Corrected("deferred")
    );
    assert_eq!(answer, "Alice has the most mutual connections.");
}

#[test]
fn completed_ranked_answer_passes_the_guard() {
    let mut answer = "| Rank | Friend | Connections |\n| 1 | Alice | 37 |".to_string();

    assert_eq!(
        guard_final_answer(&mut answer, None),
        FinalAnswerGuard::Valid
    );
    assert_eq!(
        answer,
        "| Rank | Friend | Connections |\n| 1 | Alice | 37 |"
    );
}
