use chrono::DateTime;

use vrcx_0_core::game_log_sessions::{
    build_game_log_sessions, SessionEventInput, SessionEventOut, SessionLocationInput,
    SessionSegmentOut,
};

fn epoch(value: &str) -> i64 {
    DateTime::parse_from_rfc3339(value)
        .expect("valid rfc3339")
        .timestamp_millis()
}

fn location(
    id: i64,
    at: &str,
    location: &str,
    world_id: &str,
    duration: Option<i64>,
) -> SessionLocationInput {
    SessionLocationInput {
        epoch: epoch(at),
        sort_id: id,
        id: Some(id),
        created_at: at.to_string(),
        location: location.to_string(),
        world_id: world_id.to_string(),
        world_name: world_id.to_string(),
        group_name: String::new(),
        duration,
    }
}

fn join(row_id: Option<i64>, at: &str, user_id: &str, location: &str) -> SessionEventInput {
    SessionEventInput {
        epoch: epoch(at),
        sort_id: row_id.unwrap_or(0),
        row_id,
        type_: "OnPlayerJoined".to_string(),
        created_at: at.to_string(),
        display_name: user_id.to_uppercase(),
        user_id: user_id.to_string(),
        location: location.to_string(),
        video_url: None,
        video_name: None,
        video_id: None,
        is_favorite: false,
    }
}

fn left(row_id: Option<i64>, at: &str, user_id: &str, location: &str) -> SessionEventInput {
    SessionEventInput {
        type_: "OnPlayerLeft".to_string(),
        ..join(row_id, at, user_id, location)
    }
}

fn video(row_id: Option<i64>, at: &str, url: &str, location: &str) -> SessionEventInput {
    SessionEventInput {
        epoch: epoch(at),
        sort_id: row_id.unwrap_or(0),
        row_id,
        type_: "VideoPlay".to_string(),
        created_at: at.to_string(),
        display_name: String::new(),
        user_id: String::new(),
        location: location.to_string(),
        video_url: Some(url.to_string()),
        video_name: Some("Clip".to_string()),
        video_id: None,
        is_favorite: false,
    }
}

fn world_ids(segments: &[SessionSegmentOut]) -> Vec<&str> {
    segments
        .iter()
        .map(|segment| segment.world_id.as_str())
        .collect()
}

fn event_types(segment: &SessionSegmentOut) -> Vec<&str> {
    segment
        .events
        .iter()
        .map(|event| event.type_.as_str())
        .collect()
}

fn event_user_ids(segment: &SessionSegmentOut) -> Vec<String> {
    segment
        .events
        .iter()
        .map(|event| event.user_id.clone().unwrap_or_default())
        .collect()
}

fn member_user_ids(event: &SessionEventOut) -> Vec<String> {
    event
        .members
        .as_ref()
        .map(|members| {
            members
                .iter()
                .map(|member| member.user_id.clone())
                .collect()
        })
        .unwrap_or_default()
}

#[test]
fn builds_newest_first_dedupes_events_and_collapses_video_plays() {
    let locations = [
        location(
            1,
            "2024-01-01T10:00:00.000Z",
            "wrld_old:1",
            "wrld_old",
            Some(60),
        ),
        location(
            2,
            "2024-01-01T11:00:00.000Z",
            "wrld_new:1",
            "wrld_new",
            None,
        ),
    ];
    let events = [
        join(None, "2024-01-01T10:00:01.000Z", "usr_a", "wrld_old:1"),
        join(None, "2024-01-01T10:00:01.000Z", "usr_a", "wrld_old:1"),
        video(
            None,
            "2024-01-01T11:00:01.000Z",
            "https://video.example.test/a",
            "wrld_new:1",
        ),
        video(
            None,
            "2024-01-01T11:00:02.000Z",
            "https://video.example.test/a",
            "wrld_new:1",
        ),
    ];

    let segments = build_game_log_sessions(&locations, &events);

    assert_eq!(world_ids(&segments), vec!["wrld_new", "wrld_old"]);
    assert_eq!(event_types(&segments[0]), vec!["VideoPlay"]);
    assert_eq!(segments[0].events[0].play_count, Some(2));
    assert_eq!(event_types(&segments[1]), vec!["OnPlayerJoined"]);
    assert_eq!(event_user_ids(&segments[1]), vec!["usr_a".to_string()]);
}

