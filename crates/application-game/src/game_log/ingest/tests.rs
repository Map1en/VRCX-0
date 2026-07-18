use vrcx_0_core::log_watcher::{GameLogEvent, GameLogEventKind};

use super::{GameLogIngestEngine, GameLogIngestOptions, GameLogJoinLeaveSnapshot};

fn event(created_at: &str, kind: GameLogEventKind) -> GameLogEvent {
    GameLogEvent {
        file_name: "output_log.txt".into(),
        created_at: created_at.into(),
        kind,
    }
}

fn join_leave_snapshot(
    created_at: &str,
    event_type: &str,
    display_name: &str,
    user_id: &str,
) -> GameLogJoinLeaveSnapshot {
    GameLogJoinLeaveSnapshot {
        id: 0,
        created_at: created_at.into(),
        event_type: event_type.into(),
        display_name: display_name.into(),
        user_id: user_id.into(),
        time: 0,
    }
}

#[test]
fn resource_load_without_write_does_not_emit_runtime_persisted_mirror() {
    let mut engine = GameLogIngestEngine::default();
    let output = engine.ingest_events(
        &[event(
            "2026-05-14T00:00:00.000Z",
            GameLogEventKind::ResourceLoad {
                resource_type: "ImageLoad".into(),
                resource_url: "https://example.test/image.png".into(),
            },
        )],
        GameLogIngestOptions {
            log_resource_load: false,
        },
    );

    assert!(output.batch.is_empty());
    assert!(output.runtime_persisted_mirrors.is_empty());
}

#[test]
fn provider_video_vrcx_event_does_not_emit_core_persisted_mirror() {
    let mut engine = GameLogIngestEngine::default();
    let output = engine.ingest_events(
        &[event(
            "2026-05-14T00:00:00.000Z",
            GameLogEventKind::Vrcx {
                data: "VideoPlay(PyPyDance) \"https://example.test\",0,10,\"Song (Alpha)\"".into(),
            },
        )],
        GameLogIngestOptions::default(),
    );

    assert!(output.batch.is_empty());
    assert_eq!(output.side_effects.len(), 1);
    assert!(output.runtime_persisted_mirrors.is_empty());
}

#[test]
fn player_left_tolerates_missing_join_user_id_when_display_name_is_unique() {
    let mut engine = GameLogIngestEngine::default();
    let output = engine.ingest_events(
        &[
            event(
                "2026-05-14T04:00:00.000Z",
                GameLogEventKind::Location {
                    location: "wrld_ingest:1".into(),
                    world_name: "Ingest World".into(),
                },
            ),
            event(
                "2026-05-14T04:00:10.000Z",
                GameLogEventKind::PlayerJoined {
                    display_name: "Left Player".into(),
                    user_id: String::new(),
                },
            ),
            event(
                "2026-05-14T04:00:40.000Z",
                GameLogEventKind::PlayerLeft {
                    display_name: "Left Player".into(),
                    user_id: "usr_left".into(),
                },
            ),
        ],
        GameLogIngestOptions::default(),
    );

    assert_eq!(output.batch.join_leave.len(), 2);
    assert_eq!(output.batch.join_leave[1].event_type, "OnPlayerLeft");
    assert_eq!(output.batch.join_leave[1].time, 30000);
    assert!(output
        .projection
        .unwrap()
        .current_location_players
        .is_empty());
}

#[test]
fn external_vrcx_event_emits_mirror_when_external_row_is_written() {
    let mut engine = GameLogIngestEngine::default();
    let output = engine.ingest_events(
        &[event(
            "2026-05-14T00:00:00.000Z",
            GameLogEventKind::Vrcx {
                data: "UnknownProvider payload".into(),
            },
        )],
        GameLogIngestOptions::default(),
    );

    assert_eq!(output.batch.externals.len(), 1);
    assert_eq!(output.runtime_persisted_mirrors.len(), 1);
    assert_eq!(output.runtime_persisted_mirrors[0][2], "vrcx");
}

