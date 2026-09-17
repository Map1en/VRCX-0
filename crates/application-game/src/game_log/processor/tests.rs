use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use vrcx_0_application_core::NoopWorldCachePort;
use vrcx_0_contracts::game_log::{GameLogLocationEntry, GameLogWriteBatch};
use vrcx_0_core::game_log_parser::{GameLogEvent, GameLogEventKind};
use vrcx_0_core::json::JsonExt;

use crate::game_log::runtime_state::RuntimeSnapshotStore;
use crate::game_log::NoopGameLogHostActions;
use crate::ports::{TestGameMediaPort, TestGameStateStore};
use crate::Result;
use crate::RuntimeAuthScope;
use crate::RuntimeEventBus;
use crate::{GameStateStore, RuntimeSyncEngine, TaskSupervisor};
use vrcx_0_application_activity::{
    OverlayActivityDelivery, OverlayActivityFilters, OverlayActivityRuntime, OverlayActivitySink,
    OverlayActivitySnapshot, OverlayFavoriteGroups,
};
use vrcx_0_application_core::FriendProjection;
use vrcx_0_core::game_process::GameProcessEvent;

use super::{GameLogProcessEvent, GameLogProcessor, GameLogProcessorDeps, GameLogWorkerJob};
use vrcx_0_core::OwnerId;

#[derive(Clone, Default)]
struct RecordingOverlaySink {
    deliveries: Arc<Mutex<Vec<OverlayActivityDelivery>>>,
}

impl OverlayActivitySink for RecordingOverlaySink {
    fn emit_overlay_activity_snapshot(&self, _snapshot: OverlayActivitySnapshot) {}

    fn emit_overlay_activity_delivery(&self, delivery: OverlayActivityDelivery) {
        self.deliveries.lock().unwrap().push(delivery);
    }
}

impl RecordingOverlaySink {
    fn take_deliveries(&self) -> Vec<OverlayActivityDelivery> {
        std::mem::take(&mut *self.deliveries.lock().unwrap())
    }
}

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("vrcx-0-{name}-{}-{nonce}", std::process::id()));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn event(created_at: &str, kind: GameLogEventKind) -> GameLogEvent {
    GameLogEvent {
        file_name: "output_log_2026-05-14_00-00-00.txt".into(),
        created_at: created_at.into(),
        kind,
    }
}

fn test_processor(name: &str) -> Result<(TestDir, Arc<TestGameStateStore>, GameLogProcessor)> {
    let dir = TestDir::new(name);
    let store = Arc::new(TestGameStateStore::default());
    let processor = build_test_processor(Arc::clone(&store))?;
    Ok((dir, store, processor))
}

#[test]
fn side_effect_dependencies_capture_the_authenticated_identity() -> Result<()> {
    let (_dir, _db, processor) = test_processor("runtime-gamelog-captured-identity")?;
    processor
        .deps
        .auth_scope
        .set_identity("usr_first", "First User", "");

    let captured = processor.side_effect_deps();
    processor
        .deps
        .auth_scope
        .set_identity("usr_second", "Second User", "");

    assert_eq!(captured.auth_identity.user_id, "usr_first");
    assert_eq!(captured.auth_identity.display_name, "First User");
    Ok(())
}

fn build_test_processor(store: Arc<TestGameStateStore>) -> Result<GameLogProcessor> {
    let world_cache = Arc::new(crate::WorldCache::new(NoopWorldCachePort));
    let event_bus = RuntimeEventBus::new();
    let processor = GameLogProcessor::new(GameLogProcessorDeps {
        store,
        instance_media: Arc::new(TestGameMediaPort),
        video_metadata: Arc::new(TestGameMediaPort),
        event_bus: event_bus.clone(),
        backend_status: vrcx_0_application_core::BackendRuntimeStatusPublisher::new(
            vrcx_0_application_core::BackendRuntime::new(
                vrcx_0_application_core::RuntimeHostProfile::Desktop,
            ),
            event_bus.clone(),
        ),
        side_effect_sink: crate::GameLogSideEffectSink::new(event_bus, None),
        tasks: TaskSupervisor::new(),
        sync: RuntimeSyncEngine::new(),
        auth_scope: RuntimeAuthScope::new(),
        snapshot: RuntimeSnapshotStore::default(),
        host_actions: Arc::new(NoopGameLogHostActions),
        overlay_activity: OverlayActivityRuntime::with_filters(OverlayActivityFilters::from_json(
            serde_json::json!({
                "version": 1,
                "wrist": {
                    "types": {
                        "OnPlayerJoined": {
                            "scope": "everyoneInInstance",
                            "favoriteGroupKeys": "all"
                        },
                        "OnPlayerLeft": {
                            "scope": "everyoneInInstance",
                            "favoriteGroupKeys": "all"
                        }
                    }
                }
            }),
        )),
        world_cache,
        instance_roster_observer: None,
    });
    Ok(processor)
}

#[test]
fn tracks_location_players_and_session_duration() -> Result<()> {
    let (_dir, store, processor) = test_processor("runtime-gamelog-ingest")?;

    processor.handle_jobs(vec![
        GameLogWorkerJob::Event(event(
            "2026-05-14T04:00:00.000Z",
            GameLogEventKind::Location {
                location: "wrld_ingest:1".into(),
                world_name: "Ingest World".into(),
            },
        )),
        GameLogWorkerJob::Event(event(
            "2026-05-14T04:00:10.000Z",
            GameLogEventKind::PlayerJoined {
                display_name: "Alpha".into(),
                user_id: "usr_alpha".into(),
            },
        )),
        GameLogWorkerJob::Event(event(
            "2026-05-14T04:00:40.000Z",
            GameLogEventKind::LocationDestination {
                location: "wrld_next:1".into(),
            },
        )),
    ])?;

    let locations = store.locations(&OwnerId::new(""));
    assert_eq!(locations[0].time, 40000);
    let join_leave = store.join_leave(&OwnerId::new(""));
    assert_eq!(join_leave.len(), 2);
    assert_eq!(join_leave[0].event_type, "OnPlayerJoined");
    assert_eq!(join_leave[1].event_type, "OnPlayerLeft");
    assert_eq!(join_leave[1].display_name, "Alpha");
    assert_eq!(join_leave[1].time, 30000);
    Ok(())
}

#[test]
fn enabled_initial_scan_keeps_persistence_and_side_effects() -> Result<()> {
    let (_dir, store, processor) = test_processor("runtime-gamelog-enabled-initial")?;

    processor.handle_jobs(vec![
        GameLogWorkerJob::InitialEvent(event(
            "2026-05-14T04:30:00.000Z",
            GameLogEventKind::Location {
                location: "wrld_initial:1".into(),
                world_name: "Initial".into(),
            },
        )),
        GameLogWorkerJob::InitialEvent(event(
            "2026-05-14T04:30:01.000Z",
            GameLogEventKind::DesktopMode,
        )),
    ])?;

    assert_eq!(store.locations(&OwnerId::new("")).len(), 1);
    assert!(store.get_bool("isGameNoVR", false)?);
    let events = processor.deps.event_bus.take_events_for_test();
    assert!(events.iter().any(|event| {
        event.name == "backendRuntimeTelemetry"
            && event.payload.get("kind").and_then(|kind| kind.as_str()) == Some("gameLogPersisted")
    }));
    assert!(events.iter().any(|event| event.name == "gameLogProjection"));
    Ok(())
}

#[test]
fn enabled_process_stop_keeps_session_closure_and_side_effect_order() -> Result<()> {
    let (_dir, store, processor) = test_processor("runtime-gamelog-enabled-stop")?;

    processor.handle_jobs(vec![
        GameLogWorkerJob::Event(event(
            "2026-05-14T04:40:00.000Z",
            GameLogEventKind::Location {
                location: "wrld_enabled_stop:1".into(),
                world_name: "Enabled Stop".into(),
            },
        )),
        GameLogWorkerJob::Process(GameLogProcessEvent {
            process: GameProcessEvent {
                is_game_running: false,
                is_steamvr_running: false,
                game_changed: true,
            },
            changed_at: "2026-05-14T04:45:00.000Z".into(),
        }),
    ])?;

    let locations = store.locations(&OwnerId::new(""));
    assert_eq!(locations[0].time, 300_000);
    assert!(processor.deps.snapshot.snapshot().location.is_empty());
    let events = processor.deps.event_bus.take_events_for_test();
    let persisted_index = events
        .iter()
        .rposition(|event| {
            event.name == "backendRuntimeTelemetry"
                && event.payload.get("kind").and_then(|kind| kind.as_str())
                    == Some("gameLogPersisted")
        })
        .unwrap();
    let reset_index = events
        .iter()
        .position(|event| {
            event.name == "gameLogSideEffect"
                && event.payload.get("kind").and_then(|kind| kind.as_str())
                    == Some("nowPlayingReset")
        })
        .unwrap();
    assert!(persisted_index < reset_index);
    Ok(())
}

