use vrcx_0_core::game_log_parser::{GameLogEvent, GameLogEventKind};
use vrcx_0_core::game_process::GameProcessEvent;

use super::{
    GameLogAvatarChange, GameLogIngestEngine, GameLogIngestOptions, GameLogIngestOutput,
    GameLogProcessEvent, GameLogSideEffect,
};

fn event(created_at: &str, kind: GameLogEventKind) -> GameLogEvent {
    GameLogEvent {
        file_name: "output_log.txt".into(),
        created_at: created_at.into(),
        kind,
    }
}

#[test]
fn reports_an_instance_avatar_change_only_after_the_first_avatar_seen() {
    let mut engine = GameLogIngestEngine::default();
    let avatar = |created_at: &str, avatar_name: &str| {
        event(
            created_at,
            GameLogEventKind::AvatarChange {
                display_name: "Alice".into(),
                avatar_name: avatar_name.into(),
            },
        )
    };
    let output = engine.ingest_events(
        &[
            event(
                "2026-09-06T15:52:04Z",
                GameLogEventKind::Location {
                    location: "wrld_room:1".into(),
                    world_name: "Room".into(),
                },
            ),
            event(
                "2026-09-06T15:52:05Z",
                GameLogEventKind::PlayerJoined {
                    display_name: "Alice".into(),
                    user_id: "usr_alice".into(),
                },
            ),
            avatar("2026-09-06T15:52:06Z", "First"),
            avatar("2026-09-06T15:52:07Z", "First"),
            avatar("2026-09-06T15:52:08Z", "Second"),
            event(
                "2026-09-06T15:53:00Z",
                GameLogEventKind::Location {
                    location: "wrld_next:2".into(),
                    world_name: "Next".into(),
                },
            ),
            avatar("2026-09-06T15:53:01Z", "Third"),
        ],
        GameLogIngestOptions::default(),
    );

    assert_eq!(
        output.avatar_changes,
        [GameLogAvatarChange {
            created_at: "2026-09-06T15:52:08Z".into(),
            user_id: "usr_alice".into(),
            display_name: "Alice".into(),
            avatar_name: "Second".into(),
            location: "wrld_room:1".into(),
            world_name: "Room".into(),
        }]
    );
}

