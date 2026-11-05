use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use vrcx_0_application_activity::notification::{
    auth_webhook_generic_payload, auth_webhook_is_enabled, auth_webhook_should_recover,
    AuthWebhookEvent, AuthWebhookEventKind,
};
use vrcx_0_application_activity::{
    ActivityActorRelation, ActivityCategory, ActivityContent, ActivityDelivery, ActivityEntry,
};
use vrcx_0_application_core::{
    BackendRuntimeAuthStatus, BackendRuntimeGameLogStatus, BackendRuntimeMode, BackendRuntimePhase,
    BackendRuntimeProcessStatus, BackendRuntimeSnapshot, ConfigStore,
};
use vrcx_0_core::OwnerId;
use vrcx_0_outbound_adapters::LocalConfigStore;
use vrcx_0_persistence::DatabaseService;
use vrcx_0_runtime_host_desktop::notification::{
    decide_notification_plan, DesktopNotificationAction, DesktopNotifier, DesktopNotifierSlot,
    NotificationDeliveryCondition, NotificationDeliveryGameState, NotificationDeliveryPreferences,
};

#[test]
fn vr_delivery_requires_steamvr_and_enabled_channels() {
    let preferences = NotificationDeliveryPreferences {
        xs_notifications: true,
        ovrt_hud_notifications: true,
        ovrt_wrist_notifications: true,
        ..NotificationDeliveryPreferences::default()
    };

    let not_in_vr = decide_notification_plan(
        &delivery(false, true, false, false),
        &preferences,
        &NotificationDeliveryGameState {
            is_game_running: true,
            is_steamvr_running: false,
            is_game_no_vr: true,
            is_hmd_afk: false,
        },
    );
    assert!(!not_in_vr.xs);
    assert!(!not_in_vr.ovrt);

    let in_vr = decide_notification_plan(
        &delivery(false, true, false, false),
        &preferences,
        &NotificationDeliveryGameState {
            is_game_running: true,
            is_steamvr_running: true,
            is_game_no_vr: false,
            is_hmd_afk: false,
        },
    );
    assert!(in_vr.xs);
    assert_eq!(in_vr.ovrt, cfg!(windows));
}

#[test]
fn ovr_toolkit_is_only_planned_on_windows() {
    let preferences = NotificationDeliveryPreferences {
        ovrt_hud_notifications: true,
        ovrt_wrist_notifications: true,
        ..NotificationDeliveryPreferences::default()
    };
    let plan = decide_notification_plan(
        &delivery(false, true, false, false),
        &preferences,
        &NotificationDeliveryGameState {
            is_game_running: true,
            is_steamvr_running: true,
            is_game_no_vr: false,
            is_hmd_afk: false,
        },
    );

    assert_eq!(
        (
            plan.ovrt,
            plan.ovrt_hud,
            plan.ovrt_wrist,
            plan.overlay_image(&preferences)
        ),
        (cfg!(windows), cfg!(windows), cfg!(windows), cfg!(windows))
    );
}

#[test]
fn desktop_and_external_overlay_icons_follow_their_own_switches() {
    let game = NotificationDeliveryGameState {
        is_game_running: true,
        is_steamvr_running: true,
        is_game_no_vr: false,
        is_hmd_afk: false,
    };
    let images = |desktop, vr, desktop_notification_avatars, image_notifications| {
        let preferences = NotificationDeliveryPreferences {
            desktop_toast: NotificationDeliveryCondition::Always,
            overlay_toast: NotificationDeliveryCondition::Always,
            xs_notifications: true,
            desktop_notification_avatars,
            image_notifications,
            ..NotificationDeliveryPreferences::default()
        };
        let plan =
            decide_notification_plan(&delivery(desktop, vr, false, false), &preferences, &game);
        (
            plan.desktop_image(&preferences),
            plan.overlay_image(&preferences),
        )
    };

    assert_eq!(images(true, false, true, false), (true, false));
    assert_eq!(images(true, false, false, true), (false, false));
    assert_eq!(images(false, true, false, true), (false, true));
    assert_eq!(images(false, true, true, false), (false, false));
}

#[test]
fn each_local_channel_only_follows_its_own_router_flag() {
    let preferences = NotificationDeliveryPreferences {
        desktop_toast: NotificationDeliveryCondition::Always,
        overlay_toast: NotificationDeliveryCondition::Always,
        notification_tts: NotificationDeliveryCondition::Always,
        xs_notifications: true,
        ovrt_hud_notifications: true,
        ..NotificationDeliveryPreferences::default()
    };
    let game = NotificationDeliveryGameState {
        is_game_running: true,
        is_steamvr_running: true,
        is_game_no_vr: false,
        is_hmd_afk: false,
    };
    let channels = |desktop, vr, tts| {
        let plan =
            decide_notification_plan(&delivery(desktop, vr, false, tts), &preferences, &game);
        (plan.desktop, plan.xs, plan.tts)
    };

    assert_eq!(channels(true, false, false), (true, false, false));
    assert_eq!(channels(false, true, false), (false, true, false));
    assert_eq!(channels(false, false, true), (false, false, true));
    assert_eq!(channels(false, false, false), (false, false, false));
}