#[test]
fn disabled_persistence_keeps_live_state_projection_overlay_and_side_effects() -> Result<()> {
    let (_dir, store, processor) = test_processor("runtime-gamelog-disabled")?;
    store.set_bool("gameLogDisabled", true)?;

    processor.handle_jobs(vec![
        GameLogWorkerJob::Event(event(
            "2026-05-14T05:00:00.000Z",
            GameLogEventKind::Location {
                location: "wrld_disabled:1".into(),
                world_name: "Disabled".into(),
            },
        )),
        GameLogWorkerJob::Event(event(
            "2026-05-14T05:00:31.000Z",
            GameLogEventKind::PlayerJoined {
                display_name: "Live Player".into(),
                user_id: "usr_live".into(),
            },
        )),
        GameLogWorkerJob::Event(event(
            "2026-05-14T05:00:32.000Z",
            GameLogEventKind::DesktopMode,
        )),
    ])?;

    assert!(store.locations(&OwnerId::new("")).is_empty());
    let snapshot = processor.deps.snapshot.snapshot();
    assert_eq!(snapshot.location, "wrld_disabled:1");
    assert_eq!(snapshot.players[0].user_id, "usr_live");
    assert!(store.get_bool("isGameNoVR", false)?);
    assert_eq!(
        processor.deps.overlay_activity.snapshot().entries[0].actor_user_id,
        "usr_live"
    );
    let events = processor.deps.event_bus.take_events_for_test();
    assert!(events.iter().any(|event| event.name == "gameLogProjection"));
    assert!(!events.iter().any(|event| {
        (event.name == "backendRuntimeTelemetry"
            && event.payload.get("kind").and_then(|kind| kind.as_str()) == Some("gameLogPersisted"))
            || event.name == "runtimeGameLogEvent"
            || event.name == "gameLogPersistenceFallback"
    }));
    Ok(())
}

#[test]
fn disabled_initial_scan_rebuilds_memory_without_replaying_side_effects() -> Result<()> {
    let (_dir, store, mut processor) = test_processor("runtime-gamelog-disabled-replay")?;
    let timers = Arc::new(vrcx_0_application_core::InstanceDwellRegistry::new());
    timers.observe_friend_record(
        "usr_replay",
        &vrcx_0_core::friends::FriendRecord {
            id: "usr_replay".into(),
            state: "online".into(),
            location: "wrld_replay:1".into(),
            ..Default::default()
        },
        chrono::DateTime::parse_from_rfc3339("2026-05-14T05:11:00Z")
            .unwrap()
            .timestamp_millis(),
    );
    processor.deps.instance_roster_observer = Some(timers.clone());
    store.set_bool("gameLogDisabled", true)?;

    processor.handle_jobs(vec![
        GameLogWorkerJob::InitialEvent(event(
            "2026-05-14T05:10:00.000Z",
            GameLogEventKind::Location {
                location: "wrld_replay:1".into(),
                world_name: "Replay".into(),
            },
        )),
        GameLogWorkerJob::InitialEvent(event(
            "2026-05-14T05:10:31.000Z",
            GameLogEventKind::PlayerJoined {
                display_name: "Replay Player".into(),
                user_id: "usr_replay".into(),
            },
        )),
        GameLogWorkerJob::InitialEvent(event(
            "2026-05-14T05:10:32.000Z",
            GameLogEventKind::DesktopMode,
        )),
    ])?;

    assert!(!store.tables_exist());
    let snapshot = processor.deps.snapshot.snapshot();
    assert_eq!(snapshot.location, "wrld_replay:1");
    assert_eq!(snapshot.players[0].user_id, "usr_replay");
    assert_eq!(
        timers.snapshot()[0].since_ms,
        snapshot.players[0].join_time_ms
    );
    assert_eq!(
        timers.snapshot()[0].source,
        vrcx_0_application_core::FriendLocationTimeSource::GameLog
    );
    assert!(!store.get_bool("isGameNoVR", false)?);
    assert!(processor
        .deps
        .overlay_activity
        .snapshot()
        .entries
        .is_empty());
    Ok(())
}

#[test]
fn entering_a_friends_instance_keeps_dwell_without_rewriting_log_join_time() -> Result<()> {
    for batched in [false, true] {
        let (_dir, _store, mut processor) = test_processor("runtime-gamelog-arrival-dwell")?;
        let timers = Arc::new(vrcx_0_application_core::InstanceDwellRegistry::new());
        let started_at = chrono::DateTime::parse_from_rfc3339("2026-09-06T10:00:00Z")
            .unwrap()
            .timestamp_millis();
        timers.observe_friend_record(
            "usr_friend",
            &vrcx_0_core::friends::FriendRecord {
                id: "usr_friend".into(),
                state: "online".into(),
                location: "wrld_local:1".into(),
                ..Default::default()
            },
            started_at,
        );
        processor.deps.instance_roster_observer = Some(timers.clone());
        let location = GameLogWorkerJob::Event(event(
            "2026-09-06T10:30:00Z",
            GameLogEventKind::Location {
                location: "wrld_local:1".into(),
                world_name: "Local".into(),
            },
        ));
        let joined = GameLogWorkerJob::Event(event(
            "2026-09-06T10:30:12Z",
            GameLogEventKind::PlayerJoined {
                display_name: "Friend".into(),
                user_id: "usr_friend".into(),
            },
        ));
        if batched {
            processor.handle_jobs(vec![location, joined])?;
        } else {
            processor.handle_jobs(vec![location])?;
            processor.handle_jobs(vec![joined])?;
        }

        assert_eq!(timers.snapshot()[0].since_ms, Some(started_at));
        assert_eq!(
            timers.snapshot()[0].source,
            vrcx_0_application_core::FriendLocationTimeSource::GameLog
        );
        assert_eq!(
            processor.deps.snapshot.snapshot().players[0].join_time_ms,
            Some(started_at + 30 * 60_000 + 12_000)
        );
    }
    Ok(())
}

#[test]
fn room_exit_cleanup_preserves_the_dwell_of_friends_staying_in_the_old_instance() -> Result<()> {
    for batched in [false, true] {
        for origin in [
            crate::GameLogEventOrigin::Live,
            crate::GameLogEventOrigin::InitialScan,
        ] {
            let (_dir, _store, mut processor) = test_processor("gamelog-exit-cleanup-timers")?;
            let timers = Arc::new(vrcx_0_application_core::InstanceDwellRegistry::new());
            let mut initial = vec![event(
                "1970-01-01T00:30:00Z",
                GameLogEventKind::Location {
                    location: "wrld_old:1".into(),
                    world_name: "Old".into(),
                },
            )];
            for (user_id, since_ms) in [("usr_a", 1_000), ("usr_b", 2_000)] {
                timers.observe_friend_record(
                    user_id,
                    &vrcx_0_core::friends::FriendRecord {
                        id: user_id.into(),
                        state: "online".into(),
                        location: "wrld_old:1".into(),
                        ..Default::default()
                    },
                    since_ms,
                );
                initial.push(event(
                    "1970-01-01T00:30:25Z",
                    GameLogEventKind::PlayerJoined {
                        display_name: user_id.into(),
                        user_id: user_id.into(),
                    },
                ));
            }
            processor.deps.instance_roster_observer = Some(timers.clone());
            processor.handle_jobs(vec![GameLogWorkerJob::Events {
                events: initial,
                origin,
            }])?;
            assert_eq!(timers.snapshot()[0].since_ms, Some(1_000));
            assert_eq!(timers.snapshot()[1].since_ms, Some(2_000));

            let events = [
                event(
                    "1970-01-01T00:31:01Z",
                    GameLogEventKind::LocationDestination {
                        location: "wrld_next:2".into(),
                    },
                ),
                event(
                    "1970-01-01T00:31:01Z",
                    GameLogEventKind::PlayerLeft {
                        display_name: "usr_a".into(),
                        user_id: "usr_a".into(),
                    },
                ),
                event(
                    "1970-01-01T00:31:02Z",
                    GameLogEventKind::PlayerLeft {
                        display_name: "usr_b".into(),
                        user_id: "usr_b".into(),
                    },
                ),
                event(
                    "1970-01-01T00:31:03Z",
                    GameLogEventKind::Location {
                        location: "wrld_next:2".into(),
                        world_name: "Next".into(),
                    },
                ),
            ];
            for chunk in events.chunks(if batched { events.len() } else { 1 }) {
                processor.handle_jobs(vec![GameLogWorkerJob::Events {
                    events: chunk.to_vec(),
                    origin,
                }])?;
                let times = timers.snapshot();
                assert_eq!(times.len(), 2);
                for (time, since_ms) in times.iter().zip([1_000, 2_000]) {
                    assert_eq!(time.since_ms, Some(since_ms));
                    assert_eq!(time.location, "wrld_old:1");
                    assert_eq!(
                        time.source,
                        vrcx_0_application_core::FriendLocationTimeSource::Realtime
                    );
                }
            }

            processor.handle_jobs(vec![GameLogWorkerJob::Events {
                events: vec![
                    event(
                        "1970-01-01T00:32:00Z",
                        GameLogEventKind::Location {
                            location: "wrld_old:1".into(),
                            world_name: "Old".into(),
                        },
                    ),
                    event(
                        "1970-01-01T00:32:10Z",
                        GameLogEventKind::PlayerJoined {
                            display_name: "usr_a".into(),
                            user_id: "usr_a".into(),
                        },
                    ),
                ],
                origin,
            }])?;
            assert_eq!(timers.snapshot()[0].since_ms, Some(1_000));
        }
    }
    Ok(())
}

