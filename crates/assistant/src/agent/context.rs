use chrono::{DateTime, Datelike, FixedOffset};
use vrcx_0_contracts::llm::{ChatMessage, FunctionCall, ToolCall};

use crate::entities::Entity;
use crate::playbook;
use crate::session::{Message, Role};

use super::{TurnContext, SYSTEM_PROMPT};

const HISTORY_LIMIT: usize = 8;
const KNOWN_REFERENCES_LIMIT: usize = 12;
const KNOWN_REFERENCE_TEXT_LIMIT: usize = 80;
const OPEN_CONTEXT_CHAR_BUDGET: usize = 200_000;
const OPEN_RECENT_FULL_TURNS: usize = 2;
const STALE_ASSISTANT_STUB: &str = "\
[earlier assistant reply omitted; if relevant, resolve references and recompute social facts \
with tools this turn]";
const MISSING_TOOL_RESULT: &str = "\
[no result recorded: this call was cancelled or failed before it completed]";

const TOOLS_PROMPT: &str = "\
Tools:
- Choose tools by their descriptions. Multi-step investigation is fine: resolve a \
person, drill into their companions or activity, compare periods, then answer.
- Ranked tools pre-sort and limit rows; mention truncation or limited coverage when \
it matters.";

const NARRATOR_HISTORY_PROMPT: &str = "\
History:
- Your earlier replies are not data. Never reuse their numbers, rankings, time \
windows, or social claims — recompute with tools this turn.
- Use history only to resolve references (\"he\", \"that world\", \"the first one\"), \
honor stated preferences, and understand follow-ups. Prefer the ids from the \
\"Known references\" note.";

const OPEN_HISTORY_PROMPT: &str = "\
History:
- Earlier tool results in this conversation are real data. Reuse their ids, rows, and \
numbers to answer follow-ups without re-querying when the question is about the same \
data.
- Re-query when the question is about the current or live state, a different time \
window, or when a collapsed result no longer holds the detail you need.
- Your own earlier prose is not a data source; prefer the tool results behind it.";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ContextMode {
    Narrator,
    Open,
}

fn current_time_directive(now_local: DateTime<FixedOffset>) -> String {
    format!(
        "Current local date: {date} ({weekday}). The user's local timezone is UTC{offset}. \
Resolve relative time periods (\"today\", \"this week\", \"7d\") and calendar dates against \
this local date; tools that take utcOffsetMinutes read timeWindow calendar forms in local \
time.\n\
Convert the UTC timestamps returned by tools into this timezone when presenting them.",
        date = now_local.format("%Y-%m-%d"),
        weekday = now_local.weekday(),
        offset = now_local.format("%:z"),
    )
}

pub(super) fn build_context(
    ctx: &TurnContext,
    route: Option<playbook::Playbook>,
    now_local: DateTime<FixedOffset>,
) -> Vec<ChatMessage> {
    let (history, surfaced) = ctx
        .sessions
        .get_unscoped(&ctx.session_id)
        .map(|session| (session.messages, session.surfaced_entities))
        .unwrap_or_default();
    build_context_messages(
        ctx.context_mode(),
        ctx.locale.as_deref(),
        &history,
        &surfaced,
        route,
        now_local,
    )
}

fn build_context_messages(
    mode: ContextMode,
    locale: Option<&str>,
    history: &[Message],
    surfaced: &[Entity],
    route: Option<playbook::Playbook>,
    now_local: DateTime<FixedOffset>,
) -> Vec<ChatMessage> {
    let history_prompt = match mode {
        ContextMode::Narrator => NARRATOR_HISTORY_PROMPT,
        ContextMode::Open => OPEN_HISTORY_PROMPT,
    };
    let mut system_sections = vec![
        SYSTEM_PROMPT.to_string(),
        TOOLS_PROMPT.to_string(),
        history_prompt.to_string(),
        current_time_directive(now_local),
    ];
    if let Some(pb) = route {
        system_sections.push(pb.constraint_prompt().to_string());
    }
    if let Some(locale) = locale.map(str::trim).filter(|l| !l.is_empty()) {
        system_sections.push(format!(
            "Write the reply in the language of interface locale \"{locale}\". Keep \
proper nouns (names, world titles) as-is."
        ));
    }
    if mode == ContextMode::Narrator {
        if let Some(note) = known_references_note(surfaced) {
            system_sections.push(note);
        }
    }

    let mut working = vec![ChatMessage::system(system_sections.join("\n\n"))];
    match mode {
        ContextMode::Narrator => working.extend(assemble_narrator_history(history)),
        ContextMode::Open => working.extend(assemble_open_history(history)),
    }
    working
}