#[test]
fn groups_burst_joins_near_start_and_keeps_genuine_leaves() {
    let locations = [location(
        1,
        "2024-01-01T10:00:00.000Z",
        "wrld_session:1",
        "wrld_session",
        None,
    )];
    let mut events: Vec<SessionEventInput> = (0..5)
        .map(|index| {
            join(
                Some(10 + index),
                &format!("2024-01-01T10:00:0{index}.000Z"),
                &format!("usr_{index}"),
                "wrld_session:1",
            )
        })
        .collect();
    events.push(left(
        Some(20),
        "2024-01-01T10:00:02.000Z",
        "usr_0",
        "wrld_session:1",
    ));

    let segments = build_game_log_sessions(&locations, &events);

    assert_eq!(event_types(&segments[0]), vec!["OnPlayerLeft", "JoinGroup"]);
    let group = &segments[0].events[1];
    assert_eq!(group.count, Some(5));
    let mut members = member_user_ids(group);
    members.sort();
    assert_eq!(members, vec!["usr_0", "usr_1", "usr_2", "usr_3", "usr_4"]);
}

#[test]
fn keeps_events_just_before_next_location_in_earlier_session() {
    let locations = [
        location(1, "2024-01-01T10:00:00.000Z", "wrld_a:1", "wrld_a", None),
        location(2, "2024-01-01T10:05:00.000Z", "wrld_b:1", "wrld_b", None),
    ];
    let events = [
        left(Some(100), "2024-01-01T10:04:59.000Z", "usr_a", "wrld_a:1"),
        join(Some(101), "2024-01-01T10:05:01.000Z", "usr_b", "wrld_b:1"),
    ];

    let segments = build_game_log_sessions(&locations, &events);

    assert_eq!(world_ids(&segments), vec!["wrld_b", "wrld_a"]);
    assert_eq!(event_user_ids(&segments[0]), vec!["usr_b".to_string()]);
    assert_eq!(event_user_ids(&segments[1]), vec!["usr_a".to_string()]);
}

#[test]
fn brackets_events_by_stream_order_ignoring_stale_event_locations() {
    let locations = [
        location(
            1,
            "2024-01-01T10:00:00.000Z",
            "wrld_old:1",
            "wrld_old",
            None,
        ),
        location(
            2,
            "2024-01-01T11:00:00.000Z",
            "wrld_new:1",
            "wrld_new",
            None,
        ),
    ];
    let events = [
        join(None, "2024-01-01T10:30:00.000Z", "usr_old", "wrld_old:1"),
        join(None, "2024-01-01T11:05:00.000Z", "usr_empty", ""),
        join(None, "2024-01-01T11:06:00.000Z", "usr_stale", "wrld_old:1"),
    ];

    let segments = build_game_log_sessions(&locations, &events);

    assert_eq!(world_ids(&segments), vec!["wrld_new", "wrld_old"]);
    let mut new_users = event_user_ids(&segments[0]);
    new_users.sort();
    assert_eq!(new_users, vec!["usr_empty", "usr_stale"]);
    assert_eq!(event_user_ids(&segments[1]), vec!["usr_old".to_string()]);
}