#[test]
fn local_mode_initial_replay_does_not_restart_remote_timers() -> Result<()> {
    for persistence_disabled in [false, true] {
        let (_dir, store, mut processor) = test_processor("runtime-gamelog-replay-departures")?;
        store.set_bool("gameLogDisabled", persistence_disabled)?;
        let timers = Arc::new(vrcx_0_application_core::InstanceDwellRegistry::new());
        for user_id in ["usr_remote", "usr_local"] {
            timers.observe_friend_record(
                user_id,
                &vrcx_0_core::friends::FriendRecord {
                    id: user_id.into(),
                    state: "online".into(),
                    location: "wrld_current:2".into(),
                    ..Default::default()
                },
                500,
            );
        }
        processor.deps.instance_roster_observer = Some(timers.clone());

        processor.handle_jobs(vec![
            GameLogWorkerJob::InitialEvent(event(
                "1970-01-01T00:00:01Z",
                GameLogEventKind::Location {
                    location: "wrld_history:1".into(),
                    world_name: "History".into(),
                },
            )),
            GameLogWorkerJob::InitialEvent(event(
                "1970-01-01T00:00:02Z",
                GameLogEventKind::PlayerJoined {
                    display_name: "Remote".into(),
                    user_id: "usr_remote".into(),
                },
            )),
            GameLogWorkerJob::InitialEvent(event(
                "1970-01-01T00:00:03Z",
                GameLogEventKind::PlayerLeft {
                    display_name: "Remote".into(),
                    user_id: "usr_remote".into(),
                },
            )),
            GameLogWorkerJob::InitialEvent(event(
                "1970-01-01T00:00:04Z",
                GameLogEventKind::Location {
                    location: "wrld_current:2".into(),
                    world_name: "Current".into(),
                },
            )),
            GameLogWorkerJob::InitialEvent(event(
                "1970-01-01T00:00:05Z",
                GameLogEventKind::PlayerJoined {
                    display_name: "Local".into(),
                    user_id: "usr_local".into(),
                },
            )),
        ])?;

        let snapshot = timers.snapshot();
        let remote = snapshot
            .iter()
            .find(|entry| entry.user_id == "usr_remote")
            .unwrap();
        assert_eq!(remote.since_ms, Some(500));
        assert_eq!(
            remote.source,
            vrcx_0_application_core::FriendLocationTimeSource::Realtime
        );
        let local = snapshot
            .iter()
            .find(|entry| entry.user_id == "usr_local")
            .unwrap();
        assert_eq!(local.since_ms, Some(500));
        assert_eq!(
            local.source,
            vrcx_0_application_core::FriendLocationTimeSource::GameLog
        );
    }
    Ok(())
}

#[test]
fn local_mode_resume_prefix_does_not_restart_timers_but_live_departures_do() -> Result<()> {
    let (_dir, _store, mut processor) = test_processor("runtime-gamelog-resume-departures")?;
    let timers = Arc::new(vrcx_0_application_core::InstanceDwellRegistry::new());
    timers.observe_friend_record(
        "usr_friend",
        &vrcx_0_core::friends::FriendRecord {
            id: "usr_friend".into(),
            state: "online".into(),
            location: "wrld_local:1".into(),
            ..Default::default()
        },
        500,
    );
    processor.deps.instance_roster_observer = Some(timers.clone());
    processor.set_persistence_resume_after("1970-01-01T00:00:03Z");
    let joined = GameLogEventKind::PlayerJoined {
        display_name: "Friend".into(),
        user_id: "usr_friend".into(),
    };
    let left = GameLogEventKind::PlayerLeft {
        display_name: "Friend".into(),
        user_id: "usr_friend".into(),
    };

    processor.handle_jobs(vec![
        GameLogWorkerJob::Event(event(
            "1970-01-01T00:00:01Z",
            GameLogEventKind::Location {
                location: "wrld_local:1".into(),
                world_name: "Local".into(),
            },
        )),
        GameLogWorkerJob::Event(event("1970-01-01T00:00:02Z", joined.clone())),
        GameLogWorkerJob::Event(event("1970-01-01T00:00:03Z", left.clone())),
        GameLogWorkerJob::Event(event("1970-01-01T00:00:04Z", GameLogEventKind::DesktopMode)),
    ])?;
    assert_eq!(timers.snapshot()[0].since_ms, Some(500));

    processor.handle_jobs(vec![GameLogWorkerJob::Event(event(
        "1970-01-01T00:00:05Z",
        joined,
    ))])?;
    assert_eq!(timers.snapshot()[0].since_ms, Some(5_000));
    let before_leave = chrono::Utc::now().timestamp_millis();
    processor.handle_jobs(vec![GameLogWorkerJob::Event(event(
        "1970-01-01T00:00:06Z",
        left,
    ))])?;
    assert!(timers.snapshot()[0].since_ms.unwrap() >= before_leave);
    assert_eq!(
        timers.snapshot()[0].source,
        vrcx_0_application_core::FriendLocationTimeSource::Realtime
    );
    Ok(())
}

#[test]
fn local_mode_distinguishes_player_leave_rejoin_and_own_room_exit() -> Result<()> {
    let (_dir, _store, mut processor) = test_processor("runtime-gamelog-local-mode")?;
    let timers = Arc::new(vrcx_0_application_core::InstanceDwellRegistry::new());
    timers.observe_friend_record(
        "usr_friend",
        &vrcx_0_core::friends::FriendRecord {
            id: "usr_friend".into(),
            state: "online".into(),
            location: "wrld_local:1".into(),
            ..Default::default()
        },
        500,
    );
    processor.deps.instance_roster_observer = Some(timers.clone());
    let joined = GameLogEventKind::PlayerJoined {
        display_name: "Friend".into(),
        user_id: "usr_friend".into(),
    };
    let left = GameLogEventKind::PlayerLeft {
        display_name: "Friend".into(),
        user_id: "usr_friend".into(),
    };

    processor.handle_jobs(vec![
        GameLogWorkerJob::InitialEvent(event(
            "1970-01-01T00:00:01Z",
            GameLogEventKind::Location {
                location: "wrld_local:1".into(),
                world_name: "Local".into(),
            },
        )),
        GameLogWorkerJob::InitialEvent(event("1970-01-01T00:00:02Z", joined.clone())),
    ])?;
    assert_eq!(timers.snapshot()[0].since_ms, Some(500));

    processor.handle_jobs(vec![
        GameLogWorkerJob::Event(event("1970-01-01T00:00:03Z", left.clone())),
        GameLogWorkerJob::Event(event("1970-01-01T00:00:04Z", joined.clone())),
    ])?;
    assert_eq!(timers.snapshot()[0].since_ms, Some(4_000));

    processor.handle_jobs(vec![GameLogWorkerJob::Event(event(
        "1970-01-01T00:00:05Z",
        left,
    ))])?;
    let remote_start = timers.snapshot()[0].since_ms.unwrap();
    assert!(remote_start > 4_000);
    assert_eq!(
        timers.snapshot()[0].source,
        vrcx_0_application_core::FriendLocationTimeSource::Realtime
    );

    processor.handle_jobs(vec![GameLogWorkerJob::Event(event(
        "1970-01-01T00:00:06Z",
        joined,
    ))])?;
    processor.handle_jobs(vec![GameLogWorkerJob::Event(event(
        "1970-01-01T00:00:07Z",
        GameLogEventKind::LocationDestination {
            location: "wrld_next:2".into(),
        },
    ))])?;
    assert_eq!(timers.snapshot()[0].since_ms, Some(remote_start));
    assert_eq!(
        timers.snapshot()[0].source,
        vrcx_0_application_core::FriendLocationTimeSource::Realtime
    );
    Ok(())
}

#[test]
fn local_mode_player_leave_is_not_lost_when_own_exit_is_in_the_same_batch() -> Result<()> {
    let (_dir, _store, mut processor) = test_processor("runtime-gamelog-batched-leave")?;
    let timers = Arc::new(vrcx_0_application_core::InstanceDwellRegistry::new());
    timers.observe_friend_record(
        "usr_friend",
        &vrcx_0_core::friends::FriendRecord {
            id: "usr_friend".into(),
            state: "online".into(),
            location: "wrld_local:1".into(),
            ..Default::default()
        },
        500,
    );
    processor.deps.instance_roster_observer = Some(timers.clone());
    processor.handle_jobs(vec![
        GameLogWorkerJob::InitialEvent(event(
            "1970-01-01T00:00:01Z",
            GameLogEventKind::Location {
                location: "wrld_local:1".into(),
                world_name: "Local".into(),
            },
        )),
        GameLogWorkerJob::InitialEvent(event(
            "1970-01-01T00:00:02Z",
            GameLogEventKind::PlayerJoined {
                display_name: "Friend".into(),
                user_id: "usr_friend".into(),
            },
        )),
    ])?;
    assert_eq!(timers.snapshot()[0].since_ms, Some(500));

    processor.handle_jobs(vec![
        GameLogWorkerJob::Event(event(
            "1970-01-01T00:00:03Z",
            GameLogEventKind::PlayerLeft {
                display_name: "Friend".into(),
                user_id: String::new(),
            },
        )),
        GameLogWorkerJob::Event(event(
            "1970-01-01T00:00:04Z",
            GameLogEventKind::LocationDestination {
                location: "wrld_next:2".into(),
            },
        )),
    ])?;

    assert!(timers.snapshot()[0].since_ms.unwrap() > 2_000);
    Ok(())
}

