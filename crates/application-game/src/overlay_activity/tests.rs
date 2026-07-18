use super::*;
use crate::game_log::video::VideoInput;
use crate::GameLogSideEffect;
use vrcx_0_application_activity::OverlayActivityRuntime;
use vrcx_0_persistence::game_log::{
    GameLogEventEntry, GameLogExternalEntry, GameLogJoinLeaveEntry, GameLogWriteBatch,
};

#[test]
fn game_log_join_leave_batch_ingests_current_instance_activity() {
    let runtime = OverlayActivityRuntime::new();
    let output = crate::GameLogIngestOutput {
        batch: GameLogWriteBatch {
            join_leave: vec![GameLogJoinLeaveEntry {
                created_at: "2026-05-31T00:04:00.000Z".to_string(),
                event_type: "OnPlayerJoined".to_string(),
                display_name: "Joining User".to_string(),
                location: "wrld_1:123".to_string(),
                user_id: "usr_joining".to_string(),
                world_name: "Test World".to_string(),
                time: 0,
            }],
            ..GameLogWriteBatch::default()
        },
        ..crate::GameLogIngestOutput::default()
    };

    runtime.ingest_game_log_output(&output);

    let entries = runtime.snapshot().entries;
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].activity_type, "OnPlayerJoined");
    assert_eq!(entries[0].actor_display_name, "Joining User");
}

#[test]
fn game_log_event_and_external_batches_ingest_system_activity() {
    let runtime = OverlayActivityRuntime::new();
    let output = crate::GameLogIngestOutput {
        batch: GameLogWriteBatch {
            events: vec![GameLogEventEntry {
                created_at: "2026-05-31T00:05:00.000Z".to_string(),
                data: "Something happened".to_string(),
            }],
            externals: vec![GameLogExternalEntry {
                created_at: "2026-05-31T00:05:01.000Z".to_string(),
                message: "External message".to_string(),
                display_name: "External User".to_string(),
                user_id: "usr_external".to_string(),
                location: "wrld_1:123".to_string(),
            }],
            ..GameLogWriteBatch::default()
        },
        ..crate::GameLogIngestOutput::default()
    };

    runtime.ingest_game_log_output(&output);

    let entries = runtime.snapshot().entries;
    assert_eq!(
        entries
            .iter()
            .map(|entry| entry.activity_type.as_str())
            .collect::<Vec<_>>(),
        vec!["Event", "External"]
    );
    assert_eq!(entries[0].content.body.source_text(), "Something happened");
    assert_eq!(entries[1].actor_display_name, "External User");
}

#[test]
fn game_log_system_and_video_entries_with_same_timestamp_do_not_collide() {
    let runtime = OverlayActivityRuntime::new();
    let output = crate::GameLogIngestOutput {
        batch: GameLogWriteBatch {
            events: vec![
                GameLogEventEntry {
                    created_at: "2026-05-31T00:05:00.000Z".to_string(),
                    data: "First event".to_string(),
                },
                GameLogEventEntry {
                    created_at: "2026-05-31T00:05:00.000Z".to_string(),
                    data: "Second event".to_string(),
                },
            ],
            externals: vec![
                GameLogExternalEntry {
                    created_at: "2026-05-31T00:05:01.000Z".to_string(),
                    message: "First external".to_string(),
                    display_name: "External User".to_string(),
                    user_id: "usr_external".to_string(),
                    location: "wrld_1:123".to_string(),
                },
                GameLogExternalEntry {
                    created_at: "2026-05-31T00:05:01.000Z".to_string(),
                    message: "Second external".to_string(),
                    display_name: "External User".to_string(),
                    user_id: "usr_external".to_string(),
                    location: "wrld_1:123".to_string(),
                },
            ],
            ..GameLogWriteBatch::default()
        },
        side_effects: vec![
            GameLogSideEffect::Video(VideoInput {
                created_at: "2026-05-31T00:05:02.000Z".to_string(),
                location: "wrld_1:123".to_string(),
                video_url: "https://example.test/first".to_string(),
                video_id: "first".to_string(),
                display_name: "Video User".to_string(),
                user_id: "usr_video".to_string(),
                ..VideoInput::default()
            }),
            GameLogSideEffect::Video(VideoInput {
                created_at: "2026-05-31T00:05:02.000Z".to_string(),
                location: "wrld_1:123".to_string(),
                video_url: "https://example.test/second".to_string(),
                video_id: "second".to_string(),
                display_name: "Video User".to_string(),
                user_id: "usr_video".to_string(),
                ..VideoInput::default()
            }),
        ],
        ..crate::GameLogIngestOutput::default()
    };

    runtime.ingest_game_log_output(&output);

    let entries = runtime.snapshot().entries;
    assert_eq!(entries.len(), 6);
    assert_eq!(
        entries
            .iter()
            .map(|entry| entry.activity_type.as_str())
            .collect::<Vec<_>>(),
        vec![
            "VideoPlay",
            "VideoPlay",
            "Event",
            "Event",
            "External",
            "External"
        ]
    );
    let source_ids = entries
        .iter()
        .map(|entry| entry.source_id.as_str())
        .collect::<std::collections::HashSet<_>>();
    assert_eq!(source_ids.len(), entries.len());
}