#[test]
fn desktop_notifier_slot_noops_until_tauri_injects_notifier() {
    let slot = DesktopNotifierSlot::default();

    slot.show("Title", Some("Body"), None, true, None).unwrap();

    let recorder = Arc::new(RecordingDesktopNotifier::default());
    slot.set(recorder.clone());
    let action = DesktopNotificationAction::open_user_profile(
        &OwnerId::new("usr_12345678-1234-1234-1234-1234567890ab"),
        "usr_abcdefab-cdef-abcd-efab-cdefabcdefab",
    )
    .unwrap();
    slot.show(
        "Title",
        Some("Body"),
        Some("image.png"),
        true,
        Some(&action),
    )
    .unwrap();

    assert_eq!(
        recorder.entries.lock().unwrap().as_slice(),
        &[DesktopNotificationRecord {
            title: "Title".into(),
            body: Some("Body".into()),
            image: Some("image.png".into()),
            play_sound: true,
            action: Some(action),
        }]
    );
}

#[test]
fn auth_webhook_defaults_to_enabled_when_url_exists() {
    let test_db = test_db("auth-webhook-defaults");
    let storage = Arc::new(
        vrcx_0_persistence::storage::StorageService::new(&test_db._dir.path.join("storage.json"))
            .unwrap(),
    );
    let notification_config = LocalConfigStore::new(Arc::clone(&test_db.db), storage);
    notification_config
        .set_string("webhookUrl", "https://example.com/webhook")
        .unwrap();

    assert!(auth_webhook_is_enabled(&notification_config));

    notification_config
        .set_bool("webhookAuthEventsEnabled", false)
        .unwrap();

    assert!(!auth_webhook_is_enabled(&notification_config));
}

#[test]
fn auth_webhook_payload_uses_fixed_safe_fields() {
    let payload = auth_webhook_generic_payload(&AuthWebhookEvent {
        kind: AuthWebhookEventKind::ReloginFailed,
        user_id: "usr_123".into(),
        display_name: "Pizza".into(),
        reason: "expired token secret_cookie=abc".into(),
        mode: BackendRuntimeMode::Background,
        timestamp: "2026-07-03T08:30:00.000Z".into(),
    });

    assert_eq!(payload["event"], "auth.relogin.failed");
    assert_eq!(payload["user"]["id"], "usr_123");
    assert_eq!(payload["mode"], "background");
    assert_eq!(payload["reason"], "expired [redacted] [redacted]");
    let serialized = payload.to_string();
    assert!(!serialized.contains("password"));
    assert!(!serialized.contains("token"));
    assert!(!serialized.contains("cookie"));
}

#[test]
fn auth_webhook_recovery_only_targets_authenticated_background_sessions() {
    assert!(auth_webhook_should_recover(&backend_snapshot(
        BackendRuntimeMode::Background,
        BackendRuntimePhase::Running,
        "usr_1"
    )));
    assert!(!auth_webhook_should_recover(&backend_snapshot(
        BackendRuntimeMode::Foreground,
        BackendRuntimePhase::Running,
        "usr_1"
    )));
    assert!(!auth_webhook_should_recover(&backend_snapshot(
        BackendRuntimeMode::Background,
        BackendRuntimePhase::Running,
        ""
    )));
}

fn backend_snapshot(
    mode: BackendRuntimeMode,
    phase: BackendRuntimePhase,
    auth_user_id: &str,
) -> BackendRuntimeSnapshot {
    BackendRuntimeSnapshot {
        mode,
        phase,
        auth_status: BackendRuntimeAuthStatus::Authenticated,
        auth_user_id: auth_user_id.into(),
        auth_display_name: "Pizza".into(),
        ws_status: vrcx_0_core::realtime::RealtimeWsStatus::AuthFailure,
        game_log_status: BackendRuntimeGameLogStatus::Idle,
        process_status: BackendRuntimeProcessStatus::Unknown,
        game_log_persisted_count: 0,
        last_error: None,
        updated_at: "2026-07-03T08:30:00.000Z".into(),
        friend_profile_load: vrcx_0_application_core::FriendProfileLoadStatusPayload::default(),
    }
}