#[test]
fn resume_cutoff_splits_queued_live_events_without_backfilling() -> Result<()> {
    let (_dir, store, processor) = test_processor("runtime-gamelog-resume-cutoff")?;
    processor.set_persistence_resume_after("2026-05-14T05:20:30.000Z");

    processor.handle_jobs(vec![
        GameLogWorkerJob::Event(event(
            "2026-05-14T05:20:00.000Z",
            GameLogEventKind::Location {
                location: "wrld_cutoff:1".into(),
                world_name: "Cutoff".into(),
            },
        )),
        GameLogWorkerJob::Event(event(
            "2026-05-14T05:20:40.000Z",
            GameLogEventKind::PlayerJoined {
                display_name: "After Resume".into(),
                user_id: "usr_after_resume".into(),
            },
        )),
    ])?;
    let join_leave = store.join_leave(&OwnerId::new(""));
    assert_eq!(join_leave.len(), 1);
    assert_eq!(join_leave[0].user_id, "usr_after_resume");
    assert!(store.locations(&OwnerId::new("")).is_empty());
    Ok(())
}

#[test]
fn disabled_process_stop_clears_memory_without_persisting_session_closure() -> Result<()> {
    let (_dir, store, processor) = test_processor("runtime-gamelog-disabled-stop")?;
    store.set_bool("gameLogDisabled", true)?;
    processor.handle_jobs(vec![GameLogWorkerJob::Event(event(
        "2026-05-14T05:30:00.000Z",
        GameLogEventKind::Location {
            location: "wrld_stop:1".into(),
            world_name: "Stop".into(),
        },
    ))])?;
    processor.deps.event_bus.take_events_for_test();

    processor.handle_jobs(vec![GameLogWorkerJob::Process(GameLogProcessEvent {
        process: GameProcessEvent {
            is_game_running: false,
            is_steamvr_running: false,
            game_changed: true,
        },
        changed_at: "2026-05-14T05:35:00.000Z".into(),
    })])?;

    assert!(processor.deps.snapshot.snapshot().location.is_empty());
    assert!(!store.tables_exist());
    let events = processor.deps.event_bus.take_events_for_test();
    assert!(events.iter().any(|event| {
        event.name == "gameLogSideEffect"
            && event.payload.get("kind").and_then(|kind| kind.as_str()) == Some("nowPlayingReset")
    }));
    Ok(())
}

#[test]
fn resume_cutoff_skips_a_queued_process_stop_closure() -> Result<()> {
    let (_dir, store, processor) = test_processor("runtime-gamelog-resume-stop")?;
    processor.set_persistence_resume_after("2026-05-14T05:45:00.000Z");
    processor.handle_jobs(vec![GameLogWorkerJob::Event(event(
        "2026-05-14T05:40:00.000Z",
        GameLogEventKind::Location {
            location: "wrld_resume_stop:1".into(),
            world_name: "Resume Stop".into(),
        },
    ))])?;
    processor.deps.event_bus.take_events_for_test();

    processor.handle_jobs(vec![GameLogWorkerJob::Process(GameLogProcessEvent {
        process: GameProcessEvent {
            is_game_running: false,
            is_steamvr_running: false,
            game_changed: true,
        },
        changed_at: "2026-05-14T05:44:00.000Z".into(),
    })])?;

    assert!(!store.tables_exist());
    assert!(processor.deps.snapshot.snapshot().location.is_empty());
    let events = processor.deps.event_bus.take_events_for_test();
    assert!(events.iter().any(|event| {
        event.name == "gameLogSideEffect"
            && event.payload.get("kind").and_then(|kind| kind.as_str()) == Some("nowPlayingReset")
    }));
    Ok(())
}

#[test]
fn emits_runtime_persisted_mirror_after_worker_write() -> Result<()> {
    let (_dir, _db, processor) = test_processor("runtime-gamelog-worker-mirror")?;

    processor.handle_jobs(vec![GameLogWorkerJob::Event(event(
        "2026-05-14T06:00:00.000Z",
        GameLogEventKind::Location {
            location: "wrld_mirror:1".into(),
            world_name: "Mirror World".into(),
        },
    ))])?;

    let events = processor.deps.event_bus.take_events_for_test();
    assert!(events.iter().any(|event| {
        event.name == "runtimeGameLogEvent"
            && event
                .payload
                .get("runtimePersisted")
                .and_then(|value| value.as_bool())
                == Some(true)
    }));
    Ok(())
}

#[test]
fn enabled_write_failure_emits_fallback_and_skips_persisted_outputs() -> Result<()> {
    let (_dir, store, processor) = test_processor("runtime-gamelog-write-failure")?;
    store.set_fail_writes(true);

    let writing = processor.clone();
    let worker = std::thread::spawn(move || {
        writing.handle_jobs(vec![
            GameLogWorkerJob::Event(event(
                "2026-05-14T06:10:00.000Z",
                GameLogEventKind::Location {
                    location: "wrld_failure:1".into(),
                    world_name: "Failure".into(),
                },
            )),
            GameLogWorkerJob::Event(event(
                "2026-05-14T06:10:01.000Z",
                GameLogEventKind::DesktopMode,
            )),
        ])
    });
    std::thread::sleep(std::time::Duration::from_millis(600));
    processor.request_stop();
    assert!(worker.join().unwrap().is_err());

    assert!(store.get_bool("isGameNoVR", false)?);
    assert!(processor
        .deps
        .overlay_activity
        .snapshot()
        .entries
        .is_empty());
    let events = processor.deps.event_bus.take_events_for_test();
    assert!(events
        .iter()
        .any(|event| event.name == "gameLogPersistenceFallback"));
    assert!(!events.iter().any(|event| {
        (event.name == "backendRuntimeTelemetry"
            && event.payload.get("kind").and_then(|kind| kind.as_str()) == Some("gameLogPersisted"))
            || event.name == "runtimeGameLogEvent"
    }));
    assert!(events.iter().any(|event| event.name == "gameLogProjection"));
    Ok(())
}

#[test]
fn join_leave_events_reuse_current_world_name_for_overlay_content() -> Result<()> {
    let (_dir, _db, processor) = test_processor("runtime-gamelog-world-name")?;

    processor.handle_jobs(vec![
        GameLogWorkerJob::Event(event(
            "2026-05-14T07:00:00.000Z",
            GameLogEventKind::Location {
                location: "wrld_named:123".into(),
                world_name: "Named World".into(),
            },
        )),
        GameLogWorkerJob::Event(event(
            "2026-05-14T07:00:40.000Z",
            GameLogEventKind::PlayerJoined {
                display_name: "Traveler".into(),
                user_id: "usr_traveler".into(),
            },
        )),
    ])?;

    let entries = processor.deps.overlay_activity.snapshot().entries;
    let entry = entries
        .iter()
        .find(|entry| entry.activity_type == "OnPlayerJoined")
        .expect("join overlay entry");
    assert_eq!(entry.content.world_name, "Named World");
    assert_eq!(entry.content.world_id, "wrld_named");
    assert_eq!(entry.content.display_location, "Named World public");
    assert_eq!(
        entry
            .payload
            .get("worldName")
            .and_then(|value| value.as_str()),
        Some("Named World")
    );
    Ok(())
}

#[test]
fn suppresses_initial_current_instance_join_overlay_notifications() -> Result<()> {
    let (_dir, store, processor) = test_processor("runtime-gamelog-join-suppress")?;

    processor.handle_jobs(vec![
        GameLogWorkerJob::Event(event(
            "2026-05-14T08:00:00.000Z",
            GameLogEventKind::Location {
                location: "wrld_public:123".into(),
                world_name: "Public World".into(),
            },
        )),
        GameLogWorkerJob::Event(event(
            "2026-05-14T08:00:10.000Z",
            GameLogEventKind::PlayerJoined {
                display_name: "Existing Player".into(),
                user_id: "usr_existing".into(),
            },
        )),
    ])?;

    let join_leave = store.join_leave(&OwnerId::new(""));
    assert_eq!(join_leave.len(), 1);
    assert!(processor
        .deps
        .overlay_activity
        .snapshot()
        .entries
        .is_empty());
    Ok(())
}

#[test]
fn allows_later_current_instance_join_overlay_notifications() -> Result<()> {
    let (_dir, _db, processor) = test_processor("runtime-gamelog-join-later")?;

    processor.handle_jobs(vec![
        GameLogWorkerJob::Event(event(
            "2026-05-14T08:10:00.000Z",
            GameLogEventKind::Location {
                location: "wrld_public:456".into(),
                world_name: "Public World".into(),
            },
        )),
        GameLogWorkerJob::Event(event(
            "2026-05-14T08:10:31.000Z",
            GameLogEventKind::PlayerJoined {
                display_name: "Late Player".into(),
                user_id: "usr_late".into(),
            },
        )),
    ])?;

    let entries = processor.deps.overlay_activity.snapshot().entries;
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].actor_user_id, "usr_late");
    Ok(())
}

