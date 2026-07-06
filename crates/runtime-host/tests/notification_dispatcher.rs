use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde_json::json;
use vrcx_0_application::{BackendRuntimeMode, BackendRuntimePhase, BackendRuntimeSnapshot};
use vrcx_0_application::{
    OverlayActivityActorRelation, OverlayActivityCategory, OverlayActivityContent,
    OverlayActivityDelivery, OverlayActivityEntry,
};
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::DatabaseService;
use vrcx_0_runtime_host::notification::{
    auth_webhook_generic_payload, auth_webhook_is_enabled, auth_webhook_should_recover,
    decide_notification_plan, AuthWebhookEvent, AuthWebhookEventKind, DesktopNotifier,
    DesktopNotifierSlot, NotificationDeliveryGameState, NotificationDeliveryPreferences,
};

#[test]
fn webhook_delivery_ignores_game_state_conditions() {
    let preferences = NotificationDeliveryPreferences {
        desktop_toast: "Game Running".into(),
        notification_tts: "Game Running".into(),
        webhook_enabled: true,
        webhook_url: "https://example.com/webhook".into(),
        ..NotificationDeliveryPreferences::default()
    };
    let game = NotificationDeliveryGameState {
        is_game_running: false,
        is_steamvr_running: false,
        is_game_no_vr: false,
    };

    let plan = decide_notification_plan(&delivery(true, true, true), &preferences, &game);

    assert!(!plan.desktop);
    assert!(!plan.tts);
    assert!(plan.webhook);
}

#[test]
fn vr_delivery_requires_steamvr_and_enabled_channels() {
    let preferences = NotificationDeliveryPreferences {
        xs_notifications: true,
        ovrt_hud_notifications: true,
        ovrt_wrist_notifications: true,
        ..NotificationDeliveryPreferences::default()
    };

    let not_in_vr = decide_notification_plan(
        &delivery(false, true, false),
        &preferences,
        &NotificationDeliveryGameState {
            is_game_running: true,
            is_steamvr_running: false,
            is_game_no_vr: true,
        },
    );
    assert!(!not_in_vr.xs);
    assert!(!not_in_vr.ovrt);

    let in_vr = decide_notification_plan(
        &delivery(false, true, false),
        &preferences,
        &NotificationDeliveryGameState {
            is_game_running: true,
            is_steamvr_running: true,
            is_game_no_vr: false,
        },
    );
    assert!(in_vr.xs);
    assert!(in_vr.ovrt);
    assert!(in_vr.ovrt_hud);
    assert!(in_vr.ovrt_wrist);
}

#[test]
fn desktop_notifier_slot_noops_until_tauri_injects_notifier() {
    let slot = DesktopNotifierSlot::default();

    slot.show("Title", Some("Body"), None, true).unwrap();

    let recorder = Arc::new(RecordingDesktopNotifier::default());
    slot.set(recorder.clone());
    slot.show("Title", Some("Body"), Some("image.png"), true)
        .unwrap();

    assert_eq!(
        recorder.entries.lock().unwrap().as_slice(),
        &[DesktopNotificationRecord {
            title: "Title".into(),
            body: Some("Body".into()),
            image: Some("image.png".into()),
            play_sound: true,
        }]
    );
}

#[test]
fn auth_webhook_defaults_to_enabled_when_url_exists() {
    let test_db = test_db("auth-webhook-defaults");
    let config = ConfigRepository::new(Arc::clone(&test_db.db));
    config
        .set_string("webhookUrl", "https://example.com/webhook")
        .unwrap();

    assert!(auth_webhook_is_enabled(&config));

    config.set_bool("webhookAuthEventsEnabled", false).unwrap();

    assert!(!auth_webhook_is_enabled(&config));
}

#[test]
fn auth_webhook_payload_uses_fixed_safe_fields() {
    let payload = auth_webhook_generic_payload(&AuthWebhookEvent {
        kind: AuthWebhookEventKind::ReloginFailed,
        user_id: "usr_123".into(),
        display_name: "Pizza".into(),
        reason: "expired token secret_cookie=abc".into(),
        mode: "background".into(),
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
        "authenticated",
        "usr_1"
    )));
    assert!(!auth_webhook_should_recover(&backend_snapshot(
        BackendRuntimeMode::Foreground,
        BackendRuntimePhase::Running,
        "authenticated",
        "usr_1"
    )));
    assert!(!auth_webhook_should_recover(&backend_snapshot(
        BackendRuntimeMode::Background,
        BackendRuntimePhase::Running,
        "authenticated",
        ""
    )));
}

fn backend_snapshot(
    mode: BackendRuntimeMode,
    phase: BackendRuntimePhase,
    auth_status: &str,
    auth_user_id: &str,
) -> BackendRuntimeSnapshot {
    BackendRuntimeSnapshot {
        mode,
        phase,
        auth_status: auth_status.into(),
        auth_user_id: auth_user_id.into(),
        auth_display_name: "Pizza".into(),
        ws_status: "authFailure".into(),
        game_log_status: "idle".into(),
        process_status: "unknown".into(),
        ws_message_counts: Default::default(),
        ws_persisted_count: 0,
        game_log_persisted_count: 0,
        last_error: None,
        updated_at: "2026-07-03T08:30:00.000Z".into(),
    }
}

fn delivery(desktop: bool, vr: bool, webhook: bool) -> OverlayActivityDelivery {
    OverlayActivityDelivery {
        entry: OverlayActivityEntry {
            sequence: 1,
            source_id: "notification:1".into(),
            activity_type: "Online".into(),
            category: OverlayActivityCategory::FavoriteMovement,
            created_at: "2026-06-18T08:30:00.000Z".into(),
            actor_user_id: "usr_123".into(),
            actor_display_name: "Pizza".into(),
            content: OverlayActivityContent::default(),
            actor_relation: OverlayActivityActorRelation::Friend,
            payload: json!({}),
        },
        desktop,
        vr,
        hmd: false,
        webhook,
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct DesktopNotificationRecord {
    title: String,
    body: Option<String>,
    image: Option<String>,
    play_sound: bool,
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
    ) -> Result<(), String> {
        self.entries
            .lock()
            .unwrap()
            .push(DesktopNotificationRecord {
                title: title.into(),
                body: body.map(str::to_string),
                image: image.map(str::to_string),
                play_sound,
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
