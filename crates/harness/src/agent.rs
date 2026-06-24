use std::sync::Arc;

use serde_json::Value;
use tokio_util::sync::CancellationToken;
use vrcx_0_integrations::llm::{ChatMessage, LlmClient, ToolDefinition};
use vrcx_0_mcp::{InProcessMcpTools, ToolCallOutcome};

use crate::entities::{extract_entities, surfaced_entities, Entity};
use crate::events::AssistantEmitter;
use crate::session::{ActiveTurn, Message, Role, SessionStore, TurnStatus};

const MAX_TOOL_ROUNDS: usize = 6;
const HISTORY_LIMIT: usize = 16;
const SUMMARY_LIMIT: usize = 240;

pub const SYSTEM_PROMPT: &str = "\
You are the VRCX-0 social assistant. You answer questions about the signed-in user's \
VRChat social life using the provided tools, which return observed facts from local \
history and the live session (centered on \"me\").

Guidance:
- Prefer calling a tool over guessing. Compose tools for broad questions.
- Missing data means unobserved, not false. Facts about ME are reliable even inside \
private instances; facts about a THIRD PARTY are blind in private instances — say so.
- \"Me\" (the signed-in user) is NOT a friend. Never count my own data as a friend or \
include myself in friend lists, counts, or rankings.
- Each tool result carries caveats; reflect the relevant ones instead of presenting \
figures as exact.
- Stay focused on VRChat social topics. Be concise and refer to people by name.
- Format replies in Markdown (headings, bold, bullet lists, and tables where they \
help) and use tasteful emoji to keep the tone warm and friendly.
- For comparative or ranked numbers (activity by weekday/hour, top friends, time \
spent), use a Markdown table with a column for the value. Do NOT draw bar charts or \
graphs out of block/box characters (▇ █ ▁ ─ ━ etc.) or other ASCII art — they \
misalign in proportional fonts and many glyphs render as missing-character boxes.";

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
}

pub(crate) async fn run_turn(ctx: TurnContext) {
    let mut working = build_context(&ctx);
    let mut collected: Vec<Entity> = Vec::new();
    let mut final_answer = String::new();

    for _round in 0..MAX_TOOL_ROUNDS {
        if ctx.cancel.is_cancelled() {
            return finish_cancelled(&ctx);
        }

        let turn = {
            let emitter = &ctx.emitter;
            let stream = ctx
                .client
                .stream_chat(&working, ctx.tool_defs.as_slice(), |delta| {
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
            ctx.emitter
                .tool_call(&call.id, &call.function.name, &call.function.arguments);
            let arguments = parse_arguments(&call.function.arguments);
            let outcome = ctx
                .tools
                .call_tool(call.function.name.clone(), arguments)
                .await;
            let resolved = resolve_tool_outcome(outcome);
            if !resolved.ok {
                tracing::error!(
                    tool = %call.function.name,
                    args = %call.function.arguments,
                    detail = %resolved.summary,
                    "assistant: tool call failed"
                );
            }
            collected.extend(resolved.entities.iter().cloned());
            ctx.emitter
                .tool_result(&call.id, resolved.ok, &resolved.summary, &resolved.entities);
            working.push(ChatMessage::tool(call.id.clone(), resolved.content));
        }
    }

    if !ctx.sessions.is_current_turn(&ctx.session_id, &ctx.turn_id) {
        return;
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
    if !surfaced.is_empty() {
        ctx.sessions
            .set_surfaced_entities(&ctx.session_id, &surfaced);
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

fn build_context(ctx: &TurnContext) -> Vec<ChatMessage> {
    let mut working = vec![ChatMessage::system(SYSTEM_PROMPT)];
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
    let history = ctx.sessions.history(&ctx.session_id);
    let start = context_window_start(&history);
    for message in &history[start..] {
        match message.role {
            Role::User => working.push(ChatMessage::user(message.content.clone())),
            Role::Assistant => {
                working.push(ChatMessage::assistant(message.content.clone()));
            }
        }
    }
    working
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
            let content = result
                .structured
                .as_ref()
                .map(|value| value.to_string())
                .filter(|value| value != "null")
                .unwrap_or_else(|| result.text.clone());
            let summary = truncate(if result.text.is_empty() {
                &content
            } else {
                &result.text
            });
            ResolvedTool {
                ok: !result.is_error,
                content,
                summary,
                entities,
            }
        }
        Err(error) => {
            let message = format!("tool error: {error}");
            ResolvedTool {
                ok: false,
                content: message.clone(),
                summary: truncate(&message),
                entities: Vec::new(),
            }
        }
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

    #[test]
    fn keeps_everything_under_the_limit() {
        let history = turns(4);
        assert_eq!(context_window_start(&history), 0);
    }

    #[test]
    fn slides_in_pairs_and_starts_on_a_user_turn() {
        // 10 pairs = 20 messages; window keeps the most recent 16.
        let history = turns(10);
        let start = context_window_start(&history);
        assert_eq!(history.len() - start, HISTORY_LIMIT);
        assert!(matches!(history[start].role, Role::User));
    }

    #[test]
    fn skips_orphaned_leading_assistant() {
        // 8 pairs + a fresh trailing question = 17 messages; the raw window would
        // open on an assistant (index 1), so it must advance to the next user.
        let mut history = turns(8);
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
}