pub(super) fn latest_user_message(ctx: &TurnContext) -> Option<String> {
    ctx.sessions
        .history(&ctx.session_id)
        .into_iter()
        .rev()
        .find(|message| matches!(message.role, Role::User))
        .map(|message| message.content)
}

// Keep the most recent HISTORY_LIMIT messages as a FIFO window, but never start
// it on an assistant turn whose preceding question was evicted.
fn context_window_start(history: &[&Message]) -> usize {
    let mut start = history.len().saturating_sub(HISTORY_LIMIT);
    while history
        .get(start)
        .is_some_and(|message| matches!(message.role, Role::Assistant))
    {
        start += 1;
    }
    start
}

fn assemble_narrator_history(history: &[Message]) -> Vec<ChatMessage> {
    let history: Vec<&Message> = history
        .iter()
        .filter(|message| matches!(message.role, Role::User | Role::Assistant))
        .collect();
    let mut out = Vec::new();
    let start = context_window_start(&history);
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
            Role::ToolCall | Role::ToolResult => {}
        }
    }

    out
}

// One user question plus everything the model did in response to it.
struct OpenTurn {
    messages: Vec<ChatMessage>,
    chars: usize,
}

fn assemble_open_history(history: &[Message]) -> Vec<ChatMessage> {
    let turns = split_open_turns(history);
    let recent_start = turns.len().saturating_sub(OPEN_RECENT_FULL_TURNS);
    let mut budgeted: Vec<OpenTurn> = Vec::with_capacity(turns.len());
    for (index, turn) in turns.into_iter().enumerate() {
        budgeted.push(if index < recent_start {
            collapse_turn(turn)
        } else {
            turn
        });
    }

    let mut keep_from = budgeted.len().saturating_sub(1);
    let mut chars = budgeted.last().map_or(0, |turn| turn.chars);
    while keep_from > 0 {
        let next = budgeted[keep_from - 1].chars;
        if chars + next > OPEN_CONTEXT_CHAR_BUDGET {
            break;
        }
        chars += next;
        keep_from -= 1;
    }

    budgeted
        .into_iter()
        .skip(keep_from)
        .flat_map(|turn| turn.messages)
        .collect()
}