#[test]
fn desktop_delivery_follows_the_afk_switch_while_the_headset_is_off() {
    let afk_in_vr = NotificationDeliveryGameState {
        is_game_running: true,
        is_steamvr_running: true,
        is_game_no_vr: false,
        is_hmd_afk: true,
    };
    let switch = |afk_desktop_toast| NotificationDeliveryPreferences {
        afk_desktop_toast,
        ..NotificationDeliveryPreferences::default()
    };

    assert!(
        !decide_notification_plan(
            &delivery(true, false, false, false),
            &switch(false),
            &afk_in_vr
        )
        .desktop
    );
    assert!(
        decide_notification_plan(
            &delivery(true, false, false, false),
            &switch(true),
            &afk_in_vr
        )
        .desktop
    );
    assert!(
        !decide_notification_plan(
            &delivery(true, false, false, false),
            &switch(true),
            &NotificationDeliveryGameState {
                is_hmd_afk: false,
                ..afk_in_vr
            }
        )
        .desktop
    );
    assert!(
        !decide_notification_plan(
            &delivery(true, false, false, false),
            &switch(true),
            &NotificationDeliveryGameState {
                is_game_no_vr: true,
                ..afk_in_vr
            }
        )
        .desktop
    );
}

#[test]
fn external_vr_overlays_follow_the_overlay_condition() {
    let in_vr = NotificationDeliveryGameState {
        is_game_running: false,
        is_steamvr_running: true,
        is_game_no_vr: false,
        is_hmd_afk: false,
    };
    let condition = |overlay_toast| NotificationDeliveryPreferences {
        xs_notifications: true,
        overlay_toast,
        ..NotificationDeliveryPreferences::default()
    };

    for (overlay_toast, expected) in [
        (NotificationDeliveryCondition::GameRunning, false),
        (NotificationDeliveryCondition::GameClosed, true),
        (NotificationDeliveryCondition::Always, true),
        (NotificationDeliveryCondition::Never, false),
    ] {
        let plan = decide_notification_plan(
            &delivery(false, true, false, false),
            &condition(overlay_toast),
            &in_vr,
        );
        assert_eq!(plan.xs, expected, "{overlay_toast:?}");
    }
}

#[test]
fn tts_delivery_uses_independent_filter_surface() {
    let preferences = NotificationDeliveryPreferences {
        notification_tts: NotificationDeliveryCondition::Always,
        ..NotificationDeliveryPreferences::default()
    };
    let game = NotificationDeliveryGameState {
        is_game_running: true,
        is_steamvr_running: true,
        is_game_no_vr: false,
        is_hmd_afk: false,
    };

    let disabled =
        decide_notification_plan(&delivery(true, true, false, false), &preferences, &game);
    assert!(!disabled.tts);

    let enabled =
        decide_notification_plan(&delivery(false, false, false, true), &preferences, &game);
    assert!(enabled.tts);
}

fn delivery(desktop: bool, vr: bool, webhook: bool, tts: bool) -> ActivityDelivery {
    ActivityDelivery {
        entry: ActivityEntry {
            sequence: 1,
            source_id: "notification:1".into(),
            kind: vrcx_0_contracts::activity::ActivityKind::Online,
            category: ActivityCategory::FavoriteMovement,
            created_at: "2026-06-18T08:30:00.000Z".into(),
            actor_user_id: "usr_123".into(),
            actor_display_name: "Pizza".into(),
            content: ActivityContent::default(),
            actor_relation: ActivityActorRelation::Friend,
        },
        desktop,
        vr,
        hmd: false,
        webhook,
        tts,
        widget: false,
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct DesktopNotificationRecord {
    title: String,
    body: Option<String>,
    image: Option<String>,
    play_sound: bool,
    action: Option<DesktopNotificationAction>,
}

#[derive(Default)]
struct RecordingDesktopNotifier {
    entries: Mutex<Vec<DesktopNotificationRecord>>,
}

impl DesktopNotifier for RecordingDesktopNotifier {
    fn show(
        &self,
        title: &str,
        body: Option<&str>,
        image: Option<&str>,
        play_sound: bool,
        action: Option<&DesktopNotificationAction>,
    ) -> Result<(), String> {
        self.entries
            .lock()
            .unwrap()
            .push(DesktopNotificationRecord {
                title: title.into(),
                body: body.map(str::to_string),
                image: image.map(str::to_string),
                play_sound,
                action: action.cloned(),
            });
        Ok(())
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

struct TestDatabase {
    _dir: TestDir,
    db: Arc<DatabaseService>,
}

fn test_db(name: &str) -> TestDatabase {
    let dir = TestDir::new(name);
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap());
    TestDatabase { _dir: dir, db }
}
