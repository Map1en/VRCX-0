use chrono::{DateTime, Datelike, FixedOffset, Local, Utc};
use vrcx_0_integrations::llm::ChatMessage;

use crate::entities::Entity;
use crate::playbook;
use crate::session::{Message, Role};

use super::{TurnContext, SYSTEM_PROMPT};

const HISTORY_LIMIT: usize = 8;
const KNOWN_REFERENCES_LIMIT: usize = 12;
const KNOWN_REFERENCE_TEXT_LIMIT: usize = 80;
const STALE_ASSISTANT_STUB: &str = "\
[earlier assistant reply omitted; if relevant, resolve references and recompute social facts \
with tools this turn]";

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

pub(super) fn build_context(
    ctx: &TurnContext,
    route: Option<playbook::Playbook>,
) -> Vec<ChatMessage> {
    let (history, surfaced) = ctx
        .sessions
        .get_unscoped(&ctx.session_id)
        .map(|session| (session.messages, session.surfaced_entities))
        .unwrap_or_default();
    build_context_messages(
        ctx.locale.as_deref(),
        &history,
        &surfaced,
        route,
        Local::now().fixed_offset(),
    )
}

fn build_context_messages(
    locale: Option<&str>,
    history: &[Message],
    surfaced: &[Entity],
    route: Option<playbook::Playbook>,
    now_local: DateTime<FixedOffset>,
) -> Vec<ChatMessage> {
    let mut system_sections = vec![SYSTEM_PROMPT.to_string(), current_time_directive(now_local)];
    if let Some(pb) = route {
        system_sections.push(pb.constraint_prompt().to_string());
    }
    if let Some(locale) = locale.map(str::trim).filter(|l| !l.is_empty()) {
        system_sections.push(format!(
            "Write your reply in the language that matches this interface locale code: \
{locale}. Keep proper nouns (names, world titles) as-is."
        ));
    }
    if let Some(note) = known_references_note(surfaced) {
        system_sections.push(note);
    }

    let mut working = vec![ChatMessage::system(system_sections.join("\n\n"))];
    working.extend(assemble_history(history));
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

fn assemble_history(history: &[Message]) -> Vec<ChatMessage> {
    let mut out = Vec::new();
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

        let assembled = assemble_history(&history);

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
    fn build_context_uses_one_leading_system_message() {
        let history = vec![message(Role::User, "he常去哪?")];
        let assembled = build_context_messages(
            Some("zh-CN"),
            &history,
            &[entity("user", "usr_1", "Alice")],
            playbook::classify_keyword("best time to play"),
            DateTime::parse_from_rfc3339("2026-06-28T06:00:00+09:00").unwrap(),
        );

        let roles: Vec<&str> = assembled
            .iter()
            .map(|message| message.role.as_str())
            .collect();
        assert_eq!(roles, vec!["system", "user"]);
        assert!(assembled[0]
            .content
            .as_deref()
            .unwrap()
            .contains("id=\"usr_1\""));
        assert!(assembled[0].content.as_deref().unwrap().contains("zh-CN"));
        assert_eq!(assembled[1].role, "user");
        assert_eq!(assembled[1].content.as_deref(), Some("he常去哪?"));
    }

    #[test]
    fn assemble_history_keeps_single_current_user_without_stub() {
        let history = vec![message(Role::User, "new question")];
        let assembled = assemble_history(&history);

        assert_eq!(assembled.len(), 1);
        assert_eq!(assembled[0].role, "user");
        assert_eq!(assembled[0].content.as_deref(), Some("new question"));
    }
}
