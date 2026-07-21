use std::collections::HashSet;
use std::sync::Arc;

use serde_json::Value;
use tokio_util::sync::CancellationToken;
use vrcx_0_integrations::llm::{
    ChatMessage, LlmClient, LlmError, LlmRequestOptions, ToolDefinition,
};
use vrcx_0_mcp::{InProcessMcpTools, ToolCallOutcome};

use crate::entities::{extract_entities, surfaced_entities, Entity};
use crate::events::AssistantEmitter;
use crate::playbook;
use crate::session::{ActiveTurn, Role, SessionStore, TurnStatus};

use super::context::{build_context, latest_user_message};
use super::tool_budget::tool_content;
use super::tool_summary::{
    apply_tool_summary_fallback, brief_summary_from_value, normalize_tool_arguments,
    parse_arguments, tool_call_signature, tool_fact_summary, truncate,
};

const MAX_TOOL_ROUNDS: usize = 6;
const FINAL_ANSWER_PROMPT: &str = "\
Do not call any more tools. Write the final answer now, using only the tool results \
above. If the data is incomplete, say so briefly and answer with the best supported \
facts.";
const EMPTY_TOOL_FALLBACK_ANSWER: &str = "\
I used the available tools, but they did not return enough detail to write a reliable \
answer. Try narrowing the question or asking again.";

pub const SYSTEM_PROMPT: &str = "\
You are the VRCX-0 social assistant. Answer questions about the signed-in user's \
(\"me\") VRChat social life. All facts come from the provided tools: local, \
observer-centered history plus the live session.

Rules:
1. Never guess social facts. For any number, ranking, date, or claim: call a tool \
this turn and answer only from this turn's results.
2. Missing data means \"not observed\". It never means \"did not happen\".
3. Facts about me hold even in private instances. What OTHERS did in private \
instances I did not attend is invisible — say the picture is partial.
4. I am not my own friend. Leave me out of friend lists, counts, and rankings.
5. Reflect the `caveats` a tool returns. Treat figures as approximate.

Tools:
- Pick the one tool whose description fits the question. Use several tools only for \
broad questions.
- Ranked tools pre-sort and limit rows. Read the top rows and answer. Do not call \
more tools to enumerate everyone. Mention truncation or limited coverage when it \
matters.
- Never repeat a tool call with the same arguments.
- When the question names a time period, set `timeWindow`. Prefer a relative string: \
\"today\", \"yesterday\", \"this week\", \"last week\", \"this month\", \"last month\", \
\"7d\", \"2w\", \"3mo\", \"24h\", \"1y\". Use {from, to} in RFC3339 only for a custom \
range. Windows resolve in UTC; weeks start Monday. Omit `timeWindow` only when the \
user means all history (\"ever\", \"so far\").
- If a tool returns `needsDisambiguation`, ask the user to choose. Never invent a \
usr_ id.