#[test]
fn room_exit_cleanup_does_not_report_friends_as_departed() {
    for batched in [false, true] {
        let mut engine = GameLogIngestEngine::default();
        let mut initial = vec![event(
            "2026-09-06T15:52:04Z",
            GameLogEventKind::Location {
                location: "wrld_old:1".into(),
                world_name: "Old".into(),
            },
        )];
        for user_id in ["usr_staying", "usr_leaving"] {
            initial.push(event(
                "2026-09-06T15:52:29Z",
                GameLogEventKind::PlayerJoined {
                    display_name: user_id.into(),
                    user_id: user_id.into(),
                },
            ));
        }
        engine.ingest_events(&initial, GameLogIngestOptions::default());
        let events = [
            event(
                "2026-09-06T15:53:01Z",
                GameLogEventKind::PlayerLeft {
                    display_name: "usr_leaving".into(),
                    user_id: "usr_leaving".into(),
                },
            ),
            event(
                "2026-09-06T15:53:01Z",
                GameLogEventKind::LocationDestination {
                    location: "wrld_next:2".into(),
                },
            ),
            event(
                "2026-09-06T15:53:01Z",
                GameLogEventKind::PlayerLeft {
                    display_name: "usr_staying".into(),
                    user_id: "usr_staying".into(),
                },
            ),
            event(
                "2026-09-06T15:53:02Z",
                GameLogEventKind::Location {
                    location: "wrld_next:2".into(),
                    world_name: "Next".into(),
                },
            ),
            event(
                "2026-09-06T15:53:12Z",
                GameLogEventKind::PlayerJoined {
                    display_name: "usr_next".into(),
                    user_id: "usr_next".into(),
                },
            ),
            event(
                "2026-09-06T15:53:13Z",
                GameLogEventKind::PlayerLeft {
                    display_name: "usr_next".into(),
                    user_id: "usr_next".into(),
                },
            ),
        ];
        let mut output = GameLogIngestOutput::default();
        for chunk in events.chunks(if batched { events.len() } else { 1 }) {
            output.append(engine.ingest_events(chunk, GameLogIngestOptions::default()));
        }

        assert_eq!(output.departed_user_ids, ["usr_leaving", "usr_next"]);
        let staying_rows = output
            .batch
            .join_leave
            .iter()
            .filter(|row| row.user_id == "usr_staying")
            .collect::<Vec<_>>();
        assert_eq!(staying_rows.len(), 2);
        assert_eq!(staying_rows[0].location, "wrld_old:1");
        assert_eq!(staying_rows[0].time, 32_000);
        assert_eq!(staying_rows[1].location, "traveling");
        assert_eq!(staying_rows[1].time, 0);
        assert_eq!(engine.runtime_snapshot().location, "wrld_next:2");
        assert!(engine.runtime_snapshot().players.is_empty());
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
fn pypy_dance_provider_event_enriches_video_after_generic_playback_log() {
    let mut engine = GameLogIngestEngine::default();
    let video_url = "http://api.pypy.dance/video?id=1234";
    let output = engine.ingest_events(
        &[
            event(
                "2026-05-14T00:00:00.000Z",
                GameLogEventKind::Location {
                    location: "wrld_f20326da-f1ac-45fc-a062-609723b097b1:1".into(),
                    world_name: "PyPyDance".into(),
                },
            ),
            event(
                "2026-05-14T00:00:01.000Z",
                GameLogEventKind::VideoPlay {
                    video_url: video_url.into(),
                    display_name: String::new(),
                },
            ),
            event(
                "2026-05-14T00:00:02.000Z",
                GameLogEventKind::Vrcx {
                    data: format!(
                        "VideoPlay(PyPyDance) \"{video_url}\",0,180,\"1234 : Song Title (Alpha)\""
                    ),
                },
            ),
        ],
        GameLogIngestOptions::default(),
    );

    let [GameLogSideEffect::Video(input)] = output.side_effects.as_slice() else {
        panic!("expected one enriched video side effect");
    };
    assert_eq!(input.video_url, video_url);
    assert_eq!(input.video_id, "1234");
    assert_eq!(input.video_name, "Song Title");
    assert_eq!(input.display_name, "Alpha");
}

#[test]
fn leaving_room_resets_now_playing_for_world_switch_and_rejoin() {
    for destination in ["wrld_next:2", "wrld_current:1"] {
        let mut engine = GameLogIngestEngine::default();
        engine.ingest_events(
            &[
                event(
                    "2026-05-14T00:00:00.000Z",
                    GameLogEventKind::Location {
                        location: "wrld_current:1".into(),
                        world_name: "Current World".into(),
                    },
                ),
                event(
                    "2026-05-14T00:01:00.000Z",
                    GameLogEventKind::VideoPlay {
                        video_url: "https://example.test/video.mp4".into(),
                        display_name: "Player".into(),
                    },
                ),
            ],
            GameLogIngestOptions::default(),
        );

        let leave_output = engine.ingest_events(
            &[event(
                "2026-05-14T00:02:00.000Z",
                GameLogEventKind::LocationDestination {
                    location: destination.into(),
                },
            )],
            GameLogIngestOptions::default(),
        );

        assert_eq!(
            leave_output.side_effects,
            vec![GameLogSideEffect::NowPlayingReset]
        );

        let next_video_output = engine.ingest_events(
            &[event(
                "2026-05-14T00:03:00.000Z",
                GameLogEventKind::VideoPlay {
                    video_url: "https://example.test/video.mp4".into(),
                    display_name: "Player".into(),
                },
            )],
            GameLogIngestOptions::default(),
        );

        assert!(matches!(
            next_video_output.side_effects.as_slice(),
            [GameLogSideEffect::Video(_)]
        ));
    }
}

#[test]
fn videos_from_a_closed_game_never_stay_now_playing() {
    let video = |at: &str| {
        event(
            at,
            GameLogEventKind::VideoPlay {
                video_url: format!("https://example.test/{at}.mp4"),
                display_name: "Player".into(),
            },
        )
    };
    let game_closed = GameLogProcessEvent {
        process: GameProcessEvent {
            is_game_running: false,
            is_steamvr_running: false,
            game_changed: false,
        },
        changed_at: "2026-05-14T00:10:00.000Z".into(),
    };

    let mut scanned_first = GameLogIngestEngine::default();
    scanned_first.ingest_events(
        &[video("2026-05-14T00:01:00.000Z")],
        GameLogIngestOptions::default(),
    );
    assert_eq!(
        scanned_first
            .handle_process_event(game_closed.clone())
            .side_effects,
        vec![GameLogSideEffect::NowPlayingReset]
    );

    let mut closed_first = GameLogIngestEngine::default();
    closed_first.handle_process_event(game_closed);
    let output = closed_first.ingest_events(
        &[video("2026-05-14T00:01:00.000Z")],
        GameLogIngestOptions::default(),
    );
    assert!(matches!(
        output.side_effects.as_slice(),
        [
            GameLogSideEffect::Video(_),
            GameLogSideEffect::NowPlayingReset
        ]
    ));
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

fn now_playing(created_at: &str, data: &str) -> GameLogEvent {
    event(
        created_at,
        GameLogEventKind::NowPlaying { data: data.into() },
    )
}

#[test]
fn now_playing_log_takes_over_video_lines_and_follows_one_producer() {
    let mut engine = GameLogIngestEngine::default();
    let output = engine.ingest_events(
        &[
            event(
                "2026-10-30T00:00:00.000Z",
                GameLogEventKind::Location {
                    location: "wrld_club:1".into(),
                    world_name: "Club".into(),
                },
            ),
            now_playing(
                "2026-10-30T00:00:01.000Z",
                r#"{"id":"ProTV-1","type":"mediaLoading","loading":true}"#,
            ),
            event(
                "2026-10-30T00:00:02.000Z",
                GameLogEventKind::VideoPlay {
                    video_url: "https://youtu.be/abcdefghijk".into(),
                    display_name: String::new(),
                },
            ),
            now_playing(
                "2026-10-30T00:00:03.000Z",
                r#"{"id":"ProTV-1","type":"mediaChange","mediaUrl":"https://youtu.be/abcdefghijk","mediaName":"Song","mediaImage":"https://img.test/a.jpg","mediaOwnerName":"Alice","mediaLength":200}"#,
            ),
            now_playing(
                "2026-10-30T00:00:04.000Z",
                r#"{"id":"ProTV-1","type":"mediaInfo","mediaName":"Song (Live)"}"#,
            ),
            now_playing(
                "2026-10-30T00:00:05.000Z",
                r#"{"id":"ProTV-1","type":"mediaPause","mediaTime":30}"#,
            ),
            now_playing(
                "2026-10-30T00:00:06.000Z",
                r#"{"id":"ProTV-2","type":"mediaPlay","mediaTime":99}"#,
            ),
        ],
        GameLogIngestOptions::default(),
    );

    let [GameLogSideEffect::Video(input), GameLogSideEffect::NowPlayingTransport {
        created_at,
        position,
        paused,
    }] = output.side_effects.as_slice()
    else {
        panic!("unexpected side effects: {:?}", output.side_effects);
    };
    assert_eq!(input.created_at, "2026-10-30T00:00:03.000Z");
    assert_eq!(input.video_url, "https://youtu.be/abcdefghijk");
    assert_eq!(input.video_id, "YouTube");
    assert_eq!(input.video_name, "Song (Live)");
    assert_eq!(input.thumbnail_url, "https://img.test/a.jpg");
    assert_eq!(input.display_name, "Alice");
    assert_eq!(input.video_length, 200);
    assert_eq!(
        (created_at.as_str(), *position, *paused),
        ("2026-10-30T00:00:05.000Z", 30, true)
    );

    let output = engine.ingest_events(
        &[
            now_playing(
                "2026-10-30T00:01:00.000Z",
                r#"{"id":"ProTV-1","type":"mediaInfo","mediaName":"Encore"}"#,
            ),
            now_playing(
                "2026-10-30T00:01:01.000Z",
                r#"{"id":"ProTV-1","type":"mediaStop","ended":true}"#,
            ),
        ],
        GameLogIngestOptions::default(),
    );
    assert_eq!(
        output.side_effects,
        vec![
            GameLogSideEffect::VideoDetails {
                created_at: "2026-10-30T00:00:03.000Z".into(),
                video_url: "https://youtu.be/abcdefghijk".into(),
                video_name: "Encore".into(),
                thumbnail_url: String::new(),
            },
            GameLogSideEffect::NowPlayingReset,
        ]
    );
}

#[test]
fn now_playing_log_titles_a_video_already_logged_by_vrchat() {
    let mut engine = GameLogIngestEngine::default();
    engine.ingest_events(
        &[
            event(
                "2026-10-30T00:00:00.000Z",
                GameLogEventKind::Location {
                    location: "wrld_club:1".into(),
                    world_name: "Club".into(),
                },
            ),
            event(
                "2026-10-30T00:00:02.000Z",
                GameLogEventKind::VideoPlay {
                    video_url: "https://example.test/a.mp4".into(),
                    display_name: String::new(),
                },
            ),
        ],
        GameLogIngestOptions::default(),
    );

    let output = engine.ingest_events(
        &[now_playing(
            "2026-10-30T00:00:03.000Z",
            r#"{"id":"ProTV-1","type":"mediaChange","mediaUrl":"https://example.test/a.mp4","mediaName":"Song"}"#,
        )],
        GameLogIngestOptions::default(),
    );
    assert_eq!(
        output.side_effects,
        vec![GameLogSideEffect::VideoDetails {
            created_at: "2026-10-30T00:00:02.000Z".into(),
            video_url: "https://example.test/a.mp4".into(),
            video_name: "Song".into(),
            thumbnail_url: String::new(),
        }]
    );
}