#[test]
fn seed_current_roster_pairs_leave_with_real_join_time() {
    let mut engine = GameLogIngestEngine::default();
    engine.seed_current_location(
        "wrld_seed:1".into(),
        "Seed World".into(),
        "2026-05-14T04:00:00.000Z".into(),
    );
    let entries = vec![
        join_leave_snapshot(
            "2026-05-14T04:00:10.000Z",
            "OnPlayerJoined",
            "Alice",
            "usr_alice",
        ),
        join_leave_snapshot(
            "2026-05-14T04:00:20.000Z",
            "OnPlayerJoined",
            "Bob",
            "usr_bob",
        ),
        join_leave_snapshot("2026-05-14T04:05:00.000Z", "OnPlayerLeft", "Bob", "usr_bob"),
    ];
    engine.seed_current_roster(&entries);

    let output = engine.ingest_events(
        &[event(
            "2026-05-14T04:40:10.000Z",
            GameLogEventKind::PlayerLeft {
                display_name: "Alice".into(),
                user_id: "usr_alice".into(),
            },
        )],
        GameLogIngestOptions::default(),
    );

    assert_eq!(output.batch.join_leave.len(), 1);
    assert_eq!(output.batch.join_leave[0].event_type, "OnPlayerLeft");
    // 04:40:10 - 04:00:10 = 2400s; without the seed this would be 0.
    assert_eq!(output.batch.join_leave[0].time, 2_400_000);
}

#[test]
fn seed_current_roster_ignored_when_roster_already_populated() {
    let mut engine = GameLogIngestEngine::default();
    engine.seed_current_location(
        "wrld_seed:1".into(),
        "Seed World".into(),
        "2026-05-14T04:00:00.000Z".into(),
    );
    engine.ingest_events(
        &[event(
            "2026-05-14T04:00:05.000Z",
            GameLogEventKind::PlayerJoined {
                display_name: "Alice".into(),
                user_id: "usr_alice".into(),
            },
        )],
        GameLogIngestOptions::default(),
    );
    engine.seed_current_roster(&[join_leave_snapshot(
        "2020-01-01T00:00:00.000Z",
        "OnPlayerJoined",
        "Alice",
        "usr_alice",
    )]);

    let output = engine.ingest_events(
        &[event(
            "2026-05-14T04:00:35.000Z",
            GameLogEventKind::PlayerLeft {
                display_name: "Alice".into(),
                user_id: "usr_alice".into(),
            },
        )],
        GameLogIngestOptions::default(),
    );

    // The live join (04:00:05) wins over the stale seed, so 30s not years.
    assert_eq!(output.batch.join_leave[0].time, 30000);
}

#[test]
fn seeded_location_applies_to_join_without_location_event() {
    let mut engine = GameLogIngestEngine::default();
    engine.seed_current_location(
        "wrld_seed:1".into(),
        "Seed World".into(),
        "2026-05-14T10:00:00.000Z".into(),
    );
    let output = engine.ingest_events(
        &[event(
            "2026-05-14T10:05:00.000Z",
            GameLogEventKind::PlayerJoined {
                display_name: "Resumed".into(),
                user_id: "usr_resumed".into(),
            },
        )],
        GameLogIngestOptions::default(),
    );

    assert_eq!(output.batch.join_leave.len(), 1);
    assert_eq!(output.batch.join_leave[0].location, "wrld_seed:1");
    assert_eq!(
        engine.runtime_snapshot().started_at,
        "2026-05-14T10:00:00.000Z"
    );
}

#[test]
fn seed_does_not_override_observed_location() {
    let mut engine = GameLogIngestEngine::default();
    engine.ingest_events(
        &[event(
            "2026-05-14T10:00:00.000Z",
            GameLogEventKind::Location {
                location: "wrld_real:1".into(),
                world_name: "Real".into(),
            },
        )],
        GameLogIngestOptions::default(),
    );
    engine.seed_current_location(
        "wrld_seed:1".into(),
        "Seed".into(),
        "2026-05-14T09:00:00.000Z".into(),
    );
    let output = engine.ingest_events(
        &[event(
            "2026-05-14T10:01:00.000Z",
            GameLogEventKind::PlayerJoined {
                display_name: "Player".into(),
                user_id: "usr_player".into(),
            },
        )],
        GameLogIngestOptions::default(),
    );

    assert_eq!(output.batch.join_leave[0].location, "wrld_real:1");
}