History:
- Your earlier replies are not data. Never reuse their numbers, rankings, time \
windows, or social claims — recompute with tools this turn.
- Use history only to resolve references (\"he\", \"that world\", \"the first one\"), \
honor stated preferences, and understand follow-ups. Prefer the ids from the \
\"Known references\" note.

Style:
- Answer directly; do not narrate plans or tool calls.
- Reply in Markdown. Stay on VRChat social topics. Refer to people by name. Be \
concise; use tasteful emoji to keep the tone warm.
- Put comparative or ranked numbers in a Markdown table with a value column.
- Never draw charts from text characters (▇ █ ▁ ─ etc.); use a table instead.";

pub(crate) struct TurnContext {
    pub tools: Arc<InProcessMcpTools>,
    pub sessions: Arc<SessionStore>,
    pub emitter: AssistantEmitter,
    pub client: LlmClient,
    pub tool_defs: Arc<Vec<ToolDefinition>>,
    pub session_id: String,
    pub turn_id: String,
    pub locale: Option<String>,
    pub cancel: CancellationToken,
    pub apply_playbook: bool,
    pub options: LlmRequestOptions,
}

pub(crate) async fn run_turn(ctx: TurnContext) {
    let user_text = latest_user_message(&ctx).unwrap_or_default();
    let route = if ctx.apply_playbook {
        match playbook::classify_keyword(&user_text) {
            Some(pb) => Some(pb),
            None => tokio::select! {
                pb = playbook::classify_llm(&ctx.client, &user_text) => pb,
                _ = ctx.cancel.cancelled() => return finish_cancelled(&ctx),
            },
        }
    } else {
        None
    };
    let playbook_tools = route
        .map(|pb| pb.filter_tools(ctx.tool_defs.as_slice()))
        .filter(|tools| !tools.is_empty());
    let route = route.filter(|_| playbook_tools.is_some());
    // On a classify miss while a playbook mode is active, fall back to the
    // curated weak-model toolset (full minus advanced/non-answer tools) rather
    // than the whole surface. Open mode keeps everything.
    let fallback_tools = (ctx.apply_playbook && playbook_tools.is_none())
        .then(|| playbook::weak_fallback_tools(ctx.tool_defs.as_slice()));
    let now_local = chrono::Local::now().fixed_offset();
    let mut working = build_context(&ctx, route, now_local);
    let tool_defs = playbook_tools
        .as_deref()
        .or(fallback_tools.as_deref())
        .unwrap_or(ctx.tool_defs.as_slice());
    let utc_offset_minutes = i64::from(now_local.offset().local_minus_utc()) / 60;
    let mut collected: Vec<Entity> = Vec::new();
    let mut final_answer = String::new();
    let mut used_tools = false;
    let mut last_success_tool_summary: Option<String> = None;
    let mut last_error_tool_summary: Option<String> = None;
    let mut dispatched_tools = HashSet::new();

    for _round in 0..MAX_TOOL_ROUNDS {
        if ctx.cancel.is_cancelled() {
            return finish_cancelled(&ctx);
        }

        let turn = {
            let emitter = &ctx.emitter;
            let stream = ctx
                .client
                .stream_chat(&working, tool_defs, &ctx.options, |delta| {
                    emitter.delta(delta);
                });
            tokio::pin!(stream);
            tokio::select! {
                result = &mut stream => result,
                _ = ctx.cancel.cancelled() => return finish_cancelled(&ctx),
            }
        };

        let turn = match turn {
            Ok(turn) => turn,
            Err(error) => return finish_llm_error(&ctx, &error),
        };

        if turn.tool_calls.is_empty() {
            final_answer = turn.content;
            break;
        }

        working.push(turn.clone().into_message());
        for call in &turn.tool_calls {
            used_tools = true;
            ctx.emitter
                .tool_call(&call.id, &call.function.name, &call.function.arguments);
            let arguments = normalize_tool_arguments(
                &call.function.name,
                parse_arguments(&call.function.arguments),
                &user_text,
                tool_accepts_utc_offset(ctx.tool_defs.as_slice(), &call.function.name)
                    .then_some(utc_offset_minutes),
            );
            let signature = tool_call_signature(&call.function.name, arguments.as_ref());
            let resolved = if dispatched_tools.insert(signature) {
                let outcome = ctx
                    .tools
                    .call_tool(call.function.name.clone(), arguments)
                    .await;
                resolve_tool_outcome(outcome)
            } else {
                tracing::warn!(
                    tool = %call.function.name,
                    args = %call.function.arguments,
                    "assistant: skipped duplicate tool call in one turn"
                );
                duplicate_tool_call_result(&call.function.name)
            };
            if !resolved.ok {
                tracing::warn!(
                    tool = %call.function.name,
                    args = %call.function.arguments,
                    detail = %resolved.summary,
                    "assistant: tool call failed"
                );
            }
            remember_resolved_tool_summary(
                &resolved,
                &mut last_success_tool_summary,
                &mut last_error_tool_summary,
            );
            collected.extend(resolved.entities.iter().cloned());
            ctx.emitter
                .tool_result(&call.id, resolved.ok, &resolved.summary, &resolved.entities);
            working.push(ChatMessage::tool(call.id.clone(), resolved.content));
        }
    }

    if final_answer.trim().is_empty() && used_tools {
        working.push(ChatMessage::user(FINAL_ANSWER_PROMPT));
        let turn = {
            let emitter = &ctx.emitter;
            let stream = ctx
                .client
                .stream_chat(&working, &[], &ctx.options, |delta| {
                    emitter.delta(delta);
                });
            tokio::pin!(stream);
            tokio::select! {
                result = &mut stream => result,
                _ = ctx.cancel.cancelled() => return finish_cancelled(&ctx),
            }
        };
        match turn {
            Ok(turn) => {
                final_answer = turn.content;
            }
            Err(error) => return finish_llm_error(&ctx, &error),
        }
    }

    if !ctx.sessions.is_current_turn(&ctx.session_id, &ctx.turn_id) {
        return;
    }

    if final_answer.trim().is_empty() {
        let fallback_summary = last_success_tool_summary.or(last_error_tool_summary);
        if apply_tool_summary_fallback(&mut final_answer, fallback_summary)
            || apply_empty_tool_answer_fallback(&mut final_answer, used_tools)
        {
            ctx.emitter.delta(&final_answer);
        }
    }

    if final_answer.trim().is_empty() {
        return finish_error(
            &ctx,
            "no_answer",
            "Stopped after using tools without composing a reply. Try rephrasing or narrowing your question.",
        );
    }

    ctx.sessions
        .push_message(&ctx.session_id, Role::Assistant, final_answer.clone());

    let surfaced = surfaced_entities(dedup_entities(collected), &final_answer);
    ctx.sessions
        .set_surfaced_entities(&ctx.session_id, &surfaced);
    if !surfaced.is_empty() {
        ctx.emitter.turn_entities(&surfaced);
    }

    ctx.sessions.set_active_turn(
        &ctx.session_id,
        Some(ActiveTurn {
            turn_id: ctx.turn_id.clone(),
            status: TurnStatus::Done,
        }),
    );
    ctx.emitter.done();
}

fn tool_accepts_utc_offset(tool_defs: &[ToolDefinition], tool_name: &str) -> bool {
    tool_defs
        .iter()
        .find(|tool| tool.name == tool_name)
        .and_then(|tool| tool.parameters.get("properties"))
        .and_then(|properties| properties.get("utcOffsetMinutes"))
        .is_some()
}

fn finish_cancelled(ctx: &TurnContext) {
    if !ctx.sessions.is_current_turn(&ctx.session_id, &ctx.turn_id) {
        return;
    }
    ctx.sessions.set_active_turn(
        &ctx.session_id,
        Some(ActiveTurn {
            turn_id: ctx.turn_id.clone(),
            status: TurnStatus::Cancelled,
        }),
    );
    ctx.emitter.error("cancelled", "Turn cancelled.");
}

fn finish_llm_error(ctx: &TurnContext, error: &LlmError) {
    let message = llm_error_summary(error);
    finish_error(ctx, "llm", &message);
}

fn llm_error_summary(error: &LlmError) -> String {
    match error {
        LlmError::Api { status, .. } => format!("LLM API error ({status})"),
        _ => error.to_string(),
    }
}

fn finish_error(ctx: &TurnContext, code: &str, message: &str) {
    if !ctx.sessions.is_current_turn(&ctx.session_id, &ctx.turn_id) {
        return;
    }
    ctx.sessions.set_active_turn(
        &ctx.session_id,
        Some(ActiveTurn {
            turn_id: ctx.turn_id.clone(),
            status: TurnStatus::Error,
        }),
    );
    ctx.emitter.error(code, message);
}

fn apply_empty_tool_answer_fallback(final_answer: &mut String, used_tools: bool) -> bool {
    if !used_tools || !final_answer.trim().is_empty() {
        return false;
    }
    *final_answer = EMPTY_TOOL_FALLBACK_ANSWER.to_string();
    true
}

struct ResolvedTool {
    ok: bool,
    content: String,
    summary: String,
    fallback_summary: Option<String>,
    entities: Vec<Entity>,
}

fn resolve_tool_outcome(outcome: Result<ToolCallOutcome, vrcx_0_mcp::McpError>) -> ResolvedTool {
    match outcome {
        Ok(result) => {
            let entities = result
                .structured
                .as_ref()
                .map(extract_entities)
                .or_else(|| {
                    serde_json::from_str::<Value>(&result.text)
                        .ok()
                        .map(|value| extract_entities(&value))
                })
                .unwrap_or_default();
            let content = tool_content(&result);
            let brief_summary = tool_fact_summary(&result, &content).or_else(|| {
                result
                    .structured
                    .as_ref()
                    .and_then(brief_summary_from_value)
            });
            let summary = truncate(
                brief_summary
                    .as_deref()
                    .unwrap_or(if result.text.is_empty() {
                        &content
                    } else {
                        &result.text
                    }),
            );
            let fallback_summary = (!summary.trim().is_empty()).then(|| summary.clone());
            ResolvedTool {
                ok: !result.is_error,
                content,
                summary,
                fallback_summary,
                entities,
            }
        }
        Err(error) => {
            let message = format!("tool error: {error}");
            let summary = truncate(&message);
            ResolvedTool {
                ok: false,
                content: message.clone(),
                summary: summary.clone(),
                fallback_summary: Some(summary),
                entities: Vec::new(),
            }
        }
    }
}

fn remember_resolved_tool_summary(
    resolved: &ResolvedTool,
    last_success_tool_summary: &mut Option<String>,
    last_error_tool_summary: &mut Option<String>,
) {
    remember_tool_summary(
        resolved.ok,
        resolved.fallback_summary.as_deref(),
        last_success_tool_summary,
        last_error_tool_summary,
    );
}

fn remember_tool_summary(
    ok: bool,
    summary: Option<&str>,
    last_success_tool_summary: &mut Option<String>,
    last_error_tool_summary: &mut Option<String>,
) {
    let Some(summary) = summary.map(str::trim).filter(|summary| !summary.is_empty()) else {
        return;
    };
    if ok {
        *last_success_tool_summary = Some(summary.to_string());
    } else {
        *last_error_tool_summary = Some(summary.to_string());
    }
}

fn duplicate_tool_call_result(tool_name: &str) -> ResolvedTool {
    ResolvedTool {
        ok: true,
        content: format!(
            "VRCX-0 skipped a duplicate call to `{tool_name}` with the same arguments in this turn. Use the previous tool result and compose the answer now."
        ),
        summary: "Skipped duplicate tool call; use the previous result.".into(),
        fallback_summary: None,
        entities: Vec::new(),
    }
}

fn dedup_entities(entities: Vec<Entity>) -> Vec<Entity> {
    let mut seen = std::collections::HashSet::new();
    entities
        .into_iter()
        .filter(|entity| seen.insert(entity.id.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn system_prompt_keeps_core_boundaries_and_schema_field_names() {
        for phrase in [
            "not observed",
            "private instances",
            "not my own friend",
            "caveats",
            "needsDisambiguation",
            "`timeWindow`",
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
    fn empty_final_answer_can_fall_back_to_tool_error_summary() {
        let resolved =
            resolve_tool_outcome(Err(vrcx_0_mcp::McpError::Custom("db unavailable".into())));
        let mut final_answer = String::new();

        assert!(apply_tool_summary_fallback(
            &mut final_answer,
            resolved.fallback_summary
        ));
        assert_eq!(final_answer, "tool error: db unavailable");
    }

    #[test]
    fn llm_api_error_summary_omits_provider_response_body() {
        let error = LlmError::Api {
            status: 429,
            message: "rate limited for org_TESTPROVIDER123456789 req_TESTREQUEST123 model qwen"
                .into(),
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
}
