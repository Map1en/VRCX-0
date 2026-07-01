use std::collections::HashSet;
use std::sync::Arc;

use chrono::{DateTime, Datelike, FixedOffset, Local, Utc};
use serde_json::{Map, Value};
use tokio_util::sync::CancellationToken;
use vrcx_0_integrations::llm::{ChatMessage, LlmClient, ToolDefinition};
use vrcx_0_mcp::{InProcessMcpTools, ToolCallOutcome};

use crate::entities::{extract_entities, surfaced_entities, Entity};
use crate::events::AssistantEmitter;
use crate::playbook;
use crate::session::{ActiveTurn, Message, Role, SessionStore, TurnStatus};

const MAX_TOOL_ROUNDS: usize = 6;
const HISTORY_LIMIT: usize = 8;
const KNOWN_REFERENCES_LIMIT: usize = 12;
const KNOWN_REFERENCE_TEXT_LIMIT: usize = 80;
const SUMMARY_LIMIT: usize = 240;
const TOOL_CONTENT_CHAR_BUDGET: usize = 64_000;
const TOOL_RESULT_ARRAY_LIMIT: usize = 100;
const TOOL_RESULT_STRING_LIMIT: usize = 4_000;
const STALE_ASSISTANT_STUB: &str = "\
[earlier assistant reply omitted; if relevant, resolve references and recompute social facts \
with tools this turn]";
const FINAL_ANSWER_PROMPT: &str = "\
Stop calling tools now and write the final answer using only the tool results already \
in this conversation. If the data is incomplete, say so briefly and answer with the \
best supported facts.";

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
    let mut last_tool_summary: Option<String> = None;
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
            Err(error) => return finish_error(&ctx, "llm", &error.to_string()),
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
            if resolved.ok {
                if let Some(summary) = resolved.fact_summary.clone() {
                    last_tool_summary = Some(summary);
                }
            }
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
            Err(error) => return finish_error(&ctx, "llm", &error.to_string()),
        }
    }

    if !ctx.sessions.is_current_turn(&ctx.session_id, &ctx.turn_id) {
        return;
    }

    if final_answer.trim().is_empty()
        && !apply_tool_summary_fallback(&mut final_answer, last_tool_summary)
    {
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

fn current_time_directive(now_local: DateTime<FixedOffset>) -> String {
    let now_utc = now_local.with_timezone(&Utc);
    let offset_minutes = now_local.offset().local_minus_utc() / 60;
    format!(
        "The current date is {date} ({weekday}), UTC — resolve relative time windows \
(\"today\", \"this week\", \"7d\", etc.) against this UTC date. The user's local timezone \
is UTC{offset}; when you show or describe timestamps to the user, convert the UTC times \
returned by tools into this local timezone. For any tool that accepts a utcOffsetMinutes \
parameter (activity timelines, streaks, or hour/weekday buckets), pass \
utcOffsetMinutes={offset_minutes} so buckets and day boundaries come back already in the \
user's local time.",
        date = now_utc.format("%Y-%m-%d"),
        weekday = now_utc.weekday(),
        offset = now_local.format("%:z"),
        offset_minutes = offset_minutes,
    )
}

fn build_context(ctx: &TurnContext, route: Option<playbook::Playbook>) -> Vec<ChatMessage> {
    let mut working = vec![
        ChatMessage::system(SYSTEM_PROMPT),
        ChatMessage::system(current_time_directive(Local::now().fixed_offset())),
    ];
    if let Some(pb) = route {
        working.push(ChatMessage::system(pb.constraint_prompt()));
    }
    if let Some(locale) = ctx
        .locale
        .as_deref()
        .map(str::trim)
        .filter(|l| !l.is_empty())
    {
        working.push(ChatMessage::system(format!(
            "Write your reply in the language that matches this interface locale code: \
{locale}. Keep proper nouns (names, world titles) as-is."
        )));
    }
    let (history, surfaced) = ctx
        .sessions
        .get(&ctx.session_id)
        .map(|session| (session.messages, session.surfaced_entities))
        .unwrap_or_default();
    working.extend(assemble_history(&history, &surfaced));
    working
}

fn latest_user_message(ctx: &TurnContext) -> Option<String> {
    ctx.sessions
        .history(&ctx.session_id)
        .into_iter()
        .rev()
        .find(|message| matches!(message.role, Role::User))
        .map(|message| message.content)
}

// Keep the most recent HISTORY_LIMIT messages as a FIFO window, but never start
// it on an assistant turn whose preceding question was evicted.
fn context_window_start(history: &[Message]) -> usize {
    let mut start = history.len().saturating_sub(HISTORY_LIMIT);
    while history
        .get(start)
        .is_some_and(|message| matches!(message.role, Role::Assistant))
    {
        start += 1;
    }
    start
}

fn assemble_history(history: &[Message], surfaced: &[Entity]) -> Vec<ChatMessage> {
    let mut out = Vec::new();
    if let Some(note) = known_references_note(surfaced) {
        out.push(ChatMessage::system(note));
    }

    let start = context_window_start(history);
    let window = &history[start..];
    let last_assistant = window
        .iter()
        .rposition(|message| matches!(message.role, Role::Assistant));

    for (index, message) in window.iter().enumerate() {
        match message.role {
            Role::User => out.push(ChatMessage::user(message.content.clone())),
            Role::Assistant if Some(index) == last_assistant => {
                out.push(ChatMessage::assistant(message.content.clone()));
            }
            Role::Assistant => out.push(ChatMessage::assistant(STALE_ASSISTANT_STUB)),
        }
    }

    out
}

fn known_references_note(surfaced: &[Entity]) -> Option<String> {
    let refs: Vec<String> = surfaced
        .iter()
        .filter_map(known_reference_entry)
        .take(KNOWN_REFERENCES_LIMIT)
        .collect();

    if refs.is_empty() {
        return None;
    }

    Some(format!(
        "Known references from earlier in this conversation. Use these ids for pronouns and \
\"that person/world\" follow-ups; they are reference hints, not social facts: {}",
        refs.join("; ")
    ))
}

fn known_reference_entry(entity: &Entity) -> Option<String> {
    let kind = clean_reference_text(&entity.kind)?;
    let id = clean_reference_text(&entity.id)?;
    let display_name = clean_reference_text(&entity.display_name)?;
    Some(format!(
        "kind={}, id={}, displayName={}",
        json_string(&kind),
        json_string(&id),
        json_string(&display_name)
    ))
}

fn clean_reference_text(text: &str) -> Option<String> {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        return None;
    }
    Some(limit_chars(&collapsed, KNOWN_REFERENCE_TEXT_LIMIT))
}

