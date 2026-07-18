use super::*;
use crate::avatar_cache::tests::test_avatar_bitmap;
use crate::surfaces::friends::FRIENDS_PANEL_CATEGORY_SAME_INSTANCE;
use std::sync::atomic::{AtomicUsize, Ordering};
use vrcx_0_application_core::WebClient;
use vrcx_0_application_game::{PlayerState, RuntimeSnapshot};
use vrcx_0_host_desktop::vr_overlay::OverlayHand;
use vrcx_0_vr_overlay::SlintPanelEvent;
use vrcx_0_vr_overlay::UvPoint;
use vrcx_0_vr_overlay::{
    FriendPanelCategory, FriendPanelRow, FriendPanelRowActions, FriendPanelStatusTone,
};

pub(crate) struct TestOverlayRuntimeServices {
    data: Arc<vrcx_0_runtime_host::RuntimeHostContext>,
    game_log_snapshot: Arc<Mutex<RuntimeSnapshot>>,
}

impl TestOverlayRuntimeServices {
    fn new(data: Arc<vrcx_0_runtime_host::RuntimeHostContext>) -> Self {
        Self {
            data,
            game_log_snapshot: Arc::new(Mutex::new(RuntimeSnapshot::default())),
        }
    }

    pub(crate) fn data(&self) -> &vrcx_0_runtime_host::RuntimeHostContext {
        self.data.as_ref()
    }

    fn game_log_snapshot_handle(&self) -> Arc<Mutex<RuntimeSnapshot>> {
        Arc::clone(&self.game_log_snapshot)
    }
}

impl crate::VrOverlayRuntimeServices for TestOverlayRuntimeServices {
    fn data(&self) -> &vrcx_0_runtime_host::RuntimeHostContext {
        self.data()
    }

    fn game_log_snapshot(&self) -> RuntimeSnapshot {
        self.game_log_snapshot
            .lock()
            .map(|snapshot| snapshot.clone())
            .unwrap_or_default()
    }
}

fn friends_panel_input(kind: OverlayInputKind, uv: UvPoint) -> OverlayInputEvent {
    OverlayInputEvent {
        surface_id: OverlaySurfaceId::new(FRIENDS_PANEL_SURFACE_ID),
        panel_id: FRIENDS_PANEL_ID.to_string(),
        hand: OverlayHand::Left,
        uv,
        kind,
    }
}

fn queued_friends_panel_input(
    kind: OverlayInputKind,
    uv: UvPoint,
    release_fallback_uv: Option<UvPoint>,
) -> FriendsPanelQueuedInput {
    FriendsPanelQueuedInput {
        event: friends_panel_input(kind, uv),
        release_fallback_uv,
    }
}

fn friends_panel_summon_input(transform: OverlayTransform) -> OverlayInputEvent {
    friends_panel_input(
        OverlayInputKind::Summon { transform },
        UvPoint::new(0.5, 0.5),
    )
}

fn legacy_dummy_summon_input(transform: OverlayTransform) -> OverlayInputEvent {
    OverlayInputEvent {
        surface_id: OverlaySurfaceId::new("interactive-dummy"),
        panel_id: LEGACY_DUMMY_PANEL_ID.to_string(),
        hand: OverlayHand::Left,
        uv: UvPoint::new(0.5, 0.5),
        kind: OverlayInputKind::Summon { transform },
    }
}

fn friend_panel_test_row(
    user_id: impl Into<String>,
    display_name: impl Into<String>,
    status: FriendPanelStatusTone,
) -> FriendPanelRow {
    FriendPanelRow {
        section_label: None,
        user_id: user_id.into(),
        display_name: display_name.into(),
        status,
        location_text: "World".to_string(),
        is_traveling: false,
        traveling_text: None,
        note: None,
        memo: None,
        avatar: None,
        actions: FriendPanelRowActions::default(),
    }
}