#[test]
fn game_log_presence_enables_current_instance_gps_surface_filtering() -> Result<()> {
    let (_dir, _db, processor) = test_processor("runtime-gamelog-gps-surface-filter")?;
    let overlay = &processor.deps.overlay_activity;
    overlay.set_filters(OverlayActivityFilters::from_json(serde_json::json!({
        "version": 1,
        "wrist": { "types": {
            "OnPlayerJoined": { "scope": "off", "favoriteGroupKeys": "all" },
            "GPS": { "scope": "selectedFavorites", "favoriteGroupKeys": ["fav-selected"] }
        } },
        "desktop": { "types": {
            "OnPlayerJoined": { "scope": "off", "favoriteGroupKeys": "all" },
            "GPS": { "scope": "friends", "favoriteGroupKeys": "all" }
        } },
        "vr": { "types": {
            "OnPlayerJoined": { "scope": "friends", "favoriteGroupKeys": "all" },
            "GPS": { "scope": "selectedFavorites", "favoriteGroupKeys": ["fav-selected"] }
        } },
        "hmd": { "types": {
            "OnPlayerJoined": { "scope": "friends", "favoriteGroupKeys": "all" },
            "GPS": { "scope": "selectedFavorites", "favoriteGroupKeys": ["fav-selected"] }
        } },
        "webhook": { "types": {
            "OnPlayerJoined": { "scope": "off", "favoriteGroupKeys": "all" },
            "GPS": { "scope": "off", "favoriteGroupKeys": "all" }
        } },
        "tts": { "types": {
            "OnPlayerJoined": { "scope": "off", "favoriteGroupKeys": "all" },
            "GPS": { "scope": "off", "favoriteGroupKeys": "all" }
        } }
    })));
    overlay.set_friend_user_ids(["usr_selected"]);
    overlay.set_favorite_groups(OverlayFavoriteGroups::from_pairs([(
        "fav-selected",
        ["usr_selected"].as_slice(),
    )]));
    let sink = RecordingOverlaySink::default();
    overlay.set_sink(sink.clone());
    overlay.set_delivery_armed(true);
    let location_at = (chrono::Utc::now() - chrono::Duration::seconds(40)).to_rfc3339();
    let joined_at = chrono::Utc::now().to_rfc3339();

    processor.handle_jobs(vec![
        GameLogWorkerJob::Event(event(
            &location_at,
            GameLogEventKind::Location {
                location: "wrld_current:123".into(),
                world_name: "Current World".into(),
            },
        )),
        GameLogWorkerJob::Event(event(
            &joined_at,
            GameLogEventKind::PlayerJoined {
                display_name: "Selected Friend".into(),
                user_id: "usr_selected".into(),
            },
        )),
    ])?;

    let joined = sink.take_deliveries();
    assert_eq!(joined.len(), 1);
    assert!(joined[0].vr);
    assert!(joined[0].hmd);
    overlay.ingest_friend_projection(&FriendProjection {
        feed_entries: vec![vrcx_0_application_core::FeedLiveEntry::Gps {
            created_at: chrono::Utc::now().to_rfc3339(),
            user_id: "usr_selected".into(),
            display_name: "Selected Friend".into(),
            location: "wrld_current:123".into(),
            world_name: String::new(),
            previous_location: String::new(),
            time: 0,
            group_name: String::new(),
            world_id: None,
            display_location: None,
            owner_user_id: String::new(),
        }],
        ..FriendProjection::new(0, 0)
    });

    let gps = sink.take_deliveries();
    assert_eq!(gps.len(), 1);
    assert!(gps[0].desktop);
    assert!(!gps[0].vr);
    assert!(!gps[0].hmd);
    let entries = overlay.snapshot().entries;
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].activity_type, "GPS");
    Ok(())
}

#[test]
fn suppresses_leave_overlay_notifications_right_after_destination() -> Result<()> {
    let (_dir, store, processor) = test_processor("runtime-gamelog-leave-suppress")?;

    processor.handle_jobs(vec![
        GameLogWorkerJob::Event(event(
            "2026-05-14T08:20:00.000Z",
            GameLogEventKind::Location {
                location: "wrld_old:123".into(),
                world_name: "Old World".into(),
            },
        )),
        GameLogWorkerJob::Event(event(
            "2026-05-14T08:20:40.000Z",
            GameLogEventKind::PlayerJoined {
                display_name: "Departing Player".into(),
                user_id: "usr_departing".into(),
            },
        )),
        GameLogWorkerJob::Event(event(
            "2026-05-14T08:21:00.000Z",
            GameLogEventKind::LocationDestination {
                location: "wrld_next:123".into(),
            },
        )),
    ])?;

    let join_leave = store.join_leave(&OwnerId::new(""));
    assert_eq!(join_leave.len(), 2);
    let entries = processor.deps.overlay_activity.snapshot().entries;
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].activity_type, "OnPlayerJoined");
    Ok(())
}

#[test]
fn suppresses_current_user_join_leave_overlay_notifications() -> Result<()> {
    let (_dir, store, processor) = test_processor("runtime-gamelog-current-user-suppress")?;
    processor
        .deps
        .auth_scope
        .set("usr_self", "https://api.vrchat.cloud/api/1");

    processor.handle_jobs(vec![
        GameLogWorkerJob::Event(event(
            "2026-05-14T08:30:00.000Z",
            GameLogEventKind::Location {
                location: "wrld_self:123".into(),
                world_name: "Self World".into(),
            },
        )),
        GameLogWorkerJob::Event(event(
            "2026-05-14T08:30:40.000Z",
            GameLogEventKind::PlayerJoined {
                display_name: "Self".into(),
                user_id: "usr_self".into(),
            },
        )),
        GameLogWorkerJob::Event(event(
            "2026-05-14T08:31:00.000Z",
            GameLogEventKind::LocationDestination {
                location: "wrld_next:123".into(),
            },
        )),
    ])?;

    let join_leave = store.join_leave(&OwnerId::new("usr_self"));
    assert_eq!(join_leave.len(), 2);
    assert!(processor
        .deps
        .overlay_activity
        .snapshot()
        .entries
        .is_empty());
    Ok(())
}