fn split_open_turns(history: &[Message]) -> Vec<OpenTurn> {
    let mut turns: Vec<OpenTurn> = Vec::new();
    let mut pending_calls: Vec<ToolCall> = Vec::new();
    let mut unanswered: Vec<String> = Vec::new();

    fn push(turns: &mut Vec<OpenTurn>, message: ChatMessage) {
        if turns.is_empty() {
            turns.push(OpenTurn {
                messages: Vec::new(),
                chars: 0,
            });
        }
        let turn = turns.last_mut().expect("turn exists");
        turn.chars += message_chars(&message);
        turn.messages.push(message);
    }

    fn flush_calls(
        turns: &mut Vec<OpenTurn>,
        calls: &mut Vec<ToolCall>,
        unanswered: &mut Vec<String>,
    ) {
        if calls.is_empty() {
            return;
        }
        unanswered.extend(calls.iter().map(|call| call.id.clone()));
        push(
            turns,
            ChatMessage {
                role: "assistant".into(),
                content: None,
                tool_calls: std::mem::take(calls),
                reasoning_details: Vec::new(),
                tool_call_id: None,
            },
        );
    }

    fn settle_unanswered(turns: &mut Vec<OpenTurn>, unanswered: &mut Vec<String>) {
        for id in unanswered.drain(..) {
            push(turns, ChatMessage::tool(id, MISSING_TOOL_RESULT));
        }
    }

    for message in history {
        match message.role {
            Role::User => {
                flush_calls(&mut turns, &mut pending_calls, &mut unanswered);
                settle_unanswered(&mut turns, &mut unanswered);
                turns.push(OpenTurn {
                    messages: Vec::new(),
                    chars: 0,
                });
                push(&mut turns, ChatMessage::user(message.content.clone()));
            }
            Role::Assistant => {
                flush_calls(&mut turns, &mut pending_calls, &mut unanswered);
                settle_unanswered(&mut turns, &mut unanswered);
                push(&mut turns, ChatMessage::assistant(message.content.clone()));
            }
            Role::ToolCall => {
                let Some(record) = message.tool_call.as_ref() else {
                    continue;
                };
                pending_calls.push(ToolCall {
                    id: record.id.clone(),
                    kind: "function".into(),
                    function: FunctionCall {
                        name: record.name.clone(),
                        arguments: record.arguments.clone(),
                    },
                });
            }
            Role::ToolResult => {
                let Some(record) = message.tool_result.as_ref() else {
                    continue;
                };
                flush_calls(&mut turns, &mut pending_calls, &mut unanswered);
                let Some(position) = unanswered.iter().position(|id| *id == record.tool_call_id)
                else {
                    continue;
                };
                unanswered.remove(position);
                let content = message
                    .tool_content
                    .clone()
                    .filter(|content| !content.is_empty())
                    .unwrap_or_else(|| collapsed_tool_content(&record.summary));
                push(
                    &mut turns,
                    ChatMessage::tool(record.tool_call_id.clone(), content),
                );
            }
        }
    }
    flush_calls(&mut turns, &mut pending_calls, &mut unanswered);
    settle_unanswered(&mut turns, &mut unanswered);
    turns
}

fn collapse_turn(turn: OpenTurn) -> OpenTurn {
    let mut collapsed = OpenTurn {
        messages: Vec::with_capacity(turn.messages.len()),
        chars: 0,
    };
    for mut message in turn.messages {
        if message.role == "tool" {
            let summary = message
                .content
                .as_deref()
                .map(tool_summary_from_content)
                .unwrap_or_default();
            message.content = Some(collapsed_tool_content(&summary));
        }
        collapsed.chars += message_chars(&message);
        collapsed.messages.push(message);
    }
    collapsed
}

const COLLAPSED_PREFIX: &str = "[tool result collapsed to its summary] ";
const COLLAPSED_SUMMARY_LIMIT: usize = 240;

fn collapsed_tool_content(summary: &str) -> String {
    let summary = summary.trim();
    if summary.is_empty() {
        return format!("{COLLAPSED_PREFIX}(no summary available; re-run the tool if needed)");
    }
    format!("{COLLAPSED_PREFIX}{summary}")
}

// Full tool content is the budgeted JSON the model saw; its top-level `summary`
// is the deterministic collapse unit. Text results and already-collapsed
// results fall back to a clipped prefix.
fn tool_summary_from_content(content: &str) -> String {
    if let Some(rest) = content.strip_prefix(COLLAPSED_PREFIX) {
        return rest.to_string();
    }
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(content) {
        if let Some(summary) = value.get("summary").and_then(|value| value.as_str()) {
            return summary.to_string();
        }
    }
    limit_chars(content.trim(), COLLAPSED_SUMMARY_LIMIT)
}