#[test]
fn aggregation_window_includes_edge_within_five_seconds() {
    let locations = [location(
        1,
        "2024-01-01T10:00:00.000Z",
        "wrld_edge:1",
        "wrld_edge",
        None,
    )];
    let ats = [
        "2024-01-01T10:00:00.000Z",
        "2024-01-01T10:00:01.000Z",
        "2024-01-01T10:00:02.000Z",
        "2024-01-01T10:00:03.000Z",
        "2024-01-01T10:00:04.999Z",
    ];
    let events: Vec<SessionEventInput> = ats
        .iter()
        .enumerate()
        .map(|(index, at)| {
            join(
                Some(10 + index as i64),
                at,
                &format!("usr_{index}"),
                "wrld_edge:1",
            )
        })
        .collect();

    let segments = build_game_log_sessions(&locations, &events);

    assert_eq!(event_types(&segments[0]), vec!["JoinGroup"]);
    assert_eq!(segments[0].events[0].count, Some(5));
}

#[test]
fn aggregation_groups_head_cluster_when_tail_run_is_too_small() {
    // 5 joins clustered at the start (head run) + 1 isolated join 100s later.
    // tail-Join anchors on the isolated join (window has only 1 -> no group),
    // so the head-aggregation path is the one that must form the group.
    let locations = [location(
        1,
        "2024-01-01T10:00:00.000Z",
        "wrld_head:1",
        "wrld_head",
        None,
    )];
    let mut events: Vec<SessionEventInput> = (0..5)
        .map(|index| {
            join(
                Some(10 + index),
                &format!("2024-01-01T10:00:0{index}.000Z"),
                &format!("usr_{index}"),
                "wrld_head:1",
            )
        })
        .collect();
    events.push(join(
        Some(15),
        "2024-01-01T10:01:40.000Z",
        "usr_late",
        "wrld_head:1",
    ));

    let segments = build_game_log_sessions(&locations, &events);

    // Newest-first: the isolated join, then the collapsed head JoinGroup.
    assert_eq!(
        event_types(&segments[0]),
        vec!["OnPlayerJoined", "JoinGroup"]
    );
    assert_eq!(event_user_ids(&segments[0])[0], "usr_late");
    let group = &segments[0].events[1];
    assert_eq!(group.count, Some(5));
}

#[test]
fn aggregation_window_excludes_edge_past_five_seconds() {
    let locations = [location(
        1,
        "2024-01-01T10:00:00.000Z",
        "wrld_edge:1",
        "wrld_edge",
        None,
    )];
    let ats = [
        "2024-01-01T10:00:00.000Z",
        "2024-01-01T10:00:01.000Z",
        "2024-01-01T10:00:02.000Z",
        "2024-01-01T10:00:03.000Z",
        "2024-01-01T10:00:05.001Z",
    ];
    let events: Vec<SessionEventInput> = ats
        .iter()
        .enumerate()
        .map(|(index, at)| {
            join(
                Some(10 + index as i64),
                at,
                &format!("usr_{index}"),
                "wrld_edge:1",
            )
        })
        .collect();

    let segments = build_game_log_sessions(&locations, &events);

    // Anchor is the last join (t=5.001s); window start = 0.001s excludes the t=0 join,
    // leaving only four joins in range -> below threshold, no group formed.
    assert_eq!(
        event_types(&segments[0]),
        vec![
            "OnPlayerJoined",
            "OnPlayerJoined",
            "OnPlayerJoined",
            "OnPlayerJoined",
            "OnPlayerJoined"
        ]
    );
}

#[test]
fn dedupes_repeated_rows_across_pages_by_row_key() {
    let locations = [location(
        1,
        "2024-01-01T10:00:00.000Z",
        "wrld_dup:1",
        "wrld_dup",
        None,
    )];
    let events = [
        join(Some(50), "2024-01-01T10:00:01.000Z", "usr_a", "wrld_dup:1"),
        join(Some(50), "2024-01-01T10:00:01.000Z", "usr_a", "wrld_dup:1"),
    ];

    let segments = build_game_log_sessions(&locations, &events);

    assert_eq!(event_user_ids(&segments[0]), vec!["usr_a".to_string()]);
}
