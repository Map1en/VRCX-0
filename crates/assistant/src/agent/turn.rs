use std::collections::HashSet;
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use futures_util::future::join_all;
use serde_json::Value;
use tokio_util::sync::CancellationToken;
use vrcx_0_contracts::llm::{ChatMessage, LlmRequestOptions, ToolCall, ToolDefinition};
use vrcx_0_mcp::{InProcessMcpTools, McpError, ToolCallOutcome};

use crate::entities::{extract_entities, surfaced_entities, Entity};
use crate::events::AssistantEmitter;
use crate::playbook;
use crate::ports::{AssistantLlmClient, AssistantLlmError};
use crate::session::{
    ActiveTurn, Role, SessionStore, ToolCallRecord, ToolResultRecord, TurnStatus,
};

use super::context::{build_context, latest_user_message, ContextMode};
use super::tool_budget::tool_content;
use super::tool_summary::{
    apply_tool_summary_fallback, brief_summary_from_value, normalize_tool_arguments,
    parse_arguments, tool_call_signature, tool_fact_summary, truncate,
};

// Runaway protection only: a turn that still wants tools after this many
// rounds is forced to answer from what it has. It is not a steering device.
const MAX_TOOL_ROUNDS: usize = 16;
const TOOL_CALL_TIMEOUT: Duration = Duration::from_secs(30);
const FINAL_ANSWER_PROMPT: &str = "\
Do not call any more tools. Write the final answer now, using only the tool results \
above. If the data is incomplete, say so briefly and answer with the best supported \
facts.";
const DIRECT_ANSWER_RETRY_PROMPT: &str = "\
Write the final answer now and answer the user's request directly. If the request needs \
facts that are not available, say what information is missing.";
const EMPTY_TOOL_FALLBACK_ANSWER: &str = "\
I used the available tools, but they did not return enough detail to write a reliable \
answer. Try narrowing the question or asking again.";
const UNFINISHED_ANSWER_MESSAGE: &str = "\
The model returned an unfinished response without supported tool facts. Try again or \
rephrase the question.";

const PLACEHOLDER_MARKERS: &[&str] = &[
    "[friend name",
    "[user name",
    "[username",
    "[display name",
    "[world name",
    "[time minutes",
    "[placeholder",
    "<friend name",
    "<user name",
    "<display name",
    "<time minutes",
    "{{friend",
    "{{user",
    "{{display",
    "{{time",
    "[好友名称",
    "[好友名",
    "[用户名",
    "[時間（分）",
    "[フレンド名",
    "[친구 이름",
    "[시간(분)",
];

const DEFERRED_ANSWER_MARKERS: &[&str] = &[
    "请稍等",
    "請稍等",
    "正在为您查询",
    "正在為您查詢",
    "正在查询",
    "正在查詢",
    "please wait",
    "let me check",
    "i am checking",
    "i'm checking",
    "working on it",
    "しばらくお待ち",
    "調べています",
    "確認しています",
    "잠시만 기다",
    "조회 중",
    "확인하고 있습니다",
];

pub const SYSTEM_PROMPT: &str = "\
You are the VRCX-0 social assistant. Answer questions about the signed-in user's \
(\"me\") VRChat social life. All facts come from the provided tools: local, \
observer-centered history plus the live session.

Rules:
1. Never guess social facts. Every number, ranking, date, or claim must come from a \
tool result in this conversation.
2. Missing data means \"not observed\". It never means \"did not happen\".
3. Facts about me hold even in private instances. What OTHERS did in private \
instances I did not attend is invisible — say the picture is partial.
4. I am not my own friend. Leave me out of friend lists, counts, and rankings.
5. Reflect the `caveats` a tool returns. Treat figures as approximate.

Tool arguments:
- Never repeat a tool call with the same arguments.
- When the question names a time period, set `timeWindow`. Pass a four-digit calendar \
year such as 2026 for a whole UTC year. Otherwise prefer a relative string: \"today\", \
\"yesterday\", \"this week\", \"last week\", \"this month\", \"last month\", \"7d\", \"2w\", \
\"3mo\", \"24h\", \"1y\". Use {from, to} in RFC3339 only for a custom range. Windows \
resolve in UTC; weeks start Monday. Omit `timeWindow` only when the \
user means all history (\"ever\", \"so far\"), and follow the selected tool's \
all-history guard.
- If a tool returns `needsDisambiguation`, ask the user to choose. Never invent a \
usr_ id.

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
    pub client: AssistantLlmClient,
    pub tool_defs: Arc<Vec<ToolDefinition>>,
    pub session_id: String,
    pub turn_id: String,
    pub locale: Option<String>,
    pub cancel: CancellationToken,
    pub apply_playbook: bool,
    pub options: LlmRequestOptions,
}

