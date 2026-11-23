use vrcx_0_core::activity_sessions::{
    merge_sessions_with_gap, sessions_from_presence, span_duration_ms, ActivitySession,
    PresenceKind, SpanEnd, MAX_INFERRED_SPAN_MS,
};

const BASE: i64 = 1_700_000_000_000;
const MINUTE: i64 = 60_000;
const HOUR: i64 = 60 * MINUTE;
const MERGE_GAP: i64 = 5 * MINUTE;

fn session(start: i64, end: i64) -> ActivitySession {
    ActivitySession {
        start,
        end,
        is_open_tail: false,
        source_revision: String::new(),
    }
}

#[test]
fn activity_sessions_presence_empty_has_no_pending_session() {
    let (pending, sessions) = sessions_from_presence(&[], None);

    assert_eq!(pending, None);
    assert!(sessions.is_empty());
}

#[test]
fn activity_sessions_presence_builds_online_offline_pair() {
    let events = [
        (BASE, PresenceKind::Online),
        (BASE + HOUR, PresenceKind::Offline),
    ];

    let (pending, sessions) = sessions_from_presence(&events, None);

    assert_eq!(pending, None);
    assert_eq!(sessions, vec![session(BASE, BASE + HOUR)]);
}

#[test]
fn activity_sessions_presence_closes_previous_online_on_second_online() {
    let events = [
        (BASE, PresenceKind::Online),
        (BASE + HOUR, PresenceKind::Online),
    ];

    let (pending, sessions) = sessions_from_presence(&events, None);

    assert_eq!(pending, Some(BASE + HOUR));
    assert_eq!(sessions, vec![session(BASE, BASE + HOUR)]);
}

#[test]
fn activity_sessions_presence_respects_initial_pending_session() {
    let events = [(BASE + HOUR, PresenceKind::Offline)];

    let (pending, sessions) = sessions_from_presence(&events, Some(BASE));

    assert_eq!(pending, None);
    assert_eq!(sessions, vec![session(BASE, BASE + HOUR)]);
}

#[test]
fn activity_sessions_merge_joins_gap_and_preserves_metadata() {
    let mut newer = session(BASE + HOUR + MERGE_GAP - MINUTE, BASE + 2 * HOUR);
    newer.is_open_tail = true;
    newer.source_revision = "cursor-2".to_string();

    let merged = merge_sessions_with_gap(&[session(BASE, BASE + HOUR)], &[newer], MERGE_GAP);

    assert_eq!(merged.len(), 1);
    assert_eq!(merged[0].start, BASE);
    assert_eq!(merged[0].end, BASE + 2 * HOUR);
    assert!(merged[0].is_open_tail);
    assert_eq!(merged[0].source_revision, "cursor-2");
}

#[test]
fn activity_sessions_merge_keeps_gap_larger_than_threshold() {
    let merged = merge_sessions_with_gap(
        &[session(BASE, BASE + HOUR)],
        &[session(BASE + HOUR + MERGE_GAP + MINUTE, BASE + 2 * HOUR)],
        MERGE_GAP,
    );

    assert_eq!(merged.len(), 2);
}

#[test]
fn span_duration_keeps_recorded_value_without_capping() {
    assert_eq!(
        span_duration_ms(
            BASE,
            3 * MAX_INFERRED_SPAN_MS,
            SpanEnd::OpenTail,
            BASE + HOUR
        ),
        3 * MAX_INFERRED_SPAN_MS
    );
}

#[test]
fn span_duration_keeps_negative_recorded_value() {
    assert_eq!(
        span_duration_ms(BASE, -MINUTE, SpanEnd::NextStart(BASE + HOUR), BASE + HOUR),
        -MINUTE
    );
}

#[test]
fn span_duration_never_infers_a_negative_value_when_the_clock_goes_back() {
    assert_eq!(
        span_duration_ms(BASE, 0, SpanEnd::NextStart(BASE - MINUTE), BASE),
        0
    );
    assert_eq!(
        span_duration_ms(BASE, 0, SpanEnd::OpenTail, BASE - MINUTE),
        0
    );
}

#[test]
fn span_duration_infers_from_next_start_when_unrecorded() {
    assert_eq!(
        span_duration_ms(BASE, 0, SpanEnd::NextStart(BASE + 90 * MINUTE), BASE + HOUR),
        90 * MINUTE
    );
}

#[test]
fn span_duration_caps_inferred_value() {
    assert_eq!(
        span_duration_ms(
            BASE,
            0,
            SpanEnd::NextStart(BASE + 3 * MAX_INFERRED_SPAN_MS),
            BASE
        ),
        MAX_INFERRED_SPAN_MS
    );
    assert_eq!(
        span_duration_ms(BASE, 0, SpanEnd::OpenTail, BASE + 3 * MAX_INFERRED_SPAN_MS),
        MAX_INFERRED_SPAN_MS
    );
}

#[test]
fn span_duration_runs_to_now_for_open_tail() {
    assert_eq!(
        span_duration_ms(BASE, 0, SpanEnd::OpenTail, BASE + 2 * HOUR),
        2 * HOUR
    );
}

#[test]
fn span_duration_is_zero_when_next_start_is_unusable() {
    assert_eq!(
        span_duration_ms(BASE, 0, SpanEnd::UnknownNextStart, BASE + 2 * HOUR),
        0
    );
}
