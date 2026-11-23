pub const MAX_INFERRED_SPAN_MS: i64 = 24 * 60 * 60 * 1000;
pub const PLAY_SESSION_MERGE_GAP_MS: i64 = 5 * 60 * 1000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SpanEnd {
    NextStart(i64),
    UnknownNextStart,
    OpenTail,
}

pub fn span_duration_ms(
    start_ms: i64,
    recorded_duration_ms: i64,
    end: SpanEnd,
    now_ms: i64,
) -> i64 {
    if recorded_duration_ms != 0 {
        return recorded_duration_ms;
    }
    let inferred = match end {
        SpanEnd::NextStart(next_start_ms) => next_start_ms - start_ms,
        SpanEnd::UnknownNextStart => 0,
        SpanEnd::OpenTail => now_ms - start_ms,
    };
    inferred.clamp(0, MAX_INFERRED_SPAN_MS)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ActivitySession {
    pub start: i64,
    pub end: i64,
    pub is_open_tail: bool,
    pub source_revision: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PresenceKind {
    Online,
    Offline,
    Other,
}

pub fn sessions_from_presence(
    events: &[(i64, PresenceKind)],
    initial_start: Option<i64>,
) -> (Option<i64>, Vec<ActivitySession>) {
    let mut sessions = Vec::new();
    let mut current_start = initial_start;

    for (created_at_ms, kind) in events.iter().copied() {
        match kind {
            PresenceKind::Online => {
                if let Some(start) = current_start {
                    sessions.push(ActivitySession {
                        start,
                        end: created_at_ms,
                        is_open_tail: false,
                        source_revision: String::new(),
                    });
                }
                current_start = Some(created_at_ms);
            }
            PresenceKind::Offline => {
                if let Some(start) = current_start {
                    sessions.push(ActivitySession {
                        start,
                        end: created_at_ms,
                        is_open_tail: false,
                        source_revision: String::new(),
                    });
                    current_start = None;
                }
            }
            PresenceKind::Other => {}
        }
    }

    (current_start, sessions)
}

pub fn merge_sessions_with_gap(
    older_sessions: &[ActivitySession],
    newer_sessions: &[ActivitySession],
    merge_gap_ms: i64,
) -> Vec<ActivitySession> {
    if older_sessions.is_empty() && newer_sessions.is_empty() {
        return Vec::new();
    }

    let mut sessions = Vec::with_capacity(older_sessions.len() + newer_sessions.len());
    sessions.extend(older_sessions.iter().cloned());
    sessions.extend(newer_sessions.iter().cloned());
    sessions.sort_by_key(|session| session.start);

    let mut merged: Vec<ActivitySession> = Vec::new();
    for session in sessions {
        if let Some(last) = merged.last_mut() {
            if session.start <= last.end + merge_gap_ms {
                last.end = last.end.max(session.end);
                last.is_open_tail = last.is_open_tail || session.is_open_tail;
                if !session.source_revision.is_empty() {
                    last.source_revision = session.source_revision;
                }
                continue;
            }
        }
        merged.push(session);
    }
    merged
}