impl TurnContext {
    pub(crate) fn context_mode(&self) -> ContextMode {
        if self.apply_playbook {
            ContextMode::Narrator
        } else {
            ContextMode::Open
        }
    }
}

pub(crate) async fn run_turn(ctx: TurnContext) {
    let user_text = latest_user_message(&ctx).unwrap_or_default();
    let route = if ctx.apply_playbook {
        match playbook::classify_keyword(&user_text) {
            Some(pb) => Some(pb),
            None => tokio::select! {
                pb = playbook::classify_llm(ctx.client.as_ref(), &user_text) => pb,
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
    let mut last_supported_tool_summary: Option<String> = None;
    let mut dispatched_tools = HashSet::new();
    let mut last_finish_reason: Option<String> = None;
    let mut retry_finish_reason: Option<String> = None;

    for _round in 0..MAX_TOOL_ROUNDS {
        if ctx.cancel.is_cancelled() {
            return finish_cancelled(&ctx);
        }

        let turn = {
            let emitter = &ctx.emitter;
            let stream = ctx.client.stream_chat(
                &working,
                tool_defs,
                &ctx.options,
                Box::new(|delta| {
                    emitter.delta(delta);
                }),
            );
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
        last_finish_reason = turn.finish_reason.clone();

        if turn.tool_calls.is_empty() {
            final_answer = turn.content;
            break;
        }

        working.push(turn.clone().into_message());
        used_tools = true;

        // Announce and record every call in the model's order first, then run
        // the dispatchable ones concurrently; results are applied in source
        // order so the transcript and the persisted rows stay protocol-shaped.
        let prepared: Vec<PreparedCall<'_>> = turn
            .tool_calls
            .iter()
            .map(|call| {
                ctx.emitter
                    .tool_call(&call.id, &call.function.name, &call.function.arguments);
                record_tool_call(&ctx, call);
                prepare_call(
                    call,
                    tool_defs,
                    ctx.tool_defs.as_slice(),
                    utc_offset_minutes,
                    turn.truncated(),
                    &mut dispatched_tools,
                )
            })
            .collect();
        let outcomes = join_all(prepared.into_iter().map(|call| dispatch_call(&ctx, call))).await;

        for (call, resolved) in outcomes {
            let Some(resolved) = resolved else {
                return finish_cancelled(&ctx);
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
            if resolved.ok {
                if let Some(summary) = resolved.supported_summary.as_deref() {
                    last_supported_tool_summary = Some(summary.to_string());
                }
            }
            collected.extend(resolved.entities.iter().cloned());
            ctx.emitter
                .tool_result(&call.id, resolved.ok, &resolved.summary, &resolved.entities);
            record_tool_result(&ctx, call, &resolved);
            working.push(ChatMessage::tool(call.id.clone(), resolved.content));
        }
    }

    if final_answer.trim().is_empty() {
        working.push(ChatMessage::user(final_answer_retry_prompt(used_tools)));
        let retry_options = LlmRequestOptions {
            forbid_tool_calls: true,
            ..ctx.options.clone()
        };
        let turn = {
            let emitter = &ctx.emitter;
            let stream = ctx.client.stream_chat(
                &working,
                tool_defs,
                &retry_options,
                Box::new(|delta| {
                    emitter.delta(delta);
                }),
            );
            tokio::pin!(stream);
            tokio::select! {
                result = &mut stream => result,
                _ = ctx.cancel.cancelled() => return finish_cancelled(&ctx),
            }
        };
        match turn {
            Ok(turn) => {
                final_answer = turn.content;
                retry_finish_reason = turn.finish_reason;
            }
            Err(error) => return finish_llm_error(&ctx, &error),
        }
    }

    if !ctx.sessions.is_current_turn(&ctx.session_id, &ctx.turn_id) {
        return;
    }

    match guard_final_answer(&mut final_answer, last_supported_tool_summary.as_deref()) {
        FinalAnswerGuard::Valid => {}
        FinalAnswerGuard::Corrected(kind) => {
            tracing::warn!(
                kind,
                "assistant: replaced unfinished answer with tool summary"
            );
        }
        FinalAnswerGuard::Rejected(kind) => {
            tracing::warn!(
                kind,
                "assistant: rejected unfinished answer without tool summary"
            );
            ctx.emitter.answer("");
            return finish_error(&ctx, "unfinished_answer", UNFINISHED_ANSWER_MESSAGE);
        }
    }

    if final_answer.trim().is_empty() {
        let fallback_summary = last_success_tool_summary.or(last_error_tool_summary);
        apply_tool_summary_fallback(&mut final_answer, fallback_summary);
        apply_empty_tool_answer_fallback(&mut final_answer, used_tools);
    }

    if final_answer.trim().is_empty() {
        return finish_error(
            &ctx,
            "no_answer",
            &no_answer_message(
                last_finish_reason.as_deref(),
                retry_finish_reason.as_deref(),
            ),
        );
    }

    ctx.emitter.answer(&final_answer);

    match ctx
        .sessions
        .push_message(&ctx.session_id, Role::Assistant, final_answer.clone())
    {
        Ok(true) => {}
        Ok(false) => return,
        Err(error) => {
            tracing::warn!(%error, "assistant: failed to load session history before reply write");
            return finish_error(
                &ctx,
                "persistence",
                "Assistant history could not be loaded. Try again.",
            );
        }
    }

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

struct PreparedCall<'a> {
    call: &'a ToolCall,
    arguments: Option<serde_json::Map<String, Value>>,
    resolved: Option<ResolvedTool>,
}

fn prepare_call<'a>(
    call: &'a ToolCall,
    tool_defs: &[ToolDefinition],
    all_tool_defs: &[ToolDefinition],
    utc_offset_minutes: i64,
    output_truncated: bool,
    dispatched_tools: &mut HashSet<String>,
) -> PreparedCall<'a> {
    let rejected = |message: String| PreparedCall {
        call,
        arguments: None,
        resolved: Some(resolve_tool_outcome(Err(McpError::Custom(message)))),
    };
    if output_truncated {
        tracing::warn!(tool = %call.function.name, "assistant: skipped tool call from a truncated response");
        return rejected(format!(
            "tool `{}` was not run: the response hit the output token limit, so its arguments may be cut off. Re-issue the call with complete arguments.",
            call.function.name
        ));
    }
    let parsed = match parse_arguments(&call.function.arguments) {
        Ok(parsed) => parsed,
        Err(error) => {
            tracing::warn!(
                tool = %call.function.name,
                args = %call.function.arguments,
                %error,
                "assistant: tool arguments were not valid JSON"
            );
            return rejected(format!(
                "tool `{}` was not run: its arguments are not a valid JSON object ({error}). Received arguments: {}. Re-issue the call with a valid JSON object.",
                call.function.name,
                truncate(&call.function.arguments)
            ));
        }
    };
    let arguments = normalize_tool_arguments(
        &call.function.name,
        parsed,
        tool_accepts_utc_offset(all_tool_defs, &call.function.name).then_some(utc_offset_minutes),
    );
    let signature = tool_call_signature(&call.function.name, arguments.as_ref());
    let resolved = if !tool_is_available(tool_defs, &call.function.name) {
        Some(resolve_tool_outcome(Err(McpError::Custom(format!(
            "tool `{}` is not available in this session",
            call.function.name
        )))))
    } else if dispatched_tools.insert(signature) {
        None
    } else {
        tracing::warn!(
            tool = %call.function.name,
            args = %call.function.arguments,
            "assistant: skipped duplicate tool call in one turn"
        );
        Some(duplicate_tool_call_result(&call.function.name))
    };
    PreparedCall {
        call,
        arguments,
        resolved,
    }
}

// `None` means the turn was cancelled while the tool ran.
async fn dispatch_call<'a>(
    ctx: &TurnContext,
    call: PreparedCall<'a>,
) -> (&'a ToolCall, Option<ResolvedTool>) {
    if let Some(resolved) = call.resolved {
        return (call.call, Some(resolved));
    }
    let name = call.call.function.name.clone();
    let outcome = match await_tool_call(
        ctx.tools.call_tool(name.clone(), call.arguments),
        &ctx.cancel,
        TOOL_CALL_TIMEOUT,
    )
    .await
    {
        AwaitToolCall::Completed(outcome) => outcome,
        AwaitToolCall::Cancelled => return (call.call, None),
        AwaitToolCall::TimedOut => Err(McpError::Custom(format!(
            "tool `{name}` timed out after {} seconds",
            TOOL_CALL_TIMEOUT.as_secs()
        ))),
    };
    (call.call, Some(resolve_tool_outcome(outcome)))
}

fn record_tool_call(ctx: &TurnContext, call: &ToolCall) {
    if !ctx.sessions.is_current_turn(&ctx.session_id, &ctx.turn_id) {
        return;
    }
    if let Err(error) = ctx.sessions.push_tool_call(
        &ctx.session_id,
        ToolCallRecord {
            id: call.id.clone(),
            name: call.function.name.clone(),
            arguments: call.function.arguments.clone(),
        },
    ) {
        tracing::warn!(%error, "assistant: failed to record tool call");
    }
}

fn record_tool_result(ctx: &TurnContext, call: &ToolCall, resolved: &ResolvedTool) {
    if !ctx.sessions.is_current_turn(&ctx.session_id, &ctx.turn_id) {
        return;
    }
    if let Err(error) = ctx.sessions.push_tool_result(
        &ctx.session_id,
        ToolResultRecord {
            tool_call_id: call.id.clone(),
            name: call.function.name.clone(),
            ok: resolved.ok,
            summary: resolved.summary.clone(),
            entities: resolved.entities.clone(),
        },
        resolved.content.clone(),
    ) {
        tracing::warn!(%error, "assistant: failed to record tool result");
    }
}

fn tool_accepts_utc_offset(tool_defs: &[ToolDefinition], tool_name: &str) -> bool {
    tool_defs
        .iter()
        .find(|tool| tool.name == tool_name)
        .and_then(|tool| tool.parameters.get("properties"))
        .and_then(|properties| properties.get("utcOffsetMinutes"))
        .is_some()
}

fn tool_is_available(tool_defs: &[ToolDefinition], tool_name: &str) -> bool {
    tool_defs.iter().any(|tool| tool.name == tool_name)
}

enum AwaitToolCall<T> {
    Completed(T),
    Cancelled,
    TimedOut,
}

async fn await_tool_call<T>(
    future: impl Future<Output = T>,
    cancel: &CancellationToken,
    timeout: Duration,
) -> AwaitToolCall<T> {
    tokio::select! {
        result = future => AwaitToolCall::Completed(result),
        _ = cancel.cancelled() => AwaitToolCall::Cancelled,
        _ = tokio::time::sleep(timeout) => AwaitToolCall::TimedOut,
    }
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

fn finish_llm_error(ctx: &TurnContext, error: &AssistantLlmError) {
    let message = llm_error_summary(error);
    finish_error(ctx, "llm", &message);
}

fn llm_error_summary(error: &AssistantLlmError) -> String {
    match error {
        AssistantLlmError::Api { status, .. } => format!("LLM API error ({status})"),
        _ => error.to_string(),
    }
}

fn no_answer_message(first: Option<&str>, retry: Option<&str>) -> String {
    format!(
        "The model returned no reply after a direct retry (finish_reason: {} → {}). Try rephrasing or checking the selected model.",
        first.unwrap_or("none"),
        retry.unwrap_or("none"),
    )
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

fn final_answer_retry_prompt(used_tools: bool) -> &'static str {
    if used_tools {
        FINAL_ANSWER_PROMPT
    } else {
        DIRECT_ANSWER_RETRY_PROMPT
    }
}

struct ResolvedTool {
    ok: bool,
    content: String,
    summary: String,
    fallback_summary: Option<String>,
    supported_summary: Option<String>,
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
            let supported_summary = brief_summary.map(|summary| truncate(&summary));
            ResolvedTool {
                ok: !result.is_error,
                content,
                summary,
                fallback_summary,
                supported_summary,
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
                supported_summary: None,
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
        supported_summary: None,
        entities: Vec::new(),
    }
}

#[derive(Debug, PartialEq, Eq)]
enum FinalAnswerGuard {
    Valid,
    Corrected(&'static str),
    Rejected(&'static str),
}

fn guard_final_answer(
    final_answer: &mut String,
    supported_tool_summary: Option<&str>,
) -> FinalAnswerGuard {
    let Some(kind) = unfinished_answer_kind(final_answer) else {
        return FinalAnswerGuard::Valid;
    };
    let Some(summary) = supported_tool_summary
        .map(str::trim)
        .filter(|summary| !summary.is_empty())
    else {
        final_answer.clear();
        return FinalAnswerGuard::Rejected(kind);
    };
    *final_answer = summary.to_string();
    FinalAnswerGuard::Corrected(kind)
}

fn unfinished_answer_kind(answer: &str) -> Option<&'static str> {
    let normalized = answer.to_lowercase();
    if PLACEHOLDER_MARKERS
        .iter()
        .any(|marker| normalized.contains(marker))
    {
        return Some("placeholder");
    }
    DEFERRED_ANSWER_MARKERS
        .iter()
        .any(|marker| normalized.contains(marker))
        .then_some("deferred")
}

fn dedup_entities(entities: Vec<Entity>) -> Vec<Entity> {
    let mut seen = std::collections::HashSet::new();
    entities
        .into_iter()
        .filter(|entity| seen.insert(entity.id.clone()))
        .collect()
}

#[cfg(test)]
mod tests;