fn message_chars(message: &ChatMessage) -> usize {
    message
        .content
        .as_deref()
        .map_or(0, |content| content.chars().count())
        + message
            .tool_calls
            .iter()
            .map(|call| call.function.name.len() + call.function.arguments.chars().count())
            .sum::<usize>()
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
    let kind = entity.kind.as_str();
    let id = clean_reference_text(&entity.id)?;
    let display_name = clean_reference_text(&entity.display_name)?;
    Some(format!(
        "kind={}, id={}, displayName={}",
        json_string(kind),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::{ToolCallRecord, ToolResultRecord};

    fn message(role: Role, content: &str) -> Message {
        Message {
            id: format!("m_{content}"),
            seq: 0,
            role,
            content: content.into(),
            created_at: String::new(),
            tool_call: None,
            tool_result: None,
            tool_content: None,
        }
    }

    fn tool_call(id: &str, name: &str, arguments: &str) -> Message {
        Message {
            id: format!("m_{id}"),
            seq: 0,
            role: Role::ToolCall,
            content: String::new(),
            created_at: String::new(),
            tool_call: Some(ToolCallRecord {
                id: id.into(),
                name: name.into(),
                arguments: arguments.into(),
            }),
            tool_result: None,
            tool_content: None,
        }
    }

    fn tool_result(id: &str, summary: &str, content: &str) -> Message {
        Message {
            id: format!("m_{id}_result"),
            seq: 0,
            role: Role::ToolResult,
            content: String::new(),
            created_at: String::new(),
            tool_call: None,
            tool_result: Some(ToolResultRecord {
                tool_call_id: id.into(),
                name: "tool".into(),
                ok: true,
                summary: summary.into(),
                entities: Vec::new(),
            }),
            tool_content: Some(content.into()),
        }
    }

    fn turns(pairs: usize) -> Vec<Message> {
        let mut messages = Vec::new();
        for index in 0..pairs {
            for role in [Role::User, Role::Assistant] {
                let mut message = message(role, &format!("c{index}"));
                message.id = format!("m{}", messages.len());
                message.seq = messages.len() as u64;
                messages.push(message);
            }
        }
        messages
    }

    fn entity(id: &str, display_name: &str) -> Entity {
        Entity {
            kind: crate::entities::EntityKind::User,
            id: id.into(),
            display_name: display_name.into(),
        }
    }

    fn refs(history: &[Message]) -> Vec<&Message> {
        history.iter().collect()
    }

    #[test]
    fn keeps_everything_under_the_limit() {
        let history = turns(4);
        assert_eq!(context_window_start(&refs(&history)), 0);
    }

    #[test]
    fn current_time_directive_states_the_local_date_and_offset() {
        let now_local = DateTime::parse_from_rfc3339("2026-06-28T06:00:00+09:00").unwrap();
        let directive = current_time_directive(now_local);
        assert!(directive.contains("Current local date: 2026-06-28 (Sun)"));
        assert!(directive.contains("UTC+09:00"));
        assert!(!directive.contains("2026-06-27"));
    }

    #[test]
    fn slides_in_pairs_and_starts_on_a_user_turn() {
        // 10 pairs = 20 messages; window keeps the most recent 8.
        let history = turns(10);
        let start = context_window_start(&refs(&history));
        assert_eq!(history.len() - start, HISTORY_LIMIT);
        assert!(matches!(history[start].role, Role::User));
    }

    #[test]
    fn skips_orphaned_leading_assistant() {
        // 4 pairs + a fresh trailing question = 9 messages; the raw window would
        // open on an assistant (index 1), so it must advance to the next user.
        let mut history = turns(4);
        history.push(message(Role::User, "new question"));
        let start = context_window_start(&refs(&history));
        assert_eq!(start, 2);
        assert!(matches!(history[start].role, Role::User));
    }

    #[test]
    fn known_references_note_returns_none_for_empty_or_invalid_entities() {
        assert!(known_references_note(&[]).is_none());

        let note = known_references_note(&[entity("", "Alice"), entity("usr_1", "")]);
        assert!(note.is_none());
    }

    #[test]
    fn known_references_note_escapes_and_cleans_entity_fields() {
        let note = known_references_note(&[entity("usr_1", "Alice \"The\nFirst\"")]).unwrap();

        assert!(note.contains("kind=\"user\""));
        assert!(note.contains("id=\"usr_1\""));
        assert!(note.contains("displayName=\"Alice \\\"The First\\\"\""));
        assert!(!note.contains('\n'));
    }

    #[test]
    fn known_references_note_caps_entity_count() {
        let entities = (0..20)
            .map(|index| entity(&format!("usr_{index}"), &format!("Friend {index}")))
            .collect::<Vec<_>>();

        let note = known_references_note(&entities).unwrap();

        assert!(note.contains("usr_0"));
        assert!(note.contains("usr_11"));
        assert!(!note.contains("usr_12"));
    }

    #[test]
    fn narrator_history_stubs_stale_assistant_and_drops_tool_rows() {
        let history = vec![
            message(Role::User, "who did I see yesterday?"),
            tool_call("call_1", "get_copresence_summary", "{}"),
            tool_result(
                "call_1",
                "Alice tops the list.",
                "{\"summary\":\"Alice tops the list.\"}",
            ),
            message(Role::Assistant, "old ranked claim"),
            message(Role::User, "and this week?"),
            message(Role::Assistant, "fresh answer"),
            message(Role::User, "where did he go?"),
        ];

        let assembled = assemble_narrator_history(&history);

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
    fn build_context_uses_one_leading_system_message_per_mode() {
        let history = vec![message(Role::User, "he常去哪?")];
        let now = DateTime::parse_from_rfc3339("2026-06-28T06:00:00+09:00").unwrap();

        let narrator = build_context_messages(
            ContextMode::Narrator,
            Some("zh-CN"),
            &history,
            &[entity("usr_1", "Alice")],
            playbook::classify_keyword("best time to play"),
            now,
        );
        let roles: Vec<&str> = narrator.iter().map(|m| m.role.as_str()).collect();
        assert_eq!(roles, vec!["system", "user"]);
        let system = narrator[0].content.as_deref().unwrap();
        assert!(system.contains("id=\"usr_1\""));
        assert!(system.contains("zh-CN"));
        assert!(system.contains("Your earlier replies are not data"));
        assert!(!system.contains("Earlier tool results in this conversation are real data"));
        assert!(system.contains("Multi-step investigation is fine"));

        let open = build_context_messages(
            ContextMode::Open,
            Some("zh-CN"),
            &history,
            &[entity("usr_1", "Alice")],
            None,
            now,
        );
        let roles: Vec<&str> = open.iter().map(|m| m.role.as_str()).collect();
        assert_eq!(roles, vec!["system", "user"]);
        let system = open[0].content.as_deref().unwrap();
        assert!(!system.contains("Known references"));
        assert!(system.contains("Earlier tool results in this conversation are real data"));
    }

    #[test]
    fn narrator_history_keeps_single_current_user_without_stub() {
        let history = vec![message(Role::User, "new question")];
        let assembled = assemble_narrator_history(&history);

        assert_eq!(assembled.len(), 1);
        assert_eq!(assembled[0].role, "user");
        assert_eq!(assembled[0].content.as_deref(), Some("new question"));
    }

    #[test]
    fn open_history_replays_tool_calls_and_results_in_protocol_order() {
        let history = vec![
            message(Role::User, "who do I play with?"),
            tool_call("call_1", "find_user", "{\"query\":\"Alice\"}"),
            tool_call("call_2", "get_copresence_summary", "{}"),
            tool_result("call_1", "Found Alice.", "{\"summary\":\"Found Alice.\"}"),
            tool_result(
                "call_2",
                "Alice tops the list.",
                "{\"summary\":\"Alice tops the list.\",\"rows\":[]}",
            ),
            message(Role::Assistant, "Alice, mostly."),
            message(Role::User, "what about her last week?"),
        ];

        let assembled = assemble_open_history(&history);
        let roles: Vec<&str> = assembled.iter().map(|m| m.role.as_str()).collect();
        assert_eq!(
            roles,
            vec!["user", "assistant", "tool", "tool", "assistant", "user"]
        );
        assert_eq!(assembled[1].tool_calls.len(), 2);
        assert_eq!(assembled[1].tool_calls[0].id, "call_1");
        assert_eq!(
            assembled[1].tool_calls[1].function.name,
            "get_copresence_summary"
        );
        assert_eq!(assembled[2].tool_call_id.as_deref(), Some("call_1"));
        assert_eq!(
            assembled[3].content.as_deref(),
            Some("{\"summary\":\"Alice tops the list.\",\"rows\":[]}")
        );
        assert_eq!(assembled[4].content.as_deref(), Some("Alice, mostly."));
    }

    #[test]
    fn open_history_synthesizes_results_for_orphaned_calls_and_drops_stray_results() {
        let history = vec![
            message(Role::User, "q1"),
            tool_call("call_1", "find_user", "{}"),
            message(Role::User, "q2"),
            tool_result("call_ghost", "stray", "{}"),
            message(Role::Assistant, "a2"),
        ];

        let assembled = assemble_open_history(&history);
        let roles: Vec<&str> = assembled.iter().map(|m| m.role.as_str()).collect();
        assert_eq!(
            roles,
            vec!["user", "assistant", "tool", "user", "assistant"]
        );
        assert_eq!(assembled[2].tool_call_id.as_deref(), Some("call_1"));
        assert_eq!(assembled[2].content.as_deref(), Some(MISSING_TOOL_RESULT));
    }

    #[test]
    fn open_history_collapses_tool_results_older_than_the_recent_turns() {
        let old_content = "{\"summary\":\"Alice tops the list.\",\"rows\":[{\"a\":1}]}";
        let history = vec![
            message(Role::User, "q1"),
            tool_call("call_1", "t", "{}"),
            tool_result("call_1", "Alice tops the list.", old_content),
            message(Role::Assistant, "a1"),
            message(Role::User, "q2"),
            tool_call("call_2", "t", "{}"),
            tool_result(
                "call_2",
                "Bob tops the list.",
                "{\"summary\":\"Bob tops the list.\"}",
            ),
            message(Role::Assistant, "a2"),
            message(Role::User, "q3"),
        ];

        let assembled = assemble_open_history(&history);
        let first_tool = assembled.iter().find(|m| m.role == "tool").unwrap();
        assert_eq!(
            first_tool.content.as_deref(),
            Some("[tool result collapsed to its summary] Alice tops the list.")
        );
        let second_tool = assembled
            .iter()
            .filter(|m| m.role == "tool")
            .nth(1)
            .unwrap();
        assert_eq!(
            second_tool.content.as_deref(),
            Some("{\"summary\":\"Bob tops the list.\"}")
        );
    }

    #[test]
    fn open_history_drops_oldest_turns_over_the_char_budget() {
        let big = "x".repeat(OPEN_CONTEXT_CHAR_BUDGET / 2 + 1);
        let history = vec![
            message(Role::User, &big),
            message(Role::Assistant, "a1"),
            message(Role::User, &big),
            message(Role::Assistant, "a2"),
            message(Role::User, "q3"),
        ];

        let assembled = assemble_open_history(&history);
        let roles: Vec<&str> = assembled.iter().map(|m| m.role.as_str()).collect();
        assert_eq!(roles, vec!["user", "assistant", "user"]);
        assert_eq!(assembled[2].content.as_deref(), Some("q3"));
    }

    #[test]
    fn open_history_always_keeps_the_current_question() {
        let big = "x".repeat(OPEN_CONTEXT_CHAR_BUDGET + 10);
        let history = vec![message(Role::User, &big)];

        let assembled = assemble_open_history(&history);
        assert_eq!(assembled.len(), 1);
        assert_eq!(assembled[0].role, "user");
    }
}