#[test]
fn failed_write_recovers_before_later_records_advance_history() -> Result<()> {
    let (_dir, store, processor) = test_processor("recover-write-gap")?;
    processor.handle_jobs(vec![GameLogWorkerJob::Event(event(
        "2026-05-14T04:00:00.000Z",
        GameLogEventKind::Location {
            location: "wrld_recovery:1".into(),
            world_name: "Recovery".into(),
        },
    ))])?;
    store.set_fail_writes(true);
    let writing = processor.clone();
    let worker = std::thread::spawn(move || {
        writing.handle_jobs(vec![GameLogWorkerJob::Event(event(
            "2026-05-14T04:00:10.000Z",
            GameLogEventKind::PlayerJoined {
                user_id: "usr_other".into(),
                display_name: "Other".into(),
            },
        ))])
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    while processor.deps.snapshot.snapshot().players.is_empty()
        && std::time::Instant::now() < deadline
    {
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    std::thread::sleep(std::time::Duration::from_millis(450));
    let events = processor.deps.event_bus.take_events_for_test();
    store.set_fail_writes(false);
    assert!(worker.join().unwrap().is_err());
    processor.handle_jobs(vec![GameLogWorkerJob::Event(event(
        "2026-05-14T04:00:10.000Z",
        GameLogEventKind::PlayerJoined {
            user_id: "usr_self".into(),
            display_name: "Self".into(),
        },
    ))])?;
    let rows = store.join_leave(&OwnerId::new(""));
    assert_eq!(
        rows.len(),
        2,
        "the failed join must be saved before later records"
    );
    assert_eq!(rows[0].user_id, "usr_other");
    assert!(events.iter().any(|event| event.name == "gameLogProjection"
        && event.payload["currentLocationPlayers"]
            .as_array()
            .is_some_and(|players| players.len() == 1)));
    Ok(())
}

fn scan_job(
    file_name: &str,
    position: u64,
    events: Vec<GameLogEvent>,
    publish: bool,
) -> GameLogWorkerJob {
    let mut context = crate::game_log_parser::LogContext::new();
    context.position = position;
    GameLogWorkerJob::Scan {
        events,
        origin: crate::GameLogEventOrigin::InitialScan,
        cursor: Box::new(crate::GameLogScanCursor {
            file_created_at: None,
            start_position: position.saturating_sub(100),
            rebuild: false,
            file_name: file_name.into(),
            context,
            cutoff: "2026-05-14T00:00:00Z".into(),
        }),
        publish,
        completed: None,
    }
}

#[test]
fn checkpoint_recovers_same_second_tail_without_replaying_committed_joins() -> Result<()> {
    let (_dir, store, processor) = test_processor("checkpoint-same-second")?;
    processor.handle_jobs(vec![scan_job(
        "output_log_01.txt",
        100,
        vec![
            event(
                "2026-05-14T04:00:00.000Z",
                GameLogEventKind::Location {
                    location: "wrld_checkpoint:1".into(),
                    world_name: "Checkpoint".into(),
                },
            ),
            event(
                "2026-05-14T04:00:10.000Z",
                GameLogEventKind::PlayerJoined {
                    user_id: "usr_first".into(),
                    display_name: "First".into(),
                },
            ),
        ],
        false,
    )])?;
    assert!(!processor.deps.snapshot.snapshot().ready);
    store.set_fail_writes(true);
    let writing = processor.clone();
    let tail = event(
        "2026-05-14T04:00:10.000Z",
        GameLogEventKind::PlayerJoined {
            user_id: "usr_second".into(),
            display_name: "Second".into(),
        },
    );
    let failed_tail = tail.clone();
    let worker = std::thread::spawn(move || {
        writing.handle_jobs(vec![scan_job(
            "output_log_01.txt",
            200,
            vec![failed_tail],
            true,
        )])
    });
    std::thread::sleep(std::time::Duration::from_millis(600));
    processor.request_stop();
    assert!(worker.join().unwrap().is_err());
    store.set_fail_writes(false);
    let restored = build_test_processor(store.clone())?;
    assert_eq!(restored.replay_cursor().unwrap().context.position, 100);
    assert!(!restored.deps.snapshot.snapshot().ready);
    restored.handle_jobs(vec![scan_job("output_log_01.txt", 200, vec![tail], true)])?;
    let snapshot = restored.deps.snapshot.snapshot();
    assert!(snapshot.ready);
    assert_eq!(snapshot.players.len(), 2);
    assert_eq!(store.join_leave(&OwnerId::new("")).len(), 2);
    assert!(snapshot.players.iter().all(
        |player| player.join_time_ms == crate::parse_event_time_ms("2026-05-14T04:00:10.000Z")
    ));
    Ok(())
}

#[test]
fn a_new_log_file_cannot_publish_the_previous_games_roster() -> Result<()> {
    let (_dir, _store, processor) = test_processor("new-game-log")?;
    processor.handle_jobs(vec![scan_job(
        "output_log_01.txt",
        100,
        vec![
            event(
                "2026-05-14T04:00:00.000Z",
                GameLogEventKind::Location {
                    location: "wrld_old:1".into(),
                    world_name: "Old".into(),
                },
            ),
            event(
                "2026-05-14T04:00:10.000Z",
                GameLogEventKind::PlayerJoined {
                    user_id: "usr_old".into(),
                    display_name: "Old".into(),
                },
            ),
        ],
        true,
    )])?;
    processor.handle_jobs(vec![scan_job("output_log_02.txt", 0, Vec::new(), true)])?;
    let snapshot = processor.deps.snapshot.snapshot();
    assert!(snapshot.players.is_empty());
    assert!(snapshot.location.is_empty());
    Ok(())
}

#[test]
fn current_file_replay_restores_members_without_backfilling_history() -> Result<()> {
    let (_dir, store, processor) = test_processor("current-file-private-replay")?;
    let mut scan = scan_job(
        "output_log_current.txt",
        100,
        vec![
            event(
                "2026-05-14T04:00:00.000Z",
                GameLogEventKind::Location {
                    location: "wrld_current:1".into(),
                    world_name: "Current".into(),
                },
            ),
            event(
                "2026-05-14T04:00:10.000Z",
                GameLogEventKind::PlayerJoined {
                    user_id: "usr_self".into(),
                    display_name: "Self".into(),
                },
            ),
            event(
                "2026-05-14T04:00:10.000Z",
                GameLogEventKind::PlayerJoined {
                    user_id: "usr_other".into(),
                    display_name: "Other".into(),
                },
            ),
        ],
        true,
    );
    if let GameLogWorkerJob::Scan { cursor, .. } = &mut scan {
        cursor.cutoff = "2026-05-14T05:00:00Z".into();
        cursor.rebuild = true;
    }
    processor.handle_jobs(vec![scan])?;
    let snapshot = processor.deps.snapshot.snapshot();
    assert!(snapshot.ready);
    assert_eq!(snapshot.players.len(), 2);
    assert!(store.join_leave(&OwnerId::new("")).is_empty());
    assert!(store.locations(&OwnerId::new("")).is_empty());
    assert!(processor
        .deps
        .overlay_activity
        .snapshot()
        .entries
        .is_empty());
    let displayed = crate::player_list_runtime_snapshot(&snapshot, "wrld_current:1");
    assert_eq!(displayed.players.len(), 2);
    assert!(displayed
        .players
        .iter()
        .any(|player| player.user_id == "usr_self"));
    Ok(())
}

#[test]
fn replay_cutoff_applies_to_old_records_after_a_newer_timestamp() -> Result<()> {
    let (_dir, store, processor) = test_processor("out-of-order-cutoff")?;
    let mut scan = scan_job(
        "output_log_current.txt",
        100,
        vec![
            event(
                "2026-05-14T04:00:00.000Z",
                GameLogEventKind::Location {
                    location: "wrld_current:1".into(),
                    world_name: "Current".into(),
                },
            ),
            event(
                "2026-05-14T04:02:00.000Z",
                GameLogEventKind::PlayerJoined {
                    user_id: "usr_new".into(),
                    display_name: "New".into(),
                },
            ),
            event(
                "2026-05-14T04:00:10.000Z",
                GameLogEventKind::PlayerJoined {
                    user_id: "usr_old".into(),
                    display_name: "Old".into(),
                },
            ),
        ],
        true,
    );
    if let GameLogWorkerJob::Scan { cursor, .. } = &mut scan {
        cursor.cutoff = "2026-05-14T04:01:00Z".into();
        cursor.rebuild = true;
    }
    processor.handle_jobs(vec![scan])?;
    let rows = store.join_leave(&OwnerId::new(""));
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].user_id, "usr_new");
    assert_eq!(processor.deps.snapshot.snapshot().players.len(), 2);
    Ok(())
}

#[test]
fn live_chunks_use_current_engine_for_join_suppression() -> Result<()> {
    for publish_join_chunk in [false, true] {
        let (_dir, _store, processor) = test_processor("review-live-chunk")?;
        let mut first = scan_job(
            "output_log_current.txt",
            100,
            vec![event(
                "2026-05-14T04:00:00.000Z",
                GameLogEventKind::Location {
                    location: "wrld_new:1".into(),
                    world_name: "New World".into(),
                },
            )],
            false,
        );
        if let GameLogWorkerJob::Scan { origin, .. } = &mut first {
            *origin = crate::GameLogEventOrigin::Live;
        }
        processor.handle_jobs(vec![first])?;
        let mut joined = scan_job(
            "output_log_current.txt",
            200,
            vec![event(
                "2026-05-14T04:00:10.000Z",
                GameLogEventKind::PlayerJoined {
                    user_id: "usr_existing".into(),
                    display_name: "Already Here".into(),
                },
            )],
            publish_join_chunk,
        );
        if let GameLogWorkerJob::Scan { origin, .. } = &mut joined {
            *origin = crate::GameLogEventOrigin::Live;
        }
        processor.handle_jobs(vec![joined])?;
        let count = processor.deps.overlay_activity.snapshot().entries.len();
        assert_eq!(count, 0);
    }
    Ok(())
}

#[test]
fn new_file_does_not_forward_previous_replayed_departures() -> Result<()> {
    struct Capture(Arc<Mutex<Vec<vrcx_0_application_core::InstanceRosterSnapshot>>>);
    impl vrcx_0_application_core::InstanceRosterObserver for Capture {
        fn on_instance_roster(&self, value: vrcx_0_application_core::InstanceRosterSnapshot) {
            self.0.lock().unwrap().push(value);
        }
        fn on_game_running(&self, _: bool) {}
    }
    let (_dir, _store, mut processor) = test_processor("review-cross-file")?;
    let captured = Arc::new(Mutex::new(Vec::new()));
    processor.deps.instance_roster_observer = Some(Arc::new(Capture(captured.clone())));
    processor.handle_jobs(vec![scan_job(
        "output_log_old.txt",
        100,
        vec![event(
            "2026-05-14T04:00:00.000Z",
            GameLogEventKind::PlayerLeft {
                user_id: "usr_from_previous_game".into(),
                display_name: "Old".into(),
            },
        )],
        false,
    )])?;
    processor.handle_jobs(vec![scan_job(
        "output_log_new.txt",
        100,
        vec![event(
            "2026-05-14T05:00:00.000Z",
            GameLogEventKind::Location {
                location: "wrld_new:2".into(),
                world_name: "New".into(),
            },
        )],
        true,
    )])?;
    let output = captured.lock().unwrap();
    let last = output.last().unwrap();
    assert!(last.replayed_departed_user_ids.is_empty());
    Ok(())
}

#[test]
fn process_events_do_not_close_unverified_database_roster() -> Result<()> {
    let store = Arc::new(TestGameStateStore::default());
    store.write_game_log(
        &OwnerId::new(""),
        &GameLogWriteBatch {
            locations: vec![GameLogLocationEntry {
                created_at: "2026-05-14T04:00:00.000Z".into(),
                location: "wrld_old:1".into(),
                world_id: "wrld_old".into(),
                world_name: "Old".into(),
                time: 0,
                group_name: String::new(),
            }],
            join_leave: vec![vrcx_0_contracts::game_log::GameLogJoinLeaveEntry {
                created_at: "2026-05-14T04:00:10.000Z".into(),
                event_type: "OnPlayerJoined".into(),
                user_id: "usr_old".into(),
                display_name: "Old".into(),
                location: "wrld_old:1".into(),
                world_name: "Old".into(),
                time: 0,
            }],
            ..Default::default()
        },
    )?;
    let processor = build_test_processor(store.clone())?;
    for (running, time) in [
        (true, "2026-05-14T05:00:00.000Z"),
        (false, "2026-05-14T05:01:00.000Z"),
    ] {
        processor.handle_jobs(vec![GameLogWorkerJob::Process(GameLogProcessEvent {
            process: GameProcessEvent {
                is_game_running: running,
                is_steamvr_running: false,
                game_changed: true,
            },
            changed_at: time.into(),
        })])?;
    }
    let rows = store.join_leave(&OwnerId::new(""));
    let last = rows.last().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(last.event_type, "OnPlayerJoined");
    Ok(())
}

#[test]
fn regression_failed_scan_returns_and_retries_once_with_process_closure() -> Result<()> {
    let (_dir, store, processor) = test_processor("bounded-scan-retry")?;
    processor.handle_jobs(vec![scan_job(
        "output_log_current.txt",
        100,
        vec![event(
            "2026-05-14T04:00:00Z",
            GameLogEventKind::Location {
                location: "wrld_retry:1".into(),
                world_name: "Retry".into(),
            },
        )],
        true,
    )])?;
    store.set_fail_writes(true);
    let scan = scan_job(
        "output_log_current.txt",
        200,
        vec![event(
            "2026-05-14T04:00:10Z",
            GameLogEventKind::PlayerJoined {
                user_id: "usr_other".into(),
                display_name: "Other".into(),
            },
        )],
        true,
    );
    let writing = processor.clone();
    let retry = scan.clone();
    let (sent, received) = std::sync::mpsc::channel();
    let worker = std::thread::spawn(move || {
        let _ = sent.send(writing.handle_jobs(vec![scan]).is_err());
    });
    let result = received.recv_timeout(std::time::Duration::from_secs(2));
    if result.is_err() {
        processor.request_stop();
    }
    worker.join().unwrap();
    assert_eq!(
        result.ok(),
        Some(true),
        "a failed write must return without stopping the runtime"
    );
    assert!(processor
        .handle_jobs(vec![GameLogWorkerJob::Process(GameLogProcessEvent {
            process: GameProcessEvent {
                is_game_running: false,
                is_steamvr_running: false,
                game_changed: true
            },
            changed_at: "2026-05-14T04:01:00Z".into()
        })])
        .is_err());
    store.set_fail_writes(false);
    processor.handle_jobs(vec![retry])?;
    let rows = store.join_leave(&OwnerId::new(""));
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[1].event_type, "OnPlayerLeft");
    assert_eq!(rows[1].time, 50_000);
    assert!(processor.deps.snapshot.snapshot().players.is_empty());
    Ok(())
}