fn limit_chars(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_string();
    }

    let clipped: String = text.chars().take(limit).collect();
    format!("{clipped}...")
}

fn json_string(text: &str) -> String {
    serde_json::to_string(text).unwrap_or_else(|_| "\"\"".into())
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

struct ResolvedTool {
    ok: bool,
    content: String,
    summary: String,
    fact_summary: Option<String>,
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
            let fact_summary = tool_fact_summary(&result, &content);
            let summary = truncate(if let Some(summary) = fact_summary.as_deref() {
                summary
            } else if result.text.is_empty() {
                &content
            } else {
                &result.text
            });
            ResolvedTool {
                ok: !result.is_error,
                content,
                summary,
                fact_summary,
                entities,
            }
        }
        Err(error) => {
            let message = format!("tool error: {error}");
            ResolvedTool {
                ok: false,
                content: message.clone(),
                summary: truncate(&message),
                fact_summary: None,
                entities: Vec::new(),
            }
        }
    }
}

fn duplicate_tool_call_result(tool_name: &str) -> ResolvedTool {
    ResolvedTool {
        ok: true,
        content: format!(
            "VRCX-0 skipped a duplicate call to `{tool_name}` with the same arguments in this turn. Use the previous tool result and compose the answer now."
        ),
        summary: "Skipped duplicate tool call; use the previous result.".into(),
        fact_summary: None,
        entities: Vec::new(),
    }
}

