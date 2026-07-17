use std::collections::HashSet;
use std::sync::Arc;

use serde_json::Value;
use tokio_util::sync::CancellationToken;
use vrcx_0_integrations::llm::{ChatMessage, LlmClient, LlmError, ToolDefinition};
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
Stop calling tools now and write the final answer using only the tool results already \
in this conversation. If the data is incomplete, say so briefly and answer with the \
best supported facts.";
const EMPTY_TOOL_FALLBACK_ANSWER: &str = "\
I used the available tools, but they did not return enough detail to write a reliable \
answer. Try narrowing the question or asking again.";

pub const SYSTEM_PROMPT: &str = "\
You are the VRCX-0 social assistant. Answer questions about the signed-in user's \
VRChat social life using the provided tools, which return observed facts from local \
history and the live session (centered on \"me\").

Rules:
- Call a tool instead of guessing; compose several tools for broad questions.
- Missing data means unobserved, not false. Facts about ME hold even inside private \
instances; facts about a THIRD PARTY are blind in private instances — say so.
- \"Me\" (the signed-in user) is NOT a friend. Never include myself in friend lists, \
counts, or rankings.
- Each tool result carries a `caveats` array; reflect the relevant ones instead of \
presenting figures as exact.
- For most/top/closest/ranked questions, the tools already rank and limit the rows. \
Read the top rows and answer — do NOT keep calling tools to enumerate everyone. \
Mention coverage or truncation when it matters.
- When the question names a time period, you MUST set the tool's `time_window`. Prefer a \
relative string: \"today\", \"yesterday\", \"this week\", \"last week\", \"this month\", \
\"last month\", or a rolling window like \"7d\", \"2w\", \"3mo\", \"24h\", \"1y\". Use an \
object {from, to} in RFC3339 only for a custom range. Relative windows resolve in UTC and \
weeks start on Monday. Omit `time_window` only when the user means all of history (e.g. \
\"ever\", \"so far\").

Conversation history:
- Earlier ASSISTANT turns are your own past replies, not data. They can carry stale time \
windows, dropped caveats, or earlier mistakes. Never reuse a number, ranking, time window, \
or social claim from what you said before.
- For any social fact, call a tool THIS turn and answer from this turn's tool results.
- Use history only to resolve references (\"he\", \"that world\", \"the first one\"), honor \
stated preferences, and understand what the user is following up on. The Known references \
note gives ids for names already mentioned; prefer those ids for pronouns and follow-ups.

Style:
- Stay on VRChat social topics. Be concise and refer to people by name.
- Reply in Markdown. Put any comparative or ranked numbers (activity by weekday or \
hour, top friends, time spent) in a table with a column for the value.
- Never draw charts or bars from block, box, or ASCII characters (▇ █ ▁ ─ ━ etc.); \
they misalign in proportional fonts and render as missing-character boxes.
- Use tasteful emoji to keep the tone warm and friendly.";

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
    let mut working = build_context(&ctx, route);
    let tool_defs = playbook_tools
        .as_deref()
        .or(fallback_tools.as_deref())
        .unwrap_or(ctx.tool_defs.as_slice());
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
            let stream = ctx.client.stream_chat(&working, tool_defs, |delta| {
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
            let stream = ctx.client.stream_chat(&working, &[], |delta| {
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