#[test]
fn regression_runtime_acknowledges_failure_and_continues_after_config_recovers() -> Result<()> {
    let (_dir, store, processor) = test_processor("runtime-read-recovery")?;
    let deps = processor.deps;
    let runtime = crate::GameLogRuntime::new(crate::GameLogRuntimeDeps::new(
        deps.store,
        deps.instance_media,
        deps.video_metadata,
        deps.event_bus,
        deps.backend_status,
        deps.side_effect_sink,
        deps.tasks,
        deps.sync,
        deps.auth_scope,
        crate::HostSessionRuntime::new(),
        deps.snapshot.clone(),
        deps.host_actions,
        deps.overlay_activity,
        deps.world_cache,
        None,
    ));
    let GameLogWorkerJob::Scan {
        events,
        origin,
        cursor,
        publish,
        ..
    } = scan_job(
        "output_log_current.txt",
        100,
        vec![event(
            "2026-05-14T04:00:00Z",
            GameLogEventKind::Location {
                location: "wrld_recovered:1".into(),
                world_name: "Recovered".into(),
            },
        )],
        true,
    )
    else {
        unreachable!()
    };
    store.set_fail_reads(true);
    assert!(runtime
        .ingest_game_log_scan(&events, origin, (*cursor).clone(), publish)
        .is_err());
    store.set_fail_reads(false);
    runtime.ingest_game_log_scan(&events, origin, *cursor, publish)?;
    assert_eq!(deps.snapshot.snapshot().location, "wrld_recovered:1");
    runtime.reset_replay()?;
    runtime.stop();
    Ok(())
}

#[test]
fn unchanged_log_publishes_snapshot_after_each_restart() -> Result<()> {
    let (_dir, store, processor) = test_processor("unchanged-log-restarts")?;
    processor.handle_jobs(vec![scan_job(
        "output_log_current.txt",
        100,
        vec![
            event(
                "2026-05-14T04:00:00Z",
                GameLogEventKind::Location {
                    location: "wrld_restored:1".into(),
                    world_name: "Restored".into(),
                },
            ),
            event(
                "2026-05-14T04:00:10Z",
                GameLogEventKind::PlayerJoined {
                    user_id: "usr_other".into(),
                    display_name: "Other".into(),
                },
            ),
        ],
        true,
    )])?;
    for restart in 1..=3 {
        let restored = build_test_processor(store.clone())?;
        assert!(!restored.deps.snapshot.snapshot().ready);
        let mut cursor = restored.replay_cursor().unwrap();
        let scanned_position = cursor.context.position;
        cursor.start_position = scanned_position;
        let scan = GameLogWorkerJob::Scan {
            events: Vec::new(),
            origin: crate::GameLogEventOrigin::InitialScan,
            cursor: Box::new(cursor),
            publish: true,
            completed: None,
        };
        restored.handle_jobs(vec![scan.clone()])?;
        let snapshot = restored.deps.snapshot.snapshot();
        assert!(
            snapshot.ready,
            "restart {restart} must publish even without new log lines"
        );
        assert_eq!(snapshot.location, "wrld_restored:1");
        assert_eq!(snapshot.players.len(), 1);
        assert_eq!(
            snapshot.players[0].join_time_ms,
            crate::parse_event_time_ms("2026-05-14T04:00:10Z")
        );
        let checkpoint: super::ReplayCheckpoint =
            serde_json::from_str(&store.get_string("gameLogReplayCheckpoint", "")?)?;
        assert_eq!(checkpoint.cursor.context.position, scanned_position);
        let events = restored.deps.event_bus.take_events_for_test();
        assert_eq!(
            events
                .iter()
                .filter(|event| event.name == "gameLogProjection")
                .count(),
            1
        );
        assert!(!events
            .iter()
            .any(|event| event.name == "runtimeGameLogEvent"));
        restored.handle_jobs(vec![scan])?;
        assert!(!restored
            .deps
            .event_bus
            .take_events_for_test()
            .iter()
            .any(|event| event.name == "gameLogProjection"));
    }
    assert_eq!(store.locations(&OwnerId::new("")).len(), 1);
    assert_eq!(store.join_leave(&OwnerId::new("")).len(), 1);
    Ok(())
}

#[test]
fn duplicate_scan_can_publish_without_replaying_rows_or_side_effects() -> Result<()> {
    let (_dir, store, processor) = test_processor("duplicate-scan-publication")?;
    let mut scan = scan_job(
        "output_log_current.txt",
        100,
        vec![
            event(
                "2026-05-14T04:00:00Z",
                GameLogEventKind::Location {
                    location: "wrld_once:1".into(),
                    world_name: "Once".into(),
                },
            ),
            event("2026-05-14T04:00:10Z", GameLogEventKind::DesktopMode),
        ],
        false,
    );
    processor.handle_jobs(vec![scan.clone()])?;
    assert!(!processor.deps.snapshot.snapshot().ready);
    assert!(store.get_bool("isGameNoVR", false)?);
    store.set_bool("isGameNoVR", false)?;
    processor.deps.event_bus.take_events_for_test();
    if let GameLogWorkerJob::Scan { publish, .. } = &mut scan {
        *publish = true;
    }
    processor.handle_jobs(vec![scan])?;
    assert!(processor.deps.snapshot.snapshot().ready);
    assert_eq!(processor.deps.snapshot.snapshot().location, "wrld_once:1");
    assert!(
        !store.get_bool("isGameNoVR", false)?,
        "the already handled DesktopMode event must not run again"
    );
    assert_eq!(store.locations(&OwnerId::new("")).len(), 1);
    assert!(!processor
        .deps
        .event_bus
        .take_events_for_test()
        .iter()
        .any(|event| event.name == "runtimeGameLogEvent"));
    Ok(())
}