fn normalize_tool_arguments(
    tool_name: &str,
    arguments: Option<Map<String, Value>>,
    user_text: &str,
) -> Option<Map<String, Value>> {
    let mut arguments = arguments.unwrap_or_default();
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

fn tool_call_signature(tool_name: &str, arguments: Option<&Map<String, Value>>) -> String {
    let args = arguments
        .map(|arguments| Value::Object(arguments.clone()).to_string())
        .unwrap_or_else(|| "null".into());
    format!("{tool_name}:{args}")
}

fn tool_content(result: &ToolCallOutcome) -> String {
    match result.structured.as_ref() {
        Some(value) if !value.is_null() => budget_json_tool_content(value),
        _ => budget_text_tool_content(&result.text),
    }
}

fn tool_fact_summary(result: &ToolCallOutcome, content: &str) -> Option<String> {
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

fn apply_tool_summary_fallback(
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

fn parse_arguments(raw: &str) -> Option<serde_json::Map<String, Value>> {
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

fn dedup_entities(entities: Vec<Entity>) -> Vec<Entity> {
    let mut seen = std::collections::HashSet::new();
    entities
        .into_iter()
        .filter(|entity| seen.insert(entity.id.clone()))
        .collect()
}

fn truncate(text: &str) -> String {
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

    fn message(role: Role, content: &str) -> Message {
        Message {
            id: format!("m_{content}"),
            seq: 0,
            role,
            content: content.into(),
            created_at: String::new(),
        }
    }

    fn turns(pairs: usize) -> Vec<Message> {
        let mut messages = Vec::new();
        for index in 0..pairs {
            for role in [Role::User, Role::Assistant] {
                messages.push(Message {
                    id: format!("m{}", messages.len()),
                    seq: messages.len() as u64,
                    role,
                    content: format!("c{index}"),
                    created_at: String::new(),
                });
            }
        }
        messages
    }

    fn entity(kind: &str, id: &str, display_name: &str) -> Entity {
        Entity {
            kind: kind.into(),
            id: id.into(),
            display_name: display_name.into(),
        }
    }

    #[test]
    fn keeps_everything_under_the_limit() {
        let history = turns(4);
        assert_eq!(context_window_start(&history), 0);
    }

    #[test]
    fn current_time_directive_states_utc_date_and_local_offset() {
        // 2026-06-28 06:00 at UTC+09:00 is still 2026-06-27 (Saturday) in UTC.
        let now_local = DateTime::parse_from_rfc3339("2026-06-28T06:00:00+09:00").unwrap();
        let directive = current_time_directive(now_local);
        assert!(directive.contains("2026-06-27"));
        assert!(directive.contains("Sat"));
        assert!(directive.contains("UTC+09:00"));
    }

    #[test]
    fn slides_in_pairs_and_starts_on_a_user_turn() {
        // 10 pairs = 20 messages; window keeps the most recent 8.
        let history = turns(10);
        let start = context_window_start(&history);
        assert_eq!(history.len() - start, HISTORY_LIMIT);
        assert!(matches!(history[start].role, Role::User));
    }

    #[test]
    fn skips_orphaned_leading_assistant() {
        // 4 pairs + a fresh trailing question = 9 messages; the raw window would
        // open on an assistant (index 1), so it must advance to the next user.
        let mut history = turns(4);
        history.push(Message {
            id: "q".into(),
            seq: history.len() as u64,
            role: Role::User,
            content: "new question".into(),
            created_at: String::new(),
        });
        let start = context_window_start(&history);
        assert_eq!(start, 2);
        assert!(matches!(history[start].role, Role::User));
    }

    #[test]
    fn known_references_note_returns_none_for_empty_or_invalid_entities() {
        assert!(known_references_note(&[]).is_none());

        let note = known_references_note(&[
            entity("", "usr_1", "Alice"),
            entity("user", "", "Alice"),
            entity("user", "usr_1", ""),
        ]);
        assert!(note.is_none());
    }

    #[test]
    fn known_references_note_escapes_and_cleans_entity_fields() {
        let note =
            known_references_note(&[entity("user", "usr_1", "Alice \"The\nFirst\"")]).unwrap();

        assert!(note.contains("kind=\"user\""));
        assert!(note.contains("id=\"usr_1\""));
        assert!(note.contains("displayName=\"Alice \\\"The First\\\"\""));
        assert!(!note.contains('\n'));
    }

    #[test]
    fn known_references_note_caps_entity_count() {
        let entities = (0..20)
            .map(|index| entity("user", &format!("usr_{index}"), &format!("Friend {index}")))
            .collect::<Vec<_>>();

        let note = known_references_note(&entities).unwrap();

        assert!(note.contains("usr_0"));
        assert!(note.contains("usr_11"));
        assert!(!note.contains("usr_12"));
    }

    #[test]
    fn assemble_history_stubs_stale_assistant_and_keeps_latest_assistant() {
        let history = vec![
            message(Role::User, "who did I see yesterday?"),
            message(Role::Assistant, "old ranked claim"),
            message(Role::User, "and this week?"),
            message(Role::Assistant, "fresh answer"),
            message(Role::User, "where did he go?"),
        ];

        let assembled = assemble_history(&history, &[]);

        assert_eq!(assembled.len(), 5);
        assert_eq!(assembled[0].role, "user");
        assert_eq!(
            assembled[0].content.as_deref(),
            Some("who did I see yesterday?")
        );
        assert_eq!(assembled[1].role, "assistant");
        assert_eq!(assembled[1].content.as_deref(), Some(STALE_ASSISTANT_STUB));
        assert_eq!(assembled[2].role, "user");
        assert_eq!(assembled[2].content.as_deref(), Some("and this week?"));
        assert_eq!(assembled[3].role, "assistant");
        assert_eq!(assembled[3].content.as_deref(), Some("fresh answer"));
        assert_eq!(assembled[4].role, "user");
        assert_eq!(assembled[4].content.as_deref(), Some("where did he go?"));
    }

    #[test]
    fn assemble_history_adds_known_references_note_before_messages() {
        let history = vec![message(Role::User, "he常去哪?")];
        let assembled = assemble_history(&history, &[entity("user", "usr_1", "Alice")]);

        assert_eq!(assembled.len(), 2);
        assert_eq!(assembled[0].role, "system");
        assert!(assembled[0]
            .content
            .as_deref()
            .unwrap()
            .contains("id=\"usr_1\""));
        assert_eq!(assembled[1].role, "user");
        assert_eq!(assembled[1].content.as_deref(), Some("he常去哪?"));
    }

    #[test]
    fn assemble_history_keeps_single_current_user_without_stub() {
        let history = vec![message(Role::User, "new question")];
        let assembled = assemble_history(&history, &[]);

        assert_eq!(assembled.len(), 1);
        assert_eq!(assembled[0].role, "user");
        assert_eq!(assembled[0].content.as_deref(), Some("new question"));
    }

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
            resolved.fact_summary
        ));
        assert_eq!(final_answer, "Alice is your top companion.");
    }
}