pub(crate) struct TestDir {
    path: std::path::PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "vrcx-0-vr-overlay-{name}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

pub(crate) fn test_services(
    name: &str,
) -> (
    TestDir,
    Arc<vrcx_0_persistence::DatabaseService>,
    Arc<TestOverlayRuntimeServices>,
) {
    let dir = TestDir::new(name);
    let db = Arc::new(
        vrcx_0_persistence::DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap(),
    );
    let storage =
        vrcx_0_persistence::storage::StorageService::new(&dir.path.join("VRCX-0.json")).unwrap();
    let web = Arc::new(
        WebClient::new(
            &storage,
            &db,
            "https://app.example".into(),
            env!("CARGO_PKG_VERSION"),
        )
        .unwrap(),
    );
    let image_fetcher = web.image_fetcher().unwrap();
    let image_cache = Arc::new(
        vrcx_0_application_core::ImageCache::new(dir.path.join("ImageCache"), image_fetcher)
            .unwrap(),
    );
    let data = Arc::new(vrcx_0_runtime_host::RuntimeHostContext::new(
        Arc::clone(&db),
        web,
        image_cache,
    ));
    let services = Arc::new(TestOverlayRuntimeServices::new(data));
    (dir, db, services)
}

fn friends_panel_enabled_runtime_with_services(
    services: Arc<TestOverlayRuntimeServices>,
) -> VrOverlayRuntime {
    let config = VrOverlayRuntimeConfig {
        panel_enabled: true,
        ..VrOverlayRuntimeConfig::default()
    };
    VrOverlayRuntime::new_with_frame_producer_factory(
        true,
        Some(services),
        config,
        Box::new(|| Box::<StaticWristFrameProducer>::default()),
    )
}

pub(crate) fn hmd_enabled_runtime_with_services(
    services: Arc<TestOverlayRuntimeServices>,
) -> Arc<VrOverlayRuntime> {
    services
        .data()
        .config()
        .set_bool(HMD_NOTIFICATIONS_ENABLED_CONFIG_KEY, true)
        .unwrap();
    services
        .data()
        .config()
        .set_string(HMD_NOTIFICATION_START_MODE_CONFIG_KEY, "steamvr")
        .unwrap();
    let runtime = Arc::new(VrOverlayRuntime::new_with_frame_producer_factory(
        true,
        Some(services),
        VrOverlayRuntimeConfig {
            panel_enabled: true,
            hmd: HmdNotificationConfig {
                enabled: true,
                start_mode: WristOverlayStartMode::SteamVr,
                ..HmdNotificationConfig::default()
            },
            ..VrOverlayRuntimeConfig::default()
        },
        Box::new(|| Box::<StaticWristFrameProducer>::default()),
    ));
    record_process_status(&runtime, false, true, false);
    runtime
}

pub(crate) fn friends_panel_snapshot(record: FriendRecord) -> RealtimeFriendSnapshot {
    RealtimeFriendSnapshot {
        current_user_id: "usr_self".to_string(),
        friends_by_id: [(record.id.clone(), record)].into_iter().collect(),
        ..RealtimeFriendSnapshot::default()
    }
}

fn set_friends_panel_favorite(runtime: &VrOverlayRuntime, user_id: &str) {
    runtime.update_friends_panel_favorite_groups_from_baseline(&serde_json::json!({
        "favoriteFriendGroups": [
            {
                "key": "friend:group_0",
                "displayName": "VIP"
            }
        ],
        "groupedFavoriteFriendIdsByGroupKey": {
            "friend:group_0": [user_id]
        }
    }));
}

fn visible_friends_panel_row(runtime: &VrOverlayRuntime, user_id: &str) -> FriendPanelRow {
    runtime
        .interactive_panel
        .lock()
        .unwrap()
        .model
        .rows
        .iter()
        .find(|row| row.user_id == user_id)
        .cloned()
        .unwrap_or_else(|| panic!("{user_id} visible row"))
}

#[test]
fn snapshot_and_is_running_use_mirror_when_manager_lock_is_busy() {
    let runtime = VrOverlayRuntime::new_for_test();
    runtime.running_mirror.store(true, Ordering::Release);
    *runtime.active_backend_mirror.lock().unwrap() = Some("openvr");
    let _manager = runtime.manager.lock().unwrap();

    assert!(runtime.is_running());
    let snapshot = runtime.snapshot();

    assert!(snapshot.running);
    assert_eq!(snapshot.active_backend.as_deref(), Some("openvr"));
}

#[test]
fn locale_is_render_only_config() {
    let base = VrOverlayRuntimeConfig::default();
    let mut translated = base;
    translated.locale = OverlayLocale::ZhCn;

    assert_eq!(base.surface_config_key(), translated.surface_config_key());
    assert!(!base.should_clear_device_snapshot_for(translated));
}

#[test]
fn show_instance_id_in_location_is_render_only_config() {
    let base = VrOverlayRuntimeConfig::default();
    let mut with_instance_id = base;
    with_instance_id.show_instance_id_in_location = true;

    assert_eq!(
        base.surface_config_key(),
        with_instance_id.surface_config_key()
    );
    assert!(!base.should_clear_device_snapshot_for(with_instance_id));
}

#[test]
fn clock_mode_is_render_only_config() {
    let base = VrOverlayRuntimeConfig::default();
    let mut hour12 = base;
    hour12.dt_hour12 = true;

    assert_eq!(base.surface_config_key(), hour12.surface_config_key());
    assert!(!base.should_clear_device_snapshot_for(hour12));
}

#[test]
fn friends_panel_translates_overlay_input_to_slint_pointer_events() {
    let size = OverlaySize::new(1080, 720);
    let moved = friends_panel_pointer_events(
        queued_friends_panel_input(OverlayInputKind::Hover, UvPoint::new(0.25, 0.5), None),
        size,
    );
    assert_eq!(
        moved,
        vec![SlintPanelPointerEvent::Moved { x: 270.0, y: 360.0 }]
    );

    let scrolled = friends_panel_pointer_events(
        queued_friends_panel_input(
            OverlayInputKind::Scroll { delta: 2.0 },
            UvPoint::new(0.5, 0.5),
            None,
        ),
        size,
    );
    assert_eq!(
        scrolled,
        vec![SlintPanelPointerEvent::Scrolled {
            x: 540.0,
            y: 360.0,
            delta_x: 0.0,
            delta_y: -212.0,
        }]
    );

    let exited = friends_panel_pointer_events(
        queued_friends_panel_input(OverlayInputKind::Hover, UvPoint::new(-1.0, -1.0), None),
        size,
    );
    assert_eq!(exited, vec![SlintPanelPointerEvent::Exited]);

    let release_outside = friends_panel_pointer_events(
        queued_friends_panel_input(
            OverlayInputKind::ClickUp,
            UvPoint::new(-1.0, -1.0),
            Some(UvPoint::new(0.25, 0.5)),
        ),
        size,
    );
    assert_eq!(
        release_outside,
        vec![
            SlintPanelPointerEvent::Released { x: 270.0, y: 360.0 },
            SlintPanelPointerEvent::Exited,
        ]
    );
}

#[test]
fn friends_panel_visible_without_active_model_animation_uses_normal_refresh_interval() {
    let runtime = VrOverlayRuntime::new_for_test();
    runtime.interactive_panel.lock().unwrap().visible = true;

    assert_eq!(runtime.refresh_interval(), WRIST_FRAME_REFRESH_INTERVAL);
}

#[test]
fn surface_config_key_tracks_surface_affecting_fields() {
    let base = VrOverlayRuntimeConfig::default();

    let mut resized = base;
    resized.render.size = WristOverlaySizePreset::Large;
    assert_ne!(base.surface_config_key(), resized.surface_config_key());

    let mut moved = base;
    moved.hand = WristOverlayHand::Right;
    assert_ne!(base.surface_config_key(), moved.surface_config_key());

    let mut button = base;
    button.button = OverlayActivationButton::Menu;
    assert_ne!(base.surface_config_key(), button.surface_config_key());
}

#[test]
fn changing_all_friends_setting_rebuilds_visible_friends_panel_model() {
    let runtime = VrOverlayRuntime::new_for_test();
    runtime.set_friends_panel_snapshot_provider(|| {
        Some(RealtimeFriendSnapshot {
            current_user_id: "usr_self".to_string(),
            friends_by_id: [
                (
                    "usr_favorite".to_string(),
                    FriendRecord {
                        id: "usr_favorite".to_string(),
                        display_name: "Favorite".to_string(),
                        state_bucket: "online".to_string(),
                        location: "wrld_home:123".to_string(),
                        world_id: "wrld_home".to_string(),
                        ..FriendRecord::default()
                    },
                ),
                (
                    "usr_other".to_string(),
                    FriendRecord {
                        id: "usr_other".to_string(),
                        display_name: "Other".to_string(),
                        state_bucket: "online".to_string(),
                        location: "wrld_home:123".to_string(),
                        world_id: "wrld_home".to_string(),
                        ..FriendRecord::default()
                    },
                ),
            ]
            .into_iter()
            .collect(),
            ..RealtimeFriendSnapshot::default()
        })
    });
    set_friends_panel_favorite(&runtime, "usr_favorite");
    runtime.apply_friends_panel_input(friends_panel_summon_input(OverlayTransform::identity()));
    assert_eq!(
        runtime
            .interactive_panel
            .lock()
            .unwrap()
            .model
            .rows
            .iter()
            .map(|row| row.user_id.as_str())
            .collect::<Vec<_>>(),
        vec!["usr_favorite", "usr_other"]
    );

    runtime.commit_runtime_config(
        VrOverlayRuntimeConfig {
            panel_enabled: true,
            panel_all_friends_includes_favorites: false,
            ..VrOverlayRuntimeConfig::default()
        },
        false,
    );
    {
        let mut manager = runtime.manager.lock().unwrap();
        runtime.push_friends_panel_frame(&mut manager);
    }

    assert_eq!(
        runtime
            .interactive_panel
            .lock()
            .unwrap()
            .model
            .rows
            .iter()
            .map(|row| row.user_id.as_str())
            .collect::<Vec<_>>(),
        vec!["usr_other"]
    );
}

#[test]
fn game_process_event_updates_runtime_game_running_state() {
    let runtime = VrOverlayRuntime::new_for_test();
    assert!(!runtime.game_running.load(Ordering::Acquire));

    record_process_status(&runtime, true, true, true);

    assert!(runtime.game_running.load(Ordering::Acquire));
}

#[test]
fn panel_enabled_false_disables_listener_even_when_steamvr_is_running() {
    let config = VrOverlayRuntimeConfig {
        panel_enabled: false,
        ..VrOverlayRuntimeConfig::default()
    };
    let runtime = VrOverlayRuntime::new_for_test_with_config_and_frame_producer_factory(
        true,
        config,
        Box::new(|| Box::<StaticWristFrameProducer>::default()),
    );

    record_process_status(&runtime, false, true, false);

    assert!(!runtime.is_running());
    assert!(!runtime.active_surfaces(config).panel_listener);
}

#[test]
fn panel_disabled_ignores_summon_input_even_if_backend_is_running() {
    let config = VrOverlayRuntimeConfig {
        panel_enabled: false,
        hmd: HmdNotificationConfig {
            enabled: true,
            start_mode: WristOverlayStartMode::SteamVr,
            ..HmdNotificationConfig::default()
        },
        ..VrOverlayRuntimeConfig::default()
    };
    let runtime = VrOverlayRuntime::new_for_test_with_config_and_frame_producer_factory(
        true,
        config,
        Box::new(|| Box::<StaticWristFrameProducer>::default()),
    );

    record_process_status(&runtime, false, true, false);
    assert!(runtime.is_running());

    let outcome =
        runtime.apply_friends_panel_input(friends_panel_summon_input(OverlayTransform::identity()));

    assert!(!outcome.surface_config_changed);
    assert!(!outcome.frame_changed);
    assert!(runtime.friends_panel_surface_config().is_none());
    assert!(!runtime.interactive_panel.lock().unwrap().visible);
}

#[test]
fn disabling_panel_closes_visible_friends_panel() {
    let runtime = VrOverlayRuntime::new_for_test();
    runtime.apply_friends_panel_input(friends_panel_summon_input(OverlayTransform::identity()));
    assert!(runtime.friends_panel_surface_config().is_some());

    runtime.commit_runtime_config(
        VrOverlayRuntimeConfig {
            panel_enabled: false,
            ..VrOverlayRuntimeConfig::default()
        },
        false,
    );

    assert!(runtime.friends_panel_surface_config().is_none());
    assert!(!runtime.interactive_panel.lock().unwrap().visible);
}

#[test]
fn input_drain_interval_is_fast_while_panel_listener_is_available() {
    let runtime = VrOverlayRuntime::new_for_test();

    assert_eq!(runtime.input_drain_interval(), WRIST_FRAME_REFRESH_INTERVAL);

    record_process_status(&runtime, false, true, false);

    assert!(
        runtime
            .active_surfaces(runtime.current_runtime_config())
            .panel_listener
    );
    assert!(runtime.input_drain_interval() <= Duration::from_millis(100));
}

#[test]
fn hidden_panel_state_does_not_accelerate_refresh_or_input_drain_intervals() {
    let runtime = VrOverlayRuntime::new_for_test_with_config_and_frame_producer_factory(
        true,
        VrOverlayRuntimeConfig::default(),
        Box::new(|| Box::<StaticWristFrameProducer>::default()),
    );
    {
        let mut panel = runtime.interactive_panel.lock().unwrap();
        panel.visible = true;
        panel.focused = true;
        panel.slint_animation_active = true;
        panel.armed_action_expires_at = Some(Instant::now() + Duration::from_secs(1));
    }

    assert_eq!(runtime.refresh_interval(), WRIST_FRAME_REFRESH_INTERVAL);
    assert_eq!(runtime.input_drain_interval(), WRIST_FRAME_REFRESH_INTERVAL);
}

#[test]
fn friends_panel_summon_toggles_absolute_surface_and_refresh_rate() {
    let runtime = VrOverlayRuntime::new_for_test();
    let transform = OverlayTransform::from_translation([1.0, 1.2, -2.0]);

    assert_eq!(runtime.refresh_interval(), WRIST_FRAME_REFRESH_INTERVAL);

    let summon_outcome = runtime.apply_friends_panel_input(friends_panel_summon_input(transform));
    assert!(summon_outcome.surface_config_changed);

    assert_eq!(runtime.refresh_interval(), WRIST_FRAME_REFRESH_INTERVAL);
    let config = runtime
        .friends_panel_surface_config()
        .expect("friends surface config");
    assert!(config.interactive);
    assert_eq!(config.surface_id.as_str(), FRIENDS_PANEL_SURFACE_ID);
    assert!(matches!(
        config.placement,
        OverlayPlacement::Absolute { transform: value } if value == transform
    ));
    let configs = overlay_surface_configs(
        ActiveOverlaySurfaces {
            friends_panel: true,
            ..ActiveOverlaySurfaces::default()
        },
        runtime.current_runtime_config(),
        &runtime,
    );
    let laser_configs = configs
        .iter()
        .filter(|config| {
            matches!(
                config.surface_id.as_str(),
                FRIENDS_PANEL_LASER_LEFT_SURFACE_ID | FRIENDS_PANEL_LASER_RIGHT_SURFACE_ID
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(laser_configs.len(), 2);
    assert!(laser_configs
        .iter()
        .all(|config| !config.interactive && config.size == FRIENDS_PANEL_LASER_SIZE));

    let dismiss_outcome = runtime.apply_friends_panel_input(friends_panel_summon_input(transform));
    assert!(dismiss_outcome.surface_config_changed);

    assert_eq!(runtime.refresh_interval(), WRIST_FRAME_REFRESH_INTERVAL);
    assert!(runtime.friends_panel_surface_config().is_none());
}

#[test]
fn friends_panel_visible_without_traveling_keeps_stale_refresh_interval() {
    let runtime = VrOverlayRuntime::new_for_test();
    runtime.apply_friends_panel_input(friends_panel_summon_input(OverlayTransform::identity()));
    {
        let mut panel = runtime.interactive_panel.lock().unwrap();
        panel.model.rows = vec![friend_panel_test_row(
            "usr_1",
            "Friend",
            FriendPanelStatusTone::Online,
        )];
    }

    assert_eq!(runtime.refresh_interval(), WRIST_FRAME_REFRESH_INTERVAL);
}

#[test]
fn friends_panel_visible_slint_animation_uses_low_frequency_refresh() {
    let runtime = VrOverlayRuntime::new_for_test();
    runtime.apply_friends_panel_input(friends_panel_summon_input(OverlayTransform::identity()));
    {
        let mut panel = runtime.interactive_panel.lock().unwrap();
        panel.slint_animation_active = true;
    }

    assert_eq!(
        runtime.refresh_interval(),
        FRIENDS_PANEL_ANIMATION_REFRESH_INTERVAL
    );

    runtime.apply_friends_panel_input(friends_panel_summon_input(OverlayTransform::identity()));

    assert_eq!(runtime.refresh_interval(), WRIST_FRAME_REFRESH_INTERVAL);
}

#[test]
fn friends_panel_rebuild_preserves_status_message() {
    let runtime = VrOverlayRuntime::new_for_test();
    runtime.apply_friends_panel_input(friends_panel_summon_input(OverlayTransform::identity()));
    {
        let mut panel = runtime.interactive_panel.lock().unwrap();
        panel.model.status_message = Some("Sending invite...".to_string());
    }

    runtime.rebuild_visible_friends_panel_model();

    assert_eq!(
        runtime
            .interactive_panel
            .lock()
            .unwrap()
            .model
            .status_message
            .as_deref(),
        Some("Sending invite...")
    );
}

#[test]
fn overlay_activity_snapshot_marks_friends_panel_dirty_for_presence_changes() {
    let runtime = Arc::new(VrOverlayRuntime::new_for_test());
    let snapshot_slot = Arc::new(Mutex::new(friends_panel_snapshot(FriendRecord {
        id: "usr_friend".to_string(),
        display_name: "Friend".to_string(),
        state_bucket: "online".to_string(),
        location: "wrld_home:123".to_string(),
        world_id: "wrld_home".to_string(),
        ..FriendRecord::default()
    })));
    runtime.set_friends_panel_snapshot_provider({
        let snapshot_slot = Arc::clone(&snapshot_slot);
        move || snapshot_slot.lock().ok().map(|snapshot| snapshot.clone())
    });
    set_friends_panel_favorite(&runtime, "usr_friend");
    runtime.apply_friends_panel_input(friends_panel_summon_input(OverlayTransform::identity()));
    {
        let mut manager = runtime.manager.lock().unwrap();
        runtime.push_friends_panel_frame(&mut manager);
    }
    assert!(!visible_friends_panel_row(&runtime, "usr_friend").is_traveling);

    *snapshot_slot.lock().unwrap() = friends_panel_snapshot(FriendRecord {
        id: "usr_friend".to_string(),
        display_name: "Friend".to_string(),
        state_bucket: "online".to_string(),
        location: "traveling".to_string(),
        traveling_to_location: "wrld_target:456".to_string(),
        ..FriendRecord::default()
    });
    let sink = VrOverlayActivitySink::new(Arc::clone(&runtime));
    sink.emit_overlay_activity_snapshot(OverlayActivitySnapshot::default());
    {
        let mut manager = runtime.manager.lock().unwrap();
        runtime.push_friends_panel_frame(&mut manager);
    }

    assert!(visible_friends_panel_row(&runtime, "usr_friend").is_traveling);
}

#[test]
fn game_log_player_snapshot_marks_same_instance_panel_dirty() {
    let (_dir, _db, services) = test_services("friends-panel-game-log-same-instance");
    services
        .data()
        .config()
        .set_string(
            VR_OVERLAY_PANEL_SELECTED_CATEGORY_CONFIG_KEY,
            FRIENDS_PANEL_CATEGORY_SAME_INSTANCE,
        )
        .unwrap();
    let runtime = friends_panel_enabled_runtime_with_services(Arc::clone(&services));
    runtime.set_friends_panel_snapshot_provider(|| {
        Some(RealtimeFriendSnapshot {
            current_user_id: "usr_self".to_string(),
            friends_by_id: [
                (
                    "usr_anchor".to_string(),
                    FriendRecord {
                        id: "usr_anchor".to_string(),
                        display_name: "Anchor".to_string(),
                        state_bucket: "online".to_string(),
                        location: "wrld_live:123".to_string(),
                        world_id: "wrld_live".to_string(),
                        ..FriendRecord::default()
                    },
                ),
                (
                    "usr_fallback".to_string(),
                    FriendRecord {
                        id: "usr_fallback".to_string(),
                        display_name: "Fallback".to_string(),
                        state_bucket: "online".to_string(),
                        location: "private".to_string(),
                        ..FriendRecord::default()
                    },
                ),
            ]
            .into_iter()
            .collect(),
            ..RealtimeFriendSnapshot::default()
        })
    });
    runtime.apply_friends_panel_input(friends_panel_summon_input(OverlayTransform::identity()));
    assert!(runtime
        .interactive_panel
        .lock()
        .unwrap()
        .model
        .rows
        .is_empty());

    *services.game_log_snapshot_handle().lock().unwrap() = RuntimeSnapshot {
        location: "wrld_live:123".to_string(),
        players: vec![PlayerState {
            user_id: "usr_fallback".to_string(),
            display_name: "Fallback".to_string(),
            join_time_ms: None,
        }],
        ..RuntimeSnapshot::default()
    };
    runtime
        .ingest_game_log_event(&GameLogEvent {
            file_name: "output_log.txt".to_string(),
            created_at: "2026-06-01T12:34:56.000Z".to_string(),
            kind: GameLogEventKind::PlayerJoined {
                display_name: "Fallback".to_string(),
                user_id: "usr_fallback".to_string(),
            },
        })
        .unwrap();
    {
        let mut manager = runtime.manager.lock().unwrap();
        runtime.push_friends_panel_frame(&mut manager);
    }

    assert_eq!(
        runtime
            .interactive_panel
            .lock()
            .unwrap()
            .model
            .rows
            .iter()
            .filter(|row| !row.user_id.is_empty())
            .map(|row| row.user_id.as_str())
            .collect::<Vec<_>>(),
        vec!["usr_anchor", "usr_fallback"]
    );
    assert_eq!(
        runtime
            .interactive_panel
            .lock()
            .unwrap()
            .model
            .rows
            .iter()
            .filter(|row| row.section_label.is_some())
            .count(),
        1
    );
}

#[test]
fn friends_panel_presence_rebuild_reuses_open_memo_cache() {
    let (_dir, db, services) = test_services("friends-panel-memo-cache");
    vrcx_0_persistence::memos::memo_save_user(
        db.as_ref(),
        "usr_friend".to_string(),
        "Cached memo".to_string(),
    )
    .unwrap();
    let runtime = friends_panel_enabled_runtime_with_services(services);
    runtime.set_friends_panel_snapshot_provider(|| {
        Some(friends_panel_snapshot(FriendRecord {
            id: "usr_friend".to_string(),
            display_name: "Friend".to_string(),
            state_bucket: "online".to_string(),
            location: "wrld_home:123".to_string(),
            world_id: "wrld_home".to_string(),
            ..FriendRecord::default()
        }))
    });
    set_friends_panel_favorite(&runtime, "usr_friend");
    runtime.apply_friends_panel_input(friends_panel_summon_input(OverlayTransform::identity()));
    assert_eq!(
        visible_friends_panel_row(&runtime, "usr_friend")
            .memo
            .as_deref(),
        Some("Cached memo")
    );

    vrcx_0_persistence::memos::memo_save_user(
        db.as_ref(),
        "usr_friend".to_string(),
        "Updated memo".to_string(),
    )
    .unwrap();
    runtime
        .friends_panel_model_dirty
        .store(true, Ordering::Release);
    {
        let mut manager = runtime.manager.lock().unwrap();
        runtime.push_friends_panel_frame(&mut manager);
    }

    assert_eq!(
        visible_friends_panel_row(&runtime, "usr_friend")
            .memo
            .as_deref(),
        Some("Cached memo")
    );
}

#[test]
fn legacy_dummy_panel_id_routes_to_friends_panel() {
    let runtime = VrOverlayRuntime::new_for_test();
    let transform = OverlayTransform::identity();
    let outcome = runtime.apply_friends_panel_input(legacy_dummy_summon_input(transform));

    assert!(outcome.surface_config_changed);
    assert_eq!(
        runtime
            .friends_panel_surface_config()
            .expect("friends surface config")
            .surface_id
            .as_str(),
        FRIENDS_PANEL_SURFACE_ID
    );
}

#[test]
fn friends_panel_routes_pointer_input_to_slint_queue_and_category_callback_to_model() {
    let runtime = VrOverlayRuntime::new_for_test();
    let transform = OverlayTransform::identity();
    runtime.apply_friends_panel_input(friends_panel_summon_input(transform));
    {
        let mut panel = runtime.interactive_panel.lock().unwrap();
        panel.model.categories = vec![
            FriendPanelCategory {
                key: FRIENDS_PANEL_CATEGORY_ALL.to_string(),
                label: "All".to_string(),
                count: 7,
            },
            FriendPanelCategory {
                key: "group:local:Best".to_string(),
                label: "Best".to_string(),
                count: 2,
            },
        ];
        panel.model.rows = (0..7)
            .map(|index| {
                friend_panel_test_row(
                    format!("usr_{index}"),
                    format!("Friend {index}"),
                    FriendPanelStatusTone::Active,
                )
            })
            .collect();
    }
    let outcome = runtime.apply_friends_panel_input(friends_panel_input(
        OverlayInputKind::Hover,
        UvPoint::new(0.25, 0.5),
    ));
    assert!(outcome.frame_changed);
    assert_eq!(runtime.drain_friends_panel_input_events().len(), 1);

    assert!(
        runtime.apply_friends_panel_slint_events(vec![SlintPanelEvent::CategorySelected(
            "group:local:Best".to_string()
        )])
    );

    let panel = runtime.interactive_panel.lock().unwrap();
    assert!(panel.focused);
    assert_eq!(panel.model.selected_category_key, "group:local:Best");
}

#[test]
fn friends_panel_action_click_arms_then_same_button_fires_and_disarms() {
    let runtime = VrOverlayRuntime::new_for_test();
    runtime.apply_friends_panel_input(friends_panel_summon_input(OverlayTransform::identity()));

    assert!(
        runtime.apply_friends_panel_slint_events(vec![SlintPanelEvent::ActionClicked {
            user_id: "usr_a".to_string(),
            kind: "open".to_string(),
        }])
    );
    {
        let panel = runtime.interactive_panel.lock().unwrap();
        assert_eq!(
            panel.model.armed_action_region_id.as_deref(),
            Some("action:usr_a:open")
        );
        assert!(panel.armed_action_expires_at.is_some());
    }

    assert!(
        runtime.apply_friends_panel_slint_events(vec![SlintPanelEvent::ActionClicked {
            user_id: "usr_a".to_string(),
            kind: "open".to_string(),
        }])
    );
    let panel = runtime.interactive_panel.lock().unwrap();
    assert!(panel.model.armed_action_region_id.is_none());
    assert!(panel.armed_action_expires_at.is_none());
}

#[test]
fn friends_panel_action_click_on_other_button_rearms_instead_of_firing() {
    let runtime = VrOverlayRuntime::new_for_test();
    runtime.apply_friends_panel_input(friends_panel_summon_input(OverlayTransform::identity()));

    runtime.apply_friends_panel_slint_events(vec![SlintPanelEvent::ActionClicked {
        user_id: "usr_a".to_string(),
        kind: "open".to_string(),
    }]);
    runtime.apply_friends_panel_slint_events(vec![SlintPanelEvent::ActionClicked {
        user_id: "usr_b".to_string(),
        kind: "invite".to_string(),
    }]);

    let panel = runtime.interactive_panel.lock().unwrap();
    assert_eq!(
        panel.model.armed_action_region_id.as_deref(),
        Some("action:usr_b:invite")
    );
    assert!(panel.armed_action_expires_at.is_some());
}

#[test]
fn friends_panel_row_click_and_armed_hover_loss_disarm() {
    let runtime = VrOverlayRuntime::new_for_test();
    runtime.apply_friends_panel_input(friends_panel_summon_input(OverlayTransform::identity()));

    runtime.apply_friends_panel_slint_events(vec![SlintPanelEvent::ActionClicked {
        user_id: "usr_a".to_string(),
        kind: "open".to_string(),
    }]);
    assert!(runtime
        .apply_friends_panel_slint_events(vec![SlintPanelEvent::RowClicked("usr_b".to_string())]));
    assert!(runtime
        .interactive_panel
        .lock()
        .unwrap()
        .model
        .armed_action_region_id
        .is_none());

    runtime.apply_friends_panel_slint_events(vec![SlintPanelEvent::ActionClicked {
        user_id: "usr_a".to_string(),
        kind: "invite".to_string(),
    }]);
    runtime.apply_friends_panel_slint_events(vec![SlintPanelEvent::ActionHoverLost {
        user_id: "usr_b".to_string(),
        kind: "invite".to_string(),
    }]);
    assert_eq!(
        runtime
            .interactive_panel
            .lock()
            .unwrap()
            .model
            .armed_action_region_id
            .as_deref(),
        Some("action:usr_a:invite")
    );
    runtime.apply_friends_panel_slint_events(vec![SlintPanelEvent::ActionHoverLost {
        user_id: "usr_a".to_string(),
        kind: "invite".to_string(),
    }]);
    assert!(runtime
        .interactive_panel
        .lock()
        .unwrap()
        .model
        .armed_action_region_id
        .is_none());
}

#[test]
fn friends_panel_unknown_action_kind_and_hidden_panel_are_ignored() {
    let runtime = VrOverlayRuntime::new_for_test();
    runtime.apply_friends_panel_input(friends_panel_summon_input(OverlayTransform::identity()));

    assert!(
        !runtime.apply_friends_panel_slint_events(vec![SlintPanelEvent::ActionClicked {
            user_id: "usr_a".to_string(),
            kind: "selfdestruct".to_string(),
        }])
    );
    assert!(runtime
        .interactive_panel
        .lock()
        .unwrap()
        .model
        .armed_action_region_id
        .is_none());

    runtime.close_friends_panel();
    assert!(
        !runtime.apply_friends_panel_slint_events(vec![SlintPanelEvent::ActionClicked {
            user_id: "usr_a".to_string(),
            kind: "open".to_string(),
        }])
    );
}

#[test]
fn friends_panel_arm_expires_after_timeout() {
    let mut panel = InteractivePanelRuntimeState::default();
    panel.model.armed_action_region_id = Some("action:usr_a:open".to_string());
    panel.armed_action_expires_at = Some(Instant::now() - Duration::from_millis(1));

    assert!(clear_expired_friends_panel_arm(&mut panel, Instant::now()));
    assert!(panel.model.armed_action_region_id.is_none());
    assert!(panel.armed_action_expires_at.is_none());

    panel.model.armed_action_region_id = Some("action:usr_a:open".to_string());
    panel.armed_action_expires_at = Some(Instant::now() + FRIENDS_PANEL_ACTION_ARM_TIMEOUT);
    assert!(!clear_expired_friends_panel_arm(&mut panel, Instant::now()));
    assert_eq!(
        panel.model.armed_action_region_id.as_deref(),
        Some("action:usr_a:open")
    );
}

#[test]
fn friends_panel_pointer_miss_clears_focus() {
    let runtime = VrOverlayRuntime::new_for_test();
    runtime.apply_friends_panel_input(friends_panel_summon_input(OverlayTransform::identity()));

    let miss = runtime.apply_friends_panel_input(friends_panel_input(
        OverlayInputKind::Hover,
        UvPoint::new(-1.0, -1.0),
    ));

    assert!(miss.frame_changed);
    assert!(!runtime.interactive_panel.lock().unwrap().focused);
}

#[test]
fn refresh_wake_wait_returns_after_notify() {
    let wake = Arc::new(RefreshWake::new());
    let waiting = Arc::clone(&wake);
    let started = Instant::now();
    let handle = std::thread::spawn(move || {
        let mut sequence = waiting.sequence();
        waiting.wait_timeout(Duration::from_secs(5), &mut sequence);
    });

    std::thread::sleep(Duration::from_millis(20));
    wake.notify();
    handle.join().unwrap();

    assert!(started.elapsed() < Duration::from_secs(1));
}

#[test]
fn refresh_loop_consumes_wake_sent_before_first_wait() {
    let created = Arc::new(AtomicUsize::new(0));
    let dropped = Arc::new(AtomicUsize::new(0));
    let runtime = Arc::new(
        VrOverlayRuntime::new_for_test_with_config_and_frame_producer_factory(
            true,
            VrOverlayRuntimeConfig::default(),
            counting_frame_producer_factory(Arc::clone(&created), dropped),
        ),
    );
    runtime.enabled.store(true, Ordering::Release);
    runtime.game_running.store(true, Ordering::Release);
    runtime.vr_mode.store(true, Ordering::Release);
    runtime.steamvr_running.store(true, Ordering::Release);
    runtime.refresh_wake.notify();

    let tasks = TaskSupervisor::new();
    runtime.start_refresh_loop(tasks.clone());
    let started = Instant::now();
    while created.load(Ordering::SeqCst) == 0 && started.elapsed() < Duration::from_millis(250) {
        std::thread::sleep(Duration::from_millis(5));
    }

    let stop_tasks = tasks.clone();
    let stop_handle = std::thread::spawn(move || stop_tasks.stop_all());
    std::thread::sleep(Duration::from_millis(20));
    runtime.refresh_wake.notify();
    stop_handle.join().unwrap();

    assert!(created.load(Ordering::SeqCst) > 0);
}

#[test]
fn input_drain_outcome_wakes_refresh_without_consuming_dirty_frame() {
    let runtime = VrOverlayRuntime::new_for_test();
    runtime
        .friends_panel_frame_dirty
        .store(true, Ordering::Release);
    let before = runtime.refresh_wake.sequence();

    runtime.handle_overlay_input_drain_outcome(OverlayInputProcessOutcome {
        surface_config_changed: false,
        frame_changed: true,
    });

    assert!(runtime.refresh_wake.sequence() > before);
    assert!(runtime.friends_panel_frame_dirty.load(Ordering::Acquire));
}

#[test]
fn deferred_forced_device_refresh_is_consumed_once() {
    let runtime = VrOverlayRuntime::new_for_test();
    assert!(!runtime.consume_device_refresh_request());

    let before_forced = runtime.refresh_wake.sequence();
    runtime.defer_refresh_to_refresh_thread(true);
    assert!(runtime.refresh_wake.sequence() > before_forced);
    assert!(runtime.consume_device_refresh_request());
    assert!(!runtime.consume_device_refresh_request());

    runtime.defer_refresh_to_refresh_thread(false);
    assert!(!runtime.consume_device_refresh_request());
}

#[test]
fn friends_panel_session_clear_drops_cached_favorite_groups() {
    let runtime = VrOverlayRuntime::new_for_test();
    let snapshot = serde_json::json!({
        "favoriteFriendGroups": [
            {
                "key": "friend:group_0",
                "displayName": "VIP"
            }
        ],
        "groupedFavoriteFriendIdsByGroupKey": {
            "friend:group_0": ["usr_a"]
        }
    });
    runtime.update_friends_panel_favorite_groups_from_baseline(&snapshot);
    assert!(!runtime
        .current_friends_panel_favorite_groups()
        .groups
        .is_empty());

    runtime.clear_friends_panel_session_state();

    assert!(runtime
        .current_friends_panel_favorite_groups()
        .groups
        .is_empty());
}

#[test]
fn render_options_do_not_rebuild_surface_except_size() {
    let base = VrOverlayRuntimeConfig::default();

    let mut dark_background = base;
    dark_background.render.dark_background = !dark_background.render.dark_background;
    assert_eq!(
        base.surface_config_key(),
        dark_background.surface_config_key()
    );

    let mut percent = base;
    percent.render.show_battery_percent = !percent.render.show_battery_percent;
    assert_eq!(base.surface_config_key(), percent.surface_config_key());
}

#[test]
fn friends_panel_avatar_session_clear_rejects_stale_insert() {
    let runtime = VrOverlayRuntime::new_for_test();
    let session_generation = runtime
        .friends_panel_avatar_session_generation
        .load(Ordering::Acquire);

    runtime.clear_friends_panel_session_state();

    assert!(!insert_friends_panel_avatar_if_session_current(
        &runtime.friends_panel_avatars,
        runtime.friends_panel_avatar_session_generation.as_ref(),
        session_generation,
        "usr_friend",
        test_avatar_bitmap(),
        "https://images.example/avatar",
        true,
    ));
    assert!(runtime.friends_panel_avatars.lock().unwrap().is_empty());
}

#[test]
fn game_stop_hmd_release_and_session_clear_drop_avatar_bitmap_cache() {
    let runtime = VrOverlayRuntime::new_for_test();
    runtime.avatar_bitmap_cache.store_success(
        "https://images.example/game",
        "usr_friend",
        test_avatar_bitmap(),
    );
    record_process_status(&runtime, true, true, true);
    record_process_status(&runtime, false, true, true);
    assert!(runtime
        .avatar_bitmap_cache
        .cached("https://images.example/game", "usr_friend")
        .is_none());

    runtime.avatar_bitmap_cache.store_success(
        "https://images.example/hmd",
        "usr_friend",
        test_avatar_bitmap(),
    );
    runtime.release_hmd_renderer();
    assert!(runtime
        .avatar_bitmap_cache
        .cached("https://images.example/hmd", "usr_friend")
        .is_none());

    runtime.avatar_bitmap_cache.store_success(
        "https://images.example/session",
        "usr_friend",
        test_avatar_bitmap(),
    );
    runtime.clear_friends_panel_session_state();
    assert!(runtime
        .avatar_bitmap_cache
        .cached("https://images.example/session", "usr_friend")
        .is_none());
}

#[test]
fn friends_panel_avatar_url_follows_vrc_plus_icon_config() {
    let record = FriendRecord {
        id: "usr_avatar".into(),
        current_avatar_thumbnail_image_url:
            "https://api.vrchat.cloud/api/1/file/file_avatar/3/256".into(),
        current_avatar_image_url:
            "https://api.vrchat.cloud/api/1/file/file_avatar/3/file".into(),
        extra: serde_json::json!({
            "userIcon": "https://api.vrchat.cloud/api/1/file/file_1234abcd-0000-1111-2222-abcdefabcdef/4/file",
            "profilePicOverrideThumbnail": "https://images.example/profile/256",
        })
        .as_object()
        .unwrap()
        .clone(),
        ..FriendRecord::default()
    };

    assert_eq!(
        friend_record_avatar_url(&record, true, "https://api.vrchat.cloud/api/1"),
        "https://api.vrchat.cloud/api/1/image/file_1234abcd-0000-1111-2222-abcdefabcdef/4/128"
    );
    assert_eq!(
        friend_record_avatar_url(&record, false, "https://api.vrchat.cloud/api/1"),
        "https://images.example/profile/128"
    );
}

#[test]
fn friends_panel_avatar_refetches_when_config_selects_different_url() {
    let (_dir, _db, services) = test_services("friends-panel-avatar-source-change");
    services
        .data()
        .config()
        .set_bool("displayVRCPlusIconsAsAvatar", false)
        .unwrap();
    let runtime = friends_panel_enabled_runtime_with_services(Arc::clone(&services));
    runtime.friends_panel_avatars.lock().unwrap().insert(
        "usr_avatar".into(),
        FriendsPanelAvatarCacheEntry {
            bitmap: test_avatar_bitmap(),
            source_url:
                "https://api.vrchat.cloud/api/1/image/file_1234abcd-0000-1111-2222-abcdefabcdef/4/128"
                    .into(),
            allow_user_icon: true,
        },
    );
    let record = FriendRecord {
        id: "usr_avatar".into(),
        extra: serde_json::json!({
            "userIcon": "https://api.vrchat.cloud/api/1/file/file_1234abcd-0000-1111-2222-abcdefabcdef/4/file",
            "profilePicOverrideThumbnail": "https://images.example/profile/256",
        })
        .as_object()
        .unwrap()
        .clone(),
        ..FriendRecord::default()
    };

    let runtime_services: Arc<dyn crate::VrOverlayRuntimeServices> = services.clone();
    assert!(runtime.queue_friends_panel_avatar(
        &runtime_services,
        "https://api.vrchat.cloud/api/1",
        &record
    ));
}

#[test]
fn frame_producer_is_created_only_while_runtime_can_render_and_released_when_ineligible() {
    let created = Arc::new(AtomicUsize::new(0));
    let dropped = Arc::new(AtomicUsize::new(0));
    let config = VrOverlayRuntimeConfig {
        panel_enabled: false,
        ..VrOverlayRuntimeConfig::default()
    };
    let runtime = VrOverlayRuntime::new_for_test_with_config_and_frame_producer_factory(
        true,
        config,
        counting_frame_producer_factory(Arc::clone(&created), Arc::clone(&dropped)),
    );

    assert_eq!(created.load(Ordering::SeqCst), 0);

    runtime.set_enabled(true);
    assert_eq!(created.load(Ordering::SeqCst), 0);

    record_process_status(&runtime, true, true, true);
    assert_eq!(created.load(Ordering::SeqCst), 0);

    runtime.set_vr_mode(true);
    assert!(runtime.is_running());
    assert_eq!(created.load(Ordering::SeqCst), 1);

    runtime.reconcile_current();
    assert_eq!(created.load(Ordering::SeqCst), 1);

    runtime.set_enabled(false);
    assert!(!runtime.is_running());
    assert_eq!(dropped.load(Ordering::SeqCst), 1);

    runtime.set_enabled(true);
    assert!(runtime.is_running());
    assert_eq!(created.load(Ordering::SeqCst), 2);
}

#[test]
fn steamvr_start_mode_releases_frame_producer_when_steamvr_stops_not_when_game_stops() {
    let created = Arc::new(AtomicUsize::new(0));
    let dropped = Arc::new(AtomicUsize::new(0));
    let config = VrOverlayRuntimeConfig {
        start_mode: WristOverlayStartMode::SteamVr,
        panel_enabled: false,
        ..VrOverlayRuntimeConfig::default()
    };
    let runtime = VrOverlayRuntime::new_for_test_with_config_and_frame_producer_factory(
        true,
        config,
        counting_frame_producer_factory(Arc::clone(&created), Arc::clone(&dropped)),
    );
    runtime.set_enabled(true);
    record_process_status(&runtime, true, true, true);
    assert!(runtime.is_running());
    assert_eq!(created.load(Ordering::SeqCst), 1);

    record_process_status(&runtime, false, true, true);
    assert!(runtime.is_running());
    assert_eq!(dropped.load(Ordering::SeqCst), 0);

    record_process_status(&runtime, false, false, false);
    assert!(!runtime.is_running());
    assert_eq!(dropped.load(Ordering::SeqCst), 1);
}

#[test]
fn hmd_default_start_mode_waits_for_vrchat_vr_mode() {
    let created = Arc::new(AtomicUsize::new(0));
    let dropped = Arc::new(AtomicUsize::new(0));
    let config = VrOverlayRuntimeConfig {
        panel_enabled: false,
        hmd: HmdNotificationConfig {
            enabled: true,
            ..HmdNotificationConfig::default()
        },
        ..VrOverlayRuntimeConfig::default()
    };
    let runtime = VrOverlayRuntime::new_for_test_with_config_and_frame_producer_factory(
        true,
        config,
        counting_frame_producer_factory(Arc::clone(&created), Arc::clone(&dropped)),
    );
    record_process_status(&runtime, false, true, false);
    assert!(!runtime.is_running());

    record_process_status(&runtime, true, true, true);
    assert!(!runtime.is_running());

    runtime.set_vr_mode(true);
    assert!(runtime.is_running());
    assert_eq!(created.load(Ordering::SeqCst), 0);

    record_process_status(&runtime, false, true, true);
    assert!(!runtime.is_running());
    assert_eq!(created.load(Ordering::SeqCst), 0);
}

#[test]
fn hmd_steamvr_start_mode_runs_with_steamvr_without_vrchat_vr_mode() {
    let created = Arc::new(AtomicUsize::new(0));
    let dropped = Arc::new(AtomicUsize::new(0));
    let config = VrOverlayRuntimeConfig {
        hmd: HmdNotificationConfig {
            enabled: true,
            start_mode: WristOverlayStartMode::SteamVr,
            ..HmdNotificationConfig::default()
        },
        ..VrOverlayRuntimeConfig::default()
    };
    let runtime = VrOverlayRuntime::new_for_test_with_config_and_frame_producer_factory(
        true,
        config,
        counting_frame_producer_factory(Arc::clone(&created), Arc::clone(&dropped)),
    );

    record_process_status(&runtime, false, true, false);
    assert!(runtime.is_running());
    assert_eq!(created.load(Ordering::SeqCst), 0);

    record_process_status(&runtime, false, false, false);
    assert!(!runtime.is_running());
    assert_eq!(created.load(Ordering::SeqCst), 0);
}

#[test]
fn format_local_time_respects_hour12_setting() {
    assert_eq!(format_local_time(0, 5, false), "00:05");
    assert_eq!(format_local_time(23, 7, false), "23:07");
    assert_eq!(format_local_time(0, 5, true), "12:05 AM");
    assert_eq!(format_local_time(12, 30, true), "12:30 PM");
    assert_eq!(format_local_time(23, 7, true), "11:07 PM");
}

fn counting_frame_producer_factory(
    created: Arc<AtomicUsize>,
    dropped: Arc<AtomicUsize>,
) -> Box<dyn Fn() -> Box<dyn VrOverlayFrameProducer> + Send + Sync> {
    Box::new(move || {
        created.fetch_add(1, Ordering::SeqCst);
        Box::new(CountingFrameProducer {
            dropped: Arc::clone(&dropped),
        })
    })
}

pub(crate) fn record_process_status(
    runtime: &VrOverlayRuntime,
    is_game_running: bool,
    is_steamvr_running: bool,
    game_changed: bool,
) {
    runtime
        .on_game_process_event(GameProcessEvent {
            is_game_running,
            is_steamvr_running,
            game_changed,
        })
        .expect("record process status");
}

struct CountingFrameProducer {
    dropped: Arc<AtomicUsize>,
}

impl VrOverlayFrameProducer for CountingFrameProducer {
    fn next_frame(&mut self, _input: VrOverlayFrameInput) -> Result<RgbaFrame, String> {
        Ok(RgbaFrame::new(OverlaySize::new(16, 8), vec![0; 16 * 8 * 4]))
    }
}

impl Drop for CountingFrameProducer {
    fn drop(&mut self) {
        self.dropped.fetch_add(1, Ordering::SeqCst);
    }
}