#[test]
fn a_scan_without_events_keeps_the_persisted_checkpoint_and_the_database_idle() -> Result<()> {
    let (_dir, store, processor) = test_processor("eventless-scan-checkpoint")?;
    processor.handle_jobs(vec![scan_job(
        "output_log_current.txt",
        200,
        vec![event(
            "2026-05-14T04:00:00Z",
            GameLogEventKind::Location {
                location: "wrld_eventless:1".into(),
                world_name: "Eventless".into(),
            },
        )],
        true,
    )])?;
    let persisted = store.get_string("gameLogReplayCheckpoint", "")?;
    assert!(!persisted.is_empty());
    processor.deps.event_bus.take_events_for_test();

    processor.handle_jobs(vec![scan_job(
        "output_log_current.txt",
        400,
        Vec::new(),
        true,
    )])?;

    assert_eq!(
        store.get_string("gameLogReplayCheckpoint", "")?,
        persisted,
        "a poll over log lines that parse to nothing must not rewrite the checkpoint"
    );
    assert!(!processor
        .deps
        .event_bus
        .take_events_for_test()
        .iter()
        .any(|event| event.name == "backendRuntimeTelemetry"
            && event.payload.get("kind").and_then(|kind| kind.as_str())
                == Some("gameLogPersisted")));
    Ok(())
}

#[test]
fn side_effect_events_without_history_rows_still_advance_the_restart_position() -> Result<()> {
    let (_dir, store, processor) = test_processor("side-effect-restart-position")?;
    let location = event(
        "2026-05-14T04:00:00Z",
        GameLogEventKind::Location {
            location: "wrld_sync:1".into(),
            world_name: "Sync".into(),
        },
    );
    let video_sync = event(
        "2026-05-14T04:00:20Z",
        GameLogEventKind::VideoSync {
            timestamp: "1000".into(),
        },
    );
    let side_effects = |processor: &GameLogProcessor| {
        processor
            .deps
            .event_bus
            .take_events_for_test()
            .iter()
            .filter(|event| event.name == "gameLogSideEffect")
            .count()
    };

    processor.handle_jobs(vec![scan_job(
        "output_log_current.txt",
        200,
        vec![location.clone()],
        true,
    )])?;
    processor.handle_jobs(vec![scan_job(
        "output_log_current.txt",
        300,
        vec![video_sync.clone()],
        true,
    )])?;
    assert_eq!(side_effects(&processor), 1);

    let restored = build_test_processor(store.clone())?;
    let resume_position = restored.replay_cursor().unwrap().context.position;
    let mut replayed = Vec::new();
    if resume_position <= 100 {
        replayed.push(location);
    }
    if resume_position <= 200 {
        replayed.push(video_sync);
    }
    let mut context = crate::game_log_parser::LogContext::new();
    context.position = 300;
    restored.handle_jobs(vec![GameLogWorkerJob::Scan {
        events: replayed,
        origin: crate::GameLogEventOrigin::InitialScan,
        cursor: Box::new(crate::GameLogScanCursor {
            file_created_at: None,
            start_position: resume_position,
            rebuild: false,
            file_name: "output_log_current.txt".into(),
            context,
            cutoff: "2026-05-14T04:00:00Z".into(),
        }),
        publish: true,
        completed: None,
    }])?;
    assert_eq!(
        side_effects(&restored),
        0,
        "an already consumed side effect must not run again after a restart"
    );
    Ok(())
}

struct InlineVideoTaskExecutor;

impl vrcx_0_application_core::RuntimeTaskExecutor for InlineVideoTaskExecutor {
    fn spawn(
        &self,
        task: vrcx_0_application_core::RuntimeTask,
    ) -> Box<dyn vrcx_0_application_core::RuntimeTaskHandle> {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(task);
        Box::new(Self)
    }
}

impl vrcx_0_application_core::RuntimeTaskHandle for InlineVideoTaskExecutor {
    fn abort(&self) {}
    fn is_finished(&self) -> bool {
        true
    }
    fn join_or_abort(&mut self, _timeout: std::time::Duration) {}
}

struct VideoMetadataFixture;

#[async_trait::async_trait]
impl crate::VideoMetadataPort for VideoMetadataFixture {
    async fn youtube_metadata(
        &self,
        video_id: &str,
        api_key: &str,
    ) -> Result<Option<serde_json::Value>> {
        assert_eq!(video_id, "dQw4w9WgXcQ");
        assert_eq!(api_key, "test-key");
        Ok(Some(serde_json::json!({ "items": [{
            "snippet": { "title": "Resolved video title", "thumbnails": {
                "high": { "url": "https://example.test/thumbnail.jpg" }
            } },
            "contentDetails": { "duration": "PT3M20S" }
        }] })))
    }
}

#[test]
fn video_notifications_use_enriched_activity_and_respect_replay_and_surface_filters() -> Result<()>
{
    for (initial_scan, persistence_disabled, enabled) in [
        (false, false, true),
        (false, true, true),
        (true, false, true),
        (true, true, true),
        (false, false, false),
    ] {
        let (_dir, store, mut processor) = test_processor("video-notification-channel")?;
        store.set_bool("youtubeAPI", true)?;
        store.set_string("youtubeAPIKey", "test-key")?;
        store.set_bool("gameLogDisabled", persistence_disabled)?;
        processor.deps.video_metadata = Arc::new(VideoMetadataFixture);
        processor.deps.auth_scope.set("usr_video_owner", "");
        processor.deps.tasks.set_executor(InlineVideoTaskExecutor);
        let overlay = &processor.deps.overlay_activity;
        let scope = if enabled { "on" } else { "off" };
        let mut filters = serde_json::json!({ "version": 1 });
        for surface in ["wrist", "desktop", "vr", "hmd", "webhook", "tts"] {
            filters[surface] = serde_json::json!({ "types": { "VideoPlay": { "scope": scope } } });
        }
        overlay.set_filters(OverlayActivityFilters::from_json(filters));
        overlay.set_delivery_armed(true);
        let sink = RecordingOverlaySink::default();
        overlay.set_sink(sink.clone());
        let timestamp = chrono::Utc::now().to_rfc3339();
        let video = event(
            &timestamp,
            GameLogEventKind::VideoPlay {
                video_url: "https://youtu.be/dQw4w9WgXcQ".into(),
                display_name: "Video User".into(),
            },
        );
        let location = event(
            &timestamp,
            GameLogEventKind::Location {
                location: "wrld_video:123".into(),
                world_name: "Video World".into(),
            },
        );
        processor.handle_jobs(
            [location, video.clone(), video]
                .into_iter()
                .map(|event| {
                    if initial_scan {
                        GameLogWorkerJob::InitialEvent(event)
                    } else {
                        GameLogWorkerJob::Event(event)
                    }
                })
                .collect(),
        )?;
        let deliveries = sink.take_deliveries();
        if initial_scan || !enabled {
            assert!(deliveries.is_empty());
            assert!(overlay.snapshot().entries.is_empty());
        } else {
            assert_eq!(deliveries.len(), 1);
            let delivery = &deliveries[0];
            assert_eq!(delivery.entry.activity_type, "VideoPlay");
            assert_eq!(
                delivery.entry.content.body.source_text(),
                "Resolved video title"
            );
            assert_eq!(delivery.entry.content.world_name, "Video World");
            assert_eq!(
                delivery.entry.payload.trimmed_text("thumbnailUrl"),
                "https://example.test/thumbnail.jpg"
            );
            assert!(
                delivery.desktop && delivery.vr && delivery.hmd && delivery.webhook && delivery.tts
            );
            assert_eq!(overlay.snapshot().entries, vec![delivery.entry.clone()]);
        }
    }
    Ok(())
}

struct ScopeChangingVideoMetadata {
    auth_scope: RuntimeAuthScope,
    overlay: OverlayActivityRuntime,
    next_user_id: &'static str,
}

#[async_trait::async_trait]
impl crate::VideoMetadataPort for ScopeChangingVideoMetadata {
    async fn youtube_metadata(
        &self,
        video_id: &str,
        api_key: &str,
    ) -> Result<Option<serde_json::Value>> {
        self.auth_scope.set("", "");
        self.overlay.clear_runtime_state();
        if !self.next_user_id.is_empty() {
            self.auth_scope.set(self.next_user_id, "");
            self.overlay.set_delivery_armed(true);
        }
        VideoMetadataFixture
            .youtube_metadata(video_id, api_key)
            .await
    }
}

#[test]
fn video_notifications_discard_metadata_completed_after_auth_scope_changes() -> Result<()> {
    for next_user_id in ["", "usr_other", "usr_video_owner"] {
        let (_dir, store, mut processor) = test_processor("video-notification-auth-scope")?;
        store.set_bool("youtubeAPI", true)?;
        store.set_string("youtubeAPIKey", "test-key")?;
        processor.deps.auth_scope.set("usr_video_owner", "");
        processor.deps.tasks.set_executor(InlineVideoTaskExecutor);
        processor.deps.video_metadata = Arc::new(ScopeChangingVideoMetadata {
            auth_scope: processor.deps.auth_scope.clone(),
            overlay: processor.deps.overlay_activity.clone(),
            next_user_id,
        });
        let overlay = &processor.deps.overlay_activity;
        let sink = RecordingOverlaySink::default();
        overlay.set_sink(sink.clone());
        overlay.set_delivery_armed(true);
        processor.handle_jobs(vec![GameLogWorkerJob::Event(event(
            &chrono::Utc::now().to_rfc3339(),
            GameLogEventKind::VideoPlay {
                video_url: "https://youtu.be/dQw4w9WgXcQ".into(),
                display_name: "Video User".into(),
            },
        ))])?;
        assert!(sink.take_deliveries().is_empty());
        assert!(overlay.snapshot().entries.is_empty());
    }
    Ok(())
}
