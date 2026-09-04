use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use vrcx_0_application_core::NoopWorldCachePort;
use vrcx_0_contracts::game_log::{GameLogLocationEntry, GameLogWriteBatch};
use vrcx_0_core::game_log_parser::{GameLogEvent, GameLogEventKind};

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
        1,
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
        assert_eq!(local.since_ms, Some(5_000));
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
    assert_eq!(timers.snapshot()[0].since_ms, Some(2_000));

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
    assert_eq!(timers.snapshot()[0].since_ms, Some(2_000));

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

    processor.handle_jobs(vec![
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
    ])?;

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
            || event.name == "gameLogProjection"
    }));
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
fn suppresses_seeded_location_join_overlay_notifications() -> Result<()> {
    let _dir = TestDir::new("runtime-gamelog-seeded-join-suppress");
    let store = Arc::new(TestGameStateStore::default());
    store.write_game_log(
        &OwnerId::new(""),
        &GameLogWriteBatch {
            locations: vec![GameLogLocationEntry {
                created_at: "2026-05-14T08:05:00.000Z".into(),
                location: "wrld_seeded:123".into(),
                world_id: "wrld_seeded".into(),
                world_name: "Seeded World".into(),
                time: 0,
                group_name: String::new(),
            }],
            ..GameLogWriteBatch::default()
        },
    )?;
    let processor = build_test_processor(Arc::clone(&store))?;

    processor.handle_jobs(vec![GameLogWorkerJob::Event(event(
        "2026-05-14T08:05:10.000Z",
        GameLogEventKind::PlayerJoined {
            display_name: "Seeded Existing Player".into(),
            user_id: "usr_seeded_existing".into(),
        },
    ))])?;

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
